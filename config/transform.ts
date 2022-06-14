import { Quad } from "../types";

/**
 * Transformer called on each quad as received from the producer.
 * This may alter the bodies that will later be used during ingest.
 */
export default function(quad:Quad):Quad {
  return quad;
}
