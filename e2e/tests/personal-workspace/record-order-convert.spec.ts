import { test, expect } from '../../fixtures/test.fixture';
import type { Page } from '@playwright/test';
const create = async (page: Page): Promise<void> => {
  await page.goto('/#/personal-progress');
  await page.getByTestId('pp-show-create').click();
  await page.getByTestId('pp-new-project-input').fill('转换验证');
  await page.getByTestId('pp-create-project').click();
  await expect(page.getByTestId('pp-show-create')).toHaveAttribute(
    'aria-expanded',
    'false',
  );
};
const record = async (page: Page, text: string): Promise<void> => {
  await page.getByTestId('pp-backfill').click();
  await page.getByTestId('pp-entry-input').fill(text);
  await page.getByTestId('pp-add-entry').click();
  await expect(page.getByTestId('pp-entry-input')).toBeHidden();
};
test('long press orders same-day records and keeps order after reload and conversion round trip', async ({
  page,
}) => {
  await create(page);
  await record(page, '记录一');
  await record(page, '记录二');
  const row = page.getByTestId('pp-project-row').filter({ hasText: '转换验证' });
  const bodies = row.getByTestId('pp-entry-body');
  const from = await bodies.nth(1).boundingBox();
  const to = await bodies.nth(0).boundingBox();
  expect(from).not.toBeNull();
  expect(to).not.toBeNull();
  await page.mouse.move(from!.x + 15, from!.y + 10);
  await page.mouse.down();
  await page.waitForTimeout(330);
  await page.mouse.move(to!.x + 15, to!.y + 2, { steps: 12 });
  await page.mouse.up();
  await expect(bodies).toHaveText(['记录二', '记录一']);
  await page.reload();
  await expect(bodies).toHaveText(['记录二', '记录一']);
  const handles = row.locator('personal-text-view.pp-entry-body');
  await handles.nth(0).focus();
  await handles.nth(0).press('Alt+ArrowDown');
  await expect(bodies).toHaveText(['记录一', '记录二']);
  await handles.nth(1).focus();
  await handles.nth(1).press('Alt+ArrowUp');
  await expect(bodies).toHaveText(['记录二', '记录一']);
  await row.getByTestId('pm-menu').click();
  await page.getByTestId('pm-convert').click();
  await expect(page.getByTestId('pr-page')).toBeVisible();
  await expect(page.getByTestId('pr-page')).toContainText('记录二');
  await page
    .getByTestId('pr-item-row')
    .filter({ hasText: '转换验证' })
    .getByTestId('pm-menu')
    .click();
  await page.getByTestId('pm-convert').click();
  await expect(bodies).toHaveText(['记录二', '记录一']);
});
test('conversion preserves completed step records and unfinished steps', async ({
  page,
}) => {
  await create(page);
  const row = page.getByTestId('pp-project-row').filter({ hasText: '转换验证' });
  await row.getByTestId('pp-append-step').click();
  await page.getByTestId('pp-insert-input').fill('保留步骤');
  await page.getByTestId('pp-insert-save').click();
  await expect(row.getByTestId('pp-step-title')).toHaveText(['保留步骤']);
  await row.getByTestId('pp-complete-step').click();
  await expect(row.getByTestId('pp-entry-body')).toHaveText(['保留步骤']);
  await row.getByTestId('pp-append-step').click();
  await page.getByTestId('pp-insert-input').fill('后续步骤');
  await page.getByTestId('pp-insert-save').click();
  await expect(row.getByTestId('pp-step-title')).toHaveText(['后续步骤']);
  await row.getByTestId('pm-menu').click();
  await page.getByTestId('pm-convert').click();
  await expect(page.getByTestId('pr-page')).toContainText('保留步骤');
  await page.reload();
  await expect(page.getByTestId('pr-page')).toContainText('保留步骤');
  await page
    .getByTestId('pr-item-row')
    .filter({ hasText: '转换验证' })
    .getByTestId('pm-menu')
    .click();
  await page.getByTestId('pm-convert').click();
  await expect(row.getByTestId('pp-entry-body')).toHaveText(['保留步骤']);
  await expect(row.getByTestId('pp-step-title')).toHaveText(['后续步骤']);
});
