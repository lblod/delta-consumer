import * as muAuthSudo from '@lblod/mu-auth-sudo';
import * as mu from 'mu';
import fs from 'fs-extra';
import readline from 'readline';
import { Writable } from 'stream';
import { sparqlEscapeString, sparqlEscapeUri } from 'mu';
import { Parser, StreamParser } from 'n3';
import fetcher from './fetcher';
import path from 'path';
import { chunk } from 'lodash';
import {
  DOWNLOAD_FILE_ENDPOINT,
  DUMPFILE_FOLDER,
  ENABLE_DELTA_CONTEXT,
  SYNC_BASE_URL,
  SYNC_DATASET_ENDPOINT,
  SYNC_DATASET_SUBJECT,
  SYNC_FILES_PATH,
  LANDING_ZONE_GRAPH,
  LANDING_ZONE_DATABASE_ENDPOINT,
  BATCH_SIZE,
  ENABLE_TRIPLE_REMAPPING,
  ENABLE_CUSTOM_DISPATCH,
} from '../config';
import * as fetch from 'node-fetch';
import { insertIntoLandingZoneGraph } from './delta-context';

const BASEPATH = path.join(SYNC_FILES_PATH, DUMPFILE_FOLDER);
fs.ensureDirSync(BASEPATH);


class DumpFile {
  constructor(distributionData, data) {
    this.id = data.id;
    this.created = distributionData["release-date"];
    this.name = distributionData["title"];
  }

  get downloadUrl() {
    return DOWNLOAD_FILE_ENDPOINT.replace(':id', this.id);
  }

  get filePath() {
    return path.join(BASEPATH, `${this.id}.ttl`);
  }

  async download() {
    try {
      await fetcher(this.downloadUrl)
        .then(res => new Promise((resolve, reject) => {
          const writeStream = fs.createWriteStream(this.filePath);
          res.body.pipe(writeStream);
          writeStream.on('close', () => resolve());
          writeStream.on('error', reject);
        }));
    } catch (e) {
      console.log(`Something went wrong while downloading file from ${this.downloadUrl}`);
      console.log(e);
      throw e;
    }
  }

  async loadAndDispatch(dispatch) {
    try {
      console.log(`Downloading file at ${this.downloadUrl}`);
      await this.download();

      const stat = await fs.stat(this.filePath);

      if (stat.size > 0) {
        await this.parseAndDispatch(dispatch);

        console.log(`Successfully loaded and dispatched file ${this.id} stored at ${this.filePath}`);
      } else {
        console.error(`File ${this.filePath} is empty`);
      }
    }
    catch (error) {
      console.log(`Something went wrong while ingesting file ${this.id} stored at ${this.filePath}`);
      console.log(error);
      throw error;
    }
  }

  /**
   * Helper that creates a stream from the downloaded TTL file and processes it, while keeping
   * memory usage constant.
   * In the stream, it creates batches and inserts them once the batch reaches a certain size, using the 'dispatch' callback parameter.
   * The implementation itself is an abomination because promises and streams don't mix very well.
   * The error handling is the most tricky part.
   */
  async parseAndDispatch(dispatch) {
    const that = this;

    return new Promise((resolve, reject) => {
      let quadsBatch = [];
      const rdfStream = fs.createReadStream(that.filePath);
      const streamParser = new StreamParser();
      let processingStream;

      function onQuadProcessor() {
        const writer = new Writable({ objectMode: true });

        writer._write = async function (quad, encoding, done) {
          try {
            if (quad) {
              quadsBatch.push(quad);
            }
            if (quadsBatch.length == BATCH_SIZE) {
              await that.toTermObjectAndDispatch(quadsBatch, dispatch);
              quadsBatch = [];
            }
          }
          catch (error) {
            console.error(`Issues parsing ttl file (onQuadProcessor): ${error}`);

            //Stream needs to be destroyed, else it's going to keep processing.
            // (i.e. if you reject() here, the promise throws an exception,
            // which will be handled by the calling function, but the stream
            // is going to proceed nevertheless, which may pollute the DB.)
            rdfStream.destroy(error);

            if (processingStream && !processingStream.destroyed) {
              processingStream.destroy(error);
            }
          }
          finally {
            done();
          }
        };
        return writer;
      }

      processingStream = streamParser.pipe(new onQuadProcessor());
      rdfStream.pipe(streamParser);

      processingStream.on('error', (error) => {
        console.error(`Error in processingStream: ${error}`);
        reject(error);
      });

      streamParser.on('end', async function () {
        // Store remaining triples
        if (quadsBatch.length) {
          try {
            await that.toTermObjectAndDispatch(quadsBatch, dispatch);
            quadsBatch = [];
            resolve();
          }
          catch (error) {
            console.error(`Issues parsing ttl file (on 'end' StreamParser): ${error}`);
            reject(error);
          }
        }
      });

      streamParser.on('error', function (error) {
        console.error(`Issues parsing ttl file (streamParser): ${error}`);
        reject(error);
      });

      rdfStream.on('error', function (error) {
        console.error(`Issues reading file (rdfStream): ${error}`);
        reject(error);
      });
    });
  }

  // Helper to convert parsed Quads to triple objects and dispatch them to the database
  async toTermObjectAndDispatch(data, dispatch) {
    const triples = data.map(triple => {
      return {
        graph: null,
        subject: this.serializeN3Term(triple.subject),
        predicate: this.serializeN3Term(triple.predicate),
        object: this.serializeN3Term(triple.object)
      };
    });
    if (ENABLE_DELTA_CONTEXT || ENABLE_TRIPLE_REMAPPING) {
      await insertIntoLandingZoneGraph(triples);
    }
    if (ENABLE_CUSTOM_DISPATCH) {
      await dispatch(
        { mu, muAuthSudo, fetch, chunk, sparqlEscapeUri },
        { termObjects: triples },
        { LANDING_ZONE_GRAPH, LANDING_ZONE_DATABASE_ENDPOINT },
      );
    }
  }

  serializeN3Term(rdfTerm) {
    // Based on: https://github.com/kanselarij-vlaanderen/dcat-dataset-publication-service/blob/master/lib/ttl-helpers.js#L48
    const { termType, value, datatype, language } = rdfTerm;
    if (termType === 'NamedNode') {
      return sparqlEscapeUri(value);
    }
    else if (termType === 'Literal') {
      // We ignore xsd:string datatypes because Virtuoso doesn't treat those as default datatype
      // Eg. SELECT * WHERE { ?s mu:uuid "4983948" } will not return any value if the uuid is a typed literal
      // Since the n3 npm library used by the producer explicitely adds xsd:string on non-typed literals
      // we ignore the xsd:string on ingest
      if (datatype && datatype.value && datatype.value != 'http://www.w3.org/2001/XMLSchema#string')
        return `${sparqlEscapeString(value)}^^${sparqlEscapeUri(datatype.value)}`;
      else if (language)
        return `${sparqlEscapeString(value)}@${language}`;
      else
        return `${sparqlEscapeString(value)}`;
    }
    else {
      console.log(`Don't know how to escape type ${termType}. Will escape as a string.`);
      return sparqlEscapeString(value);
    }
  }
}

export async function getLatestDumpFile() {
  try {
    const urlToCall = `${SYNC_DATASET_ENDPOINT}?filter[subject]=${SYNC_DATASET_SUBJECT}&filter[:has-no:next-version]=yes`;
    console.log(`Retrieving latest dataset from ${urlToCall}`);
    const responseDataset = await fetcher(
      urlToCall,
      {
        headers: {
          'Accept': 'application/vnd.api+json',
          'Accept-encoding': 'deflate,gzip',
        }
      }
    );
    const dataset = await responseDataset.json();

    if (dataset.data.length) {
      const distributionMetaData = dataset.data[0].attributes;
      const distributionRelatedLink = dataset.data[0].relationships.distributions.links.related;
      const distributionUri = `${SYNC_BASE_URL}/${distributionRelatedLink}`;

      console.log(`Retrieving distribution from ${distributionUri}`);
      const resultDistribution = await fetcher(`${distributionUri}?include=subject`, {
        headers: {
          'Accept': 'application/vnd.api+json'
        }
      });
      const distribution = await resultDistribution.json();
      return new DumpFile(distributionMetaData, distribution.data[0].relationships.subject.data);
    } else {
      throw 'No dataset was found at the producing endpoint.';
    }
  } catch (e) {
    console.log(`Unable to retrieve dataset from ${SYNC_DATASET_ENDPOINT}`);
    throw e;
  }
}
