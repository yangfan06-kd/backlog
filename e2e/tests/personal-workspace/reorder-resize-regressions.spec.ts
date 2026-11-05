import { test, expect } from '../../fixtures/test.fixture';
import type { Page, Locator } from '@playwright/test';

const setup = async (page: Page): Promise<Locator> => {
  await page.goto('/#/personal-progress');
  await page.getByTestId('pp-show-create').click();
  await page.getByTestId('pp-new-project-input').fill('拖动与窗口复现');
  await page.getByTestId('pp-create-project').click();
  await expect(page.getByTestId('pp-new-project-input')).toBeHidden();
  const row = page.getByTestId('pp-project-row').filter({ hasText: '拖动与窗口复现' });
  await page.getByTestId('pp-backfill').click();
  await page.getByTestId('pp-entry-input').fill('多少啊');
  await page.getByTestId('pp-add-entry').click();
  await expect(page.getByTestId('pp-entry-input')).toBeHidden();
  await row.getByTestId('pp-append-step').click();
  await page.getByTestId('pp-insert-input').fill('前去拿东西');
  const editor = page
    .getByTestId('pp-insert-input')
    .locator('xpath=ancestor::personal-rich-text-editor[1]');
  await page.getByTestId('pp-insert-input').press('Control+A');
  await editor.getByTestId('pt-bold').click();
  await editor.getByTestId('pt-italic').click();
  await page.getByTestId('pp-insert-save').click();
  await expect(row.getByTestId('pp-step-title')).toContainText('前去拿东西');
  await row.getByTestId('pp-complete-step').click();
  await expect(row.getByTestId('pp-today-cell').getByTestId('pp-entry-body')).toHaveText([
    '多少啊',
    '前去拿东西',
  ]);
  return row;
};

test('mouse hold with early movement reorders a formatted completion and manual record', async ({
  page,
}) => {
  const row = await setup(page);
  const bodies = row.getByTestId('pp-today-cell').getByTestId('pp-entry-body');
  const from = (await bodies.nth(1).boundingBox())!;
  const to = (await bodies.nth(0).boundingBox())!;
  await page.mouse.move(from.x + 15, from.y + 10);
  await page.mouse.down();
  await page.mouse.move(from.x + 15, from.y + 2, { steps: 2 });
  await page.waitForTimeout(400);
  await page.mouse.move(to.x + 15, to.y + 1, { steps: 12 });
  await page.mouse.up();
  await expect(bodies).toHaveText(['前去拿东西', '多少啊']);
  await expect(
    row.locator('.pp-entry').first().locator('.pt-bold.pt-italic'),
  ).toBeVisible();
  await page.reload();
  await expect(bodies).toHaveText(['前去拿东西', '多少啊']);
  await row.getByTestId('pp-project-title').click();
  await row.getByTestId('pp-undo-entry').click();
  await expect(bodies).toHaveText(['多少啊']);
  await expect(row.getByTestId('pp-step-title')).toContainText('前去拿东西');
});

test('today separator stays aligned to history at different window widths', async ({
  page,
}) => {
  const row = await setup(page);
  await page.getByTestId('pp-backfill').click();
  await page.getByTestId('pp-entry-day').fill('2020-01-01');
  await page.getByTestId('pp-entry-input').fill('购买车票');
  await page.getByTestId('pp-add-entry').click();
  await expect(page.getByTestId('pp-entry-input')).toBeHidden();
  const measurements = [];
  for (const width of [900, 1280, 1600, 1920, 1024, 1600]) {
    await page.setViewportSize({ width, height: 900 });
    await page.getByTestId('pp-board-scroll').evaluate((el) => {
      el.scrollLeft = 0;
    });
    const history = await row
      .locator('td.pp-day-col:not(.pp-today-col)')
      .last()
      .boundingBox();
    const today = await row.getByTestId('pp-today-cell').boundingBox();
    const header = await page.locator('thead .pp-today-col').boundingBox();
    measurements.push({
      width,
      history,
      today,
      header,
      gap: today!.x - history!.x - history!.width,
    });
  }
  await page.screenshot({
    path: 'G:/project1/output/handoffs/CX-027/resize-baseline.png',
  });
  const info = test.info();
  await info.attach('geometry', {
    body: JSON.stringify(measurements, null, 2),
    contentType: 'application/json',
  });
  for (const m of measurements) {
    expect(Math.abs(m.gap), JSON.stringify(m)).toBeLessThanOrEqual(1);
    expect(Math.abs(m.today!.x - m.header!.x)).toBeLessThanOrEqual(1);
  }
});
