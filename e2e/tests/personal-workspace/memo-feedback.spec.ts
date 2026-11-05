import { expect, test } from '../../fixtures/test.fixture';

test('classifies selected project in progress and creates routines from the top', async ({
  page,
}) => {
  await page.goto('/#/personal-progress');
  await expect(page.getByTestId('pp-page')).toBeVisible();
  if (!(await page.getByTestId('pp-new-project-input').isVisible())) {
    await page.getByTestId('pp-show-create').click();
  }
  await page.getByTestId('pp-new-project-input').fill('分类联动测试');
  await page.getByTestId('pp-create-project').click();
  await expect(
    page.getByTestId('pp-project-row').filter({ hasText: '分类联动测试' }),
  ).toBeVisible();
  await page.getByTestId('pp-quadrant').selectOption('urgent-important');
  await expect(page.getByTestId('pp-status')).toHaveAttribute('data-save-state', 'saved');
  await page.goto('/#/personal-overview');
  await expect(
    page.getByTestId('po-quadrant').filter({ hasText: '分类联动测试' }),
  ).toHaveAttribute('data-quadrant', 'urgent-important');
  await page.goto('/#/personal-routine');
  await expect(page.getByTestId('pr-page')).toBeVisible();
  expect(
    await page
      .getByTestId('pr-new-item')
      .evaluate(
        (el) =>
          el.compareDocumentPosition(document.querySelector('.pr-toolbar')!) &
          Node.DOCUMENT_POSITION_FOLLOWING,
      ),
  ).not.toBe(0);
  await page.getByTestId('pr-new-item-title').fill('顶部常态');
  await page.getByTestId('pr-create-item').click();
  await expect(
    page.getByTestId('pr-item-row').filter({ hasText: '顶部常态' }),
  ).toBeVisible();
});

test('memo rich text and overdue time survive reload and complete backup restore', async ({
  page,
  isolatedContext,
}) => {
  await page.goto('/#/personal-memo');
  await expect(page.getByTestId('memo-page')).toBeVisible();
  await page.getByTestId('memo-new').click();
  await isolatedContext.setOffline(true);
  const editor = page
    .getByTestId('memo-input')
    .locator('xpath=ancestor::personal-rich-text-editor[1]');
  await editor.locator('.cm-content').click();
  await page.keyboard.insertText('检查广告效果');
  await page.keyboard.press('Control+A');
  await editor.getByTestId('pt-bold').click();
  await editor.getByTestId('pt-color-toggle').click();
  await editor.getByTestId('pt-color-green').click();
  await page.getByTestId('memo-reminder-enabled').check();
  await page.getByTestId('memo-time').fill('2020-01-01T09:30');
  await page.getByTestId('memo-save').click();
  const card = page.getByTestId('memo-card');
  await expect(card.locator('.pt-bold.pt-color-green')).toHaveText('检查广告效果');
  await expect(card.locator('time')).toHaveClass(/memo-due/);
  await expect(page.getByTestId('memo-input')).toHaveCount(0);
  await isolatedContext.setOffline(false);
  await page.reload();
  await expect(
    page.getByTestId('memo-card').locator('.pt-bold.pt-color-green'),
  ).toHaveText('检查广告效果');
  await page.goto('/#/personal-backup');
  await expect(page.getByTestId('pb-page')).toBeVisible();
  const download = page.waitForEvent('download');
  await page.getByTestId('pb-export').click();
  const file = test.info().outputPath('memo-backup.json');
  await (await download).saveAs(file);
  page.once('dialog', (dialog) => dialog.accept());
  await page.getByTestId('pb-restore-input').setInputFiles(file);
  await expect(page.getByTestId('pb-status')).toHaveAttribute(
    'data-save-state',
    'restored',
  );
  await page.goto('/#/personal-memo');
  await expect(
    page.getByTestId('memo-card').locator('.pt-bold.pt-color-green'),
  ).toHaveText('检查广告效果');
  await expect(page.getByTestId('memo-card').locator('time')).toHaveClass(/memo-due/);
});
