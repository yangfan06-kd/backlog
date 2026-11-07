import { expect, test } from '../../fixtures/test.fixture';
import { Page } from '@playwright/test';

const gotoProgress = async (page: Page): Promise<void> => {
  await page.goto('/#/personal-progress');
  await page.reload();
  await page.getByTestId('pp-page').waitFor({ timeout: 30_000 });
};

const createProject = async (page: Page, title: string): Promise<void> => {
  if (!(await page.getByTestId('pp-new-project-input').isVisible())) {
    await page.getByTestId('pp-show-create').click();
  }
  await page.getByTestId('pp-new-project-input').fill(title);
  await page.getByTestId('pp-create-project').click();
  await expect(page.getByTestId('pp-status')).toHaveAttribute('data-save-state', 'saved');
};

test.describe('personal progress responsive columns', () => {
  test('gives the date column the extra width and keeps remaining steps stable', async ({
    page,
  }) => {
    await gotoProgress(page);
    await createProject(page, `Responsive ${Date.now()}`);
    await expect(page.locator('.pp-board')).toBeVisible();

    if (!(await page.getByTestId('pp-entry-day').isVisible())) {
      await page.getByTestId('pp-backfill').click();
    }
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const yesterdayDay = [
      yesterday.getFullYear(),
      String(yesterday.getMonth() + 1).padStart(2, '0'),
      String(yesterday.getDate()).padStart(2, '0'),
    ].join('-');
    await page.getByTestId('pp-entry-day').fill(yesterdayDay);
    await page.getByTestId('pp-entry-input').fill('past record');
    await page.getByTestId('pp-add-entry').click();
    await expect(page.getByTestId('pp-status')).toHaveAttribute(
      'data-save-state',
      'saved',
    );
    await expect(page.getByTestId('pp-date').first()).toBeVisible();

    const measure = async (): Promise<{ date: number; steps: number }> => {
      const date = await page
        .locator('.pp-board thead th.pp-today-col')
        .evaluate((element) => element.getBoundingClientRect().width);
      const steps = await page
        .locator('.pp-board thead th.pp-steps-col')
        .evaluate((element) => element.getBoundingClientRect().width);
      return { date, steps };
    };

    await page.setViewportSize({ width: 1000, height: 800 });
    const narrow = await measure();
    await page.setViewportSize({ width: 1500, height: 800 });
    const wide = await measure();

    expect(wide.date).toBeGreaterThan(narrow.date + 100);
    expect(wide.steps).toBeLessThan(280);

    await page.getByTestId('pp-expand-records').click();
    await expect(page.locator('.pp-board')).toHaveClass(/is-record-expanded/);
    await expect(page.getByTestId('pp-rail-restore')).toBeVisible();
    await expect(page.locator('.pp-board thead th.pp-steps-col')).toBeHidden();
    await page.getByTestId('pp-rail-restore').click();
    await expect(page.locator('.pp-board')).not.toHaveClass(/is-record-expanded/);
    await expect(page.locator('.pp-board thead th.pp-steps-col')).toBeVisible();
  });
});
