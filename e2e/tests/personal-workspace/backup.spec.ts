import {
  exportPersonalBackup,
  restorePersonalBackup,
} from '../../utils/personal-backup-helpers';
import { readFileSync, writeFileSync } from 'node:fs';
import { expect, test } from '../../fixtures/test.fixture';
import { Page } from '@playwright/test';

const gotoProgress = async (page: Page): Promise<void> => {
  await page.goto('/#/personal-progress');
  await page.reload();
  await page.getByTestId('pp-page').waitFor({ timeout: 30_000 });
};

const gotoBackup = async (page: Page): Promise<void> => {
  // A unique document URL makes this a cold entry. Hash navigation followed
  // immediately by reload can reload the previous route before routing settles.
  await page.goto(`/?backup-review=${Date.now()}#/personal-backup`);
  await page.getByTestId('pb-page').waitFor({ timeout: 30_000 });
};

const createProject = async (page: Page, title: string): Promise<void> => {
  if (!(await page.getByTestId('pp-new-project-input').isVisible())) {
    await page.getByTestId('pp-show-create').click();
  }
  await page.getByTestId('pp-new-project-input').fill(title);
  await page.getByTestId('pp-create-project').click();
  await expect(page.getByTestId('pp-status')).toHaveAttribute('data-save-state', 'saved');
};

test.describe('personal backup page', () => {
  test('history can be edited after restoring a backup', async ({ page }) => {
    await gotoProgress(page);
    await createProject(page, 'History permission');
    if (!(await page.getByTestId('pp-entry-day').isVisible())) {
      await page.getByTestId('pp-backfill').click();
    }
    await page.getByTestId('pp-entry-day').fill('2025-01-01');
    if (!(await page.getByTestId('pp-entry-input').isVisible())) {
      await page.getByTestId('pp-backfill').click();
    }
    await page.getByTestId('pp-entry-input').fill('History record');
    await page.getByTestId('pp-add-entry').click();
    await expect(page.getByTestId('pp-status')).toHaveAttribute(
      'data-save-state',
      'saved',
    );
    const downloaded = page.waitForEvent('download');
    await exportPersonalBackup(page);
    const file = test.info().outputPath('history-permission.json');
    await (await downloaded).saveAs(file);
    page.once('dialog', (dialog) => dialog.accept());
    await restorePersonalBackup(page, file);
    await page
      .getByTestId('pp-entry-body')
      .filter({ hasText: 'History record' })
      .dblclick();
    await page.getByTestId('pp-entry-edit-input').fill('History changed');
    await page.getByTestId('pp-entry-edit-save').click();
    await expect(page.getByTestId('pp-entry-body')).toContainText('History changed');
  });

  test('exports a complete browser backup and restores it', async ({ page }) => {
    await gotoProgress(page);
    await createProject(page, 'Backup browser project');
    if (!(await page.getByTestId('pp-entry-input').isVisible())) {
      await page.getByTestId('pp-backfill').click();
    }
    await page.getByTestId('pp-entry-input').fill('Browser backup record');
    await page.getByTestId('pp-add-entry').click();
    await expect(page.getByTestId('pp-status')).toHaveAttribute(
      'data-save-state',
      'saved',
    );
    await gotoBackup(page);

    const downloadPromise = page.waitForEvent('download');
    await page.getByTestId('pb-export').click();
    const download = await downloadPromise;
    const target = test.info().outputPath('browser-backup.json');
    await download.saveAs(target);
    await expect(page.getByTestId('pb-status')).toHaveAttribute(
      'data-save-state',
      'saved',
    );
    const backup = JSON.parse(readFileSync(target, 'utf8')) as {
      data: { project: { entities: Record<string, { title: string }> } };
    };
    expect(
      Object.values(backup.data.project.entities).some(
        (p) => p.title === 'Backup browser project',
      ),
    ).toBeTruthy();

    await page.getByTestId('pb-location').locator('summary').click();
    await expect(page.getByTestId('pb-data-path')).toBeVisible();
    page.once('dialog', (dialog) => dialog.accept());
    await page.getByTestId('pb-restore-input').setInputFiles(target);
    await expect(page.getByTestId('pb-status')).toHaveAttribute(
      'data-save-state',
      'restored',
    );
    await gotoProgress(page);
    await expect(
      page.getByTestId('pp-project-row').filter({ hasText: 'Backup browser project' }),
    ).toBeVisible();
  });

  test('bad backup and cancelled restore leave good data unchanged', async ({ page }) => {
    await gotoProgress(page);
    await createProject(page, 'Keep good browser data');
    await gotoBackup(page);
    const bad = test.info().outputPath('bad.json');
    writeFileSync(bad, '{"broken":', 'utf8');
    page.once('dialog', (dialog) => dialog.accept());
    await page.getByTestId('pb-restore-input').setInputFiles(bad);
    await expect(page.getByTestId('pb-status')).toHaveAttribute(
      'data-save-state',
      'error',
    );
    await gotoProgress(page);
    await expect(
      page.getByTestId('pp-project-row').filter({ hasText: 'Keep good browser data' }),
    ).toBeVisible();
    await gotoBackup(page);
    page.once('dialog', (dialog) => dialog.dismiss());
    await page.getByTestId('pb-restore-input').setInputFiles(bad);
    await expect(page.getByTestId('pb-status')).toHaveAttribute(
      'data-save-state',
      'idle',
    );
  });
});
