const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const Module = require('node:module');
require('ts-node').register({ transpileOnly: true, preferTsExts: true });

const projectRoot = path.resolve('G:/project1');
const calls = [];
const fakeApp = {
  isPackaged: false,
  getName: () => 'project1-preview',
  setPath: (...args) => calls.push(args),
  setAppLogsPath: (p) => calls.push(['logs', p]),
  exit: () => {
    throw new Error('unexpected exit');
  },
};
const originalLoad = Module._load;
Module._load = function (request, ...args) {
  if (request === 'electron') return { app: fakeApp };
  return originalLoad.call(this, request, ...args);
};
const { configureProjectRuntimePaths } = require('./project1-runtime-paths.ts');
Module._load = originalLoad;

const makeCase = () => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'preview-review-'));
  const env = {
    PROJECT1_PREVIEW_MODE: '1',
    PROJECT1_STORAGE_ROOT: projectRoot,
    PROJECT1_USER_DATA_DIR: path.join(base, 'data'),
    PROJECT1_LOG_DIR: path.join(base, 'logs'),
    PROJECT1_CRASH_DIR: path.join(base, 'crashes'),
    TEMP: path.join(base, 'tmp'),
    TMP: path.join(base, 'tmp'),
  };
  return { base, env };
};
const cleanup = (base) => {
  assert.ok(path.resolve(base).startsWith(path.resolve(os.tmpdir()) + path.sep));
  fs.rmSync(base, { recursive: true, force: true });
};

test('preview rejects a different declared storage root before creating paths', () => {
  const { base, env } = makeCase();
  try {
    calls.length = 0;
    assert.throws(() =>
      configureProjectRuntimePaths({ ...env, PROJECT1_STORAGE_ROOT: base }, []),
    );
    assert.equal(calls.length, 0);
  } finally {
    cleanup(base);
  }
});

test('preview rejects a runtime junction before any attempt to write outside project', () => {
  const { base, env } = makeCase();
  const mkdir = fs.mkdirSync;
  let outsideAttempted = false;
  try {
    const link = path.join(base, 'escape');
    fs.symlinkSync('G:/', link, 'junction');
    fs.mkdirSync = function (p, ...args) {
      if (String(p).includes('escape')) {
        outsideAttempted = true;
        throw new Error('review intercepted an unsafe mkdir before disk write');
      }
      return mkdir.call(this, p, ...args);
    };
    assert.throws(
      () =>
        configureProjectRuntimePaths(
          {
            ...env,
            PROJECT1_USER_DATA_DIR: path.join(link, 'project1-review-must-not-create'),
          },
          [],
        ),
      /inside|outside|junction|storage root/i,
    );
    assert.equal(outsideAttempted, false);
  } finally {
    fs.mkdirSync = mkdir;
    cleanup(base);
  }
});

test('preview rejects an external temporary directory before configuring app paths', () => {
  const { base, env } = makeCase();
  try {
    calls.length = 0;
    assert.throws(() => configureProjectRuntimePaths({ ...env, TEMP: 'G:/' }, []));
    assert.equal(calls.length, 0);
  } finally {
    cleanup(base);
  }
});

test('packaged preview without environment reads only its fixed runtime policy', () => {
  const base = fs.mkdtempSync(
    path.join(projectRoot, 'output/runtime/DS-011/runtime-policy-'),
  );
  const resources = path.join(base, 'resources');
  const profile = path.join(base, 'profile');
  const program = path.join(base, 'program');
  fs.mkdirSync(resources, { recursive: true });
  fs.mkdirSync(program, { recursive: true });
  const policyFile = path.join(resources, 'project1-runtime.json');
  fs.writeFileSync(
    policyFile,
    JSON.stringify({
      formatVersion: 1,
      storageRoot: projectRoot,
      profileRoot: profile,
    }),
  );
  try {
    calls.length = 0;
    fakeApp.isPackaged = true;
    const runtimeEnv = {};
    configureProjectRuntimePaths(runtimeEnv, [], {
      resourcesPath: resources,
      programDir: program,
    });
    assert.deepEqual(calls, [
      ['userData', path.join(profile, 'user-data')],
      ['sessionData', path.join(profile, 'user-data', 'session')],
      ['logs', path.join(profile, 'logs')],
      ['crashDumps', path.join(profile, 'crashes')],
      ['temp', path.join(profile, 'tmp')],
    ]);
    assert.equal(runtimeEnv.TEMP, path.join(profile, 'tmp'));
    calls.length = 0;
    assert.throws(
      () =>
        configureProjectRuntimePaths({ PROJECT1_PREVIEW_EXPORTS_DIR: 'relative' }, [], {
          resourcesPath: resources,
          programDir: program,
        }),
      /partial explicit runtime/,
    );
    assert.equal(calls.length, 0);
    fakeApp.isPackaged = false;
    assert.throws(
      () =>
        configureProjectRuntimePaths({ PROJECT1_PREVIEW_MODE: '1' }, [], {
          resourcesPath: resources,
          programDir: program,
        }),
      /Development preview requires/,
    );
    assert.equal(calls.length, 0);
  } finally {
    fakeApp.isPackaged = false;
    fs.rmSync(path.resolve(base), { recursive: true, force: true });
  }
});

test('the existing launcher still accepts a complete explicit preview environment', () => {
  const { base, env } = makeCase();
  try {
    calls.length = 0;
    assert.doesNotThrow(() => configureProjectRuntimePaths(env, []));
    assert.ok(
      calls.some(
        ([key, value]) => key === 'userData' && value === env.PROJECT1_USER_DATA_DIR,
      ),
    );
  } finally {
    cleanup(base);
  }
});

test('non-preview explicit paths retain the old behavior without changing host temporary paths', () => {
  const { base, env } = makeCase();
  try {
    delete env.PROJECT1_PREVIEW_MODE;
    delete env.TEMP;
    delete env.TMP;
    calls.length = 0;
    configureProjectRuntimePaths(env, []);
    assert.equal(env.TEMP, undefined);
    assert.equal(env.TMP, undefined);
    assert.equal(
      calls.some(([key]) => key === 'temp'),
      false,
    );
  } finally {
    cleanup(base);
  }
});
