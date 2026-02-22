export const BATCH_SIZE = parseInt(process.env.BATCH_SIZE) || 100;
export const MU_CALL_SCOPE_ID_INITIAL_SYNC = process.env.MU_CALL_SCOPE_ID_INITIAL_SYNC || 'http://redpencil.data.gift/id/concept/muScope/deltas/consumer/initialSync';
export const BYPASS_MU_AUTH_FOR_EXPENSIVE_QUERIES = process.env.BYPASS_MU_AUTH_FOR_EXPENSIVE_QUERIES == 'true' ? true : false;
export const DIRECT_DATABASE_ENDPOINT = process.env.DIRECT_DATABASE_ENDPOINT || 'http://virtuoso:8890/sparql';
export const MAX_DB_RETRY_ATTEMPTS = parseInt(process.env.MAX_DB_RETRY_ATTEMPTS || 5);
export const SLEEP_BETWEEN_BATCHES = parseInt(process.env.SLEEP_BETWEEN_BATCHES || 1000);
export const SLEEP_TIME_AFTER_FAILED_DB_OPERATION = parseInt(process.env.SLEEP_TIME_AFTER_FAILED_DB_OPERATION || 60000);
export const INGEST_GRAPH = process.env.INGEST_GRAPH || `http://mu.semte.ch/graphs/public`;

