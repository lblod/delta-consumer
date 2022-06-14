import { TripleTargetSpec } from '../types';

export default [
  {
    match: {
      type: "foaf:Person",
      predicate: ["foaf:givenName", "mu:uuid", "a"],
    },
    target: "http://mu.semte.ch/graphs/protected"
  }
]


