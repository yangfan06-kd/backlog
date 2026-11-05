import { createHash, randomBytes } from 'node:crypto';
import {
  closeSync,
  existsSync,
  fsyncSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  readdirSync,
  renameSync,
  statSync,
  unlinkSync,
  writeSync,
} from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { isPathInsideDir } from './file-path-guard';
import {
  selectBackupFilesToDelete,
  MAX_BACKUP_FILES,
  KEEP_RECENT_BACKUP_FILES,
} from './shared-with-frontend/backup-file-cleanup.util';
export const PROJECT1_AUTO_BACKUP_DIR = 'backups/project1-auto';
export const PROJECT1_AUTO_BACKUP_VERSION = 1;
export const PROJECT1_RECENT_RESTORE_COPIES = 3;

export type Project1BackupKind = 'auto' | 'recovery';

export interface Project1BackupMeta {
  id: string;
  kind: Project1BackupKind;
  createdAt: number;
  size: number;
  valid: boolean;
  error?: string;
  dataHash?: string;
}

export interface Project1BackupWriteArgs {
  data: Record<string, unknown>;
  kind: Project1BackupKind;
}

const AUTO_PREFIX = 'auto-';
const RECOVERY_PREFIX = 'recovery-';
const TEMP_PREFIX = '.tmp-';
const LEGACY_ID = /^legacy-(\d{4}-\d{2}-\d{2}_\d{6}\.json)$/;

const isOwnedName = (name: string): boolean =>
  (name.startsWith(AUTO_PREFIX) || name.startsWith(RECOVERY_PREFIX)) &&
  name.endsWith('.json') &&
  !name.includes('/') &&
  !name.includes('\\');

const kindFromName = (name: string): Project1BackupKind =>
  name.startsWith(RECOVERY_PREFIX) ? 'recovery' : 'auto';

const hashData = (data: unknown): string =>
  createHash('sha256').update(JSON.stringify(data)).digest('hex');

const hasCoreModels = (data: unknown): boolean => {
  if (!data || typeof data !== 'object') return false;
  const models = data as Record<string, unknown>;
  return ['task', 'project'].every((key) => {
    const slice = models[key] as { ids?: unknown; entities?: unknown } | undefined;
    return (
      !!slice &&
      Array.isArray(slice.ids) &&
      !!slice.entities &&
      typeof slice.entities === 'object' &&
      !Array.isArray(slice.entities)
    );
  });
};

export const getProject1AutoBackupDir = (userData: string): string =>
  join(userData, ...PROJECT1_AUTO_BACKUP_DIR.split('/'));

const assertSafeRoot = (userData: string, dir: string): void => {
  if (
    !isPathInsideDir(
      resolve(process.env.PROJECT1_STORAGE_ROOT || 'G:/project1'),
      resolve(userData),
    ) ||
    !isPathInsideDir(resolve(userData), resolve(dir))
  ) {
    throw new Error('Project1 backup directory is outside userData');
  }
};

const readMeta = (filePath: string, name: string): Project1BackupMeta => {
  const base: Project1BackupMeta = {
    id: name,
    kind: kindFromName(name),
    createdAt: 0,
    size: 0,
    valid: false,
  };
  try {
    const stat = statSync(filePath);
    base.size = stat.size;
    const text = readFileSync(filePath, 'utf8');
    const parsed = JSON.parse(text) as {
      project1Backup?: {
        version?: unknown;
        kind?: unknown;
        createdAt?: unknown;
        dataSha256?: unknown;
      };
      data?: unknown;
    };
    const marker = parsed?.project1Backup;
    if (
      !marker ||
      marker.version !== PROJECT1_AUTO_BACKUP_VERSION ||
      marker.kind !== base.kind ||
      typeof marker.createdAt !== 'number' ||
      !Number.isFinite(marker.createdAt) ||
      typeof marker.dataSha256 !== 'string' ||
      !hasCoreModels(parsed.data)
    ) {
      return { ...base, error: 'INVALID_BACKUP_METADATA' };
    }
    if (hashData(parsed.data) !== marker.dataSha256) {
      return { ...base, error: 'INVALID_BACKUP_CONTENT' };
    }
    return {
      ...base,
      createdAt: marker.createdAt,
      valid: true,
      dataHash: marker.dataSha256,
    };
  } catch (e) {
    return {
      ...base,
      error: e instanceof Error ? e.message : 'UNREADABLE_BACKUP',
    };
  }
};

// DS-009 used timestamp-named files directly in backups/. Read those in place;
// they never participate in our owned-file rotation or get rewritten.
const readLegacy = (
  userData: string,
  id: string,
): { text: string; meta: Project1BackupMeta } => {
  const match = LEGACY_ID.exec(id);
  if (!match) throw new Error('Invalid legacy backup id');
  const filePath = join(userData, 'backups', match[1]);
  assertSafeRoot(userData, filePath);
  const stat = lstatSync(filePath);
  if (!stat.isFile() || stat.isSymbolicLink())
    throw new Error('Invalid legacy backup file');
  const parsed = JSON.parse(readFileSync(filePath, 'utf8')) as Record<string, unknown>;
  const data = parsed.data ?? parsed;
  if (!hasCoreModels(data)) throw new Error('Invalid legacy backup data');
  const complete = parsed.data
    ? parsed
    : { data, timestamp: stat.mtimeMs, lastUpdate: stat.mtimeMs };
  return {
    text: JSON.stringify(complete),
    meta: {
      id,
      kind: 'auto',
      createdAt: stat.mtimeMs,
      size: stat.size,
      valid: true,
      dataHash: hashData(data),
    },
  };
};

const listLegacy = (userData: string): Project1BackupMeta[] => {
  const dir = join(userData, 'backups');
  assertSafeRoot(userData, dir);
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((name) => LEGACY_ID.test(`legacy-${name}`))
    .map((name) => {
      const id = `legacy-${name}`;
      try {
        return readLegacy(userData, id).meta;
      } catch {
        return {
          id,
          kind: 'auto' as const,
          createdAt: 0,
          size: 0,
          valid: false,
          error: 'INVALID_LEGACY_BACKUP',
        };
      }
    });
};

export const listProject1Backups = (userData: string): Project1BackupMeta[] => {
  const dir = getProject1AutoBackupDir(userData);
  assertSafeRoot(userData, dir);
  const items: Project1BackupMeta[] = listLegacy(userData);
  for (const name of existsSync(dir) ? readdirSync(dir) : []) {
    if (!isOwnedName(name) || name.startsWith(TEMP_PREFIX)) continue;
    const filePath = join(dir, name);
    try {
      if (!lstatSync(filePath).isFile()) continue;
    } catch {
      continue;
    }
    items.push(readMeta(filePath, name));
  }
  return items.sort((a, b) => {
    if (a.valid !== b.valid) return a.valid ? -1 : 1;
    return b.createdAt - a.createdAt || b.id.localeCompare(a.id);
  });
};

export const readProject1Backup = (
  userData: string,
  id: string,
): { text: string; meta: Project1BackupMeta } => {
  if (typeof id === 'string' && LEGACY_ID.test(id)) return readLegacy(userData, id);
  if (!isOwnedName(id) || basename(id) !== id) {
    throw new Error('Invalid project1 backup id');
  }
  const dir = getProject1AutoBackupDir(userData);
  assertSafeRoot(userData, dir);
  const filePath = join(dir, id);
  const stat = lstatSync(filePath);
  if (!stat.isFile() || stat.isSymbolicLink()) {
    throw new Error('Project1 backup is not a regular file');
  }
  const meta = readMeta(filePath, id);
  if (!meta.valid) {
    throw new Error(`Project1 backup is not recoverable: ${meta.error}`);
  }
  return { text: readFileSync(filePath, 'utf8'), meta };
};

export const cleanupProject1Backups = (userData: string): void => {
  const items = listProject1Backups(userData);
  const valid = items.filter((item) => item.valid && !LEGACY_ID.test(item.id));
  const auto = valid.filter((item) => item.kind === 'auto');
  if (auto.length > KEEP_RECENT_BACKUP_FILES) {
    const autoItems = auto.map((item) => ({
      // The existing selector recognizes YYYY-MM-DD prefixes. Our owned id
      // begins with auto-, so give it a dated selection key, not a disk path.
      fileName: `${new Date(item.createdAt).getFullYear()}-${String(new Date(item.createdAt).getMonth() + 1).padStart(2, '0')}-${String(new Date(item.createdAt).getDate()).padStart(2, '0')}-${item.id}`,
      filePath: join(getProject1AutoBackupDir(userData), item.id),
      mtime: item.createdAt,
    }));
    // The upstream selector deletes only files it is given; corrupt/unknown
    // files are never in this valid list and therefore never removed here.
    const newestTime = Math.max(...auto.map((item) => item.createdAt));
    for (const item of selectBackupFilesToDelete(
      autoItems,
      MAX_BACKUP_FILES,
      new Date(newestTime),
    )) {
      try {
        unlinkSync(item.filePath);
      } catch {
        // Keep a failed cleanup from masking a successful committed backup.
      }
    }
  }
  const recovery = valid.filter((item) => item.kind === 'recovery');
  for (const item of recovery.slice(PROJECT1_RECENT_RESTORE_COPIES)) {
    try {
      unlinkSync(join(getProject1AutoBackupDir(userData), item.id));
    } catch {
      // Retention is best-effort after a valid commit.
    }
  }
};

export const writeProject1Backup = (
  userData: string,
  args: Project1BackupWriteArgs,
  now: number = Date.now(),
): Project1BackupMeta => {
  if (
    (args.kind !== 'auto' && args.kind !== 'recovery') ||
    !args.data ||
    typeof args.data !== 'object' ||
    !hasCoreModels(args.data.data)
  ) {
    throw new Error('Invalid project1 backup payload');
  }
  const dir = getProject1AutoBackupDir(userData);
  assertSafeRoot(userData, dir);
  mkdirSync(dir, { recursive: true });
  const existing = listProject1Backups(userData).filter((item) => item.valid);
  const latestCreatedAt = existing.reduce(
    (max, item) => Math.max(max, item.createdAt),
    0,
  );
  const createdAt = Math.max(now, latestCreatedAt + 1);
  const kindPrefix = args.kind === 'recovery' ? RECOVERY_PREFIX : AUTO_PREFIX;
  const id = `${kindPrefix}${createdAt}-${randomBytes(6).toString('hex')}.json`;
  const finalPath = join(dir, id);
  const tempPath = join(dir, `${TEMP_PREFIX}${randomBytes(12).toString('hex')}.json`);
  const dataHash = hashData(args.data.data);
  const payload = {
    ...args.data,
    project1Backup: {
      version: PROJECT1_AUTO_BACKUP_VERSION,
      kind: args.kind,
      createdAt,
      dataSha256: dataHash,
    },
  };
  const text = JSON.stringify(payload);
  try {
    const fd = openSync(tempPath, 'wx');
    try {
      writeSync(fd, text, null, 'utf8');
      fsyncSync(fd);
    } finally {
      closeSync(fd);
    }
    const readBack = readFileSync(tempPath, 'utf8');
    if (readBack !== text || hashData(JSON.parse(readBack).data) !== dataHash) {
      throw new Error('Project1 backup readback mismatch');
    }
    renameSync(tempPath, finalPath);
    const meta = readMeta(finalPath, id);
    if (!meta.valid) throw new Error('Project1 backup validation failed');
    cleanupProject1Backups(userData);
    return meta;
  } catch (e) {
    try {
      if (existsSync(tempPath)) unlinkSync(tempPath);
    } catch {
      // Both paths are in the owned backup directory.
    }
    throw e;
  }
};

export const deleteProject1Backup = (userData: string, id: string): { id: string } => {
  if (!isOwnedName(id) || basename(id) !== id) {
    throw new Error('Invalid backup id');
  }
  const dir = getProject1AutoBackupDir(userData);
  assertSafeRoot(userData, dir);
  const filePath = join(dir, id);
  if (!isPathInsideDir(dir, filePath)) throw new Error('Backup path escapes directory');
  if (!existsSync(filePath)) throw new Error('Backup not found');
  if (lstatSync(filePath).isSymbolicLink()) throw new Error('Refusing linked backup');
  unlinkSync(filePath);
  return { id };
};
