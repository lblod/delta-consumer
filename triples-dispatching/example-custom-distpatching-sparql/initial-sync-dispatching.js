/**
 * Dispatch the fetched information to a target graph.
 * @param { mu, muAuthSudo, fetch } lib - The provided libraries from the host service.
 * @param { termObjects } data - The fetched quad information, which objects of serialized Terms
 *          [ {
 *              graph: "<http://foo>",
 *              subject: "<http://bar>",
 *              predicate: "<http://baz>",
 *              object: "<http://boom>^^<http://datatype>"
 *            }
 *         ]
 * @return {void} Nothing
 */
let firstRun = true;
async function dispatch(lib, data) {
  if (firstRun) {
    console.log(
      "No custom dispatch implemented - this message will not be repeated on future dispatching calls"
    );
    firstRun = false;
  }
}

/**
 * A callback you can override to do extra manipulations
 *   after initial ingest.
 * @param { mu, muAuthSudo, fech } lib - The provided libraries from the host service.
 * @return {void} Nothing
 */
async function onFinishInitialIngest(lib) {
  console.log(`
      Current implementation does nothing.
    `);
}

module.exports = {
  dispatch,
  onFinishInitialIngest,
};
