const fs = require('node:fs');
const path = require('node:path');
const { _electron: electron } = require('playwright');

const repo = path.resolve(__dirname, '..', '..');
const root = 'G:/project1';
const out = path.join(root, 'output/runtime/DS-010/dev-preview-smoke');
const userData = path.join(out, 'user-data');
fs.mkdirSync(userData, { recursive: true });
const env = {
  ...process.env,
  NODE_ENV: 'PROD',
  PROJECT1_PREVIEW_MODE: '1',
  PROJECT1_STORAGE_ROOT: root,
  PROJECT1_USER_DATA_DIR: userData,
  PROJECT1_LOG_DIR: path.join(out, 'logs'),
  PROJECT1_CRASH_DIR: path.join(out, 'crashes'),
  TEMP: path.join(out, 'tmp'),
  TMP: path.join(out, 'tmp'),
};
delete env.ELECTRON_RUN_AS_NODE;
for (const dir of [env.PROJECT1_LOG_DIR, env.PROJECT1_CRASH_DIR, env.TEMP]) {
  fs.mkdirSync(dir, { recursive: true });
}
let app;
(async () => {
  try {
    app = await electron.launch({
      cwd: repo,
      env,
      args: ['.', `--user-data-dir=${userData}`, '--disable-tray', '--no-sandbox'],
    });
    const page = await app.firstWindow();
    page.setDefaultTimeout(20_000);
    await page.waitForURL(/^file:/);
    await page.reload();
    await page.getByTestId('pp-page').waitFor({ timeout: 30_000 });
    await page.waitForTimeout(4500);
    await app.evaluate(({ BrowserWindow }) => {
      const w = BrowserWindow.getAllWindows()[0];
      w.setSize(1280, 900);
      w.center();
    });
    await page.waitForTimeout(300);
    console.log(
      JSON.stringify(
        {
          url: page.url(),
          nav: await page.locator('.nav-link').allTextContents(),
          hasMainHeader: await page.locator('main-header').count(),
          hasProjectTree: await page.locator('[data-testid="nav-projects"]').count(),
          preview: await page.evaluate(() => window.ea?.isPreviewMode?.()),
          online: await page.evaluate(() => navigator.onLine),
        },
        null,
        2,
      ),
    );
    await page.screenshot({ path: path.join(out, 'preview-1280.png') });
    await page.locator('.nav-link').filter({ hasText: '数据备份' }).first().click();
    await page.getByTestId('pb-page').waitFor();
    await page.screenshot({ path: path.join(out, 'backup-1280.png') });
    await page.locator('.nav-link').filter({ hasText: '关于' }).first().click();
    await page.getByTestId('pabout-page').waitFor();
    await page.screenshot({ path: path.join(out, 'about-1280.png') });
  } finally {
    if (app) await app.evaluate(({ app }) => app.exit(0)).catch(() => {});
  }
})();
