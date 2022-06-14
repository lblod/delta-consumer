import fetcher from '../lib/fetcher';
import transform from '../config/transform';
import dispatch from '../config/dispatch';

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

      let previousTask;
      for(const [ index, deltaFile ] of sortedDeltaFiles.entries()) {
        console.log(`Ingesting deltafile created on ${deltaFile.created}`);

        const task = await createDeltaSyncTask(JOBS_GRAPH, job, `${index}`, STATUS_BUSY, deltaFile, previousTask);
        previousTask = task;

        try {
          // TODO: Code that lives here should cope with:
          // - changing the changesets,
          // - storing them on disk,
          // - allowing for full async responsibility by the consumer
          const changesets = (await deltaFile.download())
            .map((d) => {
              d.inserts = d.inserts.map(transform);
              d.deletes = d.deletes.map(transform);
              return d;
            });

          // TODO: The task may be an interesting thing to change the
          // status of by one of the processors by changeset.  If/when
          // that is the case, we should be able to process content.

          // * How to specify where data flows to:
          //   - manually :: you get triples, you store them.  you'll deal with downloading files.
          //   - move triples to right graphs :: enrich received triples with
          //     graphs, we'll save them
          //   - description based on classes properties and inverse properties :: roughly
          //     what mu-authorization understands but with smarter caching.  FUTURE WORK
          //   - all data goes to one graph
          // * What about file downloads?
          //   - We can optionally take care of them
          //   - We offer some helpers to download them
          await dispatch(changesets);

          await updateStatus(task, STATUS_SUCCESS);
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
