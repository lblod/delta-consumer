import fs from 'fs-extra';
import path from 'path';
import pkg from 'sparqljs';
const {
  Generator: SparqlGenerator,
  Wildcard: SparqlWildcard,
  Parser: SparqlParser,
  SparqlQuery: SparqlQuery,
} = pkg;
import { querySudo, updateSudo } from '@lblod/mu-auth-sudo';
import {
  LANDING_ZONE_GRAPH,
  REMAPPING_GRAPH,
  REMAPPING_DATABASE_ENDPOINT,
  MAPPING_QUERY_FOLDER,
  BATCH_SIZE,
} from '../config.js';

import { parseResult, toTermObjectArray } from './utils';

import {
  parseSparqlJsonTerm,
  parseSparqlJsonBindingQuad,
} from './parse-binding-utils.js';

const sparqlGenerator = new SparqlGenerator();

let mappingQueries =  null;

/**
 * Recursive function to get all .rq and .sparql files in a directory and its subdirectories
 * @param {string} dir - The directory to search for .rq and .sparql files.
 * @returns {Promise<string[]>} - A promise that resolves to an array of file paths.
 */
async function getSparqlFiles(dir) {
  let files = await fs.readdir(dir);

  let sparqlFiles = [];

  for (const file of files) {
    const filePath = path.join(dir, file);
    const stat = await fs.stat(filePath);

    if (stat.isDirectory()) {
      // Recursively get files from subdirectories
      sparqlFiles = sparqlFiles.concat(await getSparqlFiles(filePath));
    } else if (file.endsWith('.rq') || file.endsWith('.sparql')) {
      sparqlFiles.push(filePath);
    }
  }
  return sparqlFiles;
}

/**
 * Function to check for .rq or .sparql files, parse them, and return parsed queries as an array.
 * Enrichmenet of the queries is performed here too.
 * @returns {Promise<Object[]>} - A promise that resolves to an array of parsed SPARQL queries.
 */
async function getMappingQueries() {
  if (!mappingQueries?.length) {
    const parser = new SparqlParser();
    const parsedQueries = [];

    for (const filePath of await getSparqlFiles(MAPPING_QUERY_FOLDER)) {
      const fileContent = await fs.readFile(filePath, 'utf8');

      try {
        const parsedQuery = parser.parse(fileContent);

        if (parsedQuery.type.toUpperCase() !== 'QUERY') {
          throw new Error(
            `Query type ${parsedQuery.type} is not supported in file ${filePath}`,
          );
        }

        const queryType = parsedQuery.queryType.toUpperCase();
        if (queryType !== 'CONSTRUCT') {
          throw new Error(
            `Query type ${queryType} is not supported in file ${filePath}`,
          );
        }

        const enrichedQuery = enrichMappingQuery(parsedQuery);

        parsedQueries.push(enrichedQuery);
      } catch (error) {
        console.error(`Error parsing file ${filePath}:`, error.message);
        throw error;
      }
    }
    mappingQueries = parsedQueries;
  }
  return JSON.parse(JSON.stringify(mappingQueries));
}

/**
 * Enriches a mapping query.
 * Currently, it only adds a graph clause from the target graph.
 * It could do more in the future.
 * @param {Object} mappingQuery - The SPARQL mapping query to enrich.
 * @returns {Object} - The enriched SPARQL mapping query.
 */
function enrichMappingQuery(mappingQuery) {
  mappingQuery.where = [
    {
      type: 'graph',
      patterns: mappingQuery.where,
      name: {
        termType: 'NamedNode',
        value: LANDING_ZONE_GRAPH
      }
    }
  ];

  return mappingQuery;
}

/**
 * Filters and binds SPARQL queries based on the given delta triple.
 * This is core remapping logic; it checks whether an incoming triple should be mapped to a CONSTRUCT
 * query, and substite the mapping values.
 * @param {SparqlQuery[]} queries - An array of parsed (and enriched) SPARQL queries.
 * @param {Object} deltaTriple - Triple from the delta message, as a SPARQL result JSON binding.
 * @returns {SparqlQuery[]} - An array of filtered and bound SPARQL queries.
 */
function filterAndBindQueries(queries, deltaTriple) {
  // Helper function to check if a query pattern matches the  pattern
  function matchesPattern(queryPattern, deltaTriple) {
    return (
      termMatchesPattern(queryPattern.subject, deltaTriple.subject) &&
      termMatchesPattern(queryPattern.predicate, deltaTriple.predicate) &&
      termMatchesPattern(queryPattern.object, deltaTriple.object)
    );
  }

  function termMatchesPattern(queryTerm, deltaTerm) {
    switch (queryTerm.termType) {
      case 'Variable':
        return true;
      case 'NamedNode':
        return namedNodeMatchesPattern(queryTerm, deltaTerm);
      case 'Literal':
        return literalMatchesPattern(queryTerm, deltaTerm);
    }
  }

  function namedNodeMatchesPattern(queryTerm, deltaTerm) {
    return deltaTerm.type === 'uri' && queryTerm.value === deltaTerm.value;
  }

  function literalMatchesPattern(queryTerm, deltaTerm) {
    return (
      deltaTerm.type === 'literal' &&
      queryTerm.value === deltaTerm.value &&
      languageMatchesPattern(queryTerm, deltaTerm) &&
      datatypeMatchesPattern(queryTerm, deltaTerm)
    );
  }

  function languageMatchesPattern(queryTerm, deltaTerm) {
    if (
      queryTerm.datatype.value ===
      'http://www.w3.org/1999/02/22-rdf-syntax-ns#langString'
    ) {
      // Note: modeling of non-language-tagged literals:
      //  - in the query pattern: language = ""
      //  - the delta msg:  the property lang or xml:lang is not present
      const queryLanguage = queryTerm.language;
      const deltaLanguage = deltaTerm.lang || deltaTerm['xml:lang'] || '';
      return queryLanguage === deltaLanguage;
    } else {
      return true;
    }
  }

  function datatypeMatchesPattern(queryTerm, deltaTerm) {
    // treating plain literals as xsd:strings https://www.w3.org/TR/rdf11-concepts/#section-Graph-Literal
    const deltaDatatype =
      deltaTerm.datatype || 'http://www.w3.org/2001/XMLSchema#string';
    return queryTerm.datatype.value === deltaDatatype;
  }

  function bindVariable(parsedQuery, queryPattern, deltaTriple) {
    ['subject', 'predicate', 'object'].forEach((variable) => {
      if (queryPattern[variable].termType === 'Variable') {
        parsedQuery.where.push(
          valuesPattern(queryPattern[variable].value, deltaTriple[variable]),
        );
      }
    });
    return parsedQuery;
  }

  function valuesPattern(variable, value) {
    return {
      type: 'values',
      values: [
        {
          [`?${variable}`]: parseSparqlJsonTerm(value),
        },
      ],
    };
  }
  return queries.filter((parsedQuery) => {
    let hasMatch = false; // Flag to track if any match is found

    // The generated update queries have one graph pattern in one where clause
      // update.where.forEach((where) => {
      //   where.patterns.forEach((pattern) => {
      //     pattern.triples.forEach((queryPattern) => {
      parsedQuery.where[0].patterns[0].triples.forEach((queryPattern) => {
        const matches = matchesPattern(queryPattern, deltaTriple);
        if (matches) {
          console.log(
            `Match found for query: ${sparqlGenerator.stringify(parsedQuery)}`,
          );
          parsedQuery = bindVariable(parsedQuery, queryPattern, deltaTriple);
          hasMatch = true; // Set flag to true if a match is found
        }
        //     });
        //   });
      });
    return hasMatch; // Keep this parsedQuery only if a match was found
  });
}

/**
 * Retrieves remapped triples based on the original triple
 * @param {Object} originalTriple - The original triple to remap.
 * @returns {Promise<Object[]>} - A promise that resolves to an array of remapped triples.
 */
async function getRemappedTriples(originalTriple) {
  const mappingQueries = filterAndBindQueries(await getMappingQueries(), originalTriple);

  let remappedTriples = [];
  for (const query of mappingQueries) {
    const queryAsString = sparqlGenerator.stringify(query);

    console.log(
      `Executing mapping query: ${queryAsString} (${mappingQueries.indexOf(query) + 1} of ${query.length})`
    );

    let result = await querySudo(queryAsString, {}, { sparqlEndpoint: REMAPPING_DATABASE_ENDPOINT, mayRetry: true });

    // Some extra boilerplate to ensure format remains consistent. This should be fixed one day.
    let triples = result.results.bindings.map(t => {
      return {
        graph: { type: "uri", value: REMAPPING_GRAPH },
        subject: t.s, predicate: t.p, object: t.o
      };
    });

    remappedTriples= [ ...remappedTriples, ...triples ];
  }
  return remappedTriples;
}

/**
 * Updates a graph with the given triples using the specified operation
 * @param {string} graph - The graph to update.
 * @param {Object[]} triples - The triples to insert or delete.
 * @param {string} [operation="INSERT"] - The operation to perform ("INSERT" or "DELETE").
 * @returns {Promise<void>} - A promise that resolves when the update is complete.
 */
async function updateGraph(graph, triples, operation = "INSERT") {

  if(!triples.length) return;

  const termObjectArray = toTermObjectArray(triples);
  const serializeTriples = termObjectArray
        .map(t => `${t.subject} ${t.predicate} ${t.object}.`)
        .join('\n');
  const queryString = `
    ${operation} DATA {
       GRAPH <${graph}> {
         ${serializeTriples}
       }
     }
    `;
    await updateSudo(queryString, {}, { sparqlEndpoint: REMAPPING_DATABASE_ENDPOINT, mayRetry: true });
}

/**
 * Process delta message:
 * - Deletes
 *   - update target graph
 *   - delete from landing zone
 * - Inserts
 *   - insert in landing zone
 *   - update target graph
 * @param {Object[]} deltaMessage - The delta message containing triples to process.
 * @returns {Promise<Object[]>} - A promise that resolves to an array of remapped delta messages.
 */
export async function remapTriplesInDeltas(deltaMessage) {

  const remappedDeltaMessage = [];

  for (const delta of deltaMessage) {
    const remappedResults = { deletes: [], inserts: [] };
    for (const deleteTriple of delta.deletes) {

      const remappedTriplesForDelete = await getRemappedTriples(deleteTriple);

      if (!remappedTriplesForDelete.length) {
        console.log(
          `No DELETE mapping queries found for triple: ${JSON.stringify(deleteTriple)}`
        );
      }

      remappedResults.deletes = [
        ...remappedResults.deletes,
        ...remappedTriplesForDelete
      ];

      await updateGraph(REMAPPING_GRAPH, remappedTriplesForDelete , "DELETE");
      await updateGraph(LANDING_ZONE_GRAPH, [ deleteTriple ], "DELETE");
    }

    for (const insertTriple of delta.inserts) {
      await updateGraph(LANDING_ZONE_GRAPH, [ insertTriple ]);

      const remappedTriplesForInsert = await getRemappedTriples(insertTriple);

      if (!remappedTriplesForInsert.length) {
        console.log(
          `No INSERT mapping queries found for triple: ${JSON.stringify(insertTriple)}`
        );
      }

      remappedResults.inserts = [
        ...remappedResults.inserts,
        ...remappedTriplesForInsert
      ];

      await updateGraph(REMAPPING_GRAPH, remappedTriplesForInsert);
    }
    remappedDeltaMessage.push(remappedResults);
  }

  return remappedDeltaMessage;
}
