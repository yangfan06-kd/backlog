import { app, dialog, ipcMain, shell } from 'electron';
import { mkdir, writeFile } from 'fs/promises';
import { basename, dirname, isAbsolute, join, resolve } from 'path';
import { IPC } from '../shared-with-frontend/ipc-events.const';
import { isExternalUrlSchemeAllowed } from '../shared-with-frontend/is-external-url-allowed';
import { isLocalFileUrl, openLocalPath } from '../open-url';
import { getWin } from '../main-window';
import { isPathInsideDir } from '../file-path-guard';
import {
  isProject1PreviewMode,
  isProject1DistributionMode,
} from '../project1-runtime-paths';

const PREVIEW_EXPORT_DIR = ['output', 'runtime', 'project1-preview', 'exports'];

export const initSystemIpc = (): void => {
  ipcMain.on(IPC.OPEN_PATH, (ev, path: string) => {
    // openLocalPath enforces the guards this sink needs: reject UNC / remote
    // file:// paths (NTLM-hash leak) and never launch an executable/script.
    // FILE-type task-attachment paths are synced and thus attacker-controllable.
    // See GHSA-hr87-735w-hfq3.
    openLocalPath(path);
  });
  ipcMain.on(IPC.OPEN_EXTERNAL, (ev, url: string) => {
    // Defense in depth: never hand an unsafe scheme to the OS handler, even if
    // the renderer-side guard is bypassed. See GHSA-hr87-735w-hfq3.
    if (!isExternalUrlSchemeAllowed(url)) {
      return;
    }
    // A local file: URL opens reliably via openPath, not openExternal:
    // openExternal percent-encodes the path on Windows and then can't resolve
    // non-ASCII names or spaces. openLocalPath decodes it and re-applies the
    // openPath guards. See issue #8695.
    if (isLocalFileUrl(url)) {
      openLocalPath(url);
      return;
    }
    shell.openExternal(url);
  });

  ipcMain.on(
    IPC.SHOW_EMOJI_PANEL,
    () => app.isEmojiPanelSupported() && app.showEmojiPanel(),
  );

  ipcMain.handle(IPC.SAVE_FILE_DIALOG, async (ev, { filename, data }) => {
    const isPreview = isProject1PreviewMode();
    const root = process.env.PROJECT1_STORAGE_ROOT;
    if (isPreview && !root) {
      return { success: false, error: 'PREVIEW_RUNTIME_MISSING' };
    }
    const configuredExports = process.env.PROJECT1_PREVIEW_EXPORTS_DIR;
    const exportDir =
      isPreview &&
      configuredExports &&
      isAbsolute(configuredExports) &&
      isPathInsideDir(root!, configuredExports)
        ? resolve(configuredExports)
        : isPreview
          ? join(root!, ...PREVIEW_EXPORT_DIR)
          : '';
    const defaultPath = isPreview
      ? join(exportDir, basename(String(filename || 'backup.json')))
      : filename;
    const result = await dialog.showSaveDialog(getWin(), {
      defaultPath,
      filters: [
        { name: 'JSON Files', extensions: ['json'] },
        { name: 'All Files', extensions: ['*'] },
      ],
    });

    if (!result.canceled && result.filePath) {
      if (isPreview) {
        // The renderer cannot choose an arbitrary write target in preview mode:
        // validate the canonical path (including existing junctions/symlinks)
        // and only then create the parent/write the file.
        if (!isProject1DistributionMode() && !isPathInsideDir(root!, result.filePath)) {
          return { success: false, error: 'PREVIEW_PATH_OUTSIDE' };
        }
        try {
          await mkdir(dirname(result.filePath), { recursive: true });
          await writeFile(result.filePath, data, 'utf-8');
          return { success: true, path: result.filePath };
        } catch {
          return { success: false, error: 'PREVIEW_WRITE_FAILED' };
        }
      }
      await writeFile(result.filePath, data, 'utf-8');
      return { success: true, path: result.filePath };
    }
    return { success: false };
  });

  ipcMain.handle(IPC.SHARE_NATIVE, async () => {
    // Desktop platforms use the share dialog instead of native share
    // This allows for more flexibility and better UX with social media options
    return { success: false, error: 'Native share not available on desktop' };
  });
};
