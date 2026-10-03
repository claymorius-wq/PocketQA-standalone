// Where generated preview secrets may live. Only `.preview/` or a folder under
// `.preview-test/` (both git-ignored and forbidden by check-secrets), so an override can
// never drop gate secrets or credentials into a committable folder.
import { join, relative, resolve, sep } from 'node:path';

export const REPO = join(import.meta.dirname, '../..');

export function stateDir(value = process.env.PREVIEW_STATE_DIR ?? '.preview') {
  const dir = resolve(REPO, value);
  const rel = relative(REPO, dir);
  if (rel === '.preview' || (rel.startsWith(`.preview-test${sep}`) && !rel.includes(`..${sep}`))) return dir;
  throw new Error('PREVIEW_STATE_DIR must be .preview or a folder under .preview-test/ (git-ignored).');
}
