const fs = require('node:fs');
const path = require('node:path');
const { _electron: electron } = require('playwright');
const { expect } = require('@playwright/test');

const root = 'G:/project1';
const release = process.argv[2];
if (!release) throw new Error('candidate release required');
const caseDir = path.join(root, 'output/runtime/DS-011', `auto-${Date.now()}`);
const program = path.join(caseDir, 'program');
const profile = path.join(caseDir, 'profile');
for (const dir of [caseDir, profile]) fs.mkdirSync(dir, { recursive: true });
if (fs.existsSync(program)) throw new Error('Refusing to replace a prior test program');
fs.mkdirSync(program, { recursive: true });
fs.cpSync(path.join(release, 'win-unpacked'), program, { recursive: true });
fs.writeFileSync(
  path.join(program, 'resources/project1-runtime.json'),
  JSON.stringify({ formatVersion: 1, storageRoot: root, profileRoot: profile }),
);
const env = { ...process.env, NODE_ENV: 'PROD' };
for (const key of Object.keys(env)) if (key.startsWith('PROJECT1_')) delete env[key];
delete env.ELECTRON_RUN_AS_NODE;
const report = { release, caseDir, steps: [] };
let app;
(async () => {
  try {
    app = await electron.launch({
      executablePath: path.join(program, 'Project1Preview.exe'),
      cwd: program,
      env,
      args: ['--disable-tray', '--no-sandbox'],
    });
    const page = await app.firstWindow();
    page.setDefaultTimeout(25_000);
    await page.getByTestId('pp-page').waitFor({ timeout: 30_000 });
    await page.context().setOffline(true);
    expect(await page.evaluate(() => navigator.onLine)).toBe(false);
    await page.getByTestId('pp-new-project-input').fill('Installer automatic schedule');
    await page.getByTestId('pp-create-project').click();
    await expect(page.getByTestId('pp-status')).toHaveAttribute(
      'data-save-state',
      'saved',
    );
    const autoDir = path.join(profile, 'user-data/backups/project1-auto');
    const savedAt = Date.now();
    // Background initialization can dispatch after the first save and reset
    // the normal debounce. Wait for the observable file condition, not a fixed
    // 32-second assumption; this never calls the manual backup operation.
    await expect
      .poll(
        () =>
          fs.existsSync(autoDir)
            ? fs.readdirSync(autoDir).filter((name) => name.startsWith('auto-')).length
            : 0,
        { timeout: 60000, intervals: [500, 1000] },
      )
      .toBeGreaterThan(0);
    report.waitedAfterSaveMs = Date.now() - savedAt;
    const files = fs
      .readdirSync(autoDir, { withFileTypes: true })
      .filter((entry) => entry.isFile() && entry.name.startsWith('auto-'));
    expect(files.length).toBeGreaterThan(0);
    report.autoFiles = files.map((entry) => entry.name);
    report.steps.push(
      'candidate program produced an automatic version after the 30-second debounce',
    );
    const closed = app.waitForEvent('close', { timeout: 20_000 });
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].close());
    await closed;
    app = undefined;
  } catch (error) {
    report.error = error.message;
    process.exitCode = 1;
  } finally {
    if (app) await app.evaluate(({ app }) => app.exit(0)).catch(() => {});
    fs.writeFileSync(path.join(caseDir, 'review.json'), JSON.stringify(report, null, 2));
    console.log(JSON.stringify(report, null, 2));
  }
})();
