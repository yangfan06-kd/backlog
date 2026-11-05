import { expect, test } from '../../fixtures/test.fixture';
import type { Locator, Page } from '@playwright/test';

const projectRow = (page: Page, name: string): Locator =>
  page.getByTestId('pp-project-row').filter({ hasText: name });
const status = (page: Page): Locator => page.getByTestId('pp-status');
const editorFor = (page: Page, testId: string): Locator =>
  page.getByTestId(testId).locator('xpath=ancestor::personal-rich-text-editor[1]');

const gotoProgress = async (page: Page): Promise<void> => {
  await page.goto('/#/personal-progress');
  await expect(page.getByTestId('pp-page')).toBeVisible({ timeout: 30_000 });
};

const createAndSelect = async (page: Page, name: string): Promise<void> => {
  if (!(await page.getByTestId('pp-new-project-input').isVisible())) {
    await page.getByTestId('pp-show-create').click();
  }
  await page.getByTestId('pp-new-project-input').fill(name);
  await page.getByTestId('pp-create-project').click();
  const row = projectRow(page, name);
  await expect(row).toBeVisible();
  await row.getByTestId('pp-project-title').click();
  await expect(row).toHaveClass(/is-selected/);
};

const appendPlainStep = async (
  page: Page,
  name: string,
  title: string,
): Promise<Locator> => {
  const row = projectRow(page, name);
  await row.getByTestId('pp-append-step').click();
  await page.getByTestId('pp-insert-input').fill(title);
  await page.getByTestId('pp-insert-save').click();
  await expect(status(page)).toHaveAttribute('data-save-state', 'saved');
  return row.locator('[data-testid="pp-step-title"]');
};

const selectAll = async (page: Page, editor: Locator): Promise<void> => {
  await editor.locator('.cm-content').click();
  await page.keyboard.press('Control+A');
};

test.describe('personal rich text', () => {
  test('formats a step, survives reload, and keeps the completion snapshot', async ({
    page,
  }) => {
    await gotoProgress(page);
    await createAndSelect(page, 'Format Project');
    await appendPlainStep(page, 'Format Project', '格式化步骤');
    const row = projectRow(page, 'Format Project');
    await row.getByTestId('pp-step-edit').click();
    const editor = editorFor(page, 'pp-step-edit-input');
    await selectAll(page, editor);
    await editor.getByTestId('pt-bold').click();
    await expect(editor.locator('.cm-content .pt-bold')).toBeVisible();
    await editor.getByTestId('pt-color-toggle').click();
    await editor.getByTestId('pt-color-blue').click();
    await expect(editor.locator('.cm-content .pt-color-blue')).toBeVisible();
    await page.getByTestId('pp-step-edit-save').click();
    await expect(status(page)).toHaveAttribute('data-save-state', 'saved');

    const step = row.locator('[data-testid="pp-step-title"]');
    await expect(
      step.locator('.pt-bold').filter({ hasText: '格式化步骤' }),
    ).toBeVisible();
    await expect(step.locator('.pt-color-blue')).toBeVisible();
    await page.screenshot({
      path: 'G:/project1/output/handoffs/DS-014/screenshots/formatted-step.png',
    });

    await page.reload();
    await expect(page.getByTestId('pp-page')).toBeVisible({ timeout: 30_000 });
    await projectRow(page, 'Format Project').getByTestId('pp-project-title').click();
    const reloaded = projectRow(page, 'Format Project').locator(
      '[data-testid="pp-step-title"]',
    );
    await expect(reloaded.locator('.pt-bold')).toBeVisible();
    await expect(reloaded.locator('.pt-color-blue')).toBeVisible();

    await projectRow(page, 'Format Project').getByTestId('pp-complete-step').click();
    const completion = projectRow(page, 'Format Project').getByTestId('pp-entry');
    await expect(completion.locator('.pt-bold')).toBeVisible();
    await expect(completion.locator('.pt-color-blue')).toBeVisible();
  });

  test('format-only edit is dirty and saves without changing text', async ({ page }) => {
    await gotoProgress(page);
    await createAndSelect(page, 'Dirty Format');
    const row = projectRow(page, 'Dirty Format');
    await appendPlainStep(page, 'Dirty Format', '局部格式');

    await row.getByTestId('pp-step-edit').click();
    const editor = editorFor(page, 'pp-step-edit-input');
    await selectAll(page, editor);
    await editor.getByTestId('pt-italic').click();
    await expect(page.getByTestId('pp-draft-prompt')).toHaveCount(0);

    await page.getByTestId('pp-step-edit-save').click();
    await expect(status(page)).toHaveAttribute('data-save-state', 'saved');
    await expect(row.locator('[data-testid="pp-step-title"] .pt-italic')).toBeVisible();
    await expect(row.locator('[data-testid="pp-step-title"]')).toContainText('局部格式');
  });

  test('new manual entry formats through the visible editor', async ({ page }) => {
    await gotoProgress(page);
    await createAndSelect(page, 'Entry Format');
    if (!(await page.getByTestId('pp-entry-input').isVisible())) {
      await page.getByTestId('pp-backfill').click();
    }
    const editor = editorFor(page, 'pp-entry-input');
    await editor.locator('.cm-content').click();
    await page.keyboard.insertText('格式记录');
    await page.keyboard.press('Control+A');
    await editor.getByTestId('pt-bold').click();
    await editor.getByTestId('pt-color-toggle').click();
    await editor.getByTestId('pt-color-green').click();
    await page.getByTestId('pp-add-entry').click();
    await expect(status(page)).toHaveAttribute('data-save-state', 'saved');
    const entry = projectRow(page, 'Entry Format').getByTestId('pp-entry');
    await expect(entry.locator('.pt-bold')).toBeVisible();
    await expect(entry.locator('.pt-color-green')).toBeVisible();
    await page.screenshot({
      path: 'G:/project1/output/handoffs/DS-014/screenshots/formatted-entry.png',
    });
  });
  test('complete backup restores text formatting', async ({ page }) => {
    await gotoProgress(page);
    await createAndSelect(page, 'Backup Format');
    if (!(await page.getByTestId('pp-entry-input').isVisible())) {
      await page.getByTestId('pp-backfill').click();
    }
    const editor = editorFor(page, 'pp-entry-input');
    await editor.locator('.cm-content').click();
    await page.keyboard.insertText('备份格式记录');
    await page.keyboard.press('Control+A');
    await editor.getByTestId('pt-italic').click();
    await editor.getByTestId('pt-color-toggle').click();
    await editor.getByTestId('pt-color-red').click();
    await page.getByTestId('pp-add-entry').click();
    await expect(status(page)).toHaveAttribute('data-save-state', 'saved');
    await expect(editor.locator('.cm-content')).toHaveText('');
    await expect(projectRow(page, 'Backup Format').locator('.pt-italic')).toBeVisible();

    await page.goto('/#/personal-backup');
    await expect(page.getByTestId('pb-page')).toBeVisible({ timeout: 30_000 });
    const downloaded = page.waitForEvent('download');
    await page.getByTestId('pb-export').click();
    const target = test.info().outputPath('format-backup.json');
    await (await downloaded).saveAs(target);
    page.once('dialog', (dialog) => dialog.accept());
    await page.getByTestId('pb-restore-input').setInputFiles(target);
    await expect(page.getByTestId('pb-status')).toHaveAttribute(
      'data-save-state',
      'restored',
      { timeout: 30_000 },
    );

    await gotoProgress(page);
    const entry = projectRow(page, 'Backup Format').getByTestId('pp-entry');
    await expect(entry.locator('.pt-italic')).toBeVisible();
    await expect(entry.locator('.pt-color-red')).toBeVisible();
  });
  test('overview and archive render the saved formats', async ({ page }) => {
    await gotoProgress(page);
    await createAndSelect(page, 'Display Format');
    const row = projectRow(page, 'Display Format');
    await appendPlainStep(page, 'Display Format', '显示格式');
    await row.getByTestId('pp-step-edit').click();
    const editor = editorFor(page, 'pp-step-edit-input');
    await selectAll(page, editor);
    await editor.getByTestId('pt-bold').click();
    await page.getByTestId('pp-step-edit-save').click();
    await expect(status(page)).toHaveAttribute('data-save-state', 'saved');

    await page.goto('/#/personal-overview');
    await expect(page.getByTestId('po-page')).toBeVisible({ timeout: 30_000 });
    const project = page
      .getByTestId('po-project-row')
      .filter({ hasText: 'Display Format' });
    await project.getByTestId('po-project-name').click();
    await expect(project.locator('.po-step-title .pt-bold')).toBeVisible();

    await page.goto('/#/personal-progress');
    await expect(page.getByTestId('pp-page')).toBeVisible({ timeout: 30_000 });
    await projectRow(page, 'Display Format').getByTestId('pp-project-title').click();
    await projectRow(page, 'Display Format').getByTestId('pp-complete-step').click();
    page.once('dialog', (dialog) => dialog.accept());
    await page
      .locator('[data-testid="pp-project-row"].is-selected')
      .getByTestId('pp-finish-project-row')
      .click();
    await expect(page.getByTestId('pp-view-archive')).toBeVisible();
    await page.getByTestId('pp-view-archive').click();
    await expect(page.getByTestId('pa-page')).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId('pa-entry').locator('.pt-bold')).toBeVisible();
  });
  test('new formatted step is one persisted step and survives reload', async ({
    page,
  }) => {
    await gotoProgress(page);
    await createAndSelect(page, 'New Step Format');
    const row = projectRow(page, 'New Step Format');
    await row.getByTestId('pp-append-step').click();
    const editor = editorFor(page, 'pp-insert-input');
    await editor.locator('.cm-content').click();
    await page.keyboard.insertText('新步骤格式');
    await selectAll(page, editor);
    await editor.getByTestId('pt-bold').click();
    await editor.getByTestId('pt-color-toggle').click();
    await editor.getByTestId('pt-color-blue').click();
    await page.getByTestId('pp-insert-save').click();
    await expect(status(page)).toHaveAttribute('data-save-state', 'saved');
    await expect(row.locator('[data-testid="pp-step-title"]')).toHaveCount(1);
    await expect(row.locator('[data-testid="pp-step-title"] .pt-bold')).toHaveText(
      '新步骤格式',
    );
    await expect(row.locator('[data-testid="pp-step-title"] .pt-color-blue')).toHaveText(
      '新步骤格式',
    );
    await page.reload();
    await expect(page.getByTestId('pp-page')).toBeVisible({ timeout: 30_000 });
    await projectRow(page, 'New Step Format').getByTestId('pp-project-title').click();
    const reloaded = projectRow(page, 'New Step Format').locator(
      '[data-testid="pp-step-title"]',
    );
    await expect(reloaded).toHaveCount(1);
    await expect(reloaded.locator('.pt-bold')).toHaveText('新步骤格式');
    await expect(reloaded.locator('.pt-color-blue')).toHaveText('新步骤格式');
  });
  test('entry formatting survives undo of completion', async ({ page }) => {
    await gotoProgress(page);
    await createAndSelect(page, 'Undo Format');
    const row = projectRow(page, 'Undo Format');
    await appendPlainStep(page, 'Undo Format', '待完成格式');
    await row.getByTestId('pp-step-edit').click();
    const editor = editorFor(page, 'pp-step-edit-input');
    await selectAll(page, editor);
    await editor.getByTestId('pt-underline').click();
    await page.getByTestId('pp-step-edit-save').click();
    await expect(status(page)).toHaveAttribute('data-save-state', 'saved');
    await row.getByTestId('pp-complete-step').click();
    await expect(page.getByTestId('pp-undo')).toBeEnabled();
    await page.getByTestId('pp-undo').click();
    await expect(status(page)).toHaveAttribute('data-save-state', 'saved');
    await expect(
      row.locator('[data-testid="pp-step-title"] .pt-underline'),
    ).toBeVisible();
  });
});
