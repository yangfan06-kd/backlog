import { inject, Injectable } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { nanoid } from 'nanoid';
import { updateProject } from '../project/store/project.actions';
import { selectAllProjects } from '../project/store/project.selectors';
import { Store } from '@ngrx/store';
import {
  PersonalCommandCode,
  PersonalCommandResult,
  PersonalProjectLifecycleAction,
  PersonalProjectLifecycleState,
  isPersonalProjectLifecycleAction,
  personalProjectData,
  personalProjectKind,
  personalProjectLifecycle,
} from '../personal-progress/personal-progress.model';
import { PersonalCommandCoordinatorService } from '../personal-progress/personal-command-coordinator.service';
import { INBOX_PROJECT } from '../project/project.const';
import { Project } from '../project/project.model';

export interface FinishProjectInput {
  operationId: string;
  projectId: string;
  expectedRevision: number;
}

export interface RestoreProjectInput {
  operationId: string;
  projectId: string;
  expectedRevision: number;
}

export interface PersonalLifecycleResult {
  projectId: string;
  revision: number;
}

/**
 * Thin finish/restore boundary: one Project update, root flags authoritative,
 * and the latest command marker only for idempotence/rollback.
 */
@Injectable({ providedIn: 'root' })
export class PersonalProjectLifecycleService {
  private _store = inject(Store);
  private _coordinator = inject(PersonalCommandCoordinatorService);

  finishProject(
    input: FinishProjectInput,
  ): Promise<PersonalCommandResult<PersonalLifecycleResult>> {
    return this._coordinator.enqueue(() => this._run('finish', input));
  }

  restoreProject(
    input: RestoreProjectInput,
  ): Promise<PersonalCommandResult<PersonalLifecycleResult>> {
    return this._coordinator.enqueue(() => this._run('restore', input));
  }

  private async _run(
    action: PersonalProjectLifecycleAction,
    input: FinishProjectInput | RestoreProjectInput,
  ): Promise<PersonalCommandResult<PersonalLifecycleResult>> {
    if (
      !Number.isSafeInteger(input.expectedRevision) ||
      input.expectedRevision < 0 ||
      input.expectedRevision >= Number.MAX_SAFE_INTEGER ||
      typeof input.operationId !== 'string' ||
      !input.operationId.trim()
    ) {
      return this._rejected(input.operationId, 'INVALID_INPUT');
    }
    const projects = await this._getProjects();
    const project = projects.find((candidate) => candidate.id === input.projectId);
    if (!project) return this._rejected(input.operationId, 'NOT_FOUND');
    if (project.personalProgress?.trash?.deletedAt)
      return this._rejected(input.operationId, 'PROJECT_UNAVAILABLE');
    if (project.id === INBOX_PROJECT.id) {
      return this._rejected(input.operationId, 'PROJECT_UNAVAILABLE');
    }
    if (personalProjectKind(project) !== 'project') {
      return this._rejected(input.operationId, 'TYPE_CONFLICT');
    }

    const raw: unknown = project.personalProgress?.lifecycle;
    if (raw !== undefined) {
      const marker = raw as Partial<PersonalProjectLifecycleState> | null;
      if (
        !marker ||
        typeof marker !== 'object' ||
        !Number.isSafeInteger(marker.revision) ||
        (marker.revision ?? 0) < 1 ||
        typeof marker.operationId !== 'string' ||
        !marker.operationId.trim() ||
        !isPersonalProjectLifecycleAction(marker.action)
      ) {
        return this._rejected(input.operationId, 'TYPE_CONFLICT');
      }
    }
    const previous = personalProjectLifecycle(project);
    if (previous.action !== null) {
      const isRetry =
        previous.operationId === input.operationId && previous.action === action;
      if (isRetry) {
        if (previous.revision !== input.expectedRevision + 1) {
          return this._rejected(input.operationId, 'STALE_REVISION');
        }
        return this._sameCommandResult(project, action, input.operationId);
      }
      if (previous.revision !== input.expectedRevision) {
        return this._rejected(input.operationId, 'STALE_REVISION');
      }
    } else if (previous.revision !== input.expectedRevision) {
      return this._rejected(input.operationId, 'STALE_REVISION');
    }

    if (action === 'finish' && (project.isArchived || project.isDone)) {
      return this._rejected(input.operationId, 'ALREADY_DONE');
    }
    if (action === 'restore' && !project.isArchived) {
      return this._rejected(input.operationId, 'NOT_ARCHIVED');
    }

    const now = Date.now();
    if (!Number.isFinite(now) || now <= 0) {
      return this._rejected(input.operationId, 'INVALID_INPUT');
    }
    const target =
      action === 'finish'
        ? { isArchived: true, isDone: true, doneOn: now as number | null }
        : { isArchived: false, isDone: false, doneOn: null as number | null };
    const nextRevision = previous.revision + 1;
    const data = personalProjectData(project);
    const nextData = {
      ...data,
      lifecycle: {
        revision: nextRevision,
        operationId: input.operationId,
        action,
      },
    };

    try {
      await this._coordinator.dispatchWithReceipt(
        updateProject({
          project: {
            id: project.id,
            changes: {
              ...target,
              personalProgress: nextData,
            },
          },
          isSkipSnack: true,
        }),
        input.operationId,
      );
    } catch (e) {
      await this._restoreFailedLifecycle(
        action,
        project,
        nextRevision,
        input.operationId,
        target,
      );
      return this._failed(input.operationId, e);
    }
    return this._persisted(input.operationId, {
      projectId: project.id,
      revision: nextRevision,
    });
  }

  private _sameCommandResult(
    project: Project,
    action: PersonalProjectLifecycleAction,
    operationId: string,
  ): PersonalCommandResult<PersonalLifecycleResult> {
    const rootMatches =
      action === 'finish'
        ? project.isArchived &&
          project.isDone &&
          typeof project.doneOn === 'number' &&
          Number.isFinite(project.doneOn) &&
          project.doneOn > 0
        : !project.isArchived && !project.isDone && project.doneOn === null;
    if (!rootMatches) return this._rejected(operationId, 'STALE_REVISION');
    const lifecycle = personalProjectLifecycle(project);
    return this._persisted(operationId, {
      projectId: project.id,
      revision: lifecycle.revision,
    });
  }

  private async _restoreFailedLifecycle(
    action: PersonalProjectLifecycleAction,
    previousProject: Project,
    writtenRevision: number,
    operationId: string,
    target: { isArchived: boolean; isDone: boolean; doneOn: number | null },
  ): Promise<void> {
    try {
      const projects = await this._getProjects();
      const latest = projects.find((candidate) => candidate.id === previousProject.id);
      if (!latest) return;
      const latestLifecycle = personalProjectLifecycle(latest);
      if (
        latestLifecycle.operationId !== operationId ||
        latestLifecycle.revision !== writtenRevision ||
        latestLifecycle.action !== action ||
        latest.isArchived !== target.isArchived ||
        latest.isDone !== target.isDone ||
        latest.doneOn !== target.doneOn
      ) {
        return;
      }
      const data = personalProjectData(latest);
      const previousLifecycle = previousProject.personalProgress?.lifecycle;
      const restoredData = { ...data };
      if (previousLifecycle) {
        restoredData.lifecycle = previousLifecycle;
      } else {
        delete restoredData.lifecycle;
      }
      await this._coordinator.dispatchWithReceipt(
        updateProject({
          project: {
            id: latest.id,
            changes: {
              isArchived: previousProject.isArchived,
              isDone: previousProject.isDone,
              doneOn: previousProject.doneOn ?? null,
              personalProgress: restoredData,
            },
          },
          isSkipSnack: true,
        }),
        `pp-lifecycle-recover-${nanoid()}`,
      );
    } catch {
      // The UI keeps the project and the action retryable.
    }
  }

  private async _getProjects(): Promise<Project[]> {
    return firstValueFrom(this._store.select(selectAllProjects));
  }

  private _persisted(
    operationId: string,
    value: PersonalLifecycleResult,
  ): PersonalCommandResult<PersonalLifecycleResult> {
    return { status: 'persisted', operationId, value };
  }

  private _rejected(
    operationId: string,
    code: PersonalCommandCode,
  ): PersonalCommandResult<PersonalLifecycleResult> {
    return { status: 'rejected', operationId, code };
  }

  private _failed(
    operationId: string,
    error: unknown,
  ): PersonalCommandResult<PersonalLifecycleResult> {
    return {
      status: 'failed',
      operationId,
      retryable: true,
      message: error instanceof Error ? error.message : String(error),
    };
  }
}
