/**
 * Minimal Electron close/reopen smoke check for the personal-progress slice.
 * Run with the repository's compiled main process and a project-local userData.
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
const outDir = path.join(runtimeRoot, `electron-smoke-${Date.now()}`);
const userData = path.join(outDir, 'user-data');
fs.mkdirSync(outDir, { recursive: true });

const env = {
  ...process.env,
  NODE_ENV: 'PROD',
  ELECTRON_ENABLE_LOGGING: '1',
  PROJECT1_USER_DATA_DIR: userData,
};
// The host environment sets this globally; it makes electron.exe run as plain
// Node, where require('electron') is the package path rather than the API.
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

const goProgress = async (page) => {
  await page.waitForURL(/^(file:|https?:)/, {
    waitUntil: 'domcontentloaded',
    timeout: 30000,
  });
  const base = page.url().split('#')[0];
  await page.goto(`${base}#/personal-progress`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('[data-testid="pp-page"]', { timeout: 30_000 });
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

const normalClose = async (app, page) => {
  const closed = app.waitForEvent('close', { timeout: 30000 });
  await app.evaluate(({ BrowserWindow }) => {
    // Return before the close handshake; the renderer must stay automatable to
    // answer its real Finish Day dialog.
    setTimeout(() => BrowserWindow.getAllWindows()[0].close(), 0);
  });
  const prompt = page.locator('dialog-finish-day-before-close');
  const next = await Promise.race([
    prompt.waitFor({ state: 'visible', timeout: 20000 }).then(() => 'prompt'),
    page.waitForEvent('close', { timeout: 20000 }).then(() => 'closed'),
  ]);
  if (next === 'prompt') {
    await prompt.locator('button[mat-stroked-button]').click();
  }
  await closed;
};

(async () => {
  const report = { userData, steps: [] };
  let app;
  let page;
  let failure;
  try {
    fs.mkdirSync(userData, { recursive: true });

    app = await launch();
    report.paths = await app.evaluate(({ app }) =>
      Object.fromEntries(
        ['userData', 'sessionData', 'logs', 'crashDumps'].map((key) => [
          key,
          app.getPath(key),
        ]),
      ),
    );
    for (const value of Object.values(report.paths)) {
      if (!path.resolve(value).startsWith(projectRoot + path.sep))
        throw new Error('Electron path escapes project');
    }
    await app.context().setOffline(true);
    report.offline = true;
    page = await app.firstWindow();
    await addOnboardingSkip(page);
    await page.reload();
    await goProgress(page);
    report.steps.push('opened personal-progress');

    await page.fill('[data-testid="pp-new-project-input"]', 'Electron project');
    await page.click('[data-testid="pp-create-project"]');
    await page.waitForSelector('[data-testid="pp-project-row"]', { timeout: 20_000 });
    await page.click('[data-testid="pp-append-step"]');
    await page.fill('[data-testid="pp-insert-input"]', 'Persist me');
    await page.click('[data-testid="pp-insert-save"]');
    await page.waitForSelector('[data-testid="pp-step-title"]', { timeout: 20_000 });
    await page.click('[data-testid="pp-step-title"]');
    await page.waitForSelector('[data-testid="pp-status"][data-save-state="saved"]', {
      timeout: 20_000,
    });
    await page.waitForSelector('[data-testid="pp-entry-body"]', { timeout: 20_000 });
    report.steps.push('completed a step and saw the saved receipt');
    await page.screenshot({ path: path.join(outDir, 'after-save.png') });

    // Exercise process exit separately from the normal window-close handshake.
    await forceQuit(app);
    app = undefined;
    report.steps.push('exited Electron after the save receipt');

    app = await launch();
    await app.context().setOffline(true);
    page = await app.firstWindow();
    await addOnboardingSkip(page);
    await page.reload();
    await goProgress(page);
    await page.waitForSelector('[data-testid="pp-project-row"]', { timeout: 30_000 });
    report.afterReopen = {
      projects: await page.locator('[data-testid="pp-project-row"]').count(),
      entries: await page.locator('[data-testid="pp-entry-body"]').count(),
      remainingSteps: await page.locator('[data-testid="pp-step-title"]').count(),
      projectTitles: await page
        .locator('[data-testid="pp-project-title"]')
        .allTextContents(),
      entryTexts: await page.locator('[data-testid="pp-entry-body"]').allTextContents(),
    };
    await page.screenshot({ path: path.join(outDir, 'after-reopen.png') });
    report.steps.push('reopened Electron and read persisted records');
    if (
      report.afterReopen.projects < 1 ||
      report.afterReopen.entries < 1 ||
      report.afterReopen.remainingSteps !== 0
    ) {
      failure = new Error(
        `Unexpected reopened state: ${JSON.stringify(report.afterReopen)}`,
      );
    }
    await normalClose(app, page);
    app = undefined;
    report.steps.push(
      'closed the actual window, answering Quit if the Finish Day dialog appeared',
    );
    app = await launch();
    await app.context().setOffline(true);
    page = await app.firstWindow();
    await goProgress(page);
    await page.waitForSelector('[data-testid="pp-entry-body"]', { timeout: 30000 });
    report.afterNormalClose = {
      entryTexts: await page.locator('[data-testid="pp-entry-body"]').allTextContents(),
      remainingSteps: await page.locator('[data-testid="pp-step-title"]').count(),
    };
    if (
      !report.afterNormalClose.entryTexts.includes('Persist me') ||
      report.afterNormalClose.remainingSteps !== 0
    ) {
      throw new Error('Data was not retained after normal close');
    }
    await page.screenshot({ path: path.join(outDir, 'after-normal-close.png') });
    report.steps.push('reopened offline after normal close and verified the record');
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
    report.userDataEntries = fs.existsSync(userData) ? fs.readdirSync(userData) : [];
    report.indexedDbExists = fs.existsSync(path.join(userData, 'session', 'IndexedDB'));
    report.logsExists = report.paths && fs.existsSync(report.paths.logs);
    fs.writeFileSync(path.join(outDir, 'smoke.json'), JSON.stringify(report, null, 2));
    console.log(JSON.stringify(report, null, 2));
    if (failure) process.exitCode = 1;
  }
})();
