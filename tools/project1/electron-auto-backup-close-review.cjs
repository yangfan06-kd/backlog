const fs = require('node:fs');
const path = require('node:path');
const { _electron: electron } = require('playwright');
const { expect } = require('@playwright/test');

const root = 'G:/project1';
const release = process.argv[2];
const scenario = process.argv[3] || 'draft';
if (!release) throw new Error('Package directory required');
const caseDir = path.join(
  root,
  'output/runtime/CX-010',
  `close-${scenario}-${Date.now()}`,
);
for (const dir of ['user-data', 'logs', 'crashes', 'tmp'])
  fs.mkdirSync(path.join(caseDir, dir), { recursive: true });
const userData = path.join(caseDir, 'user-data');
const autoDir = path.join(userData, 'backups/project1-auto');
const env = {
  ...process.env,
  NODE_ENV: 'PROD',
  PROJECT1_PREVIEW_MODE: '1',
  PROJECT1_STORAGE_ROOT: root,
  PROJECT1_USER_DATA_DIR: userData,
  PROJECT1_LOG_DIR: path.join(caseDir, 'logs'),
  PROJECT1_CRASH_DIR: path.join(caseDir, 'crashes'),
  TEMP: path.join(caseDir, 'tmp'),
  TMP: path.join(caseDir, 'tmp'),
  TMPDIR: path.join(caseDir, 'tmp'),
};
delete env.ELECTRON_RUN_AS_NODE;
const report = { release, scenario, caseDir, steps: [] };
let app;
let page;
const launch = async () => {
  app = await electron.launch({
    executablePath: path.join(release, 'win-unpacked/Project1Preview.exe'),
    cwd: path.join(release, 'win-unpacked'),
    env,
    args: ['--disable-tray', '--no-sandbox'],
  });
  page = await app.firstWindow();
  page.setDefaultTimeout(20000);
  await page.getByTestId('pp-page').waitFor();
  await page.context().setOffline(true);
  expect(await page.evaluate(() => navigator.onLine)).toBe(false);
};
const close = () =>
  app.evaluate(({ BrowserWindow }) => {
    setTimeout(() => BrowserWindow.getAllWindows()[0].close(), 0);
  });
const checkStored = (needle) => {
  const files = fs.existsSync(autoDir)
    ? fs.readdirSync(autoDir).filter((name) => name.startsWith('auto-'))
    : [];
  expect(
    files.some((name) =>
      fs.readFileSync(path.join(autoDir, name), 'utf8').includes(needle),
    ),
  ).toBe(true);
  report.files = files;
};

(async () => {
  try {
    await launch();
    report.identity = await app.evaluate(({ app }) => ({
      execPath: process.execPath,
      isPackaged: app.isPackaged,
    }));
    expect(report.identity.isPackaged).toBe(true);
    await page.getByTestId('pp-new-project-input').fill(`Close review ${scenario}`);
    await page.getByTestId('pp-create-project').click();
    await expect(page.getByTestId('pp-status')).toHaveAttribute(
      'data-save-state',
      'saved',
    );
    if (scenario === 'draft') {
      await page.getByTestId('pp-entry-input').fill('Entry saved by close guard');
      await close();
      await page.getByTestId('pp-draft-prompt').waitFor();
      const closed = app.waitForEvent('close', { timeout: 20000 });
      await page.getByTestId('pp-draft-save').click();
      await closed;
      app = undefined;
      checkStored('Entry saved by close guard');
      report.steps.push(
        'normal close saved the draft and included that final saved record in the automatic version',
      );
    } else {
      fs.mkdirSync(path.dirname(autoDir), { recursive: true });
      fs.writeFileSync(autoDir, 'block the real automatic backup directory');
      await close();
      await page.getByTestId('pb-close-return').waitFor();
      // Capture the settled dialog, not the translucent opening animation.
      await page.waitForTimeout(250);
      await page.screenshot({ path: path.join(caseDir, 'failure-options.png') });
      await page.getByTestId('pb-close-return').click();
      expect(
        await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length),
      ).toBe(1);
      report.steps.push('real filesystem failure offered return to the live application');
      await close();
      await page.getByTestId('pb-close-retry').waitFor();
      if (scenario === 'retry') {
        await page.getByTestId('pb-close-retry').click();
        await page.getByTestId('pb-close-retry').waitFor();
        fs.unlinkSync(autoDir);
        const closed = app.waitForEvent('close', { timeout: 20000 });
        await page.getByTestId('pb-close-retry').click();
        await closed;
        app = undefined;
        checkStored(`Close review ${scenario}`);
        report.steps.push(
          'retry failure kept the dialog; retry after removing the block wrote a real version before exit',
        );
      } else {
        const closed = app.waitForEvent('close', { timeout: 20000 });
        await page.getByTestId('pb-close-exit').click();
        await closed;
        app = undefined;
        expect(fs.readFileSync(autoDir, 'utf8')).toContain('block');
        fs.unlinkSync(autoDir);
        report.steps.push(
          'explicit exit after primary persistence succeeded did not claim a new automatic version',
        );
      }
    }
    await launch();
    await expect(
      page.getByTestId('pp-project-row').filter({ hasText: `Close review ${scenario}` }),
    ).toBeVisible();
    if (scenario === 'draft')
      await expect(
        page
          .getByTestId('pp-entry-body')
          .filter({ hasText: 'Entry saved by close guard' }),
      ).toBeVisible();
    report.steps.push('same profile reopened offline with its saved project');
    const closed = app.waitForEvent('close', { timeout: 20000 });
    await close();
    await closed;
    app = undefined;
    report.passed = true;
  } catch (error) {
    report.error = error.message;
    process.exitCode = 1;
    if (page && !page.isClosed())
      await page.screenshot({ path: path.join(caseDir, 'failure.png') }).catch(() => {});
  } finally {
    if (app) await app.evaluate(({ app }) => app.exit(0)).catch(() => {});
    fs.writeFileSync(path.join(caseDir, 'review.json'), JSON.stringify(report, null, 2));
    console.log(JSON.stringify(report, null, 2));
  }
})();
