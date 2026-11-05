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
  'output/runtime/DS-008',
  `archive-close-${failWrite ? 'failure' : 'success'}-${Date.now()}`,
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
const closeWindow = () =>
  app.evaluate(({ BrowserWindow }) => {
    setTimeout(() => BrowserWindow.getAllWindows()[0].close(), 0);
  });
const openArchive = async () => {
  await page.locator('.nav-link').filter({ hasText: '项目归档' }).first().click();
  await page.getByTestId('pa-page').waitFor();
  await page.waitForSelector('[data-testid="pa-loading"]', {
    state: 'detached',
    timeout: 20_000,
  });
};
const openProgress = async () => {
  await page.locator('.nav-link').filter({ hasText: '项目进展' }).first().click();
  await page.getByTestId('pp-page').waitFor();
};

(async () => {
  try {
    app = await launch();
    page = await app.firstWindow();
    page.setDefaultTimeout(20_000);
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
    await page.evaluate(() => {
      if (navigator.onLine) throw new Error('network is still online');
    });
    report.offline = true;
    report.steps.push('started a real Electron window with the browser context offline');

    await page.getByTestId('pp-new-project-input').fill('Offline archive');
    await page.getByTestId('pp-create-project').click();
    await expect(page.getByTestId('pp-status')).toHaveAttribute(
      'data-save-state',
      'saved',
    );
    await page.getByTestId('pp-append-step').click();
    await page.getByTestId('pp-insert-input').fill('Keep this unfinished');
    await page.getByTestId('pp-insert-save').click();
    page.once('dialog', (dialog) => dialog.accept());
    await page.getByTestId('pp-finish-project').click();
    await expect(page.getByTestId('pp-status')).toHaveAttribute(
      'data-save-state',
      'saved',
    );
    await expect(page.getByTestId('pp-view-archive')).toBeVisible();
    await openArchive();
    report.steps.push('finished a project while offline and opened its archive');

    // Hold the real IndexedDB op transaction so the restore is genuinely in
    // flight while the normal window close is requested.
    await page.evaluate(
      () =>
        new Promise((acquired, reject) => {
          const request = indexedDB.open('SUP_OPS');
          request.onerror = () => reject(request.error);
          request.onsuccess = () => {
            const db = request.result;
            const tx = db.transaction('ops', 'readwrite');
            let released = false;
            window.__releaseArchiveReview = () => {
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
            throw new Error('review: real archive restore failure');
          }
          return original.apply(this, args);
        };
      });
    }
    page.once('dialog', (dialog) => dialog.accept());
    await page.getByTestId('pa-restore').click();
    await expect(page.getByTestId('pa-status')).toHaveAttribute(
      'data-save-state',
      'saving',
    );
    await closeWindow();
    await page.waitForTimeout(600);
    report.windowsDuringWrite = await app.evaluate(
      ({ BrowserWindow }) => BrowserWindow.getAllWindows().length,
    );
    if (report.windowsDuringWrite !== 1) {
      throw new Error('Window closed before the archive restore write');
    }
    report.steps.push('normal close waited while a real IndexedDB transaction was held');
    await page.evaluate(() => window.__releaseArchiveReview());

    if (failWrite) {
      await expect(page.getByTestId('pa-status')).toHaveAttribute(
        'data-save-state',
        'error',
      );
      await expect(page.getByTestId('pa-card')).toHaveCount(1);
      report.windowsAfterFailure = await app.evaluate(
        ({ BrowserWindow }) => BrowserWindow.getAllWindows().length,
      );
      if (report.windowsAfterFailure !== 1) {
        throw new Error('Failed restore did not cancel the pending close');
      }
      report.steps.push('real IndexedDB failure retained the window and archive card');
      page.once('dialog', (dialog) => dialog.accept());
      await page.getByTestId('pa-restore').click();
      await expect(page.getByTestId('pa-status')).toHaveAttribute(
        'data-save-state',
        'saved',
      );
      report.steps.push('retrying the restore saved the same project');
      const closed = app.waitForEvent('close', { timeout: 10_000 });
      await closeWindow();
      await closed;
    } else {
      const closed = app.waitForEvent('close', { timeout: 10_000 });
      await closed;
      report.steps.push('window closed only after the committed restore');
    }

    app = await launch();
    page = await app.firstWindow();
    await page.context().setOffline(true);
    report.reopenedOffline = await page.evaluate(() => navigator.onLine === false);
    if (!report.reopenedOffline) throw new Error('reopened window is still online');
    await page.getByTestId('pp-page').waitFor();
    await openProgress();
    report.steps.push('reopened the same offline profile');
    await expect(
      page.getByTestId('pp-project-row').filter({ hasText: 'Offline archive' }),
    ).toBeVisible();
    await expect(
      page
        .getByTestId('pp-project-row')
        .filter({ hasText: 'Offline archive' })
        .locator('[data-testid="pp-step-title"][data-step-title="Keep this unfinished"]'),
    ).toBeVisible();
    report.reopenedProject = true;
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
        /* already closed */
      }
    }
    fs.writeFileSync(path.join(output, 'review.json'), JSON.stringify(report, null, 2));
    console.log(JSON.stringify({ output, ...report }, null, 2));
  }
})();
