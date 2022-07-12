import { sparqlEscapeUri, sparqlEscapeString } from 'mu';
import { Quad, Literal, Resource } from './types';
import { updateSudo as update } from '@lblod/mu-auth-sudo';

export function toSparqlTerm(thing: Literal | Resource): string {
  if( thing.type == "uri" )
    return sparqlEscapeUri(thing.value);
  else if (thing.lang)
    // TODO: Switch to template implementation once that exists
    return `${sparqlEscapeString(thing.value)}@${sparqlEscapeString(thing.lang)}`;
  else if (thing.datatype)
    return `${sparqlEscapeString(thing.value)}^^${sparqlEscapeUri(thing.datatype)}`;
  else
    return sparqlEscapeString(thing.value);
}

export function toSparqlTriple(quad: Quad): string {
  return `${toSparqlTerm(quad.subject)} ${toSparqlTerm(quad.predicate)} ${toSparqlTerm(quad.object)}.`;
}

export async function downloadFile(uri) {
  console.error("We can't download files yet");
}

export function isShareUri(uri: String) {
  return uri.startsWith("share://");
}

export async function downloadShareLinks(inserts: Quad[]) {
  const shareLinks = new Set();

  inserts
    .map((i) => i.subject.value)
    .filter(isShareUri)
    .forEach((i) => shareLinks.add(i));

  inserts
    .filter((i) => i.object.type === "uri")
    .map((i) => i.object.value)
    .filter(isShareUri)
    .forEach((i) => shareLinks.add(i));

  for (const shareLink of shareLinks)
    await downloadFile(shareLink);
}

// TODO: This can be more intelligent
export async function moveTriples(changesets: ChangeSet[]) {
  for (const { inserts, deletes } of changesets) {
    if (inserts.length)
      await update(`INSERT DATA {
          GRAPH <http://mu.semte.ch/graphs/private> {
            ${inserts.map(toSparqlTriple).join("\n")}
          }
        }`);
    if (deletes.length)
      await update(`DELETE DATA {
          GRAPH <http://mu.semte.ch/graphs/private> {
            ${deletes.map(toSparqlTriple).join("\n")}
          }
        }`);
  }
}
