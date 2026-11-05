import { Project } from '../project/project.model';
import { INBOX_PROJECT, DEFAULT_PROJECT } from '../project/project.const';
import { PersonalProgressOnProject } from '../personal-progress/personal-progress.model';
import { Task } from '../tasks/task.model';
import {
  PERSONAL_OVERVIEW_GROUPS,
  buildPersonalOverview,
} from './personal-overview.view';
import { buildPersonalProgressView } from '../personal-progress/personal-progress.view';

const makeTask = (
  id: string,
  projectId: string,
  title: string,
  extra: Partial<Task> = {},
): Task =>
  ({
    id,
    projectId,
    title,
    isDone: false,
    tagIds: [],
    subTaskIds: [],
    parentId: undefined,
    timeEstimate: 0,
    timeSpent: 0,
    timeSpentOnDay: {},
    created: 1,
    attachments: [],
    ...extra,
  }) as Task;

const makeProject = (
  id: string,
  title: string,
  taskIds: string[] = [],
  quadrant?: {
    value: 'urgent-important' | 'important' | 'urgent' | 'neither' | null | string;
    revision: number;
  },
  isArchived = false,
): Project => ({
  ...DEFAULT_PROJECT,
  id,
  title,
  taskIds,
  backlogTaskIds: [],
  noteIds: [],
  isArchived,
  ...(quadrant
    ? {
        personalProgress: {
          schemaVersion: 1,
          entries: [],
          quadrant: {
            ...quadrant,
            operationId: 'q',
          },
        } as unknown as PersonalProgressOnProject,
      }
    : {}),
});

describe('buildPersonalOverview', () => {
  it('puts every visible project exactly once in fixed groups and keeps empty groups', () => {
    const projects: Project[] = [
      makeProject('A', 'Alpha', ['a1'], { value: 'urgent-important', revision: 1 }),
      makeProject('B', 'Beta', ['b1']),
      makeProject('C', 'Gamma', ['c1'], { value: 'neither', revision: 1 }),
      makeProject(INBOX_PROJECT.id, 'Inbox', []),
      makeProject('Archived', 'Archived', [], undefined, true),
    ];
    const tasks = [
      makeTask('a1', 'A', 'A step'),
      makeTask('b1', 'B', 'B step'),
      makeTask('c1', 'C', 'C step'),
    ];

    const view = buildPersonalOverview(projects, tasks);

    expect(view.projectCount).toBe(3);
    expect(view.groups.map((g) => g.id)).toEqual(
      PERSONAL_OVERVIEW_GROUPS.map((g) => g.id),
    );
    expect(view.groups[0].rows.map((r) => r.project.id)).toEqual(['A']);
    expect(view.groups[1].rows).toEqual([]);
    expect(view.groups[2].rows).toEqual([]);
    expect(view.groups[3].rows.map((r) => r.project.id)).toEqual(['C']);
    expect(view.groups[4].rows.map((r) => r.project.id)).toEqual(['B']);
  });

  it('treats missing and invalid quadrant values as unclassified', () => {
    const view = buildPersonalOverview(
      [
        makeProject('Missing', 'Missing'),
        makeProject('Invalid', 'Invalid', [], {
          value: 'not-a-quadrant',
          revision: 4,
        }),
      ],
      [],
    );
    expect(view.groups[4].rows.map((r) => r.project.id)).toEqual(['Missing', 'Invalid']);
  });

  it('uses the same remaining-step order and filtering as the progress projection', () => {
    const tasks = [
      makeTask('a2', 'A', 'Two'),
      makeTask('sub', 'A', 'Sub', { parentId: 'a1' }),
      makeTask('a1', 'A', 'One'),
      makeTask('done', 'A', 'Done', { isDone: true }),
      makeTask('b1', 'B', 'Other'),
    ];
    const projects = [
      makeProject('A', 'Alpha', ['a1', 'done', 'a2', 'sub']),
      makeProject('B', 'Beta', ['b1']),
    ];

    const overview = buildPersonalOverview(projects, tasks);
    const progress = buildPersonalProgressView(projects, tasks, [], '2026-10-25');
    const overviewA = overview.groups[4].rows.find((r) => r.project.id === 'A')!;
    const progressA = progress.rows.find((r) => r.project.id === 'A')!;
    expect(overviewA.steps.map((s) => s.task.id)).toEqual(
      progressA.steps.map((s) => s.task.id),
    );
    expect(overviewA.steps.map((s) => s.roman)).toEqual(['Ⅰ', 'Ⅱ']);
  });

  it('keeps a project with no remaining steps', () => {
    const view = buildPersonalOverview(
      [makeProject('Empty', 'Empty', ['done'])],
      [makeTask('done', 'Empty', 'Done', { isDone: true })],
    );
    const row = view.groups[4].rows[0];
    expect(row.project.id).toBe('Empty');
    expect(row.steps).toEqual([]);
  });
});
