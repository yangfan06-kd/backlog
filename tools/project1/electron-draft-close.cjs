/**
 * DS-005 Electron draft/close smoke:
 * - a fresh Windows profile lands on the Chinese project-progress page;
 * - a dirty draft keeps the window open and offers continue/save/discard;
 * - a failed save keeps the draft and window; a later save closes;
 * - reopening reads the saved step.
 *
 * Uses the real main-process close handshake (ExecBeforeCloseService), not app.exit.
 */
const fs = require('node:fs');
const path = require('node:path');
const { _electron: electron } = require('playwright');

const repo = path.resolve(__dirname, '..', '..');
const projectRoot = path.resolve(process.env.PROJECT1_STORAGE_ROOT || '');
if (projectRoot !== path.resolve('G:/project1'))
  throw new Error('Use the project environment first');
const runtimeRoot = path.dirname(process.env.PROJECT1_USER_DATA_DIR);
if (!runtimeRoot.startsWith(projectRoot + path.sep))
  throw new Error('Runtime path escapes project');
const outDir = path.join(runtimeRoot, `electron-draft-close-${Date.now()}`);
const userData = path.join(outDir, 'user-data');
fs.mkdirSync(outDir, { recursive: true });

const env = {
  ...process.env,
  NODE_ENV: 'PROD',
  ELECTRON_ENABLE_LOGGING: '1',
  PROJECT1_USER_DATA_DIR: userData,
};
delete env.ELECTRON_RUN_AS_NODE;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const launch = () =>
  electron.launch({
    args: [
      '.',
      `--user-data-dir=${userData}`,
      '--no-sandbox',
      '--disable-tray',
      '--lang=zh-CN',
    ],
    cwd: repo,
    env,
  });

const addOnboardingSkip = (page) =>
  page.addInitScript(() => {
    try {
      localStorage.setItem('SUP_ONBOARDING_PRESET_DONE', 'true');
      localStorage.setItem('SUP_ONBOARDING_HINTS_DONE', 'true');
      localStorage.setItem('SUP_IS_SHOW_TOUR', 'true');
      localStorage.setItem('SUP_EXAMPLE_TASKS_CREATED', 'true');
    } catch {
      /* opaque frame */
    }
  });

const waitForProgress = async (page) => {
  await page.waitForURL(/^(file:|https?:)/, {
    waitUntil: 'domcontentloaded',
    timeout: 30_000,
  });
  await page.waitForSelector('[data-testid="pp-page"]', { timeout: 30_000 });
};

const initWindow = async (app) => {
  const page = await app.firstWindow();
  await addOnboardingSkip(page);
  await page.reload();
  await waitForProgress(page);
  return page;
};

const forceQuit = async (app) => {
  if (!app) return;
  try {
    await Promise.race([
      app.evaluate(({ app }) => app.exit(0)).catch(() => undefined),
      sleep(3000),
    ]);
  } catch {
    /* already gone */
  }
  await sleep(500);
  try {
    app.process().kill();
  } catch {
    /* already gone */
  }
};

const closeWindow = async (app) => {
  await app.evaluate(({ BrowserWindow }) => {
    setTimeout(() => BrowserWindow.getAllWindows()[0].close(), 0);
  });
};

const answerFinishDayIfVisible = async (page) => {
  const prompt = page.locator('dialog-finish-day-before-close');
  try {
    await prompt.waitFor({ state: 'visible', timeout: 2_000 });
    await prompt.locator('button[mat-stroked-button]').click();
    return true;
  } catch {
    return false;
  }
};

const waitForDraftPrompt = async (page) => {
  await page.waitForSelector('[data-testid="pp-draft-prompt"]', { timeout: 20_000 });
};

(async () => {
  const report = { userData, steps: [] };
  let app;
  let page;
  let failure;
  try {
    fs.mkdirSync(userData, { recursive: true });
    app = await launch();
    page = await initWindow(app);
    report.defaultUrl = page.url();
    report.defaultHeading = await page.locator('personal-progress-page h1').innerText();
    if (!report.defaultUrl.includes('#/personal-progress')) {
      throw new Error(
        `Fresh Electron profile did not open progress: ${report.defaultUrl}`,
      );
    }
    if (report.defaultHeading !== '项目进展') {
      throw new Error(`Fresh Electron profile is not Chinese: ${report.defaultHeading}`);
    }
    report.steps.push('fresh profile opened Chinese progress by default');

    await page.fill('[data-testid="pp-new-project-input"]', 'Electron draft');
    await page.click('[data-testid="pp-create-project"]');
    await page.waitForSelector('[data-testid="pp-project-row"]', { timeout: 20_000 });
    await page.click('[data-testid="pp-append-step"]');
    await page.fill('[data-testid="pp-insert-input"]', 'Finished step');
    await page.click('[data-testid="pp-insert-save"]');
    await page.waitForSelector('[data-testid="pp-step-title"]', { timeout: 20_000 });
    await page.click('[data-testid="pp-append-step"]');
    await page.fill('[data-testid="pp-insert-input"]', 'Draft step');
    await page.click('[data-testid="pp-insert-save"]');
    await page.waitForSelector(
      '[data-testid="pp-step-title"][data-step-title="Draft step"]',
      { timeout: 20_000 },
    );
    await page.click('[data-testid="pp-step-title"][data-step-title="Finished step"]');
    await page.waitForSelector('[data-testid="pp-status"][data-save-state="saved"]', {
      timeout: 20_000,
    });
    await page.click('[data-testid="pp-step-edit"]');
    await page.fill('[data-testid="pp-step-edit-input"]', 'Draft to save');
    report.steps.push('created a dirty step-edit draft');

    // Close #1: a pending Finish Day dialog and our draft prompt must both be
    // handled; the window must not close while the draft is undecided.
    await closeWindow(app);
    await answerFinishDayIfVisible(page);
    await waitForDraftPrompt(page);
    await page.click('[data-testid="pp-draft-continue"]');
    await page.waitForSelector('[data-testid="pp-draft-prompt"]', {
      state: 'detached',
      timeout: 10_000,
    });
    const valueAfterContinue = await page
      .locator('[data-testid="pp-step-edit-input"]')
      .inputValue();
    if (valueAfterContinue !== 'Draft to save') {
      throw new Error('Continue lost the draft input');
    }
    if (page.isClosed()) throw new Error('Continue closed the window');
    report.steps.push('continue editing cancelled the real window close');

    // Close #2: inject a real IndexedDB op-log append failure. Save must fail,
    // keep the window and the input, and a later close must prompt again.
    await page.evaluate(() => {
      const w = window;
      const proto = IDBObjectStore.prototype;
      const original = proto.add;
      w.__originalOpsAdd = original;
      w.__failNextOpsAdd = false;
      proto.add = function (...args) {
        if (this.name === 'ops' && w.__failNextOpsAdd) {
          w.__failNextOpsAdd = false;
          throw new Error('injected IndexedDB persistence failure');
        }
        return original.apply(this, args);
      };
      w.__failNextOpsAdd = true;
    });
    await closeWindow(app);
    await answerFinishDayIfVisible(page);
    await waitForDraftPrompt(page);
    await page.click('[data-testid="pp-draft-save"]');
    await page.waitForSelector('[data-testid="pp-status"][data-save-state="failed"]', {
      timeout: 20_000,
    });
    if (page.isClosed()) throw new Error('Failed save closed the window');
    const valueAfterFailure = await page
      .locator('[data-testid="pp-step-edit-input"]')
      .inputValue();
    if (valueAfterFailure !== 'Draft to save') {
      throw new Error('Failed save lost the draft input');
    }
    report.steps.push('failed save kept the window and the draft');

    // Close #3: restore the write path, choose save, and wait for the real
    // close event. The renderer only releases its before-close id after the
    // command receipt.
    await page.evaluate(() => {
      const w = window;
      if (w.__originalOpsAdd) {
        IDBObjectStore.prototype.add = w.__originalOpsAdd;
      }
    });
    const closed = app.waitForEvent('close', { timeout: 30_000 });
    await closeWindow(app);
    await answerFinishDayIfVisible(page);
    await waitForDraftPrompt(page);
    await page.click('[data-testid="pp-draft-save"]');
    await closed;
    app = undefined;
    report.steps.push('save then real close succeeded');

    app = await launch();
    page = await initWindow(app);
    await page.waitForSelector(
      '[data-testid="pp-step-title"][data-step-title="Draft to save"]',
      { timeout: 30_000 },
    );
    report.afterReopen = {
      stepTitles: await page.locator('[data-testid="pp-step-title"]').allTextContents(),
      projectTitles: await page
        .locator('[data-testid="pp-project-title"]')
        .allTextContents(),
    };
    await page.screenshot({ path: path.join(outDir, 'after-reopen.png') });
    report.steps.push('reopened and verified the saved step title');
  } catch (error) {
    failure = error;
    report.error = error instanceof Error ? error.message : String(error);
    try {
      if (page && !page.isClosed()) {
        await page.screenshot({ path: path.join(outDir, 'failure.png') });
        report.failureUrl = page.url();
      }
    } catch {
      /* best effort */
    }
  } finally {
    await forceQuit(app);
    fs.writeFileSync(path.join(outDir, 'report.json'), JSON.stringify(report, null, 2));
    console.log(JSON.stringify(report, null, 2));
    if (failure) process.exitCode = 1;
  }
})();
