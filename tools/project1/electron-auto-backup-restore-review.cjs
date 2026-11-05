const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { _electron: electron } = require('playwright');
const { expect } = require('@playwright/test');
const [release, sourceCase] = process.argv.slice(2);
if (
  !release ||
  !sourceCase ||
  !path
    .resolve(sourceCase)
    .startsWith(path.resolve('G:/project1/output/runtime') + path.sep)
)
  throw new Error('Project-local package and review profile required');
const profile = path.join(sourceCase, 'profile-b');
const exportFile = path.join(profile, 'exports/cx010-verified-restored.json');
const env = {
  ...process.env,
  NODE_ENV: 'PROD',
  PROJECT1_PREVIEW_MODE: '1',
  PROJECT1_STORAGE_ROOT: 'G:/project1',
  PROJECT1_USER_DATA_DIR: path.join(profile, 'user-data'),
  PROJECT1_LOG_DIR: path.join(profile, 'logs'),
  PROJECT1_CRASH_DIR: path.join(profile, 'crashes'),
  TEMP: path.join(profile, 'tmp'),
  TMP: path.join(profile, 'tmp'),
  TMPDIR: path.join(profile, 'tmp'),
};
delete env.ELECTRON_RUN_AS_NODE;
let app;
const report = { release, sourceCase, comparedSlices: [], passed: false };
(async () => {
  try {
    app = await electron.launch({
      executablePath: path.join(release, 'win-unpacked/Project1Preview.exe'),
      cwd: path.join(release, 'win-unpacked'),
      env,
      args: ['--disable-tray', '--no-sandbox'],
    });
    const page = await app.firstWindow();
    page.setDefaultTimeout(30000);
    await page.context().setOffline(true);
    await page.getByTestId('pp-page').waitFor();
    await page.locator('.nav-link').filter({ hasText: '数据备份' }).click();
    await page.getByTestId('pb-page').waitFor();
    await app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0].setSize(1280, 900),
    );
    await expect(page.getByTestId('pb-export')).toBeEnabled();
    await app.evaluate(({ dialog }, filePath) => {
      dialog.showSaveDialog = async () => ({ canceled: false, filePath });
    }, exportFile);
    await page.getByTestId('pb-export').click();
    await expect(page.getByTestId('pb-status')).toHaveAttribute(
      'data-save-state',
      'saved',
    );
    const before = JSON.parse(
      fs.readFileSync(
        path.join(sourceCase, 'profile-a/exports/package-backup.json'),
        'utf8',
      ),
    ).data;
    const after = JSON.parse(fs.readFileSync(exportFile, 'utf8')).data;
    for (const slice of ['project', 'task', 'archiveYoung', 'archiveOld']) {
      assert.deepEqual(
        after[slice],
        before[slice],
        `${slice} must survive complete restore and another offline launch`,
      );
      report.comparedSlices.push(slice);
    }
    await page.screenshot({ path: path.join(sourceCase, 'backup-restored-1280.png') });
    report.identity = await app.evaluate(({ app }) => ({
      isPackaged: app.isPackaged,
      execPath: process.execPath,
    }));
    const closed = app.waitForEvent('close', { timeout: 20000 });
    await app.evaluate(({ BrowserWindow }) => {
      setTimeout(() => BrowserWindow.getAllWindows()[0].close(), 0);
    });
    await closed;
    app = undefined;
    report.passed = true;
  } catch (error) {
    report.error = error.message;
    process.exitCode = 1;
  } finally {
    if (app) await app.evaluate(({ app }) => app.exit(0)).catch(() => {});
    fs.writeFileSync(
      path.join(sourceCase, 'restored-slices-review.json'),
      JSON.stringify(report, null, 2),
    );
    console.log(JSON.stringify(report, null, 2));
  }
})();
