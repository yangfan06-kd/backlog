// This module must run before start-app imports electron-log or any store.
import { app } from 'electron';
import { mkdirSync } from 'node:fs';
import { basename, dirname, isAbsolute, join, resolve } from 'node:path';
import { isPathInsideDir } from './file-path-guard';
import { resolveDistributionRuntime } from './project1-distribution-runtime';
import {
  PROJECT1_RUNTIME_POLICY_FILE,
  PROJECT1_FIXED_STORAGE_ROOT,
  Project1RuntimePaths,
  readProject1RuntimePolicy,
  resolveProject1RuntimePaths,
  assertProject1PathWithoutLinks,
} from './project1-runtime-policy';

const PREVIEW_ENV_KEY = 'PROJECT1_PREVIEW_MODE';
const PROJECT_ENV_KEYS = [
  'PROJECT1_STORAGE_ROOT',
  'PROJECT1_USER_DATA_DIR',
  'PROJECT1_LOG_DIR',
  'PROJECT1_CRASH_DIR',
] as const;

export interface Project1RuntimeOptions {
  resourcesPath?: string;
  programDir?: string;
}

/**
 * The preview marker is deliberately main-process owned. A packaged preview
 * build carries its identity in the app package; a development run must pass
 * the explicit marker environment variable. Renderer input never enables it.
 */
export const isProject1PreviewMode = (env: NodeJS.ProcessEnv = process.env): boolean => {
  if (env[PREVIEW_ENV_KEY] === '1') return true;
  if (!app.isPackaged) return false;
  return (
    app.getName() === 'project1-preview' ||
    app.getName() === 'project-progress' ||
    app.getName() === '项目进展' ||
    app.getName() === '项目进展（内测版）' ||
    /^project1preview\.exe$/i.test(basename(process.execPath))
  );
};

export const isProject1DistributionMode = (): boolean =>
  app.isPackaged &&
  (app.getName() === 'project-progress' ||
    app.getName() === '项目进展' ||
    /^projectprogress\.exe$/i.test(basename(process.execPath)));

const hasAnyProjectEnv = (env: NodeJS.ProcessEnv): boolean =>
  [...PROJECT_ENV_KEYS, 'PROJECT1_PREVIEW_EXPORTS_DIR'].some(
    (key) => env[key] !== undefined,
  );

const requireCompleteExplicitEnv = (env: NodeJS.ProcessEnv): void => {
  const values = PROJECT_ENV_KEYS.map((key) => env[key]);
  if (values.some((value) => !value)) {
    throw new Error(
      'Project runtime requires all three data paths and the storage root; refusing a partial explicit runtime',
    );
  }
};

const loadPolicyPaths = (
  env: NodeJS.ProcessEnv,
  options: Project1RuntimeOptions,
): Project1RuntimePaths => {
  if (!app.isPackaged)
    throw new Error('Development preview requires its launcher environment');
  const resourcesPath = options.resourcesPath ?? process.resourcesPath;
  if (!resourcesPath || !isAbsolute(resourcesPath)) {
    throw new Error(
      'Project1 preview requires its launcher or an installer runtime policy',
    );
  }
  const policy = readProject1RuntimePolicy(
    join(resourcesPath, PROJECT1_RUNTIME_POLICY_FILE),
    PROJECT1_FIXED_STORAGE_ROOT,
  );
  return resolveProject1RuntimePaths(
    policy,
    options.programDir ?? dirname(process.execPath),
  );
};

const applyRuntimePaths = (
  paths: Project1RuntimePaths,
  env: NodeJS.ProcessEnv,
  argv: string[],
  isPreview: boolean,
  exportDir?: string,
): void => {
  const override = argv.find((arg) => arg.startsWith('--user-data-dir='));
  if (override && resolve(override.slice('--user-data-dir='.length)) !== paths.userData) {
    throw new Error('Command-line user data path conflicts with the project runtime');
  }
  const all = [
    paths.userData,
    paths.sessionData,
    paths.logs,
    paths.crashes,
    paths.temp,
    paths.exports,
  ];
  for (const value of all) {
    if (!isAbsolute(value)) {
      throw new Error('Project runtime paths must be absolute');
    }
    if (!isPathInsideDir(paths.storageRoot, value) && !(value === paths.profileRoot)) {
      throw new Error('Project runtime paths must resolve inside its storage root');
    }
    assertProject1PathWithoutLinks(value);
  }
  if (exportDir !== undefined && !isPathInsideDir(paths.storageRoot, exportDir)) {
    throw new Error('Preview export directory must stay inside its storage root');
  }
  if (exportDir !== undefined) assertProject1PathWithoutLinks(exportDir);

  // No directory or app path is created until every value above is accepted.
  for (const value of all) mkdirSync(value, { recursive: true });
  if (isPreview) env[PREVIEW_ENV_KEY] = '1';
  env.PROJECT1_STORAGE_ROOT = paths.storageRoot;
  env.PROJECT1_USER_DATA_DIR = paths.userData;
  env.PROJECT1_LOG_DIR = paths.logs;
  env.PROJECT1_CRASH_DIR = paths.crashes;
  env.PROJECT1_PREVIEW_EXPORTS_DIR = exportDir ?? paths.exports;
  env.TEMP = paths.temp;
  env.TMP = paths.temp;
  env.TMPDIR = paths.temp;
  app.setPath('userData', paths.userData);
  app.setPath('sessionData', paths.sessionData);
  app.setAppLogsPath(paths.logs);
  app.setPath('crashDumps', paths.crashes);
  if (isPreview) app.setPath('temp', paths.temp);
};

// Preserve the pre-DS-011 explicit-path behavior for ordinary development.
// It neither needs nor rewrites host TEMP/TMP or creates preview export folders.
const configureNonPreviewPaths = (env: NodeJS.ProcessEnv, argv: string[]): void => {
  if (!PROJECT_ENV_KEYS.some((key) => Boolean(env[key]))) return;
  requireCompleteExplicitEnv(env);
  const root = env.PROJECT1_STORAGE_ROOT!;
  const values = [
    env.PROJECT1_USER_DATA_DIR!,
    env.PROJECT1_LOG_DIR!,
    env.PROJECT1_CRASH_DIR!,
  ];
  if (!isAbsolute(root) || values.some((value) => !isAbsolute(value)))
    throw new Error('Project runtime paths must be absolute');
  if (values.some((value) => !isPathInsideDir(root, value)))
    throw new Error('Project runtime paths must resolve inside its storage root');
  const [userData, logs, crashes] = values.map((value) => resolve(value));
  const override = argv.find((arg) => arg.startsWith('--user-data-dir='));
  if (override && resolve(override.slice('--user-data-dir='.length)) !== userData)
    throw new Error('Command-line user data path conflicts with the project runtime');
  const sessionData = join(userData, 'session');
  for (const value of [userData, logs, crashes, sessionData])
    mkdirSync(value, { recursive: true });
  app.setPath('userData', userData);
  app.setPath('sessionData', sessionData);
  app.setAppLogsPath(logs);
  app.setPath('crashDumps', crashes);
};

const resolveExplicitPaths = (env: NodeJS.ProcessEnv): Project1RuntimePaths => {
  const root = env.PROJECT1_STORAGE_ROOT!;
  const [userData, logs, crashes] = [
    env.PROJECT1_USER_DATA_DIR!,
    env.PROJECT1_LOG_DIR!,
    env.PROJECT1_CRASH_DIR!,
  ].map((value) => resolve(value));
  return {
    storageRoot: resolve(root),
    profileRoot: resolve(dirname(userData)),
    userData,
    sessionData: join(userData, 'session'),
    logs,
    crashes,
    temp: resolve(env.TEMP || join(root, 'tmp')),
    exports: resolve(
      env.PROJECT1_PREVIEW_EXPORTS_DIR || join(dirname(userData), 'exports'),
    ),
  };
};

export const configureProjectRuntimePaths = (
  env: NodeJS.ProcessEnv = process.env,
  argv: string[] = process.argv,
  options: Project1RuntimeOptions = {},
): void => {
  const isPreview = isProject1PreviewMode(env);
  if (isProject1DistributionMode()) {
    const paths = resolveDistributionRuntime(
      options.resourcesPath ?? process.resourcesPath,
      options.programDir ?? dirname(process.execPath),
    );
    applyRuntimePaths(paths, env, argv, true, paths.exports);
    return;
  }
  if (!isPreview) return configureNonPreviewPaths(env, argv);
  const hasExplicit = hasAnyProjectEnv(env);
  if (hasExplicit) {
    requireCompleteExplicitEnv(env);
    if (!env.TEMP || !env.TMP) {
      throw new Error(
        'Project1 preview requires explicit temporary paths with the explicit runtime',
      );
    }
    if (isPreview) {
      const allowedRoot = resolve(PROJECT1_FIXED_STORAGE_ROOT);
      if (
        resolve(env.PROJECT1_STORAGE_ROOT!).toLowerCase() !== allowedRoot.toLowerCase()
      ) {
        throw new Error('Preview storage root must be G:/project1');
      }
      const temporaryPaths = [
        env.TEMP!,
        env.TMP ?? env.TEMP!,
        ...(env.TMPDIR ? [env.TMPDIR] : []),
      ];
      for (const value of [
        env.PROJECT1_USER_DATA_DIR!,
        env.PROJECT1_LOG_DIR!,
        env.PROJECT1_CRASH_DIR!,
        ...temporaryPaths,
      ]) {
        if (!isAbsolute(value) || !isPathInsideDir(allowedRoot, value)) {
          throw new Error('Preview runtime paths must resolve inside its storage root');
        }
      }
      if (
        env.PROJECT1_PREVIEW_EXPORTS_DIR &&
        !isAbsolute(env.PROJECT1_PREVIEW_EXPORTS_DIR)
      )
        throw new Error('Preview export directory must be absolute');
    }
    const paths = resolveExplicitPaths(env);
    applyRuntimePaths(
      paths,
      env,
      argv,
      isPreview,
      env.PROJECT1_PREVIEW_EXPORTS_DIR
        ? resolve(env.PROJECT1_PREVIEW_EXPORTS_DIR)
        : undefined,
    );
    return;
  }

  if (!isPreview) return;
  const paths = loadPolicyPaths(env, options);
  applyRuntimePaths(paths, env, argv, true, paths.exports);
};

try {
  configureProjectRuntimePaths();
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`[project1-preview] ${message}`);
  process.exitCode = 1;
  // Fail before any default Electron cache/store or single-instance lock is
  // created. This is the direct-exe-without-launcher error path.
  app.exit(1);
}
