const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

require('ts-node/register/transpile-only');

const {
  getProject1AutoBackupDir,
  listProject1Backups,
  writeProject1Backup,
  readProject1Backup,
  cleanupProject1Backups,
  PROJECT1_AUTO_BACKUP_DIR,
} = require('./project1-auto-backup-file.ts');

const makeData = (id = 'project-1') => ({
  timestamp: 1,
  lastUpdate: 1,
  crossModelVersion: 1,
  data: {
    task: { ids: [], entities: {} },
    project: { ids: [id], entities: { [id]: { id, title: id } } },
  },
});

test('writes, validates and reads an atomic project1 backup', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ds010-backup-'));
  try {
    const meta = writeProject1Backup(root, { data: makeData(), kind: 'auto' }, 1000);
    assert.equal(meta.valid, true);
    assert.equal(meta.kind, 'auto');
    assert.ok(meta.id.startsWith('auto-'));
    const files = listProject1Backups(root);
    assert.equal(files.length, 1);
    assert.equal(files[0].valid, true);
    const read = readProject1Backup(root, meta.id);
    assert.equal(JSON.parse(read.text).data.project.ids[0], 'project-1');
    assert.throws(() => readProject1Backup(root, '../outside.json'), /Invalid/);
    const dir = getProject1AutoBackupDir(root);
    assert.equal(dir, path.join(root, ...PROJECT1_AUTO_BACKUP_DIR.split('/')));
    assert.equal(
      fs.readdirSync(dir).some((name) => name.startsWith('.tmp-')),
      false,
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('marks corrupt owned files unusable without deleting them or hiding good versions', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ds010-corrupt-'));
  try {
    const good = writeProject1Backup(root, { data: makeData(), kind: 'auto' }, 1000);
    const dir = getProject1AutoBackupDir(root);
    fs.writeFileSync(path.join(dir, 'auto-corrupt.json'), '{"bad":');
    fs.writeFileSync(path.join(dir, 'unknown.txt'), 'do not touch');
    const list = listProject1Backups(root);
    assert.equal(list.filter((item) => item.valid).length, 1);
    assert.equal(list.filter((item) => !item.valid).length, 1);
    assert.equal(fs.readdirSync(dir).includes('unknown.txt'), true);
    assert.equal(readProject1Backup(root, good.id).meta.valid, true);
    assert.throws(() => readProject1Backup(root, 'auto-corrupt.json'));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('keeps 51 valid automatic versions, three recovery copies, and survives clock regression', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ds010-ring-'));
  try {
    for (let i = 0; i < 55; i++) {
      // Deliberately decreasing wall time; the writer must still produce
      // unique, monotonically ordered identities.
      writeProject1Backup(root, { data: makeData(`p-${i}`), kind: 'auto' }, 5000 - i);
    }
    for (let i = 0; i < 5; i++) {
      writeProject1Backup(root, { data: makeData(`r-${i}`), kind: 'recovery' }, 9000 + i);
    }
    const valid = listProject1Backups(root).filter((item) => item.valid);
    const auto = valid.filter((item) => item.kind === 'auto');
    const recovery = valid.filter((item) => item.kind === 'recovery');
    assert.ok(auto.length <= 51 && auto.length >= 30);
    assert.equal(recovery.length, 3);
    const uniqueIds = new Set(valid.map((item) => item.id));
    assert.equal(uniqueIds.size, valid.length);
    const ordered = [...auto].sort((a, b) => b.createdAt - a.createdAt);
    assert.ok(ordered[0].createdAt > ordered[1].createdAt);
    cleanupProject1Backups(root);
    const finalValid = listProject1Backups(root).filter((item) => item.valid);
    assert.ok(finalValid.filter((item) => item.kind === 'auto').length <= 51);
    assert.equal(finalValid.filter((item) => item.kind === 'recovery').length, 3);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('rejects missing complete-backup data before writing any file', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ds010-invalid-'));
  try {
    assert.throws(
      () => writeProject1Backup(root, { data: {}, kind: 'auto' }),
      /Invalid project1 backup payload/,
    );
    assert.deepEqual(listProject1Backups(root), []);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('rejects complete-backup data missing the core model slices', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cx010-model-'));
  try {
    assert.throws(() => writeProject1Backup(root, { data: { data: {} }, kind: 'auto' }));
    assert.deepEqual(listProject1Backups(root), []);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('keeps daily versions after more than thirty recent changes on one day', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cx010-daily-'));
  try {
    const now = new Date(2026, 9, 27, 12).getTime();
    let olderDaily;
    for (let day = 20; day >= 1; day--) {
      const meta = writeProject1Backup(
        root,
        { data: makeData(`daily-${day}`), kind: 'auto' },
        now - day * 86400000,
      );
      if (day === 15) olderDaily = meta.id;
    }
    for (let i = 0; i < 55; i++) {
      writeProject1Backup(root, { data: makeData(`recent-${i}`), kind: 'auto' }, now + i);
    }
    const versions = listProject1Backups(root).filter((entry) => entry.valid);
    assert.ok(
      versions.some((entry) => entry.id === olderDaily),
      'the day-15 recovery point must survive frequent edits today',
    );
    assert.ok(versions.length <= 51);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('reads old timestamp-named backups without rewriting or rotating them', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cx010-legacy-'));
  try {
    fs.mkdirSync(path.join(root, 'backups'));
    const legacy = path.join(root, 'backups', '2026-10-26_120000.json');
    const text = JSON.stringify(makeData('legacy-project').data);
    fs.writeFileSync(legacy, text);
    const versions = listProject1Backups(root);
    assert.equal(versions.length, 1);
    assert.equal(
      JSON.parse(readProject1Backup(root, versions[0].id).text).data.project.ids[0],
      'legacy-project',
    );
    writeProject1Backup(root, { data: makeData(), kind: 'auto' });
    cleanupProject1Backups(root);
    assert.equal(fs.readFileSync(legacy, 'utf8'), text);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

for (const operation of ['writeSync', 'fsyncSync', 'renameSync']) {
  test(`preserves the last good version when ${operation} fails`, () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cx010-native-failure-'));
    const original = fs[operation];
    let good;
    try {
      good = writeProject1Backup(root, { data: makeData(), kind: 'auto' });
      fs[operation] = () => {
        throw new Error(`injected ${operation} failure`);
      };
      assert.throws(() =>
        writeProject1Backup(root, { data: makeData('second'), kind: 'auto' }),
      );
    } finally {
      fs[operation] = original;
      if (good) assert.equal(readProject1Backup(root, good.id).meta.valid, true);
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
}

test('rejects a mismatched readback without removing the previous good file', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cx010-readback-'));
  const original = fs.readFileSync;
  let good;
  try {
    good = writeProject1Backup(root, { data: makeData(), kind: 'auto' });
    fs.readFileSync = (filePath, ...args) =>
      path.basename(String(filePath)).startsWith('.tmp-')
        ? 'invalid readback'
        : original(filePath, ...args);
    assert.throws(
      () => writeProject1Backup(root, { data: makeData('second'), kind: 'auto' }),
      /readback/,
    );
  } finally {
    fs.readFileSync = original;
    if (good) assert.equal(readProject1Backup(root, good.id).meta.valid, true);
    fs.rmSync(root, { recursive: true, force: true });
  }
});
