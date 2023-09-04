import { querySudo as query, updateSudo as update } from '@lblod/mu-auth-sudo';
import { sparqlEscapeDateTime, sparqlEscapeUri, sparqlEscapeString } from 'mu';
import { PREFIXES } from './constants';
import DeltaFile from "./delta-file";

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
    const { type, value, datatype, 'xml:lang': lang } = rdfTerm;
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
    new DeltaFile({id, attributes: { created, name }})
  );
}
