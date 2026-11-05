const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { _electron: electron } = require('playwright');
const { expect } = require('@playwright/test');

const root = 'G:/project1';
const mode = process.argv[2];
const release = process.argv[3];
if (!['create', 'verify'].includes(mode) || !release) {
  throw new Error('usage: electron-package-ab.cjs create|verify <release>');
}
const caseDir = path.join(root, 'output/runtime/DS-010/package-ab');
const profile = path.join(caseDir, 'profile');
const dirs = {
  userData: path.join(profile, 'user-data'),
  logs: path.join(profile, 'logs'),
  crashes: path.join(profile, 'crashes'),
  tmp: path.join(profile, 'tmp'),
};
for (const dir of Object.values(dirs)) fs.mkdirSync(dir, { recursive: true });
const env = {
  ...process.env,
  NODE_ENV: 'PROD',
  PROJECT1_PREVIEW_MODE: '1',
  PROJECT1_STORAGE_ROOT: root,
  PROJECT1_USER_DATA_DIR: dirs.userData,
  PROJECT1_LOG_DIR: dirs.logs,
  PROJECT1_CRASH_DIR: dirs.crashes,
  TEMP: dirs.tmp,
  TMP: dirs.tmp,
  SystemRoot: process.env.SystemRoot || 'C:\\Windows',
  windir: process.env.windir || 'C:\\Windows',
  ComSpec: 'C:\\Windows\\system32\\cmd.exe',
};
delete env.ELECTRON_RUN_AS_NODE;
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
    if (mode === 'create') {
      await page.getByTestId('pp-new-project-input').fill('AB package data');
      await page.getByTestId('pp-create-project').click();
      await expect(page.getByTestId('pp-status')).toHaveAttribute(
        'data-save-state',
        'saved',
      );
      page.once('dialog', (dialog) => dialog.accept());
      await page.getByTestId('pp-finish-project').click();
      await expect(page.getByTestId('pp-view-archive')).toBeVisible();
      const second = spawn(path.join(release, 'win-unpacked/Project1Preview.exe'), [], {
        cwd: path.join(release, 'win-unpacked'),
        env,
        stdio: 'ignore',
      });
      await new Promise((resolve) => setTimeout(resolve, 5000));
      const windows = await app.evaluate(
        ({ BrowserWindow }) => BrowserWindow.getAllWindows().length,
      );
      report({
        mode,
        windowsAfterSecondLaunch: windows,
        secondExited: second.exitCode !== null,
      });
      expect(windows).toBe(1);
    } else {
      await page.locator('.nav-link').filter({ hasText: '项目归档' }).first().click();
      await page.getByTestId('pa-page').waitFor();
      await page.waitForTimeout(800);
      await expect(page.getByTestId('pa-card')).toContainText('AB package data');
      report({ mode, found: true });
    }
    const closed = app.waitForEvent('close', { timeout: 15_000 });
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].close());
    await closed;
    app = undefined;
  } catch (error) {
    report({ mode, error: error.message });
    process.exitCode = 1;
  } finally {
    if (app) await app.evaluate(({ app }) => app.exit(0)).catch(() => {});
  }
})();

function report(value) {
  fs.writeFileSync(
    path.join(caseDir, `${mode}.json`),
    JSON.stringify({ release, ...value }, null, 2),
  );
  console.log(JSON.stringify({ release, ...value }, null, 2));
}
