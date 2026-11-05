import { Injectable, inject } from '@angular/core';
import { Task } from '../tasks/task.model';
import { TaskSharedActions } from '../../root-store/meta/task-shared.actions';
import { PersonalCommandCoordinatorService } from './personal-command-coordinator.service';
import { PersonalProgressService } from './personal-progress.service';
import { latestProjectCompletion } from './personal-completion-order';
import {
  PersonalCommandCode,
  PersonalCommandResult,
  PersonalCompletionReceipt,
  PersonalProgressOnTask,
  personalProjectKind,
  personalTaskData,
} from './personal-progress.model';

export interface UndoCompletionInput {
  operationId: string;
  projectId: string;
  completionId: string;
}

type UndoPlan =
  | { kind: 'rejected'; code: PersonalCommandCode }
  | { kind: 'already'; taskId: string }
  | { kind: 'ok'; task: Task; nextData: PersonalProgressOnTask };

const planUndo = (
  tasks: readonly Task[],
  projectId: string,
  completionId: string,
  operationId: string,
  canEdit: (day: string) => boolean,
): UndoPlan => {
  let targetTask: Task | null = null;
  let targetCompletion: PersonalCompletionReceipt | null = null;
  for (const task of tasks) {
    if (task.projectId !== projectId || task.parentId) continue;
    const found = personalTaskData(task).completions.find(
      (completion) => completion.id === completionId,
    );
    if (found) {
      targetTask = task;
      targetCompletion = found;
      break;
    }
  }
  if (!targetTask || !targetCompletion) return { kind: 'rejected', code: 'NOT_FOUND' };
  if (targetCompletion.undoOperationId === operationId) {
    return { kind: 'already', taskId: targetTask.id };
  }
  if (targetCompletion.undoneAt) return { kind: 'rejected', code: 'NOT_FOUND' };
  if (latestProjectCompletion(tasks, projectId)?.completion.id !== completionId)
    return { kind: 'rejected', code: 'NOT_LATEST' };

  const data = personalTaskData(targetTask);
  const hasLaterCompletionForTask = data.completions.some(
    (completion) =>
      completion.id !== targetCompletion!.id &&
      !completion.undoneAt &&
      completion.sequence > targetCompletion!.sequence,
  );
  if (hasLaterCompletionForTask || !targetTask.isDone) {
    return { kind: 'rejected', code: 'NOT_FOUND' };
  }
  const entry = data.entries.find((e) => e.id === targetCompletion!.entryId);
  if (!entry) return { kind: 'rejected', code: 'NOT_FOUND' };
  if (!canEdit(entry.recordDay)) {
    return { kind: 'rejected', code: 'HISTORY_LOCKED' };
  }
  if (entry.revision !== targetCompletion.entryRevisionAtCompletion) {
    return { kind: 'rejected', code: 'EDITED_ENTRY' };
  }
  return {
    kind: 'ok',
    task: targetTask,
    nextData: {
      ...data,
      entries: data.entries.filter((e) => e.id !== entry.id),
      completions: data.completions.map((completion) =>
        completion.id === targetCompletion!.id
          ? { ...completion, undoneAt: Date.now(), undoOperationId: operationId }
          : completion,
      ),
    },
  };
};

/** Both UI entries share this queued, project-wide reverse-order check. */
@Injectable({ providedIn: 'root' })
export class PersonalCompletionUndoService {
  private readonly _commands = inject(PersonalCommandCoordinatorService);
  private readonly _progress = inject(PersonalProgressService);

  undo(
    input: UndoCompletionInput,
  ): Promise<PersonalCommandResult<{ restoredStepId: string }>> {
    return this._commands.enqueue(() => this._run(input));
  }

  private async _run(
    input: UndoCompletionInput,
  ): Promise<PersonalCommandResult<{ restoredStepId: string }>> {
    if (!input.completionId?.trim()) {
      return {
        status: 'rejected',
        operationId: input.operationId,
        code: 'INVALID_INPUT',
      };
    }
    const projects = await this._progress.getProjects();
    const project = projects.find((p) => p.id === input.projectId);
    if (!project) {
      return {
        status: 'rejected',
        operationId: input.operationId,
        code: 'OWNER_MISMATCH',
      };
    }
    if (personalProjectKind(project) !== 'project') {
      return {
        status: 'rejected',
        operationId: input.operationId,
        code: 'TYPE_CONFLICT',
      };
    }
    if (project.isArchived || project.personalProgress?.trash?.deletedAt) {
      return {
        status: 'rejected',
        operationId: input.operationId,
        code: 'PROJECT_UNAVAILABLE',
      };
    }

    const activeTasks = await this._progress.getTasks();
    let archivedTasks: Task[];
    try {
      archivedTasks = await this._progress.loadArchivedTasks(true);
    } catch {
      return {
        status: 'failed',
        operationId: input.operationId,
        retryable: true,
        message: '无法读取历史记录，请重试。',
      };
    }
    // Active versions win when an archive snapshot contains the same task ID.
    const tasks = [
      ...new Map(
        [...archivedTasks, ...activeTasks].map((task) => [task.id, task]),
      ).values(),
    ];
    const targetIsActive = activeTasks.some((task) =>
      personalTaskData(task).completions.some((c) => c.id === input.completionId),
    );
    if (!targetIsActive)
      return { status: 'rejected', operationId: input.operationId, code: 'NOT_FOUND' };
    const plan = planUndo(
      tasks,
      input.projectId,
      input.completionId,
      input.operationId,
      (day) => day === this._progress.todayStr() || this._progress.isHistoryEditing,
    );
    if (plan.kind === 'rejected') {
      return { status: 'rejected', operationId: input.operationId, code: plan.code };
    }
    if (plan.kind === 'already') {
      return {
        status: 'persisted',
        operationId: input.operationId,
        value: { restoredStepId: plan.taskId },
      };
    }

    const task = plan.task;
    const snapshot = {
      isDone: task.isDone,
      doneOn: task.doneOn,
      personalProgress: task.personalProgress,
    };
    try {
      await this._commands.dispatchWithReceipt(
        TaskSharedActions.updateTask({
          task: {
            id: task.id,
            changes: {
              isDone: false,
              doneOn: undefined,
              personalProgress: plan.nextData,
            },
          },
        }),
        input.operationId,
      );
    } catch (e) {
      try {
        await this._commands.dispatchWithReceipt(
          TaskSharedActions.updateTask({ task: { id: task.id, changes: snapshot } }),
          `${input.operationId}-rollback`,
        );
      } catch {
        // Keep the original failure visible; never claim a durable undo.
      }
      return {
        status: 'failed',
        operationId: input.operationId,
        retryable: true,
        message: e instanceof Error ? e.message : 'Operation failed',
      };
    }
    return {
      status: 'persisted',
      operationId: input.operationId,
      value: { restoredStepId: task.id },
    };
  }
}
