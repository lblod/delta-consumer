import { sparqlEscapeUri } from 'mu';
import {
  LANDING_ZONE_DATABASE_ENDPOINT,
  LANDING_ZONE_GRAPH,
} from './../config';
import { RDF_TYPE_URI, RDF_TYPE } from './constants';
import { deltaContextConfiguration } from '../triples-dispatching';
import { Parser } from 'sparqljs';
import { querySudo } from '@lblod/mu-auth-sudo';
import { toTermObjectArray, deleteFromGraph, insertIntoGraph } from './utils';
import TypeCache from './type-cache';

/**
 * Adds context to the changeSets based on the configuration
 * An landing zone graph is maintained to keep track of the inserted and deleted triples in order to
 * determine be able to determine the context of the triples.
 *
 * @param {Object} changeSets
 * @return {Object} changeSetsWithContext with context
 *
 */
export async function addContext(changeSets) {
  const contextConfig = await compileContextConfiguration(
    deltaContextConfiguration,
  );
  const { addTypes, contextQueries } = contextConfig;
  const { scope, exhausitive } = addTypes;

  if (scope === 'none') {
    return changeSets;
  }

  // Deep copy the changeSets to prevent changing the original object
  let changeSetsWithContext = JSON.parse(JSON.stringify(changeSets));

  // Zip both changeSets together
  let zippedChangeSets = changeSets.map((o, i) => ({
    original: o,
    withContext: changeSetsWithContext[i],
  }));

  console.log(
    `original changeSets: ${JSON.stringify(changeSetsWithContext, null, 2)}`,
  );

  let typeCache = new TypeCache(changeSetsWithContext);

  for (let { original, withContext } of zippedChangeSets) {
    if (withContext.deletes.length > 0) {
      // add types
      if (scope === 'all' || scope === 'deletes') {
        if (exhausitive) {
          withContext.deletes = await exhaustiveAddTypes(
            withContext.deletes,
            typeCache,
          );
        } else {
          withContext.deletes = await nonExhaustiveAddTypes(
            withContext.deletes,
            typeCache,
          );
        }
      }

      for (let { trigger, queryTemplate } of contextQueries) {
        const deletesNeedingContext = withContext.deletes.filter(
          contextTriggerFilter(trigger),
        );
        for (const statementWhichNeedsContext of deletesNeedingContext) {
          console.log(
            `statementWhichNeedsContext: ${JSON.stringify(
              statementWhichNeedsContext,
              null,
              2,
            )}`,
          );
          const { subject } = statementWhichNeedsContext;
          const contextQuery = queryTemplate(subject);
          const context = await findContext(contextQuery);
          withContext.deletes.push(...context);
        }
      }
      // remove from landing zone graph
      await deleteFromLandingZoneGraph(original.deletes);
    }

    // console.log(`trigger: ${JSON.stringify(trigger, null, 2)}`)
    // console.log(`inserts: ${JSON.stringify(inserts, null, 2)}`)

    if (withContext.inserts.length > 0) {
      // add to landing zone graph
      await insertIntoLandingZoneGraph(original.inserts);

      // add types
      if (scope === 'all' || scope === 'inserts') {
        if (exhausitive) {
          withContext.inserts = await exhaustiveAddTypes(
            withContext.inserts,
            typeCache,
          );
        } else {
          withContext.inserts = await nonExhaustiveAddTypes(
            withContext.inserts,
            typeCache,
          );
        }
        withContext.inserts = await triggerOnNewRDFTypeStatements(
          withContext.inserts,
          original.inserts,
        );
      }

      for (let { trigger, queryTemplate } of contextQueries) {
        const insertsNeedingContext = withContext.inserts.filter(
          contextTriggerFilter(trigger),
        );
        for (const statementWhichNeedsContext of insertsNeedingContext) {
          console.log(
            `statementWhichNeedsContext: ${JSON.stringify(
              statementWhichNeedsContext,
              null,
              2,
            )}`,
          );
          const { subject } = statementWhichNeedsContext;
          const contextQuery = queryTemplate(subject);
          const context = await findContext(contextQuery);
          withContext.inserts.push(...context);
        }
      }
    }
  }
  return changeSetsWithContext;
}

async function exhaustiveAddTypes(statements, typeCache) {
  let subjects = [
    ...new Set([...statements.map((statement) => statement.subject)]),
  ];

  for (const subject of subjects) {
    // query the triplestore for the type and add it to the cache
    const types = await findSubjectTypes(subject);
    if (types.length) {
      types.forEach((typeStatement) => {
        typeCache.add(subject, typeStatement.object);
      });
      statements.push(...typeCache.get(subject));
    }
  }
  return statements;
}

async function nonExhaustiveAddTypes(statements, typeCache) {
  let subjects = [
    ...new Set([...statements.map((statement) => statement.subject)]),
  ];

  for (const subject of subjects) {
    if (
      !statements.find(
        (c) => c.subject === subject && c.predicate === RDF_TYPE_URI,
      )
    ) {
      // subject does not have a type
      // check if the type is in the typeCache
      if (typeCache.has(subject)) {
        statements.push(...typeCache.get(subject));
      } else {
        // query the triplestore for the type and add it to the cache
        const types = await findSubjectTypes(subject);
        if (types.length) {
          types.forEach((typeStatement) => {
            typeCache.add(subject, typeStatement.object);
          });
          statements.push(...typeCache.get(subject));
        }
      }
    }
  }
  return statements;
}

/**
 * @param {Array} insertsWithContext
 * @param {Array} originalInserts
 * @returns {Array} insertsWithContext extended with the properties and objects found in the landing zone.
 *
 * We need to fetch all properties and objects for a subject in a landing zone on inserts
 * because the order of inserts is not guaranteed.
 * If we don't do this, we will miss context for subjects which have already been inserted before
 * the rdf:type statement for the subject arrived in a delta message.
 * The same holds when an additional datatype is added to a subject.
 * This might lead to redundant inserts - depending on the custom consumer logic.
 */
async function triggerOnNewRDFTypeStatements(
  insertsWithContext,
  originalInserts,
) {
  const newRDFTypeStatements = originalInserts.filter(
    (statement) => statement.predicate === RDF_TYPE_URI,
  );
  if (newRDFTypeStatements.length) {
    const subjects = [
      ...new Set(newRDFTypeStatements.map((statement) => statement.subject)),
    ];
    const contextQuery = rdfTypeContextQueryTemplate(subjects);
    const context = await findContext(contextQuery);
    console.log(
      `Looking for context for new RDF type statements: ${JSON.stringify(
        newRDFTypeStatements,
        null,
        2,
      )}`,
    );
    console.log(`context: ${JSON.stringify(context, null, 2)}`);
    insertsWithContext.push(...context);
  } else {
    console.log('No new RDF type statements found');
  }
  return insertsWithContext;
}

const rdfTypeContextQueryTemplate = (subjects) => `
  CONSTRUCT {
    ?subject ?predicate ?object
  } WHERE {
    GRAPH <${LANDING_ZONE_GRAPH}> {
      VALUES ?subject {
        ${subjects.join('\n      ')}
      }
      ?subject ?predicate ?object.
    }
  }`;

/**
 * Compile the context configuration to replace the prefixes with the base URIs
 * @param {Object} contextConfigurationModule
 * @method compileContextConfiguration
 * @return {Object} compiled context configuration
 * */
async function compileContextConfiguration(contextConfigurationModule) {
  const contextConfiguration = await contextConfigurationModule;
  console.log('Compiling context configuration');

  const { PREFIXES, contextConfig } = contextConfiguration;
  const { addTypes, contextQueries } = contextConfig;

  if (!PREFIXES) {
    console.log('No PREFIXES defined in the context configuration.');
  }

  contextConfig.addTypes.scope = addTypes.scope.toLowerCase() || 'none';
  contextConfig.addTypes.exhausitive = addTypes.exhausitive || false;

  if (!['inserts', 'deletes', 'all', 'none'].includes(addTypes.scope)) {
    throw new Error(`Invalid addTypes scope: ${addTypes.scope}`);
  }

  const parser = new Parser();
  let prefixes;

  if (PREFIXES) {
    prefixes = parser.parse(PREFIXES).prefixes;
  } else {
    prefixes = [];
  }

  for (let cq of contextQueries) {
    for (let [key, value] of Object.entries(cq.trigger)) {
      let t = value;
      for (const [prefix, baseUri] of Object.entries(prefixes)) {
        let re = new RegExp(`^${prefix}:`);
        t = t.replace(re, baseUri);
      }
      cq.trigger[key] = sparqlEscapeUri(t);
    }
  }
  console.log(`compiled config:\n${JSON.stringify(contextConfig, null, 2)}`);
  return contextConfig;
}

// Triggers if either the subject is of the given type or the predicate is the given predicate
const contextTriggerFilter = (trigger) => (statement, index, array) => {
  const { subjectType, predicateValue } = trigger;
  const { subject, predicate, object } = statement;

  let condition =
    (subjectType && predicate === RDF_TYPE_URI && object === subjectType) ||
    (predicateValue && predicate === predicateValue);

  if (condition) {
    console.log(
      `Trigger matched: statement ${JSON.stringify(
        statement,
        null,
        2,
      )} matches trigger ${JSON.stringify(trigger, null, 2)}`,
    );
    // } else {
    //   console.log(`!!!! NO MATCH !!!! statement ${JSON.stringify(statement, null, 2)} does not match trigger ${JSON.stringify(trigger, null, 2)}`);
  }

  return condition;
};

// QUERYING THE TRIPLESTORE
const subjectTypeQuery = (graph, subject) => `
SELECT DISTINCT ?subject ?type
FROM <${graph}>
WHERE {
  VALUES ?subject {
    ${subject}
  }
  ?subject a ?type
}`;

async function findSubjectTypes(subject) {
  try {
    const response = await querySudo(
      subjectTypeQuery(LANDING_ZONE_GRAPH, subject),
      {},
      { sparqlEndpoint: LANDING_ZONE_DATABASE_ENDPOINT, mayRetry: true },
    );
    console.log(`type query response: ${JSON.stringify(response)}`);

    if (response.results.bindings.length) {
      return response.results.bindings.map((r) => ({
        graph: sparqlEscapeUri(LANDING_ZONE_GRAPH),
        subject: sparqlEscapeUri(r.subject.value),
        predicate: sparqlEscapeUri(RDF_TYPE),
        object: sparqlEscapeUri(r.type.value),
      }));
    } else {
      console.log(
        `Warning: No types found for subject: ${subject}\nThis information will probably available in a later delta message.`,
      );
      return [];
    }
  } catch (err) {
    throw new Error(`Error while querying for types: ${err} `);
  }
}

async function findContext(query) {
  try {
    const response = await querySudo(
      query,
      {},
      { sparqlEndpoint: LANDING_ZONE_DATABASE_ENDPOINT, mayRetry: true },
    );
    console.log(`context query response: ${JSON.stringify(response)}`);

    return toTermObjectArray(
      response.results.bindings.map(({ s, p, o }) => ({
        graph: {
          value: LANDING_ZONE_GRAPH,
          type: 'uri',
        },
        subject: s,
        predicate: p,
        object: o,
      })),
    );
  } catch (err) {
    throw new Error(
      `Error while executing construct query for additional context: ${err} `,
    );
  }
}

export async function deleteFromLandingZoneGraph(statements) {
  return await deleteFromGraph(
    statements,
    LANDING_ZONE_DATABASE_ENDPOINT,
    LANDING_ZONE_GRAPH,
  );
}

export async function insertIntoLandingZoneGraph(statements) {
  return await insertIntoGraph(
    statements,
    LANDING_ZONE_DATABASE_ENDPOINT,
    LANDING_ZONE_GRAPH,
  );
}
