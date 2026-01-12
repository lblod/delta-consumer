/* Variables */
const INGEST_GRAPH =
    process.env.INGEST_GRAPH || `http://mu.semte.ch/graphs/public`;

const MU_CALL_SCOPE_ID_INITIAL_SYNC =
    process.env.MU_CALL_SCOPE_ID_INITIAL_SYNC ||
    "http://redpencil.data.gift/id/concept/muScope/deltas/consumer/initialSync";

const sparqlEndpoint = "http://database:8890/sparql";

/** Code **/
export async function dispatch(lib, data) {
    const { insertIntoGraph } = lib;

    console.log(`Using ${sparqlEndpoint} to insert triples`);

    await insertIntoGraph(data.termObjects, sparqlEndpoint, INGEST_GRAPH, { "mu-call-scope-id": MU_CALL_SCOPE_ID_INITIAL_SYNC });

}

export async function onFinishInitialIngest(_lib) {
    console.log(`
    onFinishInitialIngest was called!
    Current implementation does nothing, no worries.
    You can overrule it for extra manipulations after initial ingest.
  `);
}