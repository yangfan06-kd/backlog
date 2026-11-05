import { Injectable, inject } from '@angular/core';
import { Store } from '@ngrx/store';
import { firstValueFrom } from 'rxjs';
import { Project } from '../project/project.model';
import { INBOX_PROJECT } from '../project/project.const';
import { selectAllProjects } from '../project/store/project.selectors';
import { updateProject } from '../project/store/project.actions';
import { PersonalCommandCoordinatorService } from './personal-command-coordinator.service';
import {
  PersonalCommandResult,
  isPersonalRecordDay,
  personalProjectData,
  personalProjectKind,
  PersonalOwnerKind,
} from './personal-progress.model';
import {
  failedResult,
  persistedResult,
  rejectedResult,
} from './personal-progress-result';

export interface ManageProjectInput {
  operationId: string;
  projectId: string;
  expectedRevision: number;
  ownerKind?: PersonalOwnerKind;
}

export interface RenameProjectInput extends ManageProjectInput {
  expectedTitle: string;
  title: string;
}

/** One queued, receipted project update. Deletion never removes task entities. */
@Injectable({ providedIn: 'root' })
export class PersonalProjectManagementService {
  private _store = inject(Store);
  private _commands = inject(PersonalCommandCoordinatorService);

  convert(
    input: ManageProjectInput,
  ): Promise<PersonalCommandResult<{ projectId: string }>> {
    return this._commands.enqueue(() => this._run('convert', input));
  }

  rename(
    input: RenameProjectInput,
  ): Promise<PersonalCommandResult<{ projectId: string }>> {
    return this._commands.enqueue(async () => {
      const title = input.title?.trim();
      if (
        !title ||
        !input.operationId?.trim() ||
        !Number.isSafeInteger(input.expectedRevision) ||
        input.expectedRevision < 0 ||
        input.expectedRevision >= Number.MAX_SAFE_INTEGER
      )
        return rejectedResult(input.operationId, 'INVALID_INPUT');
      const projects: Project[] = await firstValueFrom(
        this._store.select(selectAllProjects),
      );
      const project = projects.find((p) => p.id === input.projectId);
      if (!project || project.id === INBOX_PROJECT.id)
        return rejectedResult(input.operationId, 'NOT_FOUND');
      if (personalProjectKind(project) !== (input.ownerKind ?? 'project'))
        return rejectedResult(input.operationId, 'TYPE_CONFLICT');
      if (project.isArchived || project.personalProgress?.trash?.deletedAt)
        return rejectedResult(input.operationId, 'PROJECT_UNAVAILABLE');
      const data = personalProjectData(project),
        previous = data.nameEdit;
      if (previous?.operationId === input.operationId)
        return previous.revision === input.expectedRevision + 1 && project.title === title
          ? persistedResult(input.operationId, { projectId: project.id })
          : rejectedResult(input.operationId, 'STALE_REVISION');
      if (
        (previous?.revision ?? 0) !== input.expectedRevision ||
        project.title !== input.expectedTitle
      )
        return rejectedResult(input.operationId, 'STALE_REVISION');
      if (title === project.title)
        return persistedResult(input.operationId, { projectId: project.id });
      try {
        await this._commands.dispatchWithReceipt(
          updateProject({
            project: {
              id: project.id,
              changes: {
                title,
                personalProgress: {
                  ...data,
                  nameEdit: {
                    revision: input.expectedRevision + 1,
                    operationId: input.operationId,
                  },
                },
              },
            },
            isSkipSnack: true,
          }),
          input.operationId,
        );
        return persistedResult(input.operationId, { projectId: project.id });
      } catch (e) {
        try {
          const currentProjects: Project[] = await firstValueFrom(
            this._store.select(selectAllProjects),
          );
          const current = currentProjects.find((p) => p.id === project.id);
          if (
            current?.title === title &&
            current.personalProgress?.nameEdit?.operationId === input.operationId
          )
            await this._commands.dispatchWithReceipt(
              updateProject({
                project: {
                  id: project.id,
                  changes: {
                    title: project.title,
                    personalProgress: {
                      ...personalProjectData(current),
                      nameEdit: previous,
                    },
                  },
                },
                isSkipSnack: true,
              }),
              `${input.operationId}-rollback`,
            );
        } catch {
          /* Report the failed write, including when rollback cannot persist. */
        }
        return failedResult(input.operationId, e);
      }
    });
  }

  schedule(
    input: ManageProjectInput & { day: string | null },
  ): Promise<PersonalCommandResult<{ projectId: string }>> {
    return this._commands.enqueue(() => this._run('schedule', input, input.day));
  }

  trash(
    input: ManageProjectInput,
  ): Promise<PersonalCommandResult<{ projectId: string }>> {
    return this._commands.enqueue(() => this._run('trash', input));
  }

  restore(
    input: ManageProjectInput,
  ): Promise<PersonalCommandResult<{ projectId: string }>> {
    return this._commands.enqueue(() => this._run('restore', input));
  }

  private async _run(
    action: 'schedule' | 'trash' | 'restore' | 'convert',
    input: ManageProjectInput,
    day: string | null = null,
  ): Promise<PersonalCommandResult<{ projectId: string }>> {
    if (
      !input.operationId?.trim() ||
      !Number.isSafeInteger(input.expectedRevision) ||
      input.expectedRevision < 0 ||
      input.expectedRevision >= Number.MAX_SAFE_INTEGER ||
      (day !== null && !isPersonalRecordDay(day))
    ) {
      return rejectedResult(input.operationId, 'INVALID_INPUT');
    }
    const projects: Project[] = await firstValueFrom(
      this._store.select(selectAllProjects),
    );
    const project = projects.find((p) => p.id === input.projectId);
    if (!project || project.id === INBOX_PROJECT.id)
      return rejectedResult(input.operationId, 'NOT_FOUND');
    const data = personalProjectData(project);
    const key =
      action === 'schedule' ? 'planning' : action === 'convert' ? 'kindEdit' : 'trash';
    const previous = data[key];
    if (previous?.operationId === input.operationId) {
      const matches =
        action === 'convert'
          ? personalProjectKind(project) !== (input.ownerKind ?? 'project')
          : action === 'schedule'
            ? data.planning?.day === day
            : action === 'trash'
              ? !!data.trash?.deletedAt
              : data.trash?.deletedAt === null;
      return matches && previous.revision === input.expectedRevision + 1
        ? persistedResult(input.operationId, { projectId: project.id })
        : rejectedResult(input.operationId, 'STALE_REVISION');
    }
    if (
      personalProjectKind(project) !== (input.ownerKind ?? 'project') ||
      (action === 'schedule' && input.ownerKind === 'routine')
    )
      return rejectedResult(input.operationId, 'TYPE_CONFLICT');
    if ((previous?.revision ?? 0) !== input.expectedRevision)
      return rejectedResult(input.operationId, 'STALE_REVISION');
    if (
      action === 'restore'
        ? !data.trash?.deletedAt
        : !!data.trash?.deletedAt || project.isArchived
    )
      return rejectedResult(input.operationId, 'PROJECT_UNAVAILABLE');
    const next = { ...data };
    const revision = input.expectedRevision + 1;
    if (action === 'convert') {
      next.kind = input.ownerKind === 'routine' ? 'project' : 'routine';
      next.kindEdit = { revision, operationId: input.operationId };
    } else if (action === 'schedule')
      next.planning = { day, revision, operationId: input.operationId };
    else
      next.trash = {
        deletedAt: action === 'trash' ? Date.now() : null,
        wasArchived: data.trash?.deletedAt
          ? data.trash.wasArchived
          : !!project.isArchived,
        revision,
        operationId: input.operationId,
      };
    const isArchived =
      action === 'schedule' || action === 'convert'
        ? project.isArchived
        : action === 'trash'
          ? true
          : data.trash!.wasArchived;
    try {
      await this._commands.dispatchWithReceipt(
        updateProject({
          project: { id: project.id, changes: { personalProgress: next, isArchived } },
          isSkipSnack: true,
        }),
        input.operationId,
      );
      return persistedResult(input.operationId, { projectId: project.id });
    } catch (e) {
      // Revert only this command's fields, and only while its marker still owns them.
      try {
        const currentProjects: Project[] = await firstValueFrom(
          this._store.select(selectAllProjects),
        );
        const current = currentProjects.find((p) => p.id === project.id);
        if (current?.personalProgress?.[key]?.operationId === input.operationId) {
          const restored = { ...personalProjectData(current), [key]: previous };
          await this._commands.dispatchWithReceipt(
            updateProject({
              project: {
                id: project.id,
                changes: {
                  personalProgress: {
                    ...restored,
                    ...(action === 'convert' ? { kind: data.kind } : {}),
                  },
                  ...(action === 'schedule' ? {} : { isArchived: project.isArchived }),
                },
              },
              isSkipSnack: true,
            }),
            `${input.operationId}-rollback`,
          );
        }
      } catch {
        /* Keep the failure visible; never report a durable success. */
      }
      return failedResult(input.operationId, e);
    }
  }
}
