import { STATUS_BUSY, STATUS_FAILED, STATUS_SUCCESS,  } from '../lib/constants';
import { DELTA_JOBS_RETENTION_PERIOD,
         JOBS_GRAPH,
         SERVICE_NAME,
         DELTA_SYNC_JOB_OPERATION,
         JOB_CREATOR_URI } from "../config";
import { deleteDeltaFilesForJob } from '../lib/utils';
import { cleanupJob, getJobs, getLatestJobForOperation } from '../lib/job';
import { createError } from "../lib/error";

export async function startDeltaCleanup() {
  console.log('Starting delta cleanup...');
  try {
    // a retention period of -1 indicates JOBS should not be removed
    if (DELTA_JOBS_RETENTION_PERIOD > -1) {
      let cleanupTimestamp = new Date();

      cleanupTimestamp.setDate(cleanupTimestamp.getDate() - DELTA_JOBS_RETENTION_PERIOD);
      console.log(`Cleanup: removing old delta jobs until ${cleanupTimestamp}`);

      // Note: this won't remove initial sync job
      let jobsToClean = await getJobs(DELTA_SYNC_JOB_OPERATION,
                                 [STATUS_SUCCESS, STATUS_FAILED],
                                 [],
                                 cleanupTimestamp
                                );
      console.log(`Jobs to clean count: ${jobsToClean?.length}`)

      // Ensure we don't remove the last successful job.
      // Since used to calculate the next delta time stamp to ingest
      const latestJob = await getLatestJobForOperation(DELTA_SYNC_JOB_OPERATION,
                                                       JOB_CREATOR_URI,
                                                       [STATUS_SUCCESS]);

      if(latestJob) {
        console.log(`Filtering latest successful job.`);
        jobsToClean = jobsToClean.filter(j => j.job !== latestJob.job);
      }

      for(const job of jobsToClean) {
        console.log(`Cleanup job with uri ${job?.job}`);
        await deleteDeltaFilesForJob(job);
        await cleanupJob(job.job);
      }
      console.log(`Cleanup done.`);
    }
  }
  catch (e) {
    console.log("error while cleaninup up delta", e);
    await createError(JOBS_GRAPH, SERVICE_NAME, `Unexpected error while running delta file cleanup task: ${e}`);
  }
}
