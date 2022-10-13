import { querySudo as query } from '@lblod/mu-auth-sudo';
import { sparqlEscapeUri } from 'mu';
import { INITIAL_SYNC_JOB_OPERATION, JOB_CREATOR_URI, START_FROM_DELTA_TIMESTAMP, DELTA_SYNC_JOB_OPERATION } from '../cfg';
import { CONTAINER_TYPE, DELTA_SYNC_TASK_OPERATION, JOB_TYPE, PREFIXES, STATUS_SUCCESS, TASK_TYPE } from './constants';
import { parseResult } from './utils';


export async function calculateLatestDeltaTimestamp() {
  const timeStampFromConfig = loadTimestampFromConfig();
  let { deltaTimestamp } = await loadTimestampFromJob();

  if(deltaTimestamp && timeStampFromConfig && timeStampFromConfig > deltaTimestamp ) {
    console.log(`
      The timestamp provided by the config (${timeStampFromConfig})
        is more recent than the one found in the DB (${deltaTimestamp}).
      We start from the provided timestamp in the config.`);
    return timeStampFromConfig;
  }
  else if(deltaTimestamp) {
    return deltaTimestamp;
  }
  else {
    const now = new Date();
    console.log(`No previous timestamp found, starting from ${now}`);
    return now;
  }
}

async function loadTimestampFromJob(){
  const queryStr = `
    ${PREFIXES}
    SELECT DISTINCT ?deltaTimestamp WHERE {
      ?job a ${sparqlEscapeUri(JOB_TYPE)} ;
        task:operation ?operation;
        dct:creator ${sparqlEscapeUri(JOB_CREATOR_URI)}.

      ?task a ${ sparqlEscapeUri(TASK_TYPE) };
        dct:isPartOf ?job;
        adms:status ${sparqlEscapeUri(STATUS_SUCCESS)};
        dct:modified ?modified;
        task:operation ${sparqlEscapeUri(DELTA_SYNC_TASK_OPERATION)} ;
        task:resultsContainer ?resultsContainer.

      ?resultsContainer a ${sparqlEscapeUri(CONTAINER_TYPE)};
        dct:subject <http://redpencil.data.gift/id/concept/DeltaSync/DeltafileInfo>;
        ext:hasDeltafileTimestamp ?deltaTimestamp.

       VALUES ?operation {
         ${INITIAL_SYNC_JOB_OPERATION ? sparqlEscapeUri(INITIAL_SYNC_JOB_OPERATION): ''}
         ${sparqlEscapeUri(DELTA_SYNC_JOB_OPERATION)}
       }
    }
    ORDER BY DESC(?deltaTimestamp)
    LIMIT 1
  `;
  return parseResult(await query(queryStr))[0];
}

function loadTimestampFromConfig(){
  console.log(`It seems to be the first time we will consume delta's. No delta's have been consumed before.`);
  if (START_FROM_DELTA_TIMESTAMP) {
    console.log(`Service is configured to start consuming delta's since ${START_FROM_DELTA_TIMESTAMP}`);
    return new Date(Date.parse(START_FROM_DELTA_TIMESTAMP));
  }
  else return null;
}
