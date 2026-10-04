import { copyFileSync, createReadStream, existsSync, rmSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { assertKey, StorageChanged, type EvidenceStore } from './types';

/** Local filesystem store (the default, and tests): today's media directory. */
export function localStore(mediaDir: string): EvidenceStore {
  const path = (key: string) => {
    assertKey(key);
    return join(mediaDir, key.replace('/', '__'));
  };
  // Local version tag: size, mtime and inode (dev/test store; R2 uses real ETags).
  const tagOf = (p: string) => {
    const st = statSync(p);
    return `"${st.size}-${st.mtimeMs}-${st.ino}"`;
  };
  const pin = (p: string, ifMatch?: string) => {
    if (ifMatch && tagOf(p) !== ifMatch) throw new StorageChanged('object changed');
  };
  return {
    canDelete: true,
    kind: 'local',
    async head(key) {
      const p = path(key);
      return existsSync(p) ? { size: statSync(p).size, etag: tagOf(p) } : null;
    },
    async readRange(key, start, end, opts) {
      pin(path(key), opts?.ifMatch);
      return createReadStream(path(key), { start, end });
    },
    async copy(src, dst, opts) {
      pin(path(src), opts?.ifMatch);
      copyFileSync(path(src), path(dst));
    },
    async delete(key) {
      rmSync(path(key), { force: true });
    },
    async presignPut() {
      throw new Error('Direct uploads need POCKETQA_STORAGE=r2; local storage uses the multipart upload route.');
    },
  };
}
