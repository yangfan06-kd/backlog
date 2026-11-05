/**
 * DS-005 crash-boundary smoke: kill Electron while a local step-edit command
 * has written the op record but not yet committed the op transaction (blocked
 * before the vector-clock put). Reopen must keep the old title, never a
 * half-applied edit or a duplicate record.
 *
 * The archive+op transaction is covered by the archive tests and the
 * transaction-abort unit test; this checks the operation-write boundary.
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
const outDir = path.join(runtimeRoot, `electron-crash-boundary-${Date.now()}`);
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

const initWindow = async (app) => {
  const page = await app.firstWindow();
  await page.addInitScript(() => {
    try {
      localStorage.setItem('SUP_ONBOARDING_PRESET_DONE', 'true');
      localStorage.setItem('SUP_ONBOARDING_HINTS_DONE', 'true');
      localStorage.setItem('SUP_IS_SHOW_TOUR', 'true');
      localStorage.setItem('SUP_EXAMPLE_TASKS_CREATED', 'true');
    } catch {
      /* opaque frame */
    }
  });
  await page.reload();
  await page.waitForURL(/^(file:|https?:)/, {
    waitUntil: 'domcontentloaded',
    timeout: 30_000,
  });
  await page.waitForSelector('[data-testid="pp-page"]', { timeout: 30_000 });
  return page;
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
  const childPid = app.process().pid;
  app.process().kill();
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
  // If the renderer blocked Playwright's main-pid probe, kill only the
  // electron.exe processes whose command line points at this test userData.
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
    await page.fill('[data-testid="pp-new-project-input"]', 'Crash project');
    await page.click('[data-testid="pp-create-project"]');
    await page.waitForSelector('[data-testid="pp-project-row"]', { timeout: 20_000 });
    await page.click('[data-testid="pp-append-step"]');
    await page.fill('[data-testid="pp-insert-input"]', 'Crash step');
    await page.click('[data-testid="pp-insert-save"]');
    await page.waitForSelector('[data-testid="pp-step-title"]', { timeout: 20_000 });
    await page.click('[data-testid="pp-step-edit"]');
    await page.fill('[data-testid="pp-step-edit-input"]', 'Crash new title');

    // Hold the transaction after the op add and before the vector-clock put.
    await page.evaluate(() => {
      const proto = IDBObjectStore.prototype;
      const original = proto.put;
      proto.put = function (...args) {
        if (this.name === 'vector_clock') {
          const end = Date.now() + 5000;
          while (Date.now() < end) {
            /* keep the transaction open */
          }
        }
        return original.apply(this, args);
      };
    });
    const pendingSave = page
      .click('[data-testid="pp-step-edit-save"]')
      .catch(() => undefined);
    await sleep(600);
    await hardKill(app);
    await sleep(1500);
    await Promise.race([pendingSave, sleep(3000)]);
    app = undefined;
    report.steps.push('killed Electron inside the op-write transaction');

    app = await launch();
    page = await initWindow(app);
    await page.waitForSelector('[data-testid="pp-step-title"]', { timeout: 30_000 });
    report.afterCrash = {
      titles: await page.locator('[data-testid="pp-step-title"]').allTextContents(),
      entries: await page.locator('[data-testid="pp-entry-body"]').allTextContents(),
    };
    if (
      report.afterCrash.titles.length !== 1 ||
      !report.afterCrash.titles[0].includes('Crash step') ||
      report.afterCrash.entries.length !== 0
    ) {
      throw new Error(
        `Unexpected post-crash state: ${JSON.stringify(report.afterCrash)}`,
      );
    }
    report.steps.push('reopened with the old title and no half-applied record');
    await page.screenshot({ path: path.join(outDir, 'after-crash.png') });
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
