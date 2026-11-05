import { Project } from '../project/project.model';
import { INBOX_PROJECT } from '../project/project.const';
import { Task } from '../tasks/task.model';
import { latestProjectCompletion } from './personal-completion-order';
import {
  PersonalProgressEntry,
  personalProjectData,
  comparePersonalEntries,
  personalProjectKind,
  personalRoman,
  personalTaskData,
} from './personal-progress.model';

export interface PersonalProgressStepView {
  task: Task;
  /** Position among the remaining (undone) steps, zero-based. */
  index: number;
  roman: string;
}

export interface PersonalProgressDayCell {
  recordDay: string;
  entries: PersonalProgressEntry[];
}

export interface PersonalProgressProjectRow {
  project: Project;
  isExpanded: boolean;
  steps: PersonalProgressStepView[];
  manualEntries: PersonalProgressEntry[];
  completionEntries: PersonalProgressEntry[];
  completionByEntryId: Map<string, { completionId: string; isUndoable: boolean }>;
  entriesByDay: Map<string, PersonalProgressEntry[]>;
}

export interface PersonalProgressView {
  today: string;
  dates: string[];
  rows: PersonalProgressProjectRow[];
}

const dayParts = (day: string): { year: string; month: string; date: string } => {
  const [year = '', month = '', date = ''] = day.split('-');
  return { year, month, date };
};

/** Header label: same-year dates use M.D; other years keep YYYY.M.D. */
export const personalProgressDayLabel = (day: string, today: string): string => {
  const value = dayParts(day);
  const current = dayParts(today);
  const monthDay = `${Number(value.month)}.${Number(value.date)}`;
  return value.year === current.year ? monthDay : `${value.year}.${monthDay}`;
};

/** Accessible name keeps the full year so two same-month/day years differ. */
export const personalProgressDayAria = (day: string): string => {
  const value = dayParts(day);
  return `${value.year}年${Number(value.month)}月${Number(value.date)}日`;
};

/** The same non-archived, non-inbox, real-project set and order for both pages. */
export const selectPersonalProgressProjects = (projects: readonly Project[]): Project[] =>
  sortPersonalBoardProjects(
    projects.filter(
      (p) =>
        !p.isArchived &&
        p.id !== INBOX_PROJECT.id &&
        personalProjectKind(p) === 'project',
    ),
    projects,
  );

/** Routine items are a separate collection and never enter progress/overview. */
export const selectPersonalRoutineProjects = (projects: readonly Project[]): Project[] =>
  sortPersonalBoardProjects(
    projects.filter(
      (p) =>
        !p.isArchived &&
        p.id !== INBOX_PROJECT.id &&
        personalProjectKind(p) === 'routine',
    ),
    projects,
  );

export const buildPersonalProgressTaskMap = (
  tasks: readonly Task[],
  archivedTasks: readonly Task[] = [],
): Map<string, Task> => {
  const byId = new Map<string, Task>();
  for (const task of tasks) byId.set(task.id, task);
  for (const task of archivedTasks) {
    if (!byId.has(task.id)) byId.set(task.id, task);
  }
  return byId;
};

/** Per-project history from the same loaded task map for active and archive views. */
export const collectPersonalProjectEntries = (
  project: Project,
  byId: ReadonlyMap<string, Task>,
): { entry: PersonalProgressEntry; task: Task | null }[] => [
  ...personalProjectData(project).entries.map((entry) => ({ entry, task: null })),
  ...[...byId.values()]
    .filter((task) => task.projectId === project.id)
    .flatMap((task) => personalTaskData(task).entries.map((entry) => ({ entry, task }))),
];

/**
 * Remaining steps in exactly the progress page order. Callers must pass the
 * loaded active tasks (and may include archived tasks); archived tasks are done
 * and therefore cannot reappear as remaining steps.
 */
export const buildRemainingSteps = (
  project: Project,
  byId: ReadonlyMap<string, Task>,
): PersonalProgressStepView[] => {
  const ordered: Task[] = [];
  const seen = new Set<string>();
  for (const id of project.taskIds) {
    const task = byId.get(id);
    if (task && task.projectId === project.id && !task.parentId) {
      ordered.push(task);
      seen.add(task.id);
    }
  }
  for (const task of byId.values()) {
    if (
      task.projectId === project.id &&
      !task.parentId &&
      !seen.has(task.id) &&
      !task.isDone
    ) {
      ordered.push(task);
      seen.add(task.id);
    }
  }
  return ordered
    .filter((task) => !task.isDone)
    .map((task, index) => ({ task, index, roman: personalRoman(index) }));
};

/**
 * Pure projection for the page. Kept free of services so it is unit-testable:
 * the caller supplies the already-loaded active tasks, archived tasks and the
 * logical today string.
 */
export const buildPersonalProgressView = (
  projects: readonly Project[],
  tasks: readonly Task[],
  archivedTasks: readonly Task[],
  today: string,
  collapsedProjectIds: ReadonlySet<string> = new Set(),
): PersonalProgressView => {
  const byId = buildPersonalProgressTaskMap(tasks, archivedTasks);
  const activeProjects = selectPersonalProgressProjects(projects);
  const dates = new Set<string>([today]);

  const rows: PersonalProgressProjectRow[] = activeProjects.map((project) => {
    const isExpanded = !collapsedProjectIds.has(project.id);
    const steps = buildRemainingSteps(project, byId);

    const manualEntries = personalProjectData(project).entries;
    // Archived done tasks are no longer present in project.taskIds, but their
    // actual-work records must stay visible. They do not re-enter remaining steps.
    const activeProjectTasks = tasks.filter(
      (task) => task.projectId === project.id && !task.parentId,
    );
    const completionByEntryId = new Map<
      string,
      { completionId: string; isUndoable: boolean }
    >();
    const latestCompletionId = latestProjectCompletion([...byId.values()], project.id)
      ?.completion.id;
    for (const task of activeProjectTasks) {
      const data = personalTaskData(task);
      for (const completion of data.completions) {
        if (completion.undoneAt) continue;
        const entry = data.entries.find((e) => e.id === completion.entryId);
        completionByEntryId.set(completion.entryId, {
          completionId: completion.id,
          isUndoable:
            task.isDone &&
            completion.id === latestCompletionId &&
            !!entry &&
            entry.revision === completion.entryRevisionAtCompletion,
        });
      }
    }
    const completionEntries = collectPersonalProjectEntries(project, byId)
      .filter(({ entry, task }) => task !== null && entry.source === 'step-completion')
      .map(({ entry }) => entry);

    const allEntries = [...manualEntries, ...completionEntries];
    const entriesByDay = new Map<string, PersonalProgressEntry[]>();
    for (const entry of allEntries) {
      if (entry.recordDay > today) continue;
      if (isExpanded) dates.add(entry.recordDay);
      const list = entriesByDay.get(entry.recordDay) ?? [];
      list.push(entry);
      entriesByDay.set(entry.recordDay, list);
    }
    for (const list of entriesByDay.values()) {
      list.sort((a, b) => comparePersonalEntries(project, a, b));
    }

    return {
      project,
      isExpanded,
      steps,
      manualEntries,
      completionEntries,
      completionByEntryId,
      entriesByDay,
    };
  });

  return {
    today,
    dates: [...dates].sort(),
    rows,
  };
};

/** Explicit positions preserve legacy project-list order until the first move. */
export const personalBoardPosition = (project: Project, index: number): number => {
  const rank = project.personalProgress?.boardOrder?.position;
  return typeof rank === 'number' && Number.isFinite(rank) ? rank : index * 1024;
};
export const sortPersonalBoardProjects = (
  items: Project[],
  all: readonly Project[],
): Project[] => {
  const indices = new Map(all.map((project, index) => [project.id, index]));
  return items.sort(
    (a, b) =>
      personalBoardPosition(a, indices.get(a.id) ?? 0) -
        personalBoardPosition(b, indices.get(b.id) ?? 0) ||
      (indices.get(a.id) ?? 0) - (indices.get(b.id) ?? 0),
  );
};
