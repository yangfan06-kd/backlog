import { expect, test } from '../../fixtures/test.fixture';

test('a slow real op-log lock must not turn a successful completion into a rollback', async ({
  page,
}) => {
  await page.goto('/#/personal-progress');
  await expect(page.getByTestId('pp-page')).toBeVisible();
  const status = page.getByTestId('pp-status');
  if (!(await page.getByTestId('pp-new-project-input').isVisible())) {
    await page.getByTestId('pp-show-create').click();
  }
  await page.getByTestId('pp-new-project-input').fill('Delayed persistence');
  await page.getByTestId('pp-create-project').click();
  await expect(status).toHaveAttribute('data-save-state', 'saved');
  const row = page
    .getByTestId('pp-project-row')
    .filter({ hasText: 'Delayed persistence' });
  await row.getByTestId('pp-append-step').click();
  await page.getByTestId('pp-insert-input').fill('Keep my completed work');
  await page.getByTestId('pp-insert-save').click();
  await expect(status).toHaveAttribute('data-save-state', 'saved');

  // Hold the actual browser write lock beyond the former 15s receipt timeout,
  // but below LockService's 30s acquisition timeout. No persistence API is mocked.
  await page.evaluate(
    () =>
      new Promise<void>((acquired) => {
        void navigator.locks.request('sp_op_log', async () => {
          acquired();
          await new Promise<void>((release) => {
            Object.assign(window, { __releaseProgressLock: release });
          });
        });
      }),
  );
  try {
    await row.getByTestId('pp-complete-step').click();
    // Deliberate elapsed time: exercise the real 15s deadline, not UI readiness.
    await page.waitForTimeout(16_000);
    await expect(status).toHaveAttribute('data-save-state', 'saving', { timeout: 100 });
  } finally {
    await page.evaluate(() => {
      const testWindow = window as unknown as {
        __releaseProgressLock: () => void;
      };
      testWindow.__releaseProgressLock();
    });
  }
  await expect(status).toHaveAttribute('data-save-state', 'saved');
  await expect(row.getByTestId('pp-entry-body')).toHaveText('Keep my completed work');
  await page.reload();
  await expect(row.getByTestId('pp-entry-body')).toHaveText('Keep my completed work');
  await expect(row.getByTestId('pp-step-title')).toHaveCount(0);
});
