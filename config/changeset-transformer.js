/**
 * Transformer called on each changeset as received from the producer.
 * This may alter the bodies that will later be used during ingest.
 */
export default function({inserts, deletes}) {
  return { inserts, deletes };
}
