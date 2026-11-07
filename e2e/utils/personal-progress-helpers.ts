import { expect, Page } from '@playwright/test';

/**
 * Sets a project's quadrant through the project "更多" menu.
 * The toolbar select was replaced by a nested menu under the project row.
 */
export const setProjectQuadrant = async (
  page: Page,
  projectTitle: string,
  quadrant: 'urgent-important' | 'important' | 'urgent' | 'neither' | 'unclassified',
): Promise<void> => {
  const row = page.getByTestId('pp-project-row').filter({ hasText: projectTitle });
  await row.getByTestId('pm-menu').click();
  await page.getByTestId('pm-quadrant-trigger').click();
  await page.getByTestId(`pm-quadrant-${quadrant}`).click();
  await expect(page.getByTestId('pp-status')).toHaveAttribute('data-save-state', 'saved');
};

/** The toolbar undo was removed; the selected project's latest record owns the undo action. */
export const undoLatestCompletion = async (page: Page): Promise<void> => {
  const undo = page.getByTestId('pp-undo-entry');
  await expect(undo).toHaveCount(1);
  await undo.click();
};

export const expectNoUndoCompletion = async (page: Page): Promise<void> => {
  await expect(page.getByTestId('pp-undo-entry')).toHaveCount(0);
};
