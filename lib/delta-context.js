import {
  sparqlEscapeUri
} from 'mu';
import {
  INGEST_DATABASE_ENDPOINT,
  INGEST_GRAPH
} from '../config';
import {
  RDF_TYPE_URI,
  RDF_TYPE
} from './constants';
import { deltaContextConfiguration } from '../triples-dispatching';
import { Parser } from 'sparqljs';
import { querySudo, updateSudo } from '@lblod/mu-auth-sudo';
import { toTermObjectArray } from './utils';
import TypeCache from './type-cache';

const contextConfig = compileContextConfiguration(deltaContextConfiguration);

/**
 * Adds context to the changeSets based on the configuration
 * An ingest graph is maintained to keep track of the inserted and deleted triples in order to
 * determine be able to determine the context of the triples.
 *
 * @param {Object} changeSets
 * @return {Object} changeSetsWithContext with context
 *
 */
export async function addContext(changeSets) {

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
    withContext: changeSetsWithContext[i]
  }));

  console.log(`original changeSets: ${JSON.stringify(changeSetsWithContext, null, 2)}`)

  let typeCache = new TypeCache(changeSetsWithContext);

  for (let { original, withContext } of zippedChangeSets) {
    if (withContext.deletes.length > 0) {
      // add types
      if (scope === 'all' || scope === 'deletes') {
        if (exhausitive) {
          withContext.deletes = await exhaustiveAddTypes(withContext.deletes, typeCache);
        } else {
          withContext.deletes = await nonExhaustiveAddTypes(withContext.deletes, typeCache);
        }
      }

      for (let { trigger, queryTemplate } of contextQueries) {
        // console.log(`trigger: ${JSON.stringify(trigger, null, 2)}`)
        // console.log(`deletes: ${JSON.stringify(deletes, null, 2)}`)

        const deletesNeedingContext = withContext.deletes.filter(contextTriggerFilter(trigger));
        for (const statementWhichNeedsContext of deletesNeedingContext) {
          console.log(`statementWhichNeedsContext: ${JSON.stringify(statementWhichNeedsContext, null, 2)}`)
          const { subject } = statementWhichNeedsContext;
          const contextQuery = queryTemplate(subject);
          const context = await findContext(contextQuery);
          withContext.deletes.push(...context);
        }
      }
      // remove from ingest graph
      await deleteFromIngestGraph(original.deletes);
    }

    // console.log(`trigger: ${JSON.stringify(trigger, null, 2)}`)
    // console.log(`inserts: ${JSON.stringify(inserts, null, 2)}`)

    if (withContext.inserts.length > 0) {
      // add to ingest graph
      await insertIntoIngestGraph(original.inserts);

      // add types
      if (scope === 'all' || scope === 'inserts') {
        if (exhausitive) {
          withContext.inserts = await exhaustiveAddTypes(withContext.inserts, typeCache);
        } else {
          withContext.inserts = await nonExhaustiveAddTypes(withContext.inserts, typeCache);
        }
      }

      for (let { trigger, queryTemplate } of contextQueries) {
        const insertsNeedingContext = withContext.inserts.filter(contextTriggerFilter(trigger));
        for (const statementWhichNeedsContext of insertsNeedingContext) {
          console.log(`statementWhichNeedsContext: ${JSON.stringify(statementWhichNeedsContext, null, 2)}`)
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
  let subjects = [...new Set([...statements.map((statement) => statement.subject)])];

  for (const subject of subjects) {
    // query the triplestore for the type and add it to the cache
    const types = await findSubjectTypes(subject);
    if (types.length) {
      typeCache.add(subject, ...types);
      statements.push(...typeCache.get(subject));
    }
  }
  return statements;
}

async function nonExhaustiveAddTypes(statements, typeCache) {
  let subjects = [...new Set([...statements.map((statement) => statement.subject)])];

  for (const subject of subjects) {
    if (!statements.find(c => c.subject === subject && c.predicate === RDF_TYPE_URI)) {
      // subject does not have a type
      // check if the type is in the typeCache
      if (typeCache.has(subject)) {
        statements.push(...typeCache.get(subject))
      } else {
        // query the triplestore for the type and add it to the cache
        const types = await findSubjectTypes(subject);
        if (types.length) {
          types.forEach(typeStatement => {
            typeCache.add(subject, typeStatement.object);
          });
          statements.push(...typeCache.get(subject));
        }
      }
    }
  };
  return statements;
}


/**
 * Compile the context configuration to replace the prefixes with the base URIs
 * @param {Object} contextConfiguration
 * @method compileContextConfiguration
 * @return {Object} compiled context configuration
 * */
function compileContextConfiguration(contextConfiguration) {
  console.log("Compiling context configuration");

  const { PREFIXES, contextConfig } = contextConfiguration;
  const { addTypes, contextQueries } = contextConfig;

  if (!PREFIXES) {
    console.log("No PREFIXES defined in the context configuration.");
  }

  contextConfig.addTypes.scope = addTypes.scope.toLowerCase() || "none";
  contextConfig.addTypes.exhausitive = addTypes.exhausitive || false;

  if (!["inserts", "deletes", "all", "none"].includes(addTypes.scope)) {
    throw new Error(`Invalid addTypes scope: ${addTypes.scope}`);
  }

  const parser = new Parser();
  const prefixes = parser.parse(PREFIXES).prefixes;

  for (let cq of contextQueries) {
    for (let [key, value] of Object.entries(cq.trigger)) {
      let t = value;
      for (const [prefix, baseUri] of Object.entries(prefixes)) {
        let re = new RegExp(`^${prefix}:`)
        t = t.replace(re, baseUri)
      }
      cq.trigger[key] = sparqlEscapeUri(t);
    }
  }
  console.log(`compiled config:\n${JSON.stringify(contextConfig, null, 2)}`)
  console.log(`compiled config first query:\n${contextConfig.contextQueries[0].queryTemplate('')}`)


  return contextConfig;
}


// Triggers if either the subject is of the given type or the predicate is the given predicate
const contextTriggerFilter = trigger => (statement, index, array) => {
  const { subjectType, predicateValue } = trigger;
  const { subject, predicate, object } = statement;

  let condition = (
    subjectType &&
    (
      predicate === RDF_TYPE_URI &&
      object === subjectType
    )
  ) ||
    (
      predicateValue &&
      (
        predicate === predicateValue
      )
    );

  if (condition) {
    console.log(`Trigger matched: statement ${JSON.stringify(statement, null, 2)} matches trigger ${JSON.stringify(trigger, null, 2)}`);
    // } else {
    //   console.log(`!!!! NO MATCH !!!! statement ${JSON.stringify(statement, null, 2)} does not match trigger ${JSON.stringify(trigger, null, 2)}`);
  }

  return condition;
}


// QUERYING THE TRIPLESTORE
const subjectTypeQuery = (graph, subject) => `
SELECT DISTINCT ?subject ?type
FROM <${graph}>
WHERE {
  VALUES ?subject {
    ${subject}
  }
  ?subject a ?type
}`

async function findSubjectTypes(subject) {
  try {
    const response = await querySudo(subjectTypeQuery(INGEST_GRAPH, subject), {}, INGEST_DATABASE_ENDPOINT);
    console.log(`type query response: ${JSON.stringify(response)}`);

    if (response.results.bindings.length) {
      return response.results.bindings.map(
        r => ({
          'graph': sparqlEscapeUri(INGEST_GRAPH),
          'subject': sparqlEscapeUri(r.subject.value),
          'predicate': sparqlEscapeUri(RDF_TYPE),
          'object': sparqlEscapeUri(r.type.value)
        })
      );
    } else {
      console.log(`Warning: No types found for subject: ${subject}\nThis information will probably available in a later delta message.`);
      return [];
    }
  } catch (err) {
    throw new Error(`Error while querying for types: ${err} `);
  }
}

async function findContext(query) {
  try {
    const response = await querySudo(query, {}, INGEST_DATABASE_ENDPOINT);
    console.log(`context query response: ${JSON.stringify(response)}`);

    return toTermObjectArray(response.results.bindings.map(
      ({ s, p, o }) => ({
        'graph': {
          'value': INGEST_GRAPH,
          'type': 'uri'
        },
        'subject': s,
        'predicate': p,
        'object': o
      })
    ));
  } catch (err) {
    throw new Error(`Error while executing construct query for additional context: ${err} `);
  }
}

const deleteQueryTemplate = (statements) => `
DELETE DATA {
  GRAPH <${INGEST_GRAPH}> {
    ${statementsToNTriples(statements)}
  }
}`;

const insertQueryTemplate = (statements) => `
INSERT DATA {
  GRAPH <${INGEST_GRAPH}> {
    ${statementsToNTriples(statements)}
  }
}`;

function statementsToNTriples(statements) {
  return [...new Set(statements)].map(
    ({ subject, predicate, object }) => `${subject} ${predicate} ${object} .`
  ).join('\n    ');
}


export async function deleteFromIngestGraph(statements) {
  console.log(`Deleting ${statements.length} statements from target graph`);
  console.log(`Statements:  ${JSON.stringify(statements)}`);

  return await retryPromiseWithDelay(
    updateSudo(deleteQueryTemplate(statements), {}, INGEST_DATABASE_ENDPOINT)
  );
}

export async function insertIntoIngestGraph(statements) {
  console.log(`Inserting ${statements.length} statements into target graph`);
  console.log(`Statements:  ${JSON.stringify(statements)}`);

  return await retryPromiseWithDelay(
    updateSudo(insertQueryTemplate(statements), {}, INGEST_DATABASE_ENDPOINT)
  );
}

// credit - based on: https://tusharf5.com/posts/retry-design-pattern-with-js-promises/
async function retryPromiseWithDelay(promise, nthTry = 5, delay = 30000) {
  try {
    const res = await promise;
    return res;
  } catch (e) {
    if (nthTry === 1) {
      return Promise.reject(e);
    }
    console.log('retrying', nthTry, 'time');
    // wait for before retrying
    await new Promise(resolve => setTimeout(resolve, delay));
    return retryPromiseWithDelay(promise, nthTry - 1, delay);
  }
}