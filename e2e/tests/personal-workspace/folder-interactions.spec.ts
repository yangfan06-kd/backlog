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
