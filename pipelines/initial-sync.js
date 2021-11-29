import {
    BATCH_SIZE, BYPASS_MU_AUTH_FOR_EXPENSIVE_QUERIES,
    DIRECT_DATABASE_ENDPOINT, DISABLE_INITIAL_SYNC, INGEST_GRAPH, INITIAL_SYNC_JOB_OPERATION,
    JOBS_GRAPH, JOB_CREATOR_URI, MAX_DB_RETRY_ATTEMPTS, MU_CALL_SCOPE_ID_INITIAL_SYNC, SERVICE_NAME, SLEEP_BETWEEN_BATCHES,
    SLEEP_TIME_AFTER_FAILED_DB_OPERATION
} from '../config';
import { INITIAL_SYNC_TASK_OPERATION, STATUS_BUSY, STATUS_FAILED, STATUS_SCHEDULED, STATUS_SUCCESS } from '../lib/constants';
import { createDeltaSyncTask } from '../lib/delta-sync-task';
import { getLatestDumpFile } from '../lib/dump-file';
import { createError, createJobError } from '../lib/error';
import { createJob, getLatestJobForOperation } from '../lib/job';
import { createTask } from '../lib/task';
import { batchedDbUpdate, updateStatus } from '../lib/utils';
import { initialSyncDispatching } from '../triples-dispatching';
import  * as mu from 'mu';
import  * as muAuthSudo from '@lblod/mu-auth-sudo';

export async function startInitialSync() {
  try {
    console.info(`DISABLE_INITIAL_SYNC: ${DISABLE_INITIAL_SYNC}`);
    if(!DISABLE_INITIAL_SYNC) {
      const initialSyncJob = await getLatestJobForOperation(INITIAL_SYNC_JOB_OPERATION, JOB_CREATOR_URI);
      // In following case we can safely (re)schedule an initial sync
      if (!initialSyncJob || initialSyncJob.status == STATUS_FAILED) {
        console.log(`No initial sync has run yet, or previous failed (see: ${initialSyncJob ? initialSyncJob.job : 'N/A'})`);
        console.log(`(Re)starting initial sync`);

        const job = await runInitialSync();

        console.log(`Initial sync ${job} has been successfully run`);
      } else if (initialSyncJob.status !== STATUS_SUCCESS){
        throw `Unexpected status for ${initialSyncJob.job}: ${initialSyncJob.status}. Check in the database what went wrong`;
      } else {
        console.log(`Initial sync <${initialSyncJob.job}> has already run.`);
      }
    } else {
      console.warn('Initial sync disabled');
    }
  }
  catch(e) {
    console.log(e);
    await createError(JOBS_GRAPH, SERVICE_NAME, `Unexpected error while running initial sync: ${e}`);
  }
}

async function runInitialSync() {
  let job;
  let task;

  try {

    // Note: they get status busy
    job = await createJob(JOBS_GRAPH, INITIAL_SYNC_JOB_OPERATION, JOB_CREATOR_URI, STATUS_BUSY);
    task = await createTask(JOBS_GRAPH, job,"0", INITIAL_SYNC_TASK_OPERATION, STATUS_SCHEDULED);

    const dumpFile = await getLatestDumpFile();
    if (dumpFile) {

      await updateStatus(task, STATUS_BUSY);
      const termObjects = await dumpFile.load();

      await initialSyncDispatching.dispatch({ mu, muAuthSudo }, { termObjects });

      await updateStatus(task, STATUS_SUCCESS);
    }
    else {
      console.log(`No dump file to consume. Is the producing stack ready?`);
      throw new Error('No dump file found.');
    }

    //Some glue to coordinate the nex sync-task. It needs to know from where it needs to start syncing
    const dummySyncTask = await createDeltaSyncTask(JOBS_GRAPH, job, `1`, STATUS_SCHEDULED, dumpFile);
    await updateStatus(dummySyncTask, STATUS_SUCCESS); //TODO: remove this '2-phase-commit'.

    await updateStatus(job, STATUS_SUCCESS);

    return job;
  }
  catch(e) {
    console.log(`Something went wrong while doing the initial sync. Closing task with failure state.`);
    console.trace(e);
    if(task)
      await updateStatus(task, STATUS_FAILED);
    if(job){
      await createJobError(JOBS_GRAPH, job, e);
      await updateStatus(job, STATUS_FAILED);
    }
    throw e;
  }
}
