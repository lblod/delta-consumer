import { updateSudo as update } from './sparql';
import { sparqlEscapeString, sparqlEscapeUri, uuid } from 'mu';
import { DELTA_ERROR_TYPE, ERROR_TYPE, ERROR_URI_PREFIX, PREFIXES } from './constants';

// Best-effort: this write can hit the same broken database as the error being
// reported, so log instead of throw; the console always holds the error.
async function persistError(queryError) {
  try {
    await update(queryError);
  } catch (e) {
    console.error(`Could not persist the error above to the jobs graph, it is only visible in this log. Reason: ${e}`);
  }
}

export async function createJobError(jobsGraph, subject, errorMsg) {
  const id = uuid();
  const uri = ERROR_URI_PREFIX + id;

  console.error(`Error for ${subject}:`, errorMsg);

  const queryError = `
    ${PREFIXES}
    INSERT DATA {
      GRAPH ${sparqlEscapeUri(jobsGraph)} {
        ${sparqlEscapeUri(uri)}
          a ${sparqlEscapeUri(ERROR_TYPE)}, ${sparqlEscapeUri(DELTA_ERROR_TYPE)} ;
          mu:uuid ${sparqlEscapeString(id)} ;
          oslc:message ${sparqlEscapeString(`${errorMsg}`)} .
        ${sparqlEscapeUri(subject)} task:error ${sparqlEscapeUri(uri)} .
      }
    }
  `;
  await persistError(queryError);
}

export async function createError(jobsGraph, serviceName, errorMsg) {
  const id = uuid();
  const uri = ERROR_URI_PREFIX + id;
  const timestamp = new Date().toISOString();

  console.error(`[${serviceName}] ${timestamp} - ${errorMsg}`);

  const queryError = `
    PREFIX mu: <http://mu.semte.ch/vocabularies/core/>
    PREFIX oslc: <http://open-services.net/ns/core#>

    INSERT DATA {
      GRAPH ${sparqlEscapeUri(jobsGraph)} {
        ${sparqlEscapeUri(uri)} a ${sparqlEscapeUri(ERROR_TYPE)}, ${sparqlEscapeUri(DELTA_ERROR_TYPE)} ;
          mu:uuid ${sparqlEscapeString(id)} ;
          oslc:message ${sparqlEscapeString(`[${serviceName}] ${timestamp} - ${errorMsg}`)} .
      }
    }
  `;

  await persistError(queryError);
}
