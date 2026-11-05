const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { _electron: electron } = require('playwright');
const { expect } = require('@playwright/test');

const root = 'G:/project1';
const release = process.argv[2];
if (!release) throw new Error('installer release directory required');
const caseDir = path.join(root, 'output/runtime/DS-011', `direct-${Date.now()}`);
const expectedVersion = JSON.parse(
  fs.readFileSync(path.join(release, 'build-manifest.json'), 'utf8'),
).version;
const programDir = path.join(caseDir, 'program');
const profileDir = path.join(caseDir, 'profile');
const resourcesDir = path.join(caseDir, 'program/resources');
const policyFile = path.join(resourcesDir, 'project1-runtime.json');
for (const dir of [caseDir, programDir, profileDir, path.join(caseDir, 'tmp')]) {
  fs.mkdirSync(dir, { recursive: true });
}
// Copy the real candidate program, then replace only the resource policy so the
// automation never touches the default trial profile. The program/candidate
// bytes remain from the actual build; this difference is recorded in review.json.
fs.cpSync(path.join(release, 'win-unpacked'), programDir, { recursive: true });
const candidatePolicy = fs.readFileSync(
  path.join(programDir, 'resources/project1-runtime.json'),
  'utf8',
);
fs.writeFileSync(
  policyFile,
  JSON.stringify({
    formatVersion: 1,
    storageRoot: root,
    profileRoot: profileDir,
  }),
);
const env = { ...process.env, NODE_ENV: 'PROD' };
for (const key of Object.keys(env)) {
  if (key.startsWith('PROJECT1_')) delete env[key];
}
env.TEMP = path.join(caseDir, 'tmp');
env.TMP = path.join(caseDir, 'tmp');
delete env.ELECTRON_RUN_AS_NODE;
const exe = path.join(programDir, 'Project1Preview.exe');
const report = {
  release,
  caseDir,
  policyDifference: {
    candidatePolicy,
    testPolicy: fs.readFileSync(policyFile, 'utf8'),
  },
  steps: [],
};
let app;

const closeNormal = async (target) => {
  const closed = target.waitForEvent('close', { timeout: 20_000 });
  await target.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].close());
  await closed;
};

const launch = async () =>
  electron.launch({
    executablePath: exe,
    cwd: programDir,
    env,
    args: ['--disable-tray', '--no-sandbox'],
  });

(async () => {
  try {
    app = await launch();
    const page = await app.firstWindow();
    page.setDefaultTimeout(25_000);
    await page.getByTestId('pp-page').waitFor({ timeout: 30_000 });
    report.identity = await app.evaluate(({ app }) => ({
      isPackaged: app.isPackaged,
      version: app.getVersion(),
      name: app.getName(),
      execPath: process.execPath,
      appPath: app.getAppPath(),
      userData: app.getPath('userData'),
      sessionData: app.getPath('sessionData'),
      logs: app.getPath('logs'),
      crashDumps: app.getPath('crashDumps'),
      temp: app.getPath('temp'),
      tempEnv: process.env.TEMP,
      tmpEnv: process.env.TMP,
      policy: process.env.PROJECT1_PREVIEW_EXPORTS_DIR,
    }));
    expect(report.identity.isPackaged).toBe(true);
    expect(report.identity.version).toBe(expectedVersion);
    expect(report.identity.execPath).toBe(exe);
    expect(report.identity.userData).toBe(path.join(profileDir, 'user-data'));
    expect(report.identity.logs).toBe(path.join(profileDir, 'logs'));
    expect(report.identity.crashDumps).toBe(path.join(profileDir, 'crashes'));
    expect(report.identity.temp).toBe(path.join(profileDir, 'tmp'));
    expect(report.identity.tempEnv).toBe(path.join(profileDir, 'tmp'));
    report.steps.push(
      'installed-candidate copy started directly with no PROJECT1 environment',
    );

    await page.locator('.nav-link').filter({ hasText: '数据备份' }).first().click();
    await page.getByTestId('pb-page').waitFor();
    await expect(page.getByTestId('pb-page')).toBeVisible();
    await expect(page.getByTestId('pb-auto-section')).toBeVisible();
    await page.locator('.nav-link').filter({ hasText: '关于' }).first().click();
    await page.getByTestId('pabout-page').waitFor();
    await expect(page.getByTestId('pabout-version')).toContainText(expectedVersion);
    await expect(page.getByTestId('pabout-page')).not.toContainText('=>');
    expect(
      (await page.getByTestId('pabout-page').textContent()).split(expectedVersion)
        .length - 1,
    ).toBe(1);
    report.aboutVersion = await page.getByTestId('pabout-version').textContent();
    await expect(page.getByTestId('pabout-data-path')).toContainText(
      path.join(profileDir, 'user-data'),
    );
    report.aboutDataPath = await page.getByTestId('pabout-data-path').textContent();
    await page.locator('.nav-link').filter({ hasText: '数据备份' }).first().click();
    await page.getByTestId('pb-page').waitFor();
    await page.screenshot({ path: path.join(caseDir, 'direct-backup-1280.png') });
    report.steps.push(
      'direct launch opened the four-module preview, about data path and backup page',
    );

    const second = spawn(exe, ['--disable-tray', '--no-sandbox'], {
      cwd: programDir,
      env,
      stdio: 'ignore',
    });
    await expect.poll(() => second.exitCode, { timeout: 10000 }).not.toBeNull();
    const windows = await app.evaluate(
      ({ BrowserWindow }) => BrowserWindow.getAllWindows().length,
    );
    report.secondLaunch = {
      windowsAfterSecond: windows,
      secondExited: second.exitCode !== null,
    };
    expect(windows).toBe(1);
    expect(second.exitCode).toBe(0);
    report.steps.push(
      'same-profile second launch focused/exited without a second window',
    );

    await closeNormal(app);
    app = undefined;
    expect(fs.existsSync(path.join(profileDir, 'user-data'))).toBe(true);
    report.steps.push('normal close left the policy profile intact');

    // An old DS-010 package has no policy and must still fail before any default
    // AppData store is created.
    const oldExe = path.join(
      root,
      'output/releases/DS-010/20261027-225147/win-unpacked/Project1Preview.exe',
    );
    const oldEnv = { ...process.env, NODE_ENV: 'PROD' };
    for (const key of Object.keys(oldEnv))
      if (key.startsWith('PROJECT1_')) delete oldEnv[key];
    delete oldEnv.ELECTRON_RUN_AS_NODE;
    const appDataBefore = fs
      .readdirSync(process.env.APPDATA)
      .filter((name) => /project1|preview/i.test(name))
      .sort();
    const old = spawn(oldExe, ['--disable-tray', '--no-sandbox'], {
      cwd: path.dirname(oldExe),
      env: oldEnv,
      stdio: 'ignore',
    });
    const oldExit = await new Promise((resolve) => old.once('exit', resolve));
    const appDataAfter = fs
      .readdirSync(process.env.APPDATA)
      .filter((name) => /project1|preview/i.test(name))
      .sort();
    report.oldPackage = { exitCode: oldExit, appDataBefore, appDataAfter };
    expect(oldExit).not.toBe(0);
    expect(appDataAfter).toEqual(appDataBefore);
    report.steps.push(
      'old no-policy package still fails safely without default AppData stores',
    );

    // Missing policy and an invalid policy must fail before creating a profile.
    const missingPolicyBackup = fs.readFileSync(policyFile);
    fs.unlinkSync(policyFile);
    const missing = spawn(exe, ['--disable-tray', '--no-sandbox'], {
      cwd: programDir,
      env,
      stdio: 'ignore',
    });
    const missingExit = await new Promise((resolve) => missing.once('exit', resolve));
    report.missingPolicy = { exitCode: missingExit };
    expect(missingExit).not.toBe(0);
    fs.writeFileSync(
      policyFile,
      JSON.stringify({ formatVersion: 2, storageRoot: root, profileRoot: profileDir }),
    );
    const invalid = spawn(exe, ['--disable-tray', '--no-sandbox'], {
      cwd: programDir,
      env,
      stdio: 'ignore',
    });
    const invalidExit = await new Promise((resolve) => invalid.once('exit', resolve));
    report.invalidPolicy = { exitCode: invalidExit };
    expect(invalidExit).not.toBe(0);
    fs.writeFileSync(policyFile, missingPolicyBackup);
    report.steps.push('missing and unknown-version policies failed directly');
  } catch (error) {
    report.error = error.message;
    process.exitCode = 1;
  } finally {
    if (app) await app.evaluate(({ app }) => app.exit(0)).catch(() => {});
    fs.writeFileSync(path.join(caseDir, 'review.json'), JSON.stringify(report, null, 2));
    console.log(JSON.stringify(report, null, 2));
  }
})();
