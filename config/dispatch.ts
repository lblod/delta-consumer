import { ChangeSet } from '../types';
import { moveTriples, downloadShareLinks } from '../support';
import dispatchQuad from './dispatch-quad';

export default async function dispatch(changesets: ChangeSet[]) {
  for (const changeset of changesets) {
    const triplesToDelete = changeset.deletes.flatMap(dispatchQuad);
    const triplesToInsert = changeset.inserts.flatMap(dispatchQuad);

    if (process.env.DOWNLOAD_SHARE_LINKS)
      await downloadShareLinks(triplesToInsert);

    await moveTriples([{
      inserts: triplesToInsert,
      deletes: triplesToDelete
    }]);
  }
}
