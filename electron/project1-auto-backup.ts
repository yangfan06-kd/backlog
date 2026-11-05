import { app, ipcMain } from 'electron';
import { IPC } from './shared-with-frontend/ipc-events.const';
import * as file from './project1-auto-backup-file';

export * from './project1-auto-backup-file';

const isProject1PreviewAllowed = (): boolean =>
  process.env.PROJECT1_PREVIEW_MODE === '1' || app.getName?.() === '项目进展（内测版）';

export const initProject1AutoBackupIpc = (): void => {
  ipcMain.handle(
    IPC.PROJECT1_AUTO_BACKUP_WRITE,
    (_event, args: file.Project1BackupWriteArgs): file.Project1BackupMeta => {
      if (!isProject1PreviewAllowed()) throw new Error('Preview backup is disabled');
      return file.writeProject1Backup(app.getPath('userData'), args);
    },
  );
  ipcMain.handle(IPC.PROJECT1_AUTO_BACKUP_LIST, (): file.Project1BackupMeta[] => {
    if (!isProject1PreviewAllowed()) throw new Error('Preview backup is disabled');
    return file.listProject1Backups(app.getPath('userData'));
  });
  ipcMain.handle(
    IPC.PROJECT1_AUTO_BACKUP_DELETE,
    (_event, id: string): { id: string } => {
      if (!isProject1PreviewAllowed()) throw new Error('Preview backup is disabled');
      return file.deleteProject1Backup(app.getPath('userData'), id);
    },
  );
  ipcMain.handle(
    IPC.PROJECT1_AUTO_BACKUP_READ,
    (_event, id: string): { text: string; meta: file.Project1BackupMeta } => {
      if (!isProject1PreviewAllowed()) throw new Error('Preview backup is disabled');
      return file.readProject1Backup(app.getPath('userData'), id);
    },
  );
};
