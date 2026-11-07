import { readFileSync } from 'node:fs';
import { expect, test } from '../../fixtures/test.fixture';
import { Page } from '@playwright/test';

const gotoProgress = async (page: Page): Promise<void> => {
  await page.goto('/#/personal-progress');
  await page.reload();
  await page.getByTestId('pp-page').waitFor({ timeout: 30_000 });
};

const gotoBackup = async (page: Page): Promise<void> => {
  await page.goto(`/?folder-backup=${Date.now()}#/personal-backup`);
  await page.getByTestId('pb-page').waitFor({ timeout: 30_000 });
};

test('exports and restores folders with their project assignments', async ({ page }) => {
  await gotoProgress(page);

  await page.getByTestId('pp-create-folder').click();
  const rename = page.getByTestId('pp-folder-rename-input');
  await rename.fill('备份文件夹');
  await rename.press('Enter');
  await expect(
    page.getByTestId('pp-folder-card').filter({ hasText: '备份文件夹' }),
  ).toBeVisible();

  await page.getByTestId('pp-folder-card').filter({ hasText: '备份文件夹' }).click();
  await page.getByTestId('pp-show-create').click();
  await page.getByTestId('pp-new-project-input').fill('文件夹内项目');
  await page.getByTestId('pp-create-project').click();
  await expect(page.getByTestId('pp-status')).toHaveAttribute('data-save-state', 'saved');
  await expect(
    page.getByTestId('pp-project-row').filter({ hasText: '文件夹内项目' }),
  ).toBeVisible();
  await page.getByTestId('pp-folder-back').click();

  await gotoBackup(page);
  const downloadPromise = page.waitForEvent('download');
  await page.getByTestId('pb-export').click();
  const download = await downloadPromise;
  const target = test.info().outputPath('folder-backup.json');
  await download.saveAs(target);
  await expect(page.getByTestId('pb-status')).toHaveAttribute('data-save-state', 'saved');

  const backup = JSON.parse(readFileSync(target, 'utf8')) as {
    personalFolders?: {
      folders: Array<{ name: string }>;
      assignments: Record<string, string>;
    };
  };
  expect(backup.personalFolders?.folders.map((folder) => folder.name)).toContain(
    '备份文件夹',
  );
  expect(Object.keys(backup.personalFolders?.assignments ?? {})).toHaveLength(1);

  await gotoProgress(page);
  await page.getByTestId('pp-folder-card').filter({ hasText: '备份文件夹' }).click();
  await page.getByTestId('pp-folder-page-expand').click();
  page.once('dialog', (dialog) => dialog.accept());
  await page
    .locator('.pp-folder-page-actions button')
    .filter({ hasText: '删除' })
    .click();
  await expect(page.getByTestId('pp-folder-card')).toHaveCount(0);
  await expect(
    page.getByTestId('pp-project-row').filter({ hasText: '文件夹内项目' }),
  ).toBeVisible();

  await page.goto(`/?folder-restore=${Date.now()}#/personal-backup`);
  await page.getByTestId('pb-page').waitFor({ timeout: 30_000 });
  page.once('dialog', (dialog) => dialog.accept());
  await page.getByTestId('pb-restore-input').setInputFiles(target);
  await expect(page.getByTestId('pb-status')).toHaveAttribute(
    'data-save-state',
    'restored',
    { timeout: 30_000 },
  );
  await gotoProgress(page);
  await expect(
    page.getByTestId('pp-folder-card').filter({ hasText: '备份文件夹' }),
  ).toBeVisible();
  await page.getByTestId('pp-folder-card').filter({ hasText: '备份文件夹' }).click();
  await expect(
    page.getByTestId('pp-project-row').filter({ hasText: '文件夹内项目' }),
  ).toBeVisible();
});
