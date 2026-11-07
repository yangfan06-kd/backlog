import {
  failedResult,
  persistedResult,
  rejectedResult,
} from './personal-progress-result';
import { nextPersonalSequence } from './personal-progress-sequence';
import { inject, Injectable } from '@angular/core';
import { Action, Store } from '@ngrx/store';
import { firstValueFrom } from 'rxjs';
import { nanoid } from 'nanoid';
import { TaskSharedActions } from '../../root-store/meta/task-shared.actions';
import { DateService } from '../../core/date/date.service';
import { TaskArchiveService } from '../archive/task-archive.service';
import type { ArchiveModel } from '../archive/archive.model';
import { ArchiveStoreService } from '../../op-log/persistence/archive-store.service';
import { LockService } from '../../op-log/sync/lock.service';
import { LOCK_NAMES } from '../../op-log/core/operation-log.const';
import { INBOX_PROJECT } from '../project/project.const';
import { createPersonalProject } from './personal-project-factory';
import { Project } from '../project/project.model';
import { addProject, updateProject } from '../project/store/project.actions';
import { selectAllProjects } from '../project/store/project.selectors';
import { Task } from '../tasks/task.model';
import { selectAllTasks, selectTaskFeatureState } from '../tasks/store/task.selectors';
import { PersonalCommandCoordinatorService } from './personal-command-coordinator.service';
import {
  PersonalCommandResult,
  PersonalCompletionReceipt,
  PersonalOwnerKind,
  PersonalProjectQuadrant,
  PersonalProgressEntry,
  PersonalProgressOnProject,
  PersonalRecordDay,
  emptyTaskPersonalProgress,
  isPersonalOwnerKind,
  isPersonalProjectQuadrant,
  isPersonalRecordDay,
  normalizeBody,
  personalProjectData,
  personalProjectKind,
  personalProjectQuadrant,
  personalTaskData,
} from './personal-progress.model';
import {
  PersonalTextFormat,
  formatEquals,
  formatForText,
  textDraft,
} from '../personal-text/personal-text.model';

export interface CompleteStepInput {
  operationId: string;
  projectId: string;
  stepId: string;
  /** Local calendar day supplied by the caller (DateService at the boundary). */
  recordDay: PersonalRecordDay;
  /** Explicit timestamp so the reducer never reads the clock. */
  completedAt?: number;
}

export interface UndoLatestCompletionInput {
  operationId: string;
  projectId: string;
  expectedCompletionId?: string;
}

export interface InsertStepInput {
  operationId: string;
  projectId: string;
  afterStepId: string | null;
  title: string;
  format?: PersonalTextFormat | null;
}

export interface AddEntryInput {
  operationId: string;
  projectId: string;
  recordDay: PersonalRecordDay;
  body: string;
  bodyFormat?: PersonalTextFormat | null;
  /** Defaults to 'project' for existing callers. */
  ownerKind?: PersonalOwnerKind;
}

export interface EditEntryInput {
  operationId: string;
  projectId: string;
  entryId: string;
  expectedRevision: number;
  body: string;
  bodyFormat?: PersonalTextFormat | null;
  /** Defaults to 'project' for existing callers. */
  ownerKind?: PersonalOwnerKind;
}

export interface EditStepInput {
  operationId: string;
  projectId: string;
  stepId: string;
  expectedTitle: string;
  expectedRevision: number;
  title: string;
  format?: PersonalTextFormat | null;
}

export interface SetProjectQuadrantInput {
  operationId: string;
  projectId: string;
  expectedRevision: number;
  quadrant: PersonalProjectQuadrant | null;
}

interface ArchivedEntryLocation {
  task: Task;
  archive: ArchiveModel;
  storeName: 'archive_young' | 'archive_old';
}

interface TaskSnapshot {
  isDone: boolean;
  doneOn?: number;
  personalProgress?: Task['personalProgress'];
}

/**
 * Command boundary for the minimal personal-progress loop. Every command:
 * - validates ownership and revisions against current state,
 * - dispatches exactly one persistent action,
 * - waits for the op-log append receipt before reporting `persisted`,
 * - rolls the optimistic reducer change back when persistence fails.
 */
@Injectable({ providedIn: 'root' })
export class PersonalProgressService {
  private _store = inject(Store);
  private _dateService = inject(DateService);
  private _taskArchiveService = inject(TaskArchiveService);
  private _archiveStore = inject(ArchiveStoreService);
  private _lockService = inject(LockService);
  private _coordinator = inject(PersonalCommandCoordinatorService);
  private _historyEditing = false;
  private readonly _recentCompletions = new Map<string, string[]>();
  readonly isPersistenceSlow = this._coordinator.isPersistenceSlow;

  // retries, keyboard actions or other callers from overwriting a newer command.
  private _enqueue<T>(command: () => Promise<T>): Promise<T> {
    return this._coordinator.enqueue(command);
  }

  createProject(
    operationId: string,
    title: string,
    kind: PersonalOwnerKind = 'project',
    plannedDay: string | null = null,
    quadrant: PersonalProjectQuadrant | null = null,
  ): Promise<PersonalCommandResult<{ projectId: string }>> {
    return this._enqueue(() =>
      this._createProject(operationId, title, kind, plannedDay, quadrant),
    );
  }

  insertStepAfter(
    input: InsertStepInput,
  ): Promise<PersonalCommandResult<{ stepId: string }>> {
    return this._enqueue(() => this._insertStepAfter(input));
  }

  addStep(
    operationId: string,
    projectId: string,
    title: string,
    format?: PersonalTextFormat | null,
  ): Promise<PersonalCommandResult<{ stepId: string }>> {
    return this._enqueue(() =>
      this._insertStepAfter({
        operationId,
        projectId,
        afterStepId: null,
        title,
        format,
      }),
    );
  }

  completeStep(
    input: CompleteStepInput,
  ): Promise<PersonalCommandResult<{ entryId: string; completionId: string }>> {
    return this._enqueue(() => this._completeStep(input));
  }

  undoLatestCompletion(
    input: UndoLatestCompletionInput,
  ): Promise<PersonalCommandResult<{ restoredStepId: string }>> {
    return this._enqueue(() => this._undoLatestCompletion(input));
  }

  addEntry(input: AddEntryInput): Promise<PersonalCommandResult<{ entryId: string }>> {
    return this._enqueue(() => this._addEntry(input));
  }

  editEntry(input: EditEntryInput): Promise<PersonalCommandResult<{ revision: number }>> {
    return this._enqueue(() => this._editEntry(input));
  }

  editStep(input: EditStepInput): Promise<PersonalCommandResult<{ stepId: string }>> {
    return this._enqueue(() => this._editStep(input));
  }

  setProjectQuadrant(input: SetProjectQuadrantInput): Promise<
    PersonalCommandResult<{
      quadrant: PersonalProjectQuadrant | null;
      revision: number;
    }>
  > {
    return this._enqueue(() => this._setProjectQuadrant(input));
  }

  resetRecentUndo(): void {
    this._recentCompletions.clear();
  }

  resetRecentUndoForProject(projectId: string): void {
    this._recentCompletions.delete(projectId);
  }

  setHistoryEditing(isEditing: boolean): void {
    this._historyEditing = isEditing;
  }

  get isHistoryEditing(): boolean {
    return this._historyEditing;
  }

  resetHistoryEditing(): void {
    this._historyEditing = false;
  }

  todayStr(): string {
    return this._dateService.todayStr();
  }

  async getProjects(): Promise<Project[]> {
    return firstValueFrom(this._store.select(selectAllProjects));
  }

  async getTaskMap(): Promise<Record<string, Task | undefined>> {
    const state = await firstValueFrom(this._store.select(selectTaskFeatureState));
    return state.entities as Record<string, Task | undefined>;
  }

  async getTasks(): Promise<Task[]> {
    return firstValueFrom(this._store.select(selectAllTasks));
  }

  /** Archive is a separate IndexedDB store; call this when the page opens/refreshes. */
  async loadArchivedTasks(propagateError = false): Promise<Task[]> {
    try {
      const archive = await this._taskArchiveService.load();
      return archive.ids
        .map((id) => archive.entities[id])
        .filter((task): task is Task => !!task);
    } catch (error) {
      if (propagateError) throw error;
      return [];
    }
  }

  private async _createProject(
    operationId: string,
    title: string,
    kind: PersonalOwnerKind,
    plannedDay: string | null,
    quadrant: PersonalProjectQuadrant | null,
  ): Promise<PersonalCommandResult<{ projectId: string }>> {
    const clean = normalizeBody(title);
    if (
      !clean ||
      !isPersonalOwnerKind(kind) ||
      (plannedDay !== null && (kind !== 'project' || !isPersonalRecordDay(plannedDay))) ||
      (quadrant !== null && (kind !== 'project' || !isPersonalProjectQuadrant(quadrant)))
    ) {
      return rejectedResult(operationId, 'INVALID_INPUT');
    }
    const projectId = `pp-project-${operationId}`;
    const projects = await this.getProjects();
    const existing = projects.find((p) => p.id === projectId);
    if (existing) {
      return personalProjectKind(existing) === kind
        ? persistedResult(operationId, { projectId })
        : rejectedResult(operationId, 'TYPE_CONFLICT');
    }
    const project = createPersonalProject(
      operationId,
      clean,
      kind,
      plannedDay,
      Date.now(),
      quadrant,
    );
    try {
      await this._dispatchWithReceipt(addProject({ project }), operationId);
      return persistedResult(operationId, { projectId });
    } catch (e) {
      await this._removeProjectAfterFailure(projectId);
      return failedResult(operationId, e);
    }
  }

  private async _insertStepAfter(
    input: InsertStepInput,
  ): Promise<PersonalCommandResult<{ stepId: string }>> {
    const draft = textDraft(input.title, input.format);
    const title = draft.text;
    if (!title) return rejectedResult(input.operationId, 'INVALID_INPUT');
    const { project, tasks } = await this._projectAndTasks(input.projectId);
    if (!project) return rejectedResult(input.operationId, 'OWNER_MISMATCH');
    if (personalProjectKind(project) !== 'project')
      return rejectedResult(input.operationId, 'TYPE_CONFLICT');
    if (project.isArchived)
      return rejectedResult(input.operationId, 'PROJECT_UNAVAILABLE');

    const stepId = `pp-step-${input.operationId}`;
    if (project.taskIds.includes(stepId)) {
      return persistedResult(input.operationId, { stepId });
    }

    const order = project.taskIds.filter(
      (id) => id !== stepId && tasks.some((t) => t.id === id && !t.parentId),
    );
    let insertAt = order.length;
    if (input.afterStepId) {
      const idx = order.indexOf(input.afterStepId);
      const afterTask = tasks.find((t) => t.id === input.afterStepId);
      if (idx < 0 || !afterTask || afterTask.projectId !== input.projectId) {
        return rejectedResult(input.operationId, 'OWNER_MISMATCH');
      }
      insertAt = idx + 1;
    }
    const nextOrder = [...order.slice(0, insertAt), stepId, ...order.slice(insertAt)];

    try {
      await this._dispatchWithReceipt(
        TaskSharedActions.batchUpdateForProject({
          projectId: input.projectId,
          operations: [
            {
              type: 'create',
              tempId: stepId,
              data: {
                title,
                isDone: false,
                timeEstimate: 0,
              } as unknown as { title: string; isDone: boolean; timeEstimate: number },
            },
            { type: 'reorder', taskIds: nextOrder },
          ],
          createdTaskIds: { [stepId]: stepId },
          ...(draft.format
            ? {
                createdTaskPersonalProgress: {
                  [stepId]: {
                    ...emptyTaskPersonalProgress(),
                    stepFormat: draft.format,
                  },
                },
              }
            : {}),
          createdTaskTimestamp: Date.now(),
        }),
        input.operationId,
      );
    } catch (e) {
      await this._removeTaskAfterFailure(stepId);
      return failedResult(input.operationId, e);
    }

    const after = await this._projectAndTasks(input.projectId);
    if (!after.project?.taskIds.includes(stepId)) {
      await this._removeTaskAfterFailure(stepId);
      return failedResult(input.operationId, new Error('Step was not persisted'));
    }
    return persistedResult(input.operationId, { stepId });
  }

  private async _completeStep(
    input: CompleteStepInput,
  ): Promise<PersonalCommandResult<{ entryId: string; completionId: string }>> {
    if (!isPersonalRecordDay(input.recordDay)) {
      return rejectedResult(input.operationId, 'INVALID_INPUT');
    }
    if (input.recordDay > this._dateService.todayStr()) {
      return rejectedResult(input.operationId, 'INVALID_INPUT');
    }
    const { project, task } = await this._projectAndTask(input.projectId, input.stepId);
    if (!project || !task || task.projectId !== input.projectId) {
      return rejectedResult(input.operationId, 'OWNER_MISMATCH');
    }
    if (personalProjectKind(project) !== 'project')
      return rejectedResult(input.operationId, 'TYPE_CONFLICT');
    if (project.isArchived)
      return rejectedResult(input.operationId, 'PROJECT_UNAVAILABLE');
    const data = personalTaskData(task);
    const existing = data.completions.find((c) => c.operationId === input.operationId);
    if (existing) {
      if (existing.undoneAt) return rejectedResult(input.operationId, 'NOT_LATEST');
      const entry = data.entries.find((e) => e.id === existing.entryId);
      if (entry) {
        return persistedResult(input.operationId, {
          entryId: entry.id,
          completionId: existing.id,
        });
      }
    }
    if (task.isDone) return rejectedResult(input.operationId, 'ALREADY_DONE');

    const now = input.completedAt ?? Date.now();
    const sequence = await this._nextSequence(input.projectId);
    const entry: PersonalProgressEntry = {
      id: `pp-entry-${nanoid()}`,
      projectId: input.projectId,
      stepId: task.id,
      recordDay: input.recordDay,
      body: task.title,
      bodyFormat: formatForText(task.title, data.stepFormat),
      source: 'step-completion',
      createdAt: now,
      updatedAt: now,
      revision: 1,
      operationId: input.operationId,
    };
    const receipt: PersonalCompletionReceipt = {
      id: `pp-completion-${nanoid()}`,
      operationId: input.operationId,
      projectId: input.projectId,
      stepId: task.id,
      entryId: entry.id,
      sequence,
      entryRevisionAtCompletion: 1,
      createdAt: now,
    };
    const nextData = {
      ...data,
      entries: [...data.entries, entry],
      completions: [...data.completions, receipt],
    };
    const snapshot = this._snapshot(task);
    try {
      await this._dispatchWithReceipt(
        TaskSharedActions.updateTask({
          task: {
            id: task.id,
            changes: {
              isDone: true,
              doneOn: now,
              personalProgress: nextData,
            },
          },
        }),
        input.operationId,
      );
    } catch (e) {
      await this._restoreTask(task.id, snapshot);
      return failedResult(input.operationId, e);
    }
    const recent = this._recentCompletions.get(input.projectId) ?? [];
    this._recentCompletions.set(input.projectId, [...recent, receipt.id]);
    return persistedResult(input.operationId, {
      entryId: entry.id,
      completionId: receipt.id,
    });
  }

  private async _undoLatestCompletion(
    input: UndoLatestCompletionInput,
  ): Promise<PersonalCommandResult<{ restoredStepId: string }>> {
    const { project, tasks } = await this._projectAndTasks(input.projectId);
    if (!project) return rejectedResult(input.operationId, 'OWNER_MISMATCH');
    if (personalProjectKind(project) !== 'project')
      return rejectedResult(input.operationId, 'TYPE_CONFLICT');
    if (project.isArchived)
      return rejectedResult(input.operationId, 'PROJECT_UNAVAILABLE');

    const previousUndo = tasks
      .filter((task) => task.projectId === input.projectId)
      .flatMap((task) => personalTaskData(task).completions)
      .find((completion) => completion.undoOperationId === input.operationId);
    if (previousUndo) {
      return persistedResult(input.operationId, { restoredStepId: previousUndo.stepId });
    }
    const recent = this._recentCompletions.get(input.projectId) ?? [];
    const latestId = recent[recent.length - 1];
    if (!latestId) return rejectedResult(input.operationId, 'NOT_LATEST');

    const candidates = tasks
      .filter((t) => t.projectId === input.projectId)
      .flatMap((task) =>
        personalTaskData(task)
          .completions.filter((c) => !c.undoneAt && c.id === latestId)
          .map((c) => ({ task, completion: c })),
      );
    if (candidates.length === 0) {
      return rejectedResult(input.operationId, 'NOT_LATEST');
    }
    candidates.sort((a, b) => b.completion.sequence - a.completion.sequence);
    const latest = candidates[0];
    if (
      input.expectedCompletionId &&
      latest.completion.id !== input.expectedCompletionId
    ) {
      return rejectedResult(input.operationId, 'NOT_LATEST');
    }
    if (latest.completion.undoOperationId === input.operationId) {
      return persistedResult(input.operationId, {
        restoredStepId: latest.completion.stepId,
      });
    }
    if (latest.completion.undoneAt) {
      return rejectedResult(input.operationId, 'NOT_LATEST');
    }

    const task = latest.task;
    const data = personalTaskData(task);
    const entry = data.entries.find((e) => e.id === latest.completion.entryId);
    if (!entry) return rejectedResult(input.operationId, 'NOT_LATEST');
    if (!this._canEdit(entry.recordDay)) {
      return rejectedResult(input.operationId, 'HISTORY_LOCKED');
    }
    if (entry.revision !== latest.completion.entryRevisionAtCompletion) {
      return rejectedResult(input.operationId, 'EDITED_ENTRY');
    }

    const nextData = {
      ...data,
      entries: data.entries.filter((e) => e.id !== entry.id),
      completions: data.completions.map((c) =>
        c.id === latest.completion.id
          ? { ...c, undoneAt: Date.now(), undoOperationId: input.operationId }
          : c,
      ),
    };
    const snapshot = this._snapshot(task);
    try {
      await this._dispatchWithReceipt(
        TaskSharedActions.updateTask({
          task: {
            id: task.id,
            changes: {
              isDone: false,
              doneOn: undefined,
              personalProgress: nextData,
            },
          },
        }),
        input.operationId,
      );
    } catch (e) {
      await this._restoreTask(task.id, snapshot);
      return failedResult(input.operationId, e);
    }
    this._recentCompletions.set(input.projectId, recent.slice(0, -1));
    return persistedResult(input.operationId, { restoredStepId: task.id });
  }

  private async _addEntry(
    input: AddEntryInput,
  ): Promise<PersonalCommandResult<{ entryId: string }>> {
    const draft = textDraft(input.body, input.bodyFormat);
    const body = draft.text;
    if (!body || !isPersonalRecordDay(input.recordDay)) {
      return rejectedResult(input.operationId, 'INVALID_INPUT');
    }
    if (input.recordDay > this._dateService.todayStr()) {
      return rejectedResult(input.operationId, 'INVALID_INPUT');
    }
    const ownerKind = input.ownerKind ?? 'project';
    if (!isPersonalOwnerKind(ownerKind)) {
      return rejectedResult(input.operationId, 'INVALID_INPUT');
    }
    const project = await this._getProject(input.projectId);
    if (!project) return rejectedResult(input.operationId, 'OWNER_MISMATCH');
    if (project.id === INBOX_PROJECT.id || project.isArchived) {
      return rejectedResult(input.operationId, 'PROJECT_UNAVAILABLE');
    }
    if (personalProjectKind(project) !== ownerKind) {
      return rejectedResult(input.operationId, 'TYPE_CONFLICT');
    }

    const data = personalProjectData(project);
    const existing = data.entries.find((e) => e.operationId === input.operationId);
    if (existing) return persistedResult(input.operationId, { entryId: existing.id });

    const now = Date.now();
    const entry: PersonalProgressEntry = {
      id: `pp-entry-${nanoid()}`,
      projectId: input.projectId,
      recordDay: input.recordDay,
      body,
      bodyFormat: draft.format,
      source: 'manual',
      createdAt: now,
      updatedAt: now,
      revision: 1,
      operationId: input.operationId,
    };
    try {
      await this._dispatchWithReceipt(
        updateProject({
          project: {
            id: project.id,
            changes: {
              personalProgress: { ...data, entries: [...data.entries, entry] },
            },
          },
        }),
        input.operationId,
      );
    } catch (e) {
      await this._restoreAddedEntry(project.id, entry.id, input.operationId);
      return failedResult(input.operationId, e);
    }
    return persistedResult(input.operationId, { entryId: entry.id });
  }

  private async _setProjectQuadrant(input: SetProjectQuadrantInput): Promise<
    PersonalCommandResult<{
      quadrant: PersonalProjectQuadrant | null;
      revision: number;
    }>
  > {
    if (input.quadrant !== null && !isPersonalProjectQuadrant(input.quadrant)) {
      return rejectedResult(input.operationId, 'INVALID_INPUT');
    }
    if (!Number.isInteger(input.expectedRevision) || input.expectedRevision < 0) {
      return rejectedResult(input.operationId, 'INVALID_INPUT');
    }
    const project = await this._getProject(input.projectId);
    if (!project) return rejectedResult(input.operationId, 'NOT_FOUND');
    if (project.id === INBOX_PROJECT.id || project.isArchived) {
      return rejectedResult(input.operationId, 'PROJECT_UNAVAILABLE');
    }
    if (personalProjectKind(project) !== 'project')
      return rejectedResult(input.operationId, 'TYPE_CONFLICT');

    const previous = personalProjectQuadrant(project);
    if (previous.operationId === input.operationId) {
      return persistedResult(input.operationId, {
        quadrant: previous.value,
        revision: previous.revision,
      });
    }
    if (previous.revision !== input.expectedRevision) {
      return rejectedResult(input.operationId, 'STALE_REVISION');
    }
    if (previous.value === input.quadrant) {
      return persistedResult(input.operationId, {
        quadrant: previous.value,
        revision: previous.revision,
      });
    }

    const data = personalProjectData(project);
    const nextRevision = previous.revision + 1;
    const nextData = {
      ...data,
      quadrant: {
        value: input.quadrant,
        revision: nextRevision,
        operationId: input.operationId,
      },
    };
    try {
      await this._dispatchWithReceipt(
        updateProject({
          project: {
            id: project.id,
            changes: { personalProgress: nextData },
          },
        }),
        input.operationId,
      );
    } catch (e) {
      await this._restoreProjectQuadrant(project.id, previous, input.operationId);
      return failedResult(input.operationId, e);
    }
    return persistedResult(input.operationId, {
      quadrant: input.quadrant,
      revision: nextRevision,
    });
  }

  /**
   * Compensate only this command's quadrant field if it still owns it. Never
   * write back a whole old Project/personalProgress snapshot: a concurrent
   * manual entry or unknown optional field must survive a failed save.
   */
  private async _restoreProjectQuadrant(
    projectId: string,
    previous: ReturnType<typeof personalProjectQuadrant>,
    failedOperationId: string,
  ): Promise<void> {
    try {
      const latest = await this._getProject(projectId);
      if (!latest) return;
      const latestData = personalProjectData(latest);
      if (latestData.quadrant?.operationId !== failedOperationId) return;
      const restored: PersonalProgressOnProject = { ...latestData };
      if (previous.operationId) {
        restored.quadrant = previous;
      } else {
        delete restored.quadrant;
      }
      await this._dispatchWithReceipt(
        updateProject({
          project: { id: projectId, changes: { personalProgress: restored } },
        }),
        `pp-recover-${nanoid()}`,
      );
    } catch {}
  }

  private async _editStep(
    input: EditStepInput,
  ): Promise<PersonalCommandResult<{ stepId: string }>> {
    const draft = textDraft(input.title, input.format);
    const title = draft.text;
    if (!title) return rejectedResult(input.operationId, 'INVALID_INPUT');
    const { project, task } = await this._projectAndTask(input.projectId, input.stepId);
    if (!project || !task || task.projectId !== input.projectId) {
      return rejectedResult(input.operationId, 'OWNER_MISMATCH');
    }
    if (personalProjectKind(project) !== 'project')
      return rejectedResult(input.operationId, 'TYPE_CONFLICT');
    if (project.isArchived)
      return rejectedResult(input.operationId, 'PROJECT_UNAVAILABLE');
    if (task.isDone) return rejectedResult(input.operationId, 'ALREADY_DONE');
    const data = personalTaskData(task);
    const format =
      input.format === undefined && title === task.title
        ? (data.stepFormat ?? null)
        : draft.format;
    const revision = data.stepEdit?.revision ?? 0;
    const unchanged = task.title === title && formatEquals(data.stepFormat, format);
    const nextData: NonNullable<Task['personalProgress']> = {
      ...data,
      stepEdit: { revision: revision + 1, operationId: input.operationId },
    };
    if (input.format !== undefined) nextData.stepFormat = draft.format;
    else delete nextData.stepFormat;
    if (data.stepEdit?.operationId === input.operationId) {
      return unchanged
        ? persistedResult(input.operationId, { stepId: task.id })
        : rejectedResult(input.operationId, 'STALE_STEP');
    }
    if (revision !== input.expectedRevision || task.title !== input.expectedTitle) {
      return rejectedResult(input.operationId, 'STALE_STEP');
    }
    if (unchanged) return persistedResult(input.operationId, { stepId: task.id });
    try {
      await this._dispatchWithReceipt(
        TaskSharedActions.updateTask({
          task: {
            id: task.id,
            changes: {
              title,
              personalProgress: nextData,
            },
          },
        }),
        input.operationId,
      );
    } catch (e) {
      // Restore only the fields this command touched, never a full task snapshot.
      try {
        const { task: current } = await this._projectAndTask(input.projectId, task.id);
        const currentData = personalTaskData(current);
        if (current && currentData.stepEdit?.operationId === input.operationId) {
          await this._dispatchWithReceipt(
            TaskSharedActions.updateTask({
              task: {
                id: task.id,
                changes: {
                  ...(current.title === title ? { title: task.title } : {}),
                  personalProgress: {
                    ...currentData,
                    stepEdit: data.stepEdit,
                    stepFormat: data.stepFormat,
                  },
                },
              },
            }),
            `${input.operationId}-rollback`,
          );
        }
      } catch {
        // The UI still keeps the draft; a retry is safe and idempotent.
      }
      return failedResult(input.operationId, e);
    }
    return persistedResult(input.operationId, { stepId: task.id });
  }

  private async _editEntry(
    input: EditEntryInput,
  ): Promise<PersonalCommandResult<{ revision: number }>> {
    const draft = textDraft(input.body, input.bodyFormat);
    const body = draft.text;
    if (!body) return rejectedResult(input.operationId, 'INVALID_INPUT');

    const ownerKind = input.ownerKind ?? 'project';
    if (!isPersonalOwnerKind(ownerKind)) {
      return rejectedResult(input.operationId, 'INVALID_INPUT');
    }
    const { project, tasks } = await this._projectAndTasks(input.projectId);
    if (!project) return rejectedResult(input.operationId, 'OWNER_MISMATCH');
    if (project.id === INBOX_PROJECT.id || project.isArchived) {
      return rejectedResult(input.operationId, 'PROJECT_UNAVAILABLE');
    }
    if (personalProjectKind(project) !== ownerKind) {
      return rejectedResult(input.operationId, 'TYPE_CONFLICT');
    }

    const projectEntry = personalProjectData(project).entries.find(
      (e) => e.id === input.entryId,
    );
    if (projectEntry) {
      if (!this._canEdit(projectEntry.recordDay)) {
        return rejectedResult(input.operationId, 'HISTORY_LOCKED');
      }
      if (projectEntry.lastEditOperationId === input.operationId) {
        return persistedResult(input.operationId, { revision: projectEntry.revision });
      }
      if (projectEntry.revision !== input.expectedRevision) {
        return rejectedResult(input.operationId, 'STALE_REVISION');
      }
      const data = personalProjectData(project);
      const bodyFormat =
        input.bodyFormat === undefined && body === projectEntry.body
          ? projectEntry.bodyFormat
          : draft.format;
      const nextEntries = data.entries.map((e) =>
        e.id === projectEntry.id
          ? {
              ...e,
              body,
              bodyFormat,
              updatedAt: Date.now(),
              revision: e.revision + 1,
              lastEditOperationId: input.operationId,
            }
          : e,
      );
      try {
        await this._dispatchWithReceipt(
          updateProject({
            project: {
              id: project.id,
              changes: { personalProgress: { ...data, entries: nextEntries } },
            },
          }),
          input.operationId,
        );
      } catch (e) {
        await this._restoreEditedEntry(
          project.id,
          projectEntry.id,
          input.operationId,
          projectEntry,
        );
        return failedResult(input.operationId, e);
      }
      return persistedResult(input.operationId, { revision: projectEntry.revision + 1 });
    }

    const task = tasks.find((t) =>
      personalTaskData(t).entries.some((e) => e.id === input.entryId),
    );
    if (!task) {
      return this._editArchivedEntry(input, body, draft.format);
    }
    if (task.projectId !== input.projectId) {
      return rejectedResult(input.operationId, 'OWNER_MISMATCH');
    }
    const data = personalTaskData(task);
    const entry = data.entries.find((e) => e.id === input.entryId)!;
    if (!this._canEdit(entry.recordDay)) {
      return rejectedResult(input.operationId, 'HISTORY_LOCKED');
    }
    if (entry.lastEditOperationId === input.operationId) {
      return persistedResult(input.operationId, { revision: entry.revision });
    }
    if (entry.revision !== input.expectedRevision) {
      return rejectedResult(input.operationId, 'STALE_REVISION');
    }
    const nextEntries = data.entries.map((e) =>
      e.id === entry.id
        ? {
            ...e,
            body,
            bodyFormat:
              input.bodyFormat === undefined && body === entry.body
                ? entry.bodyFormat
                : draft.format,
            updatedAt: Date.now(),
            revision: e.revision + 1,
            lastEditOperationId: input.operationId,
          }
        : e,
    );
    const snapshot = this._snapshot(task);
    try {
      await this._dispatchWithReceipt(
        TaskSharedActions.updateTask({
          task: {
            id: task.id,
            changes: { personalProgress: { ...data, entries: nextEntries } },
          },
        }),
        input.operationId,
      );
    } catch (e) {
      await this._restoreTask(task.id, snapshot);
      return failedResult(input.operationId, e);
    }
    return persistedResult(input.operationId, { revision: entry.revision + 1 });
  }

  /**
   * Archives are stored in SUP_OPS, but a plain Task update would only reach
   * archive storage after a separate ArchiveService write. DS-005 needs the
   * controlled archive record edit to be all-or-nothing with its op: pass the
   * next archive snapshot into the capture transaction (see
   * OperationLogStoreService.appendWithVectorClockOverwrite).
   */
  private async _editArchivedEntry(
    input: EditEntryInput,
    body: string,
    bodyFormat: PersonalTextFormat | null,
  ): Promise<PersonalCommandResult<{ revision: number }>> {
    return this._lockService.request(LOCK_NAMES.TASK_ARCHIVE, async () => {
      const location = await this._findArchivedEntry(input.projectId, input.entryId);
      if (!location) return rejectedResult(input.operationId, 'OWNER_MISMATCH');

      const { task, archive, storeName } = location;
      const data = personalTaskData(task);
      const entry = data.entries.find((e) => e.id === input.entryId);
      if (!entry) return rejectedResult(input.operationId, 'NOT_FOUND');
      if (!this._canEdit(entry.recordDay)) {
        return rejectedResult(input.operationId, 'HISTORY_LOCKED');
      }
      if (entry.lastEditOperationId === input.operationId) {
        return persistedResult(input.operationId, { revision: entry.revision });
      }
      if (entry.revision !== input.expectedRevision) {
        return rejectedResult(input.operationId, 'STALE_REVISION');
      }

      const now = Date.now();
      const nextData = {
        ...data,
        entries: data.entries.map((e) =>
          e.id === entry.id
            ? {
                ...e,
                body,
                bodyFormat:
                  input.bodyFormat === undefined && body === entry.body
                    ? entry.bodyFormat
                    : bodyFormat,
                updatedAt: now,
                revision: e.revision + 1,
                lastEditOperationId: input.operationId,
              }
            : e,
        ),
      };
      const nextArchive: ArchiveModel = {
        ...archive,
        task: {
          ...archive.task,
          entities: {
            ...archive.task.entities,
            [task.id]: { ...task, personalProgress: nextData },
          },
        },
      };

      try {
        await this._dispatchWithReceipt(
          TaskSharedActions.updateTask({
            task: {
              id: task.id,
              changes: { personalProgress: nextData },
            },
          }),
          input.operationId,
          { archiveWrite: { storeName, data: nextArchive } },
        );
      } catch (e) {
        return failedResult(input.operationId, e);
      }
      return persistedResult(input.operationId, { revision: entry.revision + 1 });
    });
  }

  private async _findArchivedEntry(
    projectId: string,
    entryId: string,
  ): Promise<ArchivedEntryLocation | null> {
    const [young, old] = await Promise.all([
      this._archiveStore.loadArchiveYoung(),
      this._archiveStore.loadArchiveOld(),
    ]);
    const archives: Array<{
      archive: ArchiveModel;
      storeName: 'archive_young' | 'archive_old';
    }> = [];
    if (young) archives.push({ archive: young, storeName: 'archive_young' });
    if (old) archives.push({ archive: old, storeName: 'archive_old' });
    for (const { archive, storeName } of archives) {
      const task = Object.values(archive.task.entities).find(
        (candidate) =>
          candidate?.projectId === projectId &&
          personalTaskData(candidate).entries.some((e) => e.id === entryId),
      ) as Task | undefined;
      if (task) return { task, archive, storeName };
    }
    return null;
  }

  private _dispatchWithReceipt(
    action: Action,
    commandId: string,
    extraMeta?: Record<string, unknown>,
  ): Promise<void> {
    return this._coordinator.dispatchWithReceipt(action, commandId, extraMeta);
  }

  private _snapshot(task: Task): TaskSnapshot {
    return {
      isDone: task.isDone,
      doneOn: task.doneOn,
      personalProgress: task.personalProgress,
    };
  }

  private async _restoreTask(taskId: string, snapshot: TaskSnapshot): Promise<void> {
    try {
      await this._dispatchWithReceipt(
        TaskSharedActions.updateTask({
          task: {
            id: taskId,
            changes: {
              isDone: snapshot.isDone,
              doneOn: snapshot.doneOn,
              personalProgress: snapshot.personalProgress,
            },
          },
        }),
        `pp-recover-${nanoid()}`,
      );
    } catch {
      // The failure result still tells the user nothing was persisted; a reload
      // restores the durable state. Do not hide the original failure.
    }
  }

  private async _restoreAddedEntry(
    projectId: string,
    entryId: string,
    operationId: string,
  ): Promise<void> {
    try {
      const latest = await this._getProject(projectId);
      if (!latest) return;
      const data = personalProjectData(latest);
      const entry = data.entries.find((e) => e.id === entryId);
      if (!entry || entry.operationId !== operationId) return;
      await this._dispatchWithReceipt(
        updateProject({
          project: {
            id: projectId,
            changes: {
              personalProgress: {
                ...data,
                entries: data.entries.filter((e) => e.id !== entryId),
              },
            },
          },
        }),
        `pp-recover-${nanoid()}`,
      );
    } catch {}
  }

  private async _restoreEditedEntry(
    projectId: string,
    entryId: string,
    operationId: string,
    previous: PersonalProgressEntry,
  ): Promise<void> {
    try {
      const latest = await this._getProject(projectId);
      if (!latest) return;
      const data = personalProjectData(latest);
      const entry = data.entries.find((e) => e.id === entryId);
      if (!entry || entry.lastEditOperationId !== operationId) return;
      const restored: PersonalProgressEntry = {
        ...entry,
        body: previous.body,
        bodyFormat: previous.bodyFormat,
        updatedAt: previous.updatedAt,
        revision: previous.revision,
        lastEditOperationId: previous.lastEditOperationId,
      };
      await this._dispatchWithReceipt(
        updateProject({
          project: {
            id: projectId,
            changes: {
              personalProgress: {
                ...data,
                entries: data.entries.map((e) => (e.id === entryId ? restored : e)),
              },
            },
          },
        }),
        `pp-recover-${nanoid()}`,
      );
    } catch {}
  }

  private async _removeTaskAfterFailure(taskId: string): Promise<void> {
    try {
      const tasks = await this.getTasks();
      const task = tasks.find((t) => t.id === taskId);
      if (task) {
        await this._dispatchWithReceipt(
          TaskSharedActions.deleteTasks({ taskIds: [taskId], tasks: [task] }),
          `pp-recover-${nanoid()}`,
        );
      }
    } catch {}
  }

  private async _removeProjectAfterFailure(projectId: string): Promise<void> {
    try {
      const project = await this._getProject(projectId);
      if (project) {
        await this._dispatchWithReceipt(
          TaskSharedActions.deleteProject({
            projectId,
            noteIds: project.noteIds ?? [],
            allTaskIds: [...project.taskIds, ...project.backlogTaskIds],
          }),
          `pp-recover-${nanoid()}`,
        );
      }
    } catch {}
  }

  private _canEdit(recordDay: PersonalRecordDay): boolean {
    return recordDay === this._dateService.todayStr() || this._historyEditing;
  }

  private async _getProject(projectId: string): Promise<Project | undefined> {
    const projects = await this.getProjects();
    return projects.find((p) => p.id === projectId);
  }

  private async _projectAndTasks(
    projectId: string,
  ): Promise<{ project?: Project; tasks: Task[] }> {
    const [projects, tasks] = await Promise.all([this.getProjects(), this.getTasks()]);
    return { project: projects.find((p) => p.id === projectId), tasks };
  }

  private async _projectAndTask(
    projectId: string,
    taskId: string,
  ): Promise<{ project?: Project; task?: Task }> {
    const { project, tasks } = await this._projectAndTasks(projectId);
    return { project, task: tasks.find((t) => t.id === taskId) };
  }

  private async _nextSequence(projectId: string): Promise<number> {
    const [tasks, archived] = await Promise.all([
      this.getTasks(),
      this.loadArchivedTasks(),
    ]);
    return nextPersonalSequence(tasks, archived, projectId);
  }
}
