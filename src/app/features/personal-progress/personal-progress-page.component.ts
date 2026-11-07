import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  HostListener,
  OnInit,
  computed,
  inject,
  signal,
  viewChild,
  viewChildren,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import {
  CdkDrag,
  CdkDragPreview,
  CdkDragHandle,
  CdkDropList,
  CdkDropListGroup,
  CdkDragDrop,
  CdkDragEnd,
  CdkDragMove,
  moveItemInArray,
} from '@angular/cdk/drag-drop';
import { PersonalOverviewOrderService } from '../personal-overview/personal-overview-order.service';
import { PersonalRecordOrderService } from './personal-record-order.service';
import { CdkTrapFocus } from '@angular/cdk/a11y';
import { CdkScrollable } from '@angular/cdk/scrolling';
import {
  CdkConnectedOverlay,
  CdkOverlayOrigin,
  ConnectedPosition,
} from '@angular/cdk/overlay';
import { ActivatedRoute, Router } from '@angular/router';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { Store } from '@ngrx/store';
import { BehaviorSubject, Subscription, combineLatest } from 'rxjs';
import { filter } from 'rxjs/operators';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { nanoid } from 'nanoid';
import { BackupService } from '../../op-log/backup/backup.service';
import { AppDataComplete } from '../../op-log/model/model-config';
import { download } from '../../util/download';
import { ExecBeforeCloseService } from '../../core/electron/exec-before-close.service';
import { DataInitStateService } from '../../core/data-init/data-init-state.service';
import { IS_ELECTRON } from '../../app.constants';
import { Task } from '../tasks/task.model';
import { selectAllTasks } from '../tasks/store/task.selectors';
import { selectAllProjects } from '../project/store/project.selectors';
import {
  PersonalProgressService,
  CompleteStepInput,
  InsertStepInput,
} from './personal-progress.service';
import {
  PersonalCommandResult,
  PersonalProgressEntry,
  personalProjectLifecycle,
  personalProjectQuadrant,
  isPersonalProjectQuadrant,
} from './personal-progress.model';
import { PERSONAL_OVERVIEW_GROUPS } from '../personal-overview/personal-overview.view';
import {
  PersonalTextDraft,
  PersonalTextFormat,
  assertSupportedPersonalTextFormats,
  formatEquals,
} from '../personal-text/personal-text.model';
import { PersonalRichTextEditorComponent } from '../personal-text/personal-rich-text-editor.component';
import { PersonalTextViewComponent } from '../personal-text/personal-text-view.component';
import { PersonalProjectLifecycleService } from '../personal-archive/personal-project-lifecycle.service';
import { PersonalBackupFacade } from '../personal-workspace/personal-backup.facade';
import { PersonalAutoBackupService } from '../personal-workspace/personal-auto-backup.service';
import { PERSONAL_PREVIEW_MODE } from '../personal-workspace/personal-preview-mode';
import { PersonalProjectToolsComponent } from './personal-project-tools.component';
import { PersonalFolder, PersonalFolderService } from './personal-folder.service';
import {
  PersonalProjectManagementService,
  RenameProjectInput,
} from './personal-project-management.service';
import { PersonalCompletionUndoService } from './personal-completion-undo.service';
import { PersonalEntryDeleteService } from './personal-entry-delete.service';
import { Project } from '../project/project.model';
import {
  PersonalProgressProjectRow,
  PersonalProgressStepView,
  buildPersonalProgressView,
  personalProgressDayAria,
  personalProgressDayLabel,
} from './personal-progress.view';

type SaveState =
  | { kind: 'ready' }
  | { kind: 'idle' }
  | { kind: 'saving' }
  | { kind: 'saved' }
  | { kind: 'rejected'; code: string }
  | { kind: 'failed'; message: string };

type DraftKind = 'step' | 'entry' | 'insert' | 'newEntry';
type DraftPromptMode =
  | 'switch'
  | 'collapse'
  | 'history'
  | 'edit'
  | 'route'
  | 'restore'
  | 'close';
type DraftChoice = 'save' | 'discard' | 'continue';

interface ActiveDraft {
  kind: DraftKind;
  projectId: string;
  projectTitle: string;
  original: string;
  originalFormat?: PersonalTextFormat | null;
  recordDay?: string;
}

interface DraftPrompt {
  mode: DraftPromptMode;
  projectTitle: string;
  kind: DraftKind;
}

@Component({
  selector: 'personal-progress-page',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    TranslatePipe,
    CdkTrapFocus,
    CdkConnectedOverlay,
    CdkOverlayOrigin,
    CdkScrollable,
    CdkDrag,
    CdkDragPreview,
    CdkDragHandle,
    CdkDropList,
    CdkDropListGroup,
    PersonalRichTextEditorComponent,
    PersonalTextViewComponent,
    PersonalProjectToolsComponent,
  ],
  templateUrl: './personal-progress-page.component.html',
  styleUrls: ['./personal-progress-page.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PersonalProgressPageComponent implements OnInit {
  private _store = inject(Store);
  private _service = inject(PersonalProgressService);
  private _backupService = inject(BackupService);
  private _destroyRef = inject(DestroyRef);
  private _execBeforeClose = inject(ExecBeforeCloseService);
  private _dataInitState = inject(DataInitStateService);
  private _route = inject(ActivatedRoute);
  private _router = inject(Router);
  private _translate = inject(TranslateService);
  private _lifecycle = inject(PersonalProjectLifecycleService);
  private _backupFacade = inject(PersonalBackupFacade);
  private _autoBackup = inject(PersonalAutoBackupService);
  private readonly _isPreviewMode = inject(PERSONAL_PREVIEW_MODE);
  private readonly _management = inject(PersonalProjectManagementService);
  private readonly _folders = inject(PersonalFolderService);
  private readonly _completionUndo = inject(PersonalCompletionUndoService);
  private readonly _entryDelete = inject(PersonalEntryDeleteService);

  readonly autoBackupStatus = this._autoBackup.status;

  private _archiveTasks$ = new BehaviorSubject<Task[]>([]);
  private _today = signal(this._service.todayStr());
  private _selectedProjectId = signal<string | null>(null);
  private _view = signal(buildPersonalProgressView([], [], [], this._service.todayStr()));

  readonly today = this._today.asReadonly();
  readonly selectedProjectId = this._selectedProjectId.asReadonly();
  readonly view = this._view.asReadonly();
  readonly folders = this._folders.folders;
  readonly folderAssignments = this._folders.assignments;
  readonly activeFolderId = signal<string | null>(null);
  readonly activeFolder = computed(() =>
    this.activeFolderId()
      ? (this.folders().find((folder) => folder.id === this.activeFolderId()) ?? null)
      : null,
  );
  readonly folderCards = viewChildren<ElementRef<HTMLElement>>('folderCard');
  readonly folderDropTargetId = signal<string | null>(null);
  private _folderDragActive = false;
  readonly visibleRows = computed(() => {
    const activeFolderId = this.activeFolderId();
    const assignments = this.folderAssignments();
    return this.view().rows.filter((row) =>
      activeFolderId
        ? assignments[row.project.id] === activeFolderId
        : !assignments[row.project.id],
    );
  });
  readonly projectQuickFilter = signal<'all' | 'remaining' | 'week' | 'stale'>('all');
  readonly projectQuadrantFilter = signal('all');
  readonly projectFiltersOpen = signal(false);
  readonly projectFilterOptions: {
    id: 'all' | 'remaining' | 'week' | 'stale';
    label: string;
  }[] = [
    { id: 'all', label: '全部' },
    { id: 'remaining', label: '还有步骤' },
    { id: 'week', label: '本周有记录' },
    { id: 'stale', label: '30 天无记录' },
  ];
  readonly quadrantFilterOptions = PERSONAL_OVERVIEW_GROUPS;
  readonly hasProjectFilters = computed(
    () => this.projectQuickFilter() !== 'all' || this.projectQuadrantFilter() !== 'all',
  );
  readonly projectFilterCount = computed(
    () =>
      (this.projectQuickFilter() === 'all' ? 0 : 1) +
      (this.projectQuadrantFilter() === 'all' ? 0 : 1),
  );
  readonly boardRows = computed(() => {
    const rows = this.visibleRows();
    if (this.activeFolderId() || !this.hasProjectFilters()) return rows;
    const today = this.view().today;
    const weekStart = this._weekStart(today);
    const staleCutoff = this._shiftDay(today, -30);
    const quickFilter = this.projectQuickFilter();
    const quadrant = this.projectQuadrantFilter();
    return rows.filter((row) => {
      if (quickFilter === 'remaining' && row.steps.length === 0) return false;
      if (quickFilter === 'week') {
        const hasWeekRecord = [...row.entriesByDay.keys()].some(
          (day) => day >= weekStart && day <= today,
        );
        if (!hasWeekRecord) return false;
      }
      if (quickFilter === 'stale') {
        if (row.steps.length === 0) return false;
        const days = [...row.entriesByDay.keys()].sort();
        const lastDay = days.at(-1) ?? null;
        const plannedDay = row.project.personalProgress?.planning?.day ?? null;
        if (lastDay ? lastDay >= staleCutoff : !plannedDay || plannedDay >= staleCutoff) {
          return false;
        }
      }
      if (quadrant !== 'all' && this.currentQuadrant(row) !== quadrant) return false;
      return true;
    });
  });
  readonly historyDates = computed(() => {
    const today = this.view().today;
    const dates = new Set<string>();
    for (const row of this.boardRows()) {
      if (!row.isExpanded) continue;
      for (const day of row.entriesByDay.keys()) {
        if (day !== today) dates.add(day);
      }
    }
    return [...dates].sort();
  });
  readonly displayHistoryDates = computed(() =>
    this.recordExpanded() ? this.historyDates() : this.historyDates().slice(0, 1),
  );
  readonly gridTemplateColumns = computed(() => {
    const visibleHistoryCount = this.displayHistoryDates().length;
    if (this.recordExpanded()) {
      const dateCount = visibleHistoryCount + 1;
      return `var(--pp-project-width) repeat(${dateCount}, minmax(0, 1fr))`;
    }
    const dateCount = visibleHistoryCount + 1;
    if (dateCount === 1) {
      return `minmax(var(--pp-project-width), 1fr) minmax(var(--pp-day-min-width, 96px), 1fr) minmax(var(--pp-steps-width), 1fr)`;
    }
    return `var(--pp-project-width) repeat(${dateCount}, minmax(var(--pp-day-min-width, 96px), 1fr)) var(--pp-steps-width)`;
  });
  readonly isSingleDateLayout = computed(
    () => !this.recordExpanded() && this.displayHistoryDates().length === 0,
  );
  readonly recordExpanded = signal(false);
  readonly canExpandRecords = computed(() => this.historyDates().length > 0);
  readonly todayLabel = computed(
    () =>
      `${this._translate.instant('PERSONAL_PROGRESS.TODAY')} · ${personalProgressDayLabel(
        this.view().today,
        this.view().today,
      )}`,
  );
  readonly editorPositions: ConnectedPosition[] = [
    {
      originX: 'start',
      originY: 'bottom',
      overlayX: 'start',
      overlayY: 'top',
      offsetY: 4,
    },
    {
      originX: 'start',
      originY: 'top',
      overlayX: 'start',
      overlayY: 'bottom',
      offsetY: -4,
    },
  ];
  readonly saveState = signal<SaveState>({ kind: 'ready' });
  readonly isSaving = computed(() => this.saveState().kind === 'saving');
  readonly selectedRow = computed<PersonalProgressProjectRow | undefined>(() =>
    this.view().rows.find((row) => row.project.id === this._selectedProjectId()),
  );
  readonly quadrantOptions = PERSONAL_OVERVIEW_GROUPS;

  currentQuadrant(row: PersonalProgressProjectRow): string {
    const value = personalProjectQuadrant(row.project).value;
    return value && isPersonalProjectQuadrant(value) ? value : 'unclassified';
  }

  async setQuadrant(row: PersonalProgressProjectRow, value: string): Promise<void> {
    if (!row || this.isSaving()) return;
    if (value !== 'unclassified' && !isPersonalProjectQuadrant(value)) return;
    const result = await this._run(() =>
      this._service.setProjectQuadrant({
        operationId: nanoid(),
        projectId: row.project.id,
        expectedRevision: personalProjectQuadrant(row.project).revision,
        quadrant: value === 'unclassified' ? null : value,
      }),
    );
    if (result?.status === 'persisted') this.markSaved();
  }

  toggleProjectFilters(): void {
    this.projectFiltersOpen.update((open) => !open);
  }

  setProjectQuickFilter(quickFilter: 'all' | 'remaining' | 'week' | 'stale'): void {
    this.projectQuickFilter.set(quickFilter);
  }

  onProjectQuadrantFilter(event: Event): void {
    this.projectQuadrantFilter.set((event.target as HTMLSelectElement).value);
  }

  resetProjectFilters(): void {
    this.projectQuickFilter.set('all');
    this.projectQuadrantFilter.set('all');
  }

  private _weekStart(day: string): string {
    const [year, month, date] = day.split('-').map(Number);
    const current = new Date(year, month - 1, date);
    current.setDate(current.getDate() - ((current.getDay() + 6) % 7));
    return this._dateToDay(current);
  }

  private _shiftDay(day: string, amount: number): string {
    const [year, month, date] = day.split('-').map(Number);
    const current = new Date(year, month - 1, date);
    current.setDate(current.getDate() + amount);
    return this._dateToDay(current);
  }

  private _dateToDay(date: Date): string {
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
  }

  readonly draftPrompt = signal<DraftPrompt | null>(null);
  readonly targetNotice = signal<string | null>(null);
  readonly folderMenuId = signal<string | null>(null);
  readonly renamingFolderId = signal<string | null>(null);
  folderDraftName = '';
  readonly archivedProjectId = signal<string | null>(null);
  private _draftPromptResolver: ((proceed: boolean) => void) | null = null;
  private readonly _entryDayInput =
    viewChild<ElementRef<HTMLInputElement>>('entryDayInput');
  private _queryTargetProjectId: string | null = null;
  private _queryApplied = false;
  private _queryApplying = false;
  private _queryVersion = 0;
  private _hasViewData = false;

  readonly creatingProject = signal(false);
  readonly manualEntryOpen = signal(false);
  private _recordOrder = inject(PersonalRecordOrderService);
  private _rowOrder = inject(PersonalOverviewOrderService);
  newProjectTitle = '';
  newProjectDay = '';
  private readonly _newEntryBody = signal('');
  private readonly _newEntryFormat = signal<PersonalTextFormat | null>(null);
  get newEntryBody(): string {
    return this._newEntryBody();
  }
  set newEntryBody(value: string) {
    this._newEntryBody.set(value);
  }
  get newEntryFormat(): PersonalTextFormat | null {
    return this._newEntryFormat();
  }
  set newEntryFormat(value: PersonalTextFormat | null) {
    this._newEntryFormat.set(value);
  }
  newEntryDay = this._service.todayStr();
  newEntryProjectId: string | null = null;
  readonly inlineNewProjectId = signal<string | null>(null);
  private readonly _insertTitle = signal('');
  private readonly _insertFormat = signal<PersonalTextFormat | null>(null);
  get insertTitle(): string {
    return this._insertTitle();
  }
  set insertTitle(value: string) {
    this._insertTitle.set(value);
  }
  get insertFormat(): PersonalTextFormat | null {
    return this._insertFormat();
  }
  set insertFormat(value: PersonalTextFormat | null) {
    this._insertFormat.set(value);
  }
  insertingAfter = signal<{ projectId: string; afterStepId: string | null } | null>(null);
  editingEntryId = signal<string | null>(null);
  editingEntryProjectId: string | null = null;
  private readonly _editBody = signal('');
  private readonly _editBodyFormat = signal<PersonalTextFormat | null>(null);
  get editBody(): string {
    return this._editBody();
  }
  set editBody(value: string) {
    this._editBody.set(value);
  }
  get editBodyFormat(): PersonalTextFormat | null {
    return this._editBodyFormat();
  }
  set editBodyFormat(value: PersonalTextFormat | null) {
    this._editBodyFormat.set(value);
  }
  editRevision = 0;
  editingStepId = signal<string | null>(null);
  editingStepProjectId: string | null = null;
  private readonly _editStepTitle = signal('');
  private readonly _editStepFormat = signal<PersonalTextFormat | null>(null);
  get editStepTitle(): string {
    return this._editStepTitle();
  }
  set editStepTitle(value: string) {
    this._editStepTitle.set(value);
  }
  get editStepFormat(): PersonalTextFormat | null {
    return this._editStepFormat();
  }
  set editStepFormat(value: PersonalTextFormat | null) {
    this._editStepFormat.set(value);
  }
  editStepOriginal = '';
  editStepRevision = 0;
  readonly manualEditorBlocked = computed(
    () => !!this.editingStepId() || !!this.editingEntryId() || !!this.insertingAfter(),
  );

  private readonly _closeId = 'personal-progress-draft-close';
  private _closeSub: Subscription | null = null;
  private _closePromptOpen = false;
  private _closeRequestedWhileSaving = false;

  readonly activeDraft = computed<ActiveDraft | null>(() => {
    const stepId = this.editingStepId();
    if (stepId) {
      const project = this._view().rows.find(
        (row) => row.project.id === this.editingStepProjectId,
      );
      return {
        kind: 'step',
        projectId: this.editingStepProjectId ?? '',
        projectTitle: project?.project.title ?? '',
        original: this.editStepOriginal,
        originalFormat: this._editStepOriginalFormat,
      };
    }
    const entryId = this.editingEntryId();
    if (entryId) {
      const project = this._view().rows.find(
        (row) => row.project.id === this.editingEntryProjectId,
      );
      return {
        kind: 'entry',
        projectId: this.editingEntryProjectId ?? '',
        projectTitle: project?.project.title ?? '',
        original: this._editingEntryOriginalBody,
        originalFormat: this._editingEntryOriginalFormat,
        recordDay: this._editingEntryDay,
      };
    }
    const insert = this.insertingAfter();
    if (insert) {
      const project = this._view().rows.find(
        (row) => row.project.id === insert.projectId,
      );
      return {
        kind: 'insert',
        projectId: insert.projectId,
        projectTitle: project?.project.title ?? '',
        original: '',
        originalFormat: null,
      };
    }
    if (this.newEntryBody.trim() || this.newEntryFormat) {
      const projectId = this.newEntryProjectId ?? this._selectedProjectId() ?? '';
      const project = this._view().rows.find((row) => row.project.id === projectId);
      return {
        kind: 'newEntry',
        projectId,
        projectTitle: project?.project.title ?? '',
        original: '',
        originalFormat: null,
        recordDay: this.newEntryDay,
      };
    }
    return null;
  });
  private _editingEntryOriginalBody = '';
  private _editingEntryOriginalFormat: PersonalTextFormat | null = null;
  private _editingEntryDay = '';
  private _editStepOriginalFormat: PersonalTextFormat | null = null;

  readonly draftDirty = computed(() => {
    const draft = this.activeDraft();
    if (!draft) return false;
    return (
      this._draftText(draft.kind).trim() !== draft.original.trim() ||
      !formatEquals(this._draftFormat(draft.kind), draft.originalFormat)
    );
  });

  readonly draftPromptMessageKey = computed(() => {
    const mode = this.draftPrompt()?.mode;
    switch (mode) {
      case 'switch':
        return 'PERSONAL_PROGRESS.DRAFT.SWITCH';
      case 'collapse':
        return 'PERSONAL_PROGRESS.DRAFT.COLLAPSE';
      case 'history':
        return 'PERSONAL_PROGRESS.DRAFT.HISTORY';
      case 'edit':
        return 'PERSONAL_PROGRESS.DRAFT.EDIT';
      case 'restore':
        return 'PERSONAL_PROGRESS.DRAFT.RESTORE';
      case 'close':
        return 'PERSONAL_PROGRESS.DRAFT.CLOSE';
      case 'route':
      default:
        return 'PERSONAL_PROGRESS.DRAFT.LEAVE';
    }
  });

  readonly draftPromptProjectTitle = computed(
    () => this.draftPrompt()?.projectTitle ?? '',
  );

  private _clockTimer: ReturnType<typeof setInterval> | null = null;
  private _latestTasks: Task[] = [];
  private _collapsedProjectIds = new Set<string>();

  ngOnInit(): void {
    this._service.setHistoryEditing(true);
    this.creatingProject.set(this._route.snapshot.queryParamMap.get('create') === '1');
    this._route.queryParamMap
      .pipe(takeUntilDestroyed(this._destroyRef))
      .subscribe((params) => {
        this._queryTargetProjectId = params.get('projectId')?.trim() || null;
        this.activeFolderId.set(params.get('folderId')?.trim() || null);
        this._queryVersion++;
        this._queryApplied = false;
        void this._applyQueryTarget();
      });

    combineLatest([
      this._store.select(selectAllProjects),
      this._store.select(selectAllTasks),
      this._archiveTasks$,
      this._dataInitState.isAllDataLoadedInitially$.pipe(filter(Boolean)),
    ])
      .pipe(takeUntilDestroyed(this._destroyRef))
      .subscribe(([projects, tasks, archived]) => {
        this._latestTasks = tasks;
        this._view.set(
          buildPersonalProgressView(
            projects,
            tasks,
            archived,
            this._today(),
            this._collapsedProjectIds,
          ),
        );
        this._hasViewData = true;
        if (
          !this._selectedProjectId() &&
          !this._queryTargetProjectId &&
          this._view().rows.length > 0
        ) {
          this._selectedProjectId.set(this._view().rows[0].project.id);
        }
        void this._applyQueryTarget();
      });

    this.refreshArchive();
    this._setupCloseProtection();

    this._clockTimer = setInterval(() => {
      const today = this._service.todayStr();
      if (today !== this._today()) {
        this._today.set(today);
        this.newEntryDay = today;
        this._view.set(
          buildPersonalProgressView(
            this._view().rows.map((r) => r.project),
            this._latestTasks,
            this._archiveTasks$.value,
            today,
            this._collapsedProjectIds,
          ),
        );
      }
    }, 60_000);
    this._destroyRef.onDestroy(() => {
      if (this._clockTimer) clearInterval(this._clockTimer);
      this._teardownCloseProtection();
      this._service.resetHistoryEditing();
    });
  }

  /** Route guard entry point: a dirty edit must be resolved before leaving. */
  canDeactivate(): Promise<boolean> {
    return this._ensureDraftHandled('route');
  }

  async refreshArchive(): Promise<void> {
    const archived = await this._service.loadArchivedTasks();
    this._archiveTasks$.next(archived);
  }

  async onProjectRowClick(
    event: MouseEvent,
    row: PersonalProgressProjectRow,
  ): Promise<void> {
    const target = event.target as HTMLElement | null;
    if (target?.closest('button, a, input, select, textarea, mat-menu')) return;
    if (!this.isSelected(row)) await this.selectProject(row.project.id);
  }

  async onStepsAreaClick(
    event: MouseEvent,
    row: PersonalProgressProjectRow,
  ): Promise<void> {
    const target = event.target as HTMLElement | null;
    if (
      target?.closest(
        'button, a, input, select, textarea, .pp-step-card, personal-rich-text-editor, .cm-editor',
      )
    )
      return;
    event.stopPropagation();
    if (!this.isSelected(row)) await this.selectProject(row.project.id);
    if (!this.isSelected(row) || this.isSaving()) return;
    if (!row.isExpanded) this.toggleProject(row.project.id);
    await this.beginAppend(row);
  }

  async selectProject(projectId: string): Promise<void> {
    if (projectId === this._selectedProjectId()) return;
    if (!(await this._ensureDraftHandled('switch'))) return;
    this._activateProject(projectId);
    if (this._queryTargetProjectId && this._queryTargetProjectId !== projectId) {
      this._replaceProjectQuery(projectId);
    }
  }

  async beginInlineEntry(
    event: MouseEvent | KeyboardEvent,
    row: PersonalProgressProjectRow,
    fromButton = false,
  ): Promise<void> {
    const target = event.target as HTMLElement | null;
    if (
      !fromButton &&
      target?.closest(
        'button, a, input, select, textarea, .pp-entry, personal-rich-text-editor, .cm-editor',
      )
    )
      return;
    event.stopPropagation();
    if (
      !row.isExpanded ||
      this.isSaving() ||
      this.inlineNewProjectId() === row.project.id
    )
      return;
    if (!this.isSelected(row)) await this.selectProject(row.project.id);
    if (!this.isSelected(row) || !(await this._ensureDraftHandled('edit'))) return;
    this._clearDraft();
    this.newEntryProjectId = row.project.id;
    this.newEntryDay = this.today();
    this.inlineNewProjectId.set(row.project.id);
  }

  async beginEntryEdit(
    event: MouseEvent,
    row: PersonalProgressProjectRow,
    entry: PersonalProgressEntry,
  ): Promise<void> {
    event.stopPropagation();
    if (this.isSaving()) return;
    if (!this.isSelected(row)) await this.selectProject(row.project.id);
    if (this.isSelected(row)) await this.startEdit(entry);
  }

  cancelInlineEntry(): void {
    this._clearDraft();
  }

  private _activateProject(projectId: string): void {
    // An empty focused manual editor can outlive a same-route navigation.
    // Rebind its owner even when focus does not fire again.
    this._clearDraft();
    this._selectedProjectId.set(projectId);
    this.newEntryProjectId = projectId;
    this.targetNotice.set(null);
    this.archivedProjectId.set(null);
  }

  /**
   * Resolve ?projectId= after data is available. A draft is resolved before the
   * selection changes; on continue/failure the URL is returned to the project
   * that is actually selected. Unknown targets are reported, never silently
   * mapped to another project.
   */
  private async _applyQueryTarget(): Promise<void> {
    if (
      this._queryApplied ||
      this._queryApplying ||
      !this._hasViewData ||
      this.isSaving() ||
      this._destroyRef.destroyed
    )
      return;
    const version = this._queryVersion;
    const target = this._queryTargetProjectId;
    if (!target) {
      this._queryApplied = true;
      this.targetNotice.set(null);
      return;
    }
    const row = this._view().rows.find((r) => r.project.id === target);
    if (!row) {
      this._queryApplied = true;
      this.targetNotice.set('PERSONAL_PROGRESS.TARGET.NOT_FOUND');
      return;
    }
    this._queryApplying = true;
    try {
      if (this._selectedProjectId() !== target) {
        const proceed = await this._ensureDraftHandled('switch');
        if (!proceed) {
          this._queryApplied = true;
          this._replaceProjectQuery(this._selectedProjectId());
          return;
        }
        // The draft decision may have waited while a newer URL arrived.
        if (version !== this._queryVersion || this._destroyRef.destroyed) return;
        if (!this._view().rows.some((current) => current.project.id === target)) {
          this._queryApplied = true;
          this.targetNotice.set('PERSONAL_PROGRESS.TARGET.NOT_FOUND');
          return;
        }
        this._activateProject(target);
      }
      this._collapsedProjectIds.delete(target);
      this._renderView();
      this.targetNotice.set(null);
      this._queryApplied = true;
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

  private _replaceProjectQuery(projectId: string | null): void {
    void this._router.navigate([], {
      relativeTo: this._route,
      queryParams: projectId ? { projectId } : {},
      replaceUrl: true,
    });
  }

  private _renderView(): void {
    this._view.set(
      buildPersonalProgressView(
        this._view().rows.map((row) => row.project),
        this._latestTasks,
        this._archiveTasks$.value,
        this._today(),
        this._collapsedProjectIds,
      ),
    );
  }

  async toggleProject(projectId: string): Promise<void> {
    const isCollapsing = !this._collapsedProjectIds.has(projectId);
    const draft = this.activeDraft();
    if (
      isCollapsing &&
      draft?.projectId === projectId &&
      !(await this._ensureDraftHandled('collapse'))
    ) {
      return;
    }
    if (isCollapsing) {
      this._collapsedProjectIds.add(projectId);
    } else {
      this._collapsedProjectIds.delete(projectId);
    }
    this._renderView();
  }

  async collapseAll(): Promise<void> {
    if (!this.view().rows.some((row) => row.isExpanded)) return;
    if (!(await this._ensureDraftHandled('collapse'))) return;
    for (const row of this.view().rows) {
      this._collapsedProjectIds.add(row.project.id);
    }
    this._renderView();
  }

  async focusBackfill(): Promise<void> {
    if (this.manualEditorBlocked() || this.inlineNewProjectId()) {
      if (!(await this._ensureDraftHandled('edit'))) return;
      this.manualEntryOpen.set(false);
      this._clearDraft();
    }
    this.manualEntryOpen.set(true);
    requestAnimationFrame(() => {
      const input = this._entryDayInput()?.nativeElement;
      input?.scrollIntoView({ block: 'nearest' });
      input?.focus();
    });
  }

  async closeManualEntry(): Promise<void> {
    if (!(await this._ensureDraftHandled('edit'))) return;
    this.manualEntryOpen.set(false);
    this.manualEntryOpen.set(false);
  }

  dayLabel(day: string): string {
    return personalProgressDayLabel(day, this.view().today);
  }

  toggleRecordExpanded(event?: Event): void {
    event?.stopPropagation();
    if (!this.canExpandRecords() && !this.recordExpanded()) return;
    this.recordExpanded.update((expanded) => !expanded);
  }

  dayAria(day: string): string {
    return personalProgressDayAria(day);
  }

  isSelected(row: PersonalProgressProjectRow): boolean {
    return row.project.id === this._selectedProjectId();
  }

  async createProject(): Promise<void> {
    if (this.isSaving()) return;
    const title = this.newProjectTitle.trim();
    if (!title) return;
    if (!(await this._ensureDraftHandled('switch'))) return;
    const queryVersion = this._queryVersion;
    const result = await this._run(() =>
      this._service.createProject(nanoid(), title, 'project', this.newProjectDay || null),
    );
    if (result?.status === 'persisted') {
      this.newProjectTitle = '';
      this.newProjectDay = '';
      this.creatingProject.set(false);
      this._activateProject(result.value.projectId);
      if (this.activeFolderId()) {
        this._folders.assign(result.value.projectId, this.activeFolderId());
      }
      if (this._queryTargetProjectId && queryVersion === this._queryVersion) {
        this._replaceProjectQuery(result.value.projectId);
      }
      this.markSaved();
    }
  }

  async finishProjectFor(row: PersonalProgressProjectRow): Promise<void> {
    if (!this.isSelected(row)) {
      await this.selectProject(row.project.id);
    }
    if (this.isSelected(row)) await this.finishProject();
  }

  async finishProject(): Promise<void> {
    if (this.isSaving()) return;
    const targetId = this.selectedRow()?.project.id;
    if (!targetId) return;
    if (!(await this._ensureDraftHandled('switch'))) return;
    // Saving an inserted step rebuilds the row. Confirm the current count,
    // but keep the original target even if a query changed during the prompt.
    const row = this._view().rows.find((candidate) => candidate.project.id === targetId);
    if (!row) return;
    const message = this._translate.instant('PERSONAL_PROGRESS.ARCHIVE_CONFIRM', {
      project: row.project.title,
      count: row.steps.length,
    });
    if (!window.confirm(message)) return;
    const projectId = row.project.id;
    const expectedRevision = personalProjectLifecycle(row.project).revision;
    const result = await this._run(() =>
      this._lifecycle.finishProject({
        operationId: nanoid(),
        projectId,
        expectedRevision,
      }),
    );
    if (result?.status !== 'persisted') return;
    this._service.resetRecentUndoForProject(projectId);
    this._selectedProjectId.set(null);
    this.newEntryProjectId = null;
    this._queryTargetProjectId = null;
    this._queryApplied = true;
    this._replaceProjectQuery(null);
    this.archivedProjectId.set(projectId);
    this.markSaved();
  }

  openArchive(projectId: string): void {
    void this._router.navigate(['/personal-archive'], {
      queryParams: { projectId },
    });
  }

  async manageProject(
    project: Project,
    action: 'schedule' | 'trash',
    day: string | null = null,
  ): Promise<void> {
    if (this.isSaving() || !(await this._ensureDraftHandled('edit'))) return;
    const input = {
      operationId: nanoid(),
      projectId: project.id,
      expectedRevision:
        action === 'schedule'
          ? (project.personalProgress?.planning?.revision ?? 0)
          : (project.personalProgress?.trash?.revision ?? 0),
    };
    const result = await this._run(() =>
      action === 'schedule'
        ? this._management.schedule({ ...input, day })
        : this._management.trash(input),
    );
    if (result?.status === 'persisted') {
      if (action === 'trash' && this.selectedProjectId() === project.id) {
        this._selectedProjectId.set(null);
        this.newEntryProjectId = null;
        this._replaceProjectQuery(null);
      }
      this.markSaved();
    }
  }

  openTrash(): void {
    void this._router.navigate(['/personal-archive'], { queryParams: { trash: '1' } });
  }

  async dropProjectRows(event: CdkDragDrop<PersonalProgressProjectRow[]>): Promise<void> {
    const rows = this.boardRows();
    if (
      event.previousContainer !== event.container ||
      event.previousIndex === event.currentIndex
    )
      return;
    await this._moveProjectRow(
      rows[event.previousIndex],
      rows[event.currentIndex],
      event.currentIndex > event.previousIndex,
    );
  }

  createFolder(): void {
    const folder = this._folders.create();
    this.folderMenuId.set(null);
    this.renamingFolderId.set(folder.id);
    this.folderDraftName = '';
  }

  openFolder(folderId: string): void {
    void this._router.navigate(['/personal-progress'], {
      queryParams: { folderId },
    });
  }

  backToFolders(): void {
    void this._router.navigate(['/personal-progress']);
  }

  toggleFolderMenu(folderId: string, event: Event): void {
    event.stopPropagation();
    this.folderMenuId.update((current) => (current === folderId ? null : folderId));
  }

  startFolderRename(folderId: string, name: string, event?: Event): void {
    event?.stopPropagation();
    this.folderMenuId.set(null);
    this.renamingFolderId.set(folderId);
    this.folderDraftName = name;
  }

  saveFolderRename(): void {
    const folderId = this.renamingFolderId();
    if (!folderId) return;
    this._folders.rename(folderId, this.folderDraftName);
    this.renamingFolderId.set(null);
    this.folderDraftName = '';
  }

  cancelFolderRename(): void {
    this.renamingFolderId.set(null);
    this.folderDraftName = '';
  }

  deleteFolder(folderId: string, event?: Event): void {
    event?.stopPropagation();
    this.folderMenuId.set(null);
    if (!window.confirm('删除文件夹？里面的项目会回到未分组。')) return;
    this._folders.remove(folderId);
    if (this.activeFolderId() === folderId) this.backToFolders();
  }

  focusFolderRenameEnd(event: FocusEvent): void {
    const input = event.target as HTMLInputElement;
    const end = input.value.length;
    input.setSelectionRange(end, end);
  }

  folderProjectCount(folderId: string): number {
    const assignments = this.folderAssignments();
    return this.view().rows.filter((row) => assignments[row.project.id] === folderId)
      .length;
  }

  folderFor(projectId: string): PersonalFolder | null {
    return this._folders.folderFor(projectId);
  }

  removeProjectFromFolder(projectId: string): void {
    this._folders.assign(projectId, null);
  }

  onProjectDragMoved(event: CdkDragMove<PersonalProgressProjectRow>): void {
    const point = event.pointerPosition;
    const target = this.folderCards().find((card) => {
      const rect = card.nativeElement.getBoundingClientRect();
      return (
        point.x >= rect.left &&
        point.x <= rect.right &&
        point.y >= rect.top &&
        point.y <= rect.bottom
      );
    });
    this.folderDropTargetId.set(target?.nativeElement.dataset['folderId'] ?? null);
  }

  onProjectDragEnded(event: CdkDragEnd<PersonalProgressProjectRow>): void {
    const folderId = this.folderDropTargetId();
    this.folderDropTargetId.set(null);
    if (!folderId) return;
    const row = event.source.data;
    if (row) this._folders.assign(row.project.id, folderId);
  }

  startFolderDrag(folderId: string, event: DragEvent): void {
    if (!event.dataTransfer) return;
    this._folderDragActive = true;
    event.dataTransfer.setData('application/x-project1-folder', folderId);
    event.dataTransfer.effectAllowed = 'move';
  }

  allowFolderDrop(event: DragEvent): void {
    if (event.dataTransfer?.types.includes('application/x-project1-folder')) {
      event.preventDefault();
      event.dataTransfer.dropEffect = 'move';
    }
  }

  dropFolderOn(targetId: string, event: DragEvent): void {
    const folderId = event.dataTransfer?.getData('application/x-project1-folder');
    if (!folderId) return;
    event.preventDefault();
    event.stopPropagation();
    this._folders.move(folderId, targetId);
  }

  openFolderFromCard(folderId: string): void {
    if (this._folderDragActive) return;
    this.openFolder(folderId);
  }

  endFolderDrag(): void {
    setTimeout(() => {
      this._folderDragActive = false;
    });
  }

  dropProjectIntoFolder(
    event: CdkDragDrop<PersonalProgressProjectRow[]>,
    folderId: string,
  ): void {
    const row = event.item.data as PersonalProgressProjectRow | undefined;
    if (row) this._folders.assign(row.project.id, folderId);
  }

  async moveProjectRow(
    event: Event,
    row: PersonalProgressProjectRow,
    delta: number,
  ): Promise<void> {
    event.preventDefault();
    event.stopPropagation();
    const rows = this.boardRows(),
      index = rows.findIndex((item) => item.project.id === row.project.id);
    const target = rows[index + delta];
    if (target) await this._moveProjectRow(row, target, delta > 0);
  }
  private async _moveProjectRow(
    row: PersonalProgressProjectRow,
    target: PersonalProgressProjectRow,
    after: boolean,
  ): Promise<void> {
    if (!row || !target || this.isSaving() || this.activeDraft()) return;
    const result = await this._run(() =>
      this._rowOrder.reorder({
        operationId: nanoid(),
        projectId: row.project.id,
        targetId: target.project.id,
        after,
        expectedRevision: row.project.personalProgress?.boardOrder?.revision ?? 0,
        scope: 'board',
        ownerKind: 'project',
      }),
    );
    if (result?.status === 'persisted') this.markSaved();
  }

  async reorderRecords(
    event: CdkDragDrop<PersonalProgressEntry[]>,
    row: PersonalProgressProjectRow,
    day: string,
  ): Promise<void> {
    if (
      this.isSaving() ||
      this.activeDraft() ||
      event.previousContainer !== event.container ||
      event.previousIndex === event.currentIndex
    )
      return;
    const entries = [...(row.entriesByDay.get(day) ?? [])];
    moveItemInArray(entries, event.previousIndex, event.currentIndex);
    await this._persistRecordOrder(row, day, entries);
  }

  async moveRecordByKeyboard(
    event: Event,
    row: PersonalProgressProjectRow,
    entry: PersonalProgressEntry,
    delta: number,
  ): Promise<void> {
    event.preventDefault();
    event.stopPropagation();
    if (this.isSaving() || this.activeDraft()) return;
    const entries = [...(row.entriesByDay.get(entry.recordDay) ?? [])];
    const index = entries.findIndex((item) => item.id === entry.id);
    if (index < 0 || index + delta < 0 || index + delta >= entries.length) return;
    moveItemInArray(entries, index, index + delta);
    await this._persistRecordOrder(row, entry.recordDay, entries);
  }

  private async _persistRecordOrder(
    row: PersonalProgressProjectRow,
    day: string,
    entries: PersonalProgressEntry[],
  ): Promise<void> {
    const result = await this._run(() =>
      this._recordOrder.reorder({
        operationId: nanoid(),
        projectId: row.project.id,
        day,
        expectedRevision: row.project.personalProgress?.entryOrder?.revision ?? 0,
        entryIds: entries.map((entry) => entry.id),
      }),
    );
    if (result?.status === 'persisted') this.markSaved();
  }

  async convertProject(project: Project): Promise<void> {
    if (this.isSaving() || !(await this._ensureDraftHandled('edit'))) return;
    const result = await this._run(() =>
      this._management.convert({
        operationId: nanoid(),
        projectId: project.id,
        ownerKind: 'project',
        expectedRevision: project.personalProgress?.kindEdit?.revision ?? 0,
      }),
    );
    if (result?.status === 'persisted') {
      this._clearDraft();
      this.markSaved();
      void this._router.navigate(['/personal-routine'], {
        queryParams: { itemId: project.id },
      });
    }
  }

  async renameProject(request: Omit<RenameProjectInput, 'operationId'>): Promise<void> {
    if (this.isSaving() || !(await this._ensureDraftHandled('edit'))) return;
    const result = await this._run(() =>
      this._management.rename({ ...request, operationId: nanoid() }),
    );
    if (result?.status === 'persisted') this.markSaved();
  }

  openBackupPage(): void {
    void this._router.navigate(['/personal-backup']);
  }

  async completeStep(step: PersonalProgressStepView): Promise<void> {
    const projectId = this._selectedProjectId();
    if (!projectId || this.isSaving()) return;
    const input: CompleteStepInput = {
      operationId: nanoid(),
      projectId,
      stepId: step.task.id,
      recordDay: this.today(),
      completedAt: Date.now(),
    };
    const result = await this._run(() => this._service.completeStep(input));
    if (result?.status === 'persisted') {
      this.markSaved();
      await this.refreshArchive();
    }
  }

  async undoEntry(
    row: PersonalProgressProjectRow,
    entry: PersonalProgressEntry,
  ): Promise<void> {
    if (!this.isSelected(row) || this.isSaving()) return;
    const target = row.completionByEntryId.get(entry.id);
    if (!target?.isUndoable) return;
    const result = await this._run(() =>
      this._completionUndo.undo({
        operationId: nanoid(),
        projectId: row.project.id,
        completionId: target.completionId,
      }),
    );
    if (result?.status === 'persisted') {
      this.markSaved();
      await this.refreshArchive();
    }
  }

  async undoLatest(): Promise<void> {
    const projectId = this._selectedProjectId();
    if (!projectId || this.isSaving()) return;
    const completionId = this.latestUndoableCompletionId();
    if (!completionId) return;
    const result = await this._run(() =>
      this._completionUndo.undo({
        operationId: nanoid(),
        projectId,
        completionId,
      }),
    );
    if (result?.status === 'persisted') {
      this.markSaved();
      await this.refreshArchive();
    }
  }

  latestUndoableCompletionId(): string | null {
    const row = this.view().rows.find(
      (value) => value.project.id === this._selectedProjectId(),
    );
    if (!row) return null;
    for (const entries of row.entriesByDay.values())
      for (const entry of entries) {
        const completion = row.completionByEntryId.get(entry.id);
        if (completion?.isUndoable && this.canEdit(entry)) return completion.completionId;
      }
    return null;
  }

  async beginInsert(
    row: PersonalProgressProjectRow,
    afterStep: PersonalProgressStepView,
  ): Promise<void> {
    if (!this.isSelected(row) || this.isSaving()) return;
    if (!(await this._ensureDraftHandled('edit'))) return;
    this.manualEntryOpen.set(false);
    this.insertingAfter.set({
      projectId: row.project.id,
      afterStepId: afterStep.task.id,
    });
    this.insertTitle = '';
    this.insertFormat = null;
  }

  async beginAppend(row: PersonalProgressProjectRow): Promise<void> {
    if (!this.isSelected(row) || this.isSaving()) return;
    if (!(await this._ensureDraftHandled('edit'))) return;
    this.manualEntryOpen.set(false);
    const last = row.steps[row.steps.length - 1]?.task.id ?? null;
    this.insertingAfter.set({ projectId: row.project.id, afterStepId: last });
    this.insertTitle = '';
    this.insertFormat = null;
  }

  async saveInsert(): Promise<void> {
    const target = this.insertingAfter();
    const title = this.insertTitle.trim();
    if (!target || !title || this.isSaving()) return;
    const input: InsertStepInput = {
      operationId: nanoid(),
      projectId: target.projectId,
      afterStepId: target.afterStepId,
      title,
      format: this.insertFormat,
    };
    const result = await this._run(() => this._service.insertStepAfter(input));
    if (result?.status === 'persisted') {
      this._clearDraft();
      this.markSaved();
    }
  }

  cancelInsert(): void {
    this._clearDraft();
  }

  beginNewEntryDraft(): void {
    if (!this.newEntryBody.trim() && !this.newEntryFormat) {
      this.newEntryProjectId = this._selectedProjectId();
    }
  }

  async addEntry(): Promise<void> {
    if (this.manualEditorBlocked()) return;
    const projectId = this.newEntryProjectId ?? this._selectedProjectId();
    const body = this.newEntryBody.trim();
    if (!projectId || !body || this.isSaving()) return;
    const result = await this._run(() =>
      this._service.addEntry({
        operationId: nanoid(),
        projectId,
        recordDay: this.newEntryDay,
        body,
        bodyFormat: this.newEntryFormat,
      }),
    );
    if (result?.status === 'persisted') {
      this._clearDraft();
      this.manualEntryOpen.set(false);
      this.markSaved();
    }
  }

  canEdit(_entry: PersonalProgressEntry): boolean {
    return true;
  }

  async deleteEntry(entry: PersonalProgressEntry): Promise<void> {
    if (!this.canEdit(entry) || this.isSaving()) return;
    if (!window.confirm('删除这条记录？删除后无法恢复。')) return;
    const result = await this._run(() =>
      this._entryDelete.delete({
        operationId: nanoid(),
        projectId: entry.projectId,
        entryId: entry.id,
      }),
    );
    if (result?.status === 'persisted') {
      if (this.editingEntryId() === entry.id) this.editingEntryId.set(null);
      this.markSaved();
      await this.refreshArchive();
    }
  }

  async startEdit(entry: PersonalProgressEntry): Promise<void> {
    if (!this.canEdit(entry) || this.isSaving()) return;
    if (!(await this._ensureDraftHandled('edit'))) return;
    this.manualEntryOpen.set(false);
    this.editingStepId.set(null);
    this.editingEntryId.set(entry.id);
    this.editingEntryProjectId = entry.projectId;
    this._editingEntryOriginalBody = entry.body;
    this._editingEntryOriginalFormat = entry.bodyFormat ?? null;
    this._editingEntryDay = entry.recordDay;
    this.editBody = entry.body;
    this.editBodyFormat = entry.bodyFormat ?? null;
    this.editRevision = entry.revision;
  }

  async startStepEdit(step: PersonalProgressStepView): Promise<void> {
    const projectId = this._selectedProjectId();
    if (!projectId || this.isSaving()) return;
    if (!(await this._ensureDraftHandled('edit'))) return;
    this.manualEntryOpen.set(false);
    this.editingEntryId.set(null);
    this.editingStepId.set(step.task.id);
    this.editingStepProjectId = projectId;
    this.editStepTitle = step.task.title;
    this.editStepFormat = step.task.personalProgress?.stepFormat ?? null;
    this._editStepOriginalFormat = this.editStepFormat;
    this.editStepOriginal = step.task.title;
    this.editStepRevision = step.task.personalProgress?.stepEdit?.revision ?? 0;
  }

  async saveStepEdit(): Promise<void> {
    const stepId = this.editingStepId();
    const projectId = this.editingStepProjectId;
    const title = this.editStepTitle.trim();
    if (!stepId || !projectId || !title || this.isSaving()) return;
    const result = await this._run(() =>
      this._service.editStep({
        operationId: nanoid(),
        projectId,
        stepId,
        expectedTitle: this.editStepOriginal,
        expectedRevision: this.editStepRevision,
        title,
        format: this._writeFormat(this.editStepFormat, this._editStepOriginalFormat),
      }),
    );
    if (result?.status === 'persisted') {
      this._clearDraft();
      this.markSaved();
    }
  }

  cancelStepEdit(): void {
    this.editingStepId.set(null);
    this.editStepTitle = '';
    this.editStepFormat = null;
    this.editStepOriginal = '';
    this._editStepOriginalFormat = null;
    this.editingStepProjectId = null;
  }

  cancelEdit(): void {
    this.editingEntryId.set(null);
    this.editBody = '';
    this.editBodyFormat = null;
    this.editingEntryProjectId = null;
    this._editingEntryOriginalBody = '';
    this._editingEntryOriginalFormat = null;
    this._editingEntryDay = '';
  }

  async saveEdit(): Promise<void> {
    const entryId = this.editingEntryId();
    const projectId = this.editingEntryProjectId;
    if (!entryId || !projectId || this.isSaving()) return;
    const wasArchived = this._findEntry(entryId)
      ? this.entryIsArchived(this._findEntry(entryId)!)
      : true;
    const result = await this._run(() =>
      this._service.editEntry({
        operationId: nanoid(),
        projectId,
        entryId,
        expectedRevision: this.editRevision,
        body: this.editBody,
        bodyFormat: this._writeFormat(
          this.editBodyFormat,
          this._editingEntryOriginalFormat,
        ),
      }),
    );
    if (result?.status === 'persisted') {
      this._clearDraft();
      this.markSaved();
      if (wasArchived) await this.refreshArchive();
    }
  }

  private _findEntry(entryId: string): PersonalProgressEntry | undefined {
    for (const row of this._view().rows) {
      for (const entries of row.entriesByDay.values()) {
        const found = entries.find((e) => e.id === entryId);
        if (found) return found;
      }
    }
    return undefined;
  }

  entryIsArchived(entry: PersonalProgressEntry): boolean {
    return !!entry.stepId && !this._latestTasks.some((task) => task.id === entry.stepId);
  }

  entryLabel(entry: PersonalProgressEntry): string {
    if (this.entryIsArchived(entry)) {
      return 'PERSONAL_PROGRESS.SOURCE.ARCHIVED_STEP';
    }
    return entry.source === 'step-completion'
      ? 'PERSONAL_PROGRESS.SOURCE.STEP'
      : 'PERSONAL_PROGRESS.SOURCE.MANUAL';
  }

  async exportData(): Promise<void> {
    if (this._isPreviewMode) {
      this.saveState.set({ kind: 'saving' });
      try {
        const result = await this._backupFacade.exportBackup();
        if (result.status === 'failed') {
          this.saveState.set({ kind: 'failed', message: result.code });
        } else if (result.status === 'cancelled') {
          this.saveState.set({ kind: 'ready' });
        } else {
          this.markSaved();
        }
      } catch (e) {
        this.saveState.set({
          kind: 'failed',
          message: e instanceof Error ? e.message : 'Export failed',
        });
      }
      this._resumeCloseAfterSave();
      return;
    }
    this.saveState.set({ kind: 'saving' });
    try {
      const data = await this._backupService.loadCompleteBackup(true);
      const stamp = new Date().toISOString().replace(/[:.]/g, '-');
      await download(`project1-personal-progress-${stamp}.json`, JSON.stringify(data));
      this.markSaved();
    } catch (e) {
      this.saveState.set({
        kind: 'failed',
        message: e instanceof Error ? e.message : 'Export failed',
      });
      this._resumeCloseAfterSave();
    }
  }

  async onRestoreFile(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    if (this.isSaving()) return;
    if (!(await this._ensureDraftHandled('restore'))) return;
    if (!window.confirm('Restore this backup? It replaces the current local data.')) {
      return;
    }
    this.saveState.set({ kind: 'saving' });
    try {
      const text = await file.text();
      if (this._isPreviewMode) {
        await this._backupFacade.restoreFromText(text);
      } else {
        const data = JSON.parse(text) as AppDataComplete;
        assertSupportedPersonalTextFormats(data);
        await this._backupService.importCompleteBackup(data, false, true);
      }
      this._service.resetRecentUndo();
      this._service.setHistoryEditing(true);
      await this.refreshArchive();
      this.markSaved();
    } catch (e) {
      this.saveState.set({
        kind: 'failed',
        message: e instanceof Error ? e.message : 'Restore failed',
      });
      this._resumeCloseAfterSave();
    }
  }

  // ---- draft coordination -------------------------------------------------------

  chooseDraftSave(): void {
    if (this.isSaving()) return;
    this._resolveDraftPrompt('save');
  }

  chooseDraftDiscard(): void {
    if (this.isSaving()) return;
    this._resolveDraftPrompt('discard');
  }

  chooseDraftContinue(): void {
    this._resolveDraftPrompt('continue');
  }

  @HostListener('document:keydown.escape')
  onDocumentEscape(): void {
    if (this.draftPrompt()) this.chooseDraftContinue();
  }

  @HostListener('document:click')
  onDocumentClick(): void {
    if (this.folderMenuId()) this.folderMenuId.set(null);
  }

  private _resolveDraftPrompt(choice: DraftChoice): void {
    const resolve = this._draftPromptResolver;
    if (!resolve) return;
    this._draftPromptResolver = null;
    this.draftPrompt.set(null);
    if (choice === 'continue') {
      resolve(false);
    } else if (choice === 'discard') {
      this._clearDraft();
      resolve(true);
    } else {
      void this.saveActiveDraft().then((ok) => resolve(ok));
    }
  }

  private async _ensureDraftHandled(mode: DraftPromptMode): Promise<boolean> {
    // Do not turn a pending write into a fake failure or allow navigation just
    // because the current action has no input draft (e.g. completing a step).
    if (this.isSaving() || this._draftPromptResolver) return false;
    const draft = this.activeDraft();
    if (!draft) return true;
    if (!this.draftDirty()) {
      this._clearDraft();
      return true;
    }
    return new Promise<boolean>((resolve) => {
      this._draftPromptResolver = resolve;
      this.draftPrompt.set({
        mode,
        projectTitle: draft.projectTitle,
        kind: draft.kind,
      });
    });
  }

  private _draftText(kind: DraftKind): string {
    switch (kind) {
      case 'step':
        return this.editStepTitle;
      case 'entry':
        return this.editBody;
      case 'insert':
        return this.insertTitle;
      case 'newEntry':
      default:
        return this.newEntryBody;
    }
  }

  private _draftFormat(kind: DraftKind): PersonalTextFormat | null {
    switch (kind) {
      case 'step':
        return this.editStepFormat;
      case 'entry':
        return this.editBodyFormat;
      case 'insert':
        return this.insertFormat;
      case 'newEntry':
      default:
        return this.newEntryFormat;
    }
  }

  private _writeFormat(
    current: PersonalTextFormat | null,
    original: PersonalTextFormat | null,
  ): PersonalTextFormat | null | undefined {
    return current === null && original === null ? undefined : current;
  }

  onNewEntryChange(draft: PersonalTextDraft): void {
    this.newEntryBody = draft.text;
    this.newEntryFormat = draft.format;
  }

  onInsertChange(draft: PersonalTextDraft): void {
    this.insertTitle = draft.text;
    this.insertFormat = draft.format;
  }

  onEditEntryChange(draft: PersonalTextDraft): void {
    this.editBody = draft.text;
    this.editBodyFormat = draft.format;
  }

  onEditStepChange(draft: PersonalTextDraft): void {
    this.editStepTitle = draft.text;
    this.editStepFormat = draft.format;
  }

  private _clearDraft(): void {
    this.manualEntryOpen.set(false);
    this.inlineNewProjectId.set(null);
    this.editingStepId.set(null);
    this.editingStepProjectId = null;
    this.editStepTitle = '';
    this.editStepFormat = null;
    this.editStepOriginal = '';
    this._editStepOriginalFormat = null;
    this.editingEntryId.set(null);
    this.editingEntryProjectId = null;
    this.editBody = '';
    this.editBodyFormat = null;
    this.editRevision = 0;
    this._editingEntryOriginalBody = '';
    this._editingEntryOriginalFormat = null;
    this._editingEntryDay = '';
    this.insertingAfter.set(null);
    this.insertTitle = '';
    this.insertFormat = null;
    this.newEntryBody = '';
    this.newEntryFormat = null;
    this.newEntryProjectId = null;
  }

  private async saveActiveDraft(): Promise<boolean> {
    const draft = this.activeDraft();
    if (!draft) return true;
    if (this.isSaving()) return false;
    switch (draft.kind) {
      case 'step':
        await this.saveStepEdit();
        return !this.editingStepId();
      case 'entry':
        await this.saveEdit();
        return !this.editingEntryId();
      case 'insert':
        await this.saveInsert();
        return !this.insertingAfter();
      case 'newEntry':
      default:
        await this.addEntry();
        return !this.newEntryBody.trim() && !this.newEntryFormat;
    }
  }

  // ---- Electron/browser close protection ---------------------------------------

  private _setupCloseProtection(): void {
    if (IS_ELECTRON) {
      this._execBeforeClose.schedule(this._closeId);
      this._closeSub = this._execBeforeClose.onBeforeClose$
        .pipe(filter((ids) => ids.includes(this._closeId)))
        .subscribe(() => {
          void this._handleCloseRequested();
        });
    } else {
      window.addEventListener('beforeunload', this._onBeforeUnload);
    }
  }

  private _teardownCloseProtection(): void {
    if (IS_ELECTRON) {
      this._execBeforeClose.unschedule(this._closeId);
      this._closeSub?.unsubscribe();
      this._closeSub = null;
    } else {
      window.removeEventListener('beforeunload', this._onBeforeUnload);
    }
  }

  private _onBeforeUnload = (event: BeforeUnloadEvent): void => {
    if (!this.draftDirty() && !this.isSaving()) return;
    event.preventDefault();
    event.returnValue = '';
  };

  private async _handleCloseRequested(): Promise<void> {
    if (this._closePromptOpen) return;
    if (this.isSaving()) {
      // Never call setDone while a real write is in flight: the close must
      // wait for the receipt. Re-evaluate after _run() finishes.
      this._closeRequestedWhileSaving = true;
      return;
    }
    if (
      this._closeRequestedWhileSaving &&
      (this.saveState().kind === 'failed' || this.saveState().kind === 'rejected')
    ) {
      this._closeRequestedWhileSaving = false;
      this._execBeforeClose.cancelClose();
      return;
    }
    this._closePromptOpen = true;
    try {
      if (!(await this._execBeforeClose.waitForOtherHandlers(this._closeId))) return;
      const proceed = await this._ensureDraftHandled('close');
      if (proceed) {
        this._closeRequestedWhileSaving = false;
        this._execBeforeClose.setDone(this._closeId);
      } else this._execBeforeClose.cancelClose();
    } finally {
      this._closePromptOpen = false;
    }
  }

  saveStateText(): string {
    const state = this.saveState();
    switch (state.kind) {
      case 'ready':
        return 'PERSONAL_PROGRESS.STATUS.READY';
      case 'saving':
        return this._service.isPersistenceSlow()
          ? 'PERSONAL_PROGRESS.STATUS.SAVING_SLOW'
          : 'PERSONAL_PROGRESS.STATUS.SAVING';
      case 'saved':
        return 'PERSONAL_PROGRESS.STATUS.SAVED';
      case 'rejected':
        return `PERSONAL_PROGRESS.REJECTED.${state.code}`;
      case 'failed':
        return 'PERSONAL_PROGRESS.STATUS.FAILED';
      default:
        return 'PERSONAL_PROGRESS.STATUS.IDLE';
    }
  }

  saveStateError(): string | null {
    const state = this.saveState();
    return state.kind === 'failed' ? state.message : null;
  }

  private async _run<T>(
    fn: () => Promise<PersonalCommandResult<T>>,
  ): Promise<PersonalCommandResult<T> | null> {
    this.saveState.set({ kind: 'saving' });
    try {
      const result = await fn();
      if (result.status === 'rejected') {
        this.saveState.set({ kind: 'rejected', code: result.code });
      } else if (result.status === 'failed') {
        this.saveState.set({ kind: 'failed', message: result.message });
      }
      return result;
    } catch (e) {
      this.saveState.set({
        kind: 'failed',
        message: e instanceof Error ? e.message : 'Operation failed',
      });
      return null;
    } finally {
      this._resumeCloseAfterSave();
      if (!this.isSaving() && !this._queryApplied && !this._queryApplying) {
        // A failed write must retain the original project and input, rather
        // than silently carrying out a navigation requested during that write.
        this._queryApplied = true;
        this._replaceProjectQuery(this._selectedProjectId());
      }
    }
  }

  private markSaved(): void {
    this.saveState.set({ kind: 'saved' });
    this._resumeCloseAfterSave();
    void this._applyQueryTarget();
  }

  private _resumeCloseAfterSave(): void {
    if (!this._closeRequestedWhileSaving || this.isSaving()) return;
    // Let the command caller clear its successfully saved draft first. Do not
    // clear the flag here: _handleCloseRequested must still see a failed write
    // and cancel the pending close.
    setTimeout(() => {
      void this._handleCloseRequested();
    }, 0);
  }
}
