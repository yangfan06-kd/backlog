import type { OpLogTx } from './op-log-db-adapter';
import type { ArchiveModel } from '../../features/archive/archive.model';
import { ArchiveStoreEntry, SINGLETON_KEY } from './db-keys.const';

/** Archive snapshot committed atomically with an operation (DS-005). */
export interface ArchiveWrite {
  storeName: 'archive_young' | 'archive_old';
  data: ArchiveModel;
}

export const applyArchiveWrite = async (
  tx: OpLogTx,
  archiveWrite?: ArchiveWrite,
): Promise<void> => {
  if (!archiveWrite) return;
  await tx.put(archiveWrite.storeName, {
    id: SINGLETON_KEY,
    data: archiveWrite.data,
    lastModified: Date.now(),
  } satisfies ArchiveStoreEntry);
};
