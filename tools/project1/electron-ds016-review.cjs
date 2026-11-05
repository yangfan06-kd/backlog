'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { _electron: electron } = require('playwright');
const { expect } = require('@playwright/test');

const root = 'G:/project1';
const release = path.join(root, 'output/releases/DS-016/ui016-20261031-1930');
const runRoot = path.join(root, 'output/runtime/DS-016/ui016-20261031-1930');
const screenshotDir = path.join(root, 'output/handoffs/DS-016/screenshots');
const backupFile = path.join(runRoot, 'full-backup.json');
const reviewPath = path.join(runRoot, 'desktop-review.json');
const report = {
  release,
  version: '1.0.24-preview.20261031',
  buildId: 'ui016-20261031-1930',
  checks: [],
  screenshots: [],
};
let app;
let page;

const sha256 = (file) =>
  crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');

const setContentSize = async (width, height) => {
  await app.evaluate(
    ({ BrowserWindow }, size) => {
      const win = BrowserWindow.getAllWindows()[0];
      if (win.isMaximized()) win.unmaximize();
      win.setContentSize(size.width, size.height);
    },
    { width, height },
  );
  await page.waitForTimeout(180);
};

const launch = async (packageDir) => {
  const env = { ...process.env, NODE_ENV: 'PROD' };
  for (const key of Object.keys(env)) if (key.startsWith('PROJECT1_')) delete env[key];
  const temp = path.join(runRoot, 'tmp');
  fs.mkdirSync(temp, { recursive: true });
  env.TEMP = temp;
  env.TMP = temp;
  env.TMPDIR = temp;
  delete env.ELECTRON_RUN_AS_NODE;
  app = await electron.launch({
    executablePath: path.join(packageDir, 'win-unpacked/Project1Preview.exe'),
    cwd: path.dirname(path.join(packageDir, 'win-unpacked/Project1Preview.exe')),
    env,
    args: ['--disable-tray', '--no-sandbox', '--force-device-scale-factor=1'],
  });
  page = await app.firstWindow();
  page.setDefaultTimeout(30_000);
  await page.context().setOffline(true);
  await page.getByTestId('pp-page').waitFor({ timeout: 30_000 });
};

const closeNormal = async () => {
  const closed = app.waitForEvent('close', { timeout: 20_000 });
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].close());
  await closed;
  app = undefined;
};

const dismissIdle = async () => {
  if (!page) return;
  const noRecord = page.getByRole('button', { name: '不记录' });
  if (await noRecord.count()) {
    if (
      await noRecord
        .first()
        .isVisible()
        .catch(() => false)
    ) {
      await noRecord
        .first()
        .click()
        .catch(() => undefined);
      await page.waitForTimeout(150);
    }
  }
};
const goto = async (hash, testId) => {
  await page.evaluate((value) => {
    location.hash = value;
  }, hash);
  await page.getByTestId(testId).waitFor({ timeout: 30_000 });
  await dismissIdle();
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(100);
};

const waitSaved = async (testId = 'pp-status') => {
  await expect(page.getByTestId(testId)).toHaveAttribute('data-save-state', 'saved', {
    timeout: 30_000,
  });
};

const createProgressProject = async (title, stepTitles) => {
  await page.getByTestId('pp-new-project-input').fill(title);
  await page.getByTestId('pp-create-project').click();
  const row = page.getByTestId('pp-project-row').filter({ hasText: title });
  await row.waitFor({ state: 'visible' });
  await row.getByTestId('pp-project-title').click();
  for (const stepTitle of stepTitles) {
    await row.getByTestId('pp-append-step').click();
    await page.getByTestId('pp-insert-input').fill(stepTitle);
    await page.getByTestId('pp-insert-save').click();
    await waitSaved();
  }
};

const createRoutineItem = async (title) => {
  await page.getByTestId('pr-new-item-title').fill(title);
  await page.getByTestId('pr-create-item').click();
  await page
    .getByTestId('pr-item-row')
    .filter({ hasText: title })
    .waitFor({ state: 'visible' });
  await waitSaved('pr-status');
};

const selectRoutineItem = async (title) => {
  await page
    .getByTestId('pr-item-row')
    .filter({ hasText: title })
    .getByTestId('pr-item-name')
    .click();
};

const saveRoutineRecord = async (title, day, body) => {
  await selectRoutineItem(title);
  await page.getByTestId('pr-entry-day').fill(day);
  await page.getByTestId('pr-entry-body').fill(body);
  await page.getByTestId('pr-save-entry').click();
  await waitSaved('pr-status');
};

const take = async (name) => {
  await dismissIdle();
  const target = path.join(screenshotDir, name);
  await page.waitForTimeout(1200);
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: target, animations: 'disabled', timeout: 60_000 });
  report.screenshots.push(target);
};

const measurePage = async (label) => {
  const values = await page.evaluate(() => {
    const pageRoot = document.querySelector(
      'personal-overview-page, personal-routine-page, personal-archive-page, personal-backup-page',
    );
    const h1 = pageRoot?.querySelector('h1');
    const nav = document.querySelector('.nav-sidenav');
    return {
      page: pageRoot?.tagName ?? null,
      headingFont: h1 ? getComputedStyle(h1).fontFamily : null,
      headingSize: h1 ? getComputedStyle(h1).fontSize : null,
      navWidth: nav ? getComputedStyle(nav).width : null,
      innerWidth: window.innerWidth,
      documentWidth: document.documentElement.scrollWidth,
      bodyFont: getComputedStyle(document.body).fontFamily,
    };
  });
  report.checks.push({ label, values });
  return values;
};

(async () => {
  fs.mkdirSync(screenshotDir, { recursive: true });
  try {
    await launch(release);
    report.identity = await app.evaluate(({ app }) => ({
      isPackaged: app.isPackaged,
      version: app.getVersion(),
      userData: app.getPath('userData'),
    }));
    const files = [];
    const walk = (dir) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(full);
        else files.push(full);
      }
    };
    walk(path.join(release, 'win-unpacked'));
    report.checks.push({
      label: 'identity',
      values: {
        ...report.identity,
        exeSha256: sha256(path.join(release, 'win-unpacked/Project1Preview.exe')),
        asarSha256: sha256(path.join(release, 'win-unpacked/resources/app.asar')),
        policySha256: sha256(
          path.join(release, 'win-unpacked/resources/project1-runtime.json'),
        ),
        packageFileCount: files.length,
      },
    });

    await setContentSize(1440, 1000);
    await goto('#/personal-progress', 'pp-page');
    await createProgressProject(
      '这是一个很长的总览项目名称，用来检查标题换行后操作是否仍然清楚',
      Array.from(
        { length: 20 },
        (_, i) =>
          `很长的步骤名称 ${String(i + 1).padStart(2, '0')}：用于检查一行内部横向浏览`,
      ),
    );
    await createProgressProject('总览项目 A', ['A 一步', 'A 二步', 'A 三步']);
    await createProgressProject('总览项目 B', ['B 一步', 'B 二步']);
    await createProgressProject('归档项目', ['归档一步', '归档二步']);

    await page
      .getByTestId('pp-project-row')
      .filter({ hasText: '归档项目' })
      .getByTestId('pp-project-title')
      .click();
    await page.getByTestId('pp-entry-input').fill('归档前的历史记录');
    await page.getByTestId('pp-add-entry').click();
    await waitSaved();
    await page
      .getByTestId('pp-project-row')
      .filter({ hasText: '归档项目' })
      .getByTestId('pp-project-title')
      .click();
    page.once('dialog', (dialog) => dialog.accept());
    await page.getByTestId('pp-finish-project').click();
    await page.getByTestId('pp-view-archive').waitFor({ state: 'visible' });
    await waitSaved();

    await goto('#/personal-routine', 'pr-page');
    await page.getByTestId('pr-range-three-months').click();
    for (let i = 0; i < 20; i++) {
      await createRoutineItem(`常态事项 ${String(i + 1).padStart(2, '0')}`);
    }
    const titles = Array.from(
      { length: 20 },
      (_, i) => `常态事项 ${String(i + 1).padStart(2, '0')}`,
    );
    const dates = Array.from({ length: 40 }, (_, i) =>
      new Date(Date.UTC(2026, 7, 1 + i)).toISOString().slice(0, 10),
    );
    const today = await page.evaluate(() => new Date().toLocaleDateString('en-CA'));
    for (let i = 0; i < dates.length; i++) {
      const body =
        i === 0
          ? '一条较长的常态记录。'.repeat(12) +
            '🙂 包含表情和连续字符串abcdefghijklmnopqrstuvwxyz0123456789abcdefghijklmnopqrstuvwxyz0123456789。'
          : `常态记录 ${i + 1} · ${dates[i]}`;
      await saveRoutineRecord(titles[i % titles.length], dates[i], body);
    }
    await saveRoutineRecord(titles[0], dates[39], '今日第二条记录');
    await saveRoutineRecord(titles[0], today, '今天的常态记录');
    await saveRoutineRecord(titles[0], today, '今天的第二条记录');
    await expect(page.getByTestId('pr-item-row')).toHaveCount(20);
    await expect(page.getByTestId('pr-date-' + dates[0])).toBeVisible();
    await expect(page.getByTestId('pr-date-' + dates[39])).toHaveCount(1);
    await expect(page.getByTestId('pr-date-' + today)).toHaveCount(1);
    await expect(page.getByTestId('pr-open-item')).toHaveCount(0);
    report.checks.push({ label: 'routineData', rows: 20, historyDates: 40 });

    await goto('#/personal-overview', 'po-page');
    const overviewRow = page
      .getByTestId('po-project-row')
      .filter({ hasText: '总览项目 A' });
    await dismissIdle();
    await overviewRow.getByTestId('po-classify').click();
    await page.getByTestId('po-quadrant-option-urgent').click();
    await waitSaved('po-status');
    await page.keyboard.press('Escape');
    await page
      .locator('.cdk-overlay-backdrop')
      .waitFor({ state: 'detached', timeout: 5_000 })
      .catch(() => undefined);
    const longOverviewRow = page
      .getByTestId('po-project-row')
      .filter({ hasText: '这是一个很长的总览项目名称' });
    await longOverviewRow.getByTestId('po-project-name').click();
    await expect(longOverviewRow.getByTestId('po-step-title')).toHaveCount(20);

    await goto('#/personal-archive', 'pa-page');
    await expect(
      page.getByTestId('pa-card').filter({ hasText: '归档项目' }),
    ).toBeVisible();
    await page
      .getByTestId('pa-card')
      .filter({ hasText: '归档项目' })
      .getByTestId('pa-expand')
      .click();
    await expect(
      page.getByTestId('pa-card').filter({ hasText: '归档项目' }).getByTestId('pa-entry'),
    ).toBeVisible();

    await goto('#/personal-backup', 'pb-page');
    await expect(page.getByTestId('pb-status')).toHaveCount(1);
    await expect(page.getByTestId('pb-restore-trigger')).toBeVisible();
    await page.getByTestId('pb-auto-now').click();
    await expect(page.getByTestId('pb-auto-status')).toHaveAttribute(
      'data-auto-state',
      'success',
    );

    const bad = path.join(runRoot, 'bad-restore.json');
    fs.writeFileSync(bad, '{"bad":', 'utf8');
    const routineTrigger = page.getByTestId('pr-restore-trigger');
    await goto('#/personal-routine', 'pr-page');
    await routineTrigger.focus();
    const routineChooserPromise = page.waitForEvent('filechooser');
    await page.keyboard.press('Space');
    const routineChooser = await routineChooserPromise;
    page.once('dialog', (dialog) => dialog.dismiss());
    await routineChooser.setFiles(bad);
    await expect(page.getByTestId('pr-status')).not.toHaveAttribute(
      'data-save-state',
      'failed',
    );

    await goto('#/personal-backup', 'pb-page');
    const backupTrigger = page.getByTestId('pb-restore-trigger');
    await backupTrigger.focus();
    const backupChooserPromise = page.waitForEvent('filechooser');
    await page.keyboard.press('Enter');
    const backupChooser = await backupChooserPromise;
    page.once('dialog', (dialog) => dialog.dismiss());
    await backupChooser.setFiles(bad);
    await expect(page.getByTestId('pb-status')).toHaveAttribute(
      'data-save-state',
      'idle',
    );

    const pages = [
      ['#/personal-overview', 'po-page'],
      ['#/personal-routine', 'pr-page'],
      ['#/personal-archive', 'pa-page'],
      ['#/personal-backup', 'pb-page'],
    ];
    for (const [hash, testId] of pages) {
      for (const width of [1280, 1440, 1600, 1024]) {
        await setContentSize(width, 1000);
        await goto(hash, testId);
        if (hash.includes('routine')) {
          await dismissIdle();
          await page.getByTestId('pr-range-three-months').click();
        }
        await measurePage(`${hash}-${width}`);
        await take(`${hash.slice(2)}-${width}.png`);
      }
    }

    for (const [hash, testId] of pages) {
      await setContentSize(1440, 1000);
      await goto(hash, testId);
      if (hash.includes('routine')) {
        await page.getByTestId('pr-range-three-months').click();
      }
      await page.evaluate(() => {
        document.body.classList.remove('isLightTheme');
        document.body.classList.add('isDarkTheme');
      });
      await page.waitForTimeout(200);
      await take(`${hash.slice(2)}-dark-1440.png`);
      await page.evaluate(() => {
        document.body.classList.remove('isDarkTheme');
        document.body.classList.add('isLightTheme');
      });
    }

    await goto('#/personal-routine', 'pr-page');
    await page.getByTestId('pr-range-three-months').click();
    await setContentSize(1440, 1000);
    const board = page.getByTestId('pr-table-scroll');
    const first = page.getByTestId('pr-item-row').first();
    const itemCell = first.locator('th.pr-item-cell');
    const todayCell = first.locator('td.pr-today-cell');
    const itemX = (await itemCell.boundingBox()).x;
    const todayX = (await todayCell.boundingBox()).x;
    await board.evaluate((el) => {
      el.scrollLeft = el.scrollWidth;
      el.scrollTop = 240;
    });
    await page.waitForTimeout(120);
    report.checks.push({
      label: 'routineGeometry',
      values: {
        itemStable: Math.abs((await itemCell.boundingBox()).x - itemX) <= 2,
        todayStable: Math.abs((await todayCell.boundingBox()).x - todayX) <= 2,
        boardTop: (await board.boundingBox()).y,
        headerTop: (await page.locator('thead .pr-item-column').boundingBox()).y,
      },
    });
    await take('routine-horizontal-end.png');
    await page.getByTestId('pr-restore-trigger').focus();
    await take('routine-focus.png');

    await goto('#/personal-overview', 'po-page');
    const overviewFont = await page
      .getByTestId('po-project-name')
      .first()
      .evaluate((el) => getComputedStyle(el).fontFamily);
    const overviewLongRow = page
      .getByTestId('po-project-row')
      .filter({ hasText: '这是一个很长的总览项目名称' });
    await overviewLongRow.getByTestId('po-project-name').click();
    await expect(overviewLongRow.getByTestId('po-step-title')).toHaveCount(20);
    const overviewSteps = page.getByTestId('po-steps-scroll').first();
    report.checks.push({
      label: 'overview',
      values: {
        font: overviewFont,
        stepsScrolls:
          (await overviewSteps.evaluate((el) => el.scrollWidth)) >
          (await overviewSteps.evaluate((el) => el.clientWidth)),
      },
    });
    await take('personal-overview-expanded-1440.png');
    await overviewSteps.evaluate((el) => {
      el.scrollLeft = el.scrollWidth;
    });
    await page.waitForTimeout(100);
    await take('personal-overview-expanded-end-1440.png');

    await goto('#/personal-routine', 'pr-page');
    const fontSamples = await page.evaluate(() => {
      const selectors = [
        '.pr-item-name',
        '.pr-date-label',
        '.pr-range-button',
        '.pr-entry',
      ];
      return selectors.map((selector) => {
        const el = document.querySelector(selector);
        return { selector, font: el ? getComputedStyle(el).fontFamily : null };
      });
    });
    report.checks.push({ label: 'fonts', values: fontSamples });

    await goto('#/personal-archive', 'pa-page');
    await page.getByTestId('pa-card').first().getByTestId('pa-expand').click();
    await take('personal-archive-expanded-1440.png');

    await goto('#/personal-backup', 'pb-page');
    const exportTarget = path.join(runRoot, 'full-backup.json');
    await app.evaluate(({ dialog }, filePath) => {
      dialog.showSaveDialog = async () => ({ canceled: false, filePath });
    }, exportTarget);
    await page.getByTestId('pb-export').click();
    await expect(page.getByTestId('pb-status')).toHaveAttribute(
      'data-save-state',
      'saved',
    );
    expect(fs.existsSync(exportTarget)).toBe(true);
    report.checks.push({
      label: 'export',
      bytes: fs.statSync(exportTarget).size,
      sha256: sha256(exportTarget),
    });

    await closeNormal();
    await launch(release);
    await page.getByTestId('pp-page').waitFor();
    await goto('#/personal-progress', 'pp-page');
    await expect(page.getByTestId('pp-project-row')).toHaveCount(3);
    await goto('#/personal-routine', 'pr-page');
    await expect(page.getByTestId('pr-item-row')).toHaveCount(20);
    await goto('#/personal-archive', 'pa-page');
    await expect(page.getByTestId('pa-card')).toHaveCount(1);
    report.checks.push({
      label: 'offlineReopen',
      projects: 3,
      routineItems: 20,
      archiveCards: 1,
    });

    const restoreBase = path.join(runRoot, 'restore-package');
    fs.rmSync(restoreBase, { recursive: true, force: true });
    fs.mkdirSync(restoreBase, { recursive: true });
    fs.cpSync(
      path.join(release, 'win-unpacked'),
      path.join(restoreBase, 'win-unpacked'),
      {
        recursive: true,
      },
    );
    const restoreProfile = path.join(runRoot, 'profile-restore');
    fs.mkdirSync(restoreProfile, { recursive: true });
    fs.writeFileSync(
      path.join(restoreBase, 'win-unpacked/resources/project1-runtime.json'),
      JSON.stringify({
        formatVersion: 1,
        storageRoot: root,
        profileRoot: restoreProfile,
      }),
      { encoding: 'utf8' },
    );
    await closeNormal();
    await launch(restoreBase);
    await goto('#/personal-backup', 'pb-page');
    page.once('dialog', (dialog) => dialog.accept());
    await page.getByTestId('pb-restore-input').setInputFiles(exportTarget);
    await expect(page.getByTestId('pb-status')).toHaveAttribute(
      'data-save-state',
      'restored',
      { timeout: 30_000 },
    );
    await expect(page.getByTestId('pb-status')).toHaveCount(1);
    await goto('#/personal-routine', 'pr-page');
    await expect(page.getByTestId('pr-item-row')).toHaveCount(20);
    await goto('#/personal-progress', 'pp-page');
    await expect(page.getByTestId('pp-project-row')).toHaveCount(3);
    report.checks.push({ label: 'independentRestore', routineItems: 20, projects: 3 });

    report.checks.push({
      label: 'backupCompletion',
      notes: 'full export and independent profile restore completed',
    });
    report.ok = true;
  } catch (error) {
    report.error = error.stack || String(error);
    if (page) {
      try {
        await page.screenshot({
          path: path.join(screenshotDir, 'desktop-error.png'),
          timeout: 10_000,
        });
      } catch {}
    }
    process.exitCode = 1;
  } finally {
    if (app) {
      try {
        await app.close();
      } catch {
        try {
          app.process().kill('SIGKILL');
        } catch {}
      }
    }
    fs.writeFileSync(reviewPath, JSON.stringify(report, null, 2));
    console.log(JSON.stringify(report, null, 2));
  }
})();
