const fs = require('node:fs');
const path = require('node:path');
const { _electron: electron } = require('playwright');
const { expect } = require('@playwright/test');

const root = 'G:/project1';
const release = process.argv[2];
if (!release) throw new Error('release dir required');
const caseDir = path.join(root, 'output/runtime/DS-010', `auto-schedule-${Date.now()}`);
const userData = path.join(caseDir, 'user-data');
for (const dir of [
  userData,
  path.join(caseDir, 'logs'),
  path.join(caseDir, 'crashes'),
  path.join(caseDir, 'tmp'),
]) {
  fs.mkdirSync(dir, { recursive: true });
}
const env = {
  ...process.env,
  NODE_ENV: 'PROD',
  PROJECT1_PREVIEW_MODE: '1',
  PROJECT1_STORAGE_ROOT: root,
  PROJECT1_USER_DATA_DIR: userData,
  PROJECT1_LOG_DIR: path.join(caseDir, 'logs'),
  PROJECT1_CRASH_DIR: path.join(caseDir, 'crashes'),
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
    page.setDefaultTimeout(30_000);
    await page.getByTestId('pp-page').waitFor({ timeout: 30_000 });
    await page.waitForTimeout(1500);
    const autoDir = path.join(userData, 'backups', 'project1-auto');
    expect(fs.existsSync(autoDir) ? fs.readdirSync(autoDir).length : 0).toBe(0);
    await page.getByTestId('pp-new-project-input').fill('Scheduled auto project');
    await page.getByTestId('pp-create-project').click();
    await expect(page.getByTestId('pp-status')).toHaveAttribute(
      'data-save-state',
      'saved',
    );
    await page.waitForTimeout(32_000);
    const files = fs
      .readdirSync(autoDir, { withFileTypes: true })
      .filter((entry) => entry.isFile() && entry.name.startsWith('auto-'));
    expect(files.length).toBeGreaterThan(0);
    report.autoFiles = files.map((entry) => entry.name);
    report.steps.push(
      'packaged exe produced an automatic version after the 30-second debounce',
    );
    await page.screenshot({ path: path.join(caseDir, 'auto-scheduled.png') });
    const closed = app.waitForEvent('close', { timeout: 20_000 });
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].close());
    await closed;
    app = undefined;
  } catch (error) {
    report.error = error.message;
    process.exitCode = 1;
  } finally {
    if (app) await app.evaluate(({ app }) => app.exit(0)).catch(() => {});
    fs.writeFileSync(path.join(caseDir, 'review.json'), JSON.stringify(report, null, 2));
    console.log(JSON.stringify(report, null, 2));
  }
})();
