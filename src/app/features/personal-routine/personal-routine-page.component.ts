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
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import {
  CdkDrag,
  CdkDragHandle,
  CdkDragPreview,
  CdkDropList,
  CdkDragDrop,
  moveItemInArray,
} from '@angular/cdk/drag-drop';
import {
  CdkConnectedOverlay,
  CdkOverlayOrigin,
  ConnectedPosition,
} from '@angular/cdk/overlay';
import { CdkScrollable } from '@angular/cdk/scrolling';
import { PersonalRecordOrderService } from '../personal-progress/personal-record-order.service';
import { PersonalOverviewOrderService } from '../personal-overview/personal-overview-order.service';
import { CdkTrapFocus } from '@angular/cdk/a11y';
import { ActivatedRoute, Router } from '@angular/router';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { Store } from '@ngrx/store';
import { combineLatest } from 'rxjs';
import { filter } from 'rxjs/operators';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { nanoid } from 'nanoid';
import { BackupService } from '../../op-log/backup/backup.service';
import { AppDataComplete } from '../../op-log/model/model-config';
import { download } from '../../util/download';
import { ExecBeforeCloseService } from '../../core/electron/exec-before-close.service';
import { DataInitStateService } from '../../core/data-init/data-init-state.service';
import { IS_ELECTRON } from '../../app.constants';
import { Project } from '../project/project.model';
import { Task } from '../tasks/task.model';
import { selectAllTasks } from '../tasks/store/task.selectors';
import { selectAllProjects } from '../project/store/project.selectors';
import {
  PersonalProgressService,
  AddEntryInput,
  EditEntryInput,
} from '../personal-progress/personal-progress.service';
import {
  PersonalCommandResult,
  PersonalProgressEntry,
  PersonalRecordDay,
  isPersonalRecordDay,
} from '../personal-progress/personal-progress.model';
import {
  PersonalTextDraft,
  PersonalTextFormat,
  assertSupportedPersonalTextFormats,
  formatEquals,
} from '../personal-text/personal-text.model';
import { PersonalRichTextEditorComponent } from '../personal-text/personal-rich-text-editor.component';
import { PersonalProjectToolsComponent } from '../personal-progress/personal-project-tools.component';
import {
  PersonalProjectManagementService,
  RenameProjectInput,
} from '../personal-progress/personal-project-management.service';
import { PersonalTextViewComponent } from '../personal-text/personal-text-view.component';
import {
  PersonalRoutineRange,
  addCalendarDays,
  buildRoutineRange,
  formatRoutineDay,
  isFutureRecordDay,
  isRecordDayInRange,
} from './personal-routine.date';
import {
  PersonalRoutineItemRow,
  buildPersonalRoutineView,
} from './personal-routine.view';

type SaveState =
  | { kind: 'ready' }
  | { kind: 'idle' }
  | { kind: 'saving' }
  | { kind: 'saved' }
  | { kind: 'rejected'; code: string }
  | { kind: 'failed'; message: string };
type DraftKind = 'entry' | 'newItem';
type DraftPromptMode = 'switch' | 'day' | 'range' | 'route' | 'restore' | 'close';
type DraftChoice = 'save' | 'discard' | 'continue';

interface DraftPrompt {
  mode: DraftPromptMode;
  kind: DraftKind;
  itemTitle: string;
}

@Component({
  selector: 'personal-routine-page',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    TranslatePipe,
    CdkTrapFocus,
    CdkDrag,
    CdkDragHandle,
    CdkDragPreview,
    CdkDropList,
    CdkConnectedOverlay,
    CdkOverlayOrigin,
    CdkScrollable,
    PersonalRichTextEditorComponent,
    PersonalTextViewComponent,
    PersonalProjectToolsComponent,
  ],
  templateUrl: './personal-routine-page.component.html',
  styleUrls: ['./personal-routine-page.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PersonalRoutinePageComponent implements OnInit {
  private _rowOrder = inject(PersonalOverviewOrderService);
  private _recordOrder = inject(PersonalRecordOrderService);
  readonly editorOrigin = signal<CdkOverlayOrigin | null>(null);
  readonly editorPositions: ConnectedPosition[] = [
    {
      originX: 'start',
      originY: 'bottom',
      overlayX: 'start',
      overlayY: 'top',
      offsetY: 8,
    },
    { originX: 'end', originY: 'bottom', overlayX: 'end', overlayY: 'top', offsetY: 8 },
    {
      originX: 'start',
      originY: 'top',
      overlayX: 'start',
      overlayY: 'bottom',
      offsetY: -8,
    },
  ];
  private _store = inject(Store);
  private _service = inject(PersonalProgressService);
  private _management = inject(PersonalProjectManagementService);
  private _backupService = inject(BackupService);
  private _destroyRef = inject(DestroyRef);
  private _execBeforeClose = inject(ExecBeforeCloseService);
  private _dataInitState = inject(DataInitStateService);
  private _route = inject(ActivatedRoute);
  private _router = inject(Router);
  private _translate = inject(TranslateService);

  private _projects = signal<Project[]>([]);
  private _tasks = signal<Task[]>([]);
  private _archivedTasks = signal<Task[]>([]);
  readonly archiveReadError = signal(false);
  private _archiveReadGeneration = 0;
  private _today = signal(this._service.todayStr());
  private _selectedItemId = signal<string | null>(null);
  private _selectedDay = signal<PersonalRecordDay>(this._service.todayStr());
  private _entryDayFollowsToday = true;
  private _hasData = false;
  private _queryTargetItemId: string | null = null;
  private _queryApplied = false;
  private _queryApplying = false;
  private _queryVersion = 0;
  private _targetCancelPending = false;
  private _clockTimer: ReturnType<typeof setInterval> | null = null;
  private _closeSub = { unsubscribe: () => undefined } as { unsubscribe: () => void };
  private _closePromptOpen = false;
  private _closeRequestedWhileSaving = false;
  private readonly _closeId = 'personal-routine-close';
  private _draftPromptResolver: ((proceed: boolean) => void) | null = null;
  private _editingEntryOriginal = '';
  private _editingEntryRevision = 0;
  private readonly _restoreInput =
    viewChild<ElementRef<HTMLInputElement>>('restoreInput');

  readonly range = signal<PersonalRoutineRange>('month');
  readonly view = computed(() =>
    buildPersonalRoutineView(
      this._projects(),
      this._today(),
      this.range(),
      this._tasks(),
      this._archivedTasks(),
    ),
  );
  readonly historyDates = computed(() =>
    this.view().dates.filter((day) => day !== this.today()),
  );
  readonly today = this._today.asReadonly();
  readonly selectedItemId = this._selectedItemId.asReadonly();
  readonly selectedDay = this._selectedDay.asReadonly();
  readonly historyEditing = signal(false);
  readonly saveState = signal<SaveState>({ kind: 'ready' });
  readonly isSaving = computed(() => this.saveState().kind === 'saving');
  readonly draftPrompt = signal<DraftPrompt | null>(null);
  readonly targetNotice = signal<string | null>(null);
  readonly rangeNotice = signal<string | null>(null);
  readonly editingEntryId = signal<string | null>(null);
  readonly entryBody = signal('');
  readonly entryFormat = signal<PersonalTextFormat | null>(null);
  private _editingEntryOriginalFormat: PersonalTextFormat | null = null;
  readonly newItemTitle = signal('');

  readonly selectedRow = computed<PersonalRoutineItemRow | undefined>(() =>
    this.view().rows.find((row) => row.project.id === this._selectedItemId()),
  );

  readonly selectedDayEntries = computed<PersonalProgressEntry[]>(() => {
    const row = this.selectedRow();
    return row?.entriesByDay.get(this._selectedDay()) ?? [];
  });

  readonly rangeStart = computed(() => this.view().bounds.start);
  readonly rangeEnd = computed(() => this.view().bounds.end);

  readonly rangeLabel = computed(() => {
    const language = this._translate.currentLang || 'zh';
    return `${formatRoutineDay(this.rangeStart(), this.today(), language)} — ${formatRoutineDay(
      this.rangeEnd(),
      this.today(),
      language,
    )}`;
  });

  readonly draftDirty = computed(() => this._entryDraftDirty() || this._newItemDirty());
  readonly newItemDraft = computed(() => this._newItemDirty());

  readonly draftPromptItemTitle = computed(() => this.draftPrompt()?.itemTitle ?? '');

  get entryDay(): PersonalRecordDay {
    return this._selectedDay();
  }

  set entryDay(day: PersonalRecordDay) {
    this._selectedDay.set(day);
    this._entryDayFollowsToday = false;
    this.rangeNotice.set(null);
  }

  get selectedItem(): string | null {
    return this._selectedItemId();
  }

  get draftItemTitle(): string {
    return this.selectedRow()?.project.title ?? '';
  }

  ngOnInit(): void {
    this.historyEditing.set(true);
    this._service.setHistoryEditing(true);
    this._route.queryParamMap
      .pipe(takeUntilDestroyed(this._destroyRef))
      .subscribe((params) => {
        const requested = params.get('itemId')?.trim() || null;
        if (this._targetCancelPending) {
          this._queryTargetItemId = this._selectedItemId();
          this._queryApplied = true;
          return;
        }
        this._queryTargetItemId = requested;
        this._queryVersion++;
        this._queryApplied = false;
        void this._applyQueryTarget();
      });

    combineLatest([
      this._store.select(selectAllProjects),
      this._store.select(selectAllTasks),
      this._dataInitState.isAllDataLoadedInitially$.pipe(filter(Boolean)),
    ])
      .pipe(takeUntilDestroyed(this._destroyRef))
      .subscribe(([projects, tasks]) => {
        this._tasks.set(tasks);
        this._projects.set(projects);
        this._hasData = true;
        const rows = this.view().rows;
        if (
          this._selectedItemId() &&
          !rows.some((r) => r.project.id === this._selectedItemId())
        ) {
          this._selectedItemId.set(null);
        }
        if (!this._selectedItemId() && !this._queryTargetItemId && rows.length > 0) {
          this._selectedItemId.set(rows[0].project.id);
        }
        void this._applyQueryTarget();
      });

    void this.refreshArchivedRecords();
    this._setupCloseProtection();
    this._clockTimer = setInterval(() => {
      const today = this._service.todayStr();
      if (today !== this._today()) {
        this._today.set(today);
        if (this._entryDayFollowsToday && !this._entryDraftDirty()) {
          this._selectedDay.set(today);
        }
      }
    }, 60_000);
    this._destroyRef.onDestroy(() => {
      if (this._clockTimer) clearInterval(this._clockTimer);
      this._teardownCloseProtection();
      this._service.resetHistoryEditing();
    });
  }

  canDeactivate(): Promise<boolean> {
    return this._ensureDraftHandled('route');
  }

  displayDay(day: PersonalRecordDay): string {
    return formatRoutineDay(day, this.today(), this._translate.currentLang || 'zh');
  }

  isToday(day: PersonalRecordDay): boolean {
    return day === this.today();
  }

  isPast(day: PersonalRecordDay): boolean {
    return day < this.today();
  }

  canEditEntry(entry: PersonalProgressEntry): boolean {
    return entry.recordDay <= this.today();
  }

  isSelected(row: PersonalRoutineItemRow): boolean {
    return row.project.id === this._selectedItemId();
  }

  entryText(entry: PersonalProgressEntry): string {
    return entry.body;
  }

  entriesFor(
    row: PersonalRoutineItemRow,
    day: PersonalRecordDay,
  ): PersonalProgressEntry[] {
    return row.entriesByDay.get(day) ?? [];
  }

  isEditingEntry(entry: PersonalProgressEntry): boolean {
    return this.editingEntryId() === entry.id;
  }

  draftPromptMessage(mode: DraftPromptMode): string {
    switch (mode) {
      case 'day':
        return 'PERSONAL_ROUTINE.DRAFT.DAY';
      case 'range':
        return 'PERSONAL_ROUTINE.DRAFT.RANGE';
      case 'switch':
        return 'PERSONAL_ROUTINE.DRAFT.SWITCH';
      case 'restore':
        return 'PERSONAL_ROUTINE.DRAFT.RESTORE';
      case 'close':
        return 'PERSONAL_ROUTINE.DRAFT.CLOSE';
      case 'route':
      default:
        return 'PERSONAL_ROUTINE.DRAFT.LEAVE';
    }
  }

  async selectItem(itemId: string): Promise<void> {
    if (itemId === this._selectedItemId()) return;
    if (!(await this._ensureDraftHandled('switch'))) return;
    this._activateItem(itemId);
    if (this._queryTargetItemId && this._queryTargetItemId !== itemId) {
      this._replaceItemQuery(itemId);
    }
  }

  async selectDay(itemId: string, day: PersonalRecordDay): Promise<void> {
    if (day === this._selectedDay() && itemId === this._selectedItemId()) return;
    if (!(await this._ensureDraftHandled('day'))) return;
    this._activateItem(itemId);
    this._selectedDay.set(day);
    this._entryDayFollowsToday = day === this.today();
    if (this._queryTargetItemId && this._queryTargetItemId !== itemId) {
      void this._replaceItemQuery(itemId);
    }
  }

  async changeRange(range: PersonalRoutineRange): Promise<void> {
    if (range === this.range()) return;
    if (!(await this._ensureDraftHandled('range'))) return;
    this.range.set(range);
    if (
      !isRecordDayInRange(this._selectedDay(), buildRoutineRange(this.today(), range))
    ) {
      this._selectedDay.set(this.today());
      this._entryDayFollowsToday = true;
    }
    this.rangeNotice.set(null);
  }

  async backfill(origin?: CdkOverlayOrigin): Promise<void> {
    if (this.isSaving()) return;
    if (!(await this._ensureDraftHandled('day'))) return;
    this._selectedDay.set(addCalendarDays(this.today(), -1));
    this._entryDayFollowsToday = false;
    this.rangeNotice.set(null);
    if (origin) this.editorOrigin.set(origin);
  }

  async onDayInput(event: Event): Promise<void> {
    const origin = this.editorOrigin();
    const input = event.target as HTMLInputElement;
    const day = input.value;
    if (!isPersonalRecordDay(day) || isFutureRecordDay(day, this.today())) {
      this.saveState.set({ kind: 'rejected', code: 'INVALID_INPUT' });
      input.value = this._selectedDay();
      return;
    }
    if (day === this._selectedDay()) return;
    if (!(await this._ensureDraftHandled('day'))) {
      input.value = this._selectedDay();
      return;
    }
    this._selectedDay.set(day);
    this._entryDayFollowsToday = false;
    this.rangeNotice.set(null);
    if (origin) this.editorOrigin.set(origin);
  }

  async createItem(): Promise<boolean> {
    if (this.isSaving()) return false;
    const title = this.newItemTitle().trim();
    if (!title) return false;
    if (this._entryDraftDirty()) return false;
    const result = await this._run(() =>
      this._service.createProject(nanoid(), title, 'routine'),
    );
    if (result?.status !== 'persisted') return false;
    this.newItemTitle.set('');
    this._activateItem(result.value.projectId);
    this._selectedDay.set(this.today());
    this._entryDayFollowsToday = true;
    if (this._queryTargetItemId) {
      this._replaceItemQuery(result.value.projectId);
    }
    this.markSaved();
    return true;
  }

  async toggleHistoryEditing(): Promise<void> {
    if (this.isSaving()) return;
    if (this.historyEditing()) {
      if (!(await this._ensureDraftHandled('switch'))) return;
      this.historyEditing.set(false);
      this._service.setHistoryEditing(false);
      this._clearEntryDraft();
    } else {
      this.historyEditing.set(true);
      this._service.setHistoryEditing(true);
    }
  }

  async refreshArchivedRecords(): Promise<void> {
    const generation = ++this._archiveReadGeneration;
    try {
      const tasks = await this._service.loadArchivedTasks(true);
      if (generation !== this._archiveReadGeneration) return;
      this._archivedTasks.set(tasks);
      this.archiveReadError.set(false);
    } catch {
      if (generation === this._archiveReadGeneration) this.archiveReadError.set(true);
    }
  }

  async convertItem(project: Project): Promise<void> {
    if (this.isSaving() || !(await this._ensureDraftHandled('switch'))) return;
    const result = await this._run(() =>
      this._management.convert({
        operationId: nanoid(),
        projectId: project.id,
        ownerKind: 'routine',
        expectedRevision: project.personalProgress?.kindEdit?.revision ?? 0,
      }),
    );
    if (result?.status === 'persisted') {
      this._clearEntryDraft();
      this.markSaved();
      void this._router.navigate(['/personal-progress'], {
        queryParams: { projectId: project.id },
      });
    }
  }

  async renameItem(request: Omit<RenameProjectInput, 'operationId'>): Promise<void> {
    if (this.isSaving() || !(await this._ensureDraftHandled('switch'))) return;
    const result = await this._run(() =>
      this._management.rename({
        ...request,
        ownerKind: 'routine',
        operationId: nanoid(),
      }),
    );
    if (result?.status === 'persisted') this.markSaved();
  }

  async trashItem(project: Project): Promise<void> {
    if (this.isSaving() || !(await this._ensureDraftHandled('switch'))) return;
    const result = await this._run(() =>
      this._management.trash({
        operationId: nanoid(),
        projectId: project.id,
        ownerKind: 'routine',
        expectedRevision: project.personalProgress?.trash?.revision ?? 0,
      }),
    );
    if (result?.status === 'persisted') {
      if (this._selectedItemId() === project.id) {
        this._selectedItemId.set(null);
        this._clearEntryDraft();
        this._replaceItemQuery(null);
      }
      this.markSaved();
    }
  }

  async openCell(
    row: PersonalRoutineItemRow,
    day: string,
    origin: CdkOverlayOrigin,
    event?: Event,
  ): Promise<void> {
    event?.stopPropagation();
    if (this.isSaving() || !(await this._ensureDraftHandled('switch'))) return;
    this._clearEntryDraft();
    this._selectedItemId.set(row.project.id);
    this._selectedDay.set(day);
    this._entryDayFollowsToday = day === this.today();
    this.editorOrigin.set(origin);
    if (this._queryTargetItemId && this._queryTargetItemId !== row.project.id) {
      void this._replaceItemQuery(row.project.id);
    }
  }
  async editAt(
    entry: PersonalProgressEntry,
    origin: CdkOverlayOrigin,
    event?: Event,
  ): Promise<void> {
    event?.stopPropagation();
    await this.editEntry(entry);
    if (this.editingEntryId() === entry.id) this.editorOrigin.set(origin);
  }
  async dropRows(event: CdkDragDrop<PersonalRoutineItemRow[]>): Promise<void> {
    const rows = this.view().rows;
    if (
      event.previousContainer !== event.container ||
      event.previousIndex === event.currentIndex
    )
      return;
    await this._moveRow(
      rows[event.previousIndex],
      rows[event.currentIndex],
      event.currentIndex > event.previousIndex,
    );
  }
  async moveRow(event: Event, row: PersonalRoutineItemRow, delta: number): Promise<void> {
    event.preventDefault();
    event.stopPropagation();
    const rows = this.view().rows,
      index = rows.findIndex((item) => item.project.id === row.project.id),
      target = rows[index + delta];
    if (target) await this._moveRow(row, target, delta > 0);
  }
  private async _moveRow(
    row: PersonalRoutineItemRow,
    target: PersonalRoutineItemRow,
    after: boolean,
  ): Promise<void> {
    if (!row || !target || this.isSaving() || this.editorOrigin() || this.draftDirty())
      return;
    const result = await this._run(() =>
      this._rowOrder.reorder({
        operationId: nanoid(),
        projectId: row.project.id,
        targetId: target.project.id,
        after,
        expectedRevision: row.project.personalProgress?.boardOrder?.revision ?? 0,
        scope: 'board',
        ownerKind: 'routine',
      }),
    );
    if (result?.status === 'persisted') this.markSaved();
  }
  async dropRecords(
    event: CdkDragDrop<PersonalProgressEntry[]>,
    row: PersonalRoutineItemRow,
    day: string,
  ): Promise<void> {
    if (
      event.previousContainer !== event.container ||
      event.previousIndex === event.currentIndex
    )
      return;
    const entries = [...this.entriesFor(row, day)];
    moveItemInArray(entries, event.previousIndex, event.currentIndex);
    await this._saveRecordOrder(row, day, entries);
  }
  async moveRecord(
    event: Event,
    row: PersonalRoutineItemRow,
    entry: PersonalProgressEntry,
    delta: number,
  ): Promise<void> {
    event.preventDefault();
    event.stopPropagation();
    const entries = [...this.entriesFor(row, entry.recordDay)],
      index = entries.findIndex((item) => item.id === entry.id);
    if (index < 0 || index + delta < 0 || index + delta >= entries.length) return;
    moveItemInArray(entries, index, index + delta);
    await this._saveRecordOrder(row, entry.recordDay, entries);
  }
  private async _saveRecordOrder(
    row: PersonalRoutineItemRow,
    day: string,
    entries: PersonalProgressEntry[],
  ): Promise<void> {
    if (this.isSaving() || this.editorOrigin() || this.draftDirty()) return;
    const result = await this._run(() =>
      this._recordOrder.reorder({
        operationId: nanoid(),
        projectId: row.project.id,
        day,
        ownerKind: 'routine',
        expectedRevision: row.project.personalProgress?.entryOrder?.revision ?? 0,
        entryIds: entries.map((e) => e.id),
      }),
    );
    if (result?.status === 'persisted') this.markSaved();
  }

  async editEntry(entry: PersonalProgressEntry): Promise<void> {
    if (!this.canEditEntry(entry) || this.isSaving()) return;
    const origin = this.editorOrigin();
    if (!(await this._ensureDraftHandled('switch'))) return;
    this._selectedItemId.set(entry.projectId);
    this._selectedDay.set(entry.recordDay);
    this._entryDayFollowsToday = entry.recordDay === this.today();
    this.editingEntryId.set(entry.id);
    this._editingEntryOriginal = entry.body;
    this._editingEntryOriginalFormat = entry.bodyFormat ?? null;
    this._editingEntryRevision = entry.revision;
    this.entryBody.set(entry.body);
    this.entryFormat.set(entry.bodyFormat ?? null);
    this.rangeNotice.set(null);
    if (origin) this.editorOrigin.set(origin);
  }

  async saveEntry(): Promise<boolean> {
    if (this.isSaving()) return false;
    const entryId = this.editingEntryId();
    const body = this.entryBody().trim();
    const itemId = this._selectedItemId();
    const day = this._selectedDay();
    if (!itemId || !body) {
      this.saveState.set({ kind: 'rejected', code: 'INVALID_INPUT' });
      return false;
    }
    if (!isPersonalRecordDay(day) || isFutureRecordDay(day, this.today())) {
      this.saveState.set({ kind: 'rejected', code: 'INVALID_INPUT' });
      return false;
    }
    const operationId = nanoid();
    let result;
    if (entryId) {
      const current = this.selectedDayEntries().find((e) => e.id === entryId);
      if (!current) {
        this.saveState.set({ kind: 'rejected', code: 'NOT_FOUND' });
        return false;
      }
      const input: EditEntryInput = {
        operationId,
        projectId: itemId,
        entryId,
        expectedRevision: this._editingEntryRevision,
        body,
        bodyFormat: this.entryFormat(),
        ownerKind: 'routine',
      };
      result = await this._run(() => this._service.editEntry(input));
    } else {
      const input: AddEntryInput = {
        operationId,
        projectId: itemId,
        recordDay: day,
        body,
        bodyFormat: this.entryFormat(),
        ownerKind: 'routine',
      };
      result = await this._run(() => this._service.addEntry(input));
    }
    if (result?.status !== 'persisted') return false;
    await this.refreshArchivedRecords();
    this._clearEntryDraft();
    this.editorOrigin.set(null);
    if (!isRecordDayInRange(day, this.view().bounds)) {
      this.rangeNotice.set('PERSONAL_ROUTINE.RANGE.OUTSIDE');
    }
    this.markSaved();
    return true;
  }

  cancelEntry(): void {
    this.editorOrigin.set(null);
    if (this.isSaving()) return;
    this._clearEntryDraft();
    this.rangeNotice.set(null);
  }

  async exportData(): Promise<void> {
    this.saveState.set({ kind: 'saving' });
    try {
      const data = await this._backupService.loadCompleteBackup(true);
      const stamp = new Date().toISOString().replace(/[:.]/g, '-');
      await download(`project1-personal-routine-${stamp}.json`, JSON.stringify(data));
      this.markSaved();
    } catch (e) {
      this.saveState.set({
        kind: 'failed',
        message: e instanceof Error ? e.message : 'Export failed',
      });
      this._resumeCloseAfterSave();
    }
  }

  openRestorePicker(): void {
    if (this.isSaving()) return;
    this._restoreInput()?.nativeElement.click();
  }

  async onRestoreFile(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file || this.isSaving()) return;
    if (!(await this._ensureDraftHandled('restore'))) return;
    if (!window.confirm(this._translate.instant('PERSONAL_ROUTINE.RESTORE_CONFIRM'))) {
      return;
    }
    this.saveState.set({ kind: 'saving' });
    try {
      const text = await file.text();
      const data = JSON.parse(text) as AppDataComplete;
      assertSupportedPersonalTextFormats(data);
      await this._backupService.importCompleteBackup(data, false, true);
      this._archivedTasks.set([]);
      await this.refreshArchivedRecords();
      this._service.resetRecentUndo();
      this._clearEntryDraft();
      this._selectedItemId.set(null);
      this.markSaved();
    } catch (e) {
      this.saveState.set({
        kind: 'failed',
        message: e instanceof Error ? e.message : 'Restore failed',
      });
      this._resumeCloseAfterSave();
    }
  }

  saveStateText(): string {
    const state = this.saveState();
    switch (state.kind) {
      case 'ready':
        return 'PERSONAL_ROUTINE.STATUS.READY';
      case 'saving':
        return this._service.isPersistenceSlow()
          ? 'PERSONAL_ROUTINE.STATUS.SAVING_SLOW'
          : 'PERSONAL_ROUTINE.STATUS.SAVING';
      case 'saved':
        return 'PERSONAL_ROUTINE.STATUS.SAVED';
      case 'rejected':
        return `PERSONAL_ROUTINE.REJECTED.${state.code}`;
      case 'failed':
        return 'PERSONAL_ROUTINE.STATUS.FAILED';
      default:
        return 'PERSONAL_ROUTINE.STATUS.IDLE';
    }
  }

  saveStateError(): string | null {
    const state = this.saveState();
    return state.kind === 'failed' ? state.message : null;
  }

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

  entryDraftDirty(): boolean {
    return this._entryDraftDirty();
  }

  private _entryDraftDirty(): boolean {
    const body = this.entryBody().trim();
    if (this.editingEntryId()) {
      return (
        body !== this._editingEntryOriginal.trim() ||
        !formatEquals(this.entryFormat(), this._editingEntryOriginalFormat)
      );
    }
    return body.length > 0 || !!this.entryFormat();
  }

  private _newItemDirty(): boolean {
    return this.newItemTitle().trim().length > 0;
  }

  private _activateItem(itemId: string): void {
    this.editorOrigin.set(null);
    this._clearEntryDraft();
    this._selectedItemId.set(itemId);
    this._selectedDay.set(this.today());
    this._entryDayFollowsToday = true;
    this.rangeNotice.set(null);
    this.targetNotice.set(null);
  }

  private _clearEntryDraft(): void {
    this.editorOrigin.set(null);
    this.editingEntryId.set(null);
    this.entryBody.set('');
    this.entryFormat.set(null);
    this._editingEntryOriginal = '';
    this._editingEntryOriginalFormat = null;
    this._editingEntryRevision = 0;
  }

  onEntryChange(draft: PersonalTextDraft): void {
    this.entryBody.set(draft.text);
    this.entryFormat.set(draft.format);
  }

  private async saveActiveDraft(): Promise<boolean> {
    if (this.isSaving()) return false;
    if (this._entryDraftDirty()) {
      await this.saveEntry();
      return !this._entryDraftDirty();
    }
    if (this._newItemDirty()) {
      return this.createItem();
    }
    return true;
  }

  private async _ensureDraftHandled(mode: DraftPromptMode): Promise<boolean> {
    if (this.isSaving() || this._draftPromptResolver) return false;
    if (!this.draftDirty() && !this.editingEntryId()) {
      this._clearEntryDraft();
      return true;
    }
    if (!this.draftDirty()) {
      this._clearEntryDraft();
      return true;
    }
    return new Promise<boolean>((resolve) => {
      this._draftPromptResolver = resolve;
      this.draftPrompt.set({
        mode,
        kind: this._entryDraftDirty() ? 'entry' : 'newItem',
        itemTitle: this.selectedRow()?.project.title ?? '',
      });
    });
  }

  private _resolveDraftPrompt(choice: DraftChoice): void {
    const resolve = this._draftPromptResolver;
    if (!resolve) return;
    this._draftPromptResolver = null;
    this.draftPrompt.set(null);
    if (choice === 'continue') {
      resolve(false);
    } else if (choice === 'discard') {
      this._clearEntryDraft();
      this.newItemTitle.set('');
      resolve(true);
    } else {
      void this.saveActiveDraft().then((ok) => resolve(ok));
    }
  }

  private async _applyQueryTarget(): Promise<void> {
    if (
      this._queryApplied ||
      this._queryApplying ||
      !this._hasData ||
      this.isSaving() ||
      this._destroyRef.destroyed
    ) {
      return;
    }
    const version = this._queryVersion;
    const target = this._queryTargetItemId;
    if (!target) {
      this._queryApplied = true;
      this.targetNotice.set(null);
      return;
    }
    const row = this.view().rows.find((r) => r.project.id === target);
    if (!row) {
      this._queryApplied = true;
      this.targetNotice.set('PERSONAL_ROUTINE.TARGET.NOT_FOUND');
      return;
    }
    this._queryApplying = true;
    try {
      if (this._selectedItemId() !== target) {
        const proceed = await this._ensureDraftHandled('switch');
        if (!proceed) {
          this._queryApplied = true;
          this._replaceItemQuery(this._selectedItemId());
          return;
        }
        if (version !== this._queryVersion || this._destroyRef.destroyed) return;
        if (!this.view().rows.some((r) => r.project.id === target)) {
          this._queryApplied = true;
          this.targetNotice.set('PERSONAL_ROUTINE.TARGET.NOT_FOUND');
          return;
        }
        this._selectedItemId.set(target);
        this._selectedDay.set(this.today());
        this._entryDayFollowsToday = true;
        this._clearEntryDraft();
      }
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

  private _replaceItemQuery(itemId: string | null): Promise<boolean> {
    return this._router.navigate([], {
      relativeTo: this._route,
      queryParams: itemId ? { itemId } : {},
      replaceUrl: true,
    });
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
      if (!this.isSaving()) {
        const state = this.saveState();
        if (state.kind === 'failed' || state.kind === 'rejected') {
          this._cancelPendingTarget();
        } else if (!this._queryApplied && !this._queryApplying) {
          this._queryApplied = true;
          this._replaceItemQuery(this._selectedItemId());
        }
      }
    }
  }

  private _cancelPendingTarget(): void {
    // A target requested during a failed write must not be applied later; the
    // page and URL stay on the item that actually owns the retained draft.
    this._targetCancelPending = true;
    if (this._draftPromptResolver) {
      const resolve = this._draftPromptResolver;
      this._draftPromptResolver = null;
      this.draftPrompt.set(null);
      resolve(false);
    }
    this._queryTargetItemId = this._selectedItemId();
    this._queryVersion++;
    this._queryApplied = true;
    // Only suppress stale query events until this URL restoration finishes.
    // A failed write must not consume the user's next deliberate navigation.
    void this._replaceItemQuery(this._selectedItemId()).finally(() => {
      this._targetCancelPending = false;
    });
  }

  private markSaved(): void {
    this.saveState.set({ kind: 'saved' });
    this._resumeCloseAfterSave();
    void this._applyQueryTarget();
  }

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
      this._closeSub.unsubscribe();
    }
    window.removeEventListener('beforeunload', this._onBeforeUnload);
  }

  private _onBeforeUnload = (event: BeforeUnloadEvent): void => {
    if (!this.draftDirty() && !this.isSaving()) return;
    event.preventDefault();
    event.returnValue = '';
  };

  private async _handleCloseRequested(): Promise<void> {
    if (this._closePromptOpen) return;
    if (this.isSaving()) {
      this._closeRequestedWhileSaving = true;
      return;
    }
    this._closePromptOpen = true;
    try {
      if (!(await this._execBeforeClose.waitForOtherHandlers(this._closeId))) return;
      const proceed = await this._ensureDraftHandled('close');
      if (proceed) this._execBeforeClose.setDone(this._closeId);
      else this._execBeforeClose.cancelClose();
    } finally {
      this._closePromptOpen = false;
    }
  }

  private _resumeCloseAfterSave(): void {
    if (!this._closeRequestedWhileSaving || this.isSaving()) return;
    this._closeRequestedWhileSaving = false;
    setTimeout(() => {
      void this._handleCloseRequested();
    }, 0);
  }
}
