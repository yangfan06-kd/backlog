import { Injectable, inject } from '@angular/core';
import { Store } from '@ngrx/store';
import { firstValueFrom } from 'rxjs';
import { selectAllProjects } from '../project/store/project.selectors';
import { selectAllTasks } from '../tasks/store/task.selectors';
import { updateProject } from '../project/store/project.actions';
import { PersonalCommandCoordinatorService } from './personal-command-coordinator.service';
import { PersonalProgressService } from './personal-progress.service';
import {
  buildPersonalProgressTaskMap,
  collectPersonalProjectEntries,
} from './personal-progress.view';
import {
  PersonalCommandResult,
  PersonalOwnerKind,
  personalProjectData,
  personalProjectKind,
} from './personal-progress.model';
import {
  failedResult,
  persistedResult,
  rejectedResult,
} from './personal-progress-result';

export interface ReorderRecordsInput {
  operationId: string;
  ownerKind?: PersonalOwnerKind;
  projectId: string;
  day: string;
  expectedRevision: number;
  entryIds: string[];
}

/** A project-owned presentation index, never a second source of entry membership.
 * One rank per existing record; old clients simply keep chronological ordering.
 * Task/archive records and completion receipts are never rewritten by sorting.
 */
@Injectable({ providedIn: 'root' })
export class PersonalRecordOrderService {
  private _store = inject(Store);
  private _commands = inject(PersonalCommandCoordinatorService);
  private _progress = inject(PersonalProgressService);

  reorder(
    input: ReorderRecordsInput,
  ): Promise<PersonalCommandResult<{ projectId: string }>> {
    return this._commands.enqueue(async () => {
      const projects = await firstValueFrom(this._store.select(selectAllProjects));
      const project = projects.find((p) => p.id === input.projectId);
      if (!project || project.isArchived || project.personalProgress?.trash?.deletedAt)
        return rejectedResult(input.operationId, 'PROJECT_UNAVAILABLE');
      if (personalProjectKind(project) !== (input.ownerKind ?? 'project'))
        return rejectedResult(input.operationId, 'TYPE_CONFLICT');
      const data = personalProjectData(project);
      const previous = data.entryOrder;
      if (previous?.operationId === input.operationId)
        return persistedResult(input.operationId, { projectId: project.id });
      if (
        !input.operationId.trim() ||
        !Number.isSafeInteger(input.expectedRevision) ||
        (previous?.revision ?? 0) !== input.expectedRevision
      )
        return rejectedResult(input.operationId, 'STALE_REVISION');
      const tasks = await firstValueFrom(this._store.select(selectAllTasks));
      const archived = await this._progress.loadArchivedTasks(true);
      const entries = collectPersonalProjectEntries(
        project,
        buildPersonalProgressTaskMap(tasks, archived),
      ).map(({ entry }) => entry);
      const sameDay = entries.filter((entry) => entry.recordDay === input.day);
      if (
        !sameDay.length ||
        new Set(input.entryIds).size !== sameDay.length ||
        input.entryIds.length !== sameDay.length ||
        sameDay.some((entry) => !input.entryIds.includes(entry.id))
      )
        return rejectedResult(input.operationId, 'STALE_REVISION');
      // Prune deleted-entry overrides whenever the user reorders; no growing event log.
      const positions: Record<string, number> = {};
      for (const entry of entries) {
        const rank = previous?.positions[entry.id];
        if (Number.isFinite(rank)) positions[entry.id] = rank!;
      }
      input.entryIds.forEach((id, index) => {
        positions[id] = index;
      });
      const next = {
        positions,
        revision: input.expectedRevision + 1,
        operationId: input.operationId,
      };
      try {
        await this._commands.dispatchWithReceipt(
          updateProject({
            project: {
              id: project.id,
              changes: { personalProgress: { ...data, entryOrder: next } },
            },
            isSkipSnack: true,
          }),
          input.operationId,
        );
        return persistedResult(input.operationId, { projectId: project.id });
      } catch (error) {
        try {
          const current = (
            await firstValueFrom(this._store.select(selectAllProjects))
          ).find((p) => p.id === project.id);
          if (current?.personalProgress?.entryOrder?.operationId === input.operationId)
            await this._commands.dispatchWithReceipt(
              updateProject({
                project: {
                  id: project.id,
                  changes: {
                    personalProgress: {
                      ...personalProjectData(current),
                      entryOrder: previous,
                    },
                  },
                },
                isSkipSnack: true,
              }),
              input.operationId + '-rollback',
            );
        } catch {
          /* Keep write failures visible. */
        }
        return failedResult(input.operationId, error);
      }
    });
  }
}
