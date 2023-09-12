import fs from 'fs-extra';
import { Response } from 'node-fetch';
import fetcher from './lib/fetcher';
import { sparqlEscapeUri, sparqlEscapeString } from 'mu';
import { Quad, Literal, Resource, ChangeSet } from './types';
import { updateSudo as update } from '@lblod/mu-auth-sudo';
import { SYNC_FILESHARE_ENDPOINT } from './cfg';

export function toSparqlTerm(thing: Literal | Resource): string {
  if (thing.type == "uri")
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

export async function downloadFile(uri: string) {
  const downloadUrl = `${SYNC_FILESHARE_ENDPOINT}?uri=${uri}`;
  const filePath = uri.replace('share://', '/share/');

  console.log(`Downloading file ${uri} from ${downloadUrl}`);
  const response = await fetcher(downloadUrl)
  if (response.ok) {
    const buffer = await response.buffer();
    fs.writeFileSync(filePath, buffer);
  } else {
    console.error(`Failed to download file ${uri} (${response.status})`);
  }
}

export function isShareUri(uri: String) {
  return uri.startsWith("share://");
}

export async function downloadShareLinks(inserts: Quad[]) {
  const shareLinks = new Set<string>();

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

export function groupQuadsByGraph(quads: Quad[]): { graph: Resource, quads: Quad[] }[] {
  let graphMap = new Map<string, Quad[]>();

  for (let quad of quads) {
    const graph = quad.graph;

    if (!graphMap.has(graph.value))
      graphMap.set(graph.value, []);

    graphMap.get(graph.value).push(quad);
  }
  return Array.from(graphMap.entries())
    .map(([graphUri, quads]): { graph: Resource, quads: Quad[] } => ({
      graph: { value: graphUri, type: 'uri' },
      quads
    }));
}

// TODO: This can be more intelligent
export async function moveTriples(changesets: ChangeSet[]) {
  for (const { inserts, deletes } of changesets) {
    if (deletes.length) {
      for (let { graph, quads } of groupQuadsByGraph(deletes)) {
        await update(`DELETE DATA {
            GRAPH ${toSparqlTerm(graph)} {
              ${quads.map(toSparqlTriple).join("\n")}
            }
          }`);
      }
    }
    if (inserts.length) {
      for (let { graph, quads } of groupQuadsByGraph(inserts)) {
        await update(`INSERT DATA {
            GRAPH ${toSparqlTerm(graph)} {
              ${quads.map(toSparqlTriple).join("\n")}
            }
          }`);
      }
    }
  }
}
