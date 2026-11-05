import { expect, test } from '../../fixtures/test.fixture';

test('saves an advance reminder and permanently deletes only after confirmation', async ({
  page,
}) => {
  await page.goto('/#/personal-memo');
  await expect(page.getByTestId('memo-page')).toBeVisible();
  await page.getByTestId('memo-new').click();
  await page.getByTestId('memo-input').fill('需要清理的备忘');
  await page.getByTestId('memo-reminder-enabled').check();
  await page.getByTestId('memo-time').fill('2027-02-01T10:00');
  await page.getByTestId('memo-advance').selectOption({ label: '15 分钟' });
  await page.getByTestId('memo-save').click();
  const card = page.getByTestId('memo-card').filter({ hasText: '需要清理的备忘' });
  await expect(card).toBeVisible();
  await expect(page.getByTestId('memo-input')).toHaveCount(0);
  await card.getByRole('button', { name: '编辑' }).click();
  await expect(page.getByTestId('memo-advance').locator('option:checked')).toHaveText(
    '15 分钟',
  );
  await page.getByTestId('memo-close').click();
  page.once('dialog', (dialog) => dialog.accept());
  await card.getByRole('button', { name: '删除', exact: true }).click();
  await expect(card).toHaveCount(0);
  await page.getByRole('button', { name: '回收站', exact: true }).click();
  await expect(card).toBeVisible();
  page.once('dialog', (dialog) => dialog.dismiss());
  await card.getByTestId('memo-delete-forever').click();
  await expect(card).toBeVisible();
  page.once('dialog', (dialog) => dialog.accept());
  await card.getByTestId('memo-delete-forever').click();
  await expect(card).toHaveCount(0);
  await page.reload();
  await expect(page.getByTestId('memo-page')).toBeVisible();
  await page.getByRole('button', { name: '回收站', exact: true }).click();
  await expect(card).toHaveCount(0);
});

test('closing a memo editor protects an unsaved draft', async ({ page }) => {
  await page.goto('/#/personal-memo');
  await page.getByTestId('memo-new').click();
  await page.getByTestId('memo-input').fill('尚未保存的备忘');
  page.once('dialog', (dialog) => dialog.dismiss());
  await page.getByTestId('memo-close').click();
  await expect(page.getByTestId('memo-input')).toHaveText('尚未保存的备忘');
  page.once('dialog', (dialog) => dialog.accept());
  await page.getByTestId('memo-close').click();
  await expect(page.getByTestId('memo-input')).toHaveCount(0);
});
