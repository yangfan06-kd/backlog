const fs = require('node:fs');
const path = require('node:path');
const { _electron: electron } = require('playwright');

const root = 'G:/project1';
const release = process.argv[2];
if (!release) throw new Error('release dir required');
const exe = path.join(release, 'win-unpacked/Project1Preview.exe');
const out = path.join(root, 'output/runtime/DS-010/package-smoke');
const userData = path.join(out, 'user-data');
const exportsDir = path.join(out, 'exports');
for (const dir of [
  userData,
  path.join(out, 'logs'),
  path.join(out, 'crashes'),
  path.join(out, 'tmp'),
  exportsDir,
]) {
  fs.mkdirSync(dir, { recursive: true });
}
const env = {
  ...process.env,
  NODE_ENV: 'PROD',
  PROJECT1_PREVIEW_MODE: '1',
  PROJECT1_STORAGE_ROOT: root,
  PROJECT1_USER_DATA_DIR: userData,
  PROJECT1_LOG_DIR: path.join(out, 'logs'),
  PROJECT1_CRASH_DIR: path.join(out, 'crashes'),
  PROJECT1_PREVIEW_EXPORTS_DIR: exportsDir,
  TEMP: path.join(out, 'tmp'),
  TMP: path.join(out, 'tmp'),
};
delete env.ELECTRON_RUN_AS_NODE;
let app;
(async () => {
  try {
    app = await electron.launch({
      executablePath: exe,
      cwd: path.dirname(exe),
      env,
      args: ['--disable-tray', '--no-sandbox'],
    });
    const page = await app.firstWindow();
    page.setDefaultTimeout(20_000);
    await page.waitForURL(/^file:/);
    await page.getByTestId('pp-page').waitFor({ timeout: 30_000 });
    await app.evaluate(({ BrowserWindow }) => {
      const win = BrowserWindow.getAllWindows()[0];
      win.setSize(1280, 900);
      win.center();
    });
    await page.waitForTimeout(500);
    const info = await app.evaluate(({ app, BrowserWindow }) => ({
      name: app.getName(),
      version: app.getVersion(),
      isPackaged: app.isPackaged,
      execPath: process.execPath,
      userData: app.getPath('userData'),
      sessionData: app.getPath('sessionData'),
      logs: app.getPath('logs'),
      crashes: app.getPath('crashDumps'),
      windows: BrowserWindow.getAllWindows().length,
    }));
    const nav = await page.locator('.nav-link').allTextContents();
    fs.writeFileSync(
      path.join(out, 'identity.json'),
      JSON.stringify({ info, nav }, null, 2),
    );
    console.log(JSON.stringify({ info, nav }, null, 2));
    const setWindowSize = async (width, height) => {
      await app.evaluate(
        ({ BrowserWindow }, size) => {
          const win = BrowserWindow.getAllWindows()[0];
          win.setSize(size.width, size.height);
          win.center();
        },
        { width, height },
      );
      await page.waitForTimeout(500);
    };
    await page.screenshot({ path: path.join(out, 'package-shell-1280.png') });
    await setWindowSize(1600, 1000);
    await page.screenshot({ path: path.join(out, 'package-shell-1600.png') });
    await setWindowSize(1024, 900);
    await page.screenshot({ path: path.join(out, 'package-shell-1024.png') });
    await setWindowSize(1280, 900);
    await page.emulateMedia({ colorScheme: 'dark' });
    await page.waitForTimeout(500);
    await page.screenshot({ path: path.join(out, 'package-shell-dark-1280.png') });
    await page.emulateMedia({ colorScheme: 'light' });
    await page.locator('.nav-link').filter({ hasText: '数据备份' }).first().click();
    await page.getByTestId('pb-page').waitFor();
    await page.waitForTimeout(500);
    await page.screenshot({ path: path.join(out, 'package-backup-1280.png') });
    await page.locator('.nav-link').filter({ hasText: '关于' }).first().click();
    await page.getByTestId('pabout-page').waitFor();
    await page.waitForTimeout(500);
    await page.screenshot({ path: path.join(out, 'package-about-1280.png') });
  } finally {
    if (app) await app.evaluate(({ app }) => app.exit(0)).catch(() => {});
  }
})();
