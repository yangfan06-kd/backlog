import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  OnInit,
  ViewChild,
  computed,
  inject,
  signal,
} from '@angular/core';
import { PersonalTextViewComponent } from '../personal-text/personal-text-view.component';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, Router } from '@angular/router';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { Store } from '@ngrx/store';
import { combineLatest } from 'rxjs';
import { filter } from 'rxjs/operators';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { nanoid } from 'nanoid';
import { DateService } from '../../core/date/date.service';
import { DataInitStateService } from '../../core/data-init/data-init-state.service';
import { ExecBeforeCloseService } from '../../core/electron/exec-before-close.service';
import { IS_ELECTRON } from '../../app.constants';
import { TaskArchiveService } from '../archive/task-archive.service';
import { Task } from '../tasks/task.model';
import { selectAllTasks } from '../tasks/store/task.selectors';
import { Project } from '../project/project.model';
import { ProjectService } from '../project/project.service';
import { selectAllProjects } from '../project/store/project.selectors';
import { PersonalProjectLifecycleService } from './personal-project-lifecycle.service';
import { PersonalProjectManagementService } from '../personal-progress/personal-project-management.service';
import {
  personalProjectLifecycle,
  personalProjectKind,
} from '../personal-progress/personal-progress.model';
import { PersonalCommandCoordinatorService } from '../personal-progress/personal-command-coordinator.service';
import {
  PersonalArchiveProjectRow,
  PersonalArchiveView,
  buildPersonalArchiveView,
} from './personal-archive.view';
import { formatRoutineDay, isPersonalRecordDaySafe } from './personal-archive.date';

type LoadState = 'loading' | 'ready' | 'error';
type SaveState =
  | { kind: 'ready' }
  | { kind: 'saving' }
  | { kind: 'saved' }
  | { kind: 'error'; message: string };

@Component({
  selector: 'personal-archive-page',
  standalone: true,
  imports: [CommonModule, TranslatePipe, PersonalTextViewComponent],
  templateUrl: './personal-archive-page.component.html',
  styleUrls: ['./personal-archive-page.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PersonalArchivePageComponent implements OnInit {
  @ViewChild('archiveHeading') private _heading?: ElementRef<HTMLElement>;

  private _store = inject(Store);
  private _dateService = inject(DateService);
  private _taskArchive = inject(TaskArchiveService);
  private _lifecycle = inject(PersonalProjectLifecycleService);
  private _projectService = inject(ProjectService);
  private _management = inject(PersonalProjectManagementService);
  private _coordinator = inject(PersonalCommandCoordinatorService);
  private _dataInit = inject(DataInitStateService);
  private _route = inject(ActivatedRoute);
  private _router = inject(Router);
  private _translate = inject(TranslateService);
  private _destroyRef = inject(DestroyRef);
  private _execBeforeClose = inject(ExecBeforeCloseService);

  private _projects = signal<Project[]>([]);
  private _activeTasks = signal<Task[]>([]);
  private _archivedTasks = signal<Task[] | null>(null);
  private _loadState = signal<LoadState>('loading');
  private _loadError = signal<string | null>(null);
  private _hasCoreData = false;
  private _queryTargetProjectId: string | null = null;
  private _queryApplied = false;
  private _queryApplying = false;
  private _queryVersion = 0;
  private _closeRequestedWhileSaving = false;
  private _closeSub: { unsubscribe: () => void } | null = null;
  private readonly _closeId = 'personal-archive-save';

  readonly loadState = this._loadState.asReadonly();
  readonly loadError = this._loadError.asReadonly();
  readonly targetNotice = signal<string | null>(null);
  readonly expandedIds = signal<ReadonlySet<string>>(new Set());
  readonly saveState = signal<SaveState>({ kind: 'ready' });
  readonly restoredProjectId = signal<string | null>(null);
  readonly restoredTitle = signal<string | null>(null);
  readonly showTrash = signal(false);
  readonly trashProjects = computed(() =>
    this._projects()
      .filter((project) => !!project.personalProgress?.trash?.deletedAt)
      .sort(
        (a, b) =>
          (b.personalProgress?.trash?.deletedAt ?? 0) -
          (a.personalProgress?.trash?.deletedAt ?? 0),
      ),
  );
  readonly isSaving = computed(() => this.saveState().kind === 'saving');
  readonly view = computed<PersonalArchiveView>(() =>
    buildPersonalArchiveView(
      this._projects(),
      this._activeTasks(),
      this._archivedTasks() ?? [],
    ),
  );

  ngOnInit(): void {
    this._route.queryParamMap
      .pipe(takeUntilDestroyed(this._destroyRef))
      .subscribe((params) => {
        this.showTrash.set(params.get('trash') === '1');
        this._queryTargetProjectId = params.get('projectId')?.trim() || null;
        this._queryVersion++;
        this._queryApplied = false;
        void this._applyQueryTarget();
      });

    combineLatest([
      this._store.select(selectAllProjects),
      this._store.select(selectAllTasks),
      this._dataInit.isAllDataLoadedInitially$.pipe(filter(Boolean)),
    ])
      .pipe(takeUntilDestroyed(this._destroyRef))
      .subscribe(([projects, tasks]) => {
        this._projects.set(projects);
        this._activeTasks.set(tasks);
        this._hasCoreData = true;
        void this._applyQueryTarget();
      });

    void this.loadArchive();
    this._setupCloseProtection();
    this._destroyRef.onDestroy(() => this._teardownCloseProtection());
  }

  canDeactivate(): Promise<boolean> {
    return Promise.resolve(!this.isSaving());
  }

  async loadArchive(): Promise<void> {
    this._loadState.set('loading');
    this._loadError.set(null);
    try {
      const archive = await this._taskArchive.load();
      const tasks = archive.ids
        .map((id) => archive.entities[id as string])
        .filter((task): task is Task => !!task);
      this._archivedTasks.set(tasks);
      this._loadState.set('ready');
      void this._applyQueryTarget();
    } catch (e) {
      this._archivedTasks.set(null);
      this._loadState.set('error');
      this._loadError.set(e instanceof Error ? e.message : 'Archive load failed');
    }
  }

  toggleCard(row: PersonalArchiveProjectRow): void {
    this.expandedIds.update((current) => {
      const next = new Set(current);
      if (next.has(row.project.id)) next.delete(row.project.id);
      else next.add(row.project.id);
      return next;
    });
  }

  isExpanded(row: PersonalArchiveProjectRow): boolean {
    return this.expandedIds().has(row.project.id);
  }

  doneDate(row: PersonalArchiveProjectRow): string | null {
    if (row.doneOn === null) return null;
    const day = this._dateService.todayStr(row.doneOn);
    return this._formatDay(day);
  }

  dayLabel(day: string): string {
    return this._formatDay(day);
  }

  remainingCount(row: PersonalArchiveProjectRow): number {
    return row.remainingSteps.length;
  }

  sourceLabel(entry: { entry: { source: string } }): string {
    return entry.entry.source === 'step-completion'
      ? 'PERSONAL_ARCHIVE.SOURCE.STEP'
      : 'PERSONAL_ARCHIVE.SOURCE.MANUAL';
  }

  async restoreProject(row: PersonalArchiveProjectRow): Promise<void> {
    if (this.isSaving()) return;
    const message = this._translate.instant('PERSONAL_ARCHIVE.RESTORE_CONFIRM', {
      project: row.project.title,
    });
    if (!window.confirm(message)) return;
    this.saveState.set({ kind: 'saving' });
    try {
      const result = await this._lifecycle.restoreProject({
        operationId: nanoid(),
        projectId: row.project.id,
        expectedRevision: personalProjectLifecycle(row.project).revision,
      });
      if (result.status === 'persisted') {
        this.restoredProjectId.set(row.project.id);
        this.restoredTitle.set(row.project.title);
        this.expandedIds.update((current) => {
          const next = new Set(current);
          next.delete(row.project.id);
          return next;
        });
        if (this._queryTargetProjectId === row.project.id) {
          this._queryTargetProjectId = null;
          this._queryApplied = true;
          this._replaceQuery(null);
        }
        this.saveState.set({ kind: 'saved' });
        setTimeout(() => this._heading?.nativeElement.focus(), 0);
      } else if (result.status === 'rejected') {
        this._cancelPendingClose();
        this.saveState.set({
          kind: 'error',
          message: this._translate.instant(`PERSONAL_ARCHIVE.REJECTED.${result.code}`),
        });
      } else {
        this._cancelPendingClose();
        this.saveState.set({ kind: 'error', message: result.message });
      }
    } catch (e) {
      this._cancelPendingClose();
      this.saveState.set({
        kind: 'error',
        message: e instanceof Error ? e.message : 'Restore failed',
      });
    } finally {
      void this._applyQueryTarget();
      this._resumeCloseAfterSave();
    }
  }

  openProgress(projectId: string): void {
    void this._router.navigate(['/personal-progress'], {
      queryParams: { projectId },
    });
  }

  saveStateText(): string {
    const state = this.saveState();
    if (state.kind === 'saving') {
      return this._coordinator.isPersistenceSlow()
        ? 'PERSONAL_PROGRESS.STATUS.SAVING_SLOW'
        : 'PERSONAL_ARCHIVE.STATUS.SAVING';
    }
    if (state.kind === 'saved') return 'PERSONAL_ARCHIVE.STATUS.SAVED';
    if (state.kind === 'error') return 'PERSONAL_ARCHIVE.STATUS.FAILED';
    return 'PERSONAL_ARCHIVE.STATUS.READY';
  }

  async deleteForever(project: Project): Promise<void> {
    if (this.isSaving()) return;
    if (
      !window.confirm(
        `永久删除项目“${project.title}”？项目、步骤和历史记录都会删除，无法恢复。`,
      )
    )
      return;
    this.saveState.set({ kind: 'saving' });
    try {
      await this._projectService.remove(project);
      this.saveState.set({ kind: 'saved' });
    } catch (e) {
      this.saveState.set({
        kind: 'error',
        message: e instanceof Error ? e.message : 'Delete failed',
      });
    }
  }

  async restoreDeletedProject(project: Project): Promise<void> {
    if (this.isSaving()) return;
    this.saveState.set({ kind: 'saving' });
    try {
      const result = await this._management.restore({
        operationId: nanoid(),
        projectId: project.id,
        ownerKind: personalProjectKind(project) === 'routine' ? 'routine' : 'project',
        expectedRevision: project.personalProgress?.trash?.revision ?? 0,
      });
      if (result.status === 'persisted') this.saveState.set({ kind: 'saved' });
      else {
        this._cancelPendingClose();
        this.saveState.set({
          kind: 'error',
          message:
            result.status === 'failed'
              ? result.message
              : this._translate.instant(`PERSONAL_ARCHIVE.REJECTED.${result.code}`),
        });
      }
    } catch (e) {
      this._cancelPendingClose();
      this.saveState.set({
        kind: 'error',
        message: e instanceof Error ? e.message : '恢复失败',
      });
    } finally {
      this._resumeCloseAfterSave();
    }
  }

  saveStateError(): string | null {
    const state = this.saveState();
    return state.kind === 'error' ? state.message : null;
  }

  private _formatDay(day: string): string {
    if (!isPersonalRecordDaySafe(day)) return day;
    return formatRoutineDay(
      day,
      this._dateService.todayStr(),
      this._translate.currentLang || 'zh',
    );
  }

  private _replaceQuery(projectId: string | null): void {
    void this._router.navigate([], {
      relativeTo: this._route,
      queryParams: projectId ? { projectId } : {},
      replaceUrl: true,
    });
  }

  private async _applyQueryTarget(): Promise<void> {
    if (
      this._queryApplied ||
      this._queryApplying ||
      !this._hasCoreData ||
      this._archivedTasks() === null ||
      this._loadState() !== 'ready' ||
      this.isSaving()
    ) {
      return;
    }
    const version = this._queryVersion;
    const target = this._queryTargetProjectId;
    if (!target) {
      this._queryApplied = true;
      this.targetNotice.set(null);
      return;
    }
    this._queryApplying = true;
    try {
      const row = this.view().rows.find((candidate) => candidate.project.id === target);
      if (!row) {
        this._queryApplied = true;
        this.targetNotice.set('PERSONAL_ARCHIVE.TARGET.NOT_FOUND');
        return;
      }
      this.expandedIds.update((current) => new Set(current).add(target));
      this.targetNotice.set(null);
      this._queryApplied = true;
      if (version !== this._queryVersion) return;
    } finally {
      this._queryApplying = false;
      if (
        version !== this._queryVersion &&
        !this._queryApplied &&
        !this._destroyRef.destroyed
      ) {
        void this._applyQueryTarget();
      }
    }
  }

  private _setupCloseProtection(): void {
    if (IS_ELECTRON) {
      this._execBeforeClose.schedule(this._closeId);
      this._closeSub = this._execBeforeClose.onBeforeClose$
        .pipe(filter((ids) => ids.includes(this._closeId)))
        .subscribe(() => {
          void this._handleCloseRequested();
        });
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
    setTimeout(() => {
      void this._handleCloseRequested();
    }, 0);
  }

  private _cancelPendingClose(): void {
    if (!this._closeRequestedWhileSaving) return;
    this._closeRequestedWhileSaving = false;
    this._execBeforeClose.cancelClose();
  }
}
