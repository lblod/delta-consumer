import fetch from 'node-fetch';
import fs from 'fs-extra';
import {
  SECRET_KEY, SYNC_LOGIN_ENDPOINT, SYNC_REQUEST_TIMEOUT_MS
} from '../config';


let cookie = null;
async function login() {
  try {
    const resp = await fetch(SYNC_LOGIN_ENDPOINT, {
      headers: {
        'key': SECRET_KEY,
        'accept': "application/vnd.api+json"
      },
      method: 'POST',
      timeout: SYNC_REQUEST_TIMEOUT_MS
    });

    if (!resp.ok) {
      console.log("FAILED TO LOG IN");
      throw "Could not log in";
    }

    if (resp.headers.raw()['set-cookie']) {
      const [setCookie,] = resp.headers.raw()['set-cookie'];
      const [newCookie,] = setCookie.split(';');
      console.log(`GOT COOKIE, SETTING ${newCookie}`);
      cookie = newCookie;
    }
  } catch (e) {
    console.log(`Something went wrong while logging in at ${SYNC_LOGIN_ENDPOINT}`);
    console.log(e);
    throw e;
  }
}

export default async function fetcher(url, options, isRetry = false) {
  // node-fetch's timeout guards the request until response headers arrive;
  // without it, a silently dropped connection hangs the sync task forever.
  const fetchOptions = Object.assign( { timeout: SYNC_REQUEST_TIMEOUT_MS }, options || {} );

  if(!( SYNC_LOGIN_ENDPOINT && SECRET_KEY )) {
    console.log(`SYNC_LOGIN_ENDPOINT or SECRET_KEY not provided. Performing an unauthenticated call`);
    return await fetch(url, fetchOptions);
  } else {

    if( !cookie ) {
      await login();
    } else {
      console.log("FETCH WITH COOKIE");
    }

    // do fetch call as usual but add cookie
    fetchOptions.headers = fetchOptions.headers || {};
    fetchOptions.headers.cookie = cookie;

    // send fetch
    console.log(`Going to send fetch with ${JSON.stringify(fetchOptions)}`);

    let resp = await fetch(url, fetchOptions);

    if(resp.status == 400 && !isRetry){
      cookie = null;
      return await fetcher(url, options, true);
    }
    else {

      // extract new cookie if provided and set it
      if( resp.headers.raw()['set-cookie'] ) {
        const [setCookie,] = resp.headers.raw()['set-cookie'];
        const [newCookie,] = setCookie.split(';');
        console.log(`GOT COOKIE, SETTING ${newCookie}`);
        cookie = newCookie;
      }

    }

    return resp;
  }
}

/**
 * Downloads url to filePath.
 * node-fetch's timeout no longer applies once response headers arrived, and
 * pipe() does not propagate source stream errors, so we guard the body
 * transfer ourselves: an error on either stream, or an idle connection
 * (no data received for SYNC_REQUEST_TIMEOUT_MS) fails the download instead
 * of leaving the promise pending forever.
 */
export async function fetchToFile(url, options, filePath) {
  const response = await fetcher(url, options);
  await new Promise((resolve, reject) => {
    const writeStream = fs.createWriteStream(filePath);
    let idleTimer;
    const failDownload = (error) => {
      clearTimeout(idleTimer);
      writeStream.destroy();
      reject(error);
    };
    const resetIdleTimer = () => {
      if (!SYNC_REQUEST_TIMEOUT_MS) return;
      clearTimeout(idleTimer);
      idleTimer = setTimeout(() => {
        response.body.destroy(new Error(`Download from ${url} aborted: no data received for ${SYNC_REQUEST_TIMEOUT_MS} ms (see DCR_SYNC_REQUEST_TIMEOUT_MS)`));
      }, SYNC_REQUEST_TIMEOUT_MS);
    };
    response.body.on('data', resetIdleTimer);
    response.body.on('error', failDownload);
    writeStream.on('close', () => { clearTimeout(idleTimer); resolve(); });
    writeStream.on('error', failDownload);
    resetIdleTimer();
    response.body.pipe(writeStream);
  });
}
