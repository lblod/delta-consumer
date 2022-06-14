import { Quad }  from '../types';

export default function dispatch(quad: Quad) {
  quad.graph.value = process.env.TARGET_GRAPH;
  return [quad];
}
