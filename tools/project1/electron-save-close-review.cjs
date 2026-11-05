const fs = require('node:fs');
const path = require('node:path');
const { _electron: electron } = require('playwright');
const repo = path.resolve(__dirname, '..', '..');
const root = path.resolve(process.env.PROJECT1_STORAGE_ROOT || '');
if (root !== path.resolve('G:/project1')) throw new Error('Use the project environment');
const output = path.join(root, 'output/runtime/CX-005', `save-close-${Date.now()}`);
const userData = path.join(output, 'user-data');
fs.mkdirSync(output, { recursive: true });
const env = { ...process.env, NODE_ENV: 'PROD', PROJECT1_USER_DATA_DIR: userData };
delete env.ELECTRON_RUN_AS_NODE;
const report = { userData };
let app;
(async () => {
  try {
    app = await electron.launch({
      cwd: repo,
      env,
      args: ['.', `--user-data-dir=${userData}`, '--disable-tray', '--no-sandbox'],
    });
    const page = await app.firstWindow();
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
    await page.waitForSelector('[data-testid="pp-page"]');
    await page.getByTestId('pp-new-project-input').fill('Close during save');
    await page.getByTestId('pp-create-project').click();
    await page.waitForSelector('[data-testid="pp-status"][data-save-state="saved"]');
    await page.getByTestId('pp-append-step').click();
    await page.getByTestId('pp-insert-input').fill('Persist before close');
    await page.getByTestId('pp-insert-save').click();
    await page.waitForSelector('[data-testid="pp-status"][data-save-state="saved"]');
    // Keep a real IndexedDB write transaction active. The subsequent op append
    // waits for it, while the renderer/main process continue handling close events.
    await page.evaluate(
      () =>
        new Promise((resolve, reject) => {
          const request = indexedDB.open('SUP_OPS');
          request.onerror = () => reject(request.error);
          request.onsuccess = () => {
            const db = request.result;
            const tx = db.transaction('ops', 'readwrite');
            let released = false;
            window.__releaseReviewWrite = () => {
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
            resolve();
          };
        }),
    );
    await page.getByTestId('pp-step-title').click();
    await page.waitForSelector('[data-testid="pp-status"][data-save-state="saving"]');
    const closed = app.waitForEvent('close', { timeout: 10_000 });
    await app.evaluate(({ BrowserWindow }) => {
      setTimeout(() => BrowserWindow.getAllWindows()[0].close(), 0);
    });
    const finish = page.locator('dialog-finish-day-before-close');
    try {
      await finish.waitFor({ state: 'visible', timeout: 1500 });
      await finish.locator('button[mat-stroked-button]').click();
    } catch {
      /* No Finish Day prompt when the active work context has no done tasks. */
    }
    await page.evaluate(() => window.__releaseReviewWrite());
    try {
      await closed;
      report.closedAfterSave = true;
      app = await electron.launch({
        cwd: repo,
        env,
        args: ['.', `--user-data-dir=${userData}`, '--disable-tray', '--no-sandbox'],
      });
      const reopened = await app.firstWindow();
      await reopened.waitForSelector('[data-testid="pp-entry-body"]');
      report.entriesAfterReopen = await reopened
        .getByTestId('pp-entry-body')
        .allTextContents();
      if (!report.entriesAfterReopen.includes('Persist before close')) {
        throw new Error('The completed entry did not survive reopening');
      }
      report.saved = true;
    } catch {
      report.closedAfterSave = false;
      report.status = await page.getByTestId('pp-status').getAttribute('data-save-state');
      report.entries = await page.getByTestId('pp-entry-body').allTextContents();
      await page.screenshot({ path: path.join(output, 'stuck-after-saved.png') });
      throw new Error(
        'The save was acknowledged, but the requested normal window close never resumed',
      );
    }
  } catch (error) {
    report.error = error.message;
    process.exitCode = 1;
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
