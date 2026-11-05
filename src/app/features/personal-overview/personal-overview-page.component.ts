import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  OnInit,
  QueryList,
  ViewChildren,
  computed,
  inject,
  signal,
} from '@angular/core';
import { PersonalTextViewComponent } from '../personal-text/personal-text-view.component';
import { CommonModule } from '@angular/common';
import { MatMenuModule } from '@angular/material/menu';
import { CdkDrag, CdkDragDrop, CdkDropList } from '@angular/cdk/drag-drop';
import { Router, RouterLink } from '@angular/router';
import { TranslatePipe } from '@ngx-translate/core';
import { Store } from '@ngrx/store';
import { Subscription, combineLatest } from 'rxjs';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { filter } from 'rxjs/operators';
import { nanoid } from 'nanoid';
import { IS_ELECTRON } from '../../app.constants';
import { ExecBeforeCloseService } from '../../core/electron/exec-before-close.service';
import { Project } from '../project/project.model';
import { selectAllProjects } from '../project/store/project.selectors';
import { Task } from '../tasks/task.model';
import { selectAllTasks } from '../tasks/store/task.selectors';
import {
  PersonalProjectQuadrant,
  PersonalCommandResult,
  isPersonalProjectQuadrant,
} from '../personal-progress/personal-progress.model';
import { PersonalProgressService } from '../personal-progress/personal-progress.service';
import { PersonalOverviewOrderService } from './personal-overview-order.service';
import {
  PersonalProjectManagementService,
  RenameProjectInput,
} from '../personal-progress/personal-project-management.service';
import { PersonalProjectToolsComponent } from '../personal-progress/personal-project-tools.component';
import {
  PersonalOverviewGroup,
  PersonalOverviewGroupId,
  PersonalOverviewProjectRow,
  buildPersonalOverview,
  PersonalPlanFilter,
  matchesPersonalPlan,
} from './personal-overview.view';

type SaveState =
  | { kind: 'idle' }
  | { kind: 'saving' }
  | { kind: 'saved' }
  | { kind: 'rejected'; code: string }
  | { kind: 'failed'; message: string };

const QUADRANT_IDS: readonly PersonalProjectQuadrant[] = [
  'urgent-important',
  'important',
  'urgent',
  'neither',
];

@Component({
  selector: 'personal-overview-page',
  standalone: true,
  imports: [
    CommonModule,
    MatMenuModule,
    CdkDrag,
    CdkDropList,
    RouterLink,
    TranslatePipe,
    PersonalTextViewComponent,
    PersonalProjectToolsComponent,
  ],
  templateUrl: './personal-overview-page.component.html',
  styleUrls: ['./personal-overview-page.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PersonalOverviewPageComponent implements OnInit {
  @ViewChildren('projectName')
  private _projectNameButtons?: QueryList<ElementRef<HTMLButtonElement>>;

  private _store = inject(Store);
  private _service = inject(PersonalProgressService);
  private _order = inject(PersonalOverviewOrderService);
  private _router = inject(Router);
  private _destroyRef = inject(DestroyRef);
  private _execBeforeClose = inject(ExecBeforeCloseService);
  private _management = inject(PersonalProjectManagementService);

  readonly quadrantIds = QUADRANT_IDS;
  readonly dragStartDelay = { mouse: 0, touch: 250 };
  readonly saveState = signal<SaveState>({ kind: 'idle' });
  readonly savingProjectId = signal<string | null>(null);
  readonly selectedProjectId = signal<string | null>(null);
  readonly errorProjectId = signal<string | null>(null);
  readonly isSaving = computed(() => this.savingProjectId() !== null);
  readonly view = signal(buildPersonalOverview([], []));
  readonly planFilter = signal<PersonalPlanFilter>('all');
  readonly planFilters: readonly {
    id: PersonalPlanFilter;
    label: string;
    empty: string;
  }[] = [
    { id: 'all', label: '全部', empty: '还没有项目' },
    { id: 'today', label: '今日计划', empty: '今天没有安排项目' },
    { id: 'future', label: '未来计划', empty: '还没有未来计划' },
    { id: 'unplanned', label: '未安排', empty: '没有未安排日期的项目' },
    { id: 'overdue', label: '已过计划日期', empty: '没有已过计划日期的项目' },
  ];
  private readonly _today = signal(this._service.todayStr());
  private readonly _filteredGroups = computed(() =>
    this.view().groups.map((group) => ({
      ...group,
      rows: group.rows.filter((row) =>
        matchesPersonalPlan(row.project, this.planFilter(), this._today()),
      ),
    })),
  );
  readonly quadrantGroups = computed(() => this._filteredGroups().slice(0, 4));
  readonly filteredProjectCount = computed(() =>
    this._filteredGroups().reduce((sum, group) => sum + group.rows.length, 0),
  );
  readonly planEmptyText = computed(
    () =>
      this.planFilters.find((option) => option.id === this.planFilter())?.empty ??
      '暂无项目',
  );
  readonly unclassifiedGroup = computed(
    () => this._filteredGroups()[4] as PersonalOverviewGroup,
  );
  private readonly _expandedProjectIds = signal<ReadonlySet<string>>(new Set());

  private readonly _closeId = 'personal-overview-classification-close';
  private _closeSub: Subscription | null = null;
  private _closeRequestedWhileSaving = false;
  private _closeWaiting = false;

  ngOnInit(): void {
    combineLatest([
      this._store.select(selectAllProjects),
      this._store.select(selectAllTasks),
    ])
      .pipe(takeUntilDestroyed(this._destroyRef))
      .subscribe(([projects, tasks]: [Project[], Task[]]) => {
        this.view.set(buildPersonalOverview(projects, tasks));
      });
    this._setupCloseProtection();
    const clock = setInterval(() => this._today.set(this._service.todayStr()), 60_000);
    this._destroyRef.onDestroy(() => clearInterval(clock));
  }

  canDeactivate(): Promise<boolean> {
    // A real classification write must finish before the route can change.
    return Promise.resolve(!this.isSaving());
  }

  isExpanded(row: PersonalOverviewProjectRow): boolean {
    return this._expandedProjectIds().has(row.project.id);
  }

  toggleExpanded(row: PersonalOverviewProjectRow): void {
    const next = new Set(this._expandedProjectIds());
    if (next.has(row.project.id)) {
      next.delete(row.project.id);
    } else {
      next.add(row.project.id);
    }
    this._expandedProjectIds.set(next);
  }

  selectProject(row: PersonalOverviewProjectRow): void {
    this.selectedProjectId.set(row.project.id);
  }

  quadrantLabelKey(value: PersonalProjectQuadrant | null): string {
    return value
      ? `PERSONAL_OVERVIEW.QUADRANTS.${this._quadrantKey(value)}`
      : 'PERSONAL_OVERVIEW.UNCLASSIFIED';
  }

  isCurrentQuadrant(
    row: PersonalOverviewProjectRow,
    value: PersonalProjectQuadrant | null,
  ): boolean {
    return row.quadrant === value;
  }

  async chooseQuadrant(
    row: PersonalOverviewProjectRow,
    groupId: PersonalOverviewGroupId,
  ): Promise<void> {
    if (this.isSaving()) return;
    const quadrant: PersonalProjectQuadrant | null =
      groupId === 'unclassified' ? null : groupId;
    if (quadrant !== null && !isPersonalProjectQuadrant(quadrant)) return;
    this.selectedProjectId.set(row.project.id);
    this.errorProjectId.set(null);
    this.saveState.set({ kind: 'saving' });
    this.savingProjectId.set(row.project.id);
    const result = await this._service.setProjectQuadrant({
      operationId: nanoid(),
      projectId: row.project.id,
      expectedRevision: row.revision,
      quadrant,
    });
    this.savingProjectId.set(null);
    if (result.status === 'persisted') {
      this.saveState.set({ kind: 'saved' });
      // The row may have moved to another group; restore focus to its new
      // location after Angular updates the embedded views.
      setTimeout(() => this._focusProject(row.project.id), 0);
      this._resumeCloseAfterSave(true);
    } else if (result.status === 'rejected') {
      this.errorProjectId.set(row.project.id);
      this.saveState.set({ kind: 'rejected', code: result.code });
      this._resumeCloseAfterSave(false);
    } else {
      this.errorProjectId.set(row.project.id);
      this.saveState.set({ kind: 'failed', message: result.message });
      this._resumeCloseAfterSave(false);
    }
  }

  async dropProject(event: CdkDragDrop<PersonalOverviewProjectRow[]>): Promise<void> {
    if (
      event.previousContainer !== event.container ||
      event.previousIndex === event.currentIndex ||
      this.isSaving()
    )
      return;
    const source = event.container.data[event.previousIndex];
    const target = event.container.data[event.currentIndex];
    if (!source || !target) return;
    await this._moveProject(source, target, event.previousIndex < event.currentIndex);
  }

  async moveProjectByKey(
    event: KeyboardEvent,
    row: PersonalOverviewProjectRow,
  ): Promise<void> {
    if (!event.altKey || (event.key !== 'ArrowUp' && event.key !== 'ArrowDown')) return;
    event.preventDefault();
    event.stopPropagation();
    const group = this._filteredGroups().find((item) => item.id === row.groupId);
    const index =
      group?.rows.findIndex((item) => item.project.id === row.project.id) ?? -1;
    const target = group?.rows[index + (event.key === 'ArrowUp' ? -1 : 1)];
    if (target && !this.isSaving())
      await this._moveProject(row, target, event.key === 'ArrowDown');
  }

  private async _moveProject(
    source: PersonalOverviewProjectRow,
    target: PersonalOverviewProjectRow,
    after: boolean,
  ): Promise<void> {
    this.selectedProjectId.set(source.project.id);
    await this._manageProject(source.project.id, () =>
      this._order.reorder({
        operationId: nanoid(),
        projectId: source.project.id,
        targetId: target.project.id,
        after,
        expectedRevision: source.project.personalProgress?.overviewOrder?.revision ?? 0,
      }),
    );
  }

  onProjectRowClick(event: MouseEvent, row: PersonalOverviewProjectRow): void {
    const target = event.target as HTMLElement | null;
    if (target?.closest('button, a, input, select, textarea, mat-menu')) return;
    void this.openProgress(row);
  }

  async openProgress(row: PersonalOverviewProjectRow): Promise<void> {
    if (this.isSaving()) return;
    await this._router.navigate(['/personal-progress'], {
      queryParams: { projectId: row.project.id },
    });
  }

  async manageProject(
    row: PersonalOverviewProjectRow,
    action: 'schedule' | 'trash',
    day: string | null = null,
  ): Promise<void> {
    const input = {
      operationId: nanoid(),
      projectId: row.project.id,
      expectedRevision:
        action === 'schedule'
          ? (row.project.personalProgress?.planning?.revision ?? 0)
          : (row.project.personalProgress?.trash?.revision ?? 0),
    };
    await this._manageProject(row.project.id, () =>
      action === 'schedule'
        ? this._management.schedule({ ...input, day })
        : this._management.trash(input),
    );
  }

  async renameProject(request: Omit<RenameProjectInput, 'operationId'>): Promise<void> {
    await this._manageProject(request.projectId, () =>
      this._management.rename({ ...request, operationId: nanoid() }),
    );
  }

  private async _manageProject(
    projectId: string,
    command: () => Promise<PersonalCommandResult<{ projectId: string }>>,
  ): Promise<void> {
    if (this.isSaving()) return;
    this.saveState.set({ kind: 'saving' });
    this.savingProjectId.set(projectId);
    this.errorProjectId.set(null);
    let success = false;
    try {
      const result = await command();
      success = result.status === 'persisted';
      if (result.status === 'persisted') this.saveState.set({ kind: 'saved' });
      else if (result.status === 'rejected')
        this.saveState.set({ kind: 'rejected', code: result.code });
      else this.saveState.set({ kind: 'failed', message: result.message });
      if (!success) this.errorProjectId.set(projectId);
    } catch (e) {
      this.errorProjectId.set(projectId);
      this.saveState.set({
        kind: 'failed',
        message: e instanceof Error ? e.message : '保存失败',
      });
    } finally {
      this.savingProjectId.set(null);
      this._resumeCloseAfterSave(success);
    }
  }

  async createProject(): Promise<void> {
    if (this.isSaving()) return;
    await this._router.navigate(['/personal-progress'], { queryParams: { create: '1' } });
  }

  saveStateText(): string {
    const state = this.saveState();
    switch (state.kind) {
      case 'saving':
        return 'PERSONAL_OVERVIEW.STATUS.SAVING';
      case 'saved':
        return 'PERSONAL_OVERVIEW.STATUS.SAVED';
      case 'rejected':
        return `PERSONAL_OVERVIEW.REJECTED.${state.code}`;
      case 'failed':
        return 'PERSONAL_OVERVIEW.STATUS.FAILED';
      default:
        return 'PERSONAL_OVERVIEW.STATUS.IDLE';
    }
  }

  saveStateError(): string | null {
    const state = this.saveState();
    return state.kind === 'failed' ? state.message : null;
  }

  private _quadrantKey(value: PersonalProjectQuadrant): string {
    return value.toUpperCase().replace('-', '_');
  }

  private _focusProject(projectId: string): void {
    const button = this._projectNameButtons?.find(
      (ref) => ref.nativeElement.dataset.projectId === projectId,
    );
    button?.nativeElement.focus();
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
    this._destroyRef.onDestroy(() => {
      this._teardownCloseProtection();
    });
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
    if (!this.isSaving()) return;
    event.preventDefault();
    event.returnValue = '';
  };

  private async _handleCloseRequested(): Promise<void> {
    if (this._closeWaiting) return;
    if (this.isSaving()) {
      this._closeRequestedWhileSaving = true;
      return;
    }
    this._closeWaiting = true;
    try {
      if (!(await this._execBeforeClose.waitForOtherHandlers(this._closeId))) return;
      if (this.isSaving()) {
        this._closeRequestedWhileSaving = true;
        return;
      }
      this._execBeforeClose.setDone(this._closeId);
    } finally {
      this._closeWaiting = false;
    }
  }

  private _resumeCloseAfterSave(success: boolean): void {
    if (!this._closeRequestedWhileSaving) return;
    this._closeRequestedWhileSaving = false;
    if (success) {
      void this._handleCloseRequested();
    } else {
      // Keep the window and restore other handlers' pending state.
      this._execBeforeClose.cancelClose();
    }
  }
}
