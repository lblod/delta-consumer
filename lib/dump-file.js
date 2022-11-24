import * as muAuthSudo from '@lblod/mu-auth-sudo';
import * as mu from 'mu';
import fs from 'fs-extra';
import readline from 'readline';
import { sparqlEscapeString, sparqlEscapeUri } from 'mu';
import { Parser } from 'n3';
import fetcher from './fetcher';
import path from 'path';
import {
    DOWNLOAD_FILE_ENDPOINT,
    DUMPFILE_FOLDER,
    SYNC_BASE_URL,
    SYNC_DATASET_ENDPOINT,
    SYNC_DATASET_SUBJECT,
    SYNC_FILES_PATH,
} from '../config';

const BASEPATH = path.join(SYNC_FILES_PATH, DUMPFILE_FOLDER);
fs.ensureDirSync(BASEPATH);

const BATCH_SIZE = 1000;

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
    return path.join(BASEPATH,`${this.id}.ttl`);
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
    } catch(e) {
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

      if(stat.size > 0) {
        await this.parseAndDispatch(dispatch)

        console.log(`Successfully loaded and dispatched file ${this.id} stored at ${this.filePath}`);
      } else {
        console.error(`File ${this.filePath} is empty`);
      }
    }
    catch(error){
      console.log(`Something went wrong while ingesting file ${this.id} stored at ${this.filePath}`);
      console.log(error);
      throw error;
    }
  }

  /**
   * Helper that creates a stream from the file's location and process it line by line.
   * The processing includes 3 steps:
   *   1. Get the first line of the stream
   *   2. Try to parse it with a ttl parser
   *   3. If it succeeded, dispatch the parsed triple to the database
   *      If it failed, it means the triple is spread accross multiple lines.
   *        We will attach this line with the following one and try to parse it again.
   * Once the triples are parsed, they are stored in an array until it reaches a BATCH_SIZE or the end of the file.
   * They are then dispatched to the database.
   */
  async parseAndDispatch(dispatch) {
    const parser = new Parser();
    const ttlStream = fs.createReadStream(this.filePath);

    // Interface to read stream line by line
    const rl = readline.createInterface({
      input: ttlStream,
      crlfDelay: Infinity
    });

    let storage = [];
    let linesToParse = [];

    let isLastLine = false;
    ttlStream.on('end', () => { isLastLine = true });

    for await (const line of rl) {
      linesToParse.push(line);
      try {
        const parsedQuad = parser.parse(linesToParse.toString())[0];
        linesToParse = [];

        storage.push(parsedQuad);

        if (storage.length === BATCH_SIZE || isLastLine) {
          await this.toTermObjectAndDispatch(storage, dispatch);
          storage = [];
        }
      } catch (e) {
        console.log('Parsing failed, expecting multi-line parsing. Waiting for next iteration.');
      }
    }
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

    await dispatch({ mu, muAuthSudo }, { termObjects: triples });
  }

  serializeN3Term(rdfTerm) {
    // Based on: https://github.com/kanselarij-vlaanderen/dcat-dataset-publication-service/blob/master/lib/ttl-helpers.js#L48
    const {termType, value, datatype, language} = rdfTerm;
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
    console.log(`Retrieving latest dataset from ${SYNC_DATASET_ENDPOINT}`);
    const responseDataset = await fetcher(
      `${SYNC_DATASET_ENDPOINT}?filter[subject]=${SYNC_DATASET_SUBJECT}&filter[:has-no:next-version]=yes`,
      {
        headers: {
          'Accept': 'application/vnd.api+json'
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
