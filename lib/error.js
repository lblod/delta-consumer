import { updateSudo as update } from './sparql';
import { sparqlEscapeString, sparqlEscapeUri, uuid, sparqlEscapeDateTime } from 'mu';
import { DELTA_ERROR_TYPE, ERROR_TYPE, ERROR_URI_PREFIX, PREFIXES } from './constants';
import { JOB_CREATOR_URI, SERVICE_NAME } from '../config';

// Best-effort: this write can hit the same broken database as the error being
// reported, so log instead of throw; the console always holds the error.
async function persistError(queryError) {
  try {
    await update(queryError);
  } catch (e) {
    console.error(`Could not persist the error above to the jobs graph, it is only visible in this log. Reason: ${e}`);
  }
}

export async function insertError(jobsGraph, errorMsg, job = null) {
  const id = uuid();
  const uri = ERROR_URI_PREFIX + id;

  console.error(`[${SERVICE_NAME}]${job ? ` Error for job <${job}>:` : ''}`, errorMsg);

  const queryError = `
    ${PREFIXES}

    INSERT DATA {
      GRAPH ${sparqlEscapeUri(jobsGraph)} {
        ${sparqlEscapeUri(uri)}
          a ${sparqlEscapeUri(ERROR_TYPE)}, ${sparqlEscapeUri(DELTA_ERROR_TYPE)} ;
          mu:uuid ${sparqlEscapeString(id)} ;
          dct:subject ${sparqlEscapeString(`Error in consumer ${SERVICE_NAME}`)} ;
          oslc:message ${sparqlEscapeString(`[${SERVICE_NAME}] ${errorMsg}`)} ;
          dct:created ${sparqlEscapeDateTime(new Date().toISOString())} ;
          dct:creator ${sparqlEscapeUri(JOB_CREATOR_URI)} .

        ${job ? `${sparqlEscapeUri(job)} task:error ${sparqlEscapeUri(uri)} .` : ''}
      }
    }
  `;
  await persistError(queryError);
}
