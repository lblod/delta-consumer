import * as muAuthSudo from '@lblod/mu-auth-sudo';
import { SPARQL_TIMEOUT_MS } from '../config';

/**
 * Wrapper around @lblod/mu-auth-sudo that enforces a finite timeout on every
 * SPARQL request. The underlying client has no timeout of its own: if the
 * endpoint accepts the connection but never responds, the await hangs forever
 * and blocks the (strictly serial) sync queue. All code in this service,
 * including the `muAuthSudo` object handed to custom dispatching config, must
 * import this module instead of @lblod/mu-auth-sudo directly.
 *
 * Note: on timeout only the await is released; the in-flight HTTP request
 * cannot be aborted through the client and is left to the OS to clean up.
 */
function withTimeout(promise, queryString, connectionOptions) {
  if (!SPARQL_TIMEOUT_MS) return promise;

  let timer;
  const guard = new Promise((_, reject) => {
    timer = setTimeout(() => {
      const endpoint = connectionOptions.sparqlEndpoint || process.env.MU_SPARQL_ENDPOINT;
      const summary = queryString.replace(/\s+/g, ' ').trim().substring(0, 200);
      reject(new Error(`SPARQL request to ${endpoint} timed out after ${SPARQL_TIMEOUT_MS} ms (see DCR_SPARQL_TIMEOUT_MS). Query: ${summary}`));
    }, SPARQL_TIMEOUT_MS);
  });

  return Promise.race([promise, guard]).finally(() => clearTimeout(timer));
}

export function querySudo(queryString, extraHeaders = {}, connectionOptions = {}) {
  return withTimeout(muAuthSudo.querySudo(queryString, extraHeaders, connectionOptions), queryString, connectionOptions);
}

export function updateSudo(queryString, extraHeaders = {}, connectionOptions = {}) {
  return withTimeout(muAuthSudo.updateSudo(queryString, extraHeaders, connectionOptions), queryString, connectionOptions);
}

export default { querySudo, updateSudo };
