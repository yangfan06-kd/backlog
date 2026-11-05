/**
 * DS-006 Electron overview smoke:
 * - classify a project and wait for the real local receipt;
 * - request a normal window close while a classification write is blocked on
 *   the real op-log lock; the window must stay open until the write settles;
 * - reopen and verify the persisted category and single project row.
 */
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { _electron: electron } = require('playwright');

const repo = path.resolve(__dirname, '..', '..');
const projectRoot = path.resolve(process.env.PROJECT1_STORAGE_ROOT || '');
if (projectRoot !== path.resolve('G:/project1'))
  throw new Error('Use the project environment first');
const runtimeRoot = path.dirname(process.env.PROJECT1_USER_DATA_DIR);
if (!runtimeRoot.startsWith(projectRoot + path.sep))
  throw new Error('Runtime path escapes project');
const outDir = path.join(runtimeRoot, `electron-overview-${Date.now()}`);
const userData = path.join(outDir, 'user-data');
fs.mkdirSync(outDir, { recursive: true });

const env = { ...process.env, NODE_ENV: 'PROD', PROJECT1_USER_DATA_DIR: userData };
delete env.ELECTRON_RUN_AS_NODE;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const launch = () =>
  electron.launch({
    args: ['.', `--user-data-dir=${userData}`, '--no-sandbox', '--disable-tray'],
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

const initWindow = async (app) => {
  const page = await app.firstWindow();
  await addOnboardingSkip(page);
  await page.reload();
  await page.waitForURL(/^(file:|https?:)/, {
    waitUntil: 'domcontentloaded',
    timeout: 30_000,
  });
  return page;
};

const goOverview = async (page) => {
  const base = page.url().split('#')[0];
  await page.goto(`${base}#/personal-overview`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('[data-testid="po-page"]', { timeout: 30_000 });
};

const hardKill = async (app) => {
  if (!app) return;
  let mainPid;
  try {
    mainPid = await Promise.race([
      app.evaluate(({ process }) => process.pid),
      sleep(2000).then(() => undefined),
    ]);
  } catch {
    mainPid = undefined;
  }
  let childPid;
  try {
    childPid = app.process().pid;
    app.process().kill();
  } catch {
    childPid = undefined;
  }
  for (const pid of [mainPid, childPid]) {
    if (!pid) continue;
    try {
      execFileSync('taskkill', ['/PID', String(pid), '/T', '/F'], {
        stdio: 'ignore',
      });
    } catch {
      /* already gone */
    }
  }
  try {
    const quoted = userData.replace(/'/g, "''");
    execFileSync(
      'powershell.exe',
      [
        '-NoProfile',
        '-Command',
        `Get-CimInstance Win32_Process -Filter "Name='electron.exe'" | Where-Object { $_.CommandLine -like '*${quoted}*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }`,
      ],
      { stdio: 'ignore' },
    );
  } catch {
    /* best effort */
  }
  await sleep(1000);
};

(async () => {
  const report = { userData, steps: [] };
  let app;
  let page;
  let failure;
  try {
    app = await launch();
    page = await initWindow(app);
    await page.waitForSelector('[data-testid="pp-page"]', { timeout: 30_000 });
    await page.fill('[data-testid="pp-new-project-input"]', 'Electron classification');
    await page.click('[data-testid="pp-create-project"]');
    await page.waitForSelector('[data-testid="pp-project-row"]', { timeout: 20_000 });
    await page.click('[data-testid="pp-append-step"]');
    await page.fill('[data-testid="pp-insert-input"]', 'Survive close');
    await page.click('[data-testid="pp-insert-save"]');
    await page.waitForSelector('[data-testid="pp-status"][data-save-state="saved"]', {
      timeout: 20_000,
    });
    await goOverview(page);
    await page.waitForSelector('[data-testid="po-project-row"]', { timeout: 20_000 });

    await page.click('[data-testid="po-classify"]');
    await page.click('[data-testid="po-quadrant-option-urgent-important"]');
    await page.waitForSelector('[data-testid="po-status"][data-save-state="saved"]', {
      timeout: 20_000,
    });
    report.steps.push('classified a project and waited for the saved receipt');

    await page.click('[data-testid="po-classify"]');
    await page.waitForSelector('[data-testid="po-quadrant-option-important"]', {
      timeout: 5_000,
    });
    const blockRenderer = page.evaluate(() => {
      const option = document.querySelector(
        '[data-testid="po-quadrant-option-important"]',
      );
      option.click();
      const end = Date.now() + 3000;
      while (Date.now() < end) {
        /* the click synchronously entered saving state before this block */
      }
    });
    await sleep(200);
    await app.evaluate(({ BrowserWindow }) => {
      setTimeout(() => BrowserWindow.getAllWindows()[0].close(), 0);
    });
    await sleep(800);
    let windowsWhileSaving;
    try {
      windowsWhileSaving = await app.evaluate(
        ({ BrowserWindow }) => BrowserWindow.getAllWindows().length,
      );
    } catch {
      windowsWhileSaving = 0;
    }
    await blockRenderer;
    if (windowsWhileSaving < 1) {
      throw new Error('Window closed while the classification was saving');
    }
    report.steps.push('normal close waited while the real write was blocked');

    const closeEvent = app.waitForEvent('close', { timeout: 30_000 });
    await closeEvent;
    app = undefined;
    report.steps.push('window closed after the classification receipt');

    app = await launch();
    page = await initWindow(app);
    await goOverview(page);
    await page.waitForSelector('[data-testid="po-project-row"]', { timeout: 30_000 });
    report.afterReopen = {
      quadrantImportant: await page
        .locator('[data-testid="po-quadrant"][data-quadrant="important"]')
        .innerText(),
      rows: await page.locator('[data-testid="po-project-row"]').count(),
    };
    if (
      !report.afterReopen.quadrantImportant.includes('Electron classification') ||
      report.afterReopen.rows !== 1
    ) {
      throw new Error(
        `Unexpected reopened overview: ${JSON.stringify(report.afterReopen)}`,
      );
    }
    report.steps.push('reopened with the saved category and one row');
    await page.screenshot({ path: path.join(outDir, 'after-reopen.png') });
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
    await hardKill(app);
    fs.writeFileSync(path.join(outDir, 'report.json'), JSON.stringify(report, null, 2));
    console.log(JSON.stringify(report, null, 2));
    if (failure) process.exitCode = 1;
  }
})();
