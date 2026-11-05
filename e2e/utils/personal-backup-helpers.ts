import { expect, Page } from '@playwright/test';

const openBackup = async (page: Page): Promise<string> => {
  const route = await page.evaluate(() => location.hash);
  await page.evaluate(() => {
    location.hash = '/personal-backup';
  });
  const previousPage = route.includes('personal-routine') ? 'pr-page' : 'pp-page';
  await expect(page.getByTestId(previousPage)).toHaveCount(0, { timeout: 30_000 });
  await expect(page.getByTestId('pb-page')).toHaveCount(1, { timeout: 30_000 });
  await expect(page.getByTestId('pb-page')).toBeVisible({ timeout: 30_000 });
  return route;
};

const returnTo = async (page: Page, route: string): Promise<void> => {
  await page.evaluate((hash) => {
    location.hash = hash;
  }, route);
  const id = route.includes('personal-routine') ? 'pr-page' : 'pp-page';
  await expect(page.getByTestId('pb-page')).toHaveCount(0, { timeout: 30_000 });
  // Full import can briefly mount the restored outlet alongside the outgoing
  // route. Wait for that transition to settle, rather than choosing a copy.
  await expect(page.getByTestId(id)).toHaveCount(1, { timeout: 30_000 });
  await expect(page.getByTestId(id)).toBeVisible({ timeout: 30_000 });
};

// Use the same central backup entry as the shipped UI. Callers still inspect
// exported files and restored records; failures are asserted before returning.
export const exportPersonalBackup = async (page: Page): Promise<void> => {
  const route = await openBackup(page);
  await page.getByTestId('pb-export').click();
  await expect(page.getByTestId('pb-status')).toHaveAttribute(
    'data-save-state',
    'saved',
    { timeout: 30_000 },
  );
  await returnTo(page, route);
};

export const restorePersonalBackup = async (
  page: Page,
  file: string,
  outcome: 'restored' | 'error' = 'restored',
): Promise<void> => {
  const route = await openBackup(page);
  await page.getByTestId('pb-restore-input').setInputFiles(file);
  await expect(page.getByTestId('pb-status')).toHaveAttribute(
    'data-save-state',
    outcome,
    { timeout: 30_000 },
  );
  await returnTo(page, route);
};
