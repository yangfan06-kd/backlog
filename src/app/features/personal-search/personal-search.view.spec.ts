import { Project } from '../project/project.model';
import { Task } from '../tasks/task.model';
import { Note } from '../note/note.model';
import { buildPersonalSearchResults } from './personal-search.view';

const project = (id: string, title: string, overrides: Partial<Project> = {}): Project =>
  ({
    id,
    title,
    isArchived: false,
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

describe('personal search projection', () => {
  const projects = [
    project('p1', '阅读计划'),
    project('p2', '每日拉伸', {
      personalProgress: { schemaVersion: 1, entries: [], kind: 'routine' } as never,
    }),
    project('p3', '已归档项目', { isArchived: true }),
  ];
  const tasks = [
    task('t1', 'p1', '读完第一章'),
    task('t2', 'p1', '已经完成', { isDone: true }),
    task('t3', 'p1', '子步骤', { parentId: 't1' }),
  ];
  const notes = [
    {
      id: 'n1',
      projectId: null,
      isPinnedToToday: false,
      content: '买书',
      created: 1,
      modified: 1,
      personalMemo: {
        format: null,
        remindAt: null,
        deletedAt: null,
        revision: 1,
        operationId: 'op',
      },
    } as Note,
    {
      id: 'n2',
      projectId: null,
      isPinnedToToday: false,
      content: '已删除备忘',
      created: 1,
      modified: 1,
      personalMemo: {
        format: null,
        remindAt: null,
        deletedAt: 1,
        revision: 1,
        operationId: 'op2',
      },
    } as Note,
  ];

  it('finds projects, routine items, steps and memos', () => {
    const results = buildPersonalSearchResults(projects, tasks, notes, '阅读');
    expect(
      results.some((item) => item.kind === 'project' && item.title === '阅读计划'),
    ).toBeTrue();
    expect(
      buildPersonalSearchResults(projects, tasks, notes, '拉伸').some(
        (item) => item.kind === 'routine',
      ),
    ).toBeTrue();
    expect(
      buildPersonalSearchResults(projects, tasks, notes, '第一章').some(
        (item) => item.kind === 'step',
      ),
    ).toBeTrue();
    expect(
      buildPersonalSearchResults(projects, tasks, notes, '买书').some(
        (item) => item.kind === 'memo',
      ),
    ).toBeTrue();
  });

  it('does not return archived, completed or deleted data', () => {
    expect(
      buildPersonalSearchResults(projects, tasks, notes, '归档').some(
        (item) => item.title === '已归档项目',
      ),
    ).toBeFalse();
    expect(buildPersonalSearchResults(projects, tasks, notes, '已经完成')).toEqual([]);
    expect(buildPersonalSearchResults(projects, tasks, notes, '已删除备忘')).toEqual([]);
  });

  it('prioritizes an exact title and respects the result limit', () => {
    const results = buildPersonalSearchResults(projects, tasks, notes, '阅读计划');
    expect(results[0].title).toBe('阅读计划');
    expect(buildPersonalSearchResults(projects, tasks, notes, '阅读', 1).length).toBe(1);
  });

  it('returns nothing for an empty query', () => {
    expect(buildPersonalSearchResults(projects, tasks, notes, '   ')).toEqual([]);
  });
});
