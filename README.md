# delta-consumer-single-graph-maintainer

Configurable consumer to sync data from external sources based on diff files generated by a producer. An example
producer can be found [here](http://github.com/lblod/mandatendatabank-mandatarissen-producer).

It does two things:
- Initial sync by getting dump files to ingest. Happens on service startup, only once, and is mandatory
- Delta sync at regular intervals where the consumer checks for new diff files and ingests the data
  found within

## Tutorials

### Add the service to a stack

1) Add the service to your `docker-compose.yml`:

    ```yaml
    consumer:
      image: lblod/delta-consumer-single-graph-maintainer
      environment:
        SERVICE_NAME: 'your-custom-consumer-identifier' # replace with the desired consumer identifier
        SYNC_BASE_URL: 'http://base-sync-url # replace with link the application hosting the producer server
        SYNC_FILES_PATH: '/sync/files'
        SYNC_DATASET_SUBJECT: "http://data.lblod.info/datasets/delta-producer/dumps/CacheGraphDump"
        INITIAL_SYNC_JOB_OPERATION: "http://redpencil.data.gift/id/jobs/concept/JobOperation/deltas/consumer/initialSync"
        JOB_CREATOR_URI: "http://data.lblod.info/services/id/consumer"
      volumes:
        - ./config/consumer/:/config/ # replace with path to types configuration
    ```

2) Update variables to fit your needs

### Automate the scheduling of sync-tasks

To achieve this we can simple add a `CRON_PATTERN_DELTA_SYNC` env. variable

```yaml
 consumer:
   image: lblod/delta-consumer-single-graph-maintainer
   environment:
     CRON_PATTERN_DELTA_SYNC:  '0 * * * * *' // every minute
```

## Configuration

The following environment variables are required:

- `SERVICE_NAME`: consumer identifier. important as it is used to ensure persistence. The identifier should be unique within the project. [REQUIRED]
- `SYNC_DATASET_SUBJECT`: subject used when fetching the dataset [REQUIRED]
- `JOB_CREATOR_URI`: URL of the creator of the sync jobs [REQUIRED]
- `INITIAL_SYNC_JOB_OPERATION`: Job operation of the sync job, used to describe the created jobs [REQUIRED]

The following environment variables are optional:

- `SYNC_BASE_URL`: base URL of the stack hosting the producer API
- `SYNC_FILES_PATH (default: /sync/files)`: relative path to the endpoint to retrieve names of the diff files from
- `DOWNLOAD_FILES_PATH (default: /files/:id/download)`: relative path to the endpoint to download a diff file
  from. `:id` will be replaced with the uuid of the file.
- `CRON_PATTERN_DELTA_SYNC (default: 0 * * * * *)`: cron pattern at which the consumer needs to sync data automatically.
- `START_FROM_DELTA_TIMESTAMP (ISO datetime, default: now)`: timestamp to start sync data from (e.g. "2020-07-05T13:57:
  36.344Z")
- `PUBLIC_GRAPH (default: http://mu.semte.ch/graphs/public)`: public graph in which all public data and sync tasks will
  be ingested
- `INGEST_GRAPH (default: http://mu.semte.ch/graphs/public)`: graph in which all insert changesets are ingested
- `DISABLE_INITIAL_SYNC (default: false)`: flag to disable initial sync
- `DISABLE_DELTA_INGEST (default: false)`: flag to disable data ingestion, for example while initializing the sync
- `WAIT_FOR_INITIAL_SYNC (default: false)`: flag to not wait for initial ingestion (meant for debugging)

### Model

#### Used prefixes

| Prefix | URI                                                       |
|--------|-----------------------------------------------------------|
| dct    | http://purl.org/dc/terms/                                 |
| adms   | http://www.w3.org/ns/adms#                                |
| ext    | http://mu.semte.ch/vocabularies/ext                       |

#### Sync task

##### Class

`ext:SyncTask`

##### Properties

| Name       | Predicate        | Range           | Definition                                                                                                                                   |
|------------|------------------|-----------------|----------------------------------------------------------------------------------------------------------------------------------------------|
| status     | `adms:status`    | `adms:Status`   | Status of the sync task, initially set to `<http://lblod.data.gift/gelinkt-notuleren-mandatarissen-consumer-sync-task-statuses/not-started>` |
| created    | `dct:created`    | `xsd:dateTime`  | Datetime of creation of the task                                                                                                             |
| creator    | `dct:creator`    | `rdfs:Resource` | Creator of the task, in this case the mandatendatabank-consumer `<http://lblod.data.gift/services/gelinkt-notuleren-mandatarissen-consumer>` |
| deltaUntil | `ext:deltaUntil` | `xsd:dateTime`  | Datetime of the latest successfully ingested sync file as part of the task execution                                                         |

#### Sync task statuses

The status of the sync task will be updated to reflect the progress of the task. The following statuses are known:

* http://lblod.data.gift/gelinkt-notuleren-mandatarissen-consumer-sync-task-statuses/not-started
* http://lblod.data.gift/gelinkt-notuleren-mandatarissen-consumer-sync-task-statuses/ongoing
* http://lblod.data.gift/gelinkt-notuleren-mandatarissen-consumer-sync-task-statuses/success
* http://lblod.data.gift/gelinkt-notuleren-mandatarissen-consumer-sync-task-statuses/failure

### Data flow

At regular intervals, the service will schedule a sync task. Execution of a task consists of the following steps:

1. Retrieve the timestamp to start the sync from
2. Query the producer service for all diff files since that specific timestamp
3. Download the content of each diff file
4. Process each diff file in order

During the processing of a diff file, the insert and delete changesets are processed

**Delete changeset**
Apply a delete query triple per triple across all graphs

**Insert changeset**
Ingest the changeset in the graph `INGEST_GRAPH`.


If one file fails to be ingested, the remaining files in the queue are blocked since the files must always be handled in
order.

The service makes 2 core assumptions that must be respected at all times:

1. At any moment we know that the latest `ext:deltaUntil` timestamp on a task, either in failed/ongoing/success state,
   reflects the timestamp of the latest delta file that has been completly and successfully consumed
2. Maximum 1 sync task is running at any moment in time

#### This implementation is a simplified fork of [gelinkt-notuleren-consumer](https://github.com/lblod/gelinkt-notuleren-consumer)
