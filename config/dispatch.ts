import { ChangeSet } from '../types';
import { moveTriples, downloadShareLinks } from '../support';
import dispatchTriple from './dispatch-triple';

export default async function dispatch(changesets: ChangeSet[]) {
  for (const changeset of changesets) {
    const triplesToDelete = changeset.deletes.flatMap(dispatchTriple);
    const triplesToInsert = changeset.inserts.flatMap(dispatchTriple);

    if (process.env.DOWNLOAD_SHARE_LINKS)
      await downloadShareLinks(triplesToInsert);

    await moveTriples([{
      inserts: triplesToInsert,
      deletes: triplesToDelete
    }]);
  }
}
