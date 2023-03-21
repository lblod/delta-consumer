import fs from 'fs-extra';
import { sparqlEscapeString, sparqlEscapeUri } from 'mu';
import path from 'path';
import {
  DELTA_FILE_FOLDER, DOWNLOAD_FILE_ENDPOINT, KEEP_DELTA_FILES, INGEST_DATABASE_ENDPOINT, INGEST_GRAPH
} from '../config';
import fetcher from './fetcher';
import {
  RDF_TYPE_URI, RDF_TYPE
} from './constants';
import { deltaContextConfiguration } from '../triples-dispatching';
import { Parser } from 'sparqljs';
import { querySudo } from '@lblod/mu-auth-sudo';



fs.ensureDirSync(DELTA_FILE_FOLDER);

const contextConfig = compileContextConfiguration(deltaContextConfiguration);

export default class DeltaFile {
  constructor(data) {
    /** Id of the delta file */
    this.id = data.id;
    /** Creation datetime of the delta file */
    this.created = data.attributes.created;
    /** Name of the delta file */
    this.name = data.attributes.name;
  }

  /**
   * Public endpoint to download the delta file from based on its id
   */
  get downloadUrl() {
    return DOWNLOAD_FILE_ENDPOINT.replace(':id', this.id);
  }

  /**
   * Location to store the delta file during processing
   */
  get filePath() {
    return path.join(DELTA_FILE_FOLDER, this.fileName);
  }

  get fileName() {
    return `${this.created}-${this.id}.json`;
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

  async load() {
    try {
      await this.download();
      const changeSets = await fs.readJson(this.filePath, { encoding: 'utf-8' });

      const termObjectChangeSets = [];
      for (let { inserts, deletes } of changeSets) {
        const changeSet = {};
        changeSet.deletes = toTermObjectArray(deletes);
        changeSet.inserts = toTermObjectArray(inserts);

        termObjectChangeSets.push(changeSet);
      }
      console.log(`Successfully loaded file ${this.id} stored at ${this.filePath}`);

      let termObjectChangeSetsWithContext = await addContext(termObjectChangeSets)

      if (!KEEP_DELTA_FILES) {
        await fs.unlink(this.filePath);
      } else {
        const folderByDay = new Intl.DateTimeFormat("en-CA", {
          year: "numeric",
          month: "2-digit",
          day: "2-digit",
        }).format(new Date(this.created));
        const directory = path.join(DELTA_FILE_FOLDER, folderByDay);
        await fs.ensureDir(directory);
        const pathExists = await fs.pathExists(path.join(directory, this.fileName));
        if (!pathExists) {
          await fs.move(this.filePath, path.join(directory, this.fileName));
        } else {
          await fs.remove(this.filePath);
        }
      }

      return { termObjectChangeSets, termObjectChangeSetsWithContext };
    }
    catch (error) {
      console.log(`Something went wrong while ingesting file ${this.id} stored at ${this.filePath}`);
      console.log(error);
      throw error;
    }
  }
}

/**
 * Transform an array of triples to a string of statements to use in a SPARQL query
 *
 * @param {Array} triples Array of triples to convert
 * @method toTermObjectArray
 * @private
 */
function toTermObjectArray(triples) {
  const escape = function (rdfTerm) {
    const { type, value, datatype, 'xml:lang': lang } = rdfTerm;
    if (type === 'uri') {
      return sparqlEscapeUri(value);
    } else if (type === 'literal' || type === 'typed-literal') {
      if (datatype)
        return `${sparqlEscapeString(value)}^^${sparqlEscapeUri(datatype)}`;
      else if (lang)
        return `${sparqlEscapeString(value)}@${lang}`;
      else
        return `${sparqlEscapeString(value)}`;
    } else
      console.log(`Don't know how to escape type ${type}. Will escape as a string.`);
    return sparqlEscapeString(value);
  };

  return triples.map(function (t) {
    return {
      graph: escape(t.graph),
      subject: escape(t.subject),
      predicate: escape(t.predicate),
      object: escape(t.object)
    };
  });
}

/**
 * Compile the context configuration to replace the prefixes with the base URIs
 * @param {Object} contextConfiguration
 * @method compileContextConfiguration
 * @return {Object} compiled context configuration
 * */
function compileContextConfiguration(contextConfiguration) {
  console.log("Compiling context configuration");

  const { PREFIXES, contextConfig } = contextConfiguration;
  const { addTypes, contextQueries } = contextConfig;

  if (!PREFIXES) {
    console.log("No PREFIXES defined in the context configuration.");
  }

  let compiledConfig = { addTypes: {}, contextQueries: [] };
  compiledConfig.addTypes.scope = addTypes.scope.toLowerCase() || "none";
  compiledConfig.addTypes.exhausitive = addTypes.exhausitive || false;

  if (!["inserts", "deletes", "all", "none"].includes(addTypes.scope)) {
    throw new Error(`Invalid addTypes scope: ${addTypes.scope}`);
  }

  const parser = new Parser();
  const prefixes = parser.parse(PREFIXES).prefixes;

  for (let cq of contextQueries) {
    for (let [key, value] of Object.entries(cq.trigger)) {
      let t = value;
      for (const [prefix, baseUri] of Object.entries(prefixes)) {
        let re = new RegExp(`^${prefix}:`)
        t = t.replace(re, baseUri)
      }
      compiledConfig.contextQueries.push({
        trigger: {
          key: sparqlEscapeUri(t)
        },
        queryTemplate: cq.queryTemplate
      });
    }
  }
  // console.log(`compiled config:\n${JSON.stringify(compiledConfig, null, 2)}`)
  // console.log(`compiled config:\n${compiledConfig.contextQueries[0].queryTemplate('')}`)


  return compiledConfig;
    }
  )
  return changeSetsWithTypes;
}



/**
 *
 * @param {*} changeSets deltas
 * @param {*} config :true if all types should be found for subjects, false if types should only be looked up for subjects without a type
 * @returns
 *
 * None exhaustive type check:
 * 1. Find all subjects in the statements
 * 2. Find whether subject has a type within the statements
 * 3. If not, check other insert/delete statements for the type
 * 4. If not, query the triplestore to find the type(s) of the subject
 *
 * Exhaustive type check:
 * 1. query the triplestore for the type(s) of the subject
 */
async function addTypes(changeSets) {
  const { contextQueries, addTypes } = contextConfig;
  const { scope, exhaustive } = addTypes;

  let typeCache = new Map();

  if (exhaustive) {
    for (const changeSet of changeSets) {
      let { deletes, inserts } = changeSet;
      inserts = await exhaustiveAddTypes(inserts, typeCache);
      deletes = await exhaustiveAddTypes(deletes, typeCache);
    }

  } else {
    // find all types in the inserts
    const subjectTypes = changeSets.map(
      changeSet => changeSet.inserts
    ).flat(1).filter(
      c => c.predicate === RDF_TYPE_URI
    ).forEach(
      c => typeCache.set(c.subject, c)
    );

    for (let changeSet of changeSets) {
      let { deletes, inserts } = changeSet;
      // find subjects in the inserts
      inserts = nonExhaustiveAddTypes(inserts, typeCache);
      // find subjects in the deletes
      deletes = nonExhaustiveAddTypes(deletes, typeCache);
    }
  }
  return changeSets;
}

async function exhaustiveAddTypes(statements, typeCache) {
  let subjects = [...new Set([...statements.map((statement) => statement.subject)])];

  for (const subject of subjects) {
    // query the triplestore for the type and add it to the cache
    typeCache.set(subject, ... await findSubjectTypes(subject));
    statements.push(typeCache.get(subject));
  }
  return statements;
}

async function nonExhaustiveAddTypes(statements, typeCache) {
  let subjects = [...new Set([...statements.map((statement) => statement.subject)])];

  for (const subject of subjects) {
    if (!statements.find(c => c.subject === subject && c.predicate === RDF_TYPE_URI)) {
      // subject does not have a type
      // check if the type is in the typeCache
      if (typeCache.has(subject)) {
        statements.push(typeCache.get(subject))
      } else {
        // query the triplestore for the type and add it to the cache
        typeCache.set(subject, ... await findSubjectTypes(subject));
        statements.push(typeCache.get(subject));
      }
    }
  };
  return statements;
}



// QUERYING THE TRIPLESTORE
const subjectTypeQuery = (graph, subject) => `
SELECT DISTINCT ?subject ?type
FROM <${graph}>
WHERE {
  VALUES ?subject {
    ${subject}
  }
  ?subject a ?type
}`

async function findSubjectTypes(subject) {
  try {
    const response = await querySudo(subjectTypeQuery(INGEST_GRAPH, subject), {}, INGEST_DATABASE_ENDPOINT);
    console.log(`type query response: ${JSON.stringify(response)}`);

    if (response.results.bindings.length) {
      return response.results.bindings.map(
        r => ({
          'graph': sparqlEscapeUri(INGEST_GRAPH),
          'subject': sparqlEscapeUri(r.subject.value),
          'predicate': sparqlEscapeUri(RDF_TYPE),
          'object': sparqlEscapeUri(r.type.value)
        })
      );
    } else {
      return [];
    }
  } catch (err) {
    throw new Error(`Error while querying for types: ${err} `);
  }
}

async function findContext(query) {
  try {
    const response = await querySudo(query, {}, INGEST_DATABASE_ENDPOINT);
    console.log(`context query response: ${JSON.stringify(response)}`);

    return toTermObjectArray(response.results.bindings.map(
      ({ s, p, o }) => ({
        'graph': {
          'value': INGEST_GRAPH,
          'type': 'uri'
        },
        'subject': s,
        'predicate': p,
        'object': o
      })
    ));
  } catch (err) {
    throw new Error(`Error while executing construct query for additional context: ${err} `);
  }
}
