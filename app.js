import { CronJob } from 'cron';
import { app, errorHandler } from 'mu';
import * as muAuthSudo from '@lblod/mu-auth-sudo';
import {
  CRON_PATTERN_DELTA_SYNC,
  INITIAL_SYNC_JOB_OPERATION,
  SERVICE_NAME,
  DELTA_SYNC_JOB_OPERATION,
  ENABLE_DELTA_CONTEXT,
  LANDING_ZONE_GRAPH,
  LANDING_ZONE_DATABASE_ENDPOINT,
  CRON_PATTERN_DELTA_CLEANUP
} from './config';
import { waitForDatabase } from './lib/database';
import { ProcessingQueue } from './lib/processing-queue';
import { cleanupJob, getJobs } from './lib/job';
import { deleteDeltaFilesForJob } from './lib/utils';
import { startDeltaSync } from './pipelines/delta-sync';
import { startInitialSync } from './pipelines/initial-sync';
import { startDeltaCleanup } from './pipelines/delta-cleanup';

const deltaSyncQueue = new ProcessingQueue('delta-sync-queue');

app.get('/', function(req, res) {
  res.send(`Hello, you have reached ${SERVICE_NAME}! I'm doing just fine :)`);
});

waitForDatabase(startInitialSync);

new CronJob(CRON_PATTERN_DELTA_SYNC, async function() {
  const now = new Date().toISOString();
  console.info(`Delta sync triggered by cron job at ${now}`);
  deltaSyncQueue.addJob(startDeltaSync);
}, null, true);

new CronJob(CRON_PATTERN_DELTA_CLEANUP, async function() {
  const now = new Date().toISOString();
  console.info(`Delta cleanup triggered by cron job at ${now}`);
  deltaSyncQueue.addJob(startDeltaCleanup);
}, null, true);

/*
 * ENDPOINTS CURRENTLY MEANT FOR DEBUGGING
 */

app.post('/initial-sync-jobs', async function( _, res ){
  startInitialSync();
  res.send({ msg: 'Started initial sync job' });
});

app.delete('/initial-sync-jobs', async function( _, res ){
  const jobs = await getJobs(INITIAL_SYNC_JOB_OPERATION);
  for(const { job } of jobs){
    await cleanupJob(job);
  }
  res.send({ msg: 'Initial sync jobs cleaned' });
});

app.post('/delta-sync-jobs', async function( _, res ){
  startDeltaSync();
  res.send({ msg: 'Started delta sync job' });
});

app.post('/delta-cleanup-jobs', async function( _, res ){
  startDeltaCleanup();
  res.send({ msg: 'Started delta cleanup job' });
});

app.post('/flush', async function (_, res) {
  const sleep = 30;
  const msg = `
    !!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!! \n
    This call will flush: \n
      - the initial sync jobs \n
      - the sync-jobs  \n
      - if applicable, the LANDING_ZONE data \n
    \n
    It won't take into account the dispatched or transformed data. \n
    Since this is instance specific you will need a manual migration for that. \n
      - Note: we consider improvements later \n
    \n
    You have ${sleep} seconds to exit and stop the service if this call was not your intention. \n
    !!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!! \n
  `;
  console.warn(msg);
  res.send({ msg });
  await new Promise(r => setTimeout(r, sleep*1000));
  console.log(`Starting flush`);

  try {
    const initialSyncJobs = await getJobs(INITIAL_SYNC_JOB_OPERATION);
    const syncJobs = await getJobs(DELTA_SYNC_JOB_OPERATION);
    for(const job of [ ...initialSyncJobs, ...syncJobs ]) {
      await deleteDeltaFilesForJob(job);
      await cleanupJob(job.job);
    }
    if(ENABLE_DELTA_CONTEXT) {
      console.log(`Flushing LANDING_ZONE data`);
      const flushQuery = `
        DELETE WHERE {
          GRAPH <${LANDING_ZONE_GRAPH}> {
            ?s ?p ?o.
          }
        }
      `;
      await muAuthSudo
        .updateSudo(flushQuery,
                    { }, //TODO: add mu-scope-id configurable
                { sparqlEndpoint: LANDING_ZONE_DATABASE_ENDPOINT, mayRetry: true });
    }
    console.log('Flush successful');
  }
  catch(e) {
    console.error('Something went wrong during flush');
    console.error(e);
  }
});

app.use(errorHandler);
