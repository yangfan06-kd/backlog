import { expect, test } from '../../fixtures/test.fixture';
import type { Locator, Page } from '@playwright/test';

const projectRow = (page: Page, name: string): Locator =>
  page.getByTestId('pp-project-row').filter({ hasText: name });
const editorFor = (page: Page, testId: string): Locator =>
  page.getByTestId(testId).locator('xpath=ancestor::personal-rich-text-editor[1]');

const gotoProgress = async (page: Page): Promise<void> => {
  await page.goto('/#/personal-progress');
  await expect(page.getByTestId('pp-page')).toBeVisible({ timeout: 30_000 });
};

const createProject = async (page: Page, name: string): Promise<Locator> => {
  if (!(await page.getByTestId('pp-new-project-input').isVisible())) {
    await page.getByTestId('pp-show-create').click();
  }
  await page.getByTestId('pp-new-project-input').fill(name);
  await page.getByTestId('pp-create-project').click();
  const row = projectRow(page, name);
  await expect(row).toBeVisible();
  await row.getByTestId('pp-project-title').click();
  return row;
};

const typeEntry = async (page: Page, text: string): Promise<Locator> => {
  if (!(await page.getByTestId('pp-entry-input').isVisible())) {
    await page.getByTestId('pp-backfill').click();
  }
  const editor = editorFor(page, 'pp-entry-input');
  await editor.locator('.cm-content').click();
  await page.keyboard.insertText(text);
  return editor;
};

const selectAll = async (page: Page, editor: Locator): Promise<void> => {
  await editor.locator('.cm-content').click();
  await page.keyboard.press('Control+A');
};

test.describe('DS-014-B regression counterexamples', () => {
  test('pending bold and color combine and edits inherit the surrounding word', async ({
    page,
  }) => {
    await gotoProgress(page);
    await createProject(page, 'Pending color and insertion');
    if (!(await page.getByTestId('pp-entry-input').isVisible())) {
      await page.getByTestId('pp-backfill').click();
    }
    const editor = editorFor(page, 'pp-entry-input');
    await editor.locator('.cm-content').click();
    await editor.getByTestId('pt-bold').click();
    await editor.getByTestId('pt-color-toggle').click();
    await editor.getByTestId('pt-color-blue').click();
    await page.keyboard.insertText('abcd');
    await expect(editor.locator('.cm-content .pt-bold.pt-color-blue')).toHaveText('abcd');
    await page.keyboard.press('Home');
    await page.keyboard.press('ArrowRight');
    await page.keyboard.insertText('X');
    await expect(editor.locator('.cm-content .pt-bold.pt-color-blue')).toHaveText(
      'aXbcd',
    );
    await editor.getByTestId('pt-clear').click();
    await page.keyboard.insertText('Y');
    await expect(editor.locator('.cm-content')).toHaveText('aXYbcd');
    await expect(editor.locator('.cm-content .pt-bold')).toHaveText(['aX', 'bcd']);
    await page.keyboard.press('Control+z');
    await page.keyboard.press('Control+y');
    await expect(editor.locator('.cm-content')).toHaveText('aXYbcd');
    await expect(editor.locator('.cm-content .pt-bold')).toHaveText(['aX', 'bcd']);
  });
  test('Ctrl+Z/Ctrl+Y undo only the format change, not the text', async ({ page }) => {
    await gotoProgress(page);
    await createProject(page, 'Undo Format B');
    const editor = await typeEntry(page, 'abcd');
    await selectAll(page, editor);
    await page.keyboard.press('Control+b');
    await expect(editor.locator('.cm-content .pt-bold')).toBeVisible();
    await page.keyboard.press('Control+z');
    await expect(editor.locator('.cm-content')).toHaveText('abcd');
    await expect(editor.locator('.cm-content .pt-bold')).toHaveCount(0);
    await page.keyboard.press('Control+y');
    await expect(editor.locator('.cm-content .pt-bold')).toBeVisible();
    await expect(editor.locator('.cm-content')).toHaveText('abcd');
  });

  test('color menu is keyboard-operable and keeps the selection', async ({ page }) => {
    await gotoProgress(page);
    await createProject(page, 'Keyboard Color');
    const editor = await typeEntry(page, '键盘选色');
    await selectAll(page, editor);
    await editor.getByTestId('pt-color-toggle').focus();
    await page.keyboard.press('Enter');
    await expect(editor.getByTestId('pt-color-blue')).toBeVisible();
    await editor.getByTestId('pt-color-blue').focus();
    await page.keyboard.press('Enter');
    await expect(editor.locator('.cm-content .pt-color-blue')).toBeVisible();
    await expect(editor.locator('.cm-content .pt-color-blue')).toHaveText('键盘选色');
  });

  test('moving the cursor invalidates the old menu selection', async ({ page }) => {
    await gotoProgress(page);
    await createProject(page, 'Stale Selection');
    const editor = await typeEntry(page, 'abcd');
    await selectAll(page, editor);
    await editor.getByTestId('pt-bold').click();
    await page.keyboard.press('ArrowRight');
    await editor.getByTestId('pt-color-toggle').click();
    await editor.getByTestId('pt-color-blue').click();
    await expect(editor.locator('.cm-content .pt-color-blue')).toHaveCount(0);
    await page.keyboard.insertText('X');
    await expect(editor.locator('.cm-content')).toHaveText('abcdX');
    await expect(editor.locator('.cm-content .pt-color-blue')).toHaveText('X');
  });

  test('default color removes only color and preserves other styles', async ({
    page,
  }) => {
    await gotoProgress(page);
    await createProject(page, 'Default Color');
    const editor = await typeEntry(page, '默认颜色');
    await selectAll(page, editor);
    await editor.getByTestId('pt-bold').click();
    await editor.getByTestId('pt-color-toggle').click();
    await editor.getByTestId('pt-color-blue').click();
    await expect(editor.locator('.cm-content .pt-color-blue')).toBeVisible();
    await selectAll(page, editor);
    await editor.getByTestId('pt-color-toggle').click();
    await editor.getByTestId('pt-color-default').click();
    await expect(editor.locator('.cm-content .pt-color-blue')).toHaveCount(0);
    await expect(editor.locator('.cm-content .pt-bold')).toBeVisible();
  });

  test('no-selection styles apply to subsequent typing and can be combined', async ({
    page,
  }) => {
    await gotoProgress(page);
    await createProject(page, 'Pending Styles');
    if (!(await page.getByTestId('pp-entry-input').isVisible())) {
      await page.getByTestId('pp-backfill').click();
    }
    const editor = editorFor(page, 'pp-entry-input');
    await editor.locator('.cm-content').click();
    await editor.getByTestId('pt-bold').click();
    await editor.getByTestId('pt-italic').click();
    await page.keyboard.insertText('后续');
    await expect(editor.locator('.cm-content .pt-bold')).toHaveText('后续');
    await expect(editor.locator('.cm-content .pt-italic')).toHaveText('后续');
  });

  test('clear and combined formats participate in undo without touching text', async ({
    page,
  }) => {
    await gotoProgress(page);
    await createProject(page, 'History Composite');
    const editor = await typeEntry(page, 'abcd');
    await selectAll(page, editor);
    await editor.getByTestId('pt-bold').click();
    await editor.getByTestId('pt-italic').click();
    await editor.getByTestId('pt-color-toggle').click();
    await editor.getByTestId('pt-color-blue').click();
    await expect(editor.locator('.cm-content .pt-color-blue')).toBeVisible();
    await page.keyboard.press('Control+z');
    await expect(editor.locator('.cm-content')).toHaveText('abcd');
    await page.keyboard.press('Control+y');
    await expect(editor.locator('.cm-content')).toHaveText('abcd');
    await expect(editor.locator('.cm-content .pt-color-blue')).toBeVisible();

    await selectAll(page, editor);
    await editor.getByTestId('pt-clear').click();
    await expect(editor.locator('.cm-content .pt-bold')).toHaveCount(0);
    await expect(editor.locator('.cm-content')).toHaveText('abcd');
    await page.keyboard.press('Control+z');
    await expect(editor.locator('.cm-content')).toHaveText('abcd');
    await expect(editor.locator('.cm-content .pt-bold')).toBeVisible();
    await page.keyboard.press('Control+y');
    await expect(editor.locator('.cm-content .pt-bold')).toHaveCount(0);
    await expect(editor.locator('.cm-content')).toHaveText('abcd');
  });

  test('pending style does not leak into another project', async ({ page }) => {
    await gotoProgress(page);
    await createProject(page, 'Pending A');
    const a = projectRow(page, 'Pending A');
    await a.getByTestId('pp-project-title').click();
    if (!(await page.getByTestId('pp-entry-input').isVisible())) {
      await page.getByTestId('pp-backfill').click();
    }
    const editorA = editorFor(page, 'pp-entry-input');
    await editorA.locator('.cm-content').click();
    await editorA.getByTestId('pt-bold').click();
    await createProject(page, 'Pending B');
    await projectRow(page, 'Pending A').getByTestId('pp-project-title').click();
    await projectRow(page, 'Pending B').getByTestId('pp-project-title').click();
    if (!(await page.getByTestId('pp-entry-input').isVisible())) {
      await page.getByTestId('pp-backfill').click();
    }
    const editorB = editorFor(page, 'pp-entry-input');
    await editorB.locator('.cm-content').click();
    await page.keyboard.insertText('B only');
    await expect(editorB.locator('.cm-content')).toHaveText('B only');
    await expect(editorB.locator('.cm-content .pt-bold')).toHaveCount(0);
  });
  test('mixed selection applies bold uniformly and toggles it off uniformly', async ({
    page,
  }) => {
    await gotoProgress(page);
    await createProject(page, 'Mixed Selection');
    const editor = await typeEntry(page, 'abcd');
    await editor.locator('.cm-content').click();
    await page.keyboard.press('Home');
    await page.keyboard.press('Shift+ArrowRight');
    await page.keyboard.press('Shift+ArrowRight');
    await editor.getByTestId('pt-bold').click();
    await expect(editor.locator('.cm-content .pt-bold')).toHaveText('ab');
    await selectAll(page, editor);
    await editor.getByTestId('pt-bold').click();
    await expect(editor.locator('.cm-content .pt-bold')).toHaveText('abcd');
    await editor.getByTestId('pt-bold').click();
    await expect(editor.locator('.cm-content .pt-bold')).toHaveCount(0);
  });
});
