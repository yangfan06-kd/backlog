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
  `output/runtime/${process.env.PROJECT1_REVIEW_TASK || 'DS-007'}`,
  `routine-close-${failWrite ? 'failure' : 'success'}-${Date.now()}`,
);
const userData = path.join(output, 'user-data');
fs.mkdirSync(output, { recursive: true });
const env = { ...process.env, NODE_ENV: 'PROD', PROJECT1_USER_DATA_DIR: userData };
delete env.ELECTRON_RUN_AS_NODE;
const report = { userData, failWrite, steps: [] };
let app;
let page;

const launch = () =>
  electron.launch({
    cwd: repo,
    env,
    args: ['.', `--user-data-dir=${userData}`, '--disable-tray', '--no-sandbox'],
  });
const openRoutine = async () => {
  await page.locator('.nav-link').filter({ hasText: '常态事项' }).first().click();
  await page.getByTestId('pr-page').waitFor();
};
const closeWindow = () =>
  app.evaluate(({ BrowserWindow }) => {
    setTimeout(() => BrowserWindow.getAllWindows()[0].close(), 0);
  });

(async () => {
  try {
    app = await launch();
    page = await app.firstWindow();
    page.setDefaultTimeout(15_000);
    await page.addInitScript(() => {
      for (const key of [
        'SUP_ONBOARDING_PRESET_DONE',
        'SUP_ONBOARDING_HINTS_DONE',
        'SUP_IS_SHOW_TOUR',
        'SUP_EXAMPLE_TASKS_CREATED',
      ]) {
        localStorage.setItem(key, 'true');
      }
    });
    await page.waitForURL(/^file:/);
    await page.reload();
    await page.getByTestId('pp-page').waitFor();
    await page.context().setOffline(true);
    await expect.poll(() => page.evaluate(() => navigator.onLine)).toBe(false);
    report.networkDisabled = true;
    await openRoutine();
    await page.getByTestId('pr-new-item-title').fill('Electron routine');
    await page.getByTestId('pr-create-item').click();
    await expect(page.getByTestId('pr-status')).toHaveAttribute(
      'data-save-state',
      'saved',
    );
    await page.getByTestId('pr-entry-body').fill('Existing offline record');
    await page.getByTestId('pr-save-entry').click();
    await expect(page.getByTestId('pr-status')).toHaveAttribute(
      'data-save-state',
      'saved',
    );
    report.steps.push('created a routine item and saved an offline record');

    // Electron uses the in-process lock fallback. Hold the actual IndexedDB op
    // transaction so the next append is genuinely in flight while closing.
    await page.evaluate(
      () =>
        new Promise((acquired, reject) => {
          const request = indexedDB.open('SUP_OPS');
          request.onerror = () => reject(request.error);
          request.onsuccess = () => {
            const db = request.result;
            const tx = db.transaction('ops', 'readwrite');
            let released = false;
            window.__releaseRoutineReview = () => {
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
    if (failWrite) {
      await page.evaluate(() => {
        const original = IDBObjectStore.prototype.put;
        let failNext = true;
        IDBObjectStore.prototype.put = function (...args) {
          if (this.name === 'vector_clock' && failNext) {
            failNext = false;
            throw new Error('review: real routine append failure');
          }
          return original.apply(this, args);
        };
      });
    }
    await page.getByTestId('pr-entry-body').fill('Close while saving');
    await page.getByTestId('pr-save-entry').click();
    await expect(page.getByTestId('pr-status')).toHaveAttribute(
      'data-save-state',
      'saving',
    );
    await closeWindow();
    await page.waitForTimeout(600);
    report.windowsDuringWrite = await app.evaluate(
      ({ BrowserWindow }) => BrowserWindow.getAllWindows().length,
    );
    if (report.windowsDuringWrite !== 1) {
      throw new Error('Window closed before the routine write');
    }
    report.steps.push('normal close waited while a real IndexedDB transaction was held');

    if (failWrite) {
      await page.evaluate(() => window.__releaseRoutineReview());
      await expect(page.getByTestId('pr-status')).toHaveAttribute(
        'data-save-state',
        'failed',
      );
      await expect(page.getByTestId('pr-entry-body')).toHaveValue('Close while saving');
      report.windowsAfterFailure = await app.evaluate(
        ({ BrowserWindow }) => BrowserWindow.getAllWindows().length,
      );
      if (report.windowsAfterFailure !== 1) {
        throw new Error('Failed write did not cancel the pending close');
      }
      report.steps.push('real IndexedDB failure retained the window and input');
      if (await page.getByTestId('pr-draft-prompt').isVisible()) {
        await page.getByTestId('pr-draft-continue').click();
        report.steps.push('the pending close was cancelled and the draft kept');
      }
      await page.getByTestId('pr-save-entry').click();
      await expect(page.getByTestId('pr-status')).toHaveAttribute(
        'data-save-state',
        'saved',
      );
      report.steps.push('retrying the same record after the failure saved it');
      const closed = app.waitForEvent('close', { timeout: 10_000 });
      await closeWindow();
      await closed;
      report.steps.push('a second explicit normal close succeeded');
    } else {
      const closed = app.waitForEvent('close', { timeout: 10_000 });
      await page.evaluate(() => window.__releaseRoutineReview());
      await closed;
      report.steps.push('normal close resumed only after the committed record');
    }

    app = await launch();
    page = await app.firstWindow();
    await page.context().setOffline(true);
    await page.getByTestId('pp-page').waitFor();
    await openRoutine();
    await expect.poll(() => page.evaluate(() => navigator.onLine)).toBe(false);
    report.reopenedOffline = true;
    const entries = await page.getByTestId('pr-day-entry-body').allTextContents();
    report.entriesAfterReopen = entries;
    if (!entries.includes('Existing offline record')) {
      throw new Error('The initial offline record did not survive reopening');
    }
    if (!entries.includes('Close while saving')) {
      throw new Error('The retried routine record did not survive reopening');
    }
    report.steps.push('reopened the same profile and verified durable routine records');
    await page.screenshot({ path: path.join(output, 'after-reopen.png') });
  } catch (error) {
    report.error = error.message;
    process.exitCode = 1;
    if (page && !page.isClosed()) {
      await page.screenshot({ path: path.join(output, 'failure.png') });
    }
  } finally {
    if (app) {
      try {
        await app.evaluate(({ app }) => app.exit(0));
      } catch {
        /* closed */
      }
    }
    fs.writeFileSync(path.join(output, 'review.json'), JSON.stringify(report, null, 2));
    console.log(JSON.stringify({ output, ...report }, null, 2));
  }
})();
