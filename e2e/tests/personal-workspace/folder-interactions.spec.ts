import { expect, test } from '../../fixtures/test.fixture';
import { Page } from '@playwright/test';

const gotoProgress = async (page: Page): Promise<void> => {
  await page.goto('/#/personal-progress');
  await page.reload();
  await page.getByTestId('pp-page').waitFor({ timeout: 30_000 });
};

const createFolder = async (page: Page, name: string): Promise<void> => {
  await page.getByTestId('pp-create-folder').click();
  const input = page.getByTestId('pp-folder-rename-input');
  await input.fill(name);
  await input.press('Enter');
  await expect(
    page.getByTestId('pp-folder-card').filter({ hasText: name }),
  ).toBeVisible();
};

const createProject = async (page: Page, title: string): Promise<void> => {
  if (!(await page.getByTestId('pp-new-project-input').isVisible())) {
    await page.getByTestId('pp-show-create').click();
  }
  await page.getByTestId('pp-new-project-input').fill(title);
  await page.getByTestId('pp-create-project').click();
  await expect(page.getByTestId('pp-status')).toHaveAttribute('data-save-state', 'saved');
};

test('reorders folder cards, highlights while dropping, and expands folder actions', async ({
  page,
}) => {
  await gotoProgress(page);
  await createFolder(page, '文件夹一');
  await createFolder(page, '文件夹二');

  const names = page.locator('.pp-folder-name');
  const cards = page.getByTestId('pp-folder-card');
  await expect(names).toHaveText(['文件夹一', '文件夹二']);
  await cards.first().dragTo(cards.nth(1));
  await expect(names).toHaveText(['文件夹二', '文件夹一']);

  await createProject(page, '拖动测试项目');
  const title = page
    .getByTestId('pp-project-row')
    .filter({ hasText: '拖动测试项目' })
    .getByTestId('pp-project-title');
  const target = cards.filter({ hasText: '文件夹二' });
  const before = await target.boundingBox();
  const titleBox = await title.boundingBox();
  const targetBox = await target.boundingBox();
  if (!before || !titleBox || !targetBox) throw new Error('MISSING_DRAG_BOX');

  await page.mouse.move(titleBox.x + 20, titleBox.y + 12);
  await page.mouse.down();
  const halfWidth = targetBox.width / 2;
  const halfHeight = targetBox.height / 2;
  const targetX = targetBox.x + halfWidth;
  const targetY = targetBox.y + halfHeight;
  await page.mouse.move(targetX, targetY, {
    steps: 12,
  });
  await expect(target).toHaveClass(/is-folder-drop-target/);
  const during = await target.boundingBox();
  expect(during?.height ?? 0).toBeCloseTo(before.height, 0);
  await page.mouse.up();

  await expect(target).toContainText('1 个项目');
  await target.click();
  await expect(page.getByTestId('pp-folder-page-expand')).toBeVisible();
  await page.getByTestId('pp-folder-page-expand').click();
  await expect(page.locator('.pp-folder-page-actions')).toBeVisible();
  await expect(
    page.locator('.pp-folder-page-actions button').filter({ hasText: '重命名' }),
  ).toBeVisible();
  await expect(
    page.locator('.pp-folder-page-actions button').filter({ hasText: '删除' }),
  ).toBeVisible();
});

test('batch moves selected projects into a folder', async ({ page }) => {
  await gotoProgress(page);
  await createFolder(page, '批量文件夹');
  await createProject(page, '批量项目一');
  await createProject(page, '批量项目二');

  await page.getByTestId('pp-batch-toggle').click();
  const checks = page.getByTestId('pp-batch-checkbox');
  await expect(checks).toHaveCount(2);
  await checks.nth(0).check();
  await checks.nth(1).check();
  await page.getByTestId('pp-batch-folder').selectOption({ label: '批量文件夹' });
  await page.getByTestId('pp-batch-move').click();

  const folder = page.getByTestId('pp-folder-card').filter({ hasText: '批量文件夹' });
  await expect(folder).toContainText('2 个项目');
});

test('batch archives selected projects and keeps them restorable', async ({ page }) => {
  await gotoProgress(page);
  await createProject(page, '批量归档一');
  await createProject(page, '批量归档二');
  await page.getByTestId('pp-batch-toggle').click();
  const checks = page.getByTestId('pp-batch-checkbox');
  await expect(checks).toHaveCount(2);
  await checks.nth(0).check();
  await checks.nth(1).check();
  page.once('dialog', (dialog) => dialog.accept());
  await page.getByTestId('pp-batch-archive').click();
  await expect(page.getByTestId('pp-project-row')).toHaveCount(0);

  await page.goto('/#/personal-archive');
  await page.reload();
  await page.getByTestId('pa-page').waitFor({ timeout: 30_000 });
  await expect(page.getByText('批量归档一')).toBeVisible();
  await expect(page.getByText('批量归档二')).toBeVisible();
});

test('batch sets a quadrant for selected projects', async ({ page }) => {
  await gotoProgress(page);
  await createProject(page, '批量四象限');
  await page.getByTestId('pp-batch-toggle').click();
  await page.getByTestId('pp-batch-checkbox').first().check();
  await page.getByTestId('pp-batch-quadrant').selectOption('urgent-important');
  await page.getByTestId('pp-batch-quadrant-apply').click();

  await page.goto('/#/personal-overview');
  await page.waitForLoadState('domcontentloaded');
  try {
    await page.getByTestId('po-page').waitFor({ timeout: 10_000 });
  } catch {
    await page.goto('/#/personal-overview');
    await page.reload();
    await page.getByTestId('po-page').waitFor({ timeout: 30_000 });
  }
  const quadrant = page.locator(
    '[data-testid="po-quadrant"][data-quadrant="urgent-important"]',
  );
  await expect(quadrant).toContainText('批量四象限');
});
