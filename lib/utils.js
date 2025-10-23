import { querySudo as query, updateSudo as update } from '@lblod/mu-auth-sudo';
import { sparqlEscapeDateTime, sparqlEscapeUri, sparqlEscapeString } from 'mu';
import { PREFIXES } from './constants';
import DeltaFile from "./delta-file";
import { Transform } from 'stream';
import { pipeline } from 'stream/promises';
import {createWriteStream} from 'fs';
import fetcher from './fetcher';
export const HTTP_MAX_QUERY_SIZE_BYTES = parseInt(process.env.HTTP_MAX_QUERY_SIZE_BYTES || '60000'); // 60kb by default


export function chunk(array, chunkSize) {
    return array.reduce((resultArray, item, index) => {
        const chunkIndex = Math.floor(index / chunkSize);

        if (!resultArray[chunkIndex]) {
            resultArray[chunkIndex] = []; // start a new chunk
        }

        resultArray[chunkIndex].push(item);

        return resultArray;
    }, []);
}

export async function updateStatus(subject, status) {
  const modified = new Date();
  const q = `
    ${PREFIXES}

    DELETE {
      GRAPH ?g {
        ?subject adms:status ?status;
          dct:modified ?modified .
      }
    }
    INSERT {
      GRAPH ?g {
        ?subject adms:status ${sparqlEscapeUri(status)};
          dct:modified ${sparqlEscapeDateTime(modified)}.
      }
    }
    WHERE {
      BIND(${sparqlEscapeUri(subject)} as ?subject)
      GRAPH ?g {
        ?subject adms:status ?status .
        OPTIONAL { ?subject dct:modified ?modified . }
      }
    }
  `;
  await update(q);
}

/**
 * convert results of select query to an array of objects.
 * courtesy: Niels Vandekeybus & Felix
 * @method parseResult
 * @return {Array}
 */
export function parseResult(result) {
  if (!(result.results && result.results.bindings.length)) return [];

  const bindingKeys = result.head.vars;
  return result.results.bindings.map((row) => {
    const obj = {};
    bindingKeys.forEach((key) => {
      if (row[key] && row[key].datatype == 'http://www.w3.org/2001/XMLSchema#integer' && row[key].value) {
        obj[key] = parseInt(row[key].value);
      }
      else if (row[key] && row[key].datatype == 'http://www.w3.org/2001/XMLSchema#dateTime' && row[key].value) {
        obj[key] = new Date(row[key].value);
      }
      else obj[key] = row[key] ? row[key].value : undefined;
    });
    return obj;
  });
};


/**
 * Transform an array of triples to a string of statements to use in a SPARQL query
 *
 * @param {Array} triples Array of triples to convert
 * @method toTermObjectArray
 * @private
 */
export function toTermObjectArray(triples) {
  const escape = function (rdfTerm) {
    const { type, value, datatype } = rdfTerm;
    // Might not be ideal: two ways of anotating language
    //   xml:lang  conforms to https://www.w3.org/TR/sparql11-results-json/
    //   lang      conforms to https://www.w3.org/TR/rdf-json/
    // We look for both to capture all intentions.
    const lang = rdfTerm['xml:lang'] || rdfTerm?.lang;
    if (type === 'uri') {
      return sparqlEscapeUri(value);
    } else if (type === 'literal' || type === 'typed-literal') {
      if (datatype)
        return `${sparqlEscapeString(value.toString())}^^${sparqlEscapeUri(datatype)}`;
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

export async function deleteDeltaFilesForJob( job ) {
  for(const taskUri of job.tasks) {
    const deltaFiles = await getDeltaFilesForTask(taskUri);
    await Promise.all(deltaFiles.map(f => f.removeFile()));
  }
}

async function getDeltaFilesForTask( taskUri ) {
  const result = await query(`
  ${PREFIXES}
  SELECT DISTINCT ?id ?created ?name WHERE {
    ?container a nfo:DataContainer;
      mu:uuid ?uuid;
      dct:subject <http://redpencil.data.gift/id/concept/DeltaSync/DeltafileInfo>;
      ext:hasDeltafileId ?id;
      ext:hasDeltafileName ?name;
      ext:hasDeltafileTimestamp ?created.

    ${sparqlEscapeUri(taskUri)} task:resultsContainer ?container.
  }`);

  const parsedResults = parseResult(result);
  return parsedResults.map(
    ({ id, name, created }) =>
    new DeltaFile({id, attributes: { created: created.toISOString(), name }})
  );
}


 const COMMON_PREFIXES = [
  ["s0:", "http://www.w3.org/1999/02/22-rdf-syntax-ns#"],
  ["s1:", "http://www.w3.org/ns/org#"],
  ["s2:", "http://www.w3.org/2000/01/rdf-schema#"],
  ["s3:", "http://www.w3.org/2001/XMLSchema#"],
  ["s4:", "http://xmlns.com/foaf/0.1/"],
  ["s5:", "http://purl.org/dc/elements/1.1/"],
  ["s6:", "http://purl.org/dc/terms/"],
  ["s7:", "http://www.w3.org/2004/02/skos/core#"],
  ["s8:", "http://www.w3.org/ns/prov#"],
  ["s9:", "http://schema.org/"],
  ["q0:", "http://www.w3.org/ns/dcat#"],
  ["q1:", "http://www.w3.org/ns/adms#"],
  ["q2:", "http://mu.semte.ch/vocabularies/core/"],
  ["q3:", "http://data.vlaanderen.be/ns/besluit#"],
  ["q4:", "http://data.vlaanderen.be/ns/mandaat#"],
  ["q5:", "http://data.europa.eu/eli/ontology#"],
  ["q6:", "http://publications.europa.eu/ontology/euvoc#"],
  ["q7:", "https://data.vlaanderen.be/ns/mobiliteit#"],
  ["q8:", "http://w3id.org/ldes#"],
];

/**
 * this replace absolute uris with prefix. It makes the query more compact
 * and should in theory speed up insertions as our requests are lighter
 * @param {*} statements array of {subject, predicate, object}
 * @returns 
 */
export function prepareStatements(statements) {
  let newStmts = statements.map(stmt => {
    if (stmt.predicate.replace(/^<|>$/g, '') === "http://www.w3.org/1999/02/22-rdf-syntax-ns#type") {
      stmt.predicate = 'a';
    }
    return stmt;
  });
  const usablePrefixes = COMMON_PREFIXES.filter(([_, uri]) => statements.some(({ subject, predicate, object }) => subject.includes(uri) || predicate.includes(uri) || (!object.startsWith('"') && object.includes(uri))));
  usablePrefixes.forEach(([prefix, uri]) => {
    const regex = new RegExp(`<${uri}([^>#][^>]*)>|${uri}([^\\s>#][^\\s>]*)`, "g");
    newStmts = newStmts.map(({ subject, predicate, object }) => {
      return {
        subject: subject.replace(regex, `${prefix}$1$2`),
        predicate: predicate.replace(regex, `${prefix}$1$2`),
        object: object.startsWith('"') ? object : object.replace(regex, `${prefix}$1$2`)
      }
    });
  });
  return { usedPrefixes: usablePrefixes.map(([prefix, uri]) => `PREFIX ${prefix} <${uri}>`).join('\n'), newStmts };
}

async function retryWithSmallerBatch(statements, retryFn) {
  let smallerBatch = Math.floor(statements.length / 2);
  if (smallerBatch === 0) {
    console.log("the triples that fails: ", statements);
    throw new Error(`we can't work with chunks the size of ${smallerBatch}`);
  }
  console.log(`Let's try to ingest with chunk size of ${smallerBatch}`);
  const chunkedStmts = chunk(statements, smallerBatch);
  while(chunkedStmts.length) {
    await retryFn(chunkedStmts.pop());
  }
}
export async function updateWithRecover(statements, transformStatementsIntoQueryFn, sparqlEndpoint, extraHeaders = {}) {
  try {
    const q = transformStatementsIntoQueryFn(statements);
    // optimization: check size of the query in bytes, if greater than HTTP_MAX_QUERY_SIZE_BYTES
    // we split the query. This reduces number of failed queries & retry attempts,
    //  as its more reliable than an arbitrary batch size
    if (statements.length > 1 && new Blob([q]).size > HTTP_MAX_QUERY_SIZE_BYTES) {
      await retryWithSmallerBatch(statements, async (stmts) => await updateWithRecover(stmts, transformStatementsIntoQueryFn, sparqlEndpoint, extraHeaders));
      return;
    }
    await update(q, extraHeaders, { sparqlEndpoint, mayRetry: true });
  } catch (err) {
    // recovery.
    console.log("ERROR: ", err);
    console.log(`Inserting the chunk failed for chunk size ${statements.length} triples`);
    await retryWithSmallerBatch(statements, async (stmts) => await updateWithRecover(stmts, transformStatementsIntoQueryFn, sparqlEndpoint, extraHeaders));

  }
}

export async function downloadFile(url, filePath) {
  const res = await fetcher(url, { headers: { 'Accept-encoding': 'gzip,deflate' } });
  let downloaded = 0;
  const startTime = Date.now();
  const progressStream = new Transform({
    transform(chunk, _, callback) {
      downloaded += chunk.length;
      const elapsedSec = (Date.now() - startTime) / 1000;
      const mb = downloaded / 1024 / 1024;
      const mbPerSec = mb / elapsedSec;
      console.log(`Downloaded ${mb.toFixed(2)}mb at an avg speed of ${mbPerSec.toFixed(2)} mb/s`);
      this.push(chunk);
      callback();
    }
  });
  const fileStream = createWriteStream(filePath);
  await pipeline(res.body, progressStream, fileStream);
}

export async function insertIntoGraph(statements, dbEndpoint, graph, extraHeaders = {}) {
    console.log(`Inserting ${statements.length} statements into target graph`);
    await updateWithRecover(
        statements,
        insertQueryTemplate(graph),
        dbEndpoint, 
        extraHeaders
    );
}
export async function deleteFromGraph(statements, dbEndpoint, graph, extraHeaders) {
    console.log(`Deleting ${statements.length} statements from target graph`);
    await updateWithRecover(
        statements,
        deleteQueryTemplate(graph),
        dbEndpoint,
        extraHeaders
    );
}

const deleteQueryTemplate = (graph) => (statements) => {
    let { usedPrefixes, newStmts } = prepareStatements(statements);
    return `
  ${usedPrefixes}
  DELETE DATA {
    GRAPH <${graph}> {
      ${statementsToNTriples(newStmts)}
    }
  }`;
};
const insertQueryTemplate = (graph) => (statements) => {
    let { usedPrefixes, newStmts } = prepareStatements(statements);
    return `
  ${usedPrefixes}
  INSERT DATA {
    GRAPH <${graph}> {
      ${statementsToNTriples(newStmts)}
    }
  }`;
};

function statementsToNTriples(statements) {
    return [...new Set(statements)]
        .map(
            ({ subject, predicate, object }) =>
                `${subject} ${predicate} ${object}.`
        )
        .join(''); // probably no need to join with a \n as triples are delimitted by a dot
}
