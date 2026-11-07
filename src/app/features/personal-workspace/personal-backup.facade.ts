import { inject, Injectable } from '@angular/core';
import { download } from '../../util/download';
import { BackupService } from '../../op-log/backup/backup.service';
import { OperationWriteFlushService } from '../../op-log/sync/operation-write-flush.service';
import { AllModelConfig, AppDataComplete } from '../../op-log/model/model-config';
import { CompleteBackup } from '../../op-log/core/types/sync.types';
import { hasAnyUserData } from '../../op-log/validation/has-meaningful-state-data.util';
import { PersonalCommandCoordinatorService } from '../personal-progress/personal-command-coordinator.service';
import { PERSONAL_PREVIEW_MODE } from './personal-preview-mode';
import { PersonalAutoBackupStore } from './personal-auto-backup.store';
import { PersonalBackupValidator } from './personal-backup-validator.service';
import { ImexViewService } from '../../imex/imex-meta/imex-view.service';
import { assertSupportedPersonalTextFormats } from '../personal-text/personal-text.model';
import {
  PersonalFolderBackupState,
  PersonalFolderService,
} from '../personal-progress/personal-folder.service';

export type PersonalBackupExportResult =
  | { status: 'saved'; path?: string }
  | { status: 'cancelled' }
  | { status: 'failed'; code: string };

type PersonalBackupSnapshot = CompleteBackup<AllModelConfig> & {
  personalFolders?: PersonalFolderBackupState;
};
type PersonalBackupFile = PersonalBackupSnapshot | AppDataComplete;

/**
 * Thin bridge over the existing complete-backup and command-queue machinery.
 * It deliberately does not create a second persistence engine or a second
 * write queue. The snapshot is taken only after the queue has drained and the
 * real operation-log write lock/cutoff has been reached; the native save dialog
 * is opened only after that lock is released.
 */
@Injectable({ providedIn: 'root' })
export class PersonalBackupFacade {
  private readonly _backupService = inject(BackupService);
  private readonly _writeFlush = inject(OperationWriteFlushService);
  private readonly _commandCoordinator = inject(PersonalCommandCoordinatorService);
  private readonly _isPreviewMode = inject(PERSONAL_PREVIEW_MODE);
  private readonly _autoBackupStore = inject(PersonalAutoBackupStore);
  private readonly _validator = inject(PersonalBackupValidator);
  private readonly _imexView = inject(ImexViewService);
  private readonly _folders = inject(PersonalFolderService);

  /** Shared atomic snapshot boundary used by manual and automatic backups. */
  captureSnapshot(): Promise<PersonalBackupSnapshot> {
    return this._commandCoordinator.enqueue(() => this._captureSnapshotInternal());
  }

  private async _captureSnapshotInternal(): Promise<PersonalBackupSnapshot> {
    const snapshot = await this._writeFlush.flushThenRunExclusive(async () =>
      this._backupService.loadCompleteBackup(true),
    );
    return {
      ...snapshot,
      personalFolders: this._folders.exportState(),
    };
  }

  async exportBackup(): Promise<PersonalBackupExportResult> {
    if (this._isPreviewMode && !window.ea?.saveFileDialog) {
      return { status: 'failed', code: 'PREVIEW_RUNTIME_MISSING' };
    }
    const snapshot = await this.captureSnapshot();
    const filename = `project1-personal-backup-${new Date()
      .toISOString()
      .replace(/[:.]/g, '-')}.json`;
    const data = JSON.stringify(snapshot);
    if (this._isPreviewMode && window.ea?.saveFileDialog) {
      const result = await window.ea.saveFileDialog(filename, data);
      if (result.success) return { status: 'saved', path: result.path };
      if (result.error) return { status: 'failed', code: result.error };
      return { status: 'cancelled' };
    }
    const result = await download(filename, data);
    return result.wasCanceled ? { status: 'cancelled' } : { status: 'saved' };
  }

  /**
   * Parses and imports a complete backup through the existing validated import
   * path. Invalid JSON and failed imports propagate to the page, which keeps
   * the current good data and shows an error.
   */
  async restoreFromText(text: string): Promise<void> {
    const parsed = JSON.parse(text) as PersonalBackupFile;
    if (!parsed || typeof parsed !== 'object') {
      throw new Error('INVALID_BACKUP');
    }
    const folderState = 'personalFolders' in parsed ? parsed.personalFolders : undefined;
    const backupData =
      'data' in parsed && parsed.data && typeof parsed.data === 'object'
        ? (parsed.data as AppDataComplete)
        : (parsed as AppDataComplete);
    assertSupportedPersonalTextFormats(backupData);
    if (this._isPreviewMode && !(await this._validator.isValid(backupData))) {
      throw new Error('INVALID_BACKUP_DATA');
    }
    if (!this._isPreviewMode) {
      await this._commandCoordinator.enqueue(() =>
        this._backupService.importCompleteBackup(parsed, false, true),
      );
      if (folderState !== undefined) this._folders.restoreState(folderState);
      return;
    }
    await this._commandCoordinator.enqueue(async () => {
      // The recovery copy and the import are one coordinator operation: no
      // personal command can interleave between capturing the current data and
      // replacing it with the selected version.
      this._imexView.setDataImportInProgress(true);
      try {
        const current = await this._captureSnapshotInternal();
        if (hasAnyUserData(current.data)) {
          try {
            if (!(await this._validator.isValid(current.data)))
              throw new Error('INVALID_CURRENT_DATA');
            await this._autoBackupStore.write(current, 'recovery');
          } catch (error) {
            throw new Error(
              `RECOVERY_COPY_FAILED: ${
                error instanceof Error ? error.message : String(error)
              }`,
            );
          }
        }
        await this._backupService.importCompleteBackup(parsed, false, true);
        if (folderState !== undefined) this._folders.restoreState(folderState);
      } finally {
        this._imexView.setDataImportInProgress(false);
      }
    });
  }

  async restoreAutoVersion(id: string): Promise<void> {
    const version = await this._autoBackupStore.read(id);
    await this.restoreFromText(version.text);
  }

  async pickBackupFile(): Promise<string | null> {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'application/json,.json';
    const file = await new Promise<File | null>((resolve) => {
      input.addEventListener('change', () => resolve(input.files?.[0] ?? null), {
        once: true,
      });
      input.click();
    });
    return file ? file.text() : null;
  }
}
