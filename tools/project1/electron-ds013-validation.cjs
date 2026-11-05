const fs = require('node:fs');
const path = require('node:path');
const { _electron: electron } = require('playwright');
const { expect } = require('@playwright/test');

const root = 'G:/project1';
const release = process.argv[2];
if (!release) throw new Error('validation release required');
const caseDir = path.join(root, 'output/runtime/DS-013/validation-run');
const profile = path.join(root, 'output/runtime/DS-012/DS-013-validation/profile');
const exportFile = path.join(caseDir, 'validation-backup.json');
for (const dir of [caseDir, profile, path.join(root, '.tmp/DS-013/validation-run')]) {
  fs.mkdirSync(dir, { recursive: true });
}
const env = { ...process.env, NODE_ENV: 'PROD' };
for (const key of Object.keys(env)) if (key.startsWith('PROJECT1_')) delete env[key];
env.TEMP = path.join(root, '.tmp/DS-013/validation-run');
env.TMP = env.TEMP;
env.TMPDIR = env.TEMP;
delete env.ELECTRON_RUN_AS_NODE;
const exe = path.join(release, 'win-unpacked/Project1Preview.exe');
const report = { release, exe, caseDir, profile, steps: [] };
let app;
let page;

const launch = async () => {
  app = await electron.launch({
    executablePath: exe,
    cwd: path.dirname(exe),
    env,
    args: ['--disable-tray', '--no-sandbox'],
  });
  page = await app.firstWindow();
  page.setDefaultTimeout(25_000);
  await page.context().setOffline(true);
  await page.getByTestId('pp-page').waitFor({ timeout: 30_000 });
};
const closeNormal = async () => {
  const closed = app.waitForEvent('close', { timeout: 20_000 });
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].close());
  await closed;
  app = undefined;
};

(async () => {
  try {
    await launch();
    report.identity = await app.evaluate(({ app }) => ({
      isPackaged: app.isPackaged,
      version: app.getVersion(),
      userData: app.getPath('userData'),
      sessionData: app.getPath('sessionData'),
      logs: app.getPath('logs'),
      crashes: app.getPath('crashDumps'),
      temp: app.getPath('temp'),
    }));
    expect(report.identity.isPackaged).toBe(true);
    expect(report.identity.version).toBe('1.0.6-preview.20261029');
    expect(report.identity.userData).toBe(path.join(profile, 'user-data'));
    expect(report.identity.logs).toBe(path.join(profile, 'logs'));
    report.steps.push(
      'validation candidate launched directly, offline, with no PROJECT1 environment',
    );

    await page.getByTestId('pp-new-project-input').fill('DS-013 validation project');
    await page.getByTestId('pp-create-project').click();
    await expect(page.getByTestId('pp-status')).toHaveAttribute(
      'data-save-state',
      'saved',
    );
    await page.getByTestId('pp-append-step').click();
    await page.getByTestId('pp-insert-input').fill('DS-013 validation step');
    await page.getByTestId('pp-insert-save').click();
    await expect(page.getByTestId('pp-status')).toHaveAttribute(
      'data-save-state',
      'saved',
    );
    await page.getByTestId('pp-entry-input').fill('DS-013 validation entry');
    await page.getByTestId('pp-add-entry').click();
    await expect(page.getByTestId('pp-status')).toHaveAttribute(
      'data-save-state',
      'saved',
    );

    await page.locator('.nav-link').filter({ hasText: '数据备份' }).first().click();
    await page.getByTestId('pb-page').waitFor();
    await page.getByTestId('pb-auto-now').click();
    await expect(page.getByTestId('pb-auto-status')).toHaveAttribute(
      'data-auto-state',
      'success',
    );
    const autoDir = path.join(profile, 'user-data/backups/project1-auto');
    report.autoFiles = fs
      .readdirSync(autoDir, { withFileTypes: true })
      .filter((entry) => entry.isFile() && entry.name.startsWith('auto-'))
      .map((entry) => entry.name);
    expect(report.autoFiles.length).toBeGreaterThan(0);

    await app.evaluate(({ dialog }, filePath) => {
      dialog.showSaveDialog = async () => ({ canceled: false, filePath });
    }, exportFile);
    await page.getByTestId('pb-export').click();
    await expect(page.getByTestId('pb-status')).toHaveAttribute(
      'data-save-state',
      'saved',
    );
    expect(fs.existsSync(exportFile)).toBe(true);
    report.manualExport = fs.statSync(exportFile).size;
    report.steps.push(
      'validation candidate created data, automatic and manual backup while offline',
    );
    await closeNormal();

    await launch();
    await expect(
      page.getByTestId('pp-project-row').filter({ hasText: 'DS-013 validation project' }),
    ).toBeVisible();
    await page
      .getByTestId('pp-entry')
      .filter({ hasText: 'DS-013 validation entry' })
      .waitFor();
    report.reopenOk = true;
    report.steps.push(
      'validation candidate normal close and offline reopen retained the test project',
    );
    await closeNormal();
  } catch (error) {
    report.error = error.message;
    process.exitCode = 1;
  } finally {
    if (app) await app.evaluate(({ app }) => app.exit(0)).catch(() => {});
    fs.writeFileSync(path.join(caseDir, 'review.json'), JSON.stringify(report, null, 2));
    console.log(JSON.stringify(report, null, 2));
  }
})();
