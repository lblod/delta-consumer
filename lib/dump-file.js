import * as muAuthSudo from '@lblod/mu-auth-sudo';
import * as mu from 'mu';
import fs from 'fs-extra';
import zlib from 'zlib';
import { sparqlEscapeString, sparqlEscapeUri } from 'mu';
import { Parser } from 'n3';
import fetcher from './fetcher';
import { createInterface } from 'readline';
import path from 'path';
import { chunk } from './utils';
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
    GET_FILE_ENDPOINT,
} from './../config';
import * as fetch from 'node-fetch';
import { insertIntoLandingZoneGraph } from './delta-context';
import { prepareStatements, updateWithRecover, downloadFile, deleteFromGraph, insertIntoGraph } from './utils';


const BASEPATH = path.join(SYNC_FILES_PATH, DUMPFILE_FOLDER);
fs.ensureDirSync(BASEPATH);

class DumpFile {
    constructor(distributionData, data) {
        this.id = data.id;
        this.created = distributionData["release-date"];
        this.name = distributionData["title"];
        this.format = data.format;
        this.originalFilename = data.name;
    }

    get downloadUrl() {
        return DOWNLOAD_FILE_ENDPOINT.replace(':id', this.id);
    }

    get filePath() {
        return path.join(BASEPATH, this.originalFilename);
    }

    async download() {
        try {
            await downloadFile(this.downloadUrl, this.filePath);
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
        let fileStream = fs.createReadStream(this.filePath);
        if (this.format === 'application/gzip') {
            console.log(`${this.filePath} is a gzipped file. piping gunzip to process ttl...`);
            const gunzip = zlib.createGunzip();
            fileStream = fileStream.pipe(gunzip);
        }

        const reader = createInterface({ input: fileStream });
        const buffer = [];
        let bufferSize = BATCH_SIZE;
        let prefixes = new Map();
        let totalTriples = 0;
        const startTime = Date.now();
        console.log('start processing file...');
        for await (const line of reader) {
            if (/^@base\s*<>\s*\./.test(line.trim())) {
                continue; // skip empty base e.g @base <>.
            }
            buffer.push(line);
            // check the size of the buffer and decide if we should flush it
            // small optimization: we check the current line content as a triple should always 
            //                     terminate with a '.', this reduces the time spent of trying
            //                     to parse an incomplete turtle document
            if (buffer.length >= bufferSize && (!line.trim().length || line.trimEnd().endsWith('.'))) {
                try {
                    const elapsedSeconds = (Date.now() - startTime) / 1000;
                    const avgPerSecond = totalTriples / elapsedSeconds;
                    const { quads, prefixes: newPrefixes } = await this.parse(buffer.join('\n'), prefixes);
                    console.log('processing batch of', quads.length, 'triples,', 'total triples already ingested:', totalTriples + ',', 'avg pace:', avgPerSecond.toFixed(2), 'triples/sec.');
                    prefixes = newPrefixes;
                    if (quads.length) {
                        await this.toTermObjectAndDispatch(quads, dispatch);
                        totalTriples += quads.length;
                    }
                    buffer.length = 0;
                    bufferSize = BATCH_SIZE;
                } catch (e) {
                    // no op, in the middle of a triple probably, continue to fill the buffer
                    // we simply increase the buffer size by 5% to avoid multiple parsing attempts
                    console.log(`could not parse`, buffer.join('\n'), 'err', e);
                    bufferSize += Math.round(bufferSize * 0.03);
                }

            }

        }
        // flush, at this point if it still fails, it probably must crash
        const remaining = buffer.join('\n');
        if (remaining.trim().length) {
            console.log('Buffer is not empty, processing the remaining of the file:\n' + remaining);
            const { quads } = await this.parse(remaining, prefixes);
            if (quads.length) {
                await this.toTermObjectAndDispatch(quads, dispatch);
                totalTriples += quads.length;
            }
            buffer.length = 0;
        }
        const elapsedSeconds = (Date.now() - startTime) / 1000;
        const avgPerSecond = totalTriples / elapsedSeconds;
        console.log('Consumed', totalTriples, 'at an avg pace of', avgPerSecond.toFixed(2), 'triples/sec.');

    }
    async parse(data, prefixes) {
        const parser = new Parser();
        return new Promise((resolve, reject) => {
            const quads = [];
            let existingPrefixes = Array.from(prefixes)
                .map(([key, value]) => `@prefix ${key}: <${value}>.`).join('\n');
            let dataWithExistingPrefix = `${existingPrefixes}\n${data}\n`;
            parser.parse(dataWithExistingPrefix, (error, quad, extractedPrefixes) => {
                if (error) return reject(error);
                if (quad) {
                    quads.push(quad);
                } else {
                    prefixes = new Map([...prefixes, ...new Map(Object.entries(extractedPrefixes))]);
                    resolve({ quads, prefixes });
                }
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
                { mu, muAuthSudo, fetch, chunk, sparqlEscapeUri, prepareStatements, updateWithRecover, deleteFromGraph, insertIntoGraph },
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
            const distributions = await resultDistribution.json();

            // Prioritize compressed  gzip > uncompressed ttl
            const selected_distribution = distributions.data.find(d => d.format === 'application/gzip')
                || distributions.data.find(d => d.format === 'text/turtle')
                || distributions.data[0];

            const fileResponse = await fetcher(`${GET_FILE_ENDPOINT.replace(':id', selected_distribution.relationships.subject.data.id)}`, {
                headers: {
                    'Accept': 'application/vnd.api+json'
                }
            });

            const file = await fileResponse.json();
            return new DumpFile(distributionMetaData, { id: file.data.id, type: file.data.type, ...file.data.attributes });
        } else {
            throw 'No dataset was found at the producing endpoint.';
        }
    } catch (e) {
        console.log(`Unable to retrieve dataset from ${SYNC_DATASET_ENDPOINT}`);
        throw e;
    }
}
