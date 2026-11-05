const fs = require('node:fs');
const path = require('node:path');
const { _electron: electron } = require('playwright');
const { expect } = require('@playwright/test');

const release = 'G:/project1/output/releases/DS-014/20261030-194549-validation';
const runRoot = 'G:/project1/output/runtime/DS-014/packaged-regressions';
fs.mkdirSync(runRoot, { recursive: true });
const report = { release, checks: [] };
let app;
let page;

const editorFor = (id) =>
  page.getByTestId(id).locator('xpath=ancestor::personal-rich-text-editor[1]');
const createProject = async (name) => {
  await page.getByTestId('pp-new-project-input').fill(name);
  await page.getByTestId('pp-create-project').click();
  const row = page.getByTestId('pp-project-row').filter({ hasText: name });
  await expect(row).toBeVisible();
  await row.getByTestId('pp-project-title').click();
  return row;
};
const clearEntry = async () => {
  const editor = editorFor('pp-entry-input');
  await editor.locator('.cm-content').click();
  await page.keyboard.press('Control+A');
  await page.keyboard.press('Backspace');
};
const typeEntry = async (text) => {
  const editor = editorFor('pp-entry-input');
  await editor.locator('.cm-content').click();
  await page.keyboard.insertText(text);
  return editor;
};

(async () => {
  try {
    const env = { ...process.env, NODE_ENV: 'PROD' };
    for (const key of Object.keys(env)) if (key.startsWith('PROJECT1_')) delete env[key];
    env.TEMP = path.join(runRoot, 'tmp');
    env.TMP = path.join(runRoot, 'tmp');
    env.TMPDIR = path.join(runRoot, 'tmp');
    delete env.ELECTRON_RUN_AS_NODE;
    app = await electron.launch({
      executablePath: path.join(release, 'win-unpacked/Project1Preview.exe'),
      cwd: path.dirname(path.join(release, 'win-unpacked/Project1Preview.exe')),
      env,
      args: ['--disable-tray', '--no-sandbox'],
    });
    page = await app.firstWindow();
    page.setDefaultTimeout(30_000);
    await page.context().setOffline(true);
    await page.getByTestId('pp-page').waitFor({ timeout: 30_000 });
    await createProject('Packaged regression');

    await typeEntry('abcd');
    let editor = editorFor('pp-entry-input');
    await page.keyboard.press('Control+A');
    await page.keyboard.press('Control+b');
    await expect(editor.locator('.cm-content .pt-bold')).toBeVisible();
    await page.keyboard.press('Control+z');
    await expect(editor.locator('.cm-content')).toHaveText('abcd');
    await expect(editor.locator('.cm-content .pt-bold')).toHaveCount(0);
    await page.keyboard.press('Control+y');
    await expect(editor.locator('.cm-content .pt-bold')).toBeVisible();
    report.checks.push('packaged Ctrl+Z/Ctrl+Y undid only the format');

    await clearEntry();
    await typeEntry('keyboard');
    editor = editorFor('pp-entry-input');
    await page.keyboard.press('Control+A');
    await editor.getByTestId('pt-color-toggle').focus();
    await page.keyboard.press('Enter');
    await expect(editor.getByTestId('pt-color-blue')).toBeVisible();
    await editor.getByTestId('pt-color-blue').focus();
    await page.keyboard.press('Enter');
    await expect(editor.locator('.cm-content .pt-color-blue')).toHaveText('keyboard');
    report.checks.push('packaged keyboard color applied with Enter');

    await clearEntry();
    await typeEntry('abcd');
    editor = editorFor('pp-entry-input');
    await page.keyboard.press('Control+A');
    await editor.getByTestId('pt-bold').click();
    await page.keyboard.press('ArrowRight');
    await editor.getByTestId('pt-color-toggle').click();
    await editor.getByTestId('pt-color-blue').click();
    await expect(editor.locator('.cm-content .pt-color-blue')).toHaveCount(0);
    await page.keyboard.insertText('X');
    await expect(editor.locator('.cm-content')).toHaveText('abcdX');
    await expect(editor.locator('.cm-content .pt-color-blue')).toHaveText('X');
    report.checks.push('packaged stale selection was discarded after ArrowRight');

    await clearEntry();
    await typeEntry('abcd');
    editor = editorFor('pp-entry-input');
    await editor.locator('.cm-content').click();
    await page.keyboard.press('Home');
    await page.keyboard.press('Shift+ArrowRight');
    await page.keyboard.press('Shift+ArrowRight');
    await editor.getByTestId('pt-bold').click();
    await expect(editor.locator('.cm-content .pt-bold')).toHaveText('ab');
    await page.keyboard.press('Control+A');
    await editor.getByTestId('pt-bold').click();
    await expect(editor.locator('.cm-content .pt-bold')).toHaveText('abcd');
    await editor.getByTestId('pt-bold').click();
    await expect(editor.locator('.cm-content .pt-bold')).toHaveCount(0);
    report.checks.push('packaged mixed selection applied and removed bold uniformly');
    report.ok = true;
  } catch (error) {
    report.error = error.message;
    process.exitCode = 1;
  } finally {
    if (app) await app.evaluate(({ app }) => app.exit(0)).catch(() => {});
    fs.writeFileSync(path.join(runRoot, 'review.json'), JSON.stringify(report, null, 2));
    console.log(JSON.stringify(report, null, 2));
  }
})();
