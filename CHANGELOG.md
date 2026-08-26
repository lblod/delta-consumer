## Unreleased
 - Add finite timeouts to SPARQL and producer HTTP requests so a dropped connection fails the sync job instead of blocking the sync queue permanently (`DCR_SPARQL_TIMEOUT_MS`, `DCR_SYNC_REQUEST_TIMEOUT_MS`, `DCR_TASK_WATCHDOG_TIMEOUT_MS`)
 - Fix promises that never settle: file downloads on a mid-transfer stream error, and initial-sync parsing when the dump's quad count is a multiple of the batch size
## 0.2.0
- Added mu-cli scripts to facilitate development and replay
## 0.1.7
 - added explicit bgp triples selection as validation
## 0.1.6
 - update woodpecker config
## 0.1.5
 - Use `N3.js` streams to handle the initial ingest.
   https://github.com/lblod/delta-consumer/pull/36
## 0.1.4
  - Added `accept-encoding` headers to speed up transmission
    - https://github.com/lblod/delta-consumer/pull/35
## 0.1.3
 - Bump JS template
 - Bugfix: still an issue with custom dispatching, that because `/config` must exist in the service.
## 0.1.2
 - Fix to allow import statements in files mounted under `/config`; i.e. for the custom dispatching.
     https://github.com/lblod/delta-consumer/pull/34
## 0.1.1
 - Fix (new) bug with lang strings: a variable wasn't assigned
## 0.1.0
 - Fix another bug in handling language tags: use both `xml:lang` and `lang`. Thanks to @cecemel for pointing out the cause of the problems. This is a breaking change as it changes the way deltas (with language tags) are parsed and executed onto the triplestore. **If producer data can contain language tags, make sure to flush data and sync job data, before performing a re-sync.**
   - see [#31](https://github.com/lblod/delta-consumer/pull/31)
## 0.0.27
 - Fix bug in handling `lang` strings not being according to `rdf/json`
   - see: [#30](https://github.com/lblod/delta-consumer/pull/30)
## 0.0.26
 - Fix in variable binding (or substitution) in the mapping queries.
     see: [#28](https://github.com/lblod/delta-consumer/pull/28)
## 0.0.25
 - SPARQL based re-mapping.
## 0.0.24
- improved job-failure see [#19](https://github.com/lblod/delta-consumer/pull/19)
## 0.0.23
- bump javascript-template
## 0.0.22 [BROKEN]
- update faulty useage of mu-auth-sudo for context graph
## 0.0.20

* implements backoff mechanism
