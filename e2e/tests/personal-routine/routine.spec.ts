import {
  exportPersonalBackup,
  restorePersonalBackup,
} from '../../utils/personal-backup-helpers';
import { expect, test } from '../../fixtures/test.fixture';
import { skipOnboardingForE2E, waitForAngularStability } from '../../utils/waits';
import type { Locator, Page } from '@playwright/test';
import * as fs from 'node:fs';
import * as path from 'node:path';

const status = (page: Page): Locator => page.getByTestId('pr-status');
const itemRow = (page: Page, name: string): Locator =>
  page.getByTestId('pr-item-row').filter({ hasText: name });

const gotoRoutine = async (page: Page): Promise<void> => {
  await page.goto('/#/personal-routine');
  await expect(page.getByTestId('pr-page')).toBeVisible({ timeout: 30_000 });
  await page.reload();
  await page.waitForLoadState('domcontentloaded');
  await expect(page.getByTestId('pr-page')).toBeVisible({ timeout: 30_000 });
};

const createItem = async (page: Page, name: string, expectedCount = 1): Promise<void> => {
  if (await page.getByTestId('pr-editor').isVisible()) {
    await page.getByTestId('pr-cancel-entry').click();
    await expect(page.getByTestId('pr-editor')).toHaveCount(0);
  }
  await page.getByTestId('pr-new-item-title').fill(name);
  await page.getByTestId('pr-create-item').click();
  await expect(itemRow(page, name)).toHaveCount(expectedCount, { timeout: 20_000 });
  await expect(status(page)).toHaveAttribute('data-save-state', 'saved');
  await itemRow(page, name).last().getByTestId('pr-record').click();
  await expect(page.getByTestId('pr-editor')).toBeVisible();
};

const addEntry = async (page: Page, body: string): Promise<void> => {
  await openDay(page);
  const day = await page.getByTestId('pr-entry-day').inputValue();
  await page.getByTestId('pr-entry-body').fill(body);
  await page.getByTestId('pr-save-entry').click();
  await expect(status(page)).toHaveAttribute('data-save-state', 'saved');
  await expect(page.getByTestId('pr-editor')).toHaveCount(0);
  await openDay(page, day);
};

const openDay = async (page: Page, day?: string): Promise<void> => {
  if (!(await page.getByTestId('pr-editor').isVisible())) {
    await page
      .locator('[data-testid="pr-item-row"].is-selected')
      .getByTestId('pr-record')
      .click();
  }
  await expect(page.getByTestId('pr-editor')).toBeVisible();
  if (day) {
    await page.getByTestId('pr-entry-day').fill(day);
  }
};

const selectItem = async (page: Page, name: string): Promise<void> => {
  const row = itemRow(page, name);
  await row.getByTestId('pr-item-name').click();
  await expect(row).toHaveClass(/is-selected/);
  await expect(page.getByTestId('pr-editor')).toHaveCount(0);
};
const gotoProgress = async (page: Page): Promise<void> => {
  await page.getByRole('menuitem', { name: '项目进展', exact: true }).click();
  await expect(page.getByTestId('pp-page')).toBeVisible({ timeout: 30_000 });
  await page.reload();
  await expect(page.getByTestId('pp-page')).toBeVisible({ timeout: 30_000 });
};

const createNormalProject = async (page: Page, name: string): Promise<void> => {
  await gotoProgress(page);
  if (!(await page.getByTestId('pp-new-project-input').isVisible())) {
    await page.getByTestId('pp-show-create').click();
  }
  await page.getByTestId('pp-new-project-input').fill(name);
  await page.getByTestId('pp-create-project').click();
  await expect(page.getByTestId('pp-project-row').filter({ hasText: name })).toBeVisible({
    timeout: 20_000,
  });
  await expect(page.getByTestId('pp-status')).toHaveAttribute('data-save-state', 'saved');
};

const setDate = async (page: Page, day: string): Promise<void> => {
  await openDay(page);
  const input = page.getByTestId('pr-entry-day');
  await input.fill(day);
};

const offsetDay = (day: string, offset: number): string => {
  const [year, month, date] = day.split('-').map(Number);
  const value = new Date(year, month - 1, date + offset);
  return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(
    2,
    '0',
  )}-${String(value.getDate()).padStart(2, '0')}`;
};

const resetScroll = async (page: Page): Promise<void> => {
  await page.evaluate(() => {
    window.scrollTo(0, 0);
    for (const element of Array.from(document.querySelectorAll('*'))) {
      if (element.scrollTop > 0) element.scrollTop = 0;
    }
  });
};

test.describe('personal routine browser slice', () => {
  test('creates an item, shows empty-today and appends text records', async ({
    page,
  }) => {
    await gotoRoutine(page);
    await createItem(page, 'Routine A');
    const row = itemRow(page, 'Routine A');
    await expect(row).toBeVisible();
    await expect(page.getByTestId('pr-entry')).toHaveCount(0);
    await addEntry(page, 'First observation');
    await expect(row.getByTestId('pr-entry')).toContainText('First observation');
    await expect(page.getByTestId('pr-day-entry-body')).toContainText(
      'First observation',
    );
    await addEntry(page, 'Second observation');
    await expect(row.getByTestId('pr-entry')).toHaveCount(2);
  });

  test('distinguishes same-named items by stable ID and keeps edits separate', async ({
    page,
  }) => {
    await gotoRoutine(page);
    await createItem(page, 'Same name');
    await addEntry(page, 'A record');
    await createItem(page, 'Same name', 2);
    const rows = page.getByTestId('pr-item-row').filter({ hasText: 'Same name' });
    await expect(rows).toHaveCount(2);
    const a = rows.nth(0);
    const b = rows.nth(1);
    const aId = await a.getAttribute('data-item-id');
    const bId = await b.getAttribute('data-item-id');
    expect(aId).toBeTruthy();
    expect(bId).toBeTruthy();
    expect(aId).not.toBe(bId);
    await b.getByTestId('pr-item-name').click();
    await addEntry(page, 'B record');
    await expect(b.getByTestId('pr-entry')).toContainText('B record');
    await expect(a.getByTestId('pr-entry')).toContainText('A record');
    await expect(a.getByTestId('pr-entry')).toHaveCount(1);
  });

  test('backfills a past date and displays it in a visible range column', async ({
    page,
  }) => {
    await gotoRoutine(page);
    await createItem(page, 'Backfill item');
    const before = await page.getByTestId('pr-entry-day').inputValue();
    await page.getByTestId('pr-backfill').click();
    await expect
      .poll(() => page.getByTestId('pr-entry-day').inputValue())
      .not.toBe(before);
    const day = await page.getByTestId('pr-entry-day').inputValue();
    expect(day).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    await addEntry(page, 'Past observation');
    await expect(page.locator(`[data-testid="pr-date-${day}"]`)).toBeVisible();
    await expect(
      page.locator(`[data-testid="pr-entry"][data-entry-id]`).filter({
        hasText: 'Past observation',
      }),
    ).toBeVisible();
  });

  test('directly edits a past record while leaving its date intact', async ({ page }) => {
    await gotoRoutine(page);
    await createItem(page, 'History item');
    const before = await page.getByTestId('pr-entry-day').inputValue();
    await page.getByTestId('pr-backfill').click();
    await expect
      .poll(() => page.getByTestId('pr-entry-day').inputValue())
      .not.toBe(before);
    const day = await page.getByTestId('pr-entry-day').inputValue();
    await addEntry(page, 'Old text');
    await expect(page.getByTestId('pr-edit-entry')).toBeVisible();
    await page.getByTestId('pr-edit-entry').click();
    await expect(page.getByTestId('pr-entry-day')).toHaveValue(day);
    await page.getByTestId('pr-entry-body').fill('Corrected text');
    await page.getByTestId('pr-save-entry').click();
    await expect(status(page)).toHaveAttribute('data-save-state', 'saved');
    await expect(page.getByTestId('pr-editor')).toHaveCount(0);
    await openDay(page, day);
    await expect(page.getByTestId('pr-day-entry-body')).toContainText('Corrected text');
    await expect(page.getByTestId('pr-entry-day')).toHaveValue(day);
  });

  test('protects a dirty draft when changing range and supports the three choices', async ({
    page,
  }) => {
    await gotoRoutine(page);
    await createItem(page, 'Draft item');
    await page.getByTestId('pr-entry-body').fill('unsaved text');
    const currentDay = await page.getByTestId('pr-entry-day').inputValue();
    await page.getByTestId('pr-range-week').press('Enter');
    await expect(page.getByTestId('pr-draft-prompt')).toBeVisible();
    await page.getByTestId('pr-draft-continue').click();
    await expect(page.getByTestId('pr-draft-prompt')).toHaveCount(0);
    await expect(page.getByTestId('pr-range-week')).not.toHaveClass(/is-active/);
    await expect(page.getByTestId('pr-entry-day')).toHaveValue(currentDay);
    await page.getByTestId('pr-range-week').press('Enter');
    await page.getByTestId('pr-draft-discard').click();
    await expect(page.getByTestId('pr-draft-prompt')).toHaveCount(0);
    await expect(page.getByTestId('pr-range-week')).toHaveClass(/is-active/);
    await expect(page.getByTestId('pr-editor')).toHaveCount(0);
  });

  test('routes to a routine item by ID and rejects normal-project targets', async ({
    page,
  }) => {
    await gotoRoutine(page);
    await createItem(page, 'Query routine');
    const routineId = await itemRow(page, 'Query routine').getAttribute('data-item-id');
    await page.goto(`/#/personal-routine?itemId=${routineId}`);
    await page.reload();
    await expect(page.getByTestId('pr-page')).toBeVisible({ timeout: 30_000 });
    await expect(itemRow(page, 'Query routine')).toHaveClass(/is-selected/);
    await expect(page.getByTestId('pr-target-notice')).toHaveCount(0);

    await createNormalProject(page, 'Normal target');
    const normalId = await page
      .getByTestId('pp-project-row')
      .filter({ hasText: 'Normal target' })
      .getAttribute('data-project-id');
    expect(normalId).toBeTruthy();
    await page.goto(`/#/personal-routine?itemId=${normalId}`);
    await page.reload();
    await expect(page.getByTestId('pr-target-notice')).toBeVisible();
    await expect(page.getByTestId('pr-item-row.is-selected')).toHaveCount(0);

    await page.goto(`/#/personal-progress?projectId=${routineId}`);
    await page.reload();
    await expect(page.getByTestId('pp-page')).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId('pp-target-notice')).toBeVisible();
    await expect(
      page.getByTestId('pp-project-row').filter({ hasText: 'Query routine' }),
    ).toHaveCount(0);
  });

  test('keeps routine items out of progress and the quadrant overview', async ({
    page,
  }) => {
    await gotoRoutine(page);
    await createItem(page, 'Hidden routine');
    await createNormalProject(page, 'Visible project');
    await gotoRoutine(page);
    await expect(itemRow(page, 'Hidden routine')).toBeVisible();
    await expect(itemRow(page, 'Visible project')).toHaveCount(0);
    await gotoProgress(page);
    await expect(
      page.getByTestId('pp-project-row').filter({ hasText: 'Hidden routine' }),
    ).toHaveCount(0);
    await expect(
      page.getByTestId('pp-project-row').filter({ hasText: 'Visible project' }),
    ).toBeVisible();
    await page.goto('/#/personal-overview');
    await expect(page.getByTestId('po-page')).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId('po-page')).toContainText('Visible project');
    await expect(page.getByTestId('po-page')).not.toContainText('Hidden routine');
  });

  test('keeps sparse dates visible across ranges, including a backfilled date outside the range', async ({
    page,
  }) => {
    await gotoRoutine(page);
    await createItem(page, 'Range item');
    const today = await page.getByTestId('pr-entry-day').inputValue();
    const outside = offsetDay(today, -120);
    await setDate(page, outside);
    await addEntry(page, 'Outside observation');
    await expect(page.locator(`[data-testid="pr-date-${outside}"]`)).toHaveCount(0);
    await expect(page.getByTestId('pr-day-entry-body')).toContainText(
      'Outside observation',
    );

    const inside = offsetDay(today, -40);
    await setDate(page, inside);
    await addEntry(page, 'Within three months');
    await expect(page.locator(`[data-testid="pr-date-${inside}"]`)).toHaveCount(0);
    await page.getByTestId('pr-range-three-months').click();
    await expect(page.locator(`[data-testid="pr-date-${inside}"]`)).toBeVisible();
    await expect(page.locator(`[data-testid="pr-date-${outside}"]`)).toHaveCount(0);
    await page.getByTestId('pr-range-week').press('Enter');
    await expect(page.locator(`[data-testid="pr-date-${inside}"]`)).toHaveCount(0);
    await expect(page.getByTestId('pr-page')).toContainText('Range item');
  });

  test('protects a dirty new-item name and a dirty entry across route changes', async ({
    page,
  }) => {
    await gotoRoutine(page);
    await createItem(page, 'Protected item');
    await page.getByTestId('pr-new-item-title').fill('Name draft');
    await page.getByTestId('pr-range-week').press('Enter');
    await expect(page.getByTestId('pr-draft-prompt')).toBeVisible();
    await page.getByTestId('pr-draft-continue').click();
    await expect(page.getByTestId('pr-new-item-title')).toHaveValue('Name draft');
    await page.getByTestId('pr-range-week').press('Enter');
    await page.getByTestId('pr-draft-discard').click();
    await expect(page.getByTestId('pr-new-item-title')).toHaveValue('');
    await expect(page.getByTestId('pr-range-week')).toHaveClass(/is-active/);

    await openDay(page);
    await page.getByTestId('pr-entry-body').fill('Route draft');
    await page.locator('.nav-link').filter({ hasText: '项目进展' }).click();
    await expect(page.getByTestId('pr-draft-prompt')).toBeVisible();
    await page.getByTestId('pr-draft-continue').click();
    await expect(page.getByTestId('pr-page')).toBeVisible();
    await expect(page.getByTestId('pr-entry-body')).toHaveText('Route draft');
  });

  test('applies the latest same-route target while a draft prompt is open', async ({
    page,
  }) => {
    await gotoRoutine(page);
    await createItem(page, 'Target A');
    const aId = await itemRow(page, 'Target A').getAttribute('data-item-id');
    await createItem(page, 'Target B');
    const bId = await itemRow(page, 'Target B').getAttribute('data-item-id');
    await selectItem(page, 'Target A');
    await openDay(page);
    await page.getByTestId('pr-entry-body').fill('Pending');
    await page.evaluate(
      (id) => (window.location.hash = `#/personal-routine?itemId=${id}`),
      bId,
    );
    await expect(page.getByTestId('pr-draft-prompt')).toBeVisible();
    await page.evaluate(
      () => (window.location.hash = '#/personal-routine?itemId=missing'),
    );
    await page.getByTestId('pr-draft-discard').click();
    await expect(page.getByTestId('pr-target-notice')).toBeVisible();
    await expect(itemRow(page, 'Target A')).toHaveClass(/is-selected/);
    expect(aId).toBeTruthy();
    await expect(page.getByTestId('pr-editor')).toHaveCount(0);
  });

  test('keeps the input after a real IDB write failure and saves on retry', async ({
    page,
  }) => {
    await gotoRoutine(page);
    await createItem(page, 'Failure item');
    await page.getByTestId('pr-entry-body').fill('Must survive failure');
    await page.evaluate(() => {
      const w = window as unknown as { __failNextOpsAdd?: boolean };
      const proto = IDBObjectStore.prototype;
      const original = proto.add;
      w.__failNextOpsAdd = false;
      proto.add = function (this: IDBObjectStore, ...args: unknown[]) {
        if (this.name === 'ops' && w.__failNextOpsAdd) {
          w.__failNextOpsAdd = false;
          throw new Error('injected IndexedDB persistence failure');
        }
        return (original as unknown as (...a: unknown[]) => IDBRequest).apply(this, args);
      };
      w.__failNextOpsAdd = true;
    });
    await page.getByTestId('pr-save-entry').click();
    await expect(status(page)).toHaveAttribute('data-save-state', 'failed');
    await expect(page.getByTestId('pr-entry-body')).toHaveText('Must survive failure');
    await expect(itemRow(page, 'Failure item').getByTestId('pr-entry')).toHaveCount(0);

    await page.getByTestId('pr-save-entry').click();
    await expect(status(page)).toHaveAttribute('data-save-state', 'saved');
    await expect(itemRow(page, 'Failure item').getByTestId('pr-entry')).toContainText(
      'Must survive failure',
    );
  });

  test('waits for a real 16-second op write instead of reporting a fake failure', async ({
    page,
  }) => {
    await gotoRoutine(page);
    await createItem(page, 'Slow item');
    await page.getByTestId('pr-entry-body').fill('Slow but committed');
    await page.evaluate(
      () =>
        new Promise<void>((acquired) => {
          void navigator.locks.request('sp_op_log', async () => {
            acquired();
            await new Promise<void>((release) => {
              (
                window as unknown as { __finishRoutineLock: () => void }
              ).__finishRoutineLock = release;
            });
          });
        }),
    );
    await page.getByTestId('pr-save-entry').click();
    await expect(status(page)).toHaveAttribute('data-save-state', 'saving');
    await page.waitForTimeout(16_000);
    await expect(status(page)).toHaveAttribute('data-save-state', 'saving');
    await page.evaluate(() => {
      (window as unknown as { __finishRoutineLock: () => void }).__finishRoutineLock();
    });
    await expect(status(page)).toHaveAttribute('data-save-state', 'saved', {
      timeout: 20_000,
    });
    await expect(itemRow(page, 'Slow item').getByTestId('pr-entry')).toContainText(
      'Slow but committed',
    );
  });

  test('exports and restores routine records into an isolated profile and rejects a bad file', async ({
    page,
    browser,
  }) => {
    const exportPath = path.join(
      process.cwd(),
      '.tmp',
      'e2e-personal-routine',
      'routine-export.json',
    );
    await gotoRoutine(page);
    await createItem(page, 'Portable routine');
    await addEntry(page, 'Routine survives restore');
    await createNormalProject(page, 'Portable normal');
    await gotoRoutine(page);
    fs.mkdirSync(path.dirname(exportPath), { recursive: true });
    const downloadPromise = page.waitForEvent('download');
    await exportPersonalBackup(page);
    await (await downloadPromise).saveAs(exportPath);
    expect(fs.existsSync(exportPath)).toBe(true);

    const backup = JSON.parse(fs.readFileSync(exportPath, 'utf8')) as {
      data: {
        project: {
          entities: Record<
            string,
            {
              id: string;
              title: string;
              isArchived: boolean;
              personalProgress?: { kind?: string; entries: { body: string }[] };
            }
          >;
        };
      };
    };
    const portable = Object.values(backup.data.project.entities).find(
      (project) => project.title === 'Portable routine',
    );
    const normal = Object.values(backup.data.project.entities).find(
      (project) => project.title === 'Portable normal',
    );
    expect(portable?.personalProgress?.kind).toBe('routine');
    expect(normal?.personalProgress?.kind).toBeUndefined();
    expect(portable?.personalProgress?.entries[0].body).toBe('Routine survives restore');

    const context = await browser.newContext({ locale: 'zh-CN' });
    const page2 = await context.newPage();
    try {
      await page2.addInitScript(skipOnboardingForE2E);
      await gotoRoutine(page2);
      page2.once('dialog', (dialog) => dialog.accept());
      await restorePersonalBackup(page2, exportPath);
      await page2.reload();
      await expect(page2.getByTestId('pr-page')).toBeVisible({ timeout: 30_000 });
      await expect(itemRow(page2, 'Portable routine')).toBeVisible();
      await expect(
        itemRow(page2, 'Portable routine').getByTestId('pr-entry'),
      ).toContainText('Routine survives restore');
      await expect(itemRow(page2, 'Portable normal')).toHaveCount(0);
      await gotoProgress(page2);
      await expect(
        page2.getByTestId('pp-project-row').filter({ hasText: 'Portable normal' }),
      ).toBeVisible();
      await expect(
        page2.getByTestId('pp-project-row').filter({ hasText: 'Portable routine' }),
      ).toHaveCount(0);

      const badPath = path.join(path.dirname(exportPath), 'bad-routine.json');
      fs.writeFileSync(badPath, '{not valid json', 'utf8');
      await gotoRoutine(page2);
      page2.once('dialog', (dialog) => dialog.accept());
      await restorePersonalBackup(page2, badPath, 'error');
      await page2.reload();
      await expect(itemRow(page2, 'Portable routine')).toBeVisible();

      const archivedPath = path.join(path.dirname(exportPath), 'archived-routine.json');
      portable!.isArchived = true;
      fs.writeFileSync(archivedPath, JSON.stringify(backup), 'utf8');
      await gotoRoutine(page2);
      page2.once('dialog', (dialog) => dialog.accept());
      await restorePersonalBackup(page2, archivedPath);
      await page2.goto(`/#/personal-routine?itemId=${portable!.id}`);
      await page2.reload();
      await expect(page2.getByTestId('pr-page')).toBeVisible({ timeout: 30_000 });
      await expect(page2.getByTestId('pr-target-notice')).toBeVisible();
      await expect(page2.getByTestId('pr-item-row')).toHaveCount(0);
    } finally {
      await context.close();
    }
  });

  test('keeps a saving write when the same-route target changes, then applies the target', async ({
    page,
  }) => {
    await gotoRoutine(page);
    await createItem(page, 'Save A');
    await createItem(page, 'Save B');
    const bId = await itemRow(page, 'Save B').getAttribute('data-item-id');
    await selectItem(page, 'Save A');
    await openDay(page);
    await page.getByTestId('pr-entry-body').fill('Persist while navigating');
    await page.evaluate(
      () =>
        new Promise<void>((acquired) => {
          void navigator.locks.request('sp_op_log', async () => {
            acquired();
            await new Promise<void>((release) => {
              (window as unknown as { __finishSaveLock: () => void }).__finishSaveLock =
                release;
            });
          });
        }),
    );
    await page.getByTestId('pr-save-entry').click();
    await expect(status(page)).toHaveAttribute('data-save-state', 'saving');
    await page.evaluate(
      (id) => (window.location.hash = `#/personal-routine?itemId=${id}`),
      bId,
    );
    await page.evaluate(() => {
      (window as unknown as { __finishSaveLock: () => void }).__finishSaveLock();
    });
    await expect(status(page)).toHaveAttribute('data-save-state', 'saved', {
      timeout: 20_000,
    });
    await expect(itemRow(page, 'Save B')).toHaveClass(/is-selected/);
    await expect(page).toHaveURL(new RegExp(`itemId=${bId}`));
    await expect(itemRow(page, 'Save A').getByTestId('pr-entry')).toContainText(
      'Persist while navigating',
    );
  });

  test('cancels a target change when the write fails and restores the URL', async ({
    page,
  }) => {
    await gotoRoutine(page);
    await createItem(page, 'Fail A');
    await createItem(page, 'Fail B');
    const aId = await itemRow(page, 'Fail A').getAttribute('data-item-id');
    const bId = await itemRow(page, 'Fail B').getAttribute('data-item-id');
    await selectItem(page, 'Fail A');
    await openDay(page);
    await page.getByTestId('pr-entry-body').fill('Keep this after failure');
    await page.evaluate(() => {
      const w = window as unknown as { __failNextOpsAdd?: boolean };
      const proto = IDBObjectStore.prototype;
      const original = proto.add;
      w.__failNextOpsAdd = false;
      proto.add = function (this: IDBObjectStore, ...args: unknown[]) {
        if (this.name === 'ops' && w.__failNextOpsAdd) {
          w.__failNextOpsAdd = false;
          throw new Error('injected IndexedDB persistence failure');
        }
        return (original as unknown as (...a: unknown[]) => IDBRequest).apply(this, args);
      };
      w.__failNextOpsAdd = true;
    });
    await page.evaluate(
      () =>
        new Promise<void>((acquired) => {
          void navigator.locks.request('sp_op_log', async () => {
            acquired();
            await new Promise<void>((release) => {
              (
                window as unknown as { __releaseFailTargetLock: () => void }
              ).__releaseFailTargetLock = release;
            });
          });
        }),
    );
    await page.getByTestId('pr-save-entry').click();
    await expect(status(page)).toHaveAttribute('data-save-state', 'saving');
    await page.evaluate(
      (id) => (window.location.hash = `#/personal-routine?itemId=${id}`),
      bId,
    );
    await page.evaluate(() => {
      (
        window as unknown as { __releaseFailTargetLock: () => void }
      ).__releaseFailTargetLock();
    });
    await expect(status(page)).toHaveAttribute('data-save-state', 'failed');
    await expect(itemRow(page, 'Fail A')).toHaveClass(/is-selected/);
    await expect(page).toHaveURL(new RegExp(`itemId=${aId}`));
    await expect(page.getByTestId('pr-entry-body')).toHaveText('Keep this after failure');
  });

  test('keeps a dirty draft on its old logical day while the table advances', async ({
    page,
  }) => {
    // Configure the clock before booting the app. The shared fixture has
    // already booted a document; replacing its live timer functions invalidates
    // scheduled RxJS actions independently of draft ownership.
    await page.goto('about:blank');
    await page.clock.setFixedTime(new Date('2026-10-26T12:00:00+08:00'));
    await gotoRoutine(page);
    await createItem(page, 'Cross-day item');
    await expect(page.getByTestId('pr-entry-day')).toHaveValue('2026-10-26');
    await page.getByTestId('pr-entry-body').fill('Frozen draft');
    // Let the app's real minute poll observe the changed date. Keep the normal
    // runtime-error assertion active; do not suppress cancelled-action errors.
    await page.clock.setFixedTime(new Date('2026-10-27T12:00:00+08:00'));
    await expect(page.locator('[data-testid="pr-date-2026-10-27"]')).toBeVisible({
      timeout: 75_000,
    });
    await expect(page.getByTestId('pr-entry-day')).toHaveValue('2026-10-26');
    await expect(page.getByTestId('pr-entry-body')).toHaveText('Frozen draft');
  });

  test('binds an empty focused editor to the newly selected item', async ({ page }) => {
    await gotoRoutine(page);
    await createItem(page, 'Owner A');
    await createItem(page, 'Owner B');
    await selectItem(page, 'Owner A');
    await openDay(page);
    const body = page.getByTestId('pr-entry-body');
    await body.focus();
    await selectItem(page, 'Owner B');
    await expect(page.getByTestId('pr-editor')).toHaveCount(0);
    await openDay(page);
    await body.fill('Belongs to B');
    await page.getByTestId('pr-save-entry').click();
    await expect(status(page)).toHaveAttribute('data-save-state', 'saved');
    await expect(itemRow(page, 'Owner B').getByTestId('pr-entry')).toContainText(
      'Belongs to B',
    );
    await expect(itemRow(page, 'Owner A').getByTestId('pr-entry')).toHaveCount(0);
  });

  test('protects a dirty draft when changing the record date', async ({ page }) => {
    await gotoRoutine(page);
    await createItem(page, 'Date draft');
    const originalDay = await page.getByTestId('pr-entry-day').inputValue();
    const otherDay = offsetDay(originalDay, -2);
    await page.getByTestId('pr-entry-body').fill('Do not move me');
    await setDate(page, otherDay);
    await expect(page.getByTestId('pr-draft-prompt')).toBeVisible();
    await page.getByTestId('pr-draft-continue').click();
    await expect(page.getByTestId('pr-entry-day')).toHaveValue(originalDay);
    await expect(page.getByTestId('pr-entry-body')).toHaveText('Do not move me');
    await setDate(page, otherDay);
    await page.getByTestId('pr-draft-discard').click();
    await expect(page.getByTestId('pr-entry-day')).toHaveValue(otherDay);
    await expect(page.getByTestId('pr-entry-body')).toHaveText('');
  });

  test('shows an explicit empty state and does not create empty records on cancel', async ({
    page,
  }) => {
    await gotoRoutine(page);
    await expect(page.getByTestId('pr-empty')).toBeVisible();
    await expect(page.getByTestId('pr-item-row')).toHaveCount(0);
    await expect(page.getByTestId('pr-new-item-title')).toBeVisible();
    await createItem(page, 'Cancel item');
    const today = await page.getByTestId('pr-entry-day').inputValue();
    await page.getByTestId('pr-entry-body').fill('Throw this away');
    await page.getByTestId('pr-cancel-entry').click();
    await expect(page.getByTestId('pr-editor')).toHaveCount(0);
    await expect(page.getByTestId('pr-entry')).toHaveCount(0);
    await expect(page.locator(`[data-testid="pr-date-${today}"]`)).toHaveCount(1);
  });

  test('historical double-click editing remains available after leaving and returning', async ({
    page,
  }) => {
    await gotoRoutine(page);
    await createItem(page, 'History reset');
    await page.getByTestId('pr-backfill').click();
    await addEntry(page, '历史记录');
    await gotoRoutine(page);
    await expect(page.getByTestId('pr-history-toggle')).toHaveCount(0);
    await itemRow(page, 'History reset').locator('.pr-entry-body').dblclick();
    await expect(page.getByTestId('pr-entry-body')).toHaveText('历史记录');
  });

  test('edits a record older than three months through date lookup', async ({ page }) => {
    await gotoRoutine(page);
    await createItem(page, 'Old outside item');
    const today = await page.getByTestId('pr-entry-day').inputValue();
    const oldDay = offsetDay(today, -120);
    await setDate(page, oldDay);
    await addEntry(page, 'Old outside text');
    await expect(page.locator(`[data-testid="pr-date-${oldDay}"]`)).toHaveCount(0);
    await expect(page.getByTestId('pr-edit-entry')).toBeVisible();
    await page.getByTestId('pr-edit-entry').click();
    await page.getByTestId('pr-entry-body').fill('Corrected years-old record');
    await page.getByTestId('pr-save-entry').click();
    await expect(status(page)).toHaveAttribute('data-save-state', 'saved');
    await expect(page.getByTestId('pr-editor')).toHaveCount(0);
    await openDay(page, oldDay);
    await expect(page.getByTestId('pr-day-entry-body')).toContainText(
      'Corrected years-old record',
    );
    await expect(page.getByTestId('pr-entry-day')).toHaveValue(oldDay);
  });

  test('protects a dirty draft before restoring a backup', async ({ page }) => {
    await gotoRoutine(page);
    await createItem(page, 'Restore draft');
    await page.getByTestId('pr-entry-body').fill('Keep before restore');
    await page.evaluate(() => {
      location.hash = '/personal-backup';
    });
    await expect(page.getByTestId('pr-draft-prompt')).toBeVisible();
    await page.getByTestId('pr-draft-continue').click();
    await expect(page.getByTestId('pr-entry-body')).toHaveText('Keep before restore');
    await expect(page.getByTestId('pr-item-row')).toContainText('Restore draft');
  });

  test('renders the routine page at desktop and narrow widths and in dark mode', async ({
    page,
  }) => {
    const handoff = path.join(
      process.env.PROJECT1_STORAGE_ROOT || path.resolve(process.cwd(), '..', '..'),
      'output',
      'handoffs',
      process.env.PROJECT1_REVIEW_TASK || 'DS-007',
    );
    await gotoRoutine(page);
    await createItem(page, '展示内容优化');
    await addEntry(page, '调整介绍，因为原有介绍不够清楚。');
    await page.getByTestId('pr-backfill').click();
    await page.getByTestId('pr-entry-body').fill('观察：询问更具体，继续记录。');
    await page.getByTestId('pr-save-entry').click();
    await expect(status(page)).toHaveAttribute('data-save-state', 'saved');
    await expect(page.getByTestId('pr-editor')).toHaveCount(0);
    await createItem(page, '学习方法调整');
    await addEntry(page, '改为先做练习，再做总结。');
    await page.getByTestId('pr-cancel-entry').click();
    fs.mkdirSync(handoff, { recursive: true });
    await page.waitForTimeout(3500);
    await waitForAngularStability(page);
    await resetScroll(page);

    for (const [width, height, file] of [
      [1280, 900, 'routine-zh-1280.png'],
      [1600, 1000, 'routine-zh-1600.png'],
      [1024, 900, 'routine-zh-1024.png'],
    ] as const) {
      await page.setViewportSize({ width, height });
      await page.waitForTimeout(300);
      await resetScroll(page);
      await page.screenshot({ path: path.join(handoff, file), fullPage: true });
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth > window.innerWidth,
      );
      expect(overflow).toBe(false);
    }

    await page.emulateMedia({ colorScheme: 'dark' });
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.waitForTimeout(300);
    await resetScroll(page);
    await page.screenshot({
      path: path.join(handoff, 'routine-zh-dark-1280.png'),
      fullPage: true,
    });

    await page.emulateMedia({ colorScheme: 'light' });
    await page.setViewportSize({ width: 1024, height: 900 });
    const range = page.getByTestId('pr-range-month');
    await range.focus();
    await page.keyboard.press('Enter');
    await expect(range).toBeFocused();
    const itemButton = itemRow(page, '展示内容优化').getByTestId('pr-item-name');
    await itemButton.focus();
    await page.keyboard.press('Enter');
    await expect(itemButton).toBeFocused();
  });

  test('reports an unavailable query target instead of selecting another item', async ({
    page,
  }) => {
    await gotoRoutine(page);
    await createItem(page, 'Real item');
    await page.goto('/#/personal-routine?itemId=missing-routine');
    await page.reload();
    await expect(page.getByTestId('pr-page')).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId('pr-target-notice')).toBeVisible();
    await expect(page.getByTestId('pr-item-row')).toContainText('Real item');
  });
});
