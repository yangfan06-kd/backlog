import { DestroyRef, effect, inject, Injectable, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Subscription, filter, firstValueFrom } from 'rxjs';
import { MatDialog } from '@angular/material/dialog';
import { CompleteBackup } from '../../op-log/core/types/sync.types';
import { AllModelConfig } from '../../op-log/model/model-config';
import { hasAnyUserData } from '../../op-log/validation/has-meaningful-state-data.util';
import { DataInitStateService } from '../../core/data-init/data-init-state.service';
import { LOCAL_ACTIONS } from '../../util/local-actions.token';
import { ImexViewService } from '../../imex/imex-meta/imex-view.service';
import { ExecBeforeCloseService } from '../../core/electron/exec-before-close.service';
import { IS_ELECTRON } from '../../app.constants';
import { Log } from '../../core/log';
import { PERSONAL_PREVIEW_MODE } from './personal-preview-mode';
import { PersonalBackupFacade } from './personal-backup.facade';
import { PersonalAutoBackupStore } from './personal-auto-backup.store';
import { PersonalBackupValidator } from './personal-backup-validator.service';
import { Project1BackupMeta } from '../../imex/local-backup/local-backup.model';
import { isPersistentAction } from '../../op-log/core/persistent-action.interface';
import { PersonalBackupCloseDialogComponent } from './personal-backup-close-dialog.component';
import { PersonalFolderService } from '../personal-progress/personal-folder.service';

export const AUTO_BACKUP_DEBOUNCE_MS = 30 * 1000;
export const AUTO_BACKUP_MAX_WAIT_MS = 5 * 60 * 1000;
export const AUTO_BACKUP_CLOSE_ID = 'personal-auto-backup-close';

export type AutoBackupStatusKind =
  | 'idle'
  | 'running'
  | 'success'
  | 'failed'
  | 'empty'
  | 'disabled';

export interface AutoBackupStatus {
  kind: AutoBackupStatusKind;
  lastSuccess: number | null;
  error: string | null;
  versionCount: number;
  pending: boolean;
}

@Injectable({ providedIn: 'root' })
export class PersonalAutoBackupService {
  private readonly _destroyRef = inject(DestroyRef);
  private readonly _isPreviewMode = inject(PERSONAL_PREVIEW_MODE);
  private readonly _dataInitState = inject(DataInitStateService);
  private readonly _facade = inject(PersonalBackupFacade);
  private readonly _store = inject(PersonalAutoBackupStore);
  private readonly _validator = inject(PersonalBackupValidator);
  private readonly _localActions$ = inject(LOCAL_ACTIONS);
  private readonly _imexView = inject(ImexViewService);
  private readonly _execBeforeClose = inject(ExecBeforeCloseService);
  private readonly _dialog = inject(MatDialog);
  private readonly _folders = inject(PersonalFolderService);

  readonly status = signal<AutoBackupStatus>({
    kind: 'idle',
    lastSuccess: null,
    error: null,
    versionCount: 0,
    pending: false,
  });
  readonly versions = signal<Project1BackupMeta[]>([]);
  readonly backupDirectory = signal<string>('');

  private _started = false;
  private _initialized = false;
  private _pending = false;
  private _inFlight: Promise<void> | null = null;
  private _debounceTimer: ReturnType<typeof setTimeout> | null = null;
  private _maxWaitTimer: ReturnType<typeof setTimeout> | null = null;
  private _actionsSub?: Subscription;
  private _importSub?: Subscription;
  private _closeSub?: Subscription;
  private _importInProgress = false;
  private _changeRevision = 0;
  private _closing = false;

  constructor() {
    effect(() => {
      this._folders.folders();
      this._folders.assignments();
      if (!this._started) return;
      queueMicrotask(() => {
        if (this._started && !this._importInProgress) this.handleDataChange();
      });
    });
    this._destroyRef.onDestroy(() => {
      this._clearTimers();
      if (IS_ELECTRON && this._started)
        this._execBeforeClose.unschedule(AUTO_BACKUP_CLOSE_ID);
    });
  }

  init(): void {
    if (!this._isPreviewMode || this._initialized) return;
    this._initialized = true;
    this._dataInitState.isAllDataLoadedInitially$
      .pipe(
        filter((isLoaded) => isLoaded === true),
        takeUntilDestroyed(this._destroyRef),
      )
      .subscribe(() => void this._start());
  }

  async deleteVersion(id: string): Promise<void> {
    await this._store.delete(id);
    await this.refreshVersions(true);
  }

  async refreshVersions(propagateError = false): Promise<void> {
    if (!this._store.isAvailable) {
      this.status.set({
        ...this.status(),
        kind: 'disabled',
        versionCount: 0,
      });
      return;
    }
    try {
      const versions = await this._store.list();
      this.versions.set(versions);
      const latest = versions.find((v) => v.valid);
      this.status.update((current) => ({
        ...current,
        lastSuccess: latest?.createdAt ?? null,
        versionCount: versions.length,
      }));
      if (!this.backupDirectory()) {
        try {
          const userData = await window.ea?.getUserDataPath?.();
          if (userData) this.backupDirectory.set(`${userData}\\backups\\project1-auto`);
        } catch {
          // Status text is diagnostic only.
        }
      }
    } catch (e) {
      this.status.update((current) => ({
        ...current,
        kind: 'failed',
        error: e instanceof Error ? e.message : String(e),
      }));
      if (propagateError) throw e;
    }
  }

  /** A successful local action changed data; start/reset the 30s debounce. */
  handleDataChange(): void {
    if (!this._started || this._importInProgress) return;
    this._changeRevision++;
    this._pending = true;
    this.status.update((current) => ({ ...current, pending: true }));
    if (this._closing) return;
    this._clearDebounce();
    this._debounceTimer = setTimeout(
      () => void this.runBackup('debounce'),
      AUTO_BACKUP_DEBOUNCE_MS,
    );
    if (!this._maxWaitTimer) {
      this._maxWaitTimer = setTimeout(
        () => void this.runBackup('max-wait'),
        AUTO_BACKUP_MAX_WAIT_MS,
      );
    }
  }

  /** Manual "back up now"; safe if another run is already in flight. */
  requestBackupNow(): Promise<void> {
    this._clearTimers();
    return this.runBackup('manual');
  }

  async runBackup(reason: string): Promise<void> {
    if (!this._started) return;
    this._clearDebounce();
    if (this._inFlight) {
      return this._inFlight;
    }
    if (this._importInProgress) {
      Log.log(`PersonalAutoBackup: paused during import (${reason})`);
      return;
    }
    this._inFlight = this._doBackup().finally(() => {
      this._inFlight = null;
      if (
        this._pending &&
        !this._closing &&
        !this._importInProgress &&
        this.status().kind !== 'failed'
      )
        this.handleDataChange();
    });
    return this._inFlight;
  }

  private async _start(): Promise<void> {
    if (this._started) return;
    this._started = true;
    await this.refreshVersions();
    this._actionsSub = this._localActions$
      .pipe(filter(isPersistentAction), takeUntilDestroyed(this._destroyRef))
      .subscribe(() => this.handleDataChange());
    this._importSub = this._imexView.isDataImportInProgress$
      .pipe(takeUntilDestroyed(this._destroyRef))
      .subscribe((isInProgress) => {
        const wasImporting = this._importInProgress;
        this._importInProgress = isInProgress;
        if (isInProgress) {
          this._clearTimers();
          this._changeRevision++;
          this._pending = true;
        } else if (wasImporting) {
          this.handleDataChange();
        }
      });
    if (IS_ELECTRON) this._setupCloseProtection();
    await this.runBackup('startup');
  }

  private async _doBackup(): Promise<void> {
    const revision = this._changeRevision;
    this._clearTimers();
    this.status.update((current) => ({ ...current, kind: 'running' }));
    try {
      const snapshot = await this._facade.captureSnapshot();
      if (this._importInProgress || revision !== this._changeRevision) {
        this._pending = true;
        this.status.update((current) => ({ ...current, kind: 'idle', pending: true }));
        return;
      }
      if (!hasAnyUserData(snapshot.data)) {
        this._pending = false;
        this.status.update((current) => ({
          ...current,
          kind: 'empty',
          pending: false,
          error: null,
        }));
        return;
      }
      if (!(await this._validator.isValid(snapshot.data))) {
        throw new Error('INVALID_SNAPSHOT_DATA');
      }
      const unchanged = await this._isSameAsLatest(snapshot);
      if (this._importInProgress || revision !== this._changeRevision) {
        this._pending = true;
        this.status.update((current) => ({ ...current, kind: 'idle', pending: true }));
        return;
      }
      if (unchanged) {
        this._pending = this._changeRevision !== revision;
        this.status.update((current) => ({
          ...current,
          kind: 'success',
          pending: this._pending,
          error: null,
        }));
        return;
      }
      await this._store.write(snapshot, 'auto');
      await this.refreshVersions(true);
      this._pending = this._changeRevision !== revision;
      this.status.update((current) => ({
        ...current,
        kind: 'success',
        pending: this._pending,
        error: null,
      }));
      Log.log('PersonalAutoBackup: automatic version committed');
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      Log.err('PersonalAutoBackup: backup failed');
      this._pending = true;
      this.status.update((current) => ({
        ...current,
        kind: 'failed',
        pending: true,
        error: message,
      }));
    }
  }

  private async _isSameAsLatest(
    snapshot: CompleteBackup<AllModelConfig>,
  ): Promise<boolean> {
    const latest = this.versions().find((version) => version.valid);
    if (!latest) return false;
    try {
      const current = await this._store.read(latest.id);
      const parsed = JSON.parse(current.text) as CompleteBackup<AllModelConfig>;
      return JSON.stringify(parsed.data) === JSON.stringify(snapshot.data);
    } catch {
      return false;
    }
  }

  private _clearDebounce(): void {
    if (this._debounceTimer) clearTimeout(this._debounceTimer);
    this._debounceTimer = null;
  }

  private _clearTimers(): void {
    this._clearDebounce();
    if (this._maxWaitTimer) clearTimeout(this._maxWaitTimer);
    this._maxWaitTimer = null;
  }

  private _setupCloseProtection(): void {
    this._execBeforeClose.schedule(AUTO_BACKUP_CLOSE_ID, true);
    this._closeSub = this._execBeforeClose.onBeforeClose$
      .pipe(
        filter((ids) => ids.includes(AUTO_BACKUP_CLOSE_ID)),
        takeUntilDestroyed(this._destroyRef),
      )
      .subscribe(() => void this._handleCloseRequested());
  }

  private async _handleCloseRequested(): Promise<void> {
    if (this._closing) return;
    this._closing = true;
    this._clearTimers();
    try {
      if (!(await this._execBeforeClose.waitForOtherHandlers(AUTO_BACKUP_CLOSE_ID)))
        return;
      // Draft and primary-storage guards have completed. Re-capture after them,
      // even when an earlier background copy was already in flight.
      if (this._inFlight) await this._inFlight;
      do {
        await this.runBackup('close');
        if (this.status().kind === 'failed') {
          const choice = await firstValueFrom(
            this._dialog
              .open(PersonalBackupCloseDialogComponent, {
                disableClose: false,
                restoreFocus: true,
              })
              .afterClosed(),
          );
          if (choice === 'retry') continue;
          if (choice === 'exit') break;
          this._execBeforeClose.cancelClose();
          return;
        }
      } while (this._pending);
      this._execBeforeClose.setDone(AUTO_BACKUP_CLOSE_ID);
    } finally {
      this._closing = false;
      if (this._pending && this.status().kind !== 'failed') this.handleDataChange();
    }
  }
}
