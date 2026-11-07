import { expect, test } from '../../fixtures/test.fixture';
import { Page } from '@playwright/test';

const gotoProgress = async (page: Page): Promise<void> => {
  await page.goto('/#/personal-progress');
  await page.reload();
  await page.getByTestId('pp-page').waitFor({ timeout: 30_000 });
};

const gotoSearch = async (page: Page): Promise<void> => {
  await page.evaluate(() => {
    location.hash = '/personal-search';
  });
  await page.getByTestId('personal-search-page').waitFor({ timeout: 30_000 });
};

const createProject = async (page: Page, title: string): Promise<void> => {
  if (!(await page.getByTestId('pp-new-project-input').isVisible())) {
    await page.getByTestId('pp-show-create').click();
  }
  await page.getByTestId('pp-new-project-input').fill(title);
  await page.getByTestId('pp-create-project').click();
  await expect(page.getByTestId('pp-status')).toHaveAttribute('data-save-state', 'saved');
};

test.describe('personal search page', () => {
  test('Ctrl+K opens search and a project result opens that project', async ({
    page,
  }) => {
    await gotoProgress(page);
    const title = `Search project ${Date.now()}`;
    await createProject(page, title);

    await page.keyboard.press('Control+K');
    await expect(page.getByTestId('personal-search-page')).toBeVisible();
    await page.getByTestId('personal-search-input').fill(title);

    const result = page
      .getByTestId('personal-search-result')
      .filter({ hasText: title })
      .first();
    await expect(result).toBeVisible();
    await result.click();

    await expect(page.getByTestId('pp-page')).toBeVisible();
    await expect(
      page.getByTestId('pp-project-row').filter({ hasText: title }),
    ).toHaveClass(/is-selected/);
  });

  test('record result expands inline and opens its project explicitly', async ({
    page,
  }) => {
    await gotoProgress(page);
    const title = `Record project ${Date.now()}`;
    const body = `Record body ${Date.now()}`;
    await createProject(page, title);
    await page
      .getByTestId('pp-project-row')
      .filter({ hasText: title })
      .getByTestId('pp-project-title')
      .click();

    if (!(await page.getByTestId('pp-entry-day').isVisible())) {
      await page.getByTestId('pp-backfill').click();
    }
    await expect(page.getByTestId('pp-entry-input')).toBeVisible();
    await page.getByTestId('pp-entry-input').fill(body);
    await page.getByTestId('pp-add-entry').click();
    await expect(page.getByTestId('pp-status')).toHaveAttribute(
      'data-save-state',
      'saved',
    );

    await gotoSearch(page);
    await page.getByTestId('personal-search-input').fill(body);
    const result = page
      .getByTestId('personal-search-result')
      .filter({ hasText: body })
      .first();
    await expect(result).toBeVisible();
    await result.click();

    const detail = page.getByTestId('personal-search-record-detail');
    await expect(detail).toBeVisible();
    await expect(detail).toContainText(body);
    await detail.getByText('打开项目', { exact: false }).click();
    await expect(page.getByTestId('pp-page')).toBeVisible();
  });
});
