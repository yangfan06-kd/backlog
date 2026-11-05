import { test, expect } from '../../fixtures/test.fixture';
import type { Page, Locator } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() =>
    Object.defineProperty(window, 'ea', {
      configurable: true,
      value: { isPreviewMode: () => true },
    }),
  );
  await page.reload();
  await expect(page.locator('.app-container.is-preview-mode')).toBeVisible();
});

const drag = async (
  page: Page,
  source: Locator,
  target: Locator,
  down = false,
): Promise<void> => {
  await source.scrollIntoViewIfNeeded();
  const a = (await source.boundingBox())!,
    b = (await target.boundingBox())!;
  await page.mouse.move(a.x + 15, a.y + 10);
  await page.mouse.down();
  await page.mouse.move(b.x + 15, down ? b.y + b.height - 2 : b.y + 2, { steps: 14 });
  await page.mouse.up();
};
const project = async (page: Page, title: string): Promise<Locator> => {
  await page.getByTestId('pp-show-create').click();
  await page.getByTestId('pp-new-project-input').fill(title);
  await page.getByTestId('pp-create-project').click();
  await expect(page.getByTestId('pp-new-project-input')).toBeHidden();
  return page.getByTestId('pp-project-row').filter({ hasText: title });
};
const routine = async (page: Page, title: string): Promise<Locator> => {
  await page.getByTestId('pr-new-item-title').fill(title);
  await page.getByTestId('pr-create-item').click();
  await expect(page.getByTestId('pr-new-item-title')).toHaveValue('');
  return page.getByTestId('pr-item-row').filter({ hasText: title });
};
const memo = async (page: Page, text: string): Promise<Locator> => {
  await page.getByTestId('memo-new').click();
  await page.getByTestId('memo-input').fill(text);
  await page.getByTestId('memo-save').click();
  await expect(page.getByTestId('memo-input')).toHaveCount(0);
  return page.getByTestId('memo-card').filter({ hasText: text });
};

test('project rows reorder separately from records and keep both orders after reload', async ({
  page,
}) => {
  await page.goto('/#/personal-progress');
  const a = await project(page, '项目甲'),
    b = await project(page, '项目乙');
  for (const text of ['记录甲', '记录乙']) {
    await b.getByTestId('pp-add-today').click();
    await page.getByTestId('pp-inline-entry-input').fill(text);
    await page.getByTestId('pp-inline-save').click();
    await expect(page.getByTestId('pp-inline-entry-input')).toBeHidden();
  }
  await drag(
    page,
    a.getByTestId('pp-project-title'),
    b.getByTestId('pp-project-title'),
    true,
  );
  await expect(page.getByTestId('pp-project-title')).toHaveText(['项目乙', '项目甲']);
  const bodies = b.getByTestId('pp-entry-body');
  await drag(page, bodies.nth(1), bodies.nth(0));
  await expect(bodies).toHaveText(['记录乙', '记录甲']);
  await page.reload();
  await expect(page.getByTestId('pp-project-title')).toHaveText(['项目乙', '项目甲']);
  await expect(bodies).toHaveText(['记录乙', '记录甲']);
  await a.getByTestId('pp-project-title').press('Alt+ArrowUp');
  await expect(page.getByTestId('pp-project-title')).toHaveText(['项目甲', '项目乙']);
});

test('routine records use a nearby editor and support row and same-day ordering', async ({
  page,
}) => {
  await page.goto('/#/personal-routine');
  const a = await routine(page, '事项甲'),
    b = await routine(page, '事项乙');
  await expect(page.getByTestId('pr-editor')).toHaveCount(0);
  for (const text of ['观察甲', '观察乙']) {
    await a.getByTestId('pr-record').click();
    await expect(page.getByTestId('pr-editor')).toBeVisible();
    await page.getByTestId('pr-entry-body').fill(text);
    await page.getByTestId('pr-save-entry').click();
    await expect(page.getByTestId('pr-editor')).toHaveCount(0);
  }
  const entries = a.locator('.pr-entry-body');
  await drag(page, entries.nth(1), entries.nth(0));
  await expect(entries).toHaveText(['观察乙', '观察甲']);
  await entries.nth(0).dblclick();
  await expect(page.getByTestId('pr-editor')).toBeVisible();
  await expect(page.getByTestId('pr-page').getByTestId('pr-editor')).toHaveCount(0);
  await page.getByTestId('pr-entry-body').fill('修改后的观察乙');
  await page.getByTestId('pr-save-entry').click();
  await expect(entries).toHaveText(['修改后的观察乙', '观察甲']);
  await drag(page, b.getByTestId('pr-item-name'), a.getByTestId('pr-item-name'));
  await expect(page.getByTestId('pr-item-name')).toHaveText(['事项乙', '事项甲']);
  await page.reload();
  await expect(page.getByTestId('pr-item-name')).toHaveText(['事项乙', '事项甲']);
  await expect(entries).toHaveText(['修改后的观察乙', '观察甲']);
  await a.getByTestId('pr-item-name').click();
  await page.getByTestId('pr-backfill').click();
  await page.getByTestId('pr-entry-day').fill('2020-01-01');
  await page.getByTestId('pr-entry-day').press('Tab');
  await page.getByTestId('pr-entry-body').fill('早期记录');
  await page.getByTestId('pr-save-entry').click();
  await expect(page.getByTestId('pr-editor')).toHaveCount(0);
  await page.getByTestId('pr-backfill').click();
  await page.getByTestId('pr-entry-day').fill('2020-01-01');
  await page.getByTestId('pr-entry-day').press('Tab');
  await expect(page.getByTestId('pr-day-entry-body')).toContainText('早期记录');
  await page.getByTestId('pr-edit-entry').click();
  await expect(page.getByTestId('pr-entry-body')).toContainText('早期记录');
  await page.getByTestId('pr-cancel-entry').click();
});

test('memos edit in the original card, preserve identity, switch reminders and reorder', async ({
  page,
}) => {
  await page.goto('/#/personal-memo');
  const a = await memo(page, '备忘甲'),
    b = await memo(page, '备忘乙');
  const id = await a.getAttribute('data-note-id');
  const stable = page.locator(`[data-note-id="${id}"]`);
  await stable.getByTestId('memo-edit').click();
  await expect(stable.getByTestId('memo-input')).toBeVisible();
  await expect(page.locator('.memo-editor')).toHaveCount(0);
  await stable.getByTestId('memo-input').fill('原卡片修改');
  await stable.getByTestId('memo-reminder-enabled').check();
  const time = await page.evaluate(() => {
    const d = new Date(Date.now() + 3600000);
    const offset = d.getTimezoneOffset() * 60000;
    return new Date(d.getTime() - offset).toISOString().slice(0, 16);
  });
  await stable.getByTestId('memo-time').fill(time);
  await stable.getByTestId('memo-advance').selectOption({ label: '5 分钟' });
  await stable.getByTestId('memo-save').click();
  const edited = page.locator(`[data-note-id="${id}"]`);
  await expect(edited.locator('.memo-preview')).toHaveText('原卡片修改');
  await expect(edited.locator('time')).toHaveCount(1);
  await edited.getByTestId('memo-edit').click();
  await expect(edited.getByTestId('memo-reminder-enabled')).toBeChecked();
  await edited.getByTestId('memo-reminder-enabled').uncheck();
  await edited.getByTestId('memo-save').click();
  await expect(edited.locator('time')).toHaveCount(0);
  await drag(page, edited.locator('.memo-preview'), b.locator('.memo-preview'));
  await expect(page.locator('.memo-preview')).toHaveText(['原卡片修改', '备忘乙']);
  await page.reload();
  await expect(page.locator('.memo-preview')).toHaveText(['原卡片修改', '备忘乙']);
  await expect(page.getByTestId('memo-tab-active')).toHaveText('全部备忘');
  await page.getByTestId('memo-new').hover();
  await expect
    .poll(() => page.getByTestId('memo-new').evaluate((el) => getComputedStyle(el).color))
    .toBe('rgb(255, 255, 255)');
  await page.evaluate(() => document.body.classList.add('isDarkTheme'));
  await page.getByTestId('memo-new').hover();
  await expect
    .poll(() => page.getByTestId('memo-new').evaluate((el) => getComputedStyle(el).color))
    .toBe('rgb(29, 34, 50)');
  await expect(page.getByRole('menuitem').locator('.nav-label')).toHaveText([
    '四象限总览',
    '项目进展',
    '常态事项',
    '备忘',
    '归档与回收站',
    '设置',
    '数据备份',
    '关于',
  ]);
});

test('routine popup protects drafts, keeps failed writes and can retry', async ({
  page,
}) => {
  await page.goto('/#/personal-routine');
  const row = await routine(page, '保护事项');
  await row.getByTestId('pr-record').click();
  await page.getByTestId('pr-entry-body').fill('未保存的记录');
  await page.getByTestId('pr-range-week').click();
  await expect(page.getByTestId('pr-draft-prompt')).toBeVisible();
  await page.getByTestId('pr-draft-continue').click();
  await expect(page.getByTestId('pr-entry-body')).toHaveText('未保存的记录');
  await page.evaluate(() => {
    const proto = IDBObjectStore.prototype,
      original = proto.add;
    let fail = true;
    proto.add = function (this: IDBObjectStore, ...args: unknown[]) {
      if (this.name === 'ops' && fail) {
        fail = false;
        throw new Error('injected write failure');
      }
      return (original as unknown as (...values: unknown[]) => IDBRequest).apply(
        this,
        args,
      );
    };
  });
  await page.getByTestId('pr-save-entry').click();
  await expect(page.getByTestId('pr-status')).toHaveAttribute(
    'data-save-state',
    'failed',
  );
  await expect(page.getByTestId('pr-entry-body')).toHaveText('未保存的记录');
  await expect(row.getByTestId('pr-entry')).toHaveCount(0);
  await page.getByTestId('pr-save-entry').click();
  await expect(page.getByTestId('pr-editor')).toHaveCount(0);
  await expect(row.getByTestId('pr-entry')).toHaveText('未保存的记录');
});

test('complete backup restores project, routine and memo display orders', async ({
  page,
}) => {
  const gotoStable = async (route: string): Promise<void> => {
    await page.goto(route);
    const current = route.includes('personal-routine')
      ? 'pr-page'
      : route.includes('personal-memo')
        ? 'memo-page'
        : route.includes('personal-backup')
          ? 'pb-page'
          : 'pp-page';
    for (const id of ['pp-page', 'pr-page', 'memo-page', 'pb-page']) {
      await expect(page.getByTestId(id)).toHaveCount(id === current ? 1 : 0);
    }
    await expect(page.getByTestId(current)).toBeVisible();
  };
  // Browser downloads use the real web fallback, not an incomplete Electron bridge.
  await page.addInitScript(() =>
    Object.defineProperty(window, 'ea', {
      configurable: true,
      value: undefined,
    }),
  );
  await page.reload();
  await gotoStable('/#/personal-progress');
  await project(page, '备份项目甲');
  const projectB = await project(page, '备份项目乙');
  await projectB.getByTestId('pp-project-title').press('Alt+ArrowUp');
  await expect(page.getByTestId('pp-project-title')).toHaveText([
    '备份项目乙',
    '备份项目甲',
  ]);
  await expect(page.getByTestId('pp-status')).toHaveAttribute('data-save-state', 'saved');
  await gotoStable('/#/personal-routine');
  await routine(page, '备份事项甲');
  const routineB = await routine(page, '备份事项乙');
  await routineB.getByTestId('pr-item-name').press('Alt+ArrowUp');
  await expect(page.getByTestId('pr-item-name')).toHaveText(['备份事项乙', '备份事项甲']);
  await expect(page.getByTestId('pr-status')).toHaveAttribute('data-save-state', 'saved');
  await gotoStable('/#/personal-memo');
  const memoA = await memo(page, '备份备忘甲');
  await memo(page, '备份备忘乙');
  await memoA.locator('.memo-preview').press('Alt+ArrowUp');
  await expect(page.locator('.memo-preview')).toHaveText(['备份备忘甲', '备份备忘乙']);
  await expect(page.getByTestId('memo-new')).toBeEnabled();
  await gotoStable('/#/personal-backup');
  await expect(page.getByTestId('pb-page')).toBeVisible();
  const download = page.waitForEvent('download');
  await page.getByTestId('pb-export').click();
  const file = test.info().outputPath('workspace-orders.json');
  await (await download).saveAs(file);
  await gotoStable('/#/personal-progress');
  await projectB.getByTestId('pp-project-title').press('Alt+ArrowDown');
  await expect(page.getByTestId('pp-status')).toHaveAttribute('data-save-state', 'saved');
  await expect(page.getByTestId('pp-project-title')).toHaveText([
    '备份项目甲',
    '备份项目乙',
  ]);
  await gotoStable('/#/personal-backup');
  page.once('dialog', (dialog) => dialog.accept());
  await page.getByTestId('pb-restore-input').setInputFiles(file);
  await expect(page.getByTestId('pb-status')).toHaveAttribute(
    'data-save-state',
    'restored',
  );
  await gotoStable('/#/personal-progress');
  await expect(page.getByTestId('pp-project-title')).toHaveText([
    '备份项目乙',
    '备份项目甲',
  ]);
  await gotoStable('/#/personal-routine');
  await expect(page.getByTestId('pr-item-name')).toHaveText(['备份事项乙', '备份事项甲']);
  await gotoStable('/#/personal-memo');
  await expect(page.locator('.memo-preview')).toHaveText(['备份备忘甲', '备份备忘乙']);
  await page.getByTestId('memo-card').first().getByTestId('memo-edit').click();
  await page.screenshot({
    path: test.info().outputPath('memo-inline-light.png'),
    fullPage: true,
  });
  await page.evaluate(() => document.body.classList.add('isDarkTheme'));
  await page.screenshot({
    path: test.info().outputPath('memo-inline-dark.png'),
    fullPage: true,
  });
});
