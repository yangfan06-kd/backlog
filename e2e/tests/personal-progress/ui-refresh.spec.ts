import { restorePersonalBackup } from '../../utils/personal-backup-helpers';
import { expect, test } from '../../fixtures/test.fixture';
import type { Locator, Page } from '@playwright/test';
import * as fs from 'node:fs';
import * as path from 'node:path';

const fixturePath =
  'G:/project1/repos/project1-desktop/e2e/fixtures/test-backup-with-archives.json';
const screenshotDir = path.join(
  'G:/project1/output/handoffs',
  process.env.PROJECT1_REVIEW_TASK || 'DS-015',
  'ui-refresh',
);
const status = (page: Page): Locator => page.getByTestId('pp-status');

test('restore is keyboard accessible and backfill focuses the existing date control', async ({
  page,
}) => {
  await page.goto('/#/personal-progress');
  await expect(page.getByTestId('pp-page')).toBeVisible({ timeout: 30000 });
  if (!(await page.getByTestId('pp-new-project-input').isVisible())) {
    await page.getByTestId('pp-show-create').click();
  }
  await page.getByTestId('pp-new-project-input').fill('Keyboard controls');
  await page.getByTestId('pp-create-project').click();
  await expect(status(page)).toHaveAttribute('data-save-state', 'saved');
  await expect(page.getByTestId('pp-backfill')).toBeEnabled();
  await page.getByTestId('pp-backfill').click();
  await expect(page.getByTestId('pp-entry-day')).toBeFocused();
  await page.evaluate(() => {
    location.hash = '/personal-backup';
  });
  await expect(page.getByTestId('pb-page')).toBeVisible();
  await page.getByTestId('pb-export').focus();
  await page.keyboard.press('Tab');
  await expect(page.getByTestId('pb-restore-trigger')).toBeFocused();
  const chooser = page.waitForEvent('filechooser');
  await page.keyboard.press('Enter');
  expect((await chooser).isMultiple()).toBe(false);
});

test('preview width does not overwrite the saved navigation preference', async ({
  page,
}) => {
  await page.addInitScript(() => {
    localStorage.setItem('SUP_NAV_SIDEBAR_WIDTH', '350');
    Object.defineProperty(window, 'ea', {
      configurable: true,
      value: { isPreviewMode: () => true },
    });
  });
  await page.goto('/#/personal-progress');
  // The shared fixture already loaded '/'. A hash-only navigation does not run
  // addInitScript or recreate the root mode token; reload the document explicitly.
  await page.reload();
  await expect(page.getByTestId('pp-page')).toBeVisible({ timeout: 30000 });
  await expect
    .poll(() =>
      page.locator('magic-side-nav').evaluate((el) => el.getBoundingClientRect().width),
    )
    .toBe(200);
  expect(await page.evaluate(() => localStorage.getItem('SUP_NAV_SIDEBAR_WIDTH'))).toBe(
    '350',
  );
  await page.evaluate(() => document.body.classList.add('isDarkTheme'));
  const label = page.locator('magic-side-nav .nav-label').first();
  await expect(label).toBeVisible();
  const labelContrast = (): Promise<number> =>
    label.evaluate((el) => {
      const canvas = document.createElement('canvas');
      canvas.width = canvas.height = 1;
      const ctx = canvas.getContext('2d')!;
      const rgb = (css: string): number[] => {
        ctx.clearRect(0, 0, 1, 1);
        ctx.fillStyle = css;
        ctx.fillRect(0, 0, 1, 1);
        return Array.from(ctx.getImageData(0, 0, 1, 1).data);
      };
      const bg = rgb(getComputedStyle(el.closest('.nav-sidenav')!).backgroundColor);
      const fg = rgb(getComputedStyle(el).color);
      const alpha = fg[3] / 255;
      const painted = bg.slice(0, 3).map((v, i) => {
        const foreground = fg[i] * alpha;
        const background = v * (1 - alpha);
        return foreground + background;
      });
      const luminance = (c: number[]): number =>
        c
          .slice(0, 3)
          .map((v) => {
            v /= 255;
            return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
          })
          .reduce((s, v, i) => {
            const weighted = v * [0.2126, 0.7152, 0.0722][i];
            return s + weighted;
          }, 0);
      const a = luminance(painted),
        b = luminance(bg);
      return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
    });
  // Color transitions take 225ms; assert the settled result without disabling
  // the real interaction or confusing an intermediate frame with a theme bug.
  await expect.poll(labelContrast).toBeGreaterThanOrEqual(4.5);
  await label.hover();
  await expect.poll(labelContrast).toBeGreaterThanOrEqual(4.5);
});

const buildStressBackup = (): Record<string, unknown> => {
  const source = JSON.parse(fs.readFileSync(fixturePath, 'utf8'));
  const data = source.data as Record<string, any>;
  const baseProject = data.project.entities[data.project.ids[0]];
  const baseTask = data.task.entities[data.task.ids[0]];
  const allDates: string[] = ['2025-12-31'];
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

    const stepCount = i === 0 ? 12 : 1;
    for (let j = 0; j < stepCount; j++) {
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
    ...(data.globalConfig.localization ?? {}),
    lng: 'zh',
  };

  const historyProjectId = 'ui15-project-1';
  const entries = history.map((recordDay, index) => {
    const stampBase = 1_790_000_000_000;
    const stampOffset = index * 1_000;
    const stamp = stampBase + stampOffset;
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
      createdAt: stamp,
      updatedAt: stamp,
      revision: 1,
      operationId: `ui15-entry-op-${index}`,
    };
  });
  data.project.entities[historyProjectId].personalProgress.entries = entries;
  return { ...source, data };
};

const restoreStress = async (page: Page, backupPath: string): Promise<void> => {
  page.once('dialog', (dialog) => dialog.accept());
  await restorePersonalBackup(page, backupPath);
  await expect(page.getByTestId('pp-project-row')).toHaveCount(40, {
    timeout: 30_000,
  });
};

const boxX = async (locator: Locator): Promise<number> => {
  const box = await locator.boundingBox();
  expect(
    box,
    `missing box for ${await locator.evaluate((el) => el.outerHTML)}`,
  ).not.toBeNull();
  return box!.x;
};

const boxY = async (locator: Locator): Promise<number> => {
  const box = await locator.boundingBox();
  expect(box).not.toBeNull();
  return box!.y;
};

test('UI-015 browser progress table has sticky regions, date labels and stress layout', async ({
  page,
}) => {
  fs.mkdirSync(screenshotDir, { recursive: true });
  const backupPath = test.info().outputPath('ui15-stress-backup.json');
  fs.writeFileSync(backupPath, JSON.stringify(buildStressBackup(), null, 2));

  await page.setViewportSize({ width: 1280, height: 1000 });
  // This legal legacy fixture exercises the ordinary browser route. The actual
  // isolated desktop preview is seeded through its UI in the packaged review.
  await page.goto('/#/personal-progress');
  await expect(page.getByTestId('pp-page')).toBeVisible({ timeout: 30_000 });
  await restoreStress(page, backupPath);

  const projectFont = await page
    .getByTestId('pp-page')
    .evaluate((el) => getComputedStyle(el).fontFamily);
  await expect(page.getByTestId('pp-project-title').first()).toHaveCSS(
    'font-family',
    projectFont,
  );

  const dates = page.getByTestId('pp-date');
  await expect(dates).toHaveCount(2);
  await expect(page.locator('[data-testid="pp-date"][data-day="2025-12-31"]')).toHaveText(
    '2025.12.31',
  );
  await expect(page.locator('[data-testid="pp-date"]').last()).toContainText(
    /^\d{1,2}\.\d{1,2}$/,
  );

  const pageFont = await page.locator('.personal-progress h1').evaluate((el) => {
    return getComputedStyle(el).fontFamily;
  });
  expect(pageFont).toContain('Microsoft YaHei UI');
  const h1Size = await page
    .locator('.personal-progress h1')
    .evaluate((el) => getComputedStyle(el).fontSize);
  expect(h1Size).toBe('28px');

  const board = page.getByTestId('pp-board-scroll');
  await board.evaluate((el) => {
    el.scrollLeft = 0;
    el.scrollTop = 0;
  });
  await page.waitForTimeout(100);
  const boardBox = await board.boundingBox();
  expect(boardBox).not.toBeNull();
  const firstRow = page.getByTestId('pp-project-row').first();
  const headerProject = page.locator('thead .pp-project-col').first();
  const headerToday = page.locator('thead .pp-today-col').first();
  const headerSteps = page.locator('thead .pp-steps-col').first();
  const rowProject = firstRow.locator('th.pp-project-col');
  const rowToday = firstRow.locator('td.pp-today-col');
  const rowSteps = firstRow.locator('td.pp-steps-col');

  await expect(headerProject).toBeVisible();
  await expect(headerToday).toBeVisible();
  await expect(headerSteps).toBeVisible();
  expect(await boxX(headerProject)).toBeLessThan(await boxX(headerToday));
  expect(await boxX(headerToday)).toBeLessThan(await boxX(headerSteps));

  expect(
    await board.evaluate((el) => el.scrollWidth - el.clientWidth),
  ).toBeLessThanOrEqual(1);
  const dateAlignment = await page.evaluate(() => {
    const headerCells = [...document.querySelectorAll('thead th.pp-day-col')];
    const rowCells = [...document.querySelectorAll('tbody tr:first-child td.pp-day-col')];
    return headerCells.map((header, index) => ({
      headerX: header.getBoundingClientRect().x,
      rowX: rowCells[index]?.getBoundingClientRect().x ?? null,
    }));
  });
  for (const pair of dateAlignment) {
    expect(pair.rowX).not.toBeNull();
    expect(Math.abs(pair.headerX - pair.rowX!)).toBeLessThanOrEqual(2);
  }
  console.log(
    'ui15-sticky',
    await headerProject.evaluate((el) => {
      const rect = el.getBoundingClientRect();
      const style = getComputedStyle(el);
      return {
        x: rect.x,
        width: rect.width,
        position: style.position,
        left: style.left,
        zIndex: style.zIndex,
        text: el.textContent,
      };
    }),
  );
  await expect
    .poll(async () => Math.abs((await boxX(headerProject)) - (await boxX(rowProject))), {
      timeout: 5_000,
    })
    .toBeLessThanOrEqual(2);
  await expect
    .poll(async () => Math.abs((await boxX(headerToday)) - (await boxX(rowToday))), {
      timeout: 5_000,
    })
    .toBeLessThanOrEqual(2);
  await expect
    .poll(async () => Math.abs((await boxX(headerSteps)) - (await boxX(rowSteps))), {
      timeout: 5_000,
    })
    .toBeLessThanOrEqual(2);

  const stepsScroll = firstRow.getByTestId('pp-steps-scroll');
  await expect(stepsScroll).toBeVisible();
  const horizontalBefore = await board.evaluate((el) => el.scrollLeft);
  const stepTodayX = await boxX(rowToday);
  const stepProjectX = await boxX(rowProject);
  await stepsScroll.evaluate((el) => {
    el.scrollLeft = el.scrollWidth;
  });
  await page.waitForTimeout(100);
  expect(await stepsScroll.evaluate((el) => el.scrollLeft)).toBeGreaterThan(0);
  expect(await board.evaluate((el) => el.scrollLeft)).toBe(horizontalBefore);
  expect(Math.abs((await boxX(rowToday)) - stepTodayX)).toBeLessThanOrEqual(2);
  expect(Math.abs((await boxX(rowProject)) - stepProjectX)).toBeLessThanOrEqual(2);

  await board.evaluate((el) => {
    el.scrollLeft = 0;
    el.scrollTop = 260;
  });
  await page.waitForTimeout(100);
  expect(await board.evaluate((el) => el.scrollTop)).toBeGreaterThan(0);
  const boardY = (await board.boundingBox())!.y;
  expect(Math.abs((await boxY(headerProject)) - boardY)).toBeLessThanOrEqual(2);
  expect(Math.abs((await boxY(headerToday)) - boardY)).toBeLessThanOrEqual(2);
  expect(Math.abs((await boxY(headerSteps)) - boardY)).toBeLessThanOrEqual(2);

  for (const width of [1280, 1440, 1600]) {
    await page.setViewportSize({ width, height: 1000 });
    await board.evaluate((el) => {
      el.scrollLeft = 0;
      el.scrollTop = 0;
    });
    await firstRow.getByTestId('pp-steps-scroll').evaluate((el) => {
      el.scrollLeft = 0;
    });
    await page.waitForTimeout(150);
    await page.screenshot({
      path: path.join(screenshotDir, `ui15-${width}.png`),
      animations: 'disabled',
    });
    await expect
      .poll(
        async () =>
          page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth),
        { timeout: 5_000 },
      )
      .toBeLessThanOrEqual(1);
  }

  await page.evaluate(() => document.body.classList.add('isDarkTheme'));
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.waitForTimeout(150);
  await page.screenshot({
    path: path.join(screenshotDir, 'ui15-dark-1440.png'),
    animations: 'disabled',
  });
  await page.evaluate(() => document.body.classList.remove('isDarkTheme'));

  await page.setViewportSize({ width: 1024, height: 900 });
  await page.waitForTimeout(150);
  await page.screenshot({
    path: path.join(screenshotDir, 'ui15-1024.png'),
    animations: 'disabled',
  });
  await expect
    .poll(
      async () =>
        page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth),
      { timeout: 5_000 },
    )
    .toBeLessThanOrEqual(1);

  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.waitForTimeout(100);
  const firstTitle = firstRow.getByTestId('pp-step-title').first();
  await expect(firstRow.getByTestId('pp-entry')).toHaveCount(0);
  await firstTitle.click();
  await expect(firstRow.getByTestId('pp-entry')).toHaveCount(0);
  await firstRow.getByTestId('pp-complete-step').first().focus();
  await page.screenshot({
    path: path.join(screenshotDir, 'ui15-focus.png'),
    animations: 'disabled',
  });
  await firstRow.getByTestId('pp-complete-step').first().click();
  await expect(status(page)).toHaveAttribute('data-save-state', 'saved');
  await expect(firstRow.getByTestId('pp-entry')).toHaveCount(1);

  await page.getByTestId('pp-backfill').click();
  await expect(page.getByTestId('pp-entry-day')).toBeFocused();

  const rowToggles = page.getByTestId('pp-project-toggle');
  await expect(rowToggles).toHaveCount(40);
  for (let index = 0; index < 40; index++) {
    const toggle = rowToggles.nth(index);
    if ((await toggle.getAttribute('aria-expanded')) === 'true') {
      await toggle.click();
    }
  }
  await expect(page.getByTestId('pp-date')).toHaveCount(1);
  await expect(page.locator('.pp-day-col.is-today').first()).toBeVisible();
  await expect(page.getByTestId('pp-project-row')).toHaveCount(40);
});
