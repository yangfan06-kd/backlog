import { Project } from '../project/project.model';
import { Task } from '../tasks/task.model';
import {
  PersonalProgressEntry,
  personalProjectData,
  personalProjectKind,
  personalTaskData,
} from '../personal-progress/personal-progress.model';

export type PersonalReviewPeriod = 'week' | 'month';

export interface PersonalReviewCompletion {
  projectId: string;
  projectTitle: string;
  title: string;
  day: string;
}

export interface PersonalReviewActiveProject {
  projectId: string;
  title: string;
  isRoutine: boolean;
  completionCount: number;
  recordCount: number;
  lastDay: string;
}

export interface PersonalReviewStaleProject {
  projectId: string;
  title: string;
  plannedDay: string;
  remainingSteps: number;
  lastActivityDay: string | null;
}

export interface PersonalReviewDayCount {
  day: string;
  count: number;
}

export interface PersonalReviewRange {
  startDay: string;
  /** Data is counted only through today. */
  dataEndDay: string;
  /** Full calendar period end, used for the displayed range. */
  periodEndDay: string;
}

export interface PersonalReview {
  range: PersonalReviewRange;
  completions: PersonalReviewCompletion[];
  activeProjects: PersonalReviewActiveProject[];
  staleProjects: PersonalReviewStaleProject[];
  dayCounts: PersonalReviewDayCount[];
}

const pad = (value: number): string => String(value).padStart(2, '0');

const toDay = (date: Date): string =>
  `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;

const fromDay = (day: string): Date => {
  const [year, month, date] = day.split('-').map(Number);
  return new Date(year, month - 1, date);
};

const addDays = (day: string, amount: number): string => {
  const date = fromDay(day);
  date.setDate(date.getDate() + amount);
  return toDay(date);
};

const startOfWeek = (day: string): string => {
  const date = fromDay(day);
  const offset = (date.getDay() + 6) % 7;
  date.setDate(date.getDate() - offset);
  return toDay(date);
};

const endOfWeek = (day: string): string => addDays(startOfWeek(day), 6);

const startOfMonth = (day: string): string => {
  const date = fromDay(day);
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-01`;
};

const endOfMonth = (day: string): string => {
  const date = fromDay(day);
  return toDay(new Date(date.getFullYear(), date.getMonth() + 1, 0));
};

const inRange = (day: string, range: PersonalReviewRange): boolean =>
  day >= range.startDay && day <= range.dataEndDay;

const isDeleted = (project: Project): boolean =>
  !!project.personalProgress?.trash?.deletedAt;

const isAvailableProject = (project: Project): boolean =>
  !project.isArchived && !project.isDone && !isDeleted(project);

const remainingSteps = (project: Project, tasks: Task[]): number =>
  tasks.filter((task) => task.projectId === project.id && !task.isDone && !task.parentId)
    .length;

const latestEntryDay = (entries: PersonalProgressEntry[]): string | null =>
  entries.reduce<string | null>(
    (latest, entry) =>
      latest === null || entry.recordDay > latest ? entry.recordDay : latest,
    null,
  );

export const buildPersonalReview = (
  projects: Project[],
  tasks: Task[],
  today: string,
  period: PersonalReviewPeriod,
): PersonalReview => {
  const range: PersonalReviewRange =
    period === 'week'
      ? {
          startDay: startOfWeek(today),
          dataEndDay: today,
          periodEndDay: endOfWeek(today),
        }
      : {
          startDay: startOfMonth(today),
          dataEndDay: today,
          periodEndDay: endOfMonth(today),
        };

  const projectsById = new Map(projects.map((project) => [project.id, project]));
  const completions: PersonalReviewCompletion[] = [];
  const activity = new Map<
    string,
    {
      completionCount: number;
      recordCount: number;
      lastDay: string;
    }
  >();
  const dayCounts = new Map<string, number>();

  const trackActivity = (
    projectId: string,
    entry: PersonalProgressEntry,
    kind: 'completion' | 'record',
  ): void => {
    const project = projectsById.get(projectId);
    if (!project || !isAvailableProject(project)) return;
    const current = activity.get(projectId) ?? {
      completionCount: 0,
      recordCount: 0,
      lastDay: entry.recordDay,
    };
    current[kind === 'completion' ? 'completionCount' : 'recordCount'] += 1;
    if (entry.recordDay > current.lastDay) current.lastDay = entry.recordDay;
    activity.set(projectId, current);
    if (kind === 'record') {
      dayCounts.set(entry.recordDay, (dayCounts.get(entry.recordDay) ?? 0) + 1);
    }
  };

  for (const project of projects) {
    if (!isAvailableProject(project)) continue;
    for (const entry of personalProjectData(project).entries) {
      if (!inRange(entry.recordDay, range)) continue;
      if (entry.source === 'manual') {
        trackActivity(project.id, entry, 'record');
      }
    }
  }

  for (const task of tasks) {
    if (task.parentId) continue;
    const project = projectsById.get(task.projectId);
    if (!project || !isAvailableProject(project)) continue;
    for (const entry of personalTaskData(task).entries) {
      if (!inRange(entry.recordDay, range)) continue;
      if (entry.source === 'step-completion') {
        completions.push({
          projectId: project.id,
          projectTitle: project.title,
          title: entry.body,
          day: entry.recordDay,
        });
        trackActivity(project.id, entry, 'completion');
      }
    }
  }

  const activeProjects = [...activity.entries()]
    .map(([projectId, counts]) => {
      const project = projectsById.get(projectId);
      return {
        projectId,
        title: project?.title ?? '',
        isRoutine: personalProjectKind(project) === 'routine',
        completionCount: counts.completionCount,
        recordCount: counts.recordCount,
        lastDay: counts.lastDay,
      };
    })
    .filter((project) => project.title)
    .sort((a, b) => {
      const activityDiff =
        b.completionCount + b.recordCount - (a.completionCount + a.recordCount);
      return (
        activityDiff ||
        b.lastDay.localeCompare(a.lastDay) ||
        a.title.localeCompare(b.title)
      );
    });

  const staleProjects = projects
    .filter((project) => {
      if (!isAvailableProject(project)) return false;
      if (personalProjectKind(project) !== 'project') return false;
      const plannedDay = project.personalProgress?.planning?.day;
      if (!plannedDay || plannedDay >= today) return false;
      return remainingSteps(project, tasks) > 0;
    })
    .map((project) => {
      const projectEntries = personalProjectData(project).entries;
      const taskEntries = tasks
        .filter((task) => task.projectId === project.id)
        .flatMap((task) => personalTaskData(task).entries);
      return {
        projectId: project.id,
        title: project.title,
        plannedDay: project.personalProgress?.planning?.day ?? '',
        remainingSteps: remainingSteps(project, tasks),
        lastActivityDay: latestEntryDay([...projectEntries, ...taskEntries]),
      };
    })
    .sort(
      (a, b) =>
        a.plannedDay.localeCompare(b.plannedDay) || a.title.localeCompare(b.title),
    );

  completions.sort(
    (a, b) => b.day.localeCompare(a.day) || a.projectTitle.localeCompare(b.projectTitle),
  );

  return {
    range,
    completions,
    activeProjects,
    staleProjects,
    dayCounts: [...dayCounts.entries()]
      .map(([day, count]) => ({ day, count }))
      .sort((a, b) => b.day.localeCompare(a.day)),
  };
};

export const formatReviewDay = (day: string): string => {
  const [, month, date] = day.split('-').map(Number);
  return `${month}月${date}日`;
};

export const formatReviewRange = (range: PersonalReviewRange): string => {
  const start = formatReviewDay(range.startDay);
  const end = formatReviewDay(range.periodEndDay);
  return range.dataEndDay === range.periodEndDay
    ? `${start} — ${end}`
    : `${start} — ${end} · 截至今天`;
};
