import { lstatSync, readFileSync, realpathSync, statSync } from 'node:fs';
import { basename, dirname, isAbsolute, join, resolve } from 'node:path';
import { isPathInsideDir } from './file-path-guard';

/** Current-machine preview policy; this is not a permanent install location. */
export const PROJECT1_RUNTIME_POLICY_FILE = 'project1-runtime.json';
export const PROJECT1_RUNTIME_POLICY_FORMAT_VERSION = 1;
export const PROJECT1_FIXED_STORAGE_ROOT = 'G:/project1';
export const PROJECT1_RUNTIME_POLICY_MAX_BYTES = 8 * 1024;

/** Reject reparse points even when they currently lead elsewhere in the project. */
export const assertProject1PathWithoutLinks = (value: string): void => {
  let current = resolve(value);
  while (true) {
    try {
      if (lstatSync(current).isSymbolicLink())
        throw policyError('runtime path uses a link or junction');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
    const parent = dirname(current);
    if (parent === current) break;
    current = parent;
  }
};

export interface Project1RuntimePolicy {
  formatVersion: number;
  storageRoot: string;
  profileRoot: string;
}

export interface Project1RuntimePaths {
  storageRoot: string;
  profileRoot: string;
  userData: string;
  sessionData: string;
  logs: string;
  crashes: string;
  temp: string;
  exports: string;
}

const policyError = (message: string): Error =>
  new Error(`Invalid Project1 runtime policy: ${message}`);

const samePath = (left: string, right: string): boolean =>
  resolve(left).toLowerCase() === resolve(right).toLowerCase();

const canonicalExisting = (value: string): string => {
  try {
    return realpathSync.native(value);
  } catch {
    throw policyError('path does not exist or cannot be resolved');
  }
};

/**
 * Read the tiny, fixed-location policy. This deliberately refuses links,
 * oversized files and unknown versions before any directory is created.
 */
export const readProject1RuntimePolicy = (
  policyPath: string,
  expectedStorageRoot = PROJECT1_FIXED_STORAGE_ROOT,
): Project1RuntimePolicy => {
  if (typeof policyPath !== 'string' || !isAbsolute(policyPath)) {
    throw policyError('policy path must be absolute');
  }
  if (basename(policyPath) !== PROJECT1_RUNTIME_POLICY_FILE) {
    throw policyError('unexpected policy file name');
  }
  let stat;
  try {
    stat = lstatSync(policyPath);
  } catch {
    throw policyError('policy file is missing');
  }
  if (!stat.isFile() || stat.isSymbolicLink()) {
    throw policyError('policy file must be a regular non-link file');
  }
  if (stat.size <= 0 || stat.size > PROJECT1_RUNTIME_POLICY_MAX_BYTES) {
    throw policyError('policy file size is outside the allowed range');
  }
  // Reject a junctioned resources directory as well as a linked file.
  if (!samePath(canonicalExisting(policyPath), resolve(policyPath))) {
    throw policyError('policy file resolves through a link');
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(policyPath, 'utf8'));
  } catch {
    throw policyError('policy file is not valid JSON');
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw policyError('policy must be an object');
  }
  const keys = Object.keys(parsed as Record<string, unknown>).sort();
  if (
    keys.length !== 3 ||
    keys[0] !== 'formatVersion' ||
    keys[1] !== 'profileRoot' ||
    keys[2] !== 'storageRoot'
  ) {
    throw policyError(
      'policy must contain only formatVersion, storageRoot and profileRoot',
    );
  }
  const value = parsed as Record<string, unknown>;
  if (value.formatVersion !== PROJECT1_RUNTIME_POLICY_FORMAT_VERSION) {
    throw policyError('unknown policy version');
  }
  const storageRoot = value.storageRoot;
  const profileRoot = value.profileRoot;
  if (
    typeof storageRoot !== 'string' ||
    typeof profileRoot !== 'string' ||
    !isAbsolute(storageRoot) ||
    !isAbsolute(profileRoot)
  ) {
    throw policyError('storageRoot and profileRoot must be absolute paths');
  }
  if (!samePath(storageRoot, expectedStorageRoot)) {
    throw policyError('storageRoot must be the fixed project root');
  }
  const expectedCanonical = canonicalExisting(expectedStorageRoot);
  assertProject1PathWithoutLinks(storageRoot);
  const actualCanonical = canonicalExisting(storageRoot);
  if (!samePath(expectedCanonical, actualCanonical)) {
    throw policyError('storageRoot must resolve to the fixed project root');
  }
  return {
    formatVersion: PROJECT1_RUNTIME_POLICY_FORMAT_VERSION,
    storageRoot: resolve(storageRoot),
    profileRoot: resolve(profileRoot),
  };
};

/** Derive every runtime path from one validated policy result. */
export const resolveProject1RuntimePaths = (
  policy: Project1RuntimePolicy,
  programDir: string = dirname(process.execPath),
): Project1RuntimePaths => {
  const storageRoot = resolve(policy.storageRoot);
  const profileRoot = resolve(policy.profileRoot);
  assertProject1PathWithoutLinks(profileRoot);
  if (samePath(storageRoot, profileRoot) || !isPathInsideDir(storageRoot, profileRoot)) {
    throw policyError('profileRoot must be a child of storageRoot');
  }
  const canonicalProgram = canonicalExisting(programDir);
  if (
    samePath(canonicalProgram, profileRoot) ||
    isPathInsideDir(canonicalProgram, profileRoot)
  ) {
    throw policyError('profileRoot must be outside the program tree');
  }
  const userData = join(profileRoot, 'user-data');
  const sessionData = join(userData, 'session');
  const logs = join(profileRoot, 'logs');
  const crashes = join(profileRoot, 'crashes');
  const temp = join(profileRoot, 'tmp');
  const exportDirectory = join(profileRoot, 'exports');
  for (const value of [userData, sessionData, logs, crashes, temp, exportDirectory]) {
    assertProject1PathWithoutLinks(value);
    if (!isPathInsideDir(storageRoot, value)) {
      throw policyError('runtime paths must stay inside storageRoot');
    }
  }
  return {
    storageRoot,
    profileRoot,
    userData,
    sessionData,
    logs,
    crashes,
    temp,
    exports: exportDirectory,
  };
};

export const assertProject1RuntimePolicyFileSize = (policyPath: string): number => {
  const size = statSync(policyPath).size;
  if (size > PROJECT1_RUNTIME_POLICY_MAX_BYTES) {
    throw policyError('policy file is too large');
  }
  return size;
};
