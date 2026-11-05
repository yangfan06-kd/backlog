import { expect, test } from '../../fixtures/test.fixture';
import type { Locator, Page } from '@playwright/test';
import * as fs from 'node:fs';
import * as path from 'node:path';

const routineStatus = (page: Page): Locator => page.getByTestId('pr-status');
const backupStatus = (page: Page): Locator => page.getByTestId('pb-status');
const screenshotDir = path.join(
  'G:/project1/output/handoffs',
  process.env.PROJECT1_REVIEW_TASK || 'CX-016',
  'ui-consistency',
);

const gotoRoutine = async (page: Page): Promise<void> => {
  await page.goto('/#/personal-routine');
  await expect(page.getByTestId('pr-page')).toBeVisible({ timeout: 30_000 });
};
const gotoBackup = async (page: Page): Promise<void> => {
  await page.goto('/#/personal-backup');
  await expect(page.getByTestId('pb-page')).toBeVisible({ timeout: 30_000 });
};

const createRoutineItem = async (page: Page, title: string): Promise<void> => {
  await page.getByTestId('pr-new-item-title').fill(title);
  await page.getByTestId('pr-create-item').click();
  await expect(page.getByTestId('pr-item-row').filter({ hasText: title })).toHaveCount(
    1,
    { timeout: 30_000 },
  );
  await expect(routineStatus(page)).toHaveAttribute('data-save-state', 'saved');
};

const selectRoutineItem = async (page: Page, title: string): Promise<void> => {
  const row = page.getByTestId('pr-item-row').filter({ hasText: title });
  await row.getByTestId('pr-item-name').click();
};

const saveRoutineRecord = async (
  page: Page,
  title: string,
  day: string,
  body: string,
): Promise<void> => {
  await selectRoutineItem(page, title);
  await page.getByTestId('pr-entry-day').fill(day);
  await page.getByTestId('pr-entry-body').fill(body);
  await page.getByTestId('pr-save-entry').click();
  await expect(routineStatus(page)).toHaveAttribute('data-save-state', 'saved', {
    timeout: 30_000,
  });
};

const todayValue = async (page: Page): Promise<string> =>
  page.getByTestId('pr-entry-day').inputValue();

const boxX = async (locator: Locator): Promise<number> => {
  const box = await locator.boundingBox();
  expect(box).not.toBeNull();
  return box!.x;
};

const boxY = async (locator: Locator): Promise<number> => {
  const box = await locator.boundingBox();
  expect(box).not.toBeNull();
  return box!.y;
};

test('selected routine range text remains readable in light and dark themes', async ({
  page,
}) => {
  await gotoRoutine(page);
  await page.getByTestId('pr-range-three-months').click();
  const selected = page.getByTestId('pr-range-three-months');
  for (const dark of [false, true]) {
    await page.evaluate(
      (value) => document.body.classList.toggle('isDarkTheme', value),
      dark,
    );
    // Measure rendered text after its real color transition has settled.
    await expect
      .poll(() =>
        selected.evaluate((el) => {
          const ctx = document.createElement('canvas').getContext('2d')!;
          const rgb = (css: string): number[] => {
            ctx.clearRect(0, 0, 1, 1);
            ctx.fillStyle = css;
            ctx.fillRect(0, 0, 1, 1);
            return Array.from(ctx.getImageData(0, 0, 1, 1).data);
          };
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
          const style = getComputedStyle(el);
          const a = luminance(rgb(style.color));
          const b = luminance(rgb(style.backgroundColor));
          return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
        }),
      )
      .toBeGreaterThanOrEqual(4.5);
    await expect(selected).toHaveAttribute('aria-pressed', 'true');
  }
});

test('routine table keeps item/today fixed while history and rows scroll', async ({
  page,
}) => {
  fs.mkdirSync(screenshotDir, { recursive: true });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await gotoRoutine(page);
  await page.getByTestId('pr-range-three-months').click();

  for (let i = 0; i < 20; i++) {
    await createRoutineItem(page, `常态事项 ${String(i + 1).padStart(2, '0')}`);
  }
  const titles = Array.from(
    { length: 20 },
    (_, i) => `常态事项 ${String(i + 1).padStart(2, '0')}`,
  );
  const dates = Array.from({ length: 40 }, (_, i) => {
    const date = new Date();
    date.setDate(date.getDate() - 1 - 39 + i);
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  });
  for (let i = 0; i < dates.length; i++) {
    const longBody =
      i === 0
        ? '一条较长的常态记录。'.repeat(12) +
          '🙂 包含表情和连续字符串abcdefghijklmnopqrstuvwxyz0123456789abcdefghijklmnopqrstuvwxyz0123456789。'
        : `常态记录 ${i + 1} · ${dates[i]}`;
    await saveRoutineRecord(page, titles[i % titles.length], dates[i], longBody);
  }
  await saveRoutineRecord(page, titles[0], dates[39], '今日第二条记录');

  await expect(page.getByTestId('pr-item-row')).toHaveCount(20);
  await page.getByTestId('pr-table-scroll').evaluate((el) => {
    el.scrollLeft = 0;
  });
  await expect(page.getByTestId('pr-date-' + dates[0])).toBeVisible();
  await expect(page.getByTestId('pr-date-' + dates[39])).toBeVisible();
  await expect(page.getByTestId('pr-date-' + (await todayValue(page)))).toHaveCount(1);
  await expect(page.getByTestId('pr-open-item')).toHaveCount(0);
  await expect(page.locator('.pr-edit-column')).toHaveCount(0);

  const board = page.getByTestId('pr-table-scroll');
  const firstRow = page.getByTestId('pr-item-row').first();
  const headerItem = page.locator('thead .pr-item-column').first();
  const headerToday = page.locator('thead .pr-today-column').first();
  const rowItem = firstRow.locator('th.pr-item-cell');
  const rowToday = firstRow.locator('td.pr-today-cell');

  await board.evaluate((el) => {
    el.scrollLeft = 0;
    el.scrollTop = 0;
  });
  await page.waitForTimeout(100);
  expect(await board.evaluate((el) => el.scrollWidth)).toBeGreaterThan(
    await board.evaluate((el) => el.clientWidth),
  );
  const before = { item: await boxX(rowItem), today: await boxX(rowToday) };
  expect(Math.abs((await boxX(headerItem)) - before.item)).toBeLessThanOrEqual(2);
  expect(Math.abs((await boxX(headerToday)) - before.today)).toBeLessThanOrEqual(2);

  await board.evaluate((el) => {
    el.scrollLeft = el.scrollWidth;
  });
  await page.waitForTimeout(150);
  expect(Math.abs((await boxX(rowItem)) - before.item)).toBeLessThanOrEqual(2);
  expect(Math.abs((await boxX(rowToday)) - before.today)).toBeLessThanOrEqual(2);
  expect(Math.abs((await boxX(headerItem)) - (await boxX(rowItem)))).toBeLessThanOrEqual(
    2,
  );
  expect(
    Math.abs((await boxX(headerToday)) - (await boxX(rowToday))),
  ).toBeLessThanOrEqual(2);

  await board.evaluate((el) => {
    el.scrollLeft = 0;
    el.scrollTop = 260;
  });
  await page.waitForTimeout(100);
  expect(await board.evaluate((el) => el.scrollTop)).toBeGreaterThan(0);
  const boardY = (await board.boundingBox())!.y;
  expect(Math.abs((await boxY(headerItem)) - boardY)).toBeLessThanOrEqual(2);
  expect(Math.abs((await boxY(headerToday)) - boardY)).toBeLessThanOrEqual(2);

  const keyboardBefore = await board.evaluate((el) => el.scrollLeft);
  await board.focus();
  await page.keyboard.press('ArrowRight');
  await expect
    .poll(async () => board.evaluate((el) => el.scrollLeft), { timeout: 5_000 })
    .toBeGreaterThan(keyboardBefore);

  await board.evaluate((el) => {
    el.scrollLeft = 0;
    el.scrollTop = 0;
  });
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({
    path: path.join(screenshotDir, 'routine-1440.png'),
    animations: 'disabled',
  });
  await board.evaluate((el) => {
    el.scrollLeft = el.scrollWidth;
  });
  await page.waitForTimeout(100);
  await page.screenshot({
    path: path.join(screenshotDir, 'routine-horizontal-end.png'),
    animations: 'disabled',
  });

  for (const width of [1280, 1440, 1600, 1024]) {
    await page.setViewportSize({ width, height: 1000 });
    await page.waitForTimeout(120);
    await page.screenshot({
      path: path.join(screenshotDir, `routine-${width}.png`),
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
});

test('central restore trigger is a keyboard button and cancelling preserves data', async ({
  page,
}) => {
  const bad = test.info().outputPath('bad-restore.json');
  fs.writeFileSync(bad, '{"bad":', 'utf8');

  await gotoBackup(page);
  const backupTrigger = page.getByTestId('pb-restore-trigger');
  await expect(backupTrigger).toBeVisible();
  await expect(backupTrigger).toHaveJSProperty('tagName', 'BUTTON');
  await backupTrigger.focus();
  const backupChooserPromise = page.waitForEvent('filechooser');
  await page.keyboard.press('Enter');
  const backupChooser = await backupChooserPromise;
  expect(backupChooser).toBeTruthy();
  page.once('dialog', (dialog) => dialog.dismiss());
  await backupChooser.setFiles(bad);
  await expect(backupStatus(page)).toHaveAttribute('data-save-state', 'idle');
});
