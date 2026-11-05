import { Project } from '../project/project.model';
import {
  PersonalProgressEntry,
  comparePersonalEntries,
  PersonalRecordDay,
  isPersonalRecordDay,
} from '../personal-progress/personal-progress.model';
import { Task } from '../tasks/task.model';
import {
  collectPersonalProjectEntries,
  buildPersonalProgressTaskMap,
  selectPersonalRoutineProjects,
} from '../personal-progress/personal-progress.view';
import {
  PersonalRoutineRange,
  PersonalRoutineRangeBounds,
  buildRoutineRange,
  compareRecordDays,
  isRecordDayInRange,
} from './personal-routine.date';

export interface PersonalRoutineItemRow {
  project: Project;
  entriesByDay: Map<PersonalRecordDay, PersonalProgressEntry[]>;
  /** All valid populated entries, newest day first for the lookup panel. */
  entries: PersonalProgressEntry[];
}

export interface PersonalRoutineView {
  today: PersonalRecordDay;
  bounds: PersonalRoutineRangeBounds;
  /** In-range record day union + today, ascending. */
  dates: PersonalRecordDay[];
  rows: PersonalRoutineItemRow[];
}

export const buildPersonalRoutineView = (
  projects: readonly Project[],
  today: PersonalRecordDay,
  range: PersonalRoutineRange,
  tasks: readonly Task[] = [],
  archivedTasks: readonly Task[] = [],
): PersonalRoutineView => {
  const bounds = buildRoutineRange(today, range);
  const dates = new Set<PersonalRecordDay>([today]);
  const rows = selectPersonalRoutineProjects(projects).map((project) => {
    const entries = collectPersonalProjectEntries(
      project,
      buildPersonalProgressTaskMap(tasks, archivedTasks),
    )
      .map(({ entry }) => entry)
      .filter((entry) => isPersonalRecordDay(entry.recordDay))
      .sort(
        (a, b) =>
          compareRecordDays(a.recordDay, b.recordDay) ||
          comparePersonalEntries(project, a, b),
      );
    for (const entry of entries) {
      if (isRecordDayInRange(entry.recordDay, bounds)) dates.add(entry.recordDay);
    }
    const entriesByDay = new Map<PersonalRecordDay, PersonalProgressEntry[]>();
    for (const entry of entries) {
      const dayEntries = entriesByDay.get(entry.recordDay) ?? [];
      dayEntries.push(entry);
      entriesByDay.set(entry.recordDay, dayEntries);
    }
    return { project, entriesByDay, entries };
  });
  return {
    today,
    bounds,
    dates: [...dates].sort(compareRecordDays),
    rows,
  };
};
