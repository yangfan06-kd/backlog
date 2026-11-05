import { Injectable, inject } from '@angular/core';
import { updateProject } from '../project/store/project.actions';
import { PersonalCommandCoordinatorService } from './personal-command-coordinator.service';
import { PersonalProgressService } from './personal-progress.service';
import {
  PersonalCommandResult,
  personalProjectData,
  personalProjectKind,
} from './personal-progress.model';

export interface DeleteEntryInput {
  operationId: string;
  projectId: string;
  entryId: string;
}

/** Delete a handwritten project entry; step completions use the undo service. */
@Injectable({ providedIn: 'root' })
export class PersonalEntryDeleteService {
  private readonly _commands = inject(PersonalCommandCoordinatorService);
  private readonly _progress = inject(PersonalProgressService);

  delete(input: DeleteEntryInput): Promise<PersonalCommandResult<{ entryId: string }>> {
    return this._commands.enqueue(() => this._run(input));
  }

  private async _run(
    input: DeleteEntryInput,
  ): Promise<PersonalCommandResult<{ entryId: string }>> {
    const projects = await this._progress.getProjects();
    const project = projects.find((p) => p.id === input.projectId);
    if (!project) {
      return {
        status: 'rejected',
        operationId: input.operationId,
        code: 'OWNER_MISMATCH',
      };
    }
    if (project.isArchived || personalProjectKind(project) !== 'project') {
      return {
        status: 'rejected',
        operationId: input.operationId,
        code: 'PROJECT_UNAVAILABLE',
      };
    }
    const data = personalProjectData(project);
    const entry = data.entries.find((e) => e.id === input.entryId);
    if (!entry) {
      return { status: 'rejected', operationId: input.operationId, code: 'NOT_FOUND' };
    }
    const canEdit =
      entry.recordDay === this._progress.todayStr() || this._progress.isHistoryEditing;
    if (!canEdit) {
      return {
        status: 'rejected',
        operationId: input.operationId,
        code: 'HISTORY_LOCKED',
      };
    }
    try {
      await this._commands.dispatchWithReceipt(
        updateProject({
          project: {
            id: project.id,
            changes: {
              personalProgress: {
                ...data,
                entries: data.entries.filter((e) => e.id !== entry.id),
              },
            },
          },
        }),
        input.operationId,
      );
    } catch (e) {
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
      value: { entryId: entry.id },
    };
  }
}
