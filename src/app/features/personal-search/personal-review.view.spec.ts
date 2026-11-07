import { Project } from '../project/project.model';
import { Task } from '../tasks/task.model';
import {
  personalProjectData,
  personalTaskData,
} from '../personal-progress/personal-progress.model';
import { buildPersonalReview } from './personal-review.view';

const project = (id: string, title: string, overrides: Partial<Project> = {}): Project =>
  ({
    id,
    title,
    isArchived: false,
    isDone: false,
    taskIds: [],
    backlogTaskIds: [],
    noteIds: [],
    ...overrides,
  }) as Project;

const task = (
  id: string,
  projectId: string,
  title: string,
  overrides: Partial<Task> = {},
): Task =>
  ({
    id,
    projectId,
    title,
    isDone: false,
    subTaskIds: [],
    tagIds: [],
    ...overrides,
  }) as Task;

const withEntries = <T extends Project | Task>(
  entity: T,
  entries: {
    id: string;
    projectId: string;
    recordDay: string;
    body: string;
    source: 'manual' | 'step-completion';
  }[],
): T => {
  const data =
    'projectId' in entity ? personalTaskData(entity) : personalProjectData(entity);
  return {
    ...entity,
    personalProgress: {
      ...(entity as Project).personalProgress,
      ...data,
      entries: [
        ...data.entries,
        ...entries.map((entry) => ({
          ...entry,
          createdAt: 1,
          updatedAt: 1,
          revision: 1,
          operationId: `op-${entry.id}`,
        })),
      ],
    },
  } as T;
};

describe('personal review projection', () => {
  const today = '2026-11-05';
  const p1 = withEntries(
    project('p1', '做义工', {
      personalProgress: {
        schemaVersion: 1,
        entries: [],
        planning: { day: '2026-11-01', revision: 1, operationId: 'plan-1' },
      },
    }),
    [
      {
        id: 'e1',
        projectId: 'p1',
        recordDay: '2026-11-04',
        body: '联系了社区',
        source: 'manual',
      },
      {
        id: 'e0',
        projectId: 'p1',
        recordDay: '2026-10-20',
        body: '不应进入本周',
        source: 'manual',
      },
    ],
  );
  const p2 = withEntries(
    project('p2', '每周拉伸', {
      personalProgress: { schemaVersion: 1, entries: [], kind: 'routine' },
    }),
    [
      {
        id: 'e2',
        projectId: 'p2',
        recordDay: '2026-11-02',
        body: '完成一组',
        source: 'manual',
      },
    ],
  );
  const t1 = withEntries(task('t1', 'p1', '去南区篮球场', { isDone: true }), [
    {
      id: 'e3',
      projectId: 'p1',
      recordDay: '2026-11-03',
      body: '去南区篮球场',
      source: 'step-completion',
    },
  ]);
  const t2 = task('t2', 'p1', '联系社区');

  it('builds a Monday-based week range with today as the data end', () => {
    const review = buildPersonalReview([p1, p2], [t1, t2], today, 'week');
    expect(review.range.startDay).toBe('2026-11-02');
    expect(review.range.periodEndDay).toBe('2026-11-08');
    expect(review.range.dataEndDay).toBe(today);
  });

  it('counts completions, manual records and active projects', () => {
    const review = buildPersonalReview([p1, p2], [t1, t2], today, 'week');
    expect(review.completions.length).toBe(1);
    expect(review.completions[0].title).toBe('去南区篮球场');
    expect(review.activeProjects.map((item) => item.projectId)).toContain('p1');
    expect(
      review.activeProjects.find((item) => item.projectId === 'p2')?.isRoutine,
    ).toBeTrue();
    expect(review.dayCounts.map((item) => item.day)).toEqual([
      '2026-11-04',
      '2026-11-02',
    ]);
  });

  it('excludes entries outside the period', () => {
    const review = buildPersonalReview([p1], [t1, t2], today, 'week');
    expect(review.activeProjects[0].recordCount).toBe(1);
    expect(review.completions.length).toBe(1);
  });

  it('lists past-plan projects that still have remaining steps', () => {
    const review = buildPersonalReview([p1, p2], [t1, t2], today, 'week');
    expect(review.staleProjects.map((item) => item.projectId)).toEqual(['p1']);
    expect(review.staleProjects[0].remainingSteps).toBe(1);
    expect(review.staleProjects[0].plannedDay).toBe('2026-11-01');
  });

  it('does not list a project with a future plan as stale', () => {
    const future = project('p3', '未来项目', {
      personalProgress: {
        schemaVersion: 1,
        entries: [],
        planning: { day: '2026-11-20', revision: 1, operationId: 'plan-3' },
      },
    });
    const futureTask = task('t3', 'p3', '未完成步骤');
    const review = buildPersonalReview([future], [futureTask], today, 'week');
    expect(review.staleProjects).toEqual([]);
  });

  it('returns a clean empty review', () => {
    const review = buildPersonalReview([], [], today, 'month');
    expect(review.completions).toEqual([]);
    expect(review.activeProjects).toEqual([]);
    expect(review.staleProjects).toEqual([]);
    expect(review.dayCounts).toEqual([]);
  });
});
