const fs = require('node:fs');
const path = require('node:path');
const { _electron: electron } = require('playwright');
const { expect } = require('@playwright/test');

const root = 'G:/project1';
const releaseA = process.argv[2];
const releaseB = process.argv[3];
if (!releaseA || !releaseB)
  throw new Error('usage: electron-installer-ab-review.cjs <A-release> <B-release>');
const caseDir = path.join(root, 'output/runtime/DS-011', `ab-${Date.now()}`);
const expectedVersionA = JSON.parse(
  fs.readFileSync(path.join(releaseA, 'build-manifest.json'), 'utf8'),
).version;
const expectedVersionB = JSON.parse(
  fs.readFileSync(path.join(releaseB, 'build-manifest.json'), 'utf8'),
).version;
const profile = path.join(caseDir, 'profile');
const programA = path.join(caseDir, 'A/program');
const programB = path.join(caseDir, 'B/program');
const exportA = path.join(caseDir, 'A-backup.json');
const exportB = path.join(caseDir, 'B-before-change.json');
for (const dir of [caseDir, profile, path.dirname(programA), path.dirname(programB)]) {
  fs.mkdirSync(dir, { recursive: true });
}
const installProgram = (release, target) => {
  if (
    !path.resolve(target).startsWith(path.resolve(caseDir) + path.sep) ||
    fs.existsSync(target)
  )
    throw new Error('Refusing to overwrite a prior program');
  fs.mkdirSync(target, { recursive: true });
  fs.cpSync(path.join(release, 'win-unpacked'), target, { recursive: true });
  const policy = path.join(target, 'resources/project1-runtime.json');
  fs.writeFileSync(
    policy,
    JSON.stringify({ formatVersion: 1, storageRoot: root, profileRoot: profile }),
  );
};
installProgram(releaseA, programA);
installProgram(releaseB, programB);
const env = { ...process.env, NODE_ENV: 'PROD' };
for (const key of Object.keys(env)) if (key.startsWith('PROJECT1_')) delete env[key];
delete env.ELECTRON_RUN_AS_NODE;
const report = {
  releaseA,
  releaseB,
  caseDir,
  profile,
  steps: [],
  programPolicy: {
    A: fs.readFileSync(path.join(programA, 'resources/project1-runtime.json'), 'utf8'),
    B: fs.readFileSync(path.join(programB, 'resources/project1-runtime.json'), 'utf8'),
  },
};
let app;

const launch = async (program) => {
  const result = await electron.launch({
    executablePath: path.join(program, 'Project1Preview.exe'),
    cwd: program,
    env,
    args: ['--disable-tray', '--no-sandbox'],
  });
  const page = await result.firstWindow();
  page.setDefaultTimeout(25_000);
  await page.context().setOffline(true);
  await page.getByTestId('pp-page').waitFor({ timeout: 30_000 });
  return { app: result, page };
};
const closeNormal = async (target, page) => {
  const closed = target.waitForEvent('close', { timeout: 20_000 });
  await target.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].close());
  await closed;
};
const nav = async (page, label, testId) => {
  await page.locator('.nav-link').filter({ hasText: label }).first().click();
  await page.getByTestId(testId).waitFor();
};
const statusSaved = async (page) => {
  await expect(page.getByTestId('pp-status')).toHaveAttribute('data-save-state', 'saved');
};
const createProject = async (page, title) => {
  await page.getByTestId('pp-new-project-input').fill(title);
  await page.getByTestId('pp-create-project').click();
  await statusSaved(page);
};
const appendStep = async (page, title) => {
  await page.getByTestId('pp-append-step').click();
  await page.getByTestId('pp-insert-input').fill(title);
  await page.getByTestId('pp-insert-save').click();
  await statusSaved(page);
};
const completeStep = async (page, title) => {
  await page.locator(`[data-testid="pp-step-title"][data-step-title="${title}"]`).click();
  await statusSaved(page);
};
const addEntry = async (page, body) => {
  await page.getByTestId('pp-entry-input').fill(body);
  await page.getByTestId('pp-add-entry').click();
  await statusSaved(page);
};
const finishSelected = async (page, title) => {
  page.once('dialog', (dialog) => dialog.accept());
  await page.getByTestId('pp-finish-project').click();
  await expect(page.getByTestId('pp-view-archive')).toBeVisible();
  await nav(page, '项目归档', 'pa-page');
  await expect(page.getByTestId('pa-card')).toContainText(title);
};
const manualExport = async (target, page, filePath) => {
  await target.evaluate(({ dialog }, output) => {
    dialog.showSaveDialog = async () => ({ canceled: false, filePath: output });
  }, filePath);
  await nav(page, '数据备份', 'pb-page');
  await page.getByTestId('pb-export').click();
  await expect(page.getByTestId('pb-status')).toHaveAttribute('data-save-state', 'saved');
  expect(fs.existsSync(filePath)).toBe(true);
  return JSON.parse(fs.readFileSync(filePath, 'utf8')).data;
};
const autoVersion = async (page) => {
  await expect(page.getByTestId('pb-auto-status')).toBeVisible();
  await page.getByTestId('pb-auto-now').click();
  await expect(page.getByTestId('pb-auto-status')).toHaveAttribute(
    'data-auto-state',
    'success',
    { timeout: 30_000 },
  );
  await expect(page.getByTestId('pb-auto-version').first()).toBeVisible();
};
const autoDir = path.join(profile, 'user-data/backups/project1-auto');
const autoSnapshot = () =>
  fs.existsSync(autoDir)
    ? fs
        .readdirSync(autoDir)
        .filter((name) => name.startsWith('auto-'))
        .sort()
        .map((name) => ({
          name,
          sha256: require('node:crypto')
            .createHash('sha256')
            .update(fs.readFileSync(path.join(autoDir, name)))
            .digest('hex'),
        }))
    : [];

(async () => {
  try {
    let started = await launch(programA);
    app = started.app;
    let page = started.page;
    report.versionA = await app.evaluate(({ app }) => app.getVersion());
    expect(report.versionA).toBe(expectedVersionA);
    await createProject(page, 'AB project');
    await appendStep(page, 'AB unfinished step');
    await completeStep(page, 'AB unfinished step');
    await addEntry(page, 'AB manual entry');
    await createProject(page, 'AB archived project');
    await appendStep(page, 'AB archived remaining');
    await finishSelected(page, 'AB archived project');
    await nav(page, '常态事项', 'pr-page');
    await page.getByTestId('pr-new-item-title').fill('AB routine');
    await page.getByTestId('pr-create-item').click();
    await expect(page.getByTestId('pr-status')).toHaveAttribute(
      'data-save-state',
      'saved',
    );
    await page.getByTestId('pr-entry-body').fill('AB routine entry');
    await page.getByTestId('pr-save-entry').click();
    await expect(page.getByTestId('pr-status')).toHaveAttribute(
      'data-save-state',
      'saved',
    );
    await nav(page, '数据备份', 'pb-page');
    await autoVersion(page);
    let aData = await manualExport(app, page, exportA);
    // Exercise preservation of nonempty historical archive stores as well as
    // the ordinary project archive. These are explicit test fixtures imported
    // through the application's real validator/import path, not new UI features.
    const sourceTask =
      aData.task.entities[aData.task.ids.find((id) => aData.task.entities[id].isDone)];
    expect(sourceTask).toBeTruthy();
    for (const [slice, id] of [
      ['archiveYoung', 'fixture-young'],
      ['archiveOld', 'fixture-old'],
    ]) {
      const archived = structuredClone(sourceTask);
      delete archived.personalProgress;
      archived.id = id;
      archived.title = `Historical test fixture ${slice}`;
      aData[slice].task = { ids: [id], entities: { [id]: archived } };
    }
    const seededFile = path.join(caseDir, 'nonempty-archive-fixture.json');
    fs.writeFileSync(
      seededFile,
      JSON.stringify({ ...JSON.parse(fs.readFileSync(exportA, 'utf8')), data: aData }),
    );
    page.once('dialog', (dialog) => dialog.accept());
    await page.getByTestId('pb-restore-input').setInputFiles(seededFile);
    await expect(page.getByTestId('pb-status')).toHaveAttribute(
      'data-save-state',
      'restored',
    );
    aData = await manualExport(app, page, exportA);
    await autoVersion(page);
    report.aCounts = {
      projects: aData.project?.ids?.length,
      tasks: aData.task?.ids?.length,
      archiveYoung: aData.archiveYoung?.task?.ids?.length,
      archiveOld: aData.archiveOld?.task?.ids?.length,
    };
    const autoBeforeB = autoSnapshot();
    report.autoBeforeB = autoBeforeB;
    await closeNormal(app, page);
    app = undefined;
    report.steps.push(
      'A program created offline four-module data, automatic and manual backup, then closed normally',
    );

    started = await launch(programB);
    app = started.app;
    page = started.page;
    report.versionB = await app.evaluate(({ app }) => app.getVersion());
    expect(report.versionB).toBe(expectedVersionB);
    await nav(page, '项目归档', 'pa-page');
    await expect(page.getByTestId('pa-card')).toContainText('AB archived project');
    await nav(page, '常态事项', 'pr-page');
    await expect(page.getByTestId('pr-item-row')).toContainText('AB routine');
    await nav(page, '项目进展', 'pp-page');
    await expect(
      page.getByTestId('pp-entry').filter({ hasText: 'AB manual entry' }),
    ).toBeVisible();
    const bData = await manualExport(app, page, exportB);
    const normalize = (value, slice) => {
      const copy = structuredClone(value);
      if (slice === 'task')
        for (const task of Object.values(copy.entities)) delete task.modified;
      return copy;
    };
    report.rawSlicesEqual = {};
    report.normalizedSlicesEqual = {};
    for (const slice of ['project', 'task', 'archiveYoung', 'archiveOld']) {
      report.rawSlicesEqual[slice] =
        JSON.stringify(aData[slice]) === JSON.stringify(bData[slice]);
      report.normalizedSlicesEqual[slice] =
        JSON.stringify(normalize(aData[slice], slice)) ===
        JSON.stringify(normalize(bData[slice], slice));
      expect(report.normalizedSlicesEqual[slice]).toBe(true);
    }
    report.slicesEqual = true;
    report.steps.push(
      'B program read the same profile offline; four slices matched after excluding only the normal modified timestamp touch',
    );

    await nav(page, '项目进展', 'pp-page');
    await page.getByTestId('pp-entry-input').fill('B added entry');
    await page.getByTestId('pp-add-entry').click();
    await statusSaved(page);
    await nav(page, '数据备份', 'pb-page');
    await autoVersion(page);
    const autoAfterB = autoSnapshot();
    report.autoAfterB = autoAfterB;
    for (const old of autoBeforeB) {
      expect(
        autoAfterB.some((item) => item.name === old.name && item.sha256 === old.sha256),
      ).toBe(true);
    }
    await closeNormal(app, page);
    app = undefined;

    started = await launch(programB);
    app = started.app;
    page = started.page;
    await nav(page, '项目进展', 'pp-page');
    await expect(
      page.getByTestId('pp-entry').filter({ hasText: 'B added entry' }),
    ).toBeVisible();
    await expect(
      page.getByTestId('pp-entry').filter({ hasText: 'AB manual entry' }),
    ).toBeVisible();
    report.reopenB = true;
    report.manualBackupStillExists = fs.existsSync(exportA);
    report.steps.push(
      'B reopen kept old and new records; old automatic versions remained byte-identical',
    );
    await closeNormal(app, page);
    app = undefined;
  } catch (error) {
    report.error = error.message;
    report.stack = error.stack;
    process.exitCode = 1;
  } finally {
    if (app) await app.evaluate(({ app }) => app.exit(0)).catch(() => {});
    fs.writeFileSync(path.join(caseDir, 'review.json'), JSON.stringify(report, null, 2));
    console.log(JSON.stringify(report, null, 2));
  }
})();
