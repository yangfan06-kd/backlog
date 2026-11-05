import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  computed,
  inject,
  OnDestroy,
  OnInit,
  signal,
  viewChild,
} from '@angular/core';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { Subscription, filter } from 'rxjs';
import { IS_ELECTRON } from '../../app.constants';
import { ExecBeforeCloseService } from '../../core/electron/exec-before-close.service';
import { PersonalProgressService } from '../personal-progress/personal-progress.service';
import { PersonalBackupActivityService } from './personal-backup-activity.service';
import { PersonalBackupFacade } from './personal-backup.facade';
import { PersonalAutoBackupService } from './personal-auto-backup.service';
import { PERSONAL_PREVIEW_MODE } from './personal-preview-mode';
import { Project1BackupMeta } from '../../imex/local-backup/local-backup.model';

type BackupStatus =
  | 'idle'
  | 'exporting'
  | 'saved'
  | 'cancelled'
  | 'restoring'
  | 'restored'
  | 'error';

@Component({
  selector: 'personal-backup-page',
  standalone: true,
  imports: [TranslatePipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './personal-backup-page.component.html',
  styleUrl: './personal-backup-page.component.scss',
})
export class PersonalBackupPageComponent implements OnInit, OnDestroy {
  private readonly _facade = inject(PersonalBackupFacade);
  private readonly _autoBackup = inject(PersonalAutoBackupService);
  readonly isPreview = inject(PERSONAL_PREVIEW_MODE);
  private readonly _activity = inject(PersonalBackupActivityService);
  private readonly _progressService = inject(PersonalProgressService);
  private readonly _execBeforeClose = inject(ExecBeforeCloseService);
  private readonly _translate = inject(TranslateService);
  private readonly _restoreInput =
    viewChild<ElementRef<HTMLInputElement>>('restoreInput');
  private readonly _closeId = 'personal-backup-save';
  private _closeSub?: Subscription;
  private _closeRequestedWhileSaving = false;

  readonly status = signal<BackupStatus>('idle');
  readonly message = signal<string | null>(null);
  readonly savedPath = signal<string | null>(null);
  readonly dataPath = signal<string>('...');
  readonly backupDeleteMode = signal(false);
  readonly showAllVersions = signal(false);
  readonly visibleVersions = computed(() =>
    this.backupDeleteMode() || this.showAllVersions()
      ? this._autoBackup.versions()
      : this._autoBackup.versions().slice(0, 5),
  );
  readonly selectedBackupIds = signal<ReadonlySet<string>>(new Set());
  readonly isSaving = computed(
    () => this.status() === 'exporting' || this.status() === 'restoring',
  );
  readonly isBusy = computed(
    () => this.isSaving() || this._autoBackup.status().kind === 'running',
  );
  readonly autoStatus = this._autoBackup.status;

  autoStatusText(): string {
    const auto = this._autoBackup.status();
    if (auto.kind === 'failed') {
      return 'PERSONAL_BACKUP.AUTO_FAILED';
    }
    if (auto.kind === 'running' || auto.pending) {
      return 'PERSONAL_BACKUP.AUTO_PENDING';
    }
    if (auto.kind === 'empty') return 'PERSONAL_BACKUP.AUTO_NO_DATA';
    if (auto.lastSuccess) return 'PERSONAL_BACKUP.AUTO_SUCCESS';
    return 'PERSONAL_BACKUP.AUTO_WAITING';
  }

  autoLastSuccessText(): string {
    const last = this._autoBackup.status().lastSuccess;
    return last
      ? new Date(last).toLocaleString()
      : this._translate.instant('PERSONAL_BACKUP.AUTO_NEVER');
  }

  autoVersionTime(version: Project1BackupMeta): string {
    return new Date(version.createdAt).toLocaleString();
  }

  autoVersionKind(version: Project1BackupMeta): string {
    return version.kind === 'recovery'
      ? this._translate.instant('PERSONAL_BACKUP.AUTO_KIND_RECOVERY')
      : this._translate.instant('PERSONAL_BACKUP.AUTO_KIND_AUTO');
  }

  autoVersionSize(version: Project1BackupMeta): string {
    return `${Math.max(1, Math.round(version.size / 1024))} KB`;
  }

  autoBackupDirectory(): string {
    return this._autoBackup.backupDirectory() || this.dataPath();
  }

  ngOnInit(): void {
    this._setupCloseProtection();
    void this._loadDataPath();
    void this._autoBackup.refreshVersions();
  }

  autoVersions(): Project1BackupMeta[] {
    return this._autoBackup.versions();
  }

  async backupNow(): Promise<void> {
    if (this.isBusy()) return;
    this._activity.isBusy.set(true);
    try {
      await this._autoBackup.requestBackupNow();
    } finally {
      this._activity.isBusy.set(false);
      if (this._autoBackup.status().kind === 'failed') {
        this._cancelPendingClose();
      } else {
        this._resumeCloseAfterSave();
      }
    }
  }

  toggleDeleteMode(): void {
    if (!this.backupDeleteMode()) {
      this.backupDeleteMode.set(true);
      this.selectedBackupIds.set(new Set());
      return;
    }
    if (this.selectedBackupIds().size > 0) void this.deleteSelectedBackups();
  }

  cancelDeleteMode(): void {
    this.backupDeleteMode.set(false);
    this.selectedBackupIds.set(new Set());
  }

  isBackupSelected(id: string): boolean {
    return this.selectedBackupIds().has(id);
  }

  toggleBackupSelection(id: string, selected: boolean): void {
    const next = new Set(this.selectedBackupIds());
    if (selected) next.add(id);
    else next.delete(id);
    this.selectedBackupIds.set(next);
  }

  async deleteSelectedBackups(): Promise<void> {
    const ids = [...this.selectedBackupIds()];
    if (ids.length === 0 || this.isBusy()) return;
    if (!window.confirm(`删除选中的 ${ids.length} 个备份？\n此操作不能恢复。`)) return;
    this._activity.isBusy.set(true);
    let failed = 0;
    try {
      for (const id of ids) {
        try {
          await this._autoBackup.deleteVersion(id);
        } catch {
          failed++;
        }
      }
      this.backupDeleteMode.set(false);
      this.selectedBackupIds.set(new Set());
      this.status.set(failed > 0 ? 'error' : 'saved');
      this.message.set(
        failed > 0 ? `${failed} 个备份删除失败` : 'PERSONAL_BACKUP.DELETED',
      );
    } finally {
      this._activity.isBusy.set(false);
      await this._autoBackup.refreshVersions();
    }
  }

  async restoreAutoVersion(version: Project1BackupMeta): Promise<void> {
    if (!version.valid || this.isBusy()) return;
    const confirmed = window.confirm(
      this._translate.instant('PERSONAL_BACKUP.AUTO_RESTORE_CONFIRM', {
        date: new Date(version.createdAt).toLocaleString(),
      }),
    );
    if (!confirmed) return;
    this.status.set('restoring');
    this.message.set(null);
    this._activity.isBusy.set(true);
    try {
      await this._facade.restoreAutoVersion(version.id);
      this._progressService.resetRecentUndo();
      this._progressService.resetHistoryEditing();
      this.status.set('restored');
      this.message.set('PERSONAL_BACKUP.RESTORED');
      await this._autoBackup.refreshVersions();
    } catch (e) {
      this.status.set('error');
      this.message.set(
        e instanceof Error
          ? e.message
          : this._translate.instant('PERSONAL_BACKUP.FAILED'),
      );
    } finally {
      this._activity.isBusy.set(false);
      if (this.status() === 'error') this._cancelPendingClose();
      else this._resumeCloseAfterSave();
    }
  }

  ngOnDestroy(): void {
    this._teardownCloseProtection();
    this._activity.isBusy.set(false);
  }

  async exportBackup(): Promise<void> {
    if (this.isBusy()) return;
    this.status.set('exporting');
    this.message.set(null);
    this.savedPath.set(null);
    this._activity.isBusy.set(true);
    try {
      const result = await this._facade.exportBackup();
      if (result.status === 'saved') {
        this.status.set('saved');
        this.savedPath.set(result.path ?? null);
        this.message.set('PERSONAL_BACKUP.EXPORTED');
      } else if (result.status === 'cancelled') {
        this.status.set('cancelled');
        this.message.set('PERSONAL_BACKUP.CANCELLED');
      } else {
        this.status.set('error');
        this.message.set(this._errorText(result.code));
      }
    } catch (e) {
      this.status.set('error');
      this.message.set(e instanceof Error ? e.message : 'PERSONAL_BACKUP.FAILED');
    } finally {
      this._activity.isBusy.set(false);
      if (this.status() === 'error') this._cancelPendingClose();
      else this._resumeCloseAfterSave();
    }
  }

  openRestorePicker(): void {
    if (this.isBusy()) return;
    this._restoreInput()?.nativeElement.click();
  }

  async onRestoreFile(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file || this.isBusy()) return;
    const confirmed = window.confirm(
      this._translate.instant('PERSONAL_BACKUP.RESTORE_CONFIRM'),
    );
    if (!confirmed) {
      this.status.set('idle');
      this.message.set(null);
      return;
    }
    this.status.set('restoring');
    this.message.set(null);
    this.savedPath.set(null);
    this._activity.isBusy.set(true);
    try {
      const text = await file.text();
      await this._facade.restoreFromText(text);
      this._progressService.resetRecentUndo();
      this._progressService.resetHistoryEditing();
      this.status.set('restored');
      this.message.set('PERSONAL_BACKUP.RESTORED');
    } catch (e) {
      this.status.set('error');
      this.message.set(
        e instanceof Error
          ? e.message
          : this._translate.instant('PERSONAL_BACKUP.FAILED'),
      );
    } finally {
      this._activity.isBusy.set(false);
      if (this.status() === 'error') this._cancelPendingClose();
      else this._resumeCloseAfterSave();
    }
  }

  statusText(): string {
    if (this.status() === 'error') return this.message() ?? 'PERSONAL_BACKUP.FAILED';
    if (this.message()) return this.message()!;
    switch (this.status()) {
      case 'exporting':
        return 'PERSONAL_BACKUP.EXPORTING';
      case 'restoring':
        return 'PERSONAL_BACKUP.RESTORING';
      case 'saved':
        return 'PERSONAL_BACKUP.EXPORTED';
      case 'restored':
        return 'PERSONAL_BACKUP.RESTORED';
      case 'cancelled':
        return 'PERSONAL_BACKUP.CANCELLED';
      default:
        return 'PERSONAL_BACKUP.READY';
    }
  }

  private async _loadDataPath(): Promise<void> {
    try {
      const path = await window.ea?.getUserDataPath?.();
      if (path) this.dataPath.set(path);
    } catch {
      // Browser fallback: the data path is only a desktop diagnostic.
    }
  }

  private _errorText(code: string): string {
    switch (code) {
      case 'PREVIEW_PATH_OUTSIDE':
        return this._translate.instant('PERSONAL_BACKUP.PATH_OUTSIDE');
      case 'PREVIEW_WRITE_FAILED':
        return this._translate.instant('PERSONAL_BACKUP.WRITE_FAILED');
      case 'PREVIEW_RUNTIME_MISSING':
        return this._translate.instant('PERSONAL_BACKUP.RUNTIME_MISSING');
      default:
        return this._translate.instant('PERSONAL_BACKUP.FAILED');
    }
  }

  private _setupCloseProtection(): void {
    if (IS_ELECTRON) {
      this._execBeforeClose.schedule(this._closeId);
      this._closeSub = this._execBeforeClose.onBeforeClose$
        .pipe(filter((ids) => ids.includes(this._closeId)))
        .subscribe(() => void this._handleCloseRequested());
      window.addEventListener('beforeunload', this._onBeforeUnload);
    } else {
      window.addEventListener('beforeunload', this._onBeforeUnload);
    }
  }

  private _teardownCloseProtection(): void {
    if (IS_ELECTRON) {
      this._execBeforeClose.unschedule(this._closeId);
      this._closeSub?.unsubscribe();
    }
    window.removeEventListener('beforeunload', this._onBeforeUnload);
  }

  private _onBeforeUnload = (event: BeforeUnloadEvent): void => {
    if (!this.isSaving()) return;
    event.preventDefault();
    event.returnValue = '';
  };

  private async _handleCloseRequested(): Promise<void> {
    if (this.isSaving()) {
      this._closeRequestedWhileSaving = true;
      return;
    }
    if (!(await this._execBeforeClose.waitForOtherHandlers(this._closeId))) return;
    if (this.isSaving()) {
      this._closeRequestedWhileSaving = true;
      return;
    }
    this._execBeforeClose.setDone(this._closeId);
  }

  private _resumeCloseAfterSave(): void {
    if (!this._closeRequestedWhileSaving || this.isSaving()) return;
    this._closeRequestedWhileSaving = false;
    setTimeout(() => void this._handleCloseRequested(), 0);
  }

  private _cancelPendingClose(): void {
    if (!this._closeRequestedWhileSaving) return;
    this._closeRequestedWhileSaving = false;
    this._execBeforeClose.cancelClose();
  }
}
