import fs from 'fs-extra';
import path from 'path';
import pkg from 'sparqljs';
const {
  Generator: SparqlGenerator,
  Wildcard: SparqlWildcard,
  Parser: SparqlParser,
  SparqlQuery: SparqlQuery,
} = pkg;
import {
  querySudo as muQuery,
  updateSudo as muUpdate,
} from '@lblod/mu-auth-sudo';
import {
  LANDING_ZONE_GRAPH,
  REMAPPING_GRAPH,
  REMAPPING_DATABASE_ENDPOINT,
  DIRECT_EXECUTE_EXPENSIVE_QUERIES,
  DIRECT_REMAPPING_DATABASE_ENDPOINT,
  MAPPING_QUERY_FOLDER,
} from '../config.js';

import {
  parseSparqlJsonTerm,
  parseSparqlJsonBindingQuad,
} from './parse-binding-utils.js';

const sparqlGenerator = new SparqlGenerator();

let mappingQueries,
  insertQueries,
  deleteQueries = null;

// Recursive function to get all .rq and .sparql files in a directory and its subdirectories
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

// Function to check for .rq or .sparql files, parse them, and return parsed queries as an array
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
        parsedQueries.push(parsedQuery);
      } catch (error) {
        console.error(`Error parsing file ${filePath}:`, error.message);
        throw error;
      }
    }
    mappingQueries = parsedQueries;
  }
  return JSON.parse(JSON.stringify(mappingQueries));
}

async function getInsertQueries() {
  if (!insertQueries?.length) {
    insertQueries = (await getMappingQueries()).map((query) => {
      return {
        type: 'update',
        updates: [
          {
            updateType: 'insertdelete',
            delete: [],
            insert: [
              {
                type: 'graph',
                triples: query.template,
                name: {
                  termType: 'NamedNode',
                  value: REMAPPING_GRAPH,
                },
              },
            ],
            where: [
              {
                type: 'graph',
                patterns: query.where,
                name: {
                  termType: 'NamedNode',
                  value: LANDING_ZONE_GRAPH,
                },
              },
            ],
          },
        ],
        prefixes: query.prefixes,
      };
    });
  }
  return JSON.parse(JSON.stringify(insertQueries));
}

async function getDeleteQueries() {
  if (!deleteQueries?.length) {
    deleteQueries = (await getMappingQueries()).map((query) => {
      return {
        type: 'update',
        updates: [
          {
            updateType: 'insertdelete',
            delete: [
              {
                type: 'graph',
                triples: query.template,
                name: {
                  termType: 'NamedNode',
                  value: REMAPPING_GRAPH,
                },
              },
            ],
            where: [
              {
                type: 'graph',
                patterns: query.where,
                name: {
                  termType: 'NamedNode',
                  value: LANDING_ZONE_GRAPH,
                },
              },
            ],
            insert: [],
          },
        ],
        prefixes: query.prefixes,
      };
    });
  }
  return JSON.parse(JSON.stringify(deleteQueries));
}

/**
 *
 * @param {import("sparqljs").SparqlQuery[]} queries
 * @param {Object} deltaTriple Triple from the delta message, as a Sparql result JSON binding
 * @returns
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
        parsedQuery.updates[0].where.push(
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
    parsedQuery.updates.forEach((update) => {
      // update.where.forEach((where) => {
      //   where.patterns.forEach((pattern) => {
      //     pattern.triples.forEach((queryPattern) => {
      update.where[0].patterns[0].triples.forEach((queryPattern) => {
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
    });
    return hasMatch; // Keep this parsedQuery only if a match was found
  });
}

async function insertTripleInLandingZone(triple) {
  await executeUpdate({
    type: 'update',
    updates: [
      {
        updateType: 'insert',
        insert: [
          {
            type: 'graph',
            triples: [parseSparqlJsonBindingQuad(triple)],
            name: {
              termType: 'NamedNode',
              value: LANDING_ZONE_GRAPH,
            },
          },
        ],
      },
    ],
    prefixes: {},
  });
}

async function deleteTripleInLandingZone(triple) {
  await executeUpdate({
    type: 'update',
    updates: [
      {
        updateType: 'delete',
        delete: [
          {
            type: 'graph',
            triples: [parseSparqlJsonBindingQuad(triple)],
            name: {
              termType: 'NamedNode',
              value: LANDING_ZONE_GRAPH,
            },
          },
        ],
      },
    ],
    prefixes: {},
  });
}

async function executeUpdate(query, endpoint = REMAPPING_DATABASE_ENDPOINT) {
  const queryStr =
    typeof query === 'string' ? query : sparqlGenerator.stringify(query);

  await muUpdate(queryStr, {}, { sparqlEndpoint: endpoint });
}

export async function initialMapping() {
  const startTime = Date.now();
  const insertQueries = await getInsertQueries();
  const remapping_endpoint = (DIRECT_EXECUTE_EXPENSIVE_QUERIES) ? DIRECT_REMAPPING_DATABASE_ENDPOINT : REMAPPING_DATABASE_ENDPOINT;
  for (const query of insertQueries) {
    const queryAsString = sparqlGenerator.stringify(query);
    console.log(
      `Executing initial mapping query  (${insertQueries.indexOf(query) + 1} of ${insertQueries.length})`,
    );
    await executeUpdate(queryAsString, remapping_endpoint);
    console.log(
      `Successfully executed initial mapping query (${insertQueries.indexOf(query) + 1} of ${insertQueries.length})`,
    );
  }
  const endTime = Date.now();
  console.log(`Initial mapping took ${endTime - startTime}ms`);
}

/**
 * Process delta msg:
 * - Deletes
 *   - update target graph
 *   - delete from landing zone
 * - Inserts
 *   - insert in landing zone
 *   - update target graph
 */
export async function deltaSparqlProcessing(deltaMessage) {
  for (const delta of deltaMessage) {
    for (const deleteTriple of delta.deletes) {
      const deltaDeleteQueries = filterAndBindQueries(
        await getDeleteQueries(),
        deleteTriple,
      );
      for (const query of deltaDeleteQueries) {
        const queryAsString = sparqlGenerator.stringify(query);
        console.log(
          `Executing mapping query: ${queryAsString} (${deltaDeleteQueries.indexOf(query) + 1} of ${deltaDeleteQueries.length})`,
        );
        await executeUpdate(queryAsString);
      }
      if (!deltaDeleteQueries.length) {
        console.log(
          `No DELETE mapping queries found for triple: ${deleteTriple}`,
        );
      }

      await deleteTripleInLandingZone(deleteTriple);
    }

    for (const insertTriple of delta.inserts) {
      await insertTripleInLandingZone(insertTriple);

      const deltaInsertQueries = filterAndBindQueries(
        await getInsertQueries(),
        insertTriple,
      );
      for (const query of deltaInsertQueries) {
        const queryAsString = sparqlGenerator.stringify(query);
        console.log(
          `Executing mapping query: ${queryAsString} (${deltaInsertQueries.indexOf(query) + 1} of ${deltaInsertQueries.length})`,
        );
        await executeUpdate(queryAsString);
      }
      if (!deltaInsertQueries.length) {
        console.log(
          `No INSERT mapping queries found for triple: ${insertTriple}`,
        );
      }
    }
  }
}
