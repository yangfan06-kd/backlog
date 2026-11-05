const fs = require('node:fs');
const path = require('node:path');
const { _electron: electron } = require('playwright');
const { expect } = require('@playwright/test');

const root = 'G:/project1';
const release = 'G:/project1/output/releases/DS-014/20261030-194549-validation';
const runRoot = path.join(root, 'output/runtime/DS-014/desktop-validation');
const exportFile = path.join(runRoot, 'formatted-backup.json');
const report = { release, runRoot, steps: [] };
let app;

const profileOf = (packageDir) => {
  const policy = JSON.parse(
    fs.readFileSync(
      path.join(packageDir, 'win-unpacked/resources/project1-runtime.json'),
      'utf8',
    ),
  );
  return policy.profileRoot;
};

const launch = async (packageDir) => {
  const env = { ...process.env, NODE_ENV: 'PROD' };
  for (const key of Object.keys(env)) if (key.startsWith('PROJECT1_')) delete env[key];
  env.TEMP = path.join(runRoot, 'tmp');
  env.TMP = env.TEMP;
  env.TMPDIR = env.TEMP;
  delete env.ELECTRON_RUN_AS_NODE;
  app = await electron.launch({
    executablePath: path.join(packageDir, 'win-unpacked/Project1Preview.exe'),
    cwd: path.dirname(path.join(packageDir, 'win-unpacked/Project1Preview.exe')),
    env,
    args: ['--disable-tray', '--no-sandbox'],
  });
  const page = await app.firstWindow();
  page.setDefaultTimeout(30_000);
  await page.context().setOffline(true);
  await page.getByTestId('pp-page').waitFor({ timeout: 30_000 });
  return page;
};

const closeNormal = async () => {
  const closed = app.waitForEvent('close', { timeout: 20_000 });
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].close());
  await closed;
  app = undefined;
};

const selectAll = async (page, editor) => {
  await editor.locator('.cm-content').click();
  await page.keyboard.press('Control+A');
};

const assertFormatted = async (page, projectName) => {
  const project = page.getByTestId('pp-project-row').filter({ hasText: projectName });
  if (!(await project.evaluate((el) => el.classList.contains('is-selected')))) {
    await project.getByTestId('pp-project-title').click();
  }
  if ((await project.getByTestId('pp-entry').count()) === 0) {
    await project.getByTestId('pp-project-toggle').click();
  }
  await expect(project.locator('[data-testid="pp-step-title"] .pt-bold')).toBeVisible();
  await expect(
    project.locator('[data-testid="pp-step-title"] .pt-color-blue'),
  ).toBeVisible();
  const entry = project.getByTestId('pp-entry').filter({ hasText: '格式化记录' });
  await expect(entry.locator('.pt-italic')).toBeVisible();
  await expect(entry.locator('.pt-color-green')).toBeVisible();
};

const createFormattedProject = async (page, projectName) => {
  await page.getByTestId('pp-new-project-input').fill(projectName);
  await page.getByTestId('pp-create-project').click();
  const project = page.getByTestId('pp-project-row').filter({ hasText: projectName });
  await expect(project).toBeVisible();
  await project.getByTestId('pp-project-title').click();

  await project.getByTestId('pp-append-step').click();
  const stepEditor = page
    .getByTestId('pp-insert-input')
    .locator('xpath=ancestor::personal-rich-text-editor[1]');
  await stepEditor.locator('.cm-content').click();
  await page.keyboard.insertText('格式化步骤');
  await selectAll(page, stepEditor);
  await stepEditor.getByTestId('pt-bold').click();
  await stepEditor.getByTestId('pt-color-toggle').click();
  await stepEditor.getByTestId('pt-color-blue').click();
  await page.getByTestId('pp-insert-save').click();
  await expect(page.getByTestId('pp-status')).toHaveAttribute('data-save-state', 'saved');

  const entryEditor = page
    .getByTestId('pp-entry-input')
    .locator('xpath=ancestor::personal-rich-text-editor[1]');
  await entryEditor.locator('.cm-content').click();
  await page.keyboard.insertText('格式化记录');
  await selectAll(page, entryEditor);
  await entryEditor.getByTestId('pt-italic').click();
  await entryEditor.getByTestId('pt-color-toggle').click();
  await entryEditor.getByTestId('pt-color-green').click();
  await page.getByTestId('pp-add-entry').click();
  await expect(page.getByTestId('pp-status')).toHaveAttribute('data-save-state', 'saved');
  await assertFormatted(page, projectName);
};

const gotoProgress = async (page) => {
  await page.evaluate(() => {
    location.hash = '#/personal-progress';
  });
  await page.reload();
  await expect(page.getByTestId('pp-page')).toBeVisible({ timeout: 30_000 });
};

const gotoBackup = async (page) => {
  await page.evaluate(() => {
    location.hash = '#/personal-backup';
  });
  await expect(page.getByTestId('pb-page')).toBeVisible({ timeout: 30_000 });
};

const exportBackup = async (page) => {
  await app.evaluate(({ dialog }, filePath) => {
    dialog.showSaveDialog = async () => ({ canceled: false, filePath });
  }, exportFile);
  await page.getByTestId('pb-export').click();
  await expect(page.getByTestId('pb-status')).toHaveAttribute(
    'data-save-state',
    'saved',
    { timeout: 30_000 },
  );
  expect(fs.existsSync(exportFile)).toBe(true);
  const backup = JSON.parse(fs.readFileSync(exportFile, 'utf8'));
  const serialized = JSON.stringify(backup);
  expect(serialized).toContain('bodyFormat');
  expect(serialized).toContain('stepFormat');
  expect(serialized).toContain('"bold":true');
  expect(serialized).toContain('"color":"blue"');
  expect(serialized).toContain('"italic":true');
  expect(serialized).toContain('"color":"green"');
  report.exportBytes = fs.statSync(exportFile).size;
};

const restoreBackup = async (page) => {
  page.once('dialog', (dialog) => dialog.accept());
  await page.getByTestId('pb-restore-input').setInputFiles(exportFile);
  await expect(page.getByTestId('pb-status')).toHaveAttribute(
    'data-save-state',
    'restored',
    { timeout: 30_000 },
  );
};

(async () => {
  fs.mkdirSync(runRoot, { recursive: true });
  try {
    const profile = profileOf(release);
    fs.mkdirSync(profile, { recursive: true });
    let page = await launch(release);
    report.identity = await app.evaluate(({ app }) => ({
      isPackaged: app.isPackaged,
      version: app.getVersion(),
      userData: app.getPath('userData'),
      logs: app.getPath('logs'),
      crashes: app.getPath('crashDumps'),
      temp: app.getPath('temp'),
    }));
    expect(report.identity.isPackaged).toBe(true);
    expect(report.identity.version).toBe('1.0.8-preview.20261030');
    expect(report.identity.userData).toBe(path.join(profile, 'user-data'));
    report.steps.push('first profile launched offline');
    await createFormattedProject(page, 'DS-014 desktop');
    await closeNormal();

    page = await launch(release);
    report.steps.push('first profile reopened');
    await assertFormatted(page, 'DS-014 desktop');
    await gotoBackup(page);
    await page.getByTestId('pb-auto-now').click();
    await expect(page.getByTestId('pb-auto-status')).toHaveAttribute(
      'data-auto-state',
      'success',
    );
    const autoDir = path.join(profile, 'user-data/backups/project1-auto');
    report.autoFiles = fs
      .readdirSync(autoDir, { withFileTypes: true })
      .filter((entry) => entry.isFile())
      .map((entry) => entry.name);
    expect(report.autoFiles.length).toBeGreaterThan(0);

    await gotoProgress(page);
    await page
      .getByTestId('pp-project-row')
      .filter({ hasText: 'DS-014 desktop' })
      .getByTestId('pp-project-title')
      .click();
    const extraEditor = page
      .getByTestId('pp-entry-input')
      .locator('xpath=ancestor::personal-rich-text-editor[1]');
    await extraEditor.locator('.cm-content').click();
    await page.keyboard.insertText('auto extra');
    await page.getByTestId('pp-add-entry').click();
    await expect(page.getByTestId('pp-status')).toHaveAttribute(
      'data-save-state',
      'saved',
    );
    await gotoBackup(page);
    const autoRestores = page.getByTestId('pb-auto-restore');
    expect(await autoRestores.count()).toBeGreaterThan(0);
    page.once('dialog', (dialog) => dialog.accept());
    await autoRestores.last().click();
    await expect(page.getByTestId('pb-status')).toHaveAttribute(
      'data-save-state',
      'restored',
      { timeout: 30_000 },
    );
    await gotoProgress(page);
    await expect(
      page
        .getByTestId('pp-project-row')
        .filter({ hasText: 'DS-014 desktop' })
        .getByTestId('pp-entry')
        .filter({ hasText: 'auto extra' }),
    ).toHaveCount(0);
    report.steps.push('automatic version restored through the existing UI entry');

    await gotoBackup(page);
    await exportBackup(page);
    await restoreBackup(page);
    report.steps.push('first profile auto backup, complete export and restore');
    await closeNormal();

    const restoreBase = path.join(runRoot, 'restore-package');
    fs.rmSync(restoreBase, { recursive: true, force: true });
    fs.mkdirSync(restoreBase, { recursive: true });
    fs.cpSync(
      path.join(release, 'win-unpacked'),
      path.join(restoreBase, 'win-unpacked'),
      {
        recursive: true,
      },
    );
    const restoreProfile = path.join(
      root,
      'output/runtime/DS-014/validation/profile-restore',
    );
    fs.mkdirSync(restoreProfile, { recursive: true });
    fs.writeFileSync(
      path.join(restoreBase, 'win-unpacked/resources/project1-runtime.json'),
      JSON.stringify({
        formatVersion: 1,
        storageRoot: root,
        profileRoot: restoreProfile,
      }),
    );
    page = await launch(restoreBase);
    expect(await app.evaluate(({ app }) => app.getPath('userData'))).toBe(
      path.join(restoreProfile, 'user-data'),
    );
    await gotoBackup(page);
    await restoreBackup(page);
    await page.evaluate(() => {
      location.hash = '#/personal-progress';
    });
    await expect(page.getByTestId('pp-page')).toBeVisible({ timeout: 30_000 });
    await assertFormatted(page, 'DS-014 desktop');
    report.restoreProfile = restoreProfile;
    report.steps.push(
      'independent restore profile imported the complete backup with formats',
    );
    await closeNormal();
  } catch (error) {
    report.error = error.message;
    process.exitCode = 1;
  } finally {
    if (app) await app.evaluate(({ app }) => app.exit(0)).catch(() => {});
    fs.writeFileSync(path.join(runRoot, 'review.json'), JSON.stringify(report, null, 2));
    console.log(JSON.stringify(report, null, 2));
  }
})();
