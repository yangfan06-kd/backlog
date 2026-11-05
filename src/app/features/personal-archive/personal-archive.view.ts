import { Project } from '../project/project.model';
import { INBOX_PROJECT } from '../project/project.const';
import { Task } from '../tasks/task.model';
import {
  PersonalProgressEntry,
  comparePersonalEntries,
  PersonalRecordDay,
  isPersonalRecordDay,
  personalProjectKind,
} from '../personal-progress/personal-progress.model';
import {
  buildPersonalProgressTaskMap,
  buildRemainingSteps,
  collectPersonalProjectEntries,
} from '../personal-progress/personal-progress.view';

export interface PersonalArchiveEntryView {
  entry: PersonalProgressEntry;
  task: Task | null;
}

export interface PersonalArchiveProjectRow {
  project: Project;
  /** Valid positive root doneOn, or null for legacy data without a date. */
  doneOn: number | null;
  isDone: boolean;
  hasKnownDate: boolean;
  remainingSteps: Task[];
  dates: PersonalRecordDay[];
  entries: PersonalArchiveEntryView[];
  entriesByDay: Map<PersonalRecordDay, PersonalArchiveEntryView[]>;
}

export interface PersonalArchiveView {
  rows: PersonalArchiveProjectRow[];
}

const validDoneOn = (doneOn: number | null | undefined): number | null =>
  typeof doneOn === 'number' && Number.isFinite(doneOn) && doneOn > 0 ? doneOn : null;

/** Active tasks win over duplicate archived IDs; young/old merge is strict input. */
export const buildArchiveTaskMap = (
  activeTasks: readonly Task[],
  archivedTasks: readonly Task[],
): Map<string, Task> => {
  const byId = buildPersonalProgressTaskMap(activeTasks, archivedTasks);
  return byId;
};

export const buildPersonalArchiveView = (
  projects: readonly Project[],
  activeTasks: readonly Task[],
  archivedTasks: readonly Task[],
): PersonalArchiveView => {
  const byId = buildArchiveTaskMap(activeTasks, archivedTasks);
  const projectRows = projects
    .filter(
      (project) =>
        project.isArchived &&
        !project.personalProgress?.trash?.deletedAt &&
        project.id !== INBOX_PROJECT.id &&
        personalProjectKind(project) === 'project',
    )
    .map((project) => {
      const entries: PersonalArchiveEntryView[] = [];
      const seenEntryIds = new Set<string>();
      const addEntry = (entry: PersonalProgressEntry, task: Task | null): void => {
        if (!isPersonalRecordDay(entry.recordDay) || seenEntryIds.has(entry.id)) return;
        seenEntryIds.add(entry.id);
        entries.push({ entry, task });
      };
      for (const { entry, task } of collectPersonalProjectEntries(project, byId)) {
        addEntry(entry, task);
      }
      entries.sort(
        (a, b) =>
          a.entry.recordDay.localeCompare(b.entry.recordDay) ||
          comparePersonalEntries(project, a.entry, b.entry),
      );
      const entriesByDay = new Map<PersonalRecordDay, PersonalArchiveEntryView[]>();
      for (const entry of entries) {
        const day = entry.entry.recordDay;
        const list = entriesByDay.get(day) ?? [];
        list.push(entry);
        entriesByDay.set(day, list);
      }
      const remainingSteps = buildRemainingSteps(project, byId).map((step) => step.task);
      const doneOn = validDoneOn(project.doneOn);
      return {
        project,
        doneOn,
        isDone: !!project.isDone,
        hasKnownDate: doneOn !== null,
        remainingSteps,
        dates: [...entriesByDay.keys()].sort(),
        entries,
        entriesByDay,
      };
    });

  projectRows.sort((a, b) => {
    if (a.doneOn !== null && b.doneOn !== null && a.doneOn !== b.doneOn) {
      return b.doneOn - a.doneOn;
    }
    if (a.doneOn !== null && b.doneOn === null) return -1;
    if (a.doneOn === null && b.doneOn !== null) return 1;
    return a.project.id < b.project.id ? -1 : a.project.id > b.project.id ? 1 : 0;
  });
  return { rows: projectRows };
};
