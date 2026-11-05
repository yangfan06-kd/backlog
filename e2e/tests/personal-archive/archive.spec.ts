import {
  exportPersonalBackup,
  restorePersonalBackup,
} from '../../utils/personal-backup-helpers';
import { expect, test } from '../../fixtures/test.fixture';
import { skipOnboardingForE2E, waitForAngularStability } from '../../utils/waits';
import type { Locator, Page } from '@playwright/test';
import * as fs from 'node:fs';
import * as path from 'node:path';

const ppStatus = (page: Page): Locator => page.getByTestId('pp-status');
const paStatus = (page: Page): Locator => page.getByTestId('pa-status');
const card = (page: Page, name: string): Locator =>
  page.getByTestId('pa-card').filter({ hasText: name });

const gotoProgress = async (page: Page): Promise<void> => {
  await page.locator('.nav-link').filter({ hasText: '项目进展' }).first().click();
  await expect(page.getByTestId('pp-page')).toBeVisible({ timeout: 30_000 });
};

const gotoOverview = async (page: Page): Promise<void> => {
  await page.locator('.nav-link').filter({ hasText: '四象限总览' }).first().click();
  await expect(page.getByTestId('po-page')).toBeVisible({ timeout: 30_000 });
};

const gotoArchive = async (page: Page): Promise<void> => {
  await page.locator('.nav-link').filter({ hasText: '归档与回收站' }).first().click();
  await expect(page.getByTestId('pa-page')).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId('pa-loading')).toHaveCount(0, { timeout: 30_000 });
};

const createProject = async (page: Page, name: string): Promise<void> => {
  if (!(await page.getByTestId('pp-new-project-input').isVisible())) {
    await page.getByTestId('pp-show-create').click();
  }
  await page.getByTestId('pp-new-project-input').fill(name);
  await page.getByTestId('pp-create-project').click();
  await expect(page.getByTestId('pp-project-row').filter({ hasText: name })).toBeVisible({
    timeout: 20_000,
  });
  await expect(ppStatus(page)).toHaveAttribute('data-save-state', 'saved');
};

const selectProject = async (page: Page, name: string): Promise<void> => {
  const row = page.getByTestId('pp-project-row').filter({ hasText: name });
  if (await row.evaluate((el) => el.classList.contains('is-selected'))) return;
  await row.getByTestId('pp-project-title').click();
};

const appendStep = async (page: Page, project: string, title: string): Promise<void> => {
  const row = page.getByTestId('pp-project-row').filter({ hasText: project });
  await row.getByTestId('pp-append-step').click();
  await page.getByTestId('pp-insert-input').fill(title);
  await page.getByTestId('pp-insert-save').click();
  await expect(
    row.locator(`[data-testid="pp-step-title"][data-step-title="${title}"]`),
  ).toBeVisible();
  await expect(ppStatus(page)).toHaveAttribute('data-save-state', 'saved');
};

const addManualEntry = async (page: Page, body: string): Promise<void> => {
  if (!(await page.getByTestId('pp-entry-input').isVisible())) {
    await page.getByTestId('pp-backfill').click();
  }
  await page.getByTestId('pp-entry-input').fill(body);
  await page.getByTestId('pp-add-entry').click();
  await expect(ppStatus(page)).toHaveAttribute('data-save-state', 'saved');
};

const addManualEntryOn = async (page: Page, day: string, body: string): Promise<void> => {
  if (!(await page.getByTestId('pp-entry-day').isVisible())) {
    await page.getByTestId('pp-backfill').click();
  }
  const date = page.getByTestId('pp-entry-day');
  await date.fill(day);
  await date.press('Tab');
  await addManualEntry(page, body);
};

const offsetDay = (day: string, offset: number): string => {
  const [year, month, date] = day.split('-').map(Number);
  const value = new Date(year, month - 1, date + offset);
  return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(
    2,
    '0',
  )}-${String(value.getDate()).padStart(2, '0')}`;
};

const finishProject = async (page: Page, name: string, accept = true): Promise<void> => {
  await selectProject(page, name);
  page.once('dialog', (dialog) => (accept ? dialog.accept() : dialog.dismiss()));
  await page
    .locator('[data-testid="pp-project-row"].is-selected')
    .getByTestId('pp-finish-project-row')
    .click();
  if (accept) {
    await expect(ppStatus(page)).toHaveAttribute('data-save-state', 'saved');
  }
};

test.describe('personal project archive', () => {
  test('uses the post-save remaining count in the finish confirmation', async ({
    page,
  }) => {
    await gotoProgress(page);
    await createProject(page, 'Insert before finish');
    await page.getByTestId('pp-append-step').click();
    await page.getByTestId('pp-insert-input').fill('New remaining step');
    let confirmation = '';
    page.once('dialog', async (dialog) => {
      confirmation = dialog.message();
      await dialog.accept();
    });
    await page
      .locator('[data-testid="pp-project-row"].is-selected')
      .getByTestId('pp-finish-project-row')
      .click();
    await expect(page.getByTestId('pp-draft-prompt')).toBeVisible();
    await page.getByTestId('pp-draft-save').click();
    await expect(page.getByTestId('pp-view-archive')).toBeVisible();
    expect(confirmation).toContain('剩余 1 个步骤');
  });

  test('applies the latest query after a delayed restore and shows slow persistence', async ({
    page,
  }) => {
    await gotoProgress(page);
    await createProject(page, 'Restore source');
    await finishProject(page, 'Restore source');
    await createProject(page, 'Query target');
    await finishProject(page, 'Query target');
    await gotoArchive(page);
    const targetId = await card(page, 'Query target').getAttribute('data-project-id');
    await page.evaluate(
      () =>
        new Promise<void>((acquired) => {
          void navigator.locks.request('sp_op_log', async () => {
            acquired();
            await new Promise<void>((release) => {
              (
                window as unknown as { __releaseRestoreReview: () => void }
              ).__releaseRestoreReview = release;
            });
          });
        }),
    );
    page.once('dialog', (dialog) => dialog.accept());
    await card(page, 'Restore source').getByTestId('pa-restore').click();
    await expect(paStatus(page)).toHaveAttribute('data-save-state', 'saving');
    await page.evaluate((id) => {
      location.hash = `/personal-archive?projectId=${id}`;
    }, targetId!);
    await page.waitForTimeout(16_000);
    const slowText = await paStatus(page).textContent();
    await page.evaluate(() => {
      (
        window as unknown as { __releaseRestoreReview: () => void }
      ).__releaseRestoreReview();
    });
    await expect(paStatus(page)).toHaveAttribute('data-save-state', 'saved', {
      timeout: 20_000,
    });
    await expect(card(page, 'Query target').getByTestId('pa-expand')).toHaveAttribute(
      'aria-expanded',
      'true',
    );
    expect(slowText).toContain('保存较慢');
  });

  test('finishes a project with unfinished steps, preserves data, and restores it', async ({
    page,
  }) => {
    await gotoProgress(page);
    await createProject(page, 'Archive A');
    await selectProject(page, 'Archive A');
    await appendStep(page, 'Archive A', 'Unfinished one');
    await appendStep(page, 'Archive A', 'Unfinished two');
    await addManualEntry(page, 'Manual record A');

    await gotoOverview(page);
    await expect(page.getByTestId('po-page')).toBeVisible({ timeout: 30_000 });
    const row = page.getByTestId('po-project-row').filter({ hasText: 'Archive A' });
    await row.getByTestId('po-classify').click();
    await page.getByTestId('po-quadrant-option-important').click();
    await expect(page.getByTestId('po-status')).toHaveAttribute(
      'data-save-state',
      'saved',
    );

    await gotoProgress(page);
    await selectProject(page, 'Archive A');
    page.once('dialog', (dialog) => dialog.accept());
    await page
      .locator('[data-testid="pp-project-row"].is-selected')
      .getByTestId('pp-finish-project-row')
      .click();
    await expect(ppStatus(page)).toHaveAttribute('data-save-state', 'saved');
    await expect(page.getByTestId('pp-view-archive')).toBeVisible();
    await expect(
      page.getByTestId('pp-project-row').filter({ hasText: 'Archive A' }),
    ).toHaveCount(0);

    await page.getByTestId('pp-view-archive').click();
    await expect(page.getByTestId('pa-page')).toBeVisible({ timeout: 30_000 });
    await expect(card(page, 'Archive A')).toBeVisible();
    await expect(page.getByTestId('pa-loading')).toHaveCount(0, { timeout: 30_000 });
    await expect(card(page, 'Archive A').getByTestId('pa-remaining-count')).toContainText(
      '2',
    );
    await expect(card(page, 'Archive A').getByTestId('pa-details')).toBeVisible();
    await expect(card(page, 'Archive A').getByTestId('pa-remaining-step')).toHaveCount(2);
    await expect(card(page, 'Archive A').getByTestId('pa-entry')).toContainText(
      'Manual record A',
    );

    page.once('dialog', (dialog) => dialog.accept());
    await card(page, 'Archive A').getByTestId('pa-restore').click();
    await expect(paStatus(page)).toHaveAttribute('data-save-state', 'saved');
    await expect(page.getByTestId('pa-restored')).toBeVisible();
    await expect(page.getByTestId('pa-heading')).toBeFocused();
    await expect(card(page, 'Archive A')).toHaveCount(0);
    await page.getByTestId('pa-open-progress').click();
    await expect(page.getByTestId('pp-page')).toBeVisible({ timeout: 30_000 });
    await expect(
      page.getByTestId('pp-project-row').filter({ hasText: 'Archive A' }),
    ).toBeVisible();
    await expect(
      page
        .getByTestId('pp-project-row')
        .filter({ hasText: 'Archive A' })
        .locator('[data-testid="pp-step-title"][data-step-title="Unfinished one"]'),
    ).toBeVisible();
    await expect(
      page.getByTestId('pp-entry-body').filter({ hasText: 'Manual record A' }),
    ).toBeVisible();
    await gotoOverview(page);
    await expect(
      page.locator('[data-testid="po-quadrant"][data-quadrant="important"]'),
    ).toContainText('Archive A');
  });

  test('keeps archived cards collapsed by default and expands a query target only', async ({
    page,
  }) => {
    await gotoProgress(page);
    await createProject(page, 'Collapsed A');
    await createProject(page, 'Collapsed B');
    await selectProject(page, 'Collapsed A');
    await appendStep(page, 'Collapsed A', 'A step');
    page.once('dialog', (dialog) => dialog.accept());
    await page
      .locator('[data-testid="pp-project-row"].is-selected')
      .getByTestId('pp-finish-project-row')
      .click();
    await expect(ppStatus(page)).toHaveAttribute('data-save-state', 'saved');
    await gotoArchive(page);
    const cards = page.getByTestId('pa-card');
    await expect(cards).toHaveCount(1);
    await expect(page.getByTestId('pa-details')).toHaveCount(0);

    const id = (await cards.first().getAttribute('data-project-id'))!;
    await page.goto(`/#/personal-archive?projectId=${id}`);
    await page.reload();
    await expect(page.getByTestId('pa-page')).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId('pa-loading')).toHaveCount(0, { timeout: 30_000 });
    await expect(page.getByTestId('pa-details')).toHaveCount(1);
  });

  test('handles empty archive, cancelled confirmation and empty projects explicitly', async ({
    page,
  }) => {
    await gotoArchive(page);
    await expect(page.getByTestId('pa-empty')).toBeVisible();
    await expect(page.getByTestId('pa-card')).toHaveCount(0);

    await gotoProgress(page);
    await createProject(page, 'Empty archive');
    await finishProject(page, 'Empty archive', false);
    await expect(
      page.getByTestId('pp-project-row').filter({ hasText: 'Empty archive' }),
    ).toBeVisible();
    await expect(ppStatus(page)).toHaveAttribute('data-save-state', 'saved');

    await finishProject(page, 'Empty archive');
    await page.getByTestId('pp-view-archive').click();
    await expect(page.getByTestId('pa-page')).toBeVisible({ timeout: 30_000 });
    await expect(card(page, 'Empty archive')).toBeVisible();
    await expect(
      card(page, 'Empty archive').getByTestId('pa-remaining-count'),
    ).toContainText('0');
    if (!(await card(page, 'Empty archive').getByTestId('pa-details').count())) {
      await card(page, 'Empty archive').getByTestId('pa-expand').click();
    }
    await expect(
      card(page, 'Empty archive').getByTestId('pa-history-empty'),
    ).toBeVisible();
    await expect(
      card(page, 'Empty archive').getByTestId('pa-no-remaining'),
    ).toBeVisible();
  });

  test('keeps completed and unfinished steps plus sparse history inside one card', async ({
    page,
  }) => {
    await gotoProgress(page);
    await createProject(page, 'History project');
    await selectProject(page, 'History project');
    await appendStep(page, 'History project', 'Finished step');
    await appendStep(page, 'History project', 'Remaining step');
    await page.getByTestId('pp-backfill').click();
    const today = await page.getByTestId('pp-entry-day').inputValue();
    await page.getByTestId('pp-close-manual').click();
    const past = offsetDay(today, -3);
    await page
      .getByTestId('pp-project-row')
      .filter({ hasText: 'History project' })
      .getByTestId('pp-complete-step')
      .first()
      .click();
    await expect(ppStatus(page)).toHaveAttribute('data-save-state', 'saved');
    await addManualEntry(page, 'Today manual');
    await addManualEntryOn(page, past, 'Past manual');

    await finishProject(page, 'History project');
    await page.getByTestId('pp-view-archive').click();
    await expect(page.getByTestId('pa-page')).toBeVisible({ timeout: 30_000 });
    const history = card(page, 'History project');
    await expect(history.getByTestId('pa-details')).toBeVisible();
    await expect(history.getByTestId('pa-entry')).toHaveCount(3);
    await expect(
      history.getByTestId('pa-entry').filter({ hasText: 'Finished step' }),
    ).toHaveCount(1);
    await expect(
      history.getByTestId('pa-entry').filter({ hasText: 'Today manual' }),
    ).toHaveCount(1);
    await expect(
      history.getByTestId('pa-entry').filter({ hasText: 'Past manual' }),
    ).toHaveCount(1);
    await expect(history.getByTestId('pa-day')).toHaveCount(2);
    await expect(history.getByTestId('pa-remaining-step')).toHaveText(['Remaining step']);
  });

  test('sorts cards by finish date, collapses independently and clears a restored query', async ({
    page,
  }) => {
    await gotoProgress(page);
    await createProject(page, 'Older finished');
    await finishProject(page, 'Older finished');
    await page.waitForTimeout(20);
    await createProject(page, 'Newer finished');
    await finishProject(page, 'Newer finished');
    await page.getByTestId('pp-view-archive').click();
    await expect(page.getByTestId('pa-page')).toBeVisible({ timeout: 30_000 });
    const cards = page.getByTestId('pa-card');
    await expect(cards).toHaveCount(2);
    await expect(cards.nth(0)).toContainText('Newer finished');
    await expect(cards.nth(1)).toContainText('Older finished');
    if (await cards.nth(0).getByTestId('pa-details').count()) {
      await cards.nth(0).getByTestId('pa-expand').click();
    }
    await expect(page.getByTestId('pa-details')).toHaveCount(0);
    await cards.nth(0).getByTestId('pa-expand').click();
    await expect(cards.nth(0).getByTestId('pa-details')).toHaveCount(1);
    await expect(cards.nth(1).getByTestId('pa-details')).toHaveCount(0);
    await cards.nth(1).getByTestId('pa-expand').click();
    await expect(page.getByTestId('pa-details')).toHaveCount(2);
    await cards.nth(1).getByTestId('pa-expand').click();
    await expect(cards.nth(1).getByTestId('pa-details')).toHaveCount(0);

    await expect(page).toHaveURL(/projectId=/);
    page.once('dialog', (dialog) => dialog.accept());
    await cards.nth(0).getByTestId('pa-restore').click();
    await expect(page.getByTestId('pa-restored')).toBeVisible();
    await expect(page).not.toHaveURL(/projectId=/);
    await expect(page.getByTestId('pa-restored')).toBeVisible();
  });

  test('waits for a real 16-second finish receipt instead of showing early success', async ({
    page,
  }) => {
    await gotoProgress(page);
    await createProject(page, 'Slow finish');
    await selectProject(page, 'Slow finish');
    await page.evaluate(
      () =>
        new Promise<void>((acquired) => {
          void navigator.locks.request('sp_op_log', async () => {
            acquired();
            await new Promise<void>((release) => {
              (
                window as unknown as { __releaseArchiveSlow: () => void }
              ).__releaseArchiveSlow = release;
            });
          });
        }),
    );
    page.once('dialog', (dialog) => dialog.accept());
    await page
      .locator('[data-testid="pp-project-row"].is-selected')
      .getByTestId('pp-finish-project-row')
      .click();
    await expect(ppStatus(page)).toHaveAttribute('data-save-state', 'saving');
    await page.waitForTimeout(16_000);
    await expect(ppStatus(page)).toHaveAttribute('data-save-state', 'saving');
    await expect(page.getByTestId('pp-view-archive')).toHaveCount(0);
    await page.evaluate(() => {
      (window as unknown as { __releaseArchiveSlow: () => void }).__releaseArchiveSlow();
    });
    await expect(ppStatus(page)).toHaveAttribute('data-save-state', 'saved', {
      timeout: 20_000,
    });
    await expect(page.getByTestId('pp-view-archive')).toBeVisible();
  });

  test('rejects an invalid archive query target and keeps cards collapsed', async ({
    page,
  }) => {
    await gotoProgress(page);
    await createProject(page, 'Query archive');
    await finishProject(page, 'Query archive');
    await gotoArchive(page);
    await page.goto('/#/personal-archive?projectId=missing');
    await page.reload();
    await expect(page.getByTestId('pa-page')).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId('pa-loading')).toHaveCount(0, { timeout: 30_000 });
    await expect(page.getByTestId('pa-target-notice')).toBeVisible();
    await expect(page.getByTestId('pa-details')).toHaveCount(0);
  });

  test('keeps the project after a real finish write failure and succeeds on retry', async ({
    page,
  }) => {
    await gotoProgress(page);
    await createProject(page, 'Finish failure');
    await selectProject(page, 'Finish failure');
    await page.evaluate(() => {
      const proto = IDBObjectStore.prototype;
      const original = proto.add;
      const w = window as unknown as { __failFinishAdd?: boolean };
      w.__failFinishAdd = true;
      proto.add = function (...args) {
        if (this.name === 'ops' && w.__failFinishAdd) {
          w.__failFinishAdd = false;
          throw new Error('injected finish failure');
        }
        return original.apply(this, args);
      };
    });
    page.once('dialog', (dialog) => dialog.accept());
    await page
      .locator('[data-testid="pp-project-row"].is-selected')
      .getByTestId('pp-finish-project-row')
      .click();
    await expect(ppStatus(page)).toHaveAttribute('data-save-state', 'failed');
    await expect(
      page.getByTestId('pp-project-row').filter({ hasText: 'Finish failure' }),
    ).toBeVisible();
    await finishProject(page, 'Finish failure');
    await expect(page.getByTestId('pp-view-archive')).toBeVisible();
    await page.getByTestId('pp-view-archive').click();
    await expect(card(page, 'Finish failure')).toBeVisible();
  });

  test('preserves an archived card after a real restore failure and retries', async ({
    page,
  }) => {
    await gotoProgress(page);
    await createProject(page, 'Restore failure');
    await finishProject(page, 'Restore failure');
    await gotoArchive(page);
    await expect(card(page, 'Restore failure')).toBeVisible();
    await page.evaluate(() => {
      const proto = IDBObjectStore.prototype;
      const original = proto.add;
      const w = window as unknown as { __failRestoreAdd?: boolean };
      w.__failRestoreAdd = true;
      proto.add = function (...args) {
        if (this.name === 'ops' && w.__failRestoreAdd) {
          w.__failRestoreAdd = false;
          throw new Error('injected restore failure');
        }
        return original.apply(this, args);
      };
    });
    page.once('dialog', (dialog) => dialog.accept());
    await card(page, 'Restore failure').getByTestId('pa-restore').click();
    await expect(paStatus(page)).toHaveAttribute('data-save-state', 'error');
    await expect(card(page, 'Restore failure')).toBeVisible();
    page.once('dialog', (dialog) => dialog.accept());
    await card(page, 'Restore failure').getByTestId('pa-restore').click();
    await expect(page.getByTestId('pa-restored')).toBeVisible();
    await expect(card(page, 'Restore failure')).toHaveCount(0);
  });

  test('saves a dirty progress draft before finishing the project', async ({ page }) => {
    await gotoProgress(page);
    await createProject(page, 'Save before finish');
    await selectProject(page, 'Save before finish');
    if (!(await page.getByTestId('pp-entry-input').isVisible())) {
      await page.getByTestId('pp-backfill').click();
    }
    await page.getByTestId('pp-entry-input').fill('Saved before archive');
    page.once('dialog', (dialog) => dialog.accept());
    await page
      .locator('[data-testid="pp-project-row"].is-selected')
      .getByTestId('pp-finish-project-row')
      .click();
    await expect(page.getByTestId('pp-draft-prompt')).toBeVisible();
    await page.getByTestId('pp-draft-save').click();
    await expect(page.getByTestId('pp-view-archive')).toBeVisible({
      timeout: 30_000,
    });
    await page.getByTestId('pp-view-archive').click();
    await expect(card(page, 'Save before finish')).toBeVisible();
    await expect(card(page, 'Save before finish').getByTestId('pa-entry')).toContainText(
      'Saved before archive',
    );
  });

  test('does not archive when the pre-finish draft save fails', async ({ page }) => {
    await gotoProgress(page);
    await createProject(page, 'Failed draft before archive');
    await selectProject(page, 'Failed draft before archive');
    if (!(await page.getByTestId('pp-entry-input').isVisible())) {
      await page.getByTestId('pp-backfill').click();
    }
    await page.getByTestId('pp-entry-input').fill('Keep this failed draft');
    await page.evaluate(() => {
      const proto = IDBObjectStore.prototype;
      const original = proto.add;
      const w = window as unknown as { __failDraftAdd?: boolean };
      w.__failDraftAdd = true;
      proto.add = function (...args) {
        if (this.name === 'ops' && w.__failDraftAdd) {
          w.__failDraftAdd = false;
          throw new Error('injected draft save failure');
        }
        return original.apply(this, args);
      };
    });
    await page
      .locator('[data-testid="pp-project-row"].is-selected')
      .getByTestId('pp-finish-project-row')
      .click();
    await expect(page.getByTestId('pp-draft-prompt')).toBeVisible();
    await page.getByTestId('pp-draft-save').click();
    await expect(ppStatus(page)).toHaveAttribute('data-save-state', 'failed');
    await expect(page.getByTestId('pp-entry-input')).toHaveText('Keep this failed draft');
    await expect(
      page
        .getByTestId('pp-project-row')
        .filter({ hasText: 'Failed draft before archive' }),
    ).toBeVisible();
    await expect(page.getByTestId('pp-view-archive')).toHaveCount(0);
  });

  test('protects a dirty progress draft before finish confirmation', async ({ page }) => {
    await gotoProgress(page);
    await createProject(page, 'Draft before finish');
    await selectProject(page, 'Draft before finish');
    if (!(await page.getByTestId('pp-entry-input').isVisible())) {
      await page.getByTestId('pp-backfill').click();
    }
    await page.getByTestId('pp-entry-input').fill('Unsaved before finish');
    await page
      .locator('[data-testid="pp-project-row"].is-selected')
      .getByTestId('pp-finish-project-row')
      .click();
    await expect(page.getByTestId('pp-draft-prompt')).toBeVisible();
    await page.getByTestId('pp-draft-continue').click();
    await expect(
      page.getByTestId('pp-project-row').filter({ hasText: 'Draft before finish' }),
    ).toBeVisible();
    await expect(page.getByTestId('pp-entry-input')).toHaveText('Unsaved before finish');
  });

  test('exports and restores active, archived and routine data into an isolated profile', async ({
    page,
    browser,
  }) => {
    const exportPath = path.join(
      process.env.PROJECT1_STORAGE_ROOT || path.resolve(process.cwd(), '..', '..'),
      'output',
      'handoffs',
      'DS-008',
      'archive-export.json',
    );
    await gotoProgress(page);
    await createProject(page, 'Portable active');
    await createProject(page, 'Portable archived');
    await selectProject(page, 'Portable archived');
    await appendStep(page, 'Portable archived', 'Portable remaining');
    await addManualEntry(page, 'Portable history');
    await finishProject(page, 'Portable archived');
    await page.goto('/#/personal-routine');
    await page.reload();
    await expect(page.getByTestId('pr-page')).toBeVisible({ timeout: 30_000 });
    await page.getByTestId('pr-new-item-title').fill('Portable routine');
    await page.getByTestId('pr-create-item').click();
    await expect(page.getByTestId('pr-status')).toHaveAttribute(
      'data-save-state',
      'saved',
    );
    await page.getByTestId('pr-entry-body').fill('Routine restored');
    await page.getByTestId('pr-save-entry').click();
    await expect(page.getByTestId('pr-status')).toHaveAttribute(
      'data-save-state',
      'saved',
    );
    await gotoProgress(page);
    fs.mkdirSync(path.dirname(exportPath), { recursive: true });
    const download = page.waitForEvent('download');
    await exportPersonalBackup(page);
    await (await download).saveAs(exportPath);
    expect(fs.existsSync(exportPath)).toBe(true);

    const context = await browser.newContext({ locale: 'zh-CN' });
    const page2 = await context.newPage();
    try {
      await page2.addInitScript(skipOnboardingForE2E);
      await page2.goto('/#/personal-progress');
      await page2.reload();
      await expect(page2.getByTestId('pp-page')).toBeVisible({ timeout: 30_000 });
      page2.once('dialog', (dialog) => dialog.accept());
      await restorePersonalBackup(page2, exportPath);
      await expect(
        page2.getByTestId('pp-project-row').filter({ hasText: 'Portable active' }),
      ).toBeVisible();
      await expect(
        page2.getByTestId('pp-project-row').filter({ hasText: 'Portable archived' }),
      ).toHaveCount(0);
      await gotoArchive(page2);
      await expect(card(page2, 'Portable archived')).toBeVisible();
      await card(page2, 'Portable archived').getByTestId('pa-expand').click();
      await expect(
        card(page2, 'Portable archived')
          .getByTestId('pa-remaining-step')
          .filter({ hasText: 'Portable remaining' }),
      ).toBeVisible();
      await expect(
        card(page2, 'Portable archived')
          .getByTestId('pa-entry')
          .filter({ hasText: 'Portable history' }),
      ).toBeVisible();
      await page2.goto('/#/personal-routine');
      await page2.reload();
      await expect(page2.getByTestId('pr-page')).toBeVisible({ timeout: 30_000 });
      await expect(
        page2.getByTestId('pr-item-row').filter({ hasText: 'Portable routine' }),
      ).toBeVisible();
      await expect(
        page2.getByTestId('pr-item-row').filter({ hasText: 'Portable routine' }),
      ).toContainText('Routine restored');
    } finally {
      await context.close();
    }
  });

  test('renders the archive at desktop and narrow widths, in dark mode and by keyboard', async ({
    page,
  }) => {
    const handoff = path.join(
      process.env.PROJECT1_STORAGE_ROOT || path.resolve(process.cwd(), '..', '..'),
      'output',
      'handoffs',
      'DS-008',
    );
    await gotoProgress(page);
    await createProject(page, '展示项目归档');
    await selectProject(page, '展示项目归档');
    await appendStep(page, '展示项目归档', '保留的未完成步骤');
    await addManualEntry(page, '手写记录：保留原因和观察。');
    await finishProject(page, '展示项目归档');
    await gotoArchive(page);
    await page.getByTestId('pa-expand').first().click();
    await waitForAngularStability(page);
    await page.waitForTimeout(3500);
    fs.mkdirSync(handoff, { recursive: true });
    const resetScroll = async (): Promise<void> => {
      await page.evaluate(() => {
        window.scrollTo(0, 0);
        for (const element of Array.from(document.querySelectorAll('*'))) {
          if (element.scrollTop > 0) element.scrollTop = 0;
        }
      });
    };
    for (const [width, height, file] of [
      [1280, 900, 'archive-zh-1280.png'],
      [1600, 1000, 'archive-zh-1600.png'],
      [1024, 900, 'archive-zh-1024.png'],
    ] as const) {
      await page.setViewportSize({ width, height });
      await page.waitForTimeout(300);
      await resetScroll();
      await page.screenshot({ path: path.join(handoff, file), fullPage: true });
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth > window.innerWidth,
        ),
      ).toBe(false);
    }
    await page.emulateMedia({ colorScheme: 'dark' });
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.waitForTimeout(300);
    await resetScroll();
    await page.screenshot({
      path: path.join(handoff, 'archive-zh-dark-1280.png'),
      fullPage: true,
    });
    await page.emulateMedia({ colorScheme: 'light' });
    await page.setViewportSize({ width: 1024, height: 900 });
    const expand = page.getByTestId('pa-expand').first();
    await expand.focus();
    await page.keyboard.press('Enter');
    await expect(expand).toBeFocused();
    const restore = page.getByTestId('pa-restore').first();
    await restore.focus();
    await expect(restore).toBeFocused();
  });

  test('shows legacy archived projects without a finish date as date-unknown and unmarked', async ({
    page,
    browser,
  }) => {
    const sourcePath = path.join(
      process.cwd(),
      '.tmp',
      'e2e-personal-archive',
      'legacy-source.json',
    );
    const legacyPath = path.join(path.dirname(sourcePath), 'legacy-archived.json');
    await gotoProgress(page);
    await createProject(page, 'Legacy archived');
    await finishProject(page, 'Legacy archived');
    fs.mkdirSync(path.dirname(sourcePath), { recursive: true });
    const download = page.waitForEvent('download');
    await exportPersonalBackup(page);
    await (await download).saveAs(sourcePath);
    const backup = JSON.parse(fs.readFileSync(sourcePath, 'utf8')) as {
      data: {
        project: {
          entities: Record<
            string,
            { title: string; isArchived: boolean; isDone: boolean; doneOn: number | null }
          >;
        };
      };
    };
    const legacy = Object.values(backup.data.project.entities).find(
      (project) => project.title === 'Legacy archived',
    );
    expect(legacy).toBeTruthy();
    legacy!.isArchived = true;
    legacy!.isDone = false;
    legacy!.doneOn = null;
    fs.writeFileSync(legacyPath, JSON.stringify(backup), 'utf8');

    const context = await browser.newContext({ locale: 'zh-CN' });
    const page2 = await context.newPage();
    try {
      await page2.addInitScript(skipOnboardingForE2E);
      await page2.goto('/#/personal-progress');
      await page2.reload();
      await expect(page2.getByTestId('pp-page')).toBeVisible({ timeout: 30_000 });
      page2.once('dialog', (dialog) => dialog.accept());
      await restorePersonalBackup(page2, legacyPath);
      await gotoArchive(page2);
      await expect(
        card(page2, 'Legacy archived').getByTestId('pa-date-unknown'),
      ).toBeVisible();
      await expect(
        card(page2, 'Legacy archived').getByTestId('pa-unmarked'),
      ).toBeVisible();
      await expect(
        card(page2, 'Legacy archived').getByTestId('pa-done-date'),
      ).toHaveCount(0);
    } finally {
      await context.close();
    }
  });

  test('shows explicit loading error and recovers on retry when archive storage fails', async ({
    page,
  }) => {
    await gotoProgress(page);
    await page.evaluate(() => {
      const proto = IDBObjectStore.prototype;
      const original = proto.get;
      let failed = false;
      proto.get = function (...args) {
        if (!failed && (this.name === 'archive_young' || this.name === 'archive_old')) {
          failed = true;
          throw new Error('injected archive load failure');
        }
        return original.apply(this, args);
      };
    });
    await page.goto('/#/personal-archive');
    await expect(page.getByTestId('pa-page')).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId('pa-load-error')).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId('pa-retry-load')).toBeVisible();
    await page.getByTestId('pa-retry-load').click();
    await expect(page.getByTestId('pa-load-error')).toHaveCount(0, { timeout: 30_000 });
    await expect(page.getByTestId('pa-page')).toBeVisible();
  });
});
