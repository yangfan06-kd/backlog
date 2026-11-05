import { Project } from '../project/project.model';
import { Task } from '../tasks/task.model';
import {
  PersonalProjectQuadrant,
  isPersonalProjectQuadrant,
  personalProjectQuadrant,
  isPersonalRecordDay,
} from '../personal-progress/personal-progress.model';

export type PersonalPlanFilter = 'all' | 'today' | 'future' | 'unplanned' | 'overdue';

/** Date filters are projections only. They never reschedule or complete work. */
export const matchesPersonalPlan = (
  project: Project,
  filter: PersonalPlanFilter,
  today: string,
): boolean => {
  const raw = project.personalProgress?.planning?.day;
  const day = isPersonalRecordDay(raw) ? raw : null;
  switch (filter) {
    case 'today':
      return day === today;
    case 'future':
      return day !== null && day > today;
    case 'unplanned':
      return day === null;
    case 'overdue':
      return day !== null && day < today;
    default:
      return true;
  }
};
import {
  PersonalProgressStepView,
  buildPersonalProgressTaskMap,
  buildRemainingSteps,
  selectPersonalProgressProjects,
} from '../personal-progress/personal-progress.view';

export type PersonalOverviewGroupId = PersonalProjectQuadrant | 'unclassified';

export interface PersonalOverviewGroupMeta {
  id: PersonalOverviewGroupId;
  labelKey: string;
}

/** Fixed visual order; unclassified is deliberately not a fifth quadrant. */
export const PERSONAL_OVERVIEW_GROUPS: readonly PersonalOverviewGroupMeta[] = [
  {
    id: 'urgent-important',
    labelKey: 'PERSONAL_OVERVIEW.QUADRANTS.URGENT_IMPORTANT',
  },
  {
    id: 'important',
    labelKey: 'PERSONAL_OVERVIEW.QUADRANTS.IMPORTANT',
  },
  {
    id: 'urgent',
    labelKey: 'PERSONAL_OVERVIEW.QUADRANTS.URGENT',
  },
  {
    id: 'neither',
    labelKey: 'PERSONAL_OVERVIEW.QUADRANTS.NEITHER',
  },
  {
    id: 'unclassified',
    labelKey: 'PERSONAL_OVERVIEW.UNCLASSIFIED',
  },
];

export interface PersonalOverviewProjectRow {
  project: Project;
  steps: PersonalProgressStepView[];
  groupId: PersonalOverviewGroupId;
  /** The saved value; null/absent means unclassified. */
  quadrant: PersonalProjectQuadrant | null;
  revision: number;
}

export interface PersonalOverviewGroup {
  id: PersonalOverviewGroupId;
  labelKey: string;
  rows: PersonalOverviewProjectRow[];
}

export interface PersonalOverviewView {
  groups: PersonalOverviewGroup[];
  projectCount: number;
}

/**
 * Pure project-level overview. It reuses the progress project filter and
 * remaining-step order; it intentionally does not load TaskArchive because an
 * archived task cannot be a remaining step.
 */
export const buildPersonalOverview = (
  projects: readonly Project[],
  tasks: readonly Task[],
): PersonalOverviewView => {
  const byId = buildPersonalProgressTaskMap(tasks);
  const indices = new Map(projects.map((project, index) => [project.id, index]));
  const groups = new Map<PersonalOverviewGroupId, PersonalOverviewProjectRow[]>();
  for (const meta of PERSONAL_OVERVIEW_GROUPS) groups.set(meta.id, []);

  for (const project of selectPersonalProgressProjects(projects)) {
    const state = personalProjectQuadrant(project);
    const groupId: PersonalOverviewGroupId =
      state.value && isPersonalProjectQuadrant(state.value)
        ? state.value
        : 'unclassified';
    groups.get(groupId)!.push({
      project,
      steps: buildRemainingSteps(project, byId),
      groupId,
      quadrant: state.value,
      revision: state.revision,
    });
  }

  return {
    groups: PERSONAL_OVERVIEW_GROUPS.map((meta) => ({
      ...meta,
      rows: groups.get(meta.id)!.sort((a, b) => {
        const aIndex = indices.get(a.project.id) ?? 0;
        const bIndex = indices.get(b.project.id) ?? 0;
        return (
          overviewPosition(a.project, aIndex) - overviewPosition(b.project, bIndex) ||
          aIndex - bIndex
        );
      }),
    })),
    projectCount: [...groups.values()].reduce((sum, rows) => sum + rows.length, 0),
  };
};

/** Old projects use their existing project-list position until explicitly moved. */
export const overviewPosition = (project: Project, index: number): number => {
  const position = project.personalProgress?.overviewOrder?.position;
  return typeof position === 'number' && Number.isFinite(position)
    ? position
    : index * 1024;
};
