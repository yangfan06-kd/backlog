const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const Module = require('node:module');
require('ts-node').register({ transpileOnly: true, preferTsExts: true });

test('runtime paths are configured before logging and cannot escape the project', () => {
  const originalLoad = Module._load;
  const calls = [];
  const fakeApp = {
    isPackaged: false,
    getName: () => 'project1-preview',
    setPath: (...values) => calls.push(values),
    setAppLogsPath: (value) => calls.push(['logs', value]),
  };
  Module._load = function (request, ...args) {
    if (request === 'electron') return { app: fakeApp };
    return originalLoad.call(this, request, ...args);
  };
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'project1-runtime-test-'));
  try {
    const { configureProjectRuntimePaths } = require('./project1-runtime-paths.ts');
    calls.length = 0;
    const env = {
      PROJECT1_STORAGE_ROOT: root,
      PROJECT1_USER_DATA_DIR: path.join(root, 'data'),
      PROJECT1_LOG_DIR: path.join(root, 'logs'),
      PROJECT1_CRASH_DIR: path.join(root, 'crashes'),
    };
    configureProjectRuntimePaths(env, []);
    assert.deepEqual(calls, [
      ['userData', env.PROJECT1_USER_DATA_DIR],
      ['sessionData', path.join(env.PROJECT1_USER_DATA_DIR, 'session')],
      ['logs', env.PROJECT1_LOG_DIR],
      ['crashDumps', env.PROJECT1_CRASH_DIR],
    ]);
    assert.ok(fs.existsSync(path.join(env.PROJECT1_USER_DATA_DIR, 'session')));
    calls.length = 0;
    assert.throws(
      () =>
        configureProjectRuntimePaths(
          { ...env, PROJECT1_LOG_DIR: path.resolve(root, '..', 'outside') },
          [],
        ),
      /inside its storage root/,
    );
    assert.throws(
      () => configureProjectRuntimePaths({ ...env, PROJECT1_CRASH_DIR: '' }, []),
      /all three data paths/,
    );
    assert.throws(
      () => configureProjectRuntimePaths(env, ['--user-data-dir=somewhere-else']),
      /conflicts/,
    );
    assert.deepEqual(calls, []);
    fakeApp.isPackaged = true;
    assert.throws(() => configureProjectRuntimePaths({}, []), /requires its launcher/);
    fakeApp.isPackaged = false;
    configureProjectRuntimePaths({}, []);
    assert.deepEqual(calls, []);
    const main = fs.readFileSync(path.join(__dirname, 'main.ts'), 'utf8');
    assert.ok(
      main.indexOf("import './project1-runtime-paths'") <
        main.indexOf("from './start-app'"),
    );
  } finally {
    Module._load = originalLoad;
    const resolvedRoot = path.resolve(root);
    assert.ok(resolvedRoot.startsWith(path.resolve(os.tmpdir()) + path.sep));
    fs.rmSync(resolvedRoot, { recursive: true, force: true });
  }
});
