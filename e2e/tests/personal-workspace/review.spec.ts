import { expect, test } from '../../fixtures/test.fixture';
import { Page } from '@playwright/test';

const gotoReview = async (page: Page): Promise<void> => {
  await page.goto('/#/personal-review');
  await page.reload();
  await page.getByTestId('personal-review-page').waitFor({ timeout: 30_000 });
};

test.describe('personal review page', () => {
  test('shows week and month views without changing data', async ({ page }) => {
    await gotoReview(page);
    await expect(page.getByRole('heading', { name: '复盘' })).toBeVisible();
    await expect(page.getByTestId('personal-review-week')).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await page.getByTestId('personal-review-month').click();
    await expect(page.getByTestId('personal-review-month')).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await expect(page.getByText('每日记录')).toBeVisible();
  });

  test('can move to a previous period and return to the current one', async ({
    page,
  }) => {
    await gotoReview(page);
    const next = page.getByTestId('personal-review-next');
    const prev = page.getByTestId('personal-review-prev');
    const current = page.getByTestId('personal-review-current');
    await expect(next).toBeDisabled();
    await expect(current).toBeDisabled();

    await prev.click();
    await expect(next).toBeEnabled();
    await expect(current).toBeEnabled();
    await current.click();

    await expect(next).toBeDisabled();
    await expect(current).toBeDisabled();
  });

  test('shortcut guide is visible in settings', async ({ page }) => {
    await page.goto('/#/personal-settings');
    await page.reload();
    await page.getByTestId('ps-page').waitFor({ timeout: 30_000 });
    const guide = page.getByTestId('ps-shortcuts');
    await expect(guide).toBeVisible();
    await expect(guide).toContainText('打开搜索');
    await expect(guide).toContainText('Ctrl');
    await expect(guide).toContainText('快记');
  });
});
