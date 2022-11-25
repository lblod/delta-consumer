import * as muAuthSudo from '@lblod/mu-auth-sudo';
import * as mu from 'mu';
import fetcher from '../lib/fetcher';

import {
    DELTA_SYNC_JOB_OPERATION, DISABLE_DELTA_INGEST, INITIAL_SYNC_JOB_OPERATION,
    JOBS_GRAPH, JOB_CREATOR_URI, SERVICE_NAME, SYNC_FILES_ENDPOINT, WAIT_FOR_INITIAL_SYNC
} from '../cfg';
import { STATUS_BUSY, STATUS_FAILED, STATUS_SUCCESS } from '../lib/constants';
import DeltaFile from '../lib/delta-file';
import { calculateLatestDeltaTimestamp } from '../lib/delta-sync-job';
import { createDeltaSyncTask } from '../lib/delta-sync-task';
import { createError, createJobError } from '../lib/error';
import { createJob, failJob, getJobs, getLatestJobForOperation } from '../lib/job';
import { updateStatus } from '../lib/utils';
import { deltaSyncDispatching } from '../triples-dispatching';

export async function startDeltaSync() {
  try {
    console.info(`DISABLE_DELTA_INGEST: ${DISABLE_DELTA_INGEST}`);
    if (DISABLE_DELTA_INGEST) {
      console.warn('Automated delta ingest disabled');
    }
    else {
      console.log(`Status of WAIT_FOR_INITIAL_SYNC is: ${WAIT_FOR_INITIAL_SYNC}`);
      let previousInitialSyncJob;

      if (WAIT_FOR_INITIAL_SYNC){
        previousInitialSyncJob = await getLatestJobForOperation(INITIAL_SYNC_JOB_OPERATION, JOB_CREATOR_URI);
      }

      if (WAIT_FOR_INITIAL_SYNC && !(previousInitialSyncJob && previousInitialSyncJob.status == STATUS_SUCCESS)) {
        console.log('No successful initial sync job found. Not scheduling delta ingestion.');
      }
      else {
        console.log('Proceeding in Normal operation mode: ingest deltas');
        //Note: it is ok to fail these, because we assume it is running in a queue. So there is no way
        // a job in status busy was effectively doing something
        console.log(`Verify whether there are hanging jobs`);
        const jobs = await getJobs(DELTA_SYNC_JOB_OPERATION, [ STATUS_BUSY ]);
        console.log(`Found ${jobs.length} hanging jobs, failing them first`);
        for(const job of jobs){
          await failJob(job.job);
        }

        await runDeltaSync();
      }

    }
  }
  catch(e) {
    console.log(e);
    await createError(JOBS_GRAPH, SERVICE_NAME, `Unexpected error while running normal sync task: ${e}`);
  }
}

async function runDeltaSync() {
  let job;

  try {
    const latestDeltaTimestamp = await calculateLatestDeltaTimestamp();
    const sortedDeltafiles = await getSortedUnconsumedFiles(latestDeltaTimestamp);

    if(sortedDeltafiles.length) {
      job = await createJob(JOBS_GRAPH, DELTA_SYNC_JOB_OPERATION, JOB_CREATOR_URI, STATUS_BUSY);

      let parentTask;
      for(const [ index, deltaFile ] of sortedDeltafiles.entries()) {
        console.log(`Ingesting deltafile created on ${deltaFile.created}`);
        const task = await createDeltaSyncTask(JOBS_GRAPH, job, `${index}`, STATUS_BUSY, deltaFile, parentTask);
        try {
          const termObjectChangeSets = await deltaFile.load();
          await deltaSyncDispatching.dispatch({ mu, muAuthSudo }, { termObjectChangeSets });
          await updateStatus(task, STATUS_SUCCESS);
          parentTask = task;
          console.log(`Sucessfully ingested deltafile created on ${deltaFile.created}`);
        }
        catch(e){
          console.error(`Something went wrong while ingesting deltafile created on ${deltaFile.created}`);
          console.error(e);
          await updateStatus(task, STATUS_FAILED);
          throw e;
        }
      }

      await updateStatus(job, STATUS_SUCCESS);
    }
    else {
      console.log(`No new deltas published since ${latestDeltaTimestamp}: nothing to do.`);
    }
  }
  catch (error) {
    if(job){
      await createJobError(JOBS_GRAPH, job, error);
      await failJob(job);
    }
    else {
      await createError(JOBS_GRAPH, SERVICE_NAME, `Unexpected error while ingesting: ${error}`);
    }
  }
}

async function getSortedUnconsumedFiles(since) {
  try {
    const response = await fetcher(`${SYNC_FILES_ENDPOINT}?since=${since.toISOString()}`, {
      headers: {
        'Accept': 'application/vnd.api+json'
      }
    });
    const json = await response.json();
    return json.data.map(f => new DeltaFile(f)).sort(f => f.created);
  } catch (e) {
    console.log(`Unable to retrieve unconsumed files from ${SYNC_FILES_ENDPOINT}`);
    throw e;
  }
}
