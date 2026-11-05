const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

require('ts-node').register({ transpileOnly: true, preferTsExts: true });

const {
  PROJECT1_RUNTIME_POLICY_FILE,
  PROJECT1_RUNTIME_POLICY_MAX_BYTES,
  readProject1RuntimePolicy,
  resolveProject1RuntimePaths,
} = require('./project1-runtime-policy.ts');

const projectRoot = 'G:/project1';
const caseRoot = path.join(projectRoot, 'output/runtime/DS-011', `policy-${Date.now()}`);
const resources = path.join(caseRoot, 'resources');
const policyPath = path.join(resources, PROJECT1_RUNTIME_POLICY_FILE);
const profileRoot = path.join(caseRoot, 'profile');
const programDir = path.join(caseRoot, 'program', 'win-unpacked');

const makePolicy = (overrides = {}) => ({
  formatVersion: 1,
  storageRoot: projectRoot,
  profileRoot,
  ...overrides,
});

const writePolicy = (value, name = PROJECT1_RUNTIME_POLICY_FILE) => {
  const file =
    name === PROJECT1_RUNTIME_POLICY_FILE ? policyPath : path.join(resources, name);
  fs.writeFileSync(file, typeof value === 'string' ? value : JSON.stringify(value));
  return file;
};

test.before(() => {
  fs.mkdirSync(resources, { recursive: true });
  fs.mkdirSync(programDir, { recursive: true });
});
test.after(() => {
  const resolved = path.resolve(caseRoot);
  assert.ok(resolved.startsWith(path.resolve(projectRoot) + path.sep));
  fs.rmSync(resolved, { recursive: true, force: true });
});

test('rejects a profile junction even when its destination is elsewhere inside the project', () => {
  const destination = path.join(caseRoot, 'junction-destination');
  const link = path.join(caseRoot, 'junction-profile');
  fs.mkdirSync(destination);
  fs.symlinkSync(destination, link, 'junction');
  writePolicy(makePolicy({ profileRoot: link }));
  const policy = readProject1RuntimePolicy(policyPath, projectRoot);
  assert.throws(
    () => resolveProject1RuntimePaths(policy, programDir),
    /link|junction|reparse/i,
  );
});

test('accepts the complete minimal policy and derives every runtime path', () => {
  writePolicy(makePolicy());
  const policy = readProject1RuntimePolicy(policyPath, projectRoot);
  const paths = resolveProject1RuntimePaths(policy, programDir);
  assert.equal(paths.userData, path.join(profileRoot, 'user-data'));
  assert.equal(paths.sessionData, path.join(profileRoot, 'user-data', 'session'));
  assert.equal(paths.logs, path.join(profileRoot, 'logs'));
  assert.equal(paths.crashes, path.join(profileRoot, 'crashes'));
  assert.equal(paths.temp, path.join(profileRoot, 'tmp'));
  assert.equal(paths.exports, path.join(profileRoot, 'exports'));
});

test('rejects missing, malformed, oversized, unknown-version and extra-field policies', () => {
  writePolicy('{not-json');
  assert.throws(
    () => readProject1RuntimePolicy(policyPath, projectRoot),
    /not valid JSON/,
  );
  writePolicy(makePolicy({ formatVersion: 2 }));
  assert.throws(
    () => readProject1RuntimePolicy(policyPath, projectRoot),
    /unknown policy version/,
  );
  writePolicy(makePolicy({ extra: true }));
  assert.throws(
    () => readProject1RuntimePolicy(policyPath, projectRoot),
    /only formatVersion/,
  );
  writePolicy({ ...makePolicy(), storageRoot: 'G:/project1-evil' });
  assert.throws(
    () => readProject1RuntimePolicy(policyPath, projectRoot),
    /fixed project root/,
  );
  writePolicy({ ...makePolicy(), profileRoot: 'relative/profile' });
  assert.throws(
    () => readProject1RuntimePolicy(policyPath, projectRoot),
    /absolute paths/,
  );
  writePolicy('x'.repeat(PROJECT1_RUNTIME_POLICY_MAX_BYTES + 1));
  assert.throws(
    () => readProject1RuntimePolicy(policyPath, projectRoot),
    /size is outside/,
  );
  fs.unlinkSync(policyPath);
  assert.throws(
    () => readProject1RuntimePolicy(policyPath, projectRoot),
    /policy file is missing/,
  );
});

test('rejects profileRoot at storage root, outside it, or inside the program tree', () => {
  writePolicy(makePolicy());
  const policy = readProject1RuntimePolicy(policyPath, projectRoot);
  assert.throws(
    () =>
      resolveProject1RuntimePaths({ ...policy, profileRoot: projectRoot }, programDir),
    /child of storageRoot/,
  );
  assert.throws(
    () =>
      resolveProject1RuntimePaths(
        { ...policy, profileRoot: path.join(projectRoot, '..', 'outside-profile') },
        programDir,
      ),
    /child of storageRoot|inside storageRoot/,
  );
  assert.throws(
    () =>
      resolveProject1RuntimePaths(
        { ...policy, profileRoot: path.join(programDir, 'profile') },
        programDir,
      ),
    /outside the program tree/,
  );
});

test(
  'rejects a linked policy file without following it',
  { skip: process.platform !== 'win32' },
  (context) => {
    writePolicy(makePolicy());
    const linkedResources = path.join(caseRoot, 'file-link-resources');
    fs.mkdirSync(linkedResources);
    const linked = path.join(linkedResources, PROJECT1_RUNTIME_POLICY_FILE);
    try {
      fs.symlinkSync(policyPath, linked, 'file');
    } catch (error) {
      if (error.code === 'EPERM') {
        context.skip('Windows file symlink permission is unavailable');
        return;
      }
      throw error;
    }
    assert.throws(
      () => readProject1RuntimePolicy(linked, projectRoot),
      /regular non-link/,
    );
  },
);

test('rejects a junctioned resources directory containing the correctly named policy', () => {
  writePolicy(makePolicy());
  const linkedResources = path.join(caseRoot, 'linked-resources');
  fs.symlinkSync(resources, linkedResources, 'junction');
  assert.throws(
    () =>
      readProject1RuntimePolicy(
        path.join(linkedResources, PROJECT1_RUNTIME_POLICY_FILE),
        projectRoot,
      ),
    /resolves through a link/,
  );
});
