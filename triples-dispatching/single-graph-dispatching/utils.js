
export async function batchedUpdate(
  lib,
  nTriples,
  targetGraph,
  sleepMs,
  batch,
  extraHeaders,
  endpoint,
  operation) {
  const { chunk, sparqlEscapeUri,prepareStatements, updateWithRecover } = lib;
  console.log("size of store: ", nTriples?.length);
  const chunkedArray = chunk(nTriples, batch);
  while (chunkedArray.length) {
    console.log(`using endpoint from utils ${endpoint}`);
    const chunkedTriple = chunkedArray.pop();
    await updateWithRecover(chunkedTriple, (triples) => {
      const { usedPrefixes, newStmts } = prepareStatements(triples);
      return `
        ${usedPrefixes}
        ${operation} DATA {
           GRAPH ${sparqlEscapeUri(targetGraph)} {
             ${newStmts.map(o => `${o.subject} ${o.predicate} ${o.object}.`).join('')}
           }
        }
      `;
    }, endpoint, extraHeaders);
    await sleep(sleepMs);

  }
}

async function sleep(sleepMs) {
  console.log(`Sleeping before next query execution: ${sleepMs}`);
  await new Promise(r => setTimeout(r, sleepMs));
}
