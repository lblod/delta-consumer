import { Quad }  from '../types';

const TARGET_GRAPH = process.env.TARGET_GRAPH;

export default function dispatch(quad: Quad) {
  if (TARGET_GRAPH)
    quad.graph.value = TARGET_GRAPH;
  return [quad];
}
