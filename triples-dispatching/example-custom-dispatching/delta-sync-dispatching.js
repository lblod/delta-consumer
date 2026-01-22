/* Variables */
const INGEST_GRAPH =
    process.env.INGEST_GRAPH || `http://mu.semte.ch/graphs/public`;

const sparqlEndpoint = "http://database:8890/sparql";

/* Codes */
export async function dispatch(lib, data) {
    const { insertIntoGraph, deleteFromGraph } = lib;
    const { termObjectChangeSets } = data;

    for (let { deletes, inserts } of termObjectChangeSets) {

        console.log(`Using ${sparqlEndpoint} to insert triples`);

        await deleteFromGraph(deletes, sparqlEndpoint, INGEST_GRAPH, {});
        await insertIntoGraph(inserts, sparqlEndpoint, INGEST_GRAPH, {});


    }
}

