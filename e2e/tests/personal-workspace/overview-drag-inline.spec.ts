import { expect, test } from '../../fixtures/test.fixture';
import { setProjectQuadrant } from '../../utils/personal-progress-helpers';

test('dragging a project name immediately after pressing moves it', async ({ page }) => {
  await page.goto('/#/personal-progress');
  for (const name of ['拖动一', '拖动二']) {
    if (!(await page.getByTestId('pp-new-project-input').isVisible())) {
      await page.getByTestId('pp-show-create').click();
    }
    await page.getByTestId('pp-new-project-input').fill(name);
    await page.getByTestId('pp-create-project').click();
    await expect(page.getByTestId('pp-show-create')).toHaveAttribute(
      'aria-expanded',
      'false',
    );
    await expect(
      page.getByTestId('pp-project-row').filter({ hasText: name }),
    ).toBeVisible();
  }
  await page.goto('/#/personal-overview');
  const rows = page.getByTestId('po-unclassified').getByTestId('po-project-row');
  const source = rows.filter({ hasText: '拖动二' }).getByTestId('po-project-name');
  const target = rows.filter({ hasText: '拖动一' });
  await source.scrollIntoViewIfNeeded();
  const from = await source.boundingBox();
  const to = await target.boundingBox();
  expect(from).not.toBeNull();
  expect(to).not.toBeNull();
  const halfWidth = from!.width / 2;
  const halfHeight = from!.height / 2;
  const targetHalfWidth = to!.width / 2;
  await page.mouse.move(from!.x + halfWidth, from!.y + halfHeight);
  await page.mouse.down();
  await page.mouse.move(to!.x + targetHalfWidth, to!.y + 5, { steps: 8 });
  await page.mouse.up();
  await expect(page.getByTestId('po-status')).toHaveAttribute('data-save-state', 'saved');
  await expect(rows.getByTestId('po-project-name')).toContainText(['拖动二', '拖动一']);
});

test('double clicking today text in an unselected project opens its editor', async ({
  page,
}) => {
  await page.goto('/#/personal-progress');
  if (!(await page.getByTestId('pp-new-project-input').isVisible())) {
    await page.getByTestId('pp-show-create').click();
  }
  await page.getByTestId('pp-new-project-input').fill('第一项目');
  await page.getByTestId('pp-create-project').click();
  await expect(page.getByTestId('pp-show-create')).toHaveAttribute(
    'aria-expanded',
    'false',
  );
  const first = page.getByTestId('pp-project-row').filter({ hasText: '第一项目' });
  await expect(first).toBeVisible();
  if (!(await page.getByTestId('pp-entry-input').isVisible())) {
    await page.getByTestId('pp-backfill').click();
  }
  await page.getByTestId('pp-entry-input').fill('今天做过的事');
  await page.getByTestId('pp-add-entry').click();
  await expect(page.getByTestId('pp-entry-input')).toBeHidden();
  await expect(first.getByTestId('pp-entry-body')).toContainText('今天做过的事');
  if (!(await page.getByTestId('pp-new-project-input').isVisible())) {
    await page.getByTestId('pp-show-create').click();
  }
  await page.getByTestId('pp-new-project-input').fill('第二项目');
  await page.getByTestId('pp-create-project').click();
  await expect(page.getByTestId('pp-show-create')).toHaveAttribute(
    'aria-expanded',
    'false',
  );
  await expect(
    page.getByTestId('pp-project-row').filter({ hasText: '第二项目' }),
  ).toHaveClass(/is-selected/);
  await first.getByTestId('pp-entry-body').dblclick();
  await expect(page.getByTestId('pp-entry-edit-input')).toBeVisible();
});

test('long press reorders within a quadrant and persists after reload', async ({
  page,
}) => {
  await page.goto('/#/personal-progress');
  for (const name of ['排序甲', '排序乙', '排序丙']) {
    if (!(await page.getByTestId('pp-new-project-input').isVisible())) {
      await page.getByTestId('pp-show-create').click();
    }
    await page.getByTestId('pp-new-project-input').fill(name);
    await page.getByTestId('pp-create-project').click();
    await expect(page.getByTestId('pp-show-create')).toHaveAttribute(
      'aria-expanded',
      'false',
    );
    await expect(
      page.getByTestId('pp-project-row').filter({ hasText: name }),
    ).toBeVisible();
    await setProjectQuadrant(page, name, 'urgent-important');
  }
  await page.goto('/#/personal-overview');
  const group = page.getByTestId('po-quadrant').filter({ hasText: '排序甲' });
  const rows = group.getByTestId('po-project-row');
  const from = await rows.filter({ hasText: '排序丙' }).boundingBox();
  const to = await rows.filter({ hasText: '排序甲' }).boundingBox();
  expect(from).not.toBeNull();
  expect(to).not.toBeNull();
  await page.mouse.move(from!.x + 180, from!.y + from!.height - 8);
  await page.mouse.down();
  await page.waitForTimeout(350);
  await page.mouse.move(to!.x + 180, to!.y + 5, { steps: 15 });
  await expect(page.locator('.cdk-drag-preview')).toHaveCount(1);
  await page.mouse.up();
  await expect(page.getByTestId('po-status')).toHaveAttribute('data-save-state', 'saved');
  await expect(rows.getByTestId('po-project-name')).toContainText([
    '排序丙',
    '排序甲',
    '排序乙',
  ]);
  await page.reload();
  await expect(
    page
      .getByTestId('po-quadrant')
      .filter({ hasText: '排序甲' })
      .getByTestId('po-project-name'),
  ).toContainText(['排序丙', '排序甲', '排序乙']);
  await page.screenshot({ path: test.info().outputPath('overview.png') });
  await page.goto('/#/personal-backup');
  await expect(page.getByTestId('pb-page')).toHaveCount(1);
  await expect(page.getByTestId('pb-page')).toBeVisible();
  const download = page.waitForEvent('download');
  await page.getByTestId('pb-export').click();
  const backup = test.info().outputPath('overview-backup.json');
  await (await download).saveAs(backup);
  await page.goto('/#/personal-overview');
  const moved = group.getByTestId('po-project-row').filter({ hasText: '排序乙' });
  await moved.focus();
  await page.keyboard.press('Alt+ArrowUp');
  await expect(page.getByTestId('po-status')).toHaveAttribute('data-save-state', 'saved');
  await expect(group.getByTestId('po-project-name')).toContainText([
    '排序丙',
    '排序乙',
    '排序甲',
  ]);
  await page.goto('/#/personal-backup');
  await expect(page.getByTestId('pb-page')).toHaveCount(1);
  await expect(page.getByTestId('pb-page')).toBeVisible();
  page.once('dialog', (dialog) => dialog.accept());
  await page.getByTestId('pb-restore-input').setInputFiles(backup);
  await expect(page.getByTestId('pb-status')).toHaveAttribute(
    'data-save-state',
    'restored',
  );
  await page.goto('/#/personal-overview');
  await expect(group.getByTestId('po-project-name')).toContainText([
    '排序丙',
    '排序甲',
    '排序乙',
  ]);
});

test('double click edits today and history in a spacious panel', async ({ page }) => {
  await page.goto('/#/personal-progress');
  if (!(await page.getByTestId('pp-new-project-input').isVisible())) {
    await page.getByTestId('pp-show-create').click();
  }
  await page.getByTestId('pp-new-project-input').fill('直接编辑测试');
  await page.getByTestId('pp-create-project').click();
  await expect(page.getByTestId('pp-show-create')).toHaveAttribute(
    'aria-expanded',
    'false',
  );
  const row = page.getByTestId('pp-project-row').filter({ hasText: '直接编辑测试' });
  await expect(row).toBeVisible();
  const cell = row.getByTestId('pp-today-cell');
  await cell.click();
  await expect(row).toHaveClass(/is-selected/);
  await expect(page.getByTestId('pp-inline-entry-input')).toHaveCount(0);
  await cell.dblclick();
  const editor = page.getByTestId('pp-inline-entry-input');
  await expect(editor).toBeFocused();
  const toolbar = page.getByTestId('pp-inline-new').locator('.pt-toolbar');
  await expect(toolbar.getByTestId('pt-color-toggle')).toBeVisible();
  expect(await toolbar.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);
  await editor.fill('今日事项');
  await page.keyboard.press('Control+A');
  await page.getByTestId('pp-inline-new').getByTestId('pt-bold').click();
  await page.screenshot({ path: test.info().outputPath('inline-editor.png') });
  await page.getByTestId('pp-inline-save').click();
  await expect(row.getByTestId('pp-entry-body')).toContainText('今日事项');
  await expect(row.getByTestId('pp-entry-body')).toHaveClass(/pt-bold/);
  await row.getByTestId('pp-entry-body').dblclick();
  await page.getByTestId('pp-entry-edit-input').fill('修改后事项');
  await page.getByTestId('pp-entry-edit-save').click();
  await expect(row.getByTestId('pp-entry-body')).toContainText('修改后事项');
  if (!(await page.getByTestId('pp-entry-day').isVisible())) {
    await page.getByTestId('pp-backfill').click();
  }
  await page.getByTestId('pp-entry-day').fill('2025-01-01');
  if (!(await page.getByTestId('pp-entry-input').isVisible())) {
    await page.getByTestId('pp-backfill').click();
  }
  await page.getByTestId('pp-entry-input').fill('历史事项');
  await page.getByTestId('pp-add-entry').click();
  await expect(page.getByTestId('pp-entry-input')).toBeHidden();
  await expect(
    row.getByTestId('pp-entry-body').filter({ hasText: '历史事项' }),
  ).toBeVisible();
  await row.getByTestId('pp-entry-body').filter({ hasText: '历史事项' }).dblclick();
  await expect(page.getByTestId('pp-history-toggle')).toHaveCount(0);
  await expect(page.getByTestId('pp-editor-panel')).toBeVisible();
  const panelBox = await page.getByTestId('pp-editor-panel').boundingBox();
  expect(panelBox!.width).toBeGreaterThan(300);
  await page.getByTestId('pp-entry-edit-input').fill('历史已修改');
  await page.getByTestId('pp-entry-edit-save').click();
  await expect(row.getByTestId('pp-entry-body')).toContainText([
    '历史已修改',
    '修改后事项',
  ]);
  await page.reload();
  await expect(row.getByTestId('pp-entry-body')).toContainText([
    '历史已修改',
    '修改后事项',
  ]);
});

test('an unfinished draft is protected when opening the inline editor from keyboard', async ({
  page,
}) => {
  await page.goto('/#/personal-progress');
  if (!(await page.getByTestId('pp-new-project-input').isVisible())) {
    await page.getByTestId('pp-show-create').click();
  }
  await page.getByTestId('pp-new-project-input').fill('草稿保护测试');
  await page.getByTestId('pp-create-project').click();
  await expect(page.getByTestId('pp-show-create')).toHaveAttribute(
    'aria-expanded',
    'false',
  );
  const row = page.getByTestId('pp-project-row').filter({ hasText: '草稿保护测试' });
  await expect(row).toBeVisible();
  if (!(await page.getByTestId('pp-entry-input').isVisible())) {
    await page.getByTestId('pp-backfill').click();
  }
  await page.getByTestId('pp-entry-input').fill('尚未保存');
  await row.getByTestId('pp-today-cell').focus();
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('pp-draft-prompt')).toBeVisible();
  await page.getByTestId('pp-draft-continue').click();
  await expect(page.getByTestId('pp-entry-input')).toHaveText('尚未保存');
  await expect(page.getByTestId('pp-inline-entry-input')).toHaveCount(0);
});

test('a narrow window with many dates keeps the editor usable', async ({ page }) => {
  await page.setViewportSize({ width: 1000, height: 680 });
  await page.goto('/#/personal-progress');
  if (!(await page.getByTestId('pp-new-project-input').isVisible())) {
    await page.getByTestId('pp-show-create').click();
  }
  await page.getByTestId('pp-new-project-input').fill('窄窗口测试');
  await page.getByTestId('pp-create-project').click();
  await expect(page.getByTestId('pp-show-create')).toHaveAttribute(
    'aria-expanded',
    'false',
  );
  const row = page.getByTestId('pp-project-row').filter({ hasText: '窄窗口测试' });
  for (const day of ['2025-01-01', '2025-01-02', '2025-01-03', '2025-01-04']) {
    if (!(await page.getByTestId('pp-entry-day').isVisible())) {
      await page.getByTestId('pp-backfill').click();
    }
    await page.getByTestId('pp-entry-day').fill(day);
    if (!(await page.getByTestId('pp-entry-input').isVisible())) {
      await page.getByTestId('pp-backfill').click();
    }
    await page.getByTestId('pp-entry-input').fill('记录 ' + day);
    await page.getByTestId('pp-add-entry').click();
    await expect(page.getByTestId('pp-entry-input')).toBeHidden();
    await expect(page.getByTestId('pp-status')).toHaveAttribute(
      'data-save-state',
      'saved',
    );
  }
  const entry = row.getByTestId('pp-entry-body').filter({ hasText: '记录 2025-01-01' });
  await entry.dblclick();
  const panel = page.getByTestId('pp-editor-panel');
  const box = await panel.boundingBox();
  expect(box).not.toBeNull();
  expect(box!.width).toBeGreaterThanOrEqual(400);
  expect(box!.x).toBeGreaterThanOrEqual(0);
  expect(box!.x + box!.width).toBeLessThanOrEqual(1000);
  await expect(panel.getByTestId('pt-bold')).toBeVisible();
  await expect(panel.getByTestId('pt-color-toggle')).toBeVisible();
  await page.screenshot({ path: test.info().outputPath('narrow-history-editor.png') });
  await panel.getByTestId('pp-entry-edit-input').fill('窄窗口已修改');
  await panel.getByTestId('pp-entry-edit-save').click();
  await expect(
    row.getByTestId('pp-entry-body').filter({ hasText: '窄窗口已修改' }),
  ).toBeVisible();
  await page.reload();
  await expect(
    row.getByTestId('pp-entry-body').filter({ hasText: '窄窗口已修改' }),
  ).toBeVisible();
});

test('compact creation, record button and backfill remain usable', async ({ page }) => {
  await page.goto('/#/personal-progress');
  await expect(page.getByTestId('pp-new-project-input')).toBeHidden();
  await page.getByTestId('pp-show-create').click();
  await page.getByTestId('pp-new-project-input').fill('新版布局');
  await page.getByTestId('pp-new-project-day').fill('2099-01-01');
  await page.getByTestId('pp-create-project').click();
  await expect(page.getByTestId('pp-show-create')).toHaveAttribute(
    'aria-expanded',
    'false',
  );
  const row = page.getByTestId('pp-project-row').filter({ hasText: '新版布局' });
  await expect(row).toContainText('2099-01-01');
  await expect(page.getByTestId('pp-new-project-input')).toBeHidden();
  await expect(page.getByTestId('pp-entry-input')).toBeHidden();
  await row.getByTestId('pp-add-today').click();
  await page.getByTestId('pp-inline-entry-input').fill('今天已完成');
  await page.getByTestId('pp-inline-save').click();
  await expect(row.getByTestId('pp-entry-body')).toContainText('今天已完成');
  await page.getByTestId('pp-backfill').click();
  await expect(page.getByTestId('pp-entry-day')).toBeFocused();
  await page.getByTestId('pp-entry-day').fill('2025-01-01');
  await page.getByTestId('pp-entry-input').fill('之前已完成');
  await page.getByTestId('pp-close-manual').click();
  await expect(page.getByTestId('pp-draft-prompt')).toBeVisible();
  await page.getByTestId('pp-draft-continue').click();
  await expect(page.getByTestId('pp-entry-input')).toHaveText('之前已完成');
  await page.getByTestId('pp-add-entry').click();
  await expect(page.getByTestId('pp-entry-input')).toBeHidden();
  await expect(row.getByTestId('pp-entry-body')).toContainText([
    '之前已完成',
    '今天已完成',
  ]);
  await expect(page.getByTestId('pp-entry-input')).toBeHidden();
  await page.reload();
  await expect(row.getByTestId('pp-entry-body')).toContainText([
    '之前已完成',
    '今天已完成',
  ]);
});

test('opening an existing entry closes an empty backfill editor', async ({ page }) => {
  await page.goto('/#/personal-progress');
  await page.getByTestId('pp-show-create').click();
  await page.getByTestId('pp-new-project-input').fill('编辑区切换');
  await page.getByTestId('pp-create-project').click();
  const row = page.getByTestId('pp-project-row').filter({ hasText: '编辑区切换' });
  await row.getByTestId('pp-add-today').click();
  await page.getByTestId('pp-inline-entry-input').fill('已有完成记录');
  await page.getByTestId('pp-inline-save').click();
  await expect(row.getByTestId('pp-entry-body')).toContainText('已有完成记录');
  await page.getByTestId('pp-backfill').click();
  await expect(page.getByTestId('pp-entry-day')).toBeFocused();
  await row.getByTestId('pp-entry-edit').focus();
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('pp-entry-edit-input')).toBeVisible();
  await expect(page.getByTestId('pp-entry-day')).toHaveCount(0);
});
