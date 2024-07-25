/**
 * Dispatch the fetched information to a target graph.
 * @param { mu, muAuthSudo, fetch } lib - The provided libraries from the host service.
 * @param { termObjectChangeSets: { deletes, inserts } } data - The fetched changes sets, which objects of serialized Terms
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

module.exports = {
  dispatch,
};
