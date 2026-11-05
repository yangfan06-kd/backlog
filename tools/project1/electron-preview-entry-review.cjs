const fs = require('node:fs');
const path = require('node:path');
const { _electron: electron } = require('playwright');
const { expect } = require('@playwright/test');
const root = 'G:/project1';
const release = process.argv[2];
const check = process.argv[3] || 'shortcuts';
const dir = path.join(root, 'output/runtime/CX-009', `entry-${check}-${Date.now()}`);
fs.mkdirSync(dir, { recursive: true });
const env = {
  ...process.env,
  NODE_ENV: 'PROD',
  PROJECT1_STORAGE_ROOT: root,
  PROJECT1_USER_DATA_DIR: path.join(dir, 'data'),
  PROJECT1_LOG_DIR: path.join(dir, 'logs'),
  PROJECT1_CRASH_DIR: path.join(dir, 'crashes'),
  TEMP: path.join(dir, 'tmp'),
  TMP: path.join(dir, 'tmp'),
};
if (check === 'identity') delete env.PROJECT1_PREVIEW_MODE;
else env.PROJECT1_PREVIEW_MODE = '1';
delete env.ELECTRON_RUN_AS_NODE;
for (const p of [
  env.PROJECT1_USER_DATA_DIR,
  env.PROJECT1_LOG_DIR,
  env.PROJECT1_CRASH_DIR,
  env.TEMP,
])
  fs.mkdirSync(p, { recursive: true });
const report = { release, check, dir };
let app;
(async () => {
  try {
    const exe = path.join(release, 'win-unpacked/Project1Preview.exe');
    app = await electron.launch({
      executablePath: exe,
      cwd: path.dirname(exe),
      env,
      args: ['--disable-tray'],
    });
    const page = await app.firstWindow();
    await page.getByTestId('pp-page').waitFor({ timeout: 30000 });
    if (check === 'identity') {
      report.rendererPreview = await page.evaluate(() => window.ea.isPreviewMode());
      expect(report.rendererPreview).toBe(true);
    } else {
      await page.getByRole('heading', { name: '项目进展', exact: true }).click();
      await page.keyboard.press('Shift+P');
      // Give the async dialog import its normal opportunity to render before
      // asserting that a suppressed shortcut produced no UI.
      await page.waitForTimeout(500);
      await expect(page.locator('dialog-create-project')).toHaveCount(0);
      await page.keyboard.press('f');
      await expect(page.locator('focus-mode-overlay')).toHaveCount(0);
      report.legacyShortcutsSuppressed = true;
    }
    report.passed = true;
  } catch (error) {
    report.error = error.message;
    process.exitCode = 1;
  } finally {
    if (app) await app.evaluate(({ app }) => app.exit(0)).catch(() => {});
    fs.writeFileSync(path.join(dir, 'review.json'), JSON.stringify(report, null, 2));
    console.log(JSON.stringify(report, null, 2));
  }
})();
