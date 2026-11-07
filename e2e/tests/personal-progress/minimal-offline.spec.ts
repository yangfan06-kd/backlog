import {
  exportPersonalBackup,
  restorePersonalBackup,
} from '../../utils/personal-backup-helpers';
import { expect, test } from '../../fixtures/test.fixture';
import { skipOnboardingForE2E } from '../../utils/waits';
import {
  expectNoUndoCompletion,
  undoLatestCompletion,
} from '../../utils/personal-progress-helpers';
import type { Locator, Page } from '@playwright/test';
import * as fs from 'node:fs';
import * as path from 'node:path';

const status = (page: Page): Locator => page.getByTestId('pp-status');
const projectRow = (page: Page, name: string): Locator =>
  page.getByTestId('pp-project-row').filter({ hasText: name });

const gotoProgress = async (page: Page): Promise<void> => {
  await page.goto('/#/personal-progress');
  await page.waitForLoadState('domcontentloaded');
  await expect(page.getByTestId('pp-page')).toBeVisible({ timeout: 30_000 });
};

const createProject = async (page: Page, name: string): Promise<void> => {
  if (!(await page.getByTestId('pp-new-project-input').isVisible())) {
    await page.getByTestId('pp-show-create').click();
  }
  await page.getByTestId('pp-new-project-input').fill(name);
  await page.getByTestId('pp-create-project').click();
  await expect(projectRow(page, name)).toBeVisible();
  await expect(status(page)).toHaveAttribute('data-save-state', 'saved');
};

const selectProject = async (page: Page, name: string): Promise<void> => {
  await projectRow(page, name).getByTestId('pp-project-title').click();
};

const appendStep = async (page: Page, project: string, title: string): Promise<void> => {
  const row = projectRow(page, project);
  await row.getByTestId('pp-append-step').click();
  await page.getByTestId('pp-insert-input').fill(title);
  await page.getByTestId('pp-insert-save').click();
  await expect(
    row.locator(`[data-testid="pp-step-title"][data-step-title="${title}"]`),
  ).toBeVisible();
  await expect(status(page)).toHaveAttribute('data-save-state', 'saved');
};

const stepButton = (page: Page, project: string, title: string): Locator =>
  projectRow(page, project).locator(
    `[data-testid="pp-step-title"][data-step-title="${title}"]`,
  );

const completeStepButton = (page: Page, project: string, title: string): Locator =>
  projectRow(page, project).locator(
    `[data-testid="pp-complete-step"][data-step-title="${title}"]`,
  );

const entryBody = (page: Page, project: string, body: string): Locator =>
  projectRow(page, project).getByTestId('pp-entry-body').filter({ hasText: body });

test.describe('personal progress minimal offline loop', () => {
  test('renders the real Chinese UI after choosing Chinese in settings', async ({
    page,
  }) => {
    await page.goto('/#/config');
    const language = page.locator('.section-localization');
    await language.locator('.collapsible-header').click();
    await language.locator('mat-select').first().click();
    await page.getByRole('option', { name: '中文(简体)', exact: true }).click();
    await gotoProgress(page);
    await expect(page.locator('personal-progress-page h1')).toHaveText('项目进展');
    await createProject(page, '个人作品集更新');
    await appendStep(page, '个人作品集更新', '整理案例素材');
    await appendStep(page, '个人作品集更新', '编写项目说明');
    await completeStepButton(page, '个人作品集更新', '整理案例素材').click();
    await expect(status(page)).toHaveAttribute('data-save-state', 'saved');
    await expect(status(page)).toContainText('已保存到本机');
    const output = path.resolve(process.cwd(), '../../output/handoffs/CX-004');
    fs.mkdirSync(output, { recursive: true });
    for (const width of [1600, 1280]) {
      await page.setViewportSize({ width, height: 1000 });
      await page.screenshot({
        path: path.join(output, `ui-zh-${width}.png`),
        animations: 'disabled',
      });
    }
  });

  test('a project with only today has one date and no expand control', async ({
    page,
  }) => {
    await gotoProgress(page);
    await createProject(page, '仅今天项目');
    if (!(await page.getByTestId('pp-entry-input').isVisible())) {
      await page.getByTestId('pp-backfill').click();
    }
    await page.getByTestId('pp-entry-input').fill('今天才有记录');
    await page.getByTestId('pp-add-entry').click();
    await expect(status(page)).toHaveAttribute('data-save-state', 'saved');

    await expect(page.getByTestId('pp-date')).toHaveCount(1);
    await expect(page.locator('.pp-day-col.is-today .pp-day')).toBeVisible();
    await expect(page.getByTestId('pp-expand-records')).toHaveCount(0);
  });

  test('collapsing projects removes only their historical dates and keeps today', async ({
    page,
  }) => {
    await gotoProgress(page);
    await createProject(page, 'Dates A');
    if (!(await page.getByTestId('pp-entry-day').isVisible())) {
      await page.getByTestId('pp-backfill').click();
    }
    await page.getByTestId('pp-entry-day').fill('2026-01-01');
    if (!(await page.getByTestId('pp-entry-input').isVisible())) {
      await page.getByTestId('pp-backfill').click();
    }
    await page.getByTestId('pp-entry-input').fill('A past record');
    await page.getByTestId('pp-add-entry').click();
    await expect(status(page)).toHaveAttribute('data-save-state', 'saved');
    await createProject(page, 'Dates B');
    if (!(await page.getByTestId('pp-entry-day').isVisible())) {
      await page.getByTestId('pp-backfill').click();
    }
    await page.getByTestId('pp-entry-day').fill('2026-01-02');
    if (!(await page.getByTestId('pp-entry-input').isVisible())) {
      await page.getByTestId('pp-backfill').click();
    }
    await page.getByTestId('pp-entry-input').fill('B past record');
    await page.getByTestId('pp-add-entry').click();
    await expect(status(page)).toHaveAttribute('data-save-state', 'saved');
    await expect(page.getByTestId('pp-date')).toHaveCount(2);
    await projectRow(page, 'Dates A').getByTestId('pp-project-toggle').click();
    await expect(page.getByTestId('pp-date')).toHaveCount(2);
    await expect(
      page.locator('[data-testid="pp-date"][data-day="2026-01-02"]'),
    ).toBeVisible();
    await expect(entryBody(page, 'Dates A', 'A past record')).toHaveCount(0);
    await projectRow(page, 'Dates B').getByTestId('pp-project-toggle').click();
    await expect(page.getByTestId('pp-date')).toHaveCount(1);
    await expect(page.locator('.pp-day-col.is-today .pp-day')).toBeVisible();
    await projectRow(page, 'Dates A').getByTestId('pp-project-toggle').click();
    await expect(entryBody(page, 'Dates A', 'A past record')).toBeVisible();
    await expect(
      page.locator('[data-testid="pp-date"][data-day="2026-01-01"]'),
    ).toBeVisible();
  });

  test('completion, reload, undo, insert, edit, and backfill work on real local state', async ({
    page,
  }) => {
    await gotoProgress(page);
    await createProject(page, 'Alpha');
    await createProject(page, 'Beta');

    await selectProject(page, 'Alpha');
    await appendStep(page, 'Alpha', 'One');
    await appendStep(page, 'Alpha', 'Two');
    await appendStep(page, 'Alpha', 'Three');
    await selectProject(page, 'Beta');
    await appendStep(page, 'Beta', 'Other');

    await selectProject(page, 'Alpha');
    await completeStepButton(page, 'Alpha', 'One').click();
    await expect(status(page)).toHaveAttribute('data-save-state', 'saved');
    await expect(entryBody(page, 'Alpha', 'One')).toBeVisible();
    await expect(stepButton(page, 'Alpha', 'One')).toHaveCount(0);
    await expect(stepButton(page, 'Alpha', 'Two')).toBeVisible();
    await expect(stepButton(page, 'Beta', 'Other')).toBeVisible();

    // Reload: the record and remaining steps must come back from local storage.
    await page.reload();
    await page.waitForLoadState('domcontentloaded');
    await expect(page.getByTestId('pp-page')).toBeVisible({ timeout: 30_000 });
    await expect(entryBody(page, 'Alpha', 'One')).toBeVisible();
    await expect(stepButton(page, 'Alpha', 'Two')).toBeVisible();
    await expect(stepButton(page, 'Beta', 'Other')).toBeVisible();
    await selectProject(page, 'Alpha');

    // Undo follows persisted project order, including the completion before reload.
    await appendStep(page, 'Alpha', 'Four');
    await completeStepButton(page, 'Alpha', 'Two').click();
    await expect(status(page)).toHaveAttribute('data-save-state', 'saved');
    await completeStepButton(page, 'Alpha', 'Three').click();
    await expect(status(page)).toHaveAttribute('data-save-state', 'saved');
    await completeStepButton(page, 'Alpha', 'Four').click();
    await expect(status(page)).toHaveAttribute('data-save-state', 'saved');

    await undoLatestCompletion(page);
    await expect(status(page)).toHaveAttribute('data-save-state', 'saved');
    await expect(stepButton(page, 'Alpha', 'Four')).toBeVisible();
    await undoLatestCompletion(page);
    await expect(status(page)).toHaveAttribute('data-save-state', 'saved');
    await expect(stepButton(page, 'Alpha', 'Three')).toBeVisible();
    await undoLatestCompletion(page);
    await expect(status(page)).toHaveAttribute('data-save-state', 'saved');
    await expect(stepButton(page, 'Alpha', 'Two')).toBeVisible();
    await undoLatestCompletion(page);
    await expect(stepButton(page, 'Alpha', 'One')).toBeVisible();
    await expect(entryBody(page, 'Alpha', 'One')).toHaveCount(0);
    await expectNoUndoCompletion(page);
    await completeStepButton(page, 'Alpha', 'One').click();
    await expect(status(page)).toHaveAttribute('data-save-state', 'saved');
    await expect(entryBody(page, 'Alpha', 'One')).toBeVisible();
    await expect(stepButton(page, 'Alpha', 'One')).toHaveCount(0);

    // Insert after the first step; only Alpha's order changes.
    const numeral = projectRow(page, 'Alpha').getByTestId('pp-step-numeral').first();
    await numeral.click();
    await page.getByTestId('pp-insert-input').fill('One-B');
    await page.getByTestId('pp-insert-save').click();
    await expect(status(page)).toHaveAttribute('data-save-state', 'saved');
    await expect(stepButton(page, 'Alpha', 'One-B')).toBeVisible();
    await expect(
      projectRow(page, 'Beta').locator('[data-testid="pp-step-title"]'),
    ).toHaveCount(1);

    // Complete, edit the record, then undo must be refused.
    await completeStepButton(page, 'Alpha', 'Two').click();
    await expect(status(page)).toHaveAttribute('data-save-state', 'saved');
    const entry = projectRow(page, 'Alpha')
      .getByTestId('pp-entry')
      .filter({ hasText: 'Two' });
    await expect(entryBody(page, 'Alpha', 'Two')).toBeVisible();
    await entry.getByTestId('pp-entry-edit').click();
    await page.getByTestId('pp-entry-edit-input').fill('Two edited');
    await page.getByTestId('pp-entry-edit-save').click();
    await expect(status(page)).toHaveAttribute('data-save-state', 'saved');
    await expectNoUndoCompletion(page);
    await expect(entry.getByTestId('pp-undo-entry')).toHaveCount(0);
    await expect(stepButton(page, 'Alpha', 'Two')).toHaveCount(0);
    await expect(entryBody(page, 'Alpha', 'Two edited')).toBeVisible();

    // Historical entries can be edited directly, including after navigation.
    const backfill = '2026-01-01';
    if (!(await page.getByTestId('pp-entry-day').isVisible())) {
      await page.getByTestId('pp-backfill').click();
    }
    await page.getByTestId('pp-entry-day').fill(backfill);
    if (!(await page.getByTestId('pp-entry-input').isVisible())) {
      await page.getByTestId('pp-backfill').click();
    }
    await page.getByTestId('pp-entry-input').fill('Backfilled note');
    await page.getByTestId('pp-add-entry').click();
    await expect(status(page)).toHaveAttribute('data-save-state', 'saved');
    await entryBody(page, 'Alpha', 'Backfilled note').dblclick();
    await page.getByTestId('pp-entry-edit-input').fill('Backfilled edit');
    await page.getByTestId('pp-entry-edit-save').click();
    await expect(entryBody(page, 'Alpha', 'Backfilled edit')).toBeVisible();
    await page.goto('/');
    await page.waitForLoadState('domcontentloaded');
    await gotoProgress(page);
    await expect(entryBody(page, 'Alpha', 'Backfilled edit')).toBeVisible();
  });

  test('blocks external network but still records and saves locally', async ({
    page,
    isolatedContext,
  }) => {
    await gotoProgress(page);
    await createProject(page, 'Offline');
    await appendStep(page, 'Offline', 'Offline step');

    await isolatedContext.setOffline(true);
    await completeStepButton(page, 'Offline', 'Offline step').click();
    await expect(status(page)).toHaveAttribute('data-save-state', 'saved');
    await expect(entryBody(page, 'Offline', 'Offline step')).toBeVisible();
    await isolatedContext.setOffline(false);

    await page.reload();
    await page.waitForLoadState('domcontentloaded');
    await expect(page.getByTestId('pp-page')).toBeVisible({ timeout: 30_000 });
    await expect(entryBody(page, 'Offline', 'Offline step')).toBeVisible();
  });

  test('exports a real backup and restores it into a separate browser profile', async ({
    page,
    browser,
  }) => {
    const exportPath = path.join(
      process.cwd(),
      '.tmp',
      'e2e-personal-progress',
      'export.json',
    );
    fs.mkdirSync(path.dirname(exportPath), { recursive: true });

    await gotoProgress(page);
    await createProject(page, 'Portable');
    await appendStep(page, 'Portable', 'Packed step');
    await completeStepButton(page, 'Portable', 'Packed step').click();
    await expect(status(page)).toHaveAttribute('data-save-state', 'saved');
    // A previous "saved" frame can precede the click's rendering turn. Wait for
    // the completed command's enabled undo before asking the route guard to leave.
    await expect(entryBody(page, 'Portable', 'Packed step')).toBeVisible();
    await expect(page.getByTestId('pp-undo-entry')).toHaveCount(1);

    const downloadPromise = page.waitForEvent('download');
    await exportPersonalBackup(page);
    const download = await downloadPromise;
    await download.saveAs(exportPath);
    expect(fs.existsSync(exportPath)).toBe(true);

    const context2 = await browser.newContext({
      locale: 'en-GB',
      baseURL: process.env.E2E_BASE_URL || 'http://localhost:4242',
    });
    await context2.addInitScript(skipOnboardingForE2E);
    const page2 = await context2.newPage();
    try {
      await gotoProgress(page2);
      page2.on('dialog', (dialog) => void dialog.accept());
      await restorePersonalBackup(page2, exportPath);
      await expect(projectRow(page2, 'Portable')).toBeVisible();
      await expect(entryBody(page2, 'Portable', 'Packed step')).toBeVisible();
      const wrongShapePath = path.join(path.dirname(exportPath), 'wrong-shape.json');
      fs.writeFileSync(
        wrongShapePath,
        JSON.stringify({ unrelated: 'not an app backup' }),
        'utf8',
      );
      await restorePersonalBackup(page2, wrongShapePath, 'error');
      await expect(entryBody(page2, 'Portable', 'Packed step')).toBeVisible();

      // A malformed file must fail without wiping the restored data.
      const badPath = path.join(path.dirname(exportPath), 'bad.json');
      fs.writeFileSync(badPath, '{not valid json', 'utf8');
      await restorePersonalBackup(page2, badPath, 'error');
      await expect(projectRow(page2, 'Portable')).toBeVisible();
      await expect(entryBody(page2, 'Portable', 'Packed step')).toBeVisible();
    } finally {
      await context2.close();
    }
  });

  test('injects a real IndexedDB write failure and rolls the completion back', async ({
    page,
  }) => {
    await gotoProgress(page);
    await createProject(page, 'Faulty');
    await appendStep(page, 'Faulty', 'Fragile step');

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
    });
    await page.evaluate(() => {
      (window as unknown as { __failNextOpsAdd?: boolean }).__failNextOpsAdd = true;
    });

    await completeStepButton(page, 'Faulty', 'Fragile step').click();
    await expect(status(page)).toHaveAttribute('data-save-state', 'failed');
    await expect(stepButton(page, 'Faulty', 'Fragile step')).toBeVisible();
    await expect(projectRow(page, 'Faulty').getByTestId('pp-entry-body')).toHaveCount(0);

    await page.reload();
    await page.waitForLoadState('domcontentloaded');
    await expect(page.getByTestId('pp-page')).toBeVisible({ timeout: 30_000 });
    await expect(stepButton(page, 'Faulty', 'Fragile step')).toBeVisible();
    await expect(projectRow(page, 'Faulty').getByTestId('pp-entry-body')).toHaveCount(0);
  });
});
