import * as muAuthSudo from '@lblod/mu-auth-sudo';
import * as mu from 'mu';
import fetcher from '../lib/fetcher';

import {
    DELTA_SYNC_JOB_OPERATION, DISABLE_DELTA_INGEST, INITIAL_SYNC_JOB_OPERATION,
    JOBS_GRAPH, JOB_CREATOR_URI, SERVICE_NAME, SYNC_FILES_ENDPOINT, WAIT_FOR_INITIAL_SYNC
} from '../cfg';
import { STATUS_BUSY, STATUS_FAILED, STATUS_SUCCESS } from '../lib/constants';
import DeltaFile from '../lib/delta-file';
import { getNextDeltaTimestamp } from "../lib/delta-sync-job";
import { createDeltaSyncTask } from '../lib/delta-sync-task';
import { createError, createJobError } from '../lib/error';
import { createJob, failJob, getJobs, getLatestJobForOperation } from '../lib/job';
import { updateStatus } from '../lib/utils';
import { deltaSyncDispatching } from '../triples-dispatching';

/**
 * Runs the delta sync one time.
 */
export async function deltaSync() {
  try {
    if (await canStartDeltaSync()) {
      console.log('Proceeding in Normal operation mode: ingest deltas');
      await runDeltaSync();
    }
  }
  catch(e) {
    console.log(e);
    await createError(JOBS_GRAPH, SERVICE_NAME, `Unexpected error while running normal sync task: ${e}`);
  }
}

/**
 * Determines if we can start a delta sync.
 *
 * Verifies delta syncs are enabled and whether an initial sync has been completed sucessfully when requested.
 *
 * @return {Promise<boolean>} truethy if we can start the delta sync.
 */
async function canStartDeltaSync() {
  if (DISABLE_DELTA_INGEST) {
    console.warn('Automated delta ingest disabled');
    return false;
  } else {
    let previousInitialSyncJob;

    if (WAIT_FOR_INITIAL_SYNC) {
      previousInitialSyncJob = await getLatestJobForOperation(INITIAL_SYNC_JOB_OPERATION, JOB_CREATOR_URI);

      if (previousInitialSyncJob?.status != STATUS_SUCCESS) {
        console.log('No successful initial sync job found. Not scheduling delta ingestion.');
        return false;
      }
    }
  }

  return true;
}

/**
 * Executes a single delta sync run, assuming all lights are green.
 *
 * Requests all changes from the producer and executes them.  If some
 * file could not be processed, the following files are not processed
 * either and this call yields a failed job in the triplestore.  Code
 * higher up the tree will download the files again in another cycle.
 * Data regarding the current run (a Job) and the files it has processed
 * (a Task) is written to the triplestore.
 */
async function runDeltaSync() {
  let job;

  try {
    const nextDeltaTimestamp = await getNextDeltaTimestamp();
    const sortedDeltaFiles = await fetchSortedUnconsumedFiles(nextDeltaTimestamp);

    if(sortedDeltaFiles.length) {
      job = await createJob(JOBS_GRAPH, DELTA_SYNC_JOB_OPERATION, JOB_CREATOR_URI, STATUS_BUSY);

      let parentTask;
      for(const [ index, deltaFile ] of sortedDeltaFiles.entries()) {
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
      console.log(`No new deltas published since ${nextDeltaTimestamp}: nothing to do.`);
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

/**
 * Requests all available files from the producer endpoint since supplied timestamp.
 *
 * @param {Date} since Date from when we want to fetch the changes
 * (likely last previous timestamp).
 */
async function fetchSortedUnconsumedFiles(since) {
  try {
    const response = await fetcher(
      `${SYNC_FILES_ENDPOINT}?since=${since.toISOString()}`,
      { headers: { Accept: 'application/vnd.api+json' } }
    );

    if( !response.ok )
      throw new Error("Backend did not respond with good status code");

    const json = await response.json();
    // TODO: Do we have to sort the files received from the producer or
    // may we assume the producer provides them in an optimal order?
    return json.data
      .map(f => new DeltaFile(f))
      .sort(f => f.created);
  } catch (e) {
    console.log(`Unable to retrieve unconsumed files from ${SYNC_FILES_ENDPOINT}`);
    throw e;
  }
}
