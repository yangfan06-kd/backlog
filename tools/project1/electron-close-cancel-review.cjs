const fs = require('node:fs');
const path = require('node:path');
const { _electron: electron } = require('playwright');
const { expect } = require('@playwright/test');
const repo = path.resolve(__dirname, '..', '..');
const root = path.resolve(process.env.PROJECT1_STORAGE_ROOT || '');
if (root !== path.resolve('G:/project1')) throw new Error('Use the project environment');
const output = path.join(root, 'output/runtime/CX-005', `cancel-close-${Date.now()}`);
const userData = path.join(output, 'user-data');
fs.mkdirSync(output, { recursive: true });
const env = { ...process.env, NODE_ENV: 'PROD', PROJECT1_USER_DATA_DIR: userData };
delete env.ELECTRON_RUN_AS_NODE;
const report = { userData, steps: [] };
const cleanFirst = process.argv.includes('--clean-first');
report.cleanFirst = cleanFirst;
let app;
let page;
const closeWindow = () =>
  app.evaluate(({ BrowserWindow }) => {
    setTimeout(() => BrowserWindow.getAllWindows()[0].close(), 0);
  });
(async () => {
  try {
    app = await electron.launch({
      cwd: repo,
      env,
      args: ['.', `--user-data-dir=${userData}`, '--disable-tray', '--no-sandbox'],
    });
    page = await app.firstWindow();
    page.setDefaultTimeout(10_000);
    await page.addInitScript(() => {
      for (const key of [
        'SUP_ONBOARDING_PRESET_DONE',
        'SUP_ONBOARDING_HINTS_DONE',
        'SUP_IS_SHOW_TOUR',
        'SUP_EXAMPLE_TASKS_CREATED',
      ])
        localStorage.setItem(key, 'true');
    });
    await page.waitForURL(/^file:/);
    await page.reload();
    await page.waitForSelector('[data-testid="pp-page"]');
    await page.getByTestId('pp-new-project-input').fill('Cancel close');
    await page.getByTestId('pp-create-project').click();
    await page.waitForSelector('[data-testid="pp-status"][data-save-state="saved"]');
    await page.getByTestId('pp-append-step').click();
    await page.getByTestId('pp-insert-input').fill('Finished task');
    await page.getByTestId('pp-insert-save').click();
    await page.waitForSelector('[data-testid="pp-status"][data-save-state="saved"]');
    await page.getByTestId('pp-step-title').click();
    await page.waitForSelector('[data-testid="pp-status"][data-save-state="saved"]');
    await page.evaluate(() => {
      location.hash = '/tag/TODAY/tasks';
    });
    await page.locator('.nav-link').filter({ hasText: '今天' }).first().waitFor();
    await page.locator('.tour-addBtn').click();
    await page.locator('add-task-bar.global .main-input').fill('Trigger Finish Day');
    await page.locator('.e2e-add-task-submit').click();
    const todayTask = page.locator('task').filter({ hasText: 'Trigger Finish Day' });
    await todayTask.waitFor({ state: 'visible' });
    await page.keyboard.press('Escape');
    await todayTask.hover();
    await todayTask.locator('done-toggle').click();
    await page.locator('task.isDone').filter({ hasText: 'Trigger Finish Day' }).waitFor();
    await page.evaluate(() => {
      location.hash = '/config';
    });
    await page.locator('.settings-search input').fill('结束一天');
    await page.getByRole('option').filter({ hasText: '结束一天' }).first().click();
    const finishToggle = page
      .locator('formly-field-mat-slide-toggle')
      .filter({ hasText: '结束一天' })
      .getByRole('switch');
    await finishToggle.click();
    await expect(finishToggle).toBeChecked();
    await page.evaluate(() => {
      location.hash = '/personal-progress';
    });
    await page.waitForSelector('[data-testid="pp-page"]');
    await page.waitForFunction(
      () => document.querySelectorAll('[data-testid="pp-page"]').length === 1,
    );
    report.preconditions = await page.evaluate(
      () =>
        new Promise((resolve) => {
          const component = window.ng.getComponent(
            document.querySelector('personal-progress-page'),
          );
          const sub = component._store.subscribe((state) =>
            resolve({
              finishDayEnabled: state.globalConfig.appFeatures.isFinishDayEnabled,
              doneTodayCount: state.tag.entities.TODAY.taskIds.filter(
                (id) => state.tasks.entities[id]?.isDone,
              ).length,
            }),
          );
          setTimeout(() => sub.unsubscribe(), 0);
        }),
    );
    await page.getByTestId('pp-project-title').click();
    if (!cleanFirst)
      await page.getByTestId('pp-entry-input').fill('Keep this unsaved draft');
    const finish = page.locator('dialog-finish-day-before-close');
    const prompt = page.getByTestId('pp-draft-prompt');
    await closeWindow();
    await finish.waitFor({ state: 'visible' });
    await closeWindow();
    if ((await finish.count()) !== 1)
      throw new Error('Repeated close stacked Finish Day dialogs');
    await finish.locator('button[mat-button]').click();
    await finish.waitFor({ state: 'detached' });
    // Deliberate observation window: cancellation must not launch a later prompt.
    await page.waitForTimeout(1200);
    if (await prompt.isVisible())
      throw new Error('Cancelling Finish Day still launches the draft close prompt');
    if (
      (await page.getByTestId('pp-entry-input').inputValue()) !==
      (cleanFirst ? '' : 'Keep this unsaved draft')
    )
      throw new Error('Cancellation changed the draft');
    report.steps.push(
      'Finish Day cancellation retained draft without another close prompt',
    );
    await page.getByTestId('pp-entry-input').fill('Keep this unsaved draft');
    await closeWindow();
    await finish.waitFor({ state: 'visible' });
    await finish.locator('button[mat-stroked-button]').click();
    await prompt.waitFor({ state: 'visible' });
    await closeWindow();
    if ((await prompt.count()) !== 1)
      throw new Error('Repeated close stacked draft prompts');
    await page.getByTestId('pp-draft-continue').click();
    await prompt.waitFor({ state: 'detached' });
    report.steps.push(
      'Second close still protected the draft; continue kept window open',
    );
    await closeWindow();
    await finish.waitFor({ state: 'visible' });
    await finish.locator('button[mat-stroked-button]').click();
    await prompt.waitFor({ state: 'visible' });
    const closed = app.waitForEvent('close', { timeout: 10_000 });
    await page.getByTestId('pp-draft-discard').click();
    await closed;
    report.steps.push('Third close allowed explicit discard and normal exit');
  } catch (error) {
    report.error = error.message;
    process.exitCode = 1;
    if (page && !page.isClosed())
      await page.screenshot({ path: path.join(output, 'failure.png') });
  } finally {
    if (app)
      try {
        await app.evaluate(({ app }) => app.exit(0));
      } catch {
        /* closed */
      }
    fs.writeFileSync(path.join(output, 'review.json'), JSON.stringify(report, null, 2));
    console.log(JSON.stringify({ output, ...report }, null, 2));
  }
})();
