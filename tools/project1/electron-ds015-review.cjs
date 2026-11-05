'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { _electron: electron } = require('playwright');

const root = 'G:/project1';
const release = path.join(root, 'output/releases/DS-015/ui015-20261031-1330');
const runRoot = path.join(root, 'output/runtime/DS-015/ui015-20261031-1330');
const screenshotDir = path.join(root, 'output/handoffs/DS-015/screenshots');
const fixturePath = path.join(
  root,
  'repos/project1-desktop/e2e/fixtures/test-backup-with-archives.json',
);
const backupPath = path.join(runRoot, 'ui15-stress-backup.json');
const reviewPath = path.join(runRoot, 'desktop-review.json');
const report = {
  release,
  buildId: 'ui015-20261031-1330',
  version: '1.0.18-preview.20261031',
  screenshots: [],
  checks: [],
};
let app;
let page;

const sha256 = (file) =>
  crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');

const buildStressBackup = () => {
  const source = JSON.parse(fs.readFileSync(fixturePath, 'utf8'));
  const data = source.data;
  const baseProject = data.project.entities[data.project.ids[0]];
  const baseTask = data.task.entities[data.task.ids[0]];
  const allDates = ['2025-12-31'];
  for (let i = 0; i < 47; i++) {
    const day = new Date(Date.UTC(2026, 7, 1 + i));
    allDates.push(day.toISOString().slice(0, 10));
  }
  const history = allDates.sort();
  for (let i = 0; i < 40; i++) {
    const projectId = `ui15-project-${i}`;
    const project = JSON.parse(JSON.stringify(baseProject));
    project.id = projectId;
    project.title =
      i === 0
        ? '这是一个用于压力测试的很长很长的进行中项目名称，包含换行不再缩小的中文项目名'
        : `进行中项目 ${String(i).padStart(2, '0')}`;
    project.isArchived = false;
    project.isHiddenFromMenu = false;
    project.taskIds = [];
    project.backlogTaskIds = [];
    project.noteIds = [];
    project.personalProgress = {
      schemaVersion: 1,
      entries: [],
      kind: 'project',
    };
    data.project.entities[projectId] = project;
    data.project.ids.push(projectId);
    for (let j = 0; j < (i === 0 ? 12 : 1); j++) {
      const taskId = `ui15-task-${i}-${j}`;
      const task = JSON.parse(JSON.stringify(baseTask));
      task.id = taskId;
      task.title =
        j === 3
          ? '很长的步骤标题，用来检查多行内容是否和同一行的今天、步骤区域保持对齐，并且不会裁切。'
          : `步骤 ${String(j + 1).padStart(2, '0')}`;
      task.projectId = projectId;
      task.subTaskIds = [];
      task.isDone = false;
      task.parentId = undefined;
      task.personalProgress = {
        schemaVersion: 1,
        entries: [],
        completions: [],
      };
      data.task.entities[taskId] = task;
      data.task.ids.push(taskId);
      project.taskIds.push(taskId);
    }
  }
  data.globalConfig.localization = {
    ...(data.globalConfig.localization || {}),
    lng: 'zh',
  };
  const historyProjectId = 'ui15-project-1';
  data.project.entities[historyProjectId].personalProgress.entries = history.map(
    (recordDay, index) => {
      const stampBase = 1_790_000_000_000;
      const stampOffset = index * 1_000;
      const body =
        index === 0
          ? '一条两百字左右的记录。'.repeat(14) +
            '🙂🙂🙂 这是一段包含表情符号和很长的连续字符串abcdefghijklmnopqrstuvwxyz0123456789abcdefghijklmnopqrstuvwxyz0123456789的记录。'
          : `历史记录 ${index + 1} · ${recordDay}`;
      return {
        id: `ui15-entry-${index}`,
        projectId: historyProjectId,
        recordDay,
        body,
        bodyFormat:
          index === 1
            ? { version: 1, runs: [{ text: body, bold: true, color: 'blue' }] }
            : null,
        source: 'manual',
        createdAt: stampBase + stampOffset,
        updatedAt: stampBase + stampOffset,
        revision: 1,
        operationId: `ui15-entry-op-${index}`,
      };
    },
  );
  return { ...source, data };
};

const contrastAudit = async () =>
  page.evaluate(() => {
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    const parse = (value) => {
      const srgb = value.match(
        /^color\(srgb ([\d.]+) ([\d.]+) ([\d.]+)(?: \/ ([\d.]+))?\)$/,
      );
      if (srgb) {
        return [1, 2, 3].map((i) => Number(srgb[i]) * 255);
      }
      const rgb = value.match(/rgba?\(([^)]+)\)/);
      if (rgb) return rgb[1].split(',').slice(0, 3).map(Number);
      ctx.fillStyle = '#000';
      ctx.fillStyle = value;
      const normalized = ctx.fillStyle;
      const hex = normalized.match(/^#([0-9a-f]{6})$/i);
      if (hex) return [0, 2, 4].map((i) => parseInt(hex[1].slice(i, i + 2), 16));
      const normalizedRgb = normalized.match(/rgba?\(([^)]+)\)/);
      if (normalizedRgb) return normalizedRgb[1].split(',').slice(0, 3).map(Number);
      return null;
    };
    const alpha = (value) => {
      const srgb = value.match(/^color\(srgb [\d.]+ [\d.]+ [\d.]+ \/ ([\d.]+)\)$/);
      if (srgb) return Number(srgb[1]);
      const rgba = value.match(/rgba?\(([^)]+)\)/);
      return rgba && rgba[1].split(',').length === 4 ? Number(rgba[1].split(',')[3]) : 1;
    };
    const luminance = (rgb) => {
      const c = rgb.map((v) => {
        const x = v / 255;
        return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4;
      });
      return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
    };
    const contrast = (a, b) => {
      const x = luminance(a);
      const y = luminance(b);
      return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
    };
    const background = (el) => {
      let node = el;
      const layers = [];
      while (node) {
        const style = getComputedStyle(node);
        const rgb = parse(style.backgroundColor);
        const a = alpha(style.backgroundColor);
        if (rgb && a > 0) layers.push({ rgb, a });
        if (a >= 1) break;
        node = node.parentElement;
      }
      let result = [255, 255, 255];
      for (let i = layers.length - 1; i >= 0; i--) {
        const layer = layers[i];
        result = result.map((v, index) => layer.rgb[index] * layer.a + v * (1 - layer.a));
      }
      return result;
    };
    const selectors = [
      '.pp-project-title',
      '.pp-step-title',
      '.pp-entry-body',
      '.pp-today-label',
      '.pp-complete',
      '.pp-toolbar .pp-primary',
      '.pp-project-meta',
      'thead th',
    ];
    return selectors.map((selector) => {
      const el = document.querySelector(selector);
      if (!el) return { selector, missing: true };
      const color = parse(getComputedStyle(el).color);
      const colorAlpha = alpha(getComputedStyle(el).color);
      const bg = background(el);
      const effective = color
        ? color.map((v, index) => v * colorAlpha + bg[index] * (1 - colorAlpha))
        : null;
      return {
        selector,
        color: getComputedStyle(el).color,
        colorAlpha,
        background: bg.map((v) => Math.round(v)),
        ratio: effective ? Number(contrast(effective, bg).toFixed(2)) : null,
      };
    });
  });

const launch = async () => {
  const env = { ...process.env, NODE_ENV: 'PROD' };
  for (const key of Object.keys(env)) if (key.startsWith('PROJECT1_')) delete env[key];
  const temp = path.join(runRoot, 'tmp');
  fs.mkdirSync(temp, { recursive: true });
  env.TEMP = temp;
  env.TMP = temp;
  env.TMPDIR = temp;
  delete env.ELECTRON_RUN_AS_NODE;
  app = await electron.launch({
    executablePath: path.join(release, 'win-unpacked/Project1Preview.exe'),
    cwd: path.dirname(path.join(release, 'win-unpacked/Project1Preview.exe')),
    env,
    args: ['--disable-tray', '--no-sandbox', '--force-device-scale-factor=1'],
  });
  page = await app.firstWindow();
  page.setDefaultTimeout(30_000);
  await page.context().setOffline(true);
  await page.getByTestId('pp-page').waitFor({ timeout: 30_000 });
};

const setContentSize = async (width, height) => {
  await app.evaluate(
    ({ BrowserWindow }, size) => {
      const win = BrowserWindow.getAllWindows()[0];
      if (win.isMaximized()) win.unmaximize();
      win.setContentSize(size.width, size.height);
    },
    { width, height },
  );
  await page.waitForTimeout(250);
};

const measure = async (label) => {
  const values = await page.evaluate(() => {
    const host = document.querySelector('magic-side-nav');
    const nav = document.querySelector('.nav-sidenav');
    const board = document.querySelector('[data-testid="pp-board-scroll"]');
    const h1 = document.querySelector('.personal-progress h1');
    const project = document.querySelector('thead .pp-project-col');
    const today = document.querySelector('thead .pp-today-col');
    const steps = document.querySelector('thead .pp-steps-col');
    const firstRow = document.querySelector('[data-testid="pp-project-row"]');
    const rProject = firstRow?.querySelector('th.pp-project-col');
    const rToday = firstRow?.querySelector('td.pp-today-col');
    const rSteps = firstRow?.querySelector('td.pp-steps-col');
    const rect = (el) => el?.getBoundingClientRect();
    return {
      innerWidth: window.innerWidth,
      documentWidth: document.documentElement.scrollWidth,
      navHostWidth: rect(host)?.width ?? null,
      navWidth: rect(nav)?.width ?? null,
      headingFont: h1 ? getComputedStyle(h1).fontFamily : null,
      headingSize: h1 ? getComputedStyle(h1).fontSize : null,
      pageText: document.querySelector('.personal-progress h1')?.textContent?.trim(),
      boardScrollWidth: board?.scrollWidth ?? null,
      boardClientWidth: board?.clientWidth ?? null,
      boardScrollLeft: board?.scrollLeft ?? null,
      header: {
        project: rect(project),
        today: rect(today),
        steps: rect(steps),
      },
      firstRow: {
        project: rect(rProject),
        today: rect(rToday),
        steps: rect(rSteps),
      },
      rows: document.querySelectorAll('[data-testid="pp-project-row"]').length,
      dates: document.querySelectorAll('[data-testid="pp-date"]').length,
    };
  });
  report.checks.push({ label, values });
  return values;
};

const waitSaved = async () => {
  await page.waitForFunction(
    () =>
      document
        .querySelector('[data-testid="pp-status"]')
        ?.getAttribute('data-save-state') === 'saved',
    null,
    { timeout: 30_000 },
  );
};

const createProject = async (title) => {
  const before = await page.getByTestId('pp-project-row').count();
  await page.getByTestId('pp-new-project-input').fill(title);
  await page.getByTestId('pp-create-project').click();
  await page.waitForFunction(
    (count) =>
      document.querySelectorAll('[data-testid="pp-project-row"]').length === count + 1,
    before,
    { timeout: 30_000 },
  );
  await waitSaved();
};

const selectProject = async (title) => {
  const row = page.getByTestId('pp-project-row').filter({ hasText: title });
  await row.getByTestId('pp-project-title').click();
  await page.waitForTimeout(50);
};

const appendStep = async (title, stepTitle) => {
  const row = page.getByTestId('pp-project-row').filter({ hasText: title });
  await row.getByTestId('pp-append-step').click();
  await page.getByTestId('pp-insert-input').fill(stepTitle);
  await page.getByTestId('pp-insert-save').click();
  await waitSaved();
};

const addEntry = async (title, day, body, format = false) => {
  const row = page.getByTestId('pp-project-row').filter({ hasText: title });
  await row.getByTestId('pp-project-title').click();
  await page.getByTestId('pp-entry-day').fill(day);
  const editor = page
    .getByTestId('pp-entry-input')
    .locator('xpath=ancestor::personal-rich-text-editor[1]');
  await editor.locator('.cm-content').click();
  await page.keyboard.insertText(body);
  if (format) {
    await page.keyboard.press('Control+A');
    await editor.getByTestId('pt-bold').click();
    await editor.getByTestId('pt-color-toggle').click();
    await editor.getByTestId('pt-color-blue').click();
  }
  await page.getByTestId('pp-add-entry').click();
  await waitSaved();
};

(async () => {
  fs.mkdirSync(screenshotDir, { recursive: true });
  const runtimePolicy = JSON.parse(
    fs.readFileSync(
      path.join(release, 'win-unpacked/resources/project1-runtime.json'),
      'utf8',
    ),
  );
  if (process.env.DS015_FRESH === '1') {
    fs.rmSync(runtimePolicy.profileRoot, { recursive: true, force: true });
  }
  fs.writeFileSync(backupPath, JSON.stringify(buildStressBackup(), null, 2));
  try {
    await launch();
    report.identity = await app.evaluate(({ app }) => ({
      isPackaged: app.isPackaged,
      version: app.getVersion(),
      userData: app.getPath('userData'),
      preview: true,
    }));
    report.checks.push({
      label: 'identity',
      values: {
        isPackaged: report.identity.isPackaged,
        version: report.identity.version,
        userData: report.identity.userData,
        backupSha256: sha256(backupPath),
        exeSha256: sha256(path.join(release, 'win-unpacked/Project1Preview.exe')),
        asarSha256: sha256(path.join(release, 'win-unpacked/resources/app.asar')),
      },
    });

    await measure('initial-empty');
    page.once('dialog', (dialog) => dialog.accept());

    const existingRows = await page.getByTestId('pp-project-row').count();
    if (existingRows < 40) {
      const longProjectTitle =
        '这是一个用于压力测试的很长很长的进行中项目名称，包含换行不再缩小的中文项目名';
      await createProject(longProjectTitle);
      await selectProject(longProjectTitle);
      for (let i = 0; i < 12; i++) {
        await appendStep(
          longProjectTitle,
          i === 3
            ? '很长的步骤标题，用来检查多行内容是否和同一行的今天、步骤区域保持对齐，并且不会裁切。'
            : `步骤 ${String(i + 1).padStart(2, '0')}`,
        );
      }
      for (let i = 1; i < 40; i++) {
        const title = `进行中项目 ${String(i).padStart(2, '0')}`;
        await createProject(title);
        await selectProject(title);
        await appendStep(title, '步骤 01');
      }

      const historyProject = '进行中项目 01';
      const dates = ['2025-12-31'];
      for (let i = 0; i < 47; i++) {
        dates.push(new Date(Date.UTC(2026, 7, 1 + i)).toISOString().slice(0, 10));
      }
      dates.sort();
      for (let i = 0; i < dates.length; i++) {
        const body =
          i === 0
            ? '一条两百字左右的记录。'.repeat(14) +
              '🙂🙂🙂 这是一段包含表情符号和很长的连续字符串abcdefghijklmnopqrstuvwxyz0123456789abcdefghijklmnopqrstuvwxyz0123456789的记录。'
            : `历史记录 ${i + 1} · ${dates[i]}`;
        await addEntry(historyProject, dates[i], body, i === 1);
      }
    }
    await page.waitForTimeout(300);
    report.checks.push({
      label: 'stressData',
      rows: await page.getByTestId('pp-project-row').count(),
      dates: await page.getByTestId('pp-date').count(),
    });

    for (const width of [1280, 1440, 1600]) {
      await setContentSize(width, 1000);
      const values = await measure(`layout-${width}`);
      if (width === 1280) {
        report.navWidth = values.navWidth;
        report.navHostWidth = values.navHostWidth;
        report.headingFont = values.headingFont;
        report.headingSize = values.headingSize;
      }
      if (Math.abs(values.navWidth - 200) > 1) {
        throw new Error(`nav width ${values.navWidth} at ${width}`);
      }
      if (!values.headingFont.includes('Microsoft YaHei UI')) {
        throw new Error(`font not hit at ${width}`);
      }
      if (values.documentWidth - values.innerWidth > 1) {
        throw new Error(`window horizontal overflow at ${width}`);
      }
      const shot = path.join(screenshotDir, `desktop-${width}.png`);
      await page.screenshot({ path: shot, animations: 'disabled', timeout: 60_000 });
      report.screenshots.push(shot);
    }

    await setContentSize(1440, 1000);
    report.contrastLight = await contrastAudit();
    const board = page.getByTestId('pp-board-scroll');
    await board.evaluate((el) => {
      el.scrollLeft = 0;
    });
    const before = await measure('horizontal-before');
    const startShot = path.join(screenshotDir, 'desktop-horizontal-start.png');
    await page.screenshot({ path: startShot, animations: 'disabled', timeout: 60_000 });
    report.screenshots.push(startShot);
    await board.evaluate((el) => {
      el.scrollLeft = el.scrollWidth;
    });
    await page.waitForTimeout(150);
    const after = await measure('horizontal-after');
    report.horizontalHeaderAudit = await page.evaluate(() => {
      const el = document.querySelector('thead th.pp-project-col');
      const rect = el.getBoundingClientRect();
      const style = getComputedStyle(el);
      const top = document.elementFromPoint(rect.x + 20, rect.y + 20);
      return {
        rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
        position: style.position,
        left: style.left,
        zIndex: style.zIndex,
        text: el.textContent,
        topTag: top?.tagName,
        topClass: top?.className,
        topText: top?.textContent?.slice(0, 30),
      };
    });
    const delta = (a, b) => Math.abs(a - b);
    for (const key of ['project', 'today', 'steps']) {
      if (delta(before.firstRow[key].x, after.firstRow[key].x) > 2) {
        throw new Error(`row ${key} moved horizontally`);
      }
    }
    const endShot = path.join(screenshotDir, 'desktop-horizontal-end.png');
    await page.screenshot({ path: endShot, animations: 'disabled', timeout: 60_000 });
    report.screenshots.push(endShot);

    await board.evaluate((el) => {
      el.scrollLeft = 0;
      el.scrollTop = 0;
    });
    await page.evaluate(() => {
      document.body.classList.remove('isLightTheme');
      document.body.classList.add('isDarkTheme');
    });
    await page.waitForTimeout(150);
    report.contrastDark = await contrastAudit();
    report.darkAudit = await page.evaluate(() => {
      const bodyStyle = getComputedStyle(document.body);
      const nav = document.querySelector('.nav-sidenav');
      return {
        bodyClass: document.body.className,
        bodyBg: bodyStyle.backgroundColor,
        bgVar: bodyStyle.getPropertyValue('--bg'),
        cardVar: bodyStyle.getPropertyValue('--card-bg'),
        sideVar: bodyStyle.getPropertyValue('--sidenav-bg'),
        navBg: nav ? getComputedStyle(nav).backgroundColor : null,
        navColor: nav ? getComputedStyle(nav).color : null,
        todayLabelColor: getComputedStyle(document.querySelector('.pp-today-label'))
          .color,
        todayDayColor: getComputedStyle(document.querySelector('.pp-today-day')).color,
        headerColor: getComputedStyle(document.querySelector('thead th')).color,
        chain: (() => {
          const result = [];
          let node = nav;
          while (node) {
            const style = getComputedStyle(node);
            result.push({
              tag: node.tagName,
              cls: node.className,
              bg: style.backgroundColor,
              color: style.color,
            });
            node = node.parentElement;
          }
          return result;
        })(),
      };
    });
    const darkShot = path.join(screenshotDir, 'desktop-dark-1440.png');
    await page.screenshot({ path: darkShot, animations: 'disabled', timeout: 60_000 });
    report.screenshots.push(darkShot);
    await page.evaluate(() => {
      document.body.classList.remove('isDarkTheme');
      document.body.classList.add('isLightTheme');
    });

    await page.getByTestId('pp-complete-step').first().focus();
    const focusShot = path.join(screenshotDir, 'desktop-focus-1440.png');
    await page.screenshot({ path: focusShot, animations: 'disabled', timeout: 60_000 });
    report.screenshots.push(focusShot);

    await setContentSize(1024, 900);
    const compact = await measure('layout-1024');
    if (compact.documentWidth - compact.innerWidth > 1) {
      throw new Error('window horizontal overflow at 1024');
    }
    const compactShot = path.join(screenshotDir, 'desktop-1024.png');
    await page.screenshot({ path: compactShot, animations: 'disabled', timeout: 60_000 });
    report.screenshots.push(compactShot);

    await page.getByTestId('pp-collapse-all').click();
    await page.waitForTimeout(100);
    const collapsed = await page.evaluate(() => ({
      dates: document.querySelectorAll('[data-testid="pp-date"]').length,
      rows: document.querySelectorAll('[data-testid="pp-project-row"]').length,
    }));
    report.checks.push({ label: 'collapsedAll', values: collapsed });
    if (collapsed.dates !== 1) throw new Error('collapse-all did not leave today');
    report.ok = true;
  } catch (error) {
    report.error = error.stack || String(error);
    if (page) {
      try {
        report.failureState = await page.evaluate(() => ({
          status: document
            .querySelector('[data-testid="pp-status"]')
            ?.getAttribute('data-save-state'),
          text: document.querySelector('[data-testid="pp-status"]')?.textContent,
          body: document.body.innerText.slice(0, 2000),
          rows: document.querySelectorAll('[data-testid="pp-project-row"]').length,
        }));
        await page.screenshot({
          path: path.join(screenshotDir, 'desktop-error.png'),
        });
      } catch {}
    }
    process.exitCode = 1;
  } finally {
    if (app) await app.evaluate(({ app }) => app.exit(0)).catch(() => {});
    fs.writeFileSync(reviewPath, JSON.stringify(report, null, 2));
    console.log(JSON.stringify(report, null, 2));
  }
})();
