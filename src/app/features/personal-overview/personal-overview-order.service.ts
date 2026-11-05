import { inject, Injectable } from '@angular/core';
import { nanoid } from 'nanoid';
import { updateProject } from '../project/store/project.actions';
import { PersonalCommandCoordinatorService } from '../personal-progress/personal-command-coordinator.service';
import { PersonalProgressService } from '../personal-progress/personal-progress.service';
import {
  personalProjectData,
  personalProjectKind,
  PersonalOwnerKind,
  PersonalCommandResult,
} from '../personal-progress/personal-progress.model';
import {
  failedResult,
  persistedResult,
  rejectedResult,
} from '../personal-progress/personal-progress-result';
import {
  personalBoardPosition,
  selectPersonalProgressProjects,
  selectPersonalRoutineProjects,
} from '../personal-progress/personal-progress.view';
import { buildPersonalOverview, overviewPosition } from './personal-overview.view';

export interface ReorderOverviewInput {
  operationId: string;
  scope?: 'overview' | 'board';
  ownerKind?: PersonalOwnerKind;
  projectId: string;
  targetId: string;
  after: boolean;
  expectedRevision: number;
}

@Injectable({ providedIn: 'root' })
export class PersonalOverviewOrderService {
  private readonly _coordinator = inject(PersonalCommandCoordinatorService);
  private readonly _progress = inject(PersonalProgressService);

  reorder(
    input: ReorderOverviewInput,
  ): Promise<PersonalCommandResult<{ projectId: string }>> {
    return this._coordinator.enqueue(() => this._reorder(input));
  }

  private async _reorder(
    input: ReorderOverviewInput,
  ): Promise<PersonalCommandResult<{ projectId: string }>> {
    if (
      !Number.isInteger(input.expectedRevision) ||
      input.expectedRevision < 0 ||
      input.projectId === input.targetId
    ) {
      return rejectedResult(input.operationId, 'INVALID_INPUT');
    }
    const key = input.scope === 'board' ? 'boardOrder' : 'overviewOrder';
    const positionFn = input.scope === 'board' ? personalBoardPosition : overviewPosition;
    const projects = await this._progress.getProjects();
    const project = projects.find((item) => item.id === input.projectId);
    const previous = project?.personalProgress?.[key];
    if (!project) return rejectedResult(input.operationId, 'NOT_FOUND');
    if (previous?.operationId === input.operationId)
      return persistedResult(input.operationId, { projectId: project.id });
    if ((previous?.revision ?? 0) !== input.expectedRevision)
      return rejectedResult(input.operationId, 'STALE_REVISION');
    const group =
      input.scope === 'board'
        ? {
            rows: (input.ownerKind === 'routine'
              ? selectPersonalRoutineProjects(projects)
              : selectPersonalProgressProjects(projects)
            ).map((boardProject) => ({ project: boardProject })),
          }
        : buildPersonalOverview(projects, []).groups.find((item) =>
            item.rows.some((row) => row.project.id === input.projectId),
          );
    if (
      input.scope === 'board' &&
      personalProjectKind(project) !== (input.ownerKind ?? 'project')
    )
      return rejectedResult(input.operationId, 'TYPE_CONFLICT');
    if (!group || !group.rows.some((row) => row.project.id === input.targetId))
      return rejectedResult(input.operationId, 'PROJECT_UNAVAILABLE');
    const remaining = group.rows.filter((row) => row.project.id !== input.projectId);
    const targetIndex = remaining.findIndex((row) => row.project.id === input.targetId);
    const insertionIndex = targetIndex + (input.after ? 1 : 0);
    const indices = new Map(projects.map((item, index) => [item.id, index]));
    const positionOf = (index: number): number | null => {
      const row = remaining[index];
      return row ? positionFn(row.project, indices.get(row.project.id) ?? 0) : null;
    };
    const before = positionOf(insertionIndex - 1);
    const after = positionOf(insertionIndex);
    const gapHalf = before !== null && after !== null ? (after - before) / 2 : 0;
    const position =
      before === null
        ? (after ?? 0) - 1024
        : after === null
          ? before + 1024
          : before + gapHalf;
    if (
      !Number.isFinite(position) ||
      (before !== null && position <= before) ||
      (after !== null && position >= after)
    )
      return rejectedResult(input.operationId, 'INVALID_INPUT');
    // Freeze unchanged legacy positions before moving one item. Otherwise deleting
    // an unrelated earlier project would shift implicit indices around saved ranks.
    // Each write is independent and preserves the current visible order; a partial
    // initialization on failure therefore cannot rearrange projects.
    for (const row of remaining) {
      if (row.project.personalProgress?.[key]) continue;
      const initId = `pp-order-init-${nanoid()}`;
      const originalPosition = positionFn(row.project, indices.get(row.project.id) ?? 0);
      try {
        const latest = (await this._progress.getProjects()).find(
          (item) => item.id === row.project.id,
        );
        if (!latest || latest.personalProgress?.[key])
          return rejectedResult(input.operationId, 'STALE_REVISION');
        await this._coordinator.dispatchWithReceipt(
          updateProject({
            project: {
              id: latest.id,
              changes: {
                personalProgress: {
                  ...personalProjectData(latest),
                  [key]: {
                    position: originalPosition,
                    revision: 1,
                    operationId: initId,
                  },
                },
              },
            },
            isSkipSnack: true,
          }),
          initId,
        );
      } catch (error) {
        try {
          const latest = (await this._progress.getProjects()).find(
            (item) => item.id === row.project.id,
          );
          if (latest?.personalProgress?.[key]?.operationId === initId) {
            const restored = { ...personalProjectData(latest) };
            delete restored[key];
            await this._coordinator.dispatchWithReceipt(
              updateProject({
                project: { id: latest.id, changes: { personalProgress: restored } },
                isSkipSnack: true,
              }),
              `pp-recover-${nanoid()}`,
            );
          }
        } catch {}
        return failedResult(input.operationId, error);
      }
    }
    const data = personalProjectData(project);
    try {
      await this._coordinator.dispatchWithReceipt(
        updateProject({
          project: {
            id: project.id,
            changes: {
              personalProgress: {
                ...data,
                [key]: {
                  position,
                  revision: (previous?.revision ?? 0) + 1,
                  operationId: input.operationId,
                },
              },
            },
          },
          isSkipSnack: true,
        }),
        input.operationId,
      );
    } catch (error) {
      try {
        const latest = (await this._progress.getProjects()).find(
          (item) => item.id === project.id,
        );
        if (latest?.personalProgress?.[key]?.operationId === input.operationId) {
          const restored = { ...personalProjectData(latest) };
          if (previous) restored[key] = previous;
          else delete restored[key];
          await this._coordinator.dispatchWithReceipt(
            updateProject({
              project: { id: project.id, changes: { personalProgress: restored } },
              isSkipSnack: true,
            }),
            `pp-recover-${nanoid()}`,
          );
        }
      } catch {}
      return failedResult(input.operationId, error);
    }
    return persistedResult(input.operationId, { projectId: project.id });
  }
}
