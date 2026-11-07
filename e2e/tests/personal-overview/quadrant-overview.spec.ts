import {
  exportPersonalBackup,
  restorePersonalBackup,
} from '../../utils/personal-backup-helpers';
import { expect, test } from '../../fixtures/test.fixture';
import { undoLatestCompletion } from '../../utils/personal-progress-helpers';
import { skipOnboardingForE2E, waitForAngularStability } from '../../utils/waits';
import type { Locator, Page } from '@playwright/test';
import * as fs from 'node:fs';
import * as path from 'node:path';

const status = (page: Page): Locator => page.getByTestId('pp-status');
const overviewStatus = (page: Page): Locator => page.getByTestId('po-status');
const overviewRow = (page: Page, name: string): Locator =>
  page.getByTestId('po-project-row').filter({ hasText: name });
const quadrant = (page: Page, id: string): Locator =>
  page.locator(`[data-testid="po-quadrant"][data-quadrant="${id}"]`);
const unclassified = (page: Page): Locator => page.getByTestId('po-unclassified');

const gotoProgress = async (page: Page): Promise<void> => {
  await page.goto('/#/personal-progress');
  await page.waitForLoadState('domcontentloaded');
  await expect(page.getByTestId('pp-page')).toBeVisible({ timeout: 30_000 });
};

const gotoOverview = async (page: Page): Promise<void> => {
  await page.goto('/#/personal-overview');
  await page.waitForLoadState('domcontentloaded');
  try {
    await expect(page.getByTestId('po-page')).toBeVisible({ timeout: 10_000 });
  } catch {
    // Hash-only navigation can be collapsed into a same-document navigation
    // while a just-created download is still settling; reload directly into the
    // overview URL so the route itself is still exercised.
    await page.goto('/#/personal-overview');
    await page.reload();
    await expect(page.getByTestId('po-page')).toBeVisible({ timeout: 30_000 });
  }
};

const createProject = async (page: Page, name: string): Promise<void> => {
  if (!(await page.getByTestId('pp-new-project-input').isVisible())) {
    await page.getByTestId('pp-show-create').click();
  }
  await page.getByTestId('pp-new-project-input').fill(name);
  await page.getByTestId('pp-create-project').click();
  await expect(
    page.getByTestId('pp-project-row').filter({ hasText: name }),
  ).toBeVisible();
  await expect(status(page)).toHaveAttribute('data-save-state', 'saved');
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
  await expect(status(page)).toHaveAttribute('data-save-state', 'saved');
};

const classify = async (
  page: Page,
  project: string,
  quadrantId: string,
): Promise<void> => {
  await overviewRow(page, project).getByTestId('po-classify').click();
  await page.getByTestId(`po-quadrant-option-${quadrantId}`).click();
  await expect(overviewStatus(page)).toHaveAttribute('data-save-state', 'saved');
};

const exportBackup = async (page: Page, filePath: string): Promise<void> => {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  await page.goto('/#/personal-progress');
  await expect(page.getByTestId('pp-page')).toBeVisible({ timeout: 30_000 });
  const downloadPromise = page.waitForEvent('download');
  await exportPersonalBackup(page);
  await (await downloadPromise).saveAs(filePath);
  expect(fs.existsSync(filePath)).toBe(true);
};

const addManualEntry = async (page: Page, body: string): Promise<void> => {
  if (!(await page.getByTestId('pp-entry-input').isVisible())) {
    await page.getByTestId('pp-backfill').click();
  }
  await page.getByTestId('pp-entry-input').fill(body);
  await page.getByTestId('pp-add-entry').click();
  await expect(status(page)).toHaveAttribute('data-save-state', 'saved');
};

test.describe('personal overview quadrants', () => {
  test('classifies only the selected project, keeps one row per project and persists across reload', async ({
    page,
  }) => {
    await gotoProgress(page);
    await createProject(page, 'Alpha');
    await selectProject(page, 'Alpha');
    await appendStep(page, 'Alpha', 'Prepare');
    await createProject(page, 'Beta');
    await selectProject(page, 'Beta');
    await appendStep(page, 'Beta', 'Study');

    await gotoOverview(page);
    await expect(page.getByTestId('po-project-row')).toHaveCount(2);
    await expect(unclassified(page).getByTestId('po-project-row')).toHaveCount(2);

    await overviewRow(page, 'Alpha').getByTestId('po-classify').click();
    await expect(page.getByTestId('po-quadrant-option-important')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(overviewStatus(page)).toHaveAttribute('data-save-state', 'idle');
    await expect(unclassified(page)).toContainText('Alpha');

    await classify(page, 'Alpha', 'important');
    await expect(quadrant(page, 'important')).toContainText('Alpha');
    await expect(
      quadrant(page, 'important').getByTestId('po-project-name'),
    ).toBeFocused();
    await expect(unclassified(page)).toContainText('Beta');
    await expect(unclassified(page)).not.toContainText('Alpha');
    await expect(page.getByTestId('po-project-row')).toHaveCount(2);

    await page.reload();
    await expect(page.getByTestId('po-page')).toBeVisible({ timeout: 30_000 });
    await expect(quadrant(page, 'important')).toContainText('Alpha');
    await expect(unclassified(page)).toContainText('Beta');

    await overviewRow(page, 'Alpha').getByTestId('po-open-progress').click();
    await expect(page.getByTestId('pp-page')).toBeVisible({ timeout: 30_000 });
    await expect(page).toHaveURL(/\/personal-progress\?projectId=/);
    await expect(
      page.getByTestId('pp-project-row').filter({ hasText: 'Alpha' }),
    ).toHaveClass(/is-selected/);
    await expect(
      page.getByTestId('pp-step-title').filter({ hasText: 'Prepare' }),
    ).toBeVisible();
  });

  test('protects a progress draft across a same-route query change and never selects the wrong project', async ({
    page,
  }) => {
    await gotoProgress(page);
    await createProject(page, 'Alpha');
    await selectProject(page, 'Alpha');
    await appendStep(page, 'Alpha', 'Draft step');
    await createProject(page, 'Beta');
    await selectProject(page, 'Beta');
    await appendStep(page, 'Beta', 'Other step');
    await gotoOverview(page);

    await overviewRow(page, 'Alpha').getByTestId('po-open-progress').click();
    await expect(page.getByTestId('pp-page')).toBeVisible({ timeout: 30_000 });
    const aId = await page
      .getByTestId('pp-project-row')
      .filter({ hasText: 'Alpha' })
      .getAttribute('data-project-id');
    const bId = await page
      .getByTestId('pp-project-row')
      .filter({ hasText: 'Beta' })
      .getAttribute('data-project-id');
    expect(aId).toBeTruthy();
    expect(bId).toBeTruthy();

    await page.getByTestId('pp-step-edit').first().click();
    await page.getByTestId('pp-step-edit-input').fill('Keep Alpha draft');
    await page.evaluate(
      (id) => (window.location.hash = `#/personal-progress?projectId=${id}`),
      bId,
    );
    await expect(page.getByTestId('pp-draft-prompt')).toBeVisible();
    await page.getByTestId('pp-draft-continue').click();
    await expect(page.getByTestId('pp-step-edit-input')).toHaveText('Keep Alpha draft');
    await expect(
      page.getByTestId('pp-project-row').filter({ hasText: 'Alpha' }),
    ).toHaveClass(/is-selected/);
    await expect(page).toHaveURL(new RegExp(`projectId=${aId}`));

    await page.evaluate(
      (id) => (window.location.hash = `#/personal-progress?projectId=${id}`),
      bId,
    );
    await expect(page.getByTestId('pp-draft-prompt')).toBeVisible();
    await page.getByTestId('pp-draft-save').click();
    await expect(page.getByTestId('pp-status')).toHaveAttribute(
      'data-save-state',
      'saved',
    );
    await expect(
      page.getByTestId('pp-project-row').filter({ hasText: 'Beta' }),
    ).toHaveClass(/is-selected/);
    await expect(page).toHaveURL(new RegExp(`projectId=${bId}`));

    await page.evaluate(
      () => (window.location.hash = '#/personal-progress?projectId=does-not-exist'),
    );
    await expect(page.getByTestId('pp-target-notice')).toBeVisible();
    await expect(
      page.getByTestId('pp-project-row').filter({ hasText: 'Beta' }),
    ).toHaveClass(/is-selected/);

    await page.reload();
    await expect(page.getByTestId('pp-page')).toBeVisible({ timeout: 30_000 });
    await selectProject(page, 'Alpha');
    await expect(
      page.locator('[data-testid="pp-step-title"][data-step-title="Keep Alpha draft"]'),
    ).toBeVisible();
  });

  test('moves a project back to unclassified and keeps empty quadrants visible', async ({
    page,
  }) => {
    await gotoProgress(page);
    await createProject(page, 'Alpha');
    await gotoOverview(page);

    await classify(page, 'Alpha', 'urgent');
    await expect(quadrant(page, 'urgent')).toContainText('Alpha');
    await expect(
      quadrant(page, 'urgent-important').getByTestId('po-project-row'),
    ).toHaveCount(0);

    await classify(page, 'Alpha', 'unclassified');
    await expect(unclassified(page)).toContainText('Alpha');
    await expect(quadrant(page, 'urgent').getByTestId('po-project-row')).toHaveCount(0);
    await expect(page.getByTestId('po-quadrant')).toHaveCount(4);
    await expect(page.getByTestId('po-unclassified')).toBeVisible();
    await expect(page.getByTestId('po-project-row')).toHaveCount(1);
  });

  test('a failed classification rolls back the category and keeps manual records', async ({
    page,
  }) => {
    await gotoProgress(page);
    await createProject(page, 'Alpha');
    await selectProject(page, 'Alpha');
    await addManualEntry(page, 'Keep this manual record');
    await gotoOverview(page);
    await classify(page, 'Alpha', 'important');

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

    await overviewRow(page, 'Alpha').getByTestId('po-classify').click();
    await page.getByTestId('po-quadrant-option-urgent').click();
    await expect(overviewStatus(page)).toHaveAttribute('data-save-state', 'failed');
    await expect(quadrant(page, 'important')).toContainText('Alpha');
    await expect(quadrant(page, 'urgent').getByTestId('po-project-row')).toHaveCount(0);

    await overviewRow(page, 'Alpha').getByTestId('po-open-progress').click();
    await expect(page.getByTestId('pp-page')).toBeVisible({ timeout: 30_000 });
    await expect(
      page.getByTestId('pp-entry-body').filter({ hasText: 'Keep this manual record' }),
    ).toBeVisible();
  });

  test('waits for a slow real op-log lock instead of treating the classification as failed', async ({
    page,
  }) => {
    await gotoProgress(page);
    await createProject(page, 'Slow classification');
    await gotoOverview(page);

    await page.evaluate(
      () =>
        new Promise<void>((acquired) => {
          void navigator.locks.request('sp_op_log', async () => {
            acquired();
            await new Promise<void>((release) => {
              Object.assign(window, { __releaseOverviewLock: release });
            });
          });
        }),
    );
    try {
      await overviewRow(page, 'Slow classification').getByTestId('po-classify').click();
      await page.getByTestId('po-quadrant-option-important').click();
      // Deliberate elapsed time: exercise the real 15s receipt deadline.
      await page.waitForTimeout(16_000);
      await expect(overviewStatus(page)).toHaveAttribute('data-save-state', 'saving', {
        timeout: 100,
      });
    } finally {
      await page.evaluate(() => {
        const testWindow = window as unknown as {
          __releaseOverviewLock: () => void;
        };
        testWindow.__releaseOverviewLock();
      });
    }
    await expect(overviewStatus(page)).toHaveAttribute('data-save-state', 'saved');
    await expect(quadrant(page, 'important')).toContainText('Slow classification');
  });

  test('is keyboard reachable and has no clipped 1280/1600/1024 Chinese layout', async ({
    page,
  }) => {
    const handoff = path.resolve(
      process.cwd(),
      '..',
      '..',
      'output',
      'handoffs',
      process.env.PROJECT1_REVIEW_TASK || 'DS-006',
    );
    fs.mkdirSync(handoff, { recursive: true });
    await gotoProgress(page);
    const definitions = [
      ['Quadrant Q1', 'urgent-important'],
      ['Quadrant Q2', 'important'],
      ['Quadrant Q3', 'urgent'],
      ['Quadrant Q4', 'neither'],
      ['Quadrant Q0', 'unclassified'],
    ] as const;
    for (const [name, quadrantId] of definitions) {
      await createProject(page, name);
      await selectProject(page, name);
      await appendStep(page, name, `${name} step`);
      if (quadrantId !== 'unclassified') {
        await gotoOverview(page);
        await classify(page, name, quadrantId);
        await gotoProgress(page);
      }
    }
    await gotoOverview(page);
    await expect(
      page.locator('.nav-link').filter({ hasText: '四象限总览' }),
    ).toBeVisible();
    await expect(page.getByTestId('po-project-row')).toHaveCount(5);
    await waitForAngularStability(page);
    await expect(page.locator('personal-progress-page')).toHaveCount(0);

    for (const [width, height, file] of [
      [1280, 900, 'overview-zh-1280.png'],
      [1600, 1000, 'overview-zh-1600.png'],
      [1024, 900, 'overview-zh-1024.png'],
    ] as const) {
      await page.setViewportSize({ width, height });
      await page.waitForTimeout(300);
      await page.screenshot({
        path: path.join(handoff, file),
        fullPage: true,
      });
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - window.innerWidth,
      );
      expect(overflow).toBeLessThanOrEqual(1);
    }

    await page.setViewportSize({ width: 1280, height: 900 });
    await page.emulateMedia({ colorScheme: 'dark' });
    await page.screenshot({
      path: path.join(handoff, 'overview-zh-dark-1280.png'),
      fullPage: true,
    });
    await page.emulateMedia({ colorScheme: 'light' });

    const classifyButton = quadrant(page, 'important').getByTestId('po-classify').first();
    await classifyButton.focus();
    await page.keyboard.press('Enter');
    await expect(page.getByTestId('po-quadrant-option-important')).toBeVisible();
    await page.keyboard.press('Escape');

    const nameButton = quadrant(page, 'important').getByTestId('po-project-name').first();
    await nameButton.focus();
    await page.keyboard.press('Enter');
    await expect(nameButton).toHaveAttribute('aria-expanded', 'true');
    await expect(
      quadrant(page, 'important').getByTestId('po-step-title').first(),
    ).toBeVisible();

    const openButton = quadrant(page, 'important')
      .getByTestId('po-open-progress')
      .first();
    await openButton.focus();
    await page.keyboard.press('Enter');
    await expect(page.getByTestId('pp-page')).toBeVisible({ timeout: 30_000 });
    await expect(page).toHaveURL(/\/personal-progress\?projectId=/);
  });

  test('new project from the overview uses the progress flow and appears unclassified', async ({
    page,
  }) => {
    await gotoOverview(page);
    await page.getByTestId('po-create-project').click();
    await expect(page.getByTestId('pp-page')).toBeVisible({ timeout: 30_000 });
    await createProject(page, 'Created from overview');
    await gotoOverview(page);
    await expect(unclassified(page)).toContainText('Created from overview');
  });

  test('open progress keeps one real step source through complete, undo, edit and insert', async ({
    page,
  }) => {
    await gotoProgress(page);
    await createProject(page, 'Linked A');
    await selectProject(page, 'Linked A');
    await appendStep(page, 'Linked A', 'First linked step');
    await appendStep(page, 'Linked A', 'Second linked step');
    await createProject(page, 'Linked B');
    await selectProject(page, 'Linked B');
    await appendStep(page, 'Linked B', 'B remains');
    await gotoOverview(page);
    await classify(page, 'Linked A', 'urgent');
    await overviewRow(page, 'Linked A').getByTestId('po-project-name').click();
    await expect(overviewRow(page, 'Linked A').getByTestId('po-step-title')).toHaveCount(
      2,
    );

    await overviewRow(page, 'Linked A').getByTestId('po-open-progress').click();
    await expect(page.getByTestId('pp-page')).toBeVisible({ timeout: 30_000 });
    await page
      .locator('[data-testid="pp-complete-step"][data-step-title="First linked step"]')
      .click();
    await expect(page.getByTestId('pp-status')).toHaveAttribute(
      'data-save-state',
      'saved',
    );
    await gotoOverview(page);
    await overviewRow(page, 'Linked A').getByTestId('po-project-name').click();
    await expect(overviewRow(page, 'Linked A').getByTestId('po-step-title')).toHaveCount(
      1,
    );
    await expect(overviewRow(page, 'Linked A')).toContainText('Second linked step');

    await overviewRow(page, 'Linked A').getByTestId('po-open-progress').click();
    await undoLatestCompletion(page);
    await expect(page.getByTestId('pp-status')).toHaveAttribute(
      'data-save-state',
      'saved',
    );
    await gotoOverview(page);
    await overviewRow(page, 'Linked A').getByTestId('po-project-name').click();
    await expect(overviewRow(page, 'Linked A').getByTestId('po-step-title')).toHaveCount(
      2,
    );

    await overviewRow(page, 'Linked A').getByTestId('po-open-progress').click();
    await page.getByTestId('pp-step-edit').first().click();
    await page.getByTestId('pp-step-edit-input').fill('Edited in progress');
    await page.getByTestId('pp-step-edit-save').click();
    await expect(page.getByTestId('pp-status')).toHaveAttribute(
      'data-save-state',
      'saved',
    );
    await gotoOverview(page);
    await overviewRow(page, 'Linked A').getByTestId('po-project-name').click();
    await expect(overviewRow(page, 'Linked A')).toContainText('Edited in progress');

    await overviewRow(page, 'Linked A').getByTestId('po-open-progress').click();
    await appendStep(page, 'Linked A', 'Inserted later');
    await gotoOverview(page);
    await overviewRow(page, 'Linked A').getByTestId('po-project-name').click();
    await expect(overviewRow(page, 'Linked A')).toContainText('Inserted later');
    await expect(quadrant(page, 'urgent')).toContainText('Linked A');
    await expect(unclassified(page)).toContainText('Linked B');
    await overviewRow(page, 'Linked B').getByTestId('po-project-name').click();
    await expect(overviewRow(page, 'Linked B')).toContainText('B remains');
  });

  test('a failed draft save on a same-route target change stays on the original project', async ({
    page,
  }) => {
    await gotoProgress(page);
    await createProject(page, 'Target A');
    await selectProject(page, 'Target A');
    await appendStep(page, 'Target A', 'A step');
    await createProject(page, 'Target B');
    await selectProject(page, 'Target B');
    await appendStep(page, 'Target B', 'B step');
    await gotoOverview(page);
    await overviewRow(page, 'Target A').getByTestId('po-open-progress').click();
    // Route animations can briefly retain the outgoing overview and the old
    // progress page. Wait for actual teardown, never choose an arbitrary match.
    await expect(page.getByTestId('po-page')).toHaveCount(0);
    await expect(page.getByTestId('pp-page')).toHaveCount(1);
    await expect(page.getByTestId('pp-page')).toBeVisible({ timeout: 30_000 });
    const aId = await page
      .getByTestId('pp-project-row')
      .filter({ hasText: 'Target A' })
      .getAttribute('data-project-id');
    const bId = await page
      .getByTestId('pp-project-row')
      .filter({ hasText: 'Target B' })
      .getAttribute('data-project-id');
    await page.getByTestId('pp-step-edit').first().click();
    await page.getByTestId('pp-step-edit-input').fill('Failed target draft');
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
      (id) => (window.location.hash = `#/personal-progress?projectId=${id}`),
      bId,
    );
    await expect(page.getByTestId('pp-draft-prompt')).toBeVisible();
    await page.getByTestId('pp-draft-save').click();
    await expect(page.getByTestId('pp-status')).toHaveAttribute(
      'data-save-state',
      'failed',
    );
    await expect(
      page.getByTestId('pp-project-row').filter({ hasText: 'Target A' }),
    ).toHaveClass(/is-selected/);
    await expect(page).toHaveURL(new RegExp(`projectId=${aId}`));
    await expect(page.getByTestId('pp-step-edit-input')).toHaveText(
      'Failed target draft',
    );
  });

  test('exports and restores categories into an isolated profile, excludes archived projects and rejects a bad file', async ({
    page,
    browser,
  }) => {
    const exportPath = path.join(
      process.cwd(),
      '.tmp',
      'e2e-personal-overview',
      'classification-export.json',
    );
    await gotoProgress(page);
    await createProject(page, 'Portable A');
    await createProject(page, 'Portable B');
    await selectProject(page, 'Portable A');
    await appendStep(page, 'Portable A', 'Carry this step');
    await addManualEntry(page, 'Carry this record');
    await gotoOverview(page);
    await classify(page, 'Portable A', 'urgent-important');
    await exportBackup(page, exportPath);

    const backup = JSON.parse(fs.readFileSync(exportPath, 'utf8')) as {
      data: {
        project: {
          entities: Record<string, { id: string; title: string; isArchived: boolean }>;
        };
      };
    };
    const bProject = Object.values(backup.data.project.entities).find(
      (project) => project.title === 'Portable B',
    );
    expect(bProject).toBeTruthy();
    bProject!.isArchived = true;
    const archivedBackupPath = path.join(path.dirname(exportPath), 'archived.json');
    fs.writeFileSync(archivedBackupPath, JSON.stringify(backup), 'utf8');

    const context = await browser.newContext({ locale: 'zh-CN' });
    const page2 = await context.newPage();
    try {
      await page2.addInitScript(skipOnboardingForE2E);
      await gotoProgress(page2);
      page2.once('dialog', (dialog) => dialog.accept());
      await restorePersonalBackup(page2, archivedBackupPath);
      await page2.reload();
      await page2.goto('/#/personal-overview');
      await page2.reload();
      await expect(page2.getByTestId('po-page')).toBeVisible({ timeout: 30_000 });
      await expect(quadrant(page2, 'urgent-important')).toContainText('Portable A');
      await expect(page2.getByTestId('po-project-row')).toHaveCount(1);
      await expect(page2.getByTestId('po-page')).not.toContainText('Portable B');
      await expect(page2.getByTestId('po-page')).not.toContainText('Inbox');

      await overviewRow(page2, 'Portable A').getByTestId('po-open-progress').click();
      await expect(page2.getByTestId('pp-page')).toBeVisible({ timeout: 30_000 });
      await expect(
        page2.locator('[data-testid="pp-step-title"][data-step-title="Carry this step"]'),
      ).toBeVisible();
      await expect(
        page2.getByTestId('pp-entry-body').filter({ hasText: 'Carry this record' }),
      ).toBeVisible();

      for (const target of [bProject!.id, 'INBOX_PROJECT']) {
        await page2.goto(`/#/personal-progress?projectId=${target}`);
        await page2.reload();
        await expect(page2.getByTestId('pp-page')).toBeVisible({ timeout: 30_000 });
        await expect(page2.getByTestId('pp-target-notice')).toBeVisible();
        await expect(
          page2.getByTestId('pp-project-row').filter({ hasText: 'Portable B' }),
        ).toHaveCount(0);
      }

      const badPath = path.join(path.dirname(exportPath), 'bad-classification.json');
      fs.writeFileSync(badPath, '{not valid json', 'utf8');
      await page2.goto('/#/personal-progress');
      await expect(page2.getByTestId('pp-page')).toBeVisible({ timeout: 30_000 });
      page2.once('dialog', (dialog) => dialog.accept());
      await restorePersonalBackup(page2, badPath, 'error');
      await page2.goto('/#/personal-overview');
      await page2.reload();
      await expect(page2.getByTestId('po-page')).toBeVisible({ timeout: 30_000 });
      await expect(quadrant(page2, 'urgent-important')).toContainText('Portable A');
    } finally {
      await context.close();
    }
  });
});
