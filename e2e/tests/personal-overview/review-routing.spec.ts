import { expect, test } from '../../fixtures/test.fixture';
import type { Locator, Page } from '@playwright/test';

const row = (page: Page, title: string): Locator =>
  page.getByTestId('pp-project-row').filter({ hasText: title });

const prepare = async (page: Page): Promise<Record<string, string>> => {
  await page.goto('/#/personal-progress');
  await expect(page.getByTestId('pp-page')).toBeVisible();
  const ids: Record<string, string> = {};
  for (const title of ['Review Alpha', 'Review Beta', 'Review Gamma']) {
    if (!(await page.getByTestId('pp-new-project-input').isVisible())) {
      await page.getByTestId('pp-show-create').click();
    }
    await page.getByTestId('pp-new-project-input').fill(title);
    await page.getByTestId('pp-create-project').click();
    await expect(page.getByTestId('pp-status')).toHaveAttribute(
      'data-save-state',
      'saved',
    );
    ids[title] = (await row(page, title).getAttribute('data-project-id'))!;
    await row(page, title).getByTestId('pp-append-step').click();
    await page.getByTestId('pp-insert-input').fill(`${title} step`);
    await page.getByTestId('pp-insert-save').click();
    await expect(page.getByTestId('pp-status')).toHaveAttribute(
      'data-save-state',
      'saved',
    );
  }
  await row(page, 'Review Alpha').getByTestId('pp-project-title').click();
  await expect(row(page, 'Review Alpha')).toHaveClass(/is-selected/);
  return ids;
};

const setTarget = async (page: Page, id: string): Promise<void> => {
  await page.evaluate((targetId) => {
    location.hash = `/personal-progress?projectId=${targetId}`;
  }, id);
};

for (const choice of ['save', 'discard', 'continue'] as const) {
  test(`the newest query target is handled safely after choosing ${choice} for a draft`, async ({
    page,
  }) => {
    const ids = await prepare(page);
    await row(page, 'Review Alpha').getByTestId('pp-step-edit').click();
    await page.getByTestId('pp-step-edit-input').fill('Discard this draft');
    await setTarget(page, ids['Review Beta']);
    await expect(page.getByTestId('pp-draft-prompt')).toBeVisible();
    await setTarget(page, ids['Review Gamma']);
    await expect(page).toHaveURL(new RegExp(`projectId=${ids['Review Gamma']}`));
    await page.getByTestId(`pp-draft-${choice}`).click();
    const expectedProject = choice === 'continue' ? 'Review Alpha' : 'Review Gamma';
    await expect(row(page, expectedProject)).toHaveClass(/is-selected/, {
      timeout: 2500,
    });
    await expect(page).toHaveURL(new RegExp(`projectId=${ids[expectedProject]}`));
    if (choice === 'continue')
      await expect(page.getByTestId('pp-step-edit-input')).toHaveText(
        'Discard this draft',
      );
    if (choice === 'save')
      await expect(row(page, 'Review Alpha').getByTestId('pp-step-title')).toHaveText(
        'Discard this draft',
      );
  });
}

test('a query received during a real save is applied after the receipt', async ({
  page,
}) => {
  const ids = await prepare(page);
  await row(page, 'Review Alpha').getByTestId('pp-step-edit').click();
  await page.getByTestId('pp-step-edit-input').fill('Alpha saved before switching');
  await page.evaluate(
    () =>
      new Promise<void>((acquired) => {
        void navigator.locks.request('sp_op_log', async () => {
          acquired();
          await new Promise<void>((release) => {
            Object.assign(window, { __releaseRoutingReview: release });
          });
        });
      }),
  );
  try {
    await page.getByTestId('pp-step-edit-save').click();
    await expect(page.getByTestId('pp-status')).toHaveAttribute(
      'data-save-state',
      'saving',
    );
    await setTarget(page, ids['Review Beta']);
    await expect(page).toHaveURL(new RegExp(`projectId=${ids['Review Beta']}`));
  } finally {
    await page.evaluate(() =>
      (
        window as unknown as { __releaseRoutingReview: () => void }
      ).__releaseRoutingReview(),
    );
  }
  await expect(page.getByTestId('pp-status')).toHaveAttribute('data-save-state', 'saved');
  await expect(row(page, 'Review Beta')).toHaveClass(/is-selected/, { timeout: 2500 });
  await expect(row(page, 'Review Alpha').getByTestId('pp-step-title')).toHaveText(
    'Alpha saved before switching',
  );
});

test('a focused empty manual editor follows the project selected by query', async ({
  page,
}) => {
  const ids = await prepare(page);
  if (!(await page.getByTestId('pp-entry-input').isVisible())) {
    await page.getByTestId('pp-backfill').click();
  }
  await page.getByTestId('pp-entry-input').focus();
  await setTarget(page, ids['Review Beta']);
  await expect(row(page, 'Review Beta')).toHaveClass(/is-selected/);
  await expect(page.getByTestId('pp-entry-input')).toBeFocused();
  if (!(await page.getByTestId('pp-entry-input').isVisible())) {
    await page.getByTestId('pp-backfill').click();
  }
  await page.getByTestId('pp-entry-input').fill('This belongs only to Beta');
  await page.getByTestId('pp-add-entry').click();
  await expect(page.getByTestId('pp-status')).toHaveAttribute('data-save-state', 'saved');
  await expect(row(page, 'Review Beta').getByTestId('pp-entry-body')).toHaveText(
    'This belongs only to Beta',
  );
  await expect(row(page, 'Review Alpha').getByTestId('pp-entry-body')).toHaveCount(0);
});

test('creating a project from a located project updates both selection and URL', async ({
  page,
}) => {
  const ids = await prepare(page);
  await setTarget(page, ids['Review Alpha']);
  await expect(page).toHaveURL(new RegExp(`projectId=${ids['Review Alpha']}`));
  if (!(await page.getByTestId('pp-new-project-input').isVisible())) {
    await page.getByTestId('pp-show-create').click();
  }
  await page.getByTestId('pp-new-project-input').fill('New located project');
  await page.getByTestId('pp-create-project').click();
  const created = row(page, 'New located project');
  await expect(created).toHaveClass(/is-selected/);
  const createdId = await created.getAttribute('data-project-id');
  await expect(page).toHaveURL(new RegExp(`projectId=${createdId}`));
  await page.reload();
  await expect(created).toHaveClass(/is-selected/);
});

test('a failed save cancels a query received during that write and retains the draft', async ({
  page,
}) => {
  const ids = await prepare(page);
  await row(page, 'Review Alpha').getByTestId('pp-step-edit').click();
  await page.getByTestId('pp-step-edit-input').fill('Retry this Alpha edit');
  await page.evaluate(
    () =>
      new Promise<void>((acquired) => {
        void navigator.locks.request('sp_op_log', async () => {
          acquired();
          await new Promise<void>((release) => {
            Object.assign(window, { __releaseRoutingReview: release });
          });
        });
      }),
  );
  await page.evaluate(() => {
    const original = IDBObjectStore.prototype.add;
    let failNext = true;
    IDBObjectStore.prototype.add = function (...args: Parameters<IDBObjectStore['add']>) {
      if (this.name === 'ops' && failNext) {
        failNext = false;
        throw new Error('routing review: disk error');
      }
      return original.apply(this, args);
    };
  });
  try {
    await page.getByTestId('pp-step-edit-save').click();
    await expect(page.getByTestId('pp-status')).toHaveAttribute(
      'data-save-state',
      'saving',
    );
    await setTarget(page, ids['Review Beta']);
    await expect(page).toHaveURL(new RegExp(`projectId=${ids['Review Beta']}`));
  } finally {
    await page.evaluate(() =>
      (
        window as unknown as { __releaseRoutingReview: () => void }
      ).__releaseRoutingReview(),
    );
  }
  await expect(page.getByTestId('pp-status')).toHaveAttribute(
    'data-save-state',
    'failed',
  );
  await expect(row(page, 'Review Alpha')).toHaveClass(/is-selected/);
  await expect(page.getByTestId('pp-step-edit-input')).toHaveText(
    'Retry this Alpha edit',
  );
  await expect(page).toHaveURL(new RegExp(`projectId=${ids['Review Alpha']}`));
});
