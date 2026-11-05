import { readFileSync, writeFileSync } from 'node:fs';
import { expect, test } from '../../fixtures/test.fixture';
import type { Locator, Page } from '@playwright/test';

const fixturePath =
  'G:/project1/repos/project1-desktop/e2e/fixtures/test-backup-with-archives.json';
const projectRow = (page: Page, name: string): Locator =>
  page.getByTestId('pp-project-row').filter({ hasText: name });
const editorFor = (page: Page, id: string): Locator =>
  page.getByTestId(id).locator('xpath=ancestor::personal-rich-text-editor[1]');
const formatted = (text: string): any => ({
  version: 1,
  runs: [{ text, bold: true, color: 'blue' }],
});
const readData = (path: string): Record<string, any> =>
  JSON.parse(readFileSync(path, 'utf8')).data as Record<string, any>;

test('complete backup round-trip covers five nonempty sections and formats', async ({
  page,
}) => {
  await page.goto('/#/personal-progress');
  await expect(page.getByTestId('pp-page')).toBeVisible({ timeout: 30_000 });
  if (!(await page.getByTestId('pp-new-project-input').isVisible())) {
    await page.getByTestId('pp-show-create').click();
  }
  await page.getByTestId('pp-new-project-input').fill('Active Format');
  await page.getByTestId('pp-create-project').click();
  const row = projectRow(page, 'Active Format');
  await expect(row).toBeVisible();
  await row.getByTestId('pp-project-title').click();
  await row.getByTestId('pp-append-step').click();
  await page.getByTestId('pp-insert-input').fill('Active step');
  await page.getByTestId('pp-insert-save').click();
  await expect(page.getByTestId('pp-status')).toHaveAttribute('data-save-state', 'saved');
  await row.getByTestId('pp-step-edit').click();
  const stepEditor = editorFor(page, 'pp-step-edit-input');
  await stepEditor.locator('.cm-content').click();
  await page.keyboard.press('Control+A');
  await stepEditor.getByTestId('pt-bold').click();
  await stepEditor.getByTestId('pt-color-toggle').click();
  await stepEditor.getByTestId('pt-color-blue').click();
  await page.getByTestId('pp-step-edit-save').click();
  await expect(page.getByTestId('pp-step-edit-input')).toBeHidden();
  await expect(row.getByTestId('pp-step-title').locator('.pt-bold')).toBeVisible();
  await expect(page.getByTestId('pp-status')).toHaveAttribute('data-save-state', 'saved');

  await page.goto('/#/personal-backup');
  await expect(page.getByTestId('pb-page')).toBeVisible({ timeout: 30_000 });
  const exportBackup = async (name: string): Promise<string> => {
    const target = test.info().outputPath(name);
    const download = page.waitForEvent('download');
    await page.getByTestId('pb-export').click();
    await (await download).saveAs(target);
    await expect(page.getByTestId('pb-status')).toHaveAttribute(
      'data-save-state',
      'saved',
    );
    return target;
  };
  const basePath = await exportBackup('base-backup.json');
  const base = readData(basePath);
  const fixture = JSON.parse(readFileSync(fixturePath, 'utf8')) as Record<string, any>;
  base.archiveYoung = JSON.parse(JSON.stringify(fixture.data.archiveYoung));
  base.archiveOld = JSON.parse(JSON.stringify(fixture.data.archiveOld));
  const youngId = base.archiveYoung.task.ids[0];
  const oldId = base.archiveOld.task.ids[0];
  base.archiveYoung.task.entities[youngId].personalProgress = {
    schemaVersion: 1,
    entries: [],
    completions: [],
    stepFormat: formatted(base.archiveYoung.task.entities[youngId].title),
  };
  base.archiveOld.task.entities[oldId].personalProgress = {
    schemaVersion: 1,
    entries: [],
    completions: [],
    stepFormat: formatted(base.archiveOld.task.entities[oldId].title),
  };
  expect(base.project.ids.length).toBeGreaterThan(0);
  expect(base.task.ids.length).toBeGreaterThan(0);
  expect(base.archiveYoung.task.ids.length).toBeGreaterThan(0);
  expect(base.archiveOld.task.ids.length).toBeGreaterThan(0);
  expect(Object.keys(base.globalConfig).length).toBeGreaterThan(0);

  const syntheticPath = test.info().outputPath('five-part-with-format.json');
  writeFileSync(syntheticPath, JSON.stringify({ ...fixture, data: base }, null, 2));
  const restore = async (file: string, expected = 'restored'): Promise<void> => {
    page.once('dialog', (dialog) => dialog.accept());
    await page.getByTestId('pb-restore-input').setInputFiles(file);
    await expect(page.getByTestId('pb-status')).toHaveAttribute(
      'data-save-state',
      expected,
      { timeout: 30_000 },
    );
  };
  await restore(syntheticPath);
  const restored = readData(await exportBackup('restored-five-part.json'));
  for (const section of [
    'project',
    'task',
    'archiveYoung',
    'archiveOld',
    'globalConfig',
  ]) {
    expect(restored[section], section).toBeTruthy();
  }
  expect(restored.task.ids.length).toBeGreaterThan(0);
  expect(restored.project.ids.length).toBeGreaterThan(0);
  expect(restored.archiveYoung.task.ids.length).toBeGreaterThan(0);
  expect(restored.archiveOld.task.ids.length).toBeGreaterThan(0);
  expect(Object.keys(restored.globalConfig).length).toBeGreaterThan(0);

  const canonical = (value: Record<string, any>, key: string): any => {
    const copy = JSON.parse(JSON.stringify(value[key]));
    if (key === 'task' || key === 'project') {
      if (key === 'task') {
        for (const task of Object.values(copy.entities) as any[]) {
          if (!task.isDone) delete task.modified;
        }
      }
      return { ids: copy.ids, entities: copy.entities };
    }
    return copy;
  };
  for (const section of [
    'project',
    'task',
    'archiveYoung',
    'archiveOld',
    'globalConfig',
  ]) {
    expect(canonical(restored, section)).toEqual(canonical(base, section));
  }
  expect(
    restored.archiveYoung.task.entities[youngId].personalProgress.stepFormat,
  ).toEqual(base.archiveYoung.task.entities[youngId].personalProgress.stepFormat);
  expect(restored.archiveOld.task.entities[oldId].personalProgress.stepFormat).toEqual(
    base.archiveOld.task.entities[oldId].personalProgress.stepFormat,
  );

  // An older client may edit title without knowing its optional format metadata.
  // This is legal: preserve both on restore, then show the current plain title.
  const staleBackup = JSON.parse(JSON.stringify({ ...fixture, data: base }));
  const activeId = base.task.ids[0];
  staleBackup.data.task.entities[activeId].title = 'Updated by an older client';
  const stalePath = test.info().outputPath('stale-but-valid.json');
  writeFileSync(stalePath, JSON.stringify(staleBackup));
  await restore(stalePath);
  const staleRoundTrip = readData(await exportBackup('stale-round-trip.json'));
  expect(staleRoundTrip.task.entities[activeId].title).toBe('Updated by an older client');
  expect(staleRoundTrip.task.entities[activeId].personalProgress.stepFormat).toEqual(
    base.task.entities[activeId].personalProgress.stepFormat,
  );
  await page.goto('/#/personal-progress');
  await expect(page.getByTestId('pp-page')).toBeVisible({ timeout: 30000 });
  await projectRow(page, 'Active Format').getByTestId('pp-project-title').click();
  const staleStep = page
    .getByTestId('pp-step-title')
    .filter({ hasText: 'Updated by an older client' });
  await expect(staleStep).toBeVisible();
  await expect(staleStep.locator('.pt-bold')).toHaveCount(0);
  await page.goto('/#/personal-backup');
  await expect(page.getByTestId('pb-page')).toBeVisible({ timeout: 30000 });
  await restore(syntheticPath);

  const malformed = test.info().outputPath('malformed.json');
  writeFileSync(malformed, '{"broken":', 'utf8');
  await restore(malformed, 'error');
  const afterBad = readData(await exportBackup('after-bad.json'));
  expect(afterBad.archiveOld.task.ids).toEqual(base.archiveOld.task.ids);

  const unsupported = JSON.parse(JSON.stringify({ ...fixture, data: base }));
  unsupported.data.archiveOld.task.entities[oldId].personalProgress.stepFormat.version =
    999;
  const unsupportedPath = test.info().outputPath('unsupported-version.json');
  writeFileSync(unsupportedPath, JSON.stringify(unsupported, null, 2));
  await restore(unsupportedPath, 'error');
  const afterUnsupported = readData(await exportBackup('after-unsupported.json'));
  expect(afterUnsupported.archiveOld.task.ids).toEqual(base.archiveOld.task.ids);

  const oldBackup = JSON.parse(JSON.stringify({ ...fixture, data: base }));
  const stripFormats = (value: unknown): void => {
    if (!value || typeof value !== 'object') return;
    delete (value as Record<string, unknown>).bodyFormat;
    delete (value as Record<string, unknown>).stepFormat;
    for (const child of Object.values(value)) stripFormats(child);
  };
  stripFormats(oldBackup.data);
  const oldPath = test.info().outputPath('old-no-format.json');
  writeFileSync(oldPath, JSON.stringify(oldBackup, null, 2));
  await restore(oldPath);
  const oldData = readData(await exportBackup('restored-old.json'));
  expect(
    oldData.task.entities[base.task.ids[0]].personalProgress?.stepFormat,
  ).toBeUndefined();
  expect(
    oldData.archiveOld.task.entities[oldId].personalProgress?.stepFormat,
  ).toBeUndefined();
});
