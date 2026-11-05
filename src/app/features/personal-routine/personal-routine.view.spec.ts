import { Project } from '../project/project.model';
import { PersonalProgressEntry } from '../personal-progress/personal-progress.model';
import { buildPersonalRoutineView } from './personal-routine.view';

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

const project = (
  id: string,
  title: string,
  kind: 'project' | 'routine',
  entries: PersonalProgressEntry[] = [],
  overrides: Partial<Project> = {},
): Project =>
  ({
    id,
    title,
    taskIds: [],
    backlogTaskIds: [],
    noteIds: [],
    isArchived: false,
    personalProgress: {
      schemaVersion: 1,
      entries,
      ...(kind === 'routine' ? { kind: 'routine', createdAt: 1 } : {}),
    },
    ...overrides,
  }) as Project;

describe('personal routine projection', () => {
  it('only contains routine items and keeps empty routine rows visible', () => {
    const view = buildPersonalRoutineView(
      [
        project('a', 'Empty routine', 'routine'),
        project('p', 'Normal project', 'project', [
          entry('x', 'p', '2026-10-25', 'not me'),
        ]),
        project('i', 'Inbox', 'routine', [], { id: 'INBOX_PROJECT' }),
        project('z', 'Archived routine', 'routine', [], { isArchived: true }),
      ],
      '2026-10-26',
      'month',
    );
    expect(view.rows.map((row) => row.project.id)).toEqual(['a']);
    expect(view.dates).toEqual(['2026-10-26']);
  });

  it('builds the in-range record-day union plus today, sorted and deduplicated', () => {
    const view = buildPersonalRoutineView(
      [
        project('a', 'A', 'routine', [
          entry('a1', 'a', '2026-10-20', 'A old'),
          entry('a2', 'a', '2026-10-02', 'A earlier'),
        ]),
        project('b', 'B', 'routine', [
          entry('b1', 'b', '2026-10-20', 'B same'),
          entry('b2', 'b', '2026-06-01', 'outside'),
        ]),
      ],
      '2026-10-26',
      'month',
    );
    expect(view.dates).toEqual(['2026-10-02', '2026-10-20', '2026-10-26']);
    expect(view.rows[1].entriesByDay.get('2026-10-20')?.map((e) => e.body)).toEqual([
      'B same',
    ]);
    expect(view.rows[1].entries.some((e) => e.body === 'outside')).toBe(true);
  });

  it('sorts same-day entries stably by createdAt then ID', () => {
    const view = buildPersonalRoutineView(
      [
        project('a', 'A', 'routine', [
          entry('z', 'a', '2026-10-26', 'created second', 20),
          entry('a', 'a', '2026-10-26', 'created first', 10),
          entry('m', 'a', '2026-10-26', 'same time', 10),
        ]),
      ],
      '2026-10-26',
      'week',
    );
    expect(view.dates).toEqual(['2026-10-26']);
    expect(view.rows[0].entriesByDay.get('2026-10-26')?.map((e) => e.body)).toEqual([
      'created first',
      'same time',
      'created second',
    ]);
  });

  it('does not silently treat unknown kinds as routine', () => {
    const unknown = project('u', 'Unknown', 'routine');
    (unknown.personalProgress as { kind: string }).kind = 'future-kind';
    const view = buildPersonalRoutineView(
      [unknown, project('r', 'Routine', 'routine')],
      '2026-10-26',
      'week',
    );
    expect(view.rows.map((row) => row.project.id)).toEqual(['r']);
  });
});
