import { DEFAULT_PROJECT } from '../project/project.const';
import { Project } from '../project/project.model';
import {
  PERSONAL_PROGRESS_SCHEMA_VERSION,
  PersonalOwnerKind,
} from './personal-progress.model';

/** Called after command validation; no clocks or persistence inside the factory. */
export const createPersonalProject = (
  operationId: string,
  title: string,
  kind: PersonalOwnerKind,
  plannedDay: string | null,
  now: number,
): Project => ({
  ...DEFAULT_PROJECT,
  id: `pp-project-${operationId}`,
  title,
  taskIds: [],
  backlogTaskIds: [],
  noteIds: [],
  isHiddenFromMenu: kind === 'routine' ? true : DEFAULT_PROJECT.isHiddenFromMenu,
  personalProgress:
    kind === 'routine'
      ? {
          schemaVersion: PERSONAL_PROGRESS_SCHEMA_VERSION,
          entries: [],
          kind: 'routine',
          createdAt: now,
        }
      : plannedDay
        ? {
            schemaVersion: PERSONAL_PROGRESS_SCHEMA_VERSION,
            entries: [],
            planning: { day: plannedDay, revision: 1, operationId },
          }
        : undefined,
});
