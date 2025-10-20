const COMMON_PREFIXES = [
  ["q2:", "http://mu.semte.ch/vocabularies/core/"],
];

const statements = [
  { subject: "http://mu.semte.ch/vocabularies/core/Person", predicate: "http://www.w3.org/1999/02/22-rdf-syntax-ns#type", object: "http://mu.semte.ch/vocabularies/core/#Agent" },
  { subject: "<http://mu.semte.ch/vocabularies/zcore/uuidd>", predicate: "http://mu.semte.ch/vocabularies/core/hasName", object: '"Alice"' },
];
  const usablePrefixes = COMMON_PREFIXES.filter(([_, uri]) => statements.some(({ subject, predicate, object }) => subject.includes(uri) || predicate.includes(uri) || (!object.startsWith('"') && object.includes(uri))));

usablePrefixes.forEach(([prefix, uri]) => {
const regex = new RegExp(`<${uri}([^>#][^>]*)>|${uri}([^\\s>#][^\\s>]*)`, "g");  
const newStmts = statements.map(({ subject, predicate, object }) => ({
    subject:  subject.replace(regex, `${prefix}$1$2`),
    predicate:  predicate.replace(regex, `${prefix}$1$2`),
    object: object.startsWith('"') ? object : object.replace(regex, `${prefix}$1$2`),
  }));

console.log(newStmts);

})
