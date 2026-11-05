import {
  exportPersonalBackup,
  restorePersonalBackup,
} from '../../utils/personal-backup-helpers';
import { expect, test } from '../../fixtures/test.fixture';
import { skipOnboardingForE2E } from '../../utils/waits';
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
  const row = projectRow(page, name);
  if (await row.evaluate((el) => el.classList.contains('is-selected'))) return;
  await row.getByTestId('pp-project-title').click();
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

const step = (page: Page, project: string, title: string): Locator =>
  projectRow(page, project).locator(
    `[data-testid="pp-step-title"][data-step-title="${title}"]`,
  );

const completeStep = (page: Page, project: string, title: string): Locator =>
  projectRow(page, project).locator(
    `[data-testid="pp-complete-step"][data-step-title="${title}"]`,
  );

const finishDay = async (page: Page): Promise<void> => {
  await page.locator('.nav-link').filter({ hasText: '今天' }).first().click();
  await page.waitForSelector('task-list', { state: 'visible', timeout: 20_000 });
  await page.locator('.e2e-finish-day').click();
  await expect(page.locator('daily-summary')).toBeVisible({ timeout: 15_000 });
  await page.locator('daily-summary .bottom-buttons button').first().click();
  await expect(page).toHaveURL(/(active\/tasks|tag\/TODAY)/, { timeout: 15_000 });
  await page.waitForSelector('task-list', { state: 'visible', timeout: 20_000 });
  await page.waitForTimeout(500);
};

test.describe('personal progress daily use', () => {
  test('keeps an explicitly chosen English language over the Chinese new-data default', async ({
    page,
  }) => {
    await page.goto('/#/config');
    const language = page.locator('.section-localization');
    await language.locator('.collapsible-header').click();
    await language.locator('mat-select').first().click();
    await page.getByRole('option', { name: 'English', exact: true }).click();
    await page
      .locator('.nav-link')
      .filter({ hasText: 'Project progress' })
      .first()
      .click();
    await expect(page.getByTestId('pp-page')).toBeVisible();
    await expect(page.locator('personal-progress-page h1')).toHaveText(
      'Project progress',
    );
    await page.reload();
    await expect(page.getByTestId('pp-page')).toBeVisible({ timeout: 30_000 });
    await expect(page.locator('personal-progress-page h1')).toHaveText(
      'Project progress',
    );
  });

  test('has a visible navigation entry, Chinese new-data copy and no clipped 1280/1600 layout', async ({
    page,
  }) => {
    const handoff = path.resolve(
      process.cwd(),
      '..',
      '..',
      'output',
      'handoffs',
      process.env.PROJECT1_REVIEW_TASK || 'DS-005',
    );
    fs.mkdirSync(handoff, { recursive: true });
    await expect(page).toHaveURL(/#\/(tag|project)\/.+\/tasks/);
    await page.locator('.nav-link').filter({ hasText: '项目进展' }).first().click();
    await expect(page.getByTestId('pp-page')).toBeVisible();
    await expect(page.locator('personal-progress-page h1')).toHaveText('项目进展');
    await expect(page.getByTestId('pp-status')).toHaveAttribute(
      'data-save-state',
      'ready',
    );
    await expect(page.getByTestId('pp-status')).toHaveText('');
    await createProject(page, '中文入口');
    await selectProject(page, '中文入口');
    await appendStep(page, '中文入口', '写第一版初稿');
    await appendStep(page, '中文入口', '补充原因');

    await page.setViewportSize({ width: 1280, height: 900 });
    await page.screenshot({
      path: path.join(handoff, 'ui-zh-1280.png'),
      fullPage: true,
    });
    await page.setViewportSize({ width: 1600, height: 1000 });
    await page.screenshot({
      path: path.join(handoff, 'ui-zh-1600.png'),
      fullPage: true,
    });

    // The edit entry must be keyboard reachable, not hover-only.
    const edit = projectRow(page, '中文入口').getByTestId('pp-step-edit').first();
    await edit.focus();
    await expect(edit).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(page.getByTestId('pp-step-edit-input')).toBeVisible();
  });

  test('browser unload prompts while a draft is dirty and cancel keeps the input', async ({
    browser,
  }) => {
    const context = await browser.newContext({ locale: 'zh-CN' });
    const page = await context.newPage();
    await page.addInitScript(skipOnboardingForE2E);
    try {
      await gotoProgress(page);
      await createProject(page, 'Unload');
      await selectProject(page, 'Unload');
      await appendStep(page, 'Unload', 'One');
      await projectRow(page, 'Unload').getByTestId('pp-step-edit').first().click();
      await page.getByTestId('pp-step-edit-input').fill('Unload draft');

      let promptType = '';
      page.on('dialog', async (dialog) => {
        promptType = dialog.type();
        await dialog.dismiss().catch(() => undefined);
      });
      await page.reload({ timeout: 5000 }).catch(() => undefined);
      await expect.poll(() => promptType).toBe('beforeunload');
      await expect(page.getByTestId('pp-page')).toBeVisible({ timeout: 30_000 });
      await expect(page.getByTestId('pp-step-edit-input')).toHaveText('Unload draft');
    } finally {
      await context.close();
    }
  });

  test('a failed save-after-continue keeps the draft, the project and the edit input', async ({
    page,
  }) => {
    await gotoProgress(page);
    await createProject(page, 'Alpha');
    await createProject(page, 'Beta');
    await selectProject(page, 'Alpha');
    await appendStep(page, 'Alpha', 'One');
    await selectProject(page, 'Beta');
    await appendStep(page, 'Beta', 'Other');
    await selectProject(page, 'Alpha');

    await projectRow(page, 'Alpha').getByTestId('pp-step-edit').first().click();
    await page.getByTestId('pp-step-edit-input').fill('Failing draft');
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

    await selectProject(page, 'Beta');
    await expect(page.getByTestId('pp-draft-prompt')).toBeVisible();
    await page.getByTestId('pp-draft-save').click();
    await expect(status(page)).toHaveAttribute('data-save-state', 'failed');
    await expect(projectRow(page, 'Alpha')).toHaveClass(/is-selected/);
    await expect(page.getByTestId('pp-step-edit-input')).toHaveText('Failing draft');

    // The injected failure is consumed; a second explicit close of the draft
    // can now save and continue to the other project.
    await selectProject(page, 'Beta');
    await expect(page.getByTestId('pp-draft-prompt')).toBeVisible();
    await page.getByTestId('pp-draft-save').click();
    await expect(projectRow(page, 'Beta')).toHaveClass(/is-selected/);
    await expect(status(page)).toHaveAttribute('data-save-state', 'saved');
    await page.reload();
    await expect(page.getByTestId('pp-page')).toBeVisible({ timeout: 30_000 });
    await selectProject(page, 'Alpha');
    await expect(step(page, 'Alpha', 'Failing draft')).toBeVisible();
  });

  test('edits a remaining step in place without creating a record or touching another project', async ({
    page,
  }) => {
    await gotoProgress(page);
    await createProject(page, 'Alpha');
    await createProject(page, 'Beta');
    await selectProject(page, 'Alpha');
    await appendStep(page, 'Alpha', 'One');
    await appendStep(page, 'Alpha', 'Two');
    await selectProject(page, 'Beta');
    await appendStep(page, 'Beta', 'Other');
    await selectProject(page, 'Alpha');

    const aRow = projectRow(page, 'Alpha');
    const idsBefore = await aRow
      .getByTestId('pp-step-title')
      .evaluateAll((els) => els.map((el) => el.getAttribute('data-step-id')));
    await aRow.getByTestId('pp-step-edit').first().click();
    await expect(page.getByTestId('pp-step-edit-input')).toHaveText('One');
    await page.getByTestId('pp-step-edit-input').fill('One edited');
    await page.getByTestId('pp-step-edit-save').click();
    await expect(status(page)).toHaveAttribute('data-save-state', 'saved');
    await expect(step(page, 'Alpha', 'One edited')).toBeVisible();
    await expect(step(page, 'Alpha', 'Two')).toBeVisible();
    await expect(step(page, 'Beta', 'Other')).toBeVisible();
    await expect(aRow.getByTestId('pp-entry')).toHaveCount(0);

    const idsAfter = await aRow
      .getByTestId('pp-step-title')
      .evaluateAll((els) => els.map((el) => el.getAttribute('data-step-id')));
    expect(idsAfter).toEqual(idsBefore);

    await page.reload();
    await expect(page.getByTestId('pp-page')).toBeVisible({ timeout: 30_000 });
    await selectProject(page, 'Alpha');
    await expect(step(page, 'Alpha', 'One edited')).toBeVisible();
    await expect(step(page, 'Beta', 'Other')).toBeVisible();
    await expect(aRow.getByTestId('pp-entry')).toHaveCount(0);
  });

  test('draft switch provides save, discard and continue without carrying text across projects', async ({
    page,
  }) => {
    await gotoProgress(page);
    await createProject(page, 'Alpha');
    await createProject(page, 'Beta');
    await selectProject(page, 'Alpha');
    await appendStep(page, 'Alpha', 'One');
    await selectProject(page, 'Beta');
    await appendStep(page, 'Beta', 'Other');
    await selectProject(page, 'Alpha');

    await projectRow(page, 'Alpha').getByTestId('pp-step-edit').first().click();
    await page.getByTestId('pp-step-edit-input').fill('draft A');

    await selectProject(page, 'Beta');
    await expect(page.getByTestId('pp-draft-prompt')).toBeVisible();
    // Esc is the keyboard equivalent of "keep editing".
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('pp-draft-prompt')).toHaveCount(0);
    await expect(page.getByTestId('pp-step-edit-input')).toHaveText('draft A');
    await selectProject(page, 'Beta');
    await expect(page.getByTestId('pp-draft-prompt')).toBeVisible();
    await page.getByTestId('pp-draft-continue').click();
    await expect(page.getByTestId('pp-draft-prompt')).toHaveCount(0);
    await expect(page.getByTestId('pp-step-edit-input')).toHaveText('draft A');
    await expect(projectRow(page, 'Alpha')).toHaveClass(/is-selected/);

    // Collapsing the draft's project and starting an insertion are also guarded.
    await projectRow(page, 'Alpha').getByTestId('pp-project-toggle').click();
    await expect(page.getByTestId('pp-draft-prompt')).toBeVisible();
    await page.getByTestId('pp-draft-continue').click();
    await expect(page.getByTestId('pp-step-edit-input')).toHaveText('draft A');
    await expect(
      projectRow(page, 'Alpha').getByTestId('pp-project-toggle'),
    ).toHaveAttribute('aria-expanded', 'true');
    await projectRow(page, 'Alpha').getByTestId('pp-append-step').click();
    await expect(page.getByTestId('pp-draft-prompt')).toBeVisible();
    await page.getByTestId('pp-draft-continue').click();
    await expect(page.getByTestId('pp-step-edit-input')).toHaveText('draft A');

    await selectProject(page, 'Beta');
    await page.getByTestId('pp-draft-discard').click();
    await expect(projectRow(page, 'Beta')).toHaveClass(/is-selected/);
    await expect(step(page, 'Alpha', 'One')).toBeVisible();
    await expect(page.getByTestId('pp-step-edit-input')).toHaveCount(0);

    await selectProject(page, 'Alpha');
    await projectRow(page, 'Alpha').getByTestId('pp-step-edit').first().click();
    await page.getByTestId('pp-step-edit-input').fill('saved A');
    await selectProject(page, 'Beta');
    await expect(page.getByTestId('pp-draft-prompt')).toBeVisible();
    await page.getByTestId('pp-draft-save').click();
    await expect(projectRow(page, 'Beta')).toHaveClass(/is-selected/);
    await expect(status(page)).toHaveAttribute('data-save-state', 'saved');
    await expect(step(page, 'Beta', 'Other')).toBeVisible();

    await page.reload();
    await expect(page.getByTestId('pp-page')).toBeVisible({ timeout: 30_000 });
    await selectProject(page, 'Alpha');
    await expect(step(page, 'Alpha', 'saved A')).toBeVisible();
    await expect(step(page, 'Alpha', 'One')).toHaveCount(0);
  });

  test('history editing and the route guard preserve a dirty draft until resolved', async ({
    page,
  }) => {
    await gotoProgress(page);
    await createProject(page, 'Alpha');
    await selectProject(page, 'Alpha');
    await appendStep(page, 'Alpha', 'One');

    const past = new Date();
    past.setDate(past.getDate() - 1);
    const pastDay = `${past.getFullYear()}-${String(past.getMonth() + 1).padStart(
      2,
      '0',
    )}-${String(past.getDate()).padStart(2, '0')}`;
    if (!(await page.getByTestId('pp-entry-day').isVisible())) {
      await page.getByTestId('pp-backfill').click();
    }
    await page.getByTestId('pp-entry-day').fill(pastDay);
    if (!(await page.getByTestId('pp-entry-input').isVisible())) {
      await page.getByTestId('pp-backfill').click();
    }
    await page.getByTestId('pp-entry-input').fill('Past entry');
    await page.getByTestId('pp-add-entry').click();
    await expect(status(page)).toHaveAttribute('data-save-state', 'saved');

    await projectRow(page, 'Alpha')
      .getByTestId('pp-entry')
      .filter({ hasText: 'Past entry' })
      .getByTestId('pp-entry-edit')
      .click();
    await page.getByTestId('pp-entry-edit-input').fill('Past entry edited');
    await page.getByTestId('pp-entry-edit-save').click();
    await expect(status(page)).toHaveAttribute('data-save-state', 'saved');
    await expect(
      projectRow(page, 'Alpha')
        .getByTestId('pp-entry-body')
        .filter({ hasText: 'Past entry edited' }),
    ).toBeVisible();

    // Route leave while dirty: continue keeps the page and the draft.
    await projectRow(page, 'Alpha')
      .getByTestId('pp-entry')
      .filter({ hasText: 'Past entry edited' })
      .getByTestId('pp-entry-edit')
      .click();
    await page.getByTestId('pp-entry-edit-input').fill('Route draft');
    await page.locator('.nav-link').filter({ hasText: '今天' }).first().click();
    await expect(page.getByTestId('pp-draft-prompt')).toBeVisible();
    await page.getByTestId('pp-draft-continue').click();
    await expect(page.getByTestId('pp-draft-prompt')).toHaveCount(0);
    await expect(page).toHaveURL(/#\/personal-progress/);
    await expect(page.getByTestId('pp-entry-edit-input')).toHaveText('Route draft');

    // Opening the central backup page is a guarded route exit.
    await page.evaluate(() => {
      location.hash = '/personal-backup';
    });
    await expect(page.getByTestId('pp-draft-prompt')).toBeVisible();
    await page.getByTestId('pp-draft-continue').click();
    await expect(page.getByTestId('pp-entry-edit-input')).toHaveText('Route draft');
  });

  test('edits a record after the completed step was archived by Finish Day', async ({
    page,
  }) => {
    await gotoProgress(page);
    await createProject(page, 'Archived young');
    await selectProject(page, 'Archived young');
    await appendStep(page, 'Archived young', 'Do the work');
    await completeStep(page, 'Archived young', 'Do the work').click();
    await expect(status(page)).toHaveAttribute('data-save-state', 'saved');
    await finishDay(page);

    await gotoProgress(page);
    const entry = projectRow(page, 'Archived young').getByTestId('pp-entry');
    await expect(entry).toHaveCount(1);
    await selectProject(page, 'Archived young');
    await expect(
      projectRow(page, 'Archived young').getByTestId('pp-step-title'),
    ).toHaveCount(0);
    // The archive list refreshes asynchronously right after the page opens.
    await page.waitForTimeout(500);
    await entry.getByTestId('pp-entry-edit').click();
    await page.getByTestId('pp-entry-edit-input').fill('Archived record edited');
    await page.getByTestId('pp-entry-edit-save').click();
    await expect(status(page)).toHaveAttribute('data-save-state', 'saved');
    await expect(entry.getByTestId('pp-entry-body')).toHaveText('Archived record edited');

    await page.reload();
    await expect(page.getByTestId('pp-page')).toBeVisible({ timeout: 30_000 });
    await selectProject(page, 'Archived young');
    await expect(
      projectRow(page, 'Archived young')
        .getByTestId('pp-entry-body')
        .filter({ hasText: 'Archived record edited' }),
    ).toBeVisible();
    await expect(
      projectRow(page, 'Archived young').getByTestId('pp-step-title'),
    ).toHaveCount(0);
  });

  test('a failed archive write keeps the old archived body and the draft', async ({
    page,
  }) => {
    await gotoProgress(page);
    await createProject(page, 'Archive fault');
    await selectProject(page, 'Archive fault');
    await appendStep(page, 'Archive fault', 'Do it');
    await completeStep(page, 'Archive fault', 'Do it').click();
    await expect(status(page)).toHaveAttribute('data-save-state', 'saved');
    await finishDay(page);

    await gotoProgress(page);
    const entry = projectRow(page, 'Archive fault').getByTestId('pp-entry');
    await expect(entry).toHaveCount(1);
    await page.waitForTimeout(500);
    await entry.getByTestId('pp-entry-edit').click();
    await page.getByTestId('pp-entry-edit-input').fill('Must not persist');
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
    await page.getByTestId('pp-entry-edit-save').click();
    await expect(status(page)).toHaveAttribute('data-save-state', 'failed');
    await expect(page.getByTestId('pp-entry-edit-input')).toHaveText('Must not persist');

    await page.reload();
    await expect(page.getByTestId('pp-page')).toBeVisible({ timeout: 30_000 });
    await selectProject(page, 'Archive fault');
    await expect(
      projectRow(page, 'Archive fault')
        .getByTestId('pp-entry-body')
        .filter({ hasText: 'Do it' }),
    ).toBeVisible();
    await expect(
      projectRow(page, 'Archive fault')
        .getByTestId('pp-entry-body')
        .filter({ hasText: 'Must not persist' }),
    ).toHaveCount(0);
  });

  test('restores a past archived record into archiveOld, edits and re-exports it', async ({
    page,
    browser,
  }) => {
    const exportPath = path.join(
      process.cwd(),
      '.tmp',
      'e2e-personal-progress',
      'archive-old-export.json',
    );
    fs.mkdirSync(path.dirname(exportPath), { recursive: true });

    await gotoProgress(page);
    await createProject(page, 'Archived old');
    await selectProject(page, 'Archived old');
    await appendStep(page, 'Archived old', 'Old work');
    await completeStep(page, 'Archived old', 'Old work').click();
    await expect(status(page)).toHaveAttribute('data-save-state', 'saved');
    await finishDay(page);

    await gotoProgress(page);
    await expect(projectRow(page, 'Archived old').getByTestId('pp-entry')).toHaveCount(1);
    const downloadPromise = page.waitForEvent('download');
    await exportPersonalBackup(page);
    await (await downloadPromise).saveAs(exportPath);

    const backup = JSON.parse(fs.readFileSync(exportPath, 'utf8')) as {
      data: {
        archiveYoung: { task: { ids: string[]; entities: Record<string, unknown> } };
        archiveOld: { task: { ids: string[]; entities: Record<string, unknown> } };
      };
    };
    const young = backup.data.archiveYoung;
    const old = backup.data.archiveOld;
    old.task.ids = [...old.task.ids, ...young.task.ids];
    old.task.entities = { ...old.task.entities, ...young.task.entities };
    for (const id of young.task.ids) {
      const task = old.task.entities[id] as {
        doneOn?: number;
        personalProgress?: { entries: { recordDay: string }[] };
      };
      task.doneOn = new Date('2025-01-10T12:00:00Z').getTime();
      for (const entry of task.personalProgress?.entries ?? []) {
        entry.recordDay = '2025-01-10';
      }
    }
    young.task.ids = [];
    young.task.entities = {};
    fs.writeFileSync(exportPath, JSON.stringify(backup), 'utf8');

    page.once('dialog', (dialog) => dialog.accept());
    await restorePersonalBackup(page, exportPath);
    await page.reload();
    await expect(page.getByTestId('pp-page')).toBeVisible({ timeout: 30_000 });
    await selectProject(page, 'Archived old');
    const pastEntries = projectRow(page, 'Archived old').getByTestId('pp-entry');
    await expect(pastEntries).toHaveCount(1);
    await expect(
      projectRow(page, 'Archived old').getByTestId('pp-entry-edit'),
    ).toHaveCount(1);

    await pastEntries.getByTestId('pp-entry-edit').click();
    await page.getByTestId('pp-entry-edit-input').fill('Old archive edited');
    await page.getByTestId('pp-entry-edit-save').click();
    await expect(status(page)).toHaveAttribute('data-save-state', 'saved');
    await page.reload();
    await expect(page.getByTestId('pp-page')).toBeVisible({ timeout: 30_000 });
    await selectProject(page, 'Archived old');
    await expect(
      projectRow(page, 'Archived old')
        .getByTestId('pp-entry-body')
        .filter({ hasText: 'Old archive edited' }),
    ).toBeVisible();
    await expect(
      projectRow(page, 'Archived old').getByTestId('pp-step-title'),
    ).toHaveCount(0);

    // Export the edited archiveOld record and restore it into an independent profile.
    const exportAfterEdit = path.join(
      path.dirname(exportPath),
      'archive-old-edited.json',
    );
    const download2 = page.waitForEvent('download');
    await exportPersonalBackup(page);
    await (await download2).saveAs(exportAfterEdit);
    const context2 = await browser.newContext({ locale: 'zh-CN' });
    const page2 = await context2.newPage();
    await page2.addInitScript(() => {
      localStorage.setItem('SUP_ONBOARDING_PRESET_DONE', 'true');
      localStorage.setItem('SUP_ONBOARDING_HINTS_DONE', 'true');
      localStorage.setItem('SUP_IS_SHOW_TOUR', 'true');
      localStorage.setItem('SUP_EXAMPLE_TASKS_CREATED', 'true');
    });
    await page2.goto('/#/personal-progress');
    await expect(page2.getByTestId('pp-page')).toBeVisible({ timeout: 30_000 });
    page2.once('dialog', (dialog) => dialog.accept());
    await restorePersonalBackup(page2, exportAfterEdit);
    await page2.reload();
    await expect(page2.getByTestId('pp-page')).toBeVisible({ timeout: 30_000 });
    await expect(
      page2.getByTestId('pp-project-row').filter({ hasText: 'Archived old' }),
    ).toBeVisible();
    await context2.close();
  });
});
