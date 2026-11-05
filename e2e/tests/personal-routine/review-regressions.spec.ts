import { expect, test } from '../../fixtures/test.fixture';
import type { Page } from '@playwright/test';
import type { EditEntryInput } from '../../../src/app/features/personal-progress/personal-progress.service';
import type { PersonalCommandResult } from '../../../src/app/features/personal-progress/personal-progress.model';

const prepare = async (page: Page): Promise<Record<string, string>> => {
  await page.goto('/#/personal-routine');
  await expect(page.getByTestId('pr-page')).toBeVisible();
  const ids: Record<string, string> = {};
  for (const title of ['Review A', 'Review B']) {
    await page.getByTestId('pr-new-item-title').fill(title);
    await page.getByTestId('pr-create-item').click();
    await expect(page.getByTestId('pr-status')).toHaveAttribute(
      'data-save-state',
      'saved',
    );
    ids[title] = (await page
      .getByTestId('pr-item-row')
      .filter({ hasText: title })
      .getAttribute('data-item-id'))!;
  }
  await page
    .getByTestId('pr-item-row')
    .filter({ hasText: 'Review A' })
    .getByTestId('pr-item-name')
    .click();
  return ids;
};

test('today records can be corrected without unlocking historical records', async ({
  page,
}) => {
  await prepare(page);
  const row = page.getByTestId('pr-item-row').filter({ hasText: 'Review A' });
  await row.getByTestId('pr-record').click();
  await page.getByTestId('pr-entry-body').fill('Original today');
  await page.getByTestId('pr-save-entry').click();
  await expect(page.getByTestId('pr-status')).toHaveAttribute('data-save-state', 'saved');
  await row.locator('.pr-entry-body').dblclick();
  await expect(page.getByTestId('pr-entry-body')).toHaveText('Original today');
  await page.getByTestId('pr-entry-body').fill('Corrected today');
  await page.getByTestId('pr-save-entry').click();
  await expect(row.locator('.pr-entry-body')).toHaveText('Corrected today');
});

test('an editor retains its opening revision when another real command updates the entry', async ({
  page,
}) => {
  const ids = await prepare(page);
  await page.getByTestId('pr-backfill').click();
  await page.getByTestId('pr-entry-body').fill('Original history');
  await page.getByTestId('pr-save-entry').click();
  await expect(page.getByTestId('pr-status')).toHaveAttribute('data-save-state', 'saved');
  const row = page.getByTestId('pr-item-row').filter({ hasText: 'Review A' });
  const entryId = (await row.getByTestId('pr-entry').getAttribute('data-entry-id'))!;
  await row.locator('.pr-entry-body').dblclick();
  await expect(page.getByTestId('pr-entry-body')).toHaveText('Original history');
  await page.getByTestId('pr-entry-body').fill('Stale local draft');
  const result = await page.evaluate(
    async ({ projectId, entryId: targetEntryId }) => {
      const debug = window as unknown as {
        ng: {
          getComponent: (element: Element) => {
            _service: {
              editEntry: (
                input: EditEntryInput,
              ) => Promise<PersonalCommandResult<{ revision: number }>>;
            };
          };
        };
      };
      return debug.ng
        .getComponent(document.querySelector('personal-routine-page')!)
        ._service.editEntry({
          operationId: 'review-concurrent-record',
          projectId,
          entryId: targetEntryId,
          ownerKind: 'routine',
          expectedRevision: 1,
          body: 'Newer persisted content',
        });
    },
    { projectId: ids['Review A'], entryId },
  );
  expect(result.status).toBe('persisted');
  await page.getByTestId('pr-save-entry').click();
  await expect(page.getByTestId('pr-status')).toHaveAttribute(
    'data-save-state',
    'rejected',
    { timeout: 2500 },
  );
  await expect(page.getByTestId('pr-entry-body')).toHaveText('Stale local draft');
  await expect(row.locator('.pr-entry-body')).toHaveText('Newer persisted content');
});

test('selecting another item through a day cell updates the targeted URL and survives reload', async ({
  page,
}) => {
  const ids = await prepare(page);
  await page.evaluate((id) => {
    location.hash = `/personal-routine?itemId=${id}`;
  }, ids['Review A']);
  await expect(page).toHaveURL(new RegExp(`itemId=${ids['Review A']}`));
  await page
    .locator(`[data-testid="pr-cell"][data-item-id="${ids['Review B']}"]`)
    .first()
    .getByRole('button')
    .click();
  await expect(
    page.getByTestId('pr-item-row').filter({ hasText: 'Review B' }),
  ).toHaveClass(/is-selected/);
  await expect(page).toHaveURL(new RegExp(`itemId=${ids['Review B']}`), {
    timeout: 2500,
  });
  await page.reload();
  await expect(
    page.getByTestId('pr-item-row').filter({ hasText: 'Review B' }),
  ).toHaveClass(/is-selected/);
});

test('a failed write with no pending target does not swallow the next deliberate query', async ({
  page,
}) => {
  const ids = await prepare(page);
  await page
    .getByTestId('pr-item-row')
    .filter({ hasText: 'Review A' })
    .getByTestId('pr-record')
    .click();
  await page.getByTestId('pr-entry-body').fill('Retry or cancel this text');
  await page.evaluate(() => {
    const original = IDBObjectStore.prototype.add;
    let fail = true;
    IDBObjectStore.prototype.add = function (...args: Parameters<IDBObjectStore['add']>) {
      if (this.name === 'ops' && fail) {
        fail = false;
        throw new Error('review write failure');
      }
      return original.apply(this, args);
    };
  });
  await page.getByTestId('pr-save-entry').click();
  await expect(page.getByTestId('pr-status')).toHaveAttribute(
    'data-save-state',
    'failed',
  );
  await expect(page).toHaveURL(new RegExp(`itemId=${ids['Review A']}`));
  await page.getByTestId('pr-cancel-entry').click();
  await page.evaluate((id) => {
    location.hash = `/personal-routine?itemId=${id}`;
  }, ids['Review B']);
  await expect(
    page.getByTestId('pr-item-row').filter({ hasText: 'Review B' }),
  ).toHaveClass(/is-selected/, { timeout: 2500 });
  await expect(page).toHaveURL(new RegExp(`itemId=${ids['Review B']}`));
});
