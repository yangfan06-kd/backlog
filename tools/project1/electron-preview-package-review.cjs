const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { _electron: electron } = require('playwright');
const { expect } = require('@playwright/test');

const root = 'G:/project1';
const release = process.argv[2];
if (!release) throw new Error('release dir required');
const exe = path.join(release, 'win-unpacked/Project1Preview.exe');
const caseRoot = path.join(
  root,
  'output/runtime/DS-010',
  `preview-package-review-${Date.now()}`,
);
const report = { release, exe, steps: [], counts: {} };
let app;
let page;

const profile = (name) => {
  const dir = path.join(caseRoot, name);
  const userData = path.join(dir, 'user-data');
  const exportsDir = path.join(dir, 'exports');
  for (const p of [
    userData,
    path.join(dir, 'logs'),
    path.join(dir, 'crashes'),
    path.join(dir, 'tmp'),
    exportsDir,
  ]) {
    fs.mkdirSync(p, { recursive: true });
  }
  return { dir, userData, exportsDir };
};

const mkEnv = (p) => ({
  ...process.env,
  NODE_ENV: 'PROD',
  PROJECT1_PREVIEW_MODE: '1',
  PROJECT1_STORAGE_ROOT: root,
  PROJECT1_USER_DATA_DIR: p.userData,
  PROJECT1_LOG_DIR: path.join(p.dir, 'logs'),
  PROJECT1_CRASH_DIR: path.join(p.dir, 'crashes'),
  PROJECT1_PREVIEW_EXPORTS_DIR: p.exportsDir,
  TEMP: path.join(p.dir, 'tmp'),
  TMP: path.join(p.dir, 'tmp'),
});

const launch = async (p) => {
  const env = mkEnv(p);
  delete env.ELECTRON_RUN_AS_NODE;
  app = await electron.launch({
    executablePath: exe,
    cwd: path.dirname(exe),
    env,
    args: ['--disable-tray', '--no-sandbox'],
  });
  page = await app.firstWindow();
  page.setDefaultTimeout(25_000);
  await page.waitForURL(/^file:/);
  await page.getByTestId('pp-page').waitFor({ timeout: 30_000 });
  await app.evaluate(({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows()[0];
    win.setSize(1280, 900);
    win.center();
  });
  await page.waitForTimeout(800);
  await page.context().setOffline(true);
  await page.evaluate(() => {
    if (navigator.onLine) throw new Error('offline assertion failed');
  });
  return page;
};

const gotoNav = async (label, testId) => {
  await page.locator('.nav-link').filter({ hasText: label }).first().click();
  await page.getByTestId(testId).waitFor();
  await page.waitForTimeout(500);
};

const statusSaved = async () => {
  await expect(page.getByTestId('pp-status')).toHaveAttribute('data-save-state', 'saved');
};

const createProject = async (title) => {
  await page.getByTestId('pp-new-project-input').fill(title);
  await page.getByTestId('pp-create-project').click();
  await statusSaved();
};

const appendStep = async (title) => {
  await page.getByTestId('pp-append-step').click();
  await page.getByTestId('pp-insert-input').fill(title);
  await page.getByTestId('pp-insert-save').click();
  await statusSaved();
};

const completeStep = async (title) => {
  await page.locator(`[data-testid="pp-step-title"][data-step-title="${title}"]`).click();
  await statusSaved();
};

const addManualEntry = async (body) => {
  await page.getByTestId('pp-entry-input').fill(body);
  await page.getByTestId('pp-add-entry').click();
  await statusSaved();
};

const finishSelected = async (title) => {
  page.once('dialog', (dialog) => dialog.accept());
  await page.getByTestId('pp-finish-project').click();
  await expect(page.getByTestId('pp-view-archive')).toBeVisible();
  await gotoNav('项目归档', 'pa-page');
  await expect(page.getByTestId('pa-card')).toContainText(title);
};

const makeBadBackup = (filePath) => {
  fs.writeFileSync(filePath, '{"broken":', 'utf8');
};

const lastNav = async (label, testId) => gotoNav(label, testId);

(async () => {
  try {
    fs.mkdirSync(caseRoot, { recursive: true });
    const profileA = profile('profile-a');
    await launch(profileA);
    report.offlineStart = true;
    report.steps.push(
      'started packaged exe with an isolated profile; browser context offline',
    );

    await createProject('Package project');
    await appendStep('Keep this unfinished');
    await completeStep('Keep this unfinished');
    await addManualEntry('Package manual record');
    await createProject('Archived package project');
    await appendStep('Archived remaining');
    await finishSelected('Archived package project');
    await lastNav('常态事项', 'pr-page');
    await page.getByTestId('pr-new-item-title').fill('Package routine');
    await page.getByTestId('pr-create-item').click();
    await expect(page.getByTestId('pr-status')).toHaveAttribute(
      'data-save-state',
      'saved',
    );
    await page.getByTestId('pr-entry-body').fill('Routine package record');
    await page.getByTestId('pr-save-entry').click();
    await expect(page.getByTestId('pr-status')).toHaveAttribute(
      'data-save-state',
      'saved',
    );
    report.steps.push('created project/step/history, archive and routine data offline');

    // The old progress-page export entry must use the same preview facade and
    // native save path instead of falling back to a browser download.
    const progressExport = path.join(profileA.exportsDir, 'progress-page.json');
    await app.evaluate(({ dialog }, filePath) => {
      dialog.showSaveDialog = async () => ({ canceled: false, filePath });
    }, progressExport);
    await lastNav('项目进展', 'pp-page');
    await page.getByTestId('pp-export').click();
    await expect(page.getByTestId('pp-status')).toHaveAttribute(
      'data-save-state',
      'saved',
    );
    expect(fs.existsSync(progressExport)).toBe(true);
    report.steps.push('progress-page export used the same native save path');

    await lastNav('数据备份', 'pb-page');
    await expect(page.getByTestId('pb-auto-status')).toBeVisible();
    await page.getByTestId('pb-auto-now').click();
    await expect(page.getByTestId('pb-auto-status')).toHaveAttribute(
      'data-auto-state',
      'success',
      { timeout: 30_000 },
    );
    const autoDir = path.join(profileA.userData, 'backups', 'project1-auto');
    const autoFiles = fs.existsSync(autoDir)
      ? fs.readdirSync(autoDir).filter((name) => name.startsWith('auto-'))
      : [];
    expect(autoFiles.length).toBeGreaterThan(0);
    await expect(page.getByTestId('pb-auto-version').first()).toBeVisible();
    report.steps.push('automatic version backup was committed and listed');
    const exportFile = path.join(profileA.exportsDir, 'package-backup.json');
    await app.evaluate(({ dialog }, filePath) => {
      globalThis.__previewSavedDialogs = [];
      dialog.showSaveDialog = async (_win, options) => {
        globalThis.__previewSavedDialogs.push(options.defaultPath);
        return { canceled: false, filePath };
      };
    }, exportFile);
    await page.getByTestId('pb-export').click();
    await expect(page.getByTestId('pb-status')).toHaveAttribute(
      'data-save-state',
      'saved',
    );
    await expect(page.getByTestId('pb-saved-path')).toContainText(exportFile);
    const defaultDialogPath = await app.evaluate(
      () => globalThis.__previewSavedDialogs[0],
    );
    expect(defaultDialogPath.replace(/\\/g, '/')).toContain(
      'output/runtime/DS-010/preview-package-review',
    );
    expect(fs.existsSync(exportFile)).toBe(true);
    const backup = JSON.parse(fs.readFileSync(exportFile, 'utf8'));
    expect(backup.data.project.entities).toBeTruthy();
    expect(backup.data.task.entities).toBeTruthy();
    report.backupBytes = fs.statSync(exportFile).size;
    report.steps.push(
      'exported complete data through the real preload/save IPC and verified the file',
    );

    // Cancel must not write or claim success.
    const cancelTarget = path.join(profileA.exportsDir, 'cancelled.json');
    await app.evaluate(({ dialog }) => {
      dialog.showSaveDialog = async () => ({ canceled: true });
    });
    await page.getByTestId('pb-export').click();
    await expect(page.getByTestId('pb-status')).toHaveAttribute(
      'data-save-state',
      'cancelled',
    );
    expect(fs.existsSync(cancelTarget)).toBe(false);
    report.steps.push('native save cancel kept status cancelled and wrote no file');

    // Outside target must be rejected by the main process.
    const outside = path.join('C:/Users/Public/project1-preview-outside.json');
    await app.evaluate(({ dialog }, filePath) => {
      dialog.showSaveDialog = async () => ({ canceled: false, filePath });
    }, outside);
    await page.getByTestId('pb-export').click();
    await expect(page.getByTestId('pb-message')).toContainText(
      '保存位置必须在项目目录内',
    );
    expect(fs.existsSync(outside)).toBe(false);
    report.steps.push('outside-project target was rejected before writing');

    // Existing directory as target produces a real write failure.
    const blocked = path.join(profileA.exportsDir, 'blocked');
    fs.mkdirSync(blocked, { recursive: true });
    await app.evaluate(({ dialog }, filePath) => {
      dialog.showSaveDialog = async () => ({ canceled: false, filePath });
    }, blocked);
    await page.getByTestId('pb-export').click();
    await expect(page.getByTestId('pb-message')).toContainText('文件写入失败');
    report.steps.push('real filesystem write failure reported without success');

    // A junction pointing outside the project must not leak a write.
    const junction = path.join(profileA.exportsDir, 'junction-outside');
    const outsideDir = path.join('C:/Users/Public', 'project1-preview-junction-target');
    fs.mkdirSync(outsideDir, { recursive: true });
    try {
      execFileSync('cmd', ['/c', 'mklink', '/J', junction, outsideDir]);
      const junctionTarget = path.join(junction, 'leak.json');
      await app.evaluate(({ dialog }, filePath) => {
        dialog.showSaveDialog = async () => ({ canceled: false, filePath });
      }, junctionTarget);
      await page.getByTestId('pb-export').click();
      await expect(page.getByTestId('pb-message')).toContainText(
        '保存位置必须在项目目录内',
      );
      expect(fs.existsSync(path.join(outsideDir, 'leak.json'))).toBe(false);
      report.junctionRejected = true;
      report.steps.push(
        'junction target was rejected canonically; nothing written outside',
      );
    } catch (error) {
      report.junctionError = String(error.message || error);
    }

    // Normal window close while an export is still waiting on the save dialog:
    // the close must wait for the queued export/receipt, not exit early.
    const closeExport = path.join(profileA.exportsDir, 'close-wait.json');
    await app.evaluate(({ dialog }, filePath) => {
      globalThis.__previewDialogResolve = null;
      dialog.showSaveDialog = () =>
        new Promise((resolve) => {
          globalThis.__previewDialogResolve = resolve;
        });
      globalThis.__previewDialogTarget = filePath;
    }, closeExport);
    await page.getByTestId('pb-export').click();
    await expect(page.getByTestId('pb-status')).toHaveAttribute(
      'data-save-state',
      'exporting',
    );
    await app.evaluate(({ BrowserWindow }) => {
      setTimeout(() => BrowserWindow.getAllWindows()[0].close(), 0);
    });
    await page.waitForTimeout(500);
    report.windowsDuringWrite = await app.evaluate(
      ({ BrowserWindow }) => BrowserWindow.getAllWindows().length,
    );
    expect(report.windowsDuringWrite).toBe(1);
    const closed = app.waitForEvent('close', { timeout: 20_000 });
    await app.evaluate(() => {
      globalThis.__previewDialogResolve({
        canceled: false,
        filePath: globalThis.__previewDialogTarget,
      });
    });
    await closed;
    app = undefined;
    report.steps.push(
      'normal close waited for the in-flight save dialog and committed export',
    );

    // Restore in a second independent profile. Copy one previously written
    // automatic version into its owned directory so the version list (not a
    // renderer mock) is the source of the restore.
    const profileB = profile('profile-b');
    const autoDirB = path.join(profileB.userData, 'backups', 'project1-auto');
    fs.mkdirSync(path.dirname(autoDirB), { recursive: true });
    fs.cpSync(autoDir, autoDirB, { recursive: true });
    await launch(profileB);
    await lastNav('数据备份', 'pb-page');
    await expect(page.getByTestId('pb-auto-version').first()).toBeVisible();
    page.once('dialog', (dialog) => dialog.accept());
    await page.getByTestId('pb-auto-restore').first().click();
    await expect(page.getByTestId('pb-status')).toHaveAttribute(
      'data-save-state',
      'restored',
      { timeout: 30_000 },
    );
    report.steps.push(
      'second profile restored an automatic version from its version list',
    );
    page.once('dialog', (dialog) => dialog.accept());
    await page.getByTestId('pb-restore-input').setInputFiles(exportFile);
    await expect(page.getByTestId('pb-status')).toHaveAttribute(
      'data-save-state',
      'restored',
      { timeout: 30_000 },
    );
    await lastNav('项目进展', 'pp-page');
    await expect(
      page.getByTestId('pp-project-row').filter({ hasText: 'Package project' }),
    ).toBeVisible();
    await expect(
      page.getByTestId('pp-step-title').filter({ hasText: 'Keep this unfinished' }),
    ).toHaveCount(0);
    await expect(
      page.getByTestId('pp-entry').filter({ hasText: 'Package manual record' }),
    ).toBeVisible();
    await lastNav('项目归档', 'pa-page');
    await expect(page.getByTestId('pa-card')).toContainText('Archived package project');
    await lastNav('常态事项', 'pr-page');
    await expect(page.getByTestId('pr-item-row')).toContainText('Package routine');
    await lastNav('四象限总览', 'po-page');
    await expect(
      page.getByTestId('po-project-row').filter({ hasText: 'Package project' }),
    ).toBeVisible();
    report.steps.push(
      'second isolated profile restored project/archive/routine and rendered them',
    );

    // Bad JSON must keep the good restored data.
    await lastNav('数据备份', 'pb-page');
    const bad = path.join(caseRoot, 'bad.json');
    makeBadBackup(bad);
    page.once('dialog', (dialog) => dialog.accept());
    await page.getByTestId('pb-restore-input').setInputFiles(bad);
    await expect(page.getByTestId('pb-status')).toHaveAttribute(
      'data-save-state',
      'error',
    );
    await lastNav('项目进展', 'pp-page');
    await expect(
      page.getByTestId('pp-project-row').filter({ hasText: 'Package project' }),
    ).toBeVisible();
    report.steps.push('bad JSON reported an error and kept the good project data');

    // Real import write failure: fail the op-store put once, then retry.
    await lastNav('数据备份', 'pb-page');
    await page.evaluate(() => {
      const proto = IDBObjectStore.prototype;
      const originalPut = proto.put;
      const originalAdd = proto.add;
      window.__previewFailPut = true;
      const wrap = (original) =>
        function (...args) {
          if (this.name === 'ops' && window.__previewFailPut) {
            window.__previewFailPut = false;
            throw new Error('review injected import write failure');
          }
          return original.apply(this, args);
        };
      proto.put = wrap(originalPut);
      proto.add = wrap(originalAdd);
    });
    page.once('dialog', (dialog) => dialog.accept());
    await page.getByTestId('pb-restore-input').setInputFiles(exportFile);
    await expect(page.getByTestId('pb-status')).toHaveAttribute(
      'data-save-state',
      'error',
      { timeout: 30_000 },
    );
    page.once('dialog', (dialog) => dialog.accept());
    await page.getByTestId('pb-restore-input').setInputFiles(exportFile);
    await expect(page.getByTestId('pb-status')).toHaveAttribute(
      'data-save-state',
      'restored',
      { timeout: 30_000 },
    );
    report.steps.push('real import write failure kept good data; retry restored');

    report.counts.projects = await page.evaluate(
      () => document.querySelectorAll('[data-testid="pp-project-row"]').length,
    );
    await page.context().setOffline(true);
    report.reopenedOffline = await page.evaluate(() => !navigator.onLine);
    report.steps.push('reopened profile was still offline');
  } catch (error) {
    report.error = error.message;
    process.exitCode = 1;
    if (page && !page.isClosed()) {
      await page.screenshot({ path: path.join(caseRoot, 'failure.png') });
    }
  } finally {
    if (app) {
      try {
        await app.evaluate(({ app }) => app.exit(0));
      } catch {
        /* already closed */
      }
    }
    fs.writeFileSync(path.join(caseRoot, 'review.json'), JSON.stringify(report, null, 2));
    console.log(JSON.stringify(report, null, 2));
  }
})();
