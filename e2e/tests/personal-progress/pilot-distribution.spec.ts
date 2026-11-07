import { test, expect } from '../../fixtures/test.fixture';
import { Page, Locator } from '@playwright/test';
import {
  exportPersonalBackup,
  restorePersonalBackup,
} from '../../utils/personal-backup-helpers';
import { readFileSync, writeFileSync } from 'node:fs';

const go = async (page: Page, route: string, id: string): Promise<void> => {
  await page.evaluate((r) => {
    location.hash = '/personal-' + r;
  }, route);
  await expect(page.getByTestId(id)).toHaveCount(1);
  await expect(page.getByTestId(id)).toBeVisible();
};
const row = (page: Page, name: string): Locator =>
  page
    .getByTestId('pp-project-row')
    .filter({ has: page.getByTestId('pp-project-title').filter({ hasText: name }) });
const save = async (page: Page, id = 'pp-status'): Promise<void> => {
  await expect(page.getByTestId(id)).toHaveAttribute('data-save-state', 'saved');
};
const project = async (page: Page): Promise<void> => {
  await go(page, 'progress', 'pp-page');
  if (!(await page.getByTestId('pp-new-project-input').isVisible())) {
    await page.getByTestId('pp-show-create').click();
  }
  await page.getByTestId('pp-new-project-input').fill('顺序验证');
  await page.getByTestId('pp-create-project').click();
  await save(page);
};
const append = async (page: Page, title: string): Promise<void> => {
  await row(page, '顺序验证').getByTestId('pp-append-step').click();
  await page.getByTestId('pp-insert-input').fill(title);
  await page.getByTestId('pp-insert-save').click();
  await expect(page.getByTestId('pp-insert-input')).toBeHidden();
  await save(page);
};

test('both undo entries preserve strict reverse order after reloading', async ({
  page,
}) => {
  await project(page);
  for (const n of ['一步', '二步', '三步']) await append(page, n);
  for (let n = 0; n < 3; n++) {
    await row(page, '顺序验证').getByTestId('pp-complete-step').first().click();
    await expect(row(page, '顺序验证').getByTestId('pp-step-title')).toHaveCount(2 - n);
    await save(page);
  }
  await page.reload();
  await expect(page.getByTestId('pp-page')).toBeVisible();
  await row(page, '顺序验证').getByTestId('pp-project-title').click();
  await expect(row(page, '顺序验证').getByTestId('pp-undo-entry')).toHaveCount(1);
  await expect(
    row(page, '顺序验证')
      .getByTestId('pp-entry')
      .filter({ hasText: '三步' })
      .getByTestId('pp-undo-entry'),
  ).toBeVisible();
  await row(page, '顺序验证').getByTestId('pp-undo-entry').click();
  await save(page);
  await expect(row(page, '顺序验证').getByTestId('pp-step-title')).toHaveText(['三步']);
  await row(page, '顺序验证').getByTestId('pp-undo-entry').click();
  await save(page);
  await expect(row(page, '顺序验证').getByTestId('pp-step-title')).toHaveText([
    '二步',
    '三步',
  ]);
  await row(page, '顺序验证').getByTestId('pp-undo-entry').click();
  await save(page);
  await expect(row(page, '顺序验证').getByTestId('pp-step-title')).toHaveText([
    '一步',
    '二步',
    '三步',
  ]);
  await expect(row(page, '顺序验证').getByTestId('pp-undo-entry')).toHaveCount(0);
});

test('a historical completion remains undoable after restore', async ({ page }) => {
  await project(page);
  await append(page, '过去完成');
  await row(page, '顺序验证').getByTestId('pp-complete-step').click();
  await save(page);
  await expect(row(page, '顺序验证').getByTestId('pp-entry-body')).toContainText(
    '过去完成',
  );
  await expect(row(page, '顺序验证').getByTestId('pp-undo-entry')).toHaveCount(1);
  const download = page.waitForEvent('download');
  await exportPersonalBackup(page);
  const file = test.info().outputPath('history.json');
  await (await download).saveAs(file);
  const backup = JSON.parse(readFileSync(file, 'utf8'));
  for (const task of Object.values(backup.data.task.entities) as {
    personalProgress?: { entries: { recordDay: string }[] };
  }[])
    for (const entry of task.personalProgress?.entries || [])
      entry.recordDay = '2025-01-01';
  writeFileSync(file, JSON.stringify(backup));
  page.once('dialog', (d) => d.accept());
  await restorePersonalBackup(page, file);
  await row(page, '顺序验证').getByTestId('pp-project-title').click();
  await expect(row(page, '顺序验证').getByTestId('pp-undo-entry')).toHaveCount(1);
  await row(page, '顺序验证').getByTestId('pp-undo-entry').click();
  await save(page);
  await expect(row(page, '顺序验证').getByTestId('pp-step-title')).toHaveText([
    '过去完成',
  ]);
});

test('routine rename and trash restore keep records and do not offer project scheduling', async ({
  page,
}) => {
  await go(page, 'routine', 'pr-page');
  await page.getByTestId('pr-new-item-title').fill('长期记录');
  await page.getByTestId('pr-create-item').click();
  await save(page, 'pr-status');
  await page.getByTestId('pr-record').first().click();
  await page.getByTestId('pr-entry-body').fill('改动原因与观察');
  await page.getByTestId('pr-save-entry').click();
  await save(page, 'pr-status');
  const item = page.getByTestId('pr-item-row');
  await item.getByTestId('pm-menu').click();
  await expect(page.getByTestId('pm-open-plan')).toHaveCount(0);
  await page.getByTestId('pm-open-rename').click();
  await page.getByTestId('pm-rename-title').fill('长期记录改名');
  await page.getByTestId('pm-rename-save').click();
  await expect(page.getByRole('dialog')).toBeHidden();
  await save(page, 'pr-status');
  await expect(item).toContainText('长期记录改名');
  await item.getByTestId('pm-menu').click();
  await page.getByTestId('pm-trash').click();
  await page.getByTestId('pm-confirm-trash').click();
  await expect(item).toHaveCount(0);
  await go(page, 'archive', 'pa-page');
  await page.getByTestId('pa-trash-tab').click();
  const trash = page.getByTestId('pa-trash-card').filter({ hasText: '长期记录改名' });
  await trash.getByTestId('pa-restore-deleted').click();
  await save(page, 'pa-status');
  await expect(trash).toHaveCount(0);
  await go(page, 'routine', 'pr-page');
  await expect(page.getByTestId('pr-item-row')).toContainText('长期记录改名');
  await expect(page.getByTestId('pr-entry')).toContainText('改动原因与观察');
  await page.reload();
  await expect(page.getByTestId('pr-entry')).toContainText('改动原因与观察');
});

test('cancelling a routine rename leaves a dirty record intact', async ({ page }) => {
  await go(page, 'routine', 'pr-page');
  await page.getByTestId('pr-new-item-title').fill('草稿保护');
  await page.getByTestId('pr-create-item').click();
  await save(page, 'pr-status');
  await page.getByTestId('pr-record').first().click();
  await page.getByTestId('pr-entry-body').fill('不要丢掉这段');
  await page.getByTestId('pm-menu').click();
  await page.getByTestId('pm-open-rename').click();
  await page.getByTestId('pm-rename-title').fill('另一个名字');
  await page.getByTestId('pm-rename-save').click();
  await page.getByTestId('pr-draft-continue').click();
  await expect(page.getByTestId('pr-item-row')).toContainText('草稿保护');
  await expect(page.getByTestId('pr-entry-body')).toHaveText('不要丢掉这段');
});
