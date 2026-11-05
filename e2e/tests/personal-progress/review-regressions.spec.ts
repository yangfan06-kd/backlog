import { expect, test } from '../../fixtures/test.fixture';
import type { Locator } from '@playwright/test';

import type { EditStepInput } from '../../../../src/app/features/personal-progress/personal-progress.service';
import type { PersonalCommandResult } from '../../../../src/app/features/personal-progress/personal-progress.model';

test('a manual draft is detected after an earlier clean project switch', async ({
  page,
}) => {
  await page.goto('/#/personal-progress');
  await expect(page.getByTestId('pp-page')).toBeVisible();
  const status = page.getByTestId('pp-status');
  const row = (title: string): Locator =>
    page.getByTestId('pp-project-row').filter({ hasText: title });
  for (const title of ['Review A', 'Review B']) {
    if (!(await page.getByTestId('pp-new-project-input').isVisible())) {
      await page.getByTestId('pp-show-create').click();
    }
    await page.getByTestId('pp-new-project-input').fill(title);
    await page.getByTestId('pp-create-project').click();
    await expect(status).toHaveAttribute('data-save-state', 'saved');
  }
  // Prime the clean state, then type without changing a signal-backed editor id.
  await row('Review A').getByTestId('pp-project-title').click();
  await expect(row('Review A')).toHaveClass(/is-selected/);
  if (!(await page.getByTestId('pp-entry-input').isVisible())) {
    await page.getByTestId('pp-backfill').click();
  }
  await page.getByTestId('pp-entry-input').fill('This draft belongs only to A');
  await row('Review B').getByTestId('pp-project-title').click();
  await expect(page.getByTestId('pp-draft-prompt')).toBeVisible({ timeout: 1500 });
  await page.getByTestId('pp-draft-continue').click();
  await expect(row('Review A')).toHaveClass(/is-selected/);
  await expect(page.getByTestId('pp-entry-input')).toHaveText(
    'This draft belongs only to A',
  );
});

test('an old edit retry cannot overwrite a newer edit that restored the same title', async ({
  page,
}) => {
  await page.goto('/#/personal-progress');
  await expect(page.getByTestId('pp-page')).toBeVisible();
  const status = page.getByTestId('pp-status');
  if (!(await page.getByTestId('pp-new-project-input').isVisible())) {
    await page.getByTestId('pp-show-create').click();
  }
  await page.getByTestId('pp-new-project-input').fill('Retry safety');
  await page.getByTestId('pp-create-project').click();
  await expect(status).toHaveAttribute('data-save-state', 'saved');
  await page.getByTestId('pp-append-step').click();
  await page.getByTestId('pp-insert-input').fill('Original');
  await page.getByTestId('pp-insert-save').click();
  await expect(status).toHaveAttribute('data-save-state', 'saved');
  const reviewedStepId = (await page
    .getByTestId('pp-step-title')
    .getAttribute('data-step-id'))!;
  const reviewedProjectId = (await page
    .getByTestId('pp-project-row')
    .getAttribute('data-project-id'))!;
  const results = await page.evaluate(
    async ({ stepId, projectId }) => {
      const debug = window as unknown as {
        ng: {
          getComponent: (el: Element) => {
            _service: {
              editStep: (
                input: EditStepInput,
              ) => Promise<PersonalCommandResult<{ stepId: string }>>;
            };
          };
        };
      };
      const service = debug.ng.getComponent(
        document.querySelector('personal-progress-page')!,
      )._service;
      const first = {
        projectId,
        stepId,
        operationId: 'review-edit-first',
        expectedTitle: 'Original',
        expectedRevision: 0,
        title: 'Changed',
      };
      const a = await service.editStep(first);
      const b = await service.editStep({
        ...first,
        operationId: 'review-edit-back',
        expectedTitle: 'Changed',
        expectedRevision: 1,
        title: 'Original',
      });
      const retry = await service.editStep(first);
      return { a, b, retry };
    },
    { stepId: reviewedStepId, projectId: reviewedProjectId },
  );
  expect(results.a.status).toBe('persisted');
  expect(results.b.status).toBe('persisted');
  expect(results.retry.status).toBe('rejected');
  await expect(page.getByTestId('pp-step-title')).toHaveText('Original');
  await page.reload();
  await expect(page.getByTestId('pp-step-title')).toHaveText('Original');
});

test('creating a new project cannot silently reassign an existing manual draft', async ({
  page,
}) => {
  await page.goto('/#/personal-progress');
  await expect(page.getByTestId('pp-page')).toBeVisible();
  if (!(await page.getByTestId('pp-new-project-input').isVisible())) {
    await page.getByTestId('pp-show-create').click();
  }
  await page.getByTestId('pp-new-project-input').fill('Draft owner');
  await page.getByTestId('pp-create-project').click();
  await expect(page.getByTestId('pp-status')).toHaveAttribute('data-save-state', 'saved');
  if (!(await page.getByTestId('pp-entry-input').isVisible())) {
    await page.getByTestId('pp-backfill').click();
  }
  await page.getByTestId('pp-entry-input').fill('Keep with original project');
  if (!(await page.getByTestId('pp-new-project-input').isVisible())) {
    await page.getByTestId('pp-show-create').click();
  }
  await page.getByTestId('pp-new-project-input').fill('New project');
  await page.getByTestId('pp-create-project').click();
  await expect(page.getByTestId('pp-draft-prompt')).toBeVisible({ timeout: 1500 });
});

test('saving a step does not discard text entered in a second editor', async ({
  page,
}) => {
  await page.goto('/#/personal-progress');
  await expect(page.getByTestId('pp-page')).toBeVisible();
  const status = page.getByTestId('pp-status');
  if (!(await page.getByTestId('pp-new-project-input').isVisible())) {
    await page.getByTestId('pp-show-create').click();
  }
  await page.getByTestId('pp-new-project-input').fill('One draft only');
  await page.getByTestId('pp-create-project').click();
  await expect(status).toHaveAttribute('data-save-state', 'saved');
  await page.getByTestId('pp-append-step').click();
  await page.getByTestId('pp-insert-input').fill('Original');
  await page.getByTestId('pp-insert-save').click();
  await expect(status).toHaveAttribute('data-save-state', 'saved');
  await page.getByTestId('pp-step-edit').click();
  await page.getByTestId('pp-step-edit-input').fill('Edited');
  // A single business draft prevents the second editor from accepting text.
  if (!(await page.getByTestId('pp-entry-input').isVisible())) {
    await page.getByTestId('pp-backfill').click();
  }
  const manual = page.getByTestId('pp-entry-input');
  await expect(manual).toHaveAttribute('contenteditable', 'false');
  await page.getByTestId('pp-step-edit-save').click();
  await expect(status).toHaveAttribute('data-save-state', 'saved');
  await expect(manual).toHaveAttribute('contenteditable', 'true');
  await expect(page.getByTestId('pp-step-title')).toHaveText('Edited');
});
