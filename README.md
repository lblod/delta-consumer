# delta-consumer

## Intro

Extendable consumer to sync data from external sources based on diff files generated by a producer.

It does two things:

- Initial sync by getting dump files to ingest, and this happens on service startup. (This occurs only once if enabled.)
- Delta sync at regular intervals, where the consumer checks for new diff files and loads the retrieved data.

By default, the delta-consumer will use the fetched information to maintain an ingest graph.

However, custom ingestion rules are perfectly possible. Read along if you want to know how you can achieve this.
'Triples-dispatching' is the term we will use when moving triples to the correct place.

Refer to section `Turorials` for the quickstart.

### Disclaimer
This service has grown a lot over time -organically-, and we totally get that it’s not the easiest to jump into with all the different settings. We’re working on making it better, so thanks for sticking with us.
In the meantime, check out the tutorials or reach out if you need a hand.
It’s being used in a bunch of apps now, and if it’s not working for you, it might just be one of the many settings that got missed.
We’ll figure it out together.

## Tutorials

### I'm in a hurry and just want to get started.

Getting started indeed consumes (no pun intended) some brain space. Let's try to bundle these cases in the following section:

#### I cloned an existing stack with a configured consumer, and I just want it to start consuming. I have no clue how.

Always ensure your migrations have run!

Then you can try to put the following in your `docker-compose.override.yml` file?
```yaml
  the-name-of-the-consumer:
    environment:
      DCR_DISABLE_INITIAL_SYNC: "false"
      DCR_DISABLE_DELTA_INGEST: "false"
```

#### I have an endpoint with deltas and just want to start consuming it. I don't care about bells and whistles.

```yaml
  quickstart-consumer:
    image: lblod/delta-consumer:latest
    environment:
      DCR_SERVICE_NAME: "quickstart-consumer"
      DCR_SYNC_BASE_URL: 'https://loket.lokaalbestuur.vlaanderen.be' # The host where the delta-files may be found.
      DCR_SYNC_FILES_PATH: "/sync/mandatarissen/files" # The api-path where the delta-files may be found on the producer.
      DCR_DELTA_SYNC_JOB_OPERATION: 'http://redpencil.data.gift/id/jobs/concept/JobOperation/deltas/quickstart-consumer'
      DCR_JOB_CREATOR_URI: 'http://data.lblod.info/services/id/quickstart-consumer'
      DCR_START_FROM_DELTA_TIMESTAMP: "2023-12-01" # From where it should start syncing in time; left empty it starts from "now".
                                                   # Hence, very likely if you start it without this value, it won't consume anything.
                                                   # Because producer hasn't produced anything yet.
      DCR_WAIT_FOR_INITIAL_SYNC: "false"
      DCR_DISABLE_INITIAL_SYNC: "true"
```
This should start the consumer. This skips a lot of steps, such as the initial sync, but at least you will see things happening. If you thought, 'Oh, let's sync from `1970-01-01`,' it will take ages to complete.


###  I'm not in a hurry.

#### Add the service to a stack, with default behaviour.

The default behaviour fetches the information from the producer and maintains a single ingest graph.
To add this behaviour to your stack:

Add the following to your `docker-compose.yml`:

```yaml
consumer:
  image: lblod/delta-consumer
  environment:
    DCR_SERVICE_NAME: 'your-custom-consumer-identifier' # replace with the desired consumer identifier
    DCR_SYNC_BASE_URL: 'http://base-sync-url' # replace with link the application hosting the producer server
    DCR_SYNC_DATASET_SUBJECT: 'http://data.lblod.info/datasets/delta-producer/dumps/CacheGraphDump'
    DCR_INITIAL_SYNC_JOB_OPERATION: 'http://redpencil.data.gift/id/jobs/concept/JobOperation/deltas/consumer/xyzInitialSync'
    DCR_DELTA_SYNC_JOB_OPERATION: 'http://redpencil.data.gift/id/jobs/concept/JobOperation/deltas/consumer/xyzDeltaFileSyncing'
    DCR_JOB_CREATOR_URI: 'http://data.lblod.info/services/id/consumer'
    INGEST_GRAPH: 'http://uri/of/the/graph/to/ingest/the/information'
```

#### Add the service to a stack with custom behaviour.

This service assumes hooks, where you can inject custom code.

For your convenience, we've added an example custom hook in `./triples-dispatching/example-custom-dispatching`.

1. Copy the folder `example-custom-dispatching` into `config/consumer/`
2. Add the following to your `docker-compose.yml`:

```yaml
consumer:
  image: lblod/delta-consumer
  environment:
    DCR_SERVICE_NAME: 'your-custom-consumer-identifier' # replace with the desired consumer identifier
    DCR_SYNC_BASE_URL: 'http://base-sync-url' # replace with link the application hosting the producer server
    DCR_SYNC_DATASET_SUBJECT: 'http://data.lblod.info/datasets/delta-producer/dumps/CacheGraphDump'
    DCR_INITIAL_SYNC_JOB_OPERATION: 'http://redpencil.data.gift/id/jobs/concept/JobOperation/deltas/consumer/xyzInitialSync'
    DCR_DELTA_SYNC_JOB_OPERATION: 'http://redpencil.data.gift/id/jobs/concept/JobOperation/deltas/consumer/xyzDeltaFileSyncing'
    DCR_JOB_CREATOR_URI: 'http://data.lblod.info/services/id/consumer'
  volumes:
    - ./config/consumer/example-custom-dispatching:/config/triples-dispatching/custom-dispatching
```

3. Start the stack. The console will print the fetched information from the producer.

Please read further to find out more about the API of the hooks.

#### Add the service to stack with delta context and custom behaviour (mapping and filtering through a reasoner service).

> [!NOTE]
> Consider using SPARQL mapping instead due to known issues with delete deletas.

This is just one example where the delta context is necessary. The delta context is a way to provide extra information for custom triples-dispatching.

In this example, we will use the delta context to map and filter the incoming triples. The mapping and filtering is done by a [reasoning service](https://github.com/eyereasoner/reasoning-service).

For your convenience, we've added an example custom hook in `./triples-dispatching/example-custom-dispatching-reasoning-with-context`.

1. Copy the folder `example-custom-dispatching-reasoning-with-context/consumer/` into `config/consumer/`
2. Copy the folder
   ``example-custom-dispatching-reasoning-with-context/consumer/reasoner/` into `config/reasoner/`
3. Add the following to your `docker-compose.yml`:

```yaml
consumer:
  image: lblod/delta-consumer
  environment:
    DCR_SERVICE_NAME: 'your-custom-consumer-identifier' # replace with the desired consumer identifier
    DCR_SYNC_BASE_URL: 'http://base-sync-url' # replace with link the application hosting the producer server
    DCR_SYNC_DATASET_SUBJECT: 'http://data.lblod.info/datasets/delta-producer/dumps/CacheGraphDump'
    DCR_INITIAL_SYNC_JOB_OPERATION: 'http://redpencil.data.gift/id/jobs/concept/JobOperation/deltas/consumer/xyzInitialSync'
    DCR_DELTA_SYNC_JOB_OPERATION: 'http://redpencil.data.gift/id/jobs/concept/JobOperation/deltas/consumer/xyzDeltaFileSyncing'
    DCR_JOB_CREATOR_URI: 'http://data.lblod.info/services/id/consumer'
    BYPASS_MU_AUTH_FOR_EXPENSIVE_QUERIES: 'true'
    REMAPPING_GRAPH: 'http://graph/to/receive/the/processed/triples'
  volumes:
    - ./config/consumer/example-custom-dispatching:/config/triples-dispatching/custom-dispatching
reasoner:
  image: eyereasoner/reasoning-service:1.0.1
  volumes:
    - ./config/reasoner:/config
```

3. Start the stack. The console will print the fetched information from the producer.

When adding rules and queries to the reasoner, make sure the required context is configured for pattern in the premise.:

- Make sure to enable `addTypes` in the `delta-context-config.js` file. For rules with and `rdf:type` in the premise. e.g.

```
  {
    ?s
      a ex:foo;
      ex:bar ?o.
  } => {
    ?s ex:baz ?o.
  }.
```

- add custom context to the `delta-context-config.js` file for more complex patterns in the premise. e.g.

```
  {
    ?s
      a ex:foo;
      ex:bar ?bar.
      ex:classification ?classification.
    ?bar
      rdfs:label ?barLabel.
    ?classification
      skos:prefLabel ?classificationLabel.
    (?classificationLabel ?barLabel) string:concatenation ?prefLabel.
  } => {
    ?s skos:prefLabel ?prefLabel.
  }.
```

Note: there are multiple triggers for the same pattern in `delta-context-config.js` because the order of the delta messages is undetermined. When inserting new triples, there will only be sufficient context to execute the rule when the last part of the pattern arrives in a delta message. This might lead to mu

#### Add the service to a stack with SPARQL mapping

> [!WARNING]
> Please read the best practices even when you're familiar with SPARQL CONSTRUCT queries. The mapping of DELETE deltas might have some counterintuitive behaviour.

There's an example configuration provided in `triples-dispatching/example-custom-distpatching-sparql`. This configuration consumes and maps `lblod/app-organization-portal`

1. Copy the folder `triples-dispatching/example-custom-distpatching-sparql` into `config/consumer/`
2. Add the following to your `docker-compose.yml`:

```yaml
image: lblod/delta-consumer
    environment:
      DCR_SYNC_BASE_URL: "https://organisaties.abb.lblod.info"
      # DCR_SYNC_BASE_URL: "https://organisaties.abb.vlaanderen.be"
      DCR_SERVICE_NAME: "op-consumer"
      DCR_SYNC_FILES_PATH: "/sync/organizations-public-info/files"
      DCR_SYNC_DATASET_SUBJECT: "http://data.lblod.info/datasets/delta-producer/dumps/OrganizationsPublicInfoCacheGraphDump"
      DCR_INITIAL_SYNC_JOB_OPERATION: "http://redpencil.data.gift/id/jobs/concept/JobOperation/deltas/consumer/op"
      DCR_DELTA_SYNC_JOB_OPERATION: "http://redpencil.data.gift/id/jobs/concept/JobOperation/deltas/consumer/opDeltaFileSyncing"
      DCR_JOB_CREATOR_URI: "http://data.lblod.info/services/id/op-consumer"
      DCR_KEEP_DELTA_FILES: "true"
      DCR_DELTA_FILE_FOLDER: "/consumer-files"
      DCR_DISABLE_DELTA_INGEST: "false"
      DCR_DISABLE_INITIAL_SYNC: "false"
      DCR_WAIT_FOR_INITIAL_SYNC: "true"
      BYPASS_MU_AUTH_FOR_EXPENSIVE_QUERIES: "true"
      DCR_REMAPPING_DATABASE: "virtuoso"
      DCR_ENABLE_TRIPLE_REMAPPING: "true"
      DCR_LANDING_ZONE_GRAPH: "http://mu.semte.ch/graphs/op-consumer-test
      DCR_REMAPPING_GRAPH: "http://mu.semte.ch/graphs/op-consumer-test-transformed"
    volumes:
      - ./config/delta-consumer/mapping:/config/mapping
      - ./config/delta-consumer/example-custom-distpatching-sparql:/config/triples-dispatching/custom-dispatching
```

## Configuration

### Environment variables

#### What's with the weird variables names?

When accessing `process.env`, we distinguish between core service environment variables and triples-dispatching variables.

Variables prefixed with `DCR_` belong to the core. `DCR` could be an abbreviation for `delta-consumer`.
Custom logic for triples-dispatching should not access these directly, at the risk of breaking if the service evolves.
If you want to extend the variables in the core, make sure to respect the convention.

#### Core

The following environment variables are required:

- `DCR_SERVICE_NAME`: consumer identifier. important as it is used to ensure persistence. The identifier should be unique within the project. [REQUIRED]
- `DCR_SYNC_BASE_URL`: Base URL of the stack hosting the producer API [REQUIRED]
- `DCR_JOB_CREATOR_URI`: URL of the creator of the sync jobs [REQUIRED]
- `DCR_DELTA_SYNC_JOB_OPERATION`: Job operation of the delta sync job, used to describe the created jobs [REQUIRED]
- `DCR_SYNC_DATASET_SUBJECT`: subject used when fetching the dataset [REQUIRED BY DEFAULT]
- `DCR_INITIAL_SYNC_JOB_OPERATION`: Job operation of the initial sync job, used to describe the created jobs [REQUIRED BY DEFAULT]

To overrule the last two default required settings, and thus just ingest delta files, set `DCR_WAIT_FOR_INITIAL_SYNC: false` and `DCR_DISABLE_INITIAL_SYNC: true`.

The following environment variables are optional:

- `DCR_SYNC_FILES_PATH (default: /sync/files)`: relative path to the endpoint to retrieve the meta-data from the diff-files. Note: often, you will need to change this one.
- `DCR_DOWNLOAD_FILES_PATH (default: /files/:id/download)`: relative path to the endpoint to download a diff file
  from. `: id` will be replaced with the UUID of the file.
- `DCR_CRON_PATTERN_DELTA_SYNC (default: 0 * * * * *)`: cron pattern at which the consumer needs to sync data automatically.
- `DCR_START_FROM_DELTA_TIMESTAMP (ISO DateTime)`: timestamp to start sync data from (e.g. "2020-07-05T13:57:36.344Z") Only required when initial ingest hasn't run.
- `DCR_DISABLE_INITIAL_SYNC (default: false)`: flag to disable initial sync
- `DCR_DISABLE_DELTA_INGEST (default: false)`: flag to disable data ingestion, for example, while initializing the sync
- `DCR_WAIT_FOR_INITIAL_SYNC (default: true)`: flag to not wait for initial ingestion (meant for debugging)
- `DCR_KEEP_DELTA_FILES (default: false)`: if you want to keep the downloaded delta-files (ease of troubleshooting)
- `DCR_DELTA_JOBS_RETENTION_PERIOD (default: -1)`: number of days to keep delta files, a value of -1 means all files will be retained.
- `DCR_CRON_PATTERN_DELTA_CLEANUP (default: 0 0 * * * *)`: cron pattern at which the consumer needs to clean up data automatically.

The following environment variables are optional and only necessary if the delta-producer-publication-graph-maintainer requires authentication:

- `DCR_SYNC_LOGIN_ENDPOINT`: the login endpoint as full url
- `DCR_SECRET_KEY`: the login key

Delta context variables:

- `DCR_ENABLE_DELTA_CONTEXT (default: false)`
- `DCR_LANDING_ZONE_GRAPH (default: http://mu.semte.ch/graphs/system/landingzone)`: Graph which maintains a mirror copy of the data-sources producer graph. It is the result of all the incoming insert/delete statements without any mapping or filtering. This graph is used to lookup context.
- `DCR_LANDING_ZONE_DATABASE (default: database)`: consider using a different triplestore than the main application database.
- `DCR_LANDING_ZONE_DATABASE_ENDPOINT (default: http://${DCR_LANDING_ZONE_DATABASE}:8890/sparql`) : the url of a sparql endpoint - overrules the `DCR_LANDING_ZONE_DATABASE` variable.

SPARQL mapping variables:

- `DCR_ENABLE_TRIPLE_REMAPPING (default: false)`: enable the SPARQL mapping feature.
- `DCR_LANDING_ZONE_GRAPH (default: http://mu.semte.ch/graphs/system/landingzone)`: Graph which maintains a mirror copy of the data-sources producer graph. It is the result of all the incoming insert/delete statements without any mapping or filtering.
- `DCR_REMAPPING_GRAPH (default: http://mu.semte.ch/graphs/consumer-transformed)`: Graph where the remapped triples are stored.
- `DCR_REMAPPING_DATABASE (default: database)`: consider using a different triplestore than the main application database.
- `DCR_REMAPPING_DATABASE_ENDPOINT (default: http://${DCR_REMAPPING_DATABASE}:8890/sparql`) : the url of a sparql endpoint - overrules the `DCR_REMAPPING_DATABASE` variable.
- `DCR_MAPPING_QUERY_FOLDER (default: /config/mapping)`: the path where the mapping queries are stored.
- `DCR_DIRECT_EXECUTE_EXPENSIVE_QUERIES (default: true)`: execute expensive queries directly on the triplestore. i.e. bypass mu-auth or sparql-parser.
- `DCR_DIRECT_REMAPPING_DATABASE (default: virtuoso)`: the name of the database where the remapping graph is stored. This is used when the remapping graph is stored in a different database than the main application database.
-

#### Triples dispatching: single graph ingestion (default behaviour)

- `INGEST_GRAPH (default: http://mu.semte.ch/graphs/public)`: graph in which all insert changesets are ingested
- `BATCH_SIZE (default: 100)`: Size of the batches to ingest in DB
- `BYPASS_MU_AUTH_FOR_EXPENSIVE_QUERIES (default: false)`: (see code where it is called) This has repercussions! Know what you do!
- `DIRECT_DATABASE_ENDPOINT (default: http://virtuoso:8890/sparql)`: only used when BYPASS_MU_AUTH_FOR_EXPENSIVE_QUERIES is set to true
- `MU_CALL_SCOPE_ID_INITIAL_SYNC (default: 'http://redpencil.data.gift/id/concept/muScope/deltas/consumer/initialSync)'`: A scope that can be set to refine dispatching rules of the (internal) deltanotifier. This variable is relevant during the initial sync.
- `MAX_DB_RETRY_ATTEMPTS (defaut: 5)`: Max DB retries in case of issues.
- `SLEEP_BETWEEN_BATCHES (default: 1000 ms)`: To not overload the system, every batch is paused.
- `SLEEP_TIME_AFTER_FAILED_DB_OPERATION (default: 60000 ms)`: In case of failure during a DB operation, execution between retries is paused for a while.

## Delta Message Context - :warning: EXPERIMENTAL

:warning: This feature might be subject to non-backward compatible changes in the future.

The content of a delta message is not always sufficient to know how to process the delta.

e.g. it could contain information such as inserting `<something> skos:prefLabel "foo"`. The action needed for this might depend on the `rdf:type` of the subject or require information to, e.g., create a new label.

To solve this, the delta-consumer provides both the original content of the delta message and the extended statements with context.

The context is configured through `delta-context-config.js`, which is covered in more detail in the Tutorial section.

The `DCR_LANDING_ZONE_GRAPH` is maintained by the delta-producer when this feature is enabled and contains all the triples from the data-sources producer graph without any filtering or other changes. This graph is used to look up context and can be offloaded to a different triplestore than the main application database by providing the `DCR_LANDING_ZONE_DATABASE` environment variable.

### Delta Message - SPARQL Mapping - :warning: EXPERIMENTAL

The delta-consumer facilitates the mapping of incoming messages to a different model. This is achieved by providing SPARQL queries in the configuration directory. These queries are executed on the landing zone graph, and the results are used to update the target graph.

Each triple from the delta message is processed individually.

> [!WARNING]
> Custom dispatching is **not** supported when using SPARQL mapping. i.e., the `dispatch` function will not be called. The `onFinish` hook after the initial sync is still available.

#### Delete Operations

When a delete occurs that breaks the `WHERE` part of a query, the entire matching `CONSTRUCT` clause is deleted from the target graph. See [avoiding unintended deletes](#avoiding-unintended-deletes).

1. **Match queries for the statement.**
2. **Delete resulting triples from the target graph:**
   - The `CONSTRUCT` template is translated into a `DELETE` clause.
   - The `WHERE` clause:
     - Matching variables are bound to delta message values.
     - The triple pattern is scoped to the landing zone graph.
3. **Delete the original triple from the landing zone.**

#### Insert Operations

1. **Insert the original triple into the landing zone.**
2. **Match queries for the statement.**
3. **Insert resulting triples into the target graph:**
   - The `CONSTRUCT` template is translated into an `INSERT` clause.
   - The `WHERE` clause:
     - Matching variables are bound to delta message values.
     - The triple pattern is scoped to the landing zone graph.

#### How Queries Are Matched with Triples

All incoming delta triples (insert or delete) are processed one by one. The mapping queries are filtered based on whether the delta triple matches any triple patterns in the basic graph pattern of the `WHERE` clause. **Only simple triple patterns are considered at this stage. Filters, subqueries, variable bindings, property paths, etc., are not yet supported and might cause unexpected behavior.**

**Example Delta Triple:**

```SPARQL
<http://example.org/subject#123> <http://example.org/property#foo> "bar".
```

**Example Matching Queries:**

```SPARQL
CONSTRUCT {
  ?s ?p ?o
} WHERE {
  ?s ?p ?o.
}
```

```SPARQL
CONSTRUCT {
  ?s <http://example.org/property#baz> ?baz.
} WHERE {
  ?s <http://example.org/property#foo> ?foo.
  ?foo <http://example.org/property#bar> ?baz.
}
```

Once a match is identified, the delta triple values are bound to the respective variables, and the `INSERT` or `DELETE` query is executed against the target graph on the triplestore.

For `DELETE` queries, the subject, predicate, and object of the delta triple are bound to the respective variables in the `WHERE` clause. The `CONSTRUCT` template is translated to a `DELETE` clause, and the resulting triples are deleted from the target graph.

For `INSERT` queries, only the subject of the delta triple is bound to the respective variable in the `WHERE` clause. The `CONSTRUCT` template is translated to an `INSERT` clause, and the resulting triples are inserted into the target graph.

### API

There is a little debugger API available. Please check `app.js` to see how it works.

### Model

#### prefixes

```
  PREFIX mu: <http://mu.semte.ch/vocabularies/core/>
  PREFIX task: <http://redpencil.data.gift/vocabularies/tasks/>
  PREFIX dct: <http://purl.org/dc/terms/>
  PREFIX prov: <http://www.w3.org/ns/prov#>
  PREFIX nie: <http://www.semanticdesktop.org/ontologies/2007/01/19/nie#>
  PREFIX ext: <http://mu.semte.ch/vocabularies/ext/>
  PREFIX oslc: <http://open-services.net/ns/core#>
  PREFIX cogs: <http://vocab.deri.ie/cogs#>
  PREFIX adms: <http://www.w3.org/ns/adms#>
```

#### Job

The instance of a process or group of processes (workflow).

##### class

`cogs:Job`

##### properties

| Name     | Predicate      | Range         | Definition |
| -------- | -------------- | ------------- | ---------- |
| uuid     | mu:uuid        | xsd:string    |
| creator  | dct:creator    | rdfs:Resource |
| status   | adms:status    | adms:Status   |
| created  | dct:created    | xsd:dateTime  |
| modified | dct:modified   | xsd:dateTime  |
| jobType  | task:operation | skos:Concept  |
| error    | task:error     | oslc:Error    |

#### Task

Subclass of `cogs:Job`

##### class

`task:Task`

##### properties

| Name             | Predicate             | Range             | Definition                                                |
| ---------------- | --------------------- | ----------------- | --------------------------------------------------------- |
| uuid             | mu:uuid               | xsd:string        |
| status           | adms:status           | adms:Status       |
| created          | dct:created           | xsd:dateTime      |
| modified         | dct:modified          | xsd:dateTime      |
| operation        | task:operation        | skos:Concept      |
| index            | task:index            | xsd:string        | May be used for orderering. E.g. : '1', '2.1', '2.2', '3' |
| error            | task:error            | oslc:Error        |
| parentTask       | cogs:dependsOn        | task:Task         |
| job              | dct:isPartOf          | rdfs:Resource     | Refer to the parent job                                   |
| resultsContainer | task:resultsContainer | nfo:DataContainer | An generic type, optional                                 |
| inputContainer   | task:inputContainer   | nfo:DataContainer | An generic type, optional                                 |

#### DataContainer

A generic container gathering information about what has been processed. The consumer needs to determine how to handle it.
The extensions created by this service are rather at hoc, i.e. `ext:` namespace
See also: [job-controller-service](https://github.com/lblod/job-controller-service) for a more standardized use.

##### class

`nfo:DataContainer`

##### properties

| Name                  | Predicate                 | Range                                      | Definition                                  |
| --------------------- | ------------------------- | ------------------------------------------ | ------------------------------------------- |
| uuid                  | mu:uuid                   | xsd:string                                 |
| subject               | dct:subject               | skos:Concept                               | Provides some information about the content |
| hasDeltafileTimestamp | ext:hasDeltafileTimestamp | timestamp from the processed deltafile     |
| hasDeltafileId        | ext:hasDeltafileId        | id from the processed deltafile            |
| hasDeltafileName      | ext:hasDeltafileName      | Name on disk about the processed deltafile |

#### Error

##### class

`oslc:Error`

##### properties

| Name    | Predicate    | Range      | Definition |
| ------- | ------------ | ---------- | ---------- |
| uuid    | mu:uuid      | xsd:string |
| message | oslc:message | xsd:string |

### Data flow

#### Initial sync

Finds the latest dcat:Dataset a sync point to ingest. Once done, it proceeds in delta-sync mode.
See also [delta-producer-dump-file-publisher](https://github.com/lblod/delta-producer-dump-file-publisher).

**LIMITATION:** The initial sync will only work with files with plain N3 triples.

#### Delta-sync

At regular intervals, the service will schedule a sync task. Execution of a task consists of the following steps:

1. Retrieve the timestamp to start the sync from
2. Query the producer service for all diff files since that specific timestamp
3. Download the content of each diff file
4. Process each diff file in order

During the processing of a diff file, the insert and delete changesets are processed.
The behaviour depends on the 'triples-dispatching'-logic, by default we have:

**Delete changeset**
Apply a delete query triple per triple in the graph `INGEST_GRAPH`.

**Insert changeset**
Ingest the changeset in the graph `INGEST_GRAPH`.

If the ingestion of one file fails, the service will block the queued files. The service must process the files in order of publication.

The service makes two core assumptions that must be respected at all times:

1. At any moment, we know that the latest `ext:hasDeltafileTimestamp` timestamp on the resultsContainer of a task OR if not found -because initial sync has been disabled- provided from `DCR_START_FROM_DELTA_TIMESTAMP`
   This reflects the timestamp of the latest delta file that has been completely and successfully consumed.
2. Maximum 1 sync task is running at any moment in time

### Migrating from [delta-consumer-single-graph-maintainer](https://github.com/lblod/delta-consumer-single-graph-maintainer) to this service

The model to keep track of the processed data changed.
It is only required to provide `DCR_START_FROM_DELTA_TIMESTAMP` as a correct starting point.

Migrating is not required but advised. The following options are:

#### Cleaning up previous tasks

In case it doesn't really make sense to keep this information.

```
PREFIX ext: <http://mu.semte.ch/vocabularies/ext/>
DELETE {
  GRAPH ?g {
    ?s ?p ?o.
  }
}
WHERE {
  ?s a ext:SyncTask.
  GRAPH ?g {
    ?s ?p ?o.
  }
}
```

#### Migrate ext:SyncTask to cogs:Job

TODO...

## Adding custom triples-dispatching

### flow

By default, the service will look first for custom triples-dispachting, and if not found, load the default behaviour.

### file and folder names

Refer to `./triples-dispatching/example-custom-dispatching` for the naming convention of the files.
A folder `/config/custom-dispatching` should be mounted

### API

#### initial sync

A function with signature `dispatch(lib, data)` should be exported. The documentation states:

```
 * @param { mu, muAuthSudo } lib - The provided libraries from the host service.
 * @param { termObjects } data - The fetched quad information, which objects of serialized Terms
 *          [ {
 *              graph: "<http://foo>",
 *              subject: "<http://bar>",
 *              predicate: "<http://baz>",
 *              object: "<http://boom>^^<http://datatype>"
 *            }
 *         ]
 * @return {void} Nothing
```

#### delta sync

A function with signature `dispatch(lib, data)` should be exported. The documentation states:

```
 * @param { mu, muAuthSudo } lib - The provided libraries from the host service.
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
```

#### Extra notes

- The API is deliberately limited. We provide a minimal toolset to CRUD the database, which limits the chances we don't regret our choices later and break existing implementations.
  Hence, only `mu, muAuthSudo ` are provided for now. Adding libraries should be done under careful consideration. (It is still extendable)

- Custom triples-dispatching allow their environment variables. Make sure to respect the convention, to differentiate core from custom.
  As an inspiration, check `single-graph-dispatching` for complex dispatching rules.

- Currently, `import` statements don't work in custom triples-dispatching. Hence you will have to stay in the `require` world.
