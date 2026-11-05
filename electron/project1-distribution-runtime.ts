import { lstatSync, readFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import {
  assertProject1PathWithoutLinks,
  Project1RuntimePaths,
  resolveProject1RuntimePaths,
} from './project1-runtime-policy';

/** Public installers use one stable sibling data directory. Replacing or
 * uninstalling the application directory must not remove this directory. */
export const resolveDistributionRuntime = (
  resources: string,
  program: string,
): Project1RuntimePaths => {
  const marker = join(resources, 'project1-distribution.json');
  assertProject1PathWithoutLinks(marker);
  const stat = lstatSync(marker);
  if (!stat.isFile() || stat.size > 1024)
    throw new Error('Invalid distribution identity');
  const identity: unknown = JSON.parse(readFileSync(marker, 'utf8'));
  if (
    JSON.stringify(identity) !== JSON.stringify({ formatVersion: 1, edition: 'public' })
  )
    throw new Error('Unknown distribution identity');
  const programDir = resolve(program);
  const storageRoot = dirname(programDir);
  const profileRoot = join(storageRoot, basename(programDir) + '-data');
  return resolveProject1RuntimePaths(
    { formatVersion: 1, storageRoot, profileRoot },
    programDir,
  );
};
