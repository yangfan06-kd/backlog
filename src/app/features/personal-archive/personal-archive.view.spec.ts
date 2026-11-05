import { Project } from '../project/project.model';
import { Task } from '../tasks/task.model';
import { PersonalProgressEntry } from '../personal-progress/personal-progress.model';
import { buildPersonalArchiveView } from './personal-archive.view';

const entry = (
  id: string,
  projectId: string,
  recordDay: string,
  body: string,
  createdAt = 1,
): PersonalProgressEntry => ({
  id,
  projectId,
  recordDay,
  body,
  source: 'manual',
  createdAt,
  updatedAt: createdAt,
  revision: 1,
  operationId: `op-${id}`,
});

const makeProject = (
  id: string,
  extra: Partial<Project> = {},
  entries: PersonalProgressEntry[] = [],
): Project =>
  ({
    id,
    title: id,
    taskIds: [],
    backlogTaskIds: [],
    noteIds: [],
    isArchived: false,
    personalProgress: { schemaVersion: 1, entries },
    ...extra,
  }) as Project;

const makeTask = (id: string, projectId: string, extra: Partial<Task> = {}): Task =>
  ({
    id,
    projectId,
    title: id,
    isDone: false,
    subTaskIds: [],
    tagIds: [],
    timeSpent: 0,
    timeEstimate: 0,
    timeSpentOnDay: {},
    created: 1,
    attachments: [],
    ...extra,
  }) as Task;

describe('personal archive projection', () => {
  it('retains the same remaining top-level steps as progress including unlisted steps', () => {
    const project = makeProject('P', {
      isArchived: true,
      taskIds: ['first', 'child'],
      backlogTaskIds: ['later'],
    });
    const view = buildPersonalArchiveView(
      [project],
      [
        makeTask('first', 'P'),
        makeTask('child', 'P', { parentId: 'first' }),
        makeTask('later', 'P'),
        makeTask('unlisted', 'P'),
        makeTask('done', 'P', { isDone: true }),
        makeTask('other', 'Q'),
      ],
      [],
    );
    expect(view.rows[0].remainingSteps.map((task) => task.id)).toEqual([
      'first',
      'later',
      'unlisted',
    ]);
  });

  it('filters active, inbox, routine and unknown projects', () => {
    const view = buildPersonalArchiveView(
      [
        makeProject('active'),
        makeProject('archived', { isArchived: true, isDone: true, doneOn: 3 }),
        makeProject('routine', {
          isArchived: true,
          isDone: true,
          doneOn: 2,
          personalProgress: { schemaVersion: 1, entries: [], kind: 'routine' },
        }),
        makeProject('inbox', {
          isArchived: true,
          isDone: true,
          doneOn: 1,
          id: 'INBOX_PROJECT',
        }),
      ],
      [],
      [],
    );
    expect(view.rows.map((row) => row.project.id)).toEqual(['archived']);
  });

  it('sorts by valid doneOn desc and unknown dates last with stable ID ties', () => {
    const view = buildPersonalArchiveView(
      [
        makeProject('old', { isArchived: true, isDone: true, doneOn: 1 }),
        makeProject('new', { isArchived: true, isDone: true, doneOn: 3 }),
        makeProject('unknown', { isArchived: true, isDone: false, doneOn: null }),
        makeProject('invalid', { isArchived: true, isDone: true, doneOn: 0 }),
        makeProject('b-tie', { isArchived: true, isDone: true, doneOn: 3 }),
        makeProject('a-tie', { isArchived: true, isDone: true, doneOn: 3 }),
      ],
      [],
      [],
    );
    expect(view.rows.map((row) => row.project.id)).toEqual([
      'a-tie',
      'b-tie',
      'new',
      'old',
      'invalid',
      'unknown',
    ]);
    expect(view.rows.find((row) => row.project.id === 'unknown')?.hasKnownDate).toBe(
      false,
    );
    expect(view.rows.find((row) => row.project.id === 'unknown')?.isDone).toBe(false);
  });

  it('keeps unfinished steps in project order and history sparse/stable without today', () => {
    const tasks = [
      makeTask('a1', 'P'),
      makeTask('a2', 'P', { isDone: true }),
      makeTask('a3', 'P', { title: 'third' }),
      makeTask('a4', 'P', { isDone: true }),
    ];
    const project = makeProject('P', {
      isArchived: true,
      isDone: true,
      doneOn: 5,
      taskIds: ['a1', 'a2', 'a3', 'a4'],
    });
    const archivedTasks = [
      makeTask('a2', 'P', {
        isDone: true,
        personalProgress: {
          schemaVersion: 1,
          completions: [],
          entries: [
            entry('old-entry', 'P', '2026-01-02', 'older'),
            entry('same-entry', 'P', '2026-01-02', 'same day', 2),
          ],
        },
      }),
      makeTask('a4', 'P', {
        isDone: true,
        personalProgress: {
          schemaVersion: 1,
          completions: [],
          entries: [entry('new-entry', 'P', '2026-02-03', 'newer')],
        },
      }),
    ];
    const view = buildPersonalArchiveView([project], [tasks[0], tasks[2]], archivedTasks);
    const row = view.rows[0];
    expect(row.remainingSteps.map((task) => task.id)).toEqual(['a1', 'a3']);
    expect(row.dates).toEqual(['2026-01-02', '2026-02-03']);
    expect(row.entriesByDay.get('2026-01-02')?.map((e) => e.entry.body)).toEqual([
      'older',
      'same day',
    ]);
  });

  it('prefers active task records and merges young/old by stable IDs', () => {
    const active = makeTask('t1', 'P', {
      personalProgress: {
        schemaVersion: 1,
        completions: [],
        entries: [entry('active-entry', 'P', '2026-03-01', 'active')],
      },
    });
    const archivedSameId = makeTask('t1', 'P', {
      personalProgress: {
        schemaVersion: 1,
        completions: [],
        entries: [entry('archive-entry', 'P', '2026-03-02', 'archive')],
      },
    });
    const young = makeTask('t2', 'P', {
      personalProgress: {
        schemaVersion: 1,
        completions: [],
        entries: [entry('young-entry', 'P', '2026-03-03', 'young')],
      },
    });
    const old = makeTask('t2', 'P', {
      personalProgress: {
        schemaVersion: 1,
        completions: [],
        entries: [entry('old-entry', 'P', '2026-03-04', 'old')],
      },
    });
    const project = makeProject('P', {
      isArchived: true,
      isDone: true,
      doneOn: 1,
      taskIds: ['t1', 't2'],
    });
    const view = buildPersonalArchiveView(
      [project],
      [active],
      [archivedSameId, young, old],
    );
    expect(view.rows[0].entries.map((e) => e.entry.body)).toEqual(['active', 'young']);
  });

  it('keeps empty archived projects visible', () => {
    const view = buildPersonalArchiveView(
      [makeProject('empty', { isArchived: true, isDone: false, doneOn: undefined })],
      [],
      [],
    );
    expect(view.rows.length).toBe(1);
    expect(view.rows[0].entries).toEqual([]);
    expect(view.rows[0].dates).toEqual([]);
    expect(view.rows[0].remainingSteps).toEqual([]);
  });
});
