const fs = require('node:fs');
const path = require('node:path');
const { _electron: electron } = require('playwright');
const { expect } = require('@playwright/test');
const repo = path.resolve(__dirname, '..', '..');
const root = path.resolve(process.env.PROJECT1_STORAGE_ROOT || '');
if (root !== path.resolve('G:/project1')) throw new Error('Use the project environment');
const failWrite = process.argv.includes('--fail');
const output = path.join(
  root,
  'output/runtime/CX-006',
  `overview-close-${failWrite ? 'failure' : 'success'}-${Date.now()}`,
);
const userData = path.join(output, 'user-data');
fs.mkdirSync(output, { recursive: true });
const env = { ...process.env, NODE_ENV: 'PROD', PROJECT1_USER_DATA_DIR: userData };
delete env.ELECTRON_RUN_AS_NODE;
const launch = () =>
  electron.launch({
    cwd: repo,
    env,
    args: ['.', `--user-data-dir=${userData}`, '--disable-tray', '--no-sandbox'],
  });
const report = { userData, failWrite, steps: [] };
let app;
let page;
const closeWindow = () =>
  app.evaluate(({ BrowserWindow }) => {
    setTimeout(() => BrowserWindow.getAllWindows()[0].close(), 0);
  });
const openOverview = async () => {
  await page.locator('.nav-link').filter({ hasText: '四象限总览' }).first().click();
  await page.getByTestId('po-page').waitFor();
};
(async () => {
  try {
    app = await launch();
    page = await app.firstWindow();
    page.setDefaultTimeout(10_000);
    await page.addInitScript(() => {
      for (const key of [
        'SUP_ONBOARDING_PRESET_DONE',
        'SUP_ONBOARDING_HINTS_DONE',
        'SUP_IS_SHOW_TOUR',
        'SUP_EXAMPLE_TASKS_CREATED',
      ])
        localStorage.setItem(key, 'true');
    });
    await page.waitForURL(/^file:/);
    await page.reload();
    await page.getByTestId('pp-page').waitFor();
    await page.getByTestId('pp-new-project-input').fill('真实分类关窗检查');
    await page.getByTestId('pp-create-project').click();
    await expect(page.getByTestId('pp-status')).toHaveAttribute(
      'data-save-state',
      'saved',
    );
    await openOverview();
    // Electron uses a fallback mutex, not navigator.locks. Hold the actual
    // IndexedDB store transaction so the renderer remains responsive.
    await page.evaluate(
      () =>
        new Promise((acquired, reject) => {
          const request = indexedDB.open('SUP_OPS');
          request.onerror = () => reject(request.error);
          request.onsuccess = () => {
            const db = request.result;
            const tx = db.transaction('ops', 'readwrite');
            let released = false;
            window.__releaseClassificationReview = () => {
              released = true;
            };
            const pump = () => {
              const get = tx.objectStore('ops').get(1);
              get.onsuccess = () => {
                if (!released) pump();
              };
            };
            tx.oncomplete = () => db.close();
            pump();
            acquired();
          };
        }),
    );
    if (failWrite)
      await page.evaluate(() => {
        const original = IDBObjectStore.prototype.put;
        let failNext = true;
        IDBObjectStore.prototype.put = function (...args) {
          if (this.name === 'vector_clock' && failNext) {
            failNext = false;
            throw new Error('review: real classification append failure');
          }
          return original.apply(this, args);
        };
      });
    await page.getByTestId('po-classify').click();
    await page.getByTestId('po-quadrant-option-important').click();
    await expect(page.getByTestId('po-status')).toHaveAttribute(
      'data-save-state',
      'saving',
    );
    await closeWindow();
    // The renderer remains responsive while the actual operation queue is held.
    await page.waitForTimeout(600);
    report.windowsDuringWrite = await app.evaluate(
      ({ BrowserWindow }) => BrowserWindow.getAllWindows().length,
    );
    if (report.windowsDuringWrite !== 1)
      throw new Error('Window closed before the classification write');
    report.steps.push('normal close waited while a real IndexedDB transaction was held');
    if (failWrite) {
      await page.evaluate(() => window.__releaseClassificationReview());
      await expect(page.getByTestId('po-status')).toHaveAttribute(
        'data-save-state',
        'failed',
      );
      await expect(
        page.getByTestId('po-unclassified').getByTestId('po-project-row'),
      ).toHaveCount(1);
      report.windowsAfterFailure = await app.evaluate(
        ({ BrowserWindow }) => BrowserWindow.getAllWindows().length,
      );
      if (report.windowsAfterFailure !== 1)
        throw new Error('Failed write did not cancel the pending close');
      report.steps.push(
        'real IndexedDB failure retained the window and original category',
      );
      const closed = app.waitForEvent('close', { timeout: 10_000 });
      await closeWindow();
      await closed;
      report.steps.push('a second explicit normal close succeeded');
    } else {
      const closed = app.waitForEvent('close', { timeout: 10_000 });
      await page.evaluate(() => window.__releaseClassificationReview());
      await closed;
      report.steps.push('normal close resumed only after the committed classification');
    }
    app = await launch();
    page = await app.firstWindow();
    await page.getByTestId('pp-page').waitFor();
    await openOverview();
    const expectedGroup = failWrite
      ? page.getByTestId('po-unclassified')
      : page.locator('[data-testid="po-quadrant"][data-quadrant="important"]');
    await expect(expectedGroup.getByTestId('po-project-row')).toHaveCount(1);
    report.steps.push('reopened the same profile and verified the durable category');
    await page.screenshot({ path: path.join(output, 'after-reopen.png') });
  } catch (error) {
    report.error = error.message;
    process.exitCode = 1;
    if (page && !page.isClosed())
      await page.screenshot({ path: path.join(output, 'failure.png') });
  } finally {
    if (app)
      try {
        await app.evaluate(({ app }) => app.exit(0));
      } catch {
        /* closed */
      }
    fs.writeFileSync(path.join(output, 'review.json'), JSON.stringify(report, null, 2));
    console.log(JSON.stringify({ output, ...report }, null, 2));
  }
})();
