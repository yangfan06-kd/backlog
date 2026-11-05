const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { _electron: electron } = require('playwright');
const { expect } = require('@playwright/test');

const root = 'G:/project1';
const releaseA = process.argv[2];
const releaseB = process.argv[3];
if (!releaseA || !releaseB) throw new Error('two release dirs required');
const caseDir = path.join(root, 'output/runtime/DS-010', `multibuild-${Date.now()}`);
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
  SystemRoot: process.env.SystemRoot || 'C:\\\\Windows',
  windir: process.env.windir || 'C:\\\\Windows',
  ComSpec: 'C:\\\\Windows\\\\system32\\\\cmd.exe',
};
delete env.ELECTRON_RUN_AS_NODE;
const report = { releaseA, releaseB, steps: [] };
let app;

const launch = async (release) => {
  app = await electron.launch({
    executablePath: path.join(release, 'win-unpacked/Project1Preview.exe'),
    cwd: path.join(release, 'win-unpacked'),
    env,
    args: ['--disable-tray', '--no-sandbox'],
  });
  const page = await app.firstWindow();
  page.setDefaultTimeout(25_000);
  await page.getByTestId('pp-page').waitFor({ timeout: 30_000 });
  return page;
};
const closeApp = async () => {
  if (!app) return;
  const closed = app.waitForEvent('close', { timeout: 15_000 });
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].close());
  await closed;
  app = undefined;
};

(async () => {
  try {
    let page = await launch(releaseA);
    await page.getByTestId('pp-new-project-input').fill('Cross package data');
    await page.getByTestId('pp-create-project').click();
    await expect(page.getByTestId('pp-status')).toHaveAttribute(
      'data-save-state',
      'saved',
    );
    page.once('dialog', (dialog) => dialog.accept());
    await page.getByTestId('pp-finish-project').click();
    await expect(page.getByTestId('pp-view-archive')).toBeVisible();
    await closeApp();
    report.steps.push(
      'created and archived a project in release A, then closed normally',
    );

    page = await launch(releaseB);
    await page.locator('.nav-link').filter({ hasText: '项目归档' }).first().click();
    await page.getByTestId('pa-page').waitFor();
    await page.waitForTimeout(800);
    await expect(page.getByTestId('pa-card')).toContainText('Cross package data');
    report.steps.push('release B used the same profile and kept the archive');
    await closeApp();

    // Same profile launched twice: the second process must exit and not create
    // a second window/data writer.
    page = await launch(releaseA);
    const second = spawn(path.join(releaseA, 'win-unpacked/Project1Preview.exe'), [], {
      cwd: path.join(releaseA, 'win-unpacked'),
      env,
      detached: false,
      stdio: 'ignore',
    });
    await new Promise((resolve) => setTimeout(resolve, 5000));
    report.windowsAfterSecondLaunch = await app.evaluate(
      ({ BrowserWindow }) => BrowserWindow.getAllWindows().length,
    );
    report.secondExited = second.exitCode !== null;
    expect(report.windowsAfterSecondLaunch).toBe(1);
    await closeApp();
    report.steps.push('same profile second launch exited without a second window');
  } catch (error) {
    report.error = error.message;
    process.exitCode = 1;
  } finally {
    if (app) await app.evaluate(({ app }) => app.exit(0)).catch(() => {});
    fs.writeFileSync(path.join(caseDir, 'review.json'), JSON.stringify(report, null, 2));
    console.log(JSON.stringify({ caseDir, ...report }, null, 2));
  }
})();
