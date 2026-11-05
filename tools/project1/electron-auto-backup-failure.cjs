const fs = require('node:fs');
const path = require('node:path');
const { _electron: electron } = require('playwright');
const { expect } = require('@playwright/test');

const root = 'G:/project1';
const release = process.argv[2];
if (!release) throw new Error('release dir required');
const caseDir = path.join(root, 'output/runtime/DS-010', `auto-failure-${Date.now()}`);
const userData = path.join(caseDir, 'user-data');
const backups = path.join(userData, 'backups');
const autoDir = path.join(backups, 'project1-auto');
for (const dir of [
  userData,
  backups,
  path.join(caseDir, 'logs'),
  path.join(caseDir, 'crashes'),
  path.join(caseDir, 'tmp'),
]) {
  fs.mkdirSync(dir, { recursive: true });
}
// A file where the owned version directory belongs makes the real mkdir/write
// path fail without touching any unrelated user file.
fs.writeFileSync(autoDir, 'blocked', 'utf8');
const env = {
  ...process.env,
  NODE_ENV: 'PROD',
  PROJECT1_PREVIEW_MODE: '1',
  PROJECT1_STORAGE_ROOT: root,
  PROJECT1_USER_DATA_DIR: userData,
  PROJECT1_LOG_DIR: path.join(caseDir, 'logs'),
  PROJECT1_CRASH_DIR: path.join(caseDir, 'crashes'),
  PROJECT1_TEMP: path.join(caseDir, 'tmp'),
  TEMP: path.join(caseDir, 'tmp'),
  TMP: path.join(caseDir, 'tmp'),
};
delete env.ELECTRON_RUN_AS_NODE;
const report = { release, caseDir, steps: [] };
let app;
(async () => {
  try {
    app = await electron.launch({
      executablePath: path.join(release, 'win-unpacked/Project1Preview.exe'),
      cwd: path.join(release, 'win-unpacked'),
      env,
      args: ['--disable-tray', '--no-sandbox'],
    });
    const page = await app.firstWindow();
    page.setDefaultTimeout(25_000);
    await page.getByTestId('pp-page').waitFor({ timeout: 30_000 });
    await page.getByTestId('pp-new-project-input').fill('Auto failure project');
    await page.getByTestId('pp-create-project').click();
    await expect(page.getByTestId('pp-status')).toHaveAttribute(
      'data-save-state',
      'saved',
    );
    await page.locator('.nav-link').filter({ hasText: '数据备份' }).first().click();
    await page.getByTestId('pb-page').waitFor();
    await page.getByTestId('pb-auto-now').click();
    await expect(page.getByTestId('pb-auto-status')).toHaveAttribute(
      'data-auto-state',
      'failed',
      { timeout: 30_000 },
    );
    report.failedWrite = true;
    report.steps.push('real blocked backup directory produced a failed automatic backup');
    fs.unlinkSync(autoDir);
    fs.mkdirSync(autoDir, { recursive: true });
    await page.getByTestId('pb-auto-now').click();
    await expect(page.getByTestId('pb-auto-status')).toHaveAttribute(
      'data-auto-state',
      'success',
      { timeout: 30_000 },
    );
    report.retrySucceeded = true;
    report.steps.push('retry after the filesystem block committed a valid version');

    const exportFile = path.join(caseDir, 'manual.json');
    await app.evaluate(({ dialog }, filePath) => {
      dialog.showSaveDialog = async () => ({ canceled: false, filePath });
    }, exportFile);
    await page.getByTestId('pb-export').click();
    await expect(page.getByTestId('pb-status')).toHaveAttribute(
      'data-save-state',
      'saved',
    );
    expect(fs.existsSync(exportFile)).toBe(true);

    // Make the owned directory unavailable again so the pre-restore copy fails;
    // the import must not run and the current project must remain intact.
    fs.renameSync(autoDir, path.join(backups, 'project1-auto-saved'));
    fs.writeFileSync(autoDir, 'blocked-during-recovery', 'utf8');
    page.once('dialog', (dialog) => dialog.accept());
    await page.getByTestId('pb-restore-input').setInputFiles(exportFile);
    await expect(page.getByTestId('pb-status')).toHaveAttribute(
      'data-save-state',
      'error',
      { timeout: 30_000 },
    );
    report.recoveryCopyFailed = true;
    await page.locator('.nav-link').filter({ hasText: '项目进展' }).first().click();
    await page.getByTestId('pp-page').waitFor();
    await expect(
      page.getByTestId('pp-project-row').filter({ hasText: 'Auto failure project' }),
    ).toBeVisible();
    report.steps.push(
      'recovery-copy failure aborted import and kept the current project',
    );
    fs.unlinkSync(autoDir);
    fs.renameSync(path.join(backups, 'project1-auto-saved'), autoDir);

    await page.screenshot({ path: path.join(caseDir, 'failure-retry.png') });
  } catch (error) {
    report.error = error.message;
    process.exitCode = 1;
  } finally {
    if (app) await app.evaluate(({ app }) => app.exit(0)).catch(() => {});
    fs.writeFileSync(path.join(caseDir, 'review.json'), JSON.stringify(report, null, 2));
    console.log(JSON.stringify(report, null, 2));
  }
})();
