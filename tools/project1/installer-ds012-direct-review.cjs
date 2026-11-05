const fs = require('node:fs');
const path = require('node:path');
const { _electron: electron } = require('playwright');
const { expect } = require('@playwright/test');

const root = 'G:/project1';
const releaseA = process.argv[2];
const releaseB = process.argv[3];
if (!releaseA || !releaseB)
  throw new Error('usage: installer-ds012-direct-review.cjs <A> <B>');
const caseRoot = path.join(root, 'output/runtime/DS-012/case-20261029-a');
const profile = path.join(caseRoot, 'profile');
const temp = path.join(root, '.tmp/DS-012/direct');
const reviewId = Date.now();
const report = { releaseA, releaseB, caseRoot, profile, steps: [] };
for (const dir of [caseRoot, profile, temp]) fs.mkdirSync(dir, { recursive: true });
const env = { ...process.env, NODE_ENV: 'PROD' };
for (const key of Object.keys(env)) if (key.startsWith('PROJECT1_')) delete env[key];
env.TEMP = temp;
env.TMP = temp;
env.TMPDIR = temp;
delete env.ELECTRON_RUN_AS_NODE;

let app;
const launch = async (release) => {
  const program = path.join(release, 'win-unpacked');
  app = await electron.launch({
    executablePath: path.join(program, 'Project1Preview.exe'),
    cwd: program,
    env,
    args: ['--disable-tray', '--no-sandbox'],
  });
  await app.context().setOffline(true);
  const page = await app.firstWindow();
  page.setDefaultTimeout(25_000);
  await page.getByTestId('pp-page').waitFor({ timeout: 30_000 });
  return page;
};
const closeNormal = async () => {
  const closed = app.waitForEvent('close', { timeout: 20_000 });
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].close());
  await closed;
  app = undefined;
};

(async () => {
  try {
    for (const [label, release] of [
      ['A', releaseA],
      ['B', releaseB],
    ]) {
      const page = await launch(release);
      const identity = await app.evaluate(({ app }) => ({
        isPackaged: app.isPackaged,
        version: app.getVersion(),
        execPath: process.execPath,
        userData: app.getPath('userData'),
        sessionData: app.getPath('sessionData'),
        logs: app.getPath('logs'),
        crashes: app.getPath('crashDumps'),
        temp: app.getPath('temp'),
        tempEnv: process.env.TEMP,
        tmpEnv: process.env.TMP,
      }));
      report[label] = identity;
      expect(identity.isPackaged).toBe(true);
      expect(identity.version).toBe(
        label === 'A' ? '1.0.4-preview.20261029' : '1.0.5-preview.20261029',
      );
      expect(identity.execPath).toBe(
        path.join(release, 'win-unpacked/Project1Preview.exe'),
      );
      expect(identity.userData).toBe(path.join(profile, 'user-data'));
      expect(identity.sessionData).toBe(path.join(profile, 'user-data/session'));
      expect(identity.logs).toBe(path.join(profile, 'logs'));
      expect(identity.crashes).toBe(path.join(profile, 'crashes'));
      expect(identity.temp).toBe(path.join(profile, 'tmp'));
      expect(identity.tempEnv).toBe(path.join(profile, 'tmp'));
      expect(await page.evaluate(() => navigator.onLine)).toBe(false);
      await page.locator('.nav-link').filter({ hasText: '关于' }).first().click();
      await page.getByTestId('pabout-page').waitFor();
      await expect(page.getByTestId('pabout-data-path')).toContainText(
        path.join(profile, 'user-data'),
      );
      await expect(page.getByTestId('pabout-version')).toContainText(identity.version);
      await page.screenshot({
        path: path.join(caseRoot, `about-${label}-${reviewId}.png`),
      });
      report.steps.push(
        `${label}: payload test policy launched directly with no PROJECT1 env; paths are isolated`,
      );
      await closeNormal();
    }
    report.defaultProfileExists = fs.existsSync(
      path.join(root, 'output/runtime/project1-preview'),
    );
    report.defaultProfileInspected = false;
    report.actualInstallRun = false;
  } catch (error) {
    report.error = error.message;
    process.exitCode = 1;
  } finally {
    if (app) await app.evaluate(({ app }) => app.exit(0)).catch(() => {});
    fs.writeFileSync(
      path.join(caseRoot, `direct-review-${reviewId}.json`),
      JSON.stringify(report, null, 2),
    );
    console.log(JSON.stringify(report, null, 2));
  }
})();
