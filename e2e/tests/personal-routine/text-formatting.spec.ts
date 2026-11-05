import { expect, test } from '../../fixtures/test.fixture';
import type { Locator, Page } from '@playwright/test';

const status = (page: Page): Locator => page.getByTestId('pr-status');
const itemRow = (page: Page, name: string): Locator =>
  page.getByTestId('pr-item-row').filter({ hasText: name });
const editorFor = (page: Page, testId: string): Locator =>
  page.getByTestId(testId).locator('xpath=ancestor::personal-rich-text-editor[1]');

const gotoRoutine = async (page: Page): Promise<void> => {
  await page.goto('/#/personal-routine');
  await expect(page.getByTestId('pr-page')).toBeVisible({ timeout: 30_000 });
};

test('routine entry formatting survives reload', async ({ page }) => {
  await gotoRoutine(page);
  await page.getByTestId('pr-new-item-title').fill('格式事项');
  await page.getByTestId('pr-create-item').click();
  await expect(itemRow(page, '格式事项')).toBeVisible();
  await itemRow(page, '格式事项').getByTestId('pr-record').click();
  await page.getByTestId('pr-entry-body').fill('常态记录');
  await page.getByTestId('pr-save-entry').click();
  await expect(status(page)).toHaveAttribute('data-save-state', 'saved');

  await itemRow(page, '格式事项').locator('.pr-entry-body').dblclick();
  const editor = editorFor(page, 'pr-entry-body');
  await editor.locator('.cm-content').click();
  await page.keyboard.press('Control+A');
  await editor.getByTestId('pt-underline').click();
  await editor.getByTestId('pt-color-toggle').click();
  await editor.getByTestId('pt-color-purple').click();
  await expect(editor.locator('.cm-content .pt-underline')).toBeVisible();
  await expect(editor.locator('.cm-content .pt-color-purple')).toBeVisible();
  await page.getByTestId('pr-save-entry').click();
  await expect(status(page)).toHaveAttribute('data-save-state', 'saved');
  const entry = itemRow(page, '格式事项').getByTestId('pr-entry');
  await expect(entry.locator('.pt-underline')).toBeVisible();
  await expect(entry.locator('.pt-color-purple')).toBeVisible();

  await page.reload();
  await expect(page.getByTestId('pr-page')).toBeVisible({ timeout: 30_000 });
  const reloaded = itemRow(page, '格式事项').getByTestId('pr-entry');
  await expect(reloaded.locator('.pt-underline')).toBeVisible();
  await expect(reloaded.locator('.pt-color-purple')).toBeVisible();
});
