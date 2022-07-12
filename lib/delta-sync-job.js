import { querySudo as query } from '@lblod/mu-auth-sudo';
import { sparqlEscapeUri } from 'mu';
import { INITIAL_SYNC_JOB_OPERATION, JOB_CREATOR_URI, START_FROM_DELTA_TIMESTAMP, DELTA_SYNC_JOB_OPERATION } from '../cfg';
import { CONTAINER_TYPE, DELTA_SYNC_TASK_OPERATION, JOB_TYPE, PREFIXES, STATUS_SUCCESS, TASK_TYPE } from './constants';
import { parseResult } from './utils';

/**
 * Yields the delta timestamp that should be used for the next cycle.
 *
 * @return {Promise<Date>} The delta timestamp used for the cycle.
 */
export async function getNextDeltaTimestamp() {
  return (await getTimestampFromJob())
    || getTimestampFromConfig()
    || (() => {
      throw 'No previous delta file found and no START_FROM_DELTA_TIMESTAMP provided, unable to set a starting date for the ingestion.';
    })();
}

/**
 * Retrieves the timestamp that belonged to the last successful fetches.
 * This could be from an initial sync or from a delta.
 */
async function getTimestampFromJob() {
  // TODO: Does the initial job sync also use tasks?  If not, then this
  // code may miss the timestamp of the initial sync.

  const queryStr = `
    ${PREFIXES}
    SELECT DISTINCT ?deltaTimestamp WHERE {
      ?job a ${sparqlEscapeUri(JOB_TYPE)} ;
        task:operation ?operation;
        dct:creator ${sparqlEscapeUri(JOB_CREATOR_URI)}.

      ?task a ${sparqlEscapeUri(TASK_TYPE)};
        dct:isPartOf ?job;
        adms:status ${sparqlEscapeUri(STATUS_SUCCESS)};
        dct:modified ?modified;
        task:operation ${sparqlEscapeUri(DELTA_SYNC_TASK_OPERATION)} ;
        task:resultsContainer ?resultsContainer.

      ?resultsContainer a ${sparqlEscapeUri(CONTAINER_TYPE)};
        dct:subject <http://redpencil.data.gift/id/concept/DeltaSync/DeltafileInfo>;
        ext:hasDeltafileTimestamp ?deltaTimestamp.

       VALUES ?operation {
         ${INITIAL_SYNC_JOB_OPERATION ? sparqlEscapeUri(INITIAL_SYNC_JOB_OPERATION) : ''}
         ${sparqlEscapeUri(DELTA_SYNC_JOB_OPERATION)}
       }
    }
    ORDER BY DESC(?deltaTimestamp)
    LIMIT 1
  `;
  return parseResult(await query(queryStr))[0]["deltaTimestamp"];
}

function getTimestampFromConfig() {
  if (START_FROM_DELTA_TIMESTAMP) {
    console.log(`Service is configured to start consuming delta's since ${START_FROM_DELTA_TIMESTAMP}`);
    return new Date(Date.parse(START_FROM_DELTA_TIMESTAMP));
  }
  else return null;
}
