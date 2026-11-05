import { TestBed } from '@angular/core/testing';
import { Action, Store } from '@ngrx/store';
import { of } from 'rxjs';
import { DateService } from '../../core/date/date.service';
import { OperationWriteFlushService } from '../../op-log/sync/operation-write-flush.service';
import { ArchiveStoreService } from '../../op-log/persistence/archive-store.service';
import { LockService } from '../../op-log/sync/lock.service';
import { TaskArchiveService } from '../archive/task-archive.service';
import { ArchiveModel } from '../archive/archive.model';
import { DEFAULT_PROJECT, INBOX_PROJECT } from '../project/project.const';
import { Project, ProjectState } from '../project/project.model';
import { Task, TaskState } from '../tasks/task.model';
import { PersonalProgressService } from './personal-progress.service';
import { PersonalProjectLifecycleService } from '../personal-archive/personal-project-lifecycle.service';
import {
  PersonalProgressEntry,
  PersonalProgressOnProject,
  PersonalProgressOnTask,
} from './personal-progress.model';
import { buildPersonalProgressView } from './personal-progress.view';
import { buildPersonalOverview } from '../personal-overview/personal-overview.view';
import { PersonalOverviewOrderService } from '../personal-overview/personal-overview-order.service';

interface RootStateLike {
  task: TaskState;
  project: ProjectState;
  tasks: TaskState;
  projects: ProjectState;
}

const taskState = (tasks: Task[]): TaskState => ({
  ids: tasks.map((t) => t.id),
  entities: Object.fromEntries(tasks.map((t) => [t.id, t])),
  currentTaskId: null,
  selectedTaskId: null,
  lastCurrentTaskId: null,
  isDataLoaded: true,
});

const projectState = (projects: Project[]): ProjectState => ({
  ids: projects.map((p) => p.id),
  entities: Object.fromEntries(projects.map((p) => [p.id, p])),
});

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
    subTaskIds: [],
    tagIds: [],
    timeSpent: 0,
    timeEstimate: 0,
    timeSpentOnDay: {},
    created: 1,
    attachments: [],
    ...extra,
  }) as Task;

const makeProject = (
  id: string,
  title: string,
  taskIds: string[],
  isArchived = false,
): Project => ({
  ...DEFAULT_PROJECT,
  id,
  title,
  taskIds,
  backlogTaskIds: [],
  noteIds: [],
  isArchived,
});

const makeArchive = (task: Task): ArchiveModel => ({
  task: { ids: [task.id], entities: { [task.id]: task } },
  timeTracking: { project: {}, tag: {} },
  lastTimeTrackingFlush: 0,
});

const makeRoutineProject = (
  id: string,
  title: string,
  entries: PersonalProgressEntry[] = [],
  extra: Record<string, unknown> = {},
): Project =>
  ({
    ...DEFAULT_PROJECT,
    id,
    title,
    taskIds: [],
    backlogTaskIds: [],
    noteIds: [],
    isHiddenFromMenu: true,
    personalProgress: {
      schemaVersion: 1,
      entries,
      kind: 'routine',
      createdAt: 1,
      ...extra,
    },
  }) as Project;

const makeEntry = (
  id: string,
  projectId: string,
  recordDay: string,
  body: string,
): PersonalProgressEntry => ({
  id,
  projectId,
  recordDay,
  body,
  source: 'manual',
  createdAt: 1,
  updatedAt: 1,
  revision: 1,
  operationId: `op-${id}`,
});

class FakeStore {
  state: RootStateLike;
  actions: Action[] = [];

  constructor(tasks: Task[], projects: Project[]) {
    const task = taskState(tasks);
    const project = projectState(projects);
    this.state = {
      task,
      project,
      tasks: task,
      projects: project,
    };
  }

  /**
   * Return a fresh snapshot per select. NgRx selectors memoize on their last
   * input, so handing them the same mutated object would keep stale results.
   */
  select = (selector: (state: RootStateLike) => unknown): unknown => {
    const task: TaskState = {
      ...this.state.task,
      ids: [...(this.state.task.ids as string[])],
      entities: { ...this.state.task.entities },
    };
    const project: ProjectState = {
      ...this.state.project,
      ids: [...(this.state.project.ids as string[])],
      entities: { ...this.state.project.entities },
    };
    return of(selector({ task, project, tasks: task, projects: project }));
  };

  dispatch = (action: Action): void => {
    this.actions.push(action);
    const a = action as unknown as {
      type: string;
      project?: { id: string; changes: Partial<Project> };
      task?: { id: string; changes: Partial<Task> };
      projectId?: string;
      operations?: {
        type: string;
        tempId?: string;
        data?: { title?: string };
        taskIds?: string[];
      }[];
      createdTaskIds?: Record<string, string>;
      createdTaskPersonalProgress?: Record<string, PersonalProgressOnTask>;
      taskIds?: string[];
      id?: string;
    };

    switch (action.type) {
      case '[Project] Add Project': {
        if (!a.project) break;
        const project = a.project as unknown as Project;
        this.state.project.ids = [...(this.state.project.ids as string[]), project.id];
        this.state.project.entities[project.id] = project;
        break;
      }
      case '[Project] Update Project': {
        if (!a.project) break;
        const existing = this.state.project.entities[a.project.id];
        if (existing) {
          this.state.project.entities[a.project.id] = {
            ...existing,
            ...a.project.changes,
          };
        }
        break;
      }
      case '[Task Shared] updateTask':
      case '[Task Shared] Update Task': {
        if (!a.task) break;
        const existing = this.state.task.entities[a.task.id];
        if (existing) {
          this.state.task.entities[a.task.id] = { ...existing, ...a.task.changes };
        }
        break;
      }
      case '[Task Shared] batchUpdateForProject': {
        for (const op of a.operations ?? []) {
          if (op.type === 'create' && op.tempId) {
            const id = a.createdTaskIds?.[op.tempId] ?? op.tempId;
            const task = makeTask(id, a.projectId ?? '', op.data?.title ?? '') as Task;
            this.state.task.ids = [...this.state.task.ids, id];
            this.state.task.entities[id] = a.createdTaskPersonalProgress?.[id]
              ? { ...task, personalProgress: a.createdTaskPersonalProgress[id] }
              : task;
          }
        }
        const project = a.projectId
          ? this.state.project.entities[a.projectId]
          : undefined;
        if (project) {
          const reorder = (a.operations ?? []).find((op) => op.type === 'reorder');
          if (reorder?.taskIds) {
            this.state.project.entities[project.id] = {
              ...project,
              taskIds: reorder.taskIds,
            };
          }
        }
        break;
      }
      case '[Task Shared] deleteTasks': {
        const ids = new Set(a.taskIds ?? []);
        this.state.task.ids = this.state.task.ids.filter((id) => !ids.has(id));
        for (const id of ids) delete this.state.task.entities[id];
        for (const [projectId, project] of Object.entries(this.state.project.entities)) {
          if (!project) continue;
          this.state.project.entities[projectId] = {
            ...project,
            taskIds: project.taskIds.filter((id) => !ids.has(id)),
          };
        }
        break;
      }
      case '[Task Shared] deleteProject': {
        const id = a.projectId as string;
        this.state.project.ids = (this.state.project.ids as string[]).filter(
          (p) => p !== id,
        );
        delete this.state.project.entities[id];
        break;
      }
    }
  };
}

interface FlushMock {
  createCommandReceipt: jasmine.Spy;
  settleCommandReceipt: jasmine.Spy;
}

const flushMock = (): FlushMock => ({
  createCommandReceipt: jasmine.createSpy('createCommandReceipt').and.resolveTo(),
  settleCommandReceipt: jasmine.createSpy('settleCommandReceipt'),
});

describe('PersonalProgressService', () => {
  let store: FakeStore;
  let service: PersonalProgressService;
  let orderService: PersonalOverviewOrderService;
  let dateService: DateService;
  let flush: FlushMock;
  let archiveState: { young?: ArchiveModel; old?: ArchiveModel };
  const today = (): string => dateService.todayStr();

  const setup = (tasks: Task[], projects: Project[]): void => {
    store = new FakeStore(tasks, projects);
    flush = flushMock();
    archiveState = {};
    TestBed.configureTestingModule({
      providers: [
        PersonalProgressService,
        { provide: Store, useValue: store as unknown as Store },
        { provide: DateService, useValue: new DateService() },
        { provide: OperationWriteFlushService, useValue: flush },
        {
          provide: TaskArchiveService,
          useValue: { load: async () => ({ ids: [], entities: {} }) },
        },
        {
          provide: ArchiveStoreService,
          useValue: {
            loadArchiveYoung: async () => archiveState.young,
            loadArchiveOld: async () => archiveState.old,
          },
        },
        {
          provide: LockService,
          useValue: {
            request: async <T>(_name: string, fn: () => Promise<T>): Promise<T> => fn(),
          },
        },
      ],
    });
    service = TestBed.inject(PersonalProgressService);
    orderService = TestBed.inject(PersonalOverviewOrderService);
    dateService = TestBed.inject(DateService);
  };

  it('finishes only after a queued entry write settles and preserves that entry', async () => {
    setup([], [makeProject('A', 'A', [])]);
    const lifecycle = TestBed.inject(PersonalProjectLifecycleService);
    let release!: () => void;
    let started!: () => void;
    const entered = new Promise<void>((resolve) => {
      started = resolve;
    });
    const pending = new Promise<void>((resolve) => {
      release = resolve;
    });
    flush.createCommandReceipt.and.callFake((id: string) => {
      if (id === 'entry-first') {
        started();
        return pending;
      }
      return Promise.resolve();
    });
    const entry = service.addEntry({
      operationId: 'entry-first',
      projectId: 'A',
      recordDay: today(),
      body: 'keep this',
    });
    const finish = lifecycle.finishProject({
      operationId: 'finish-next',
      projectId: 'A',
      expectedRevision: 0,
    });
    await entered;
    expect(store.state.project.entities.A!.isArchived).toBeFalse();
    release();
    expect((await entry).status).toBe('persisted');
    expect((await finish).status).toBe('persisted');
    expect(store.state.project.entities.A!.personalProgress?.entries[0].body).toBe(
      'keep this',
    );
  });

  it('rejects a stale entry queued behind a finish command', async () => {
    setup([], [makeProject('A', 'A', [])]);
    const lifecycle = TestBed.inject(PersonalProjectLifecycleService);
    const finish = lifecycle.finishProject({
      operationId: 'finish-first',
      projectId: 'A',
      expectedRevision: 0,
    });
    const entry = service.addEntry({
      operationId: 'entry-next',
      projectId: 'A',
      recordDay: today(),
      body: 'not saved',
    });
    expect((await finish).status).toBe('persisted');
    const result = await entry;
    expect(result.status).toBe('rejected');
    if (result.status === 'rejected') expect(result.code).toBe('PROJECT_UNAVAILABLE');
    expect(store.state.project.entities.A!.personalProgress?.entries).toEqual([]);
  });

  it('records a completion as a snapshot and leaves the other project untouched', async () => {
    const a1 = makeTask('a1', 'A', 'Step one');
    const a2 = makeTask('a2', 'A', 'Step two');
    const b1 = makeTask('b1', 'B', 'Other project');
    setup(
      [a1, a2, b1],
      [makeProject('A', 'Alpha', ['a1', 'a2']), makeProject('B', 'Beta', ['b1'])],
    );

    const result = await service.completeStep({
      operationId: 'op-1',
      projectId: 'A',
      stepId: 'a1',
      recordDay: today(),
      completedAt: 1234,
    });

    expect(result.status).toBe('persisted');
    const task = store.state.task.entities.a1!;
    expect(task.isDone).toBeTrue();
    expect(task.doneOn).toBe(1234);
    const personal = task.personalProgress as PersonalProgressOnTask;
    expect(personal.entries.length).toBe(1);
    expect(personal.entries[0].body).toBe('Step one');
    expect(personal.completions[0].operationId).toBe('op-1');
    expect(store.state.task.entities.b1!.isDone).toBeFalse();

    // The record is a snapshot, not a live title reference.
    store.state.task.entities.a1 = { ...store.state.task.entities.a1!, title: 'Renamed' };
    expect(
      (store.state.task.entities.a1!.personalProgress as PersonalProgressOnTask)
        .entries[0].body,
    ).toBe('Step one');
  });

  it('does not duplicate entries when the same operationId is retried', async () => {
    const a1 = makeTask('a1', 'A', 'Step one');
    setup([a1], [makeProject('A', 'Alpha', ['a1'])]);

    const first = await service.completeStep({
      operationId: 'op-same',
      projectId: 'A',
      stepId: 'a1',
      recordDay: today(),
    });
    const second = await service.completeStep({
      operationId: 'op-same',
      projectId: 'A',
      stepId: 'a1',
      recordDay: today(),
    });

    expect(first.status).toBe('persisted');
    expect(second.status).toBe('persisted');
    const personal = store.state.task.entities.a1!
      .personalProgress as PersonalProgressOnTask;
    expect(personal.entries.length).toBe(1);
    expect(personal.completions.length).toBe(1);
  });

  it('rejects completion of a task from another project', async () => {
    const b1 = makeTask('b1', 'B', 'Other');
    setup([b1], [makeProject('A', 'Alpha', []), makeProject('B', 'Beta', ['b1'])]);

    const result = await service.completeStep({
      operationId: 'op-cross',
      projectId: 'A',
      stepId: 'b1',
      recordDay: today(),
    });

    expect(result.status).toBe('rejected');
    if (result.status === 'rejected') {
      expect(result.code).toBe('OWNER_MISMATCH');
    }
    expect(store.state.task.entities.b1!.isDone).toBeFalse();
  });

  it('undoes the latest completion first, then the previous one', async () => {
    const a1 = makeTask('a1', 'A', 'One');
    const a2 = makeTask('a2', 'A', 'Two');
    const a3 = makeTask('a3', 'A', 'Three');
    setup([a1, a2, a3], [makeProject('A', 'Alpha', ['a1', 'a2', 'a3'])]);

    await service.completeStep({
      operationId: 'c1',
      projectId: 'A',
      stepId: 'a1',
      recordDay: today(),
    });
    await service.completeStep({
      operationId: 'c2',
      projectId: 'A',
      stepId: 'a2',
      recordDay: today(),
    });
    await service.completeStep({
      operationId: 'c3',
      projectId: 'A',
      stepId: 'a3',
      recordDay: today(),
    });

    const undo3 = await service.undoLatestCompletion({
      operationId: 'u3',
      projectId: 'A',
    });
    expect(undo3.status).toBe('persisted');
    expect(store.state.task.entities.a3!.isDone).toBeFalse();
    expect(
      (store.state.task.entities.a3!.personalProgress as PersonalProgressOnTask).entries
        .length,
    ).toBe(0);

    const undo2 = await service.undoLatestCompletion({
      operationId: 'u2',
      projectId: 'A',
    });
    expect(undo2.status).toBe('persisted');
    expect(store.state.task.entities.a2!.isDone).toBeFalse();
    expect(store.state.task.entities.a1!.isDone).toBeTrue();
    const undo1 = await service.undoLatestCompletion({
      operationId: 'u1',
      projectId: 'A',
    });
    expect(undo1.status).toBe('persisted');
    expect(store.state.task.entities.a1!.isDone).toBeFalse();
  });

  it('rejects undo when the recorded entry was edited', async () => {
    const a1 = makeTask('a1', 'A', 'One');
    setup([a1], [makeProject('A', 'Alpha', ['a1'])]);
    await service.completeStep({
      operationId: 'c1',
      projectId: 'A',
      stepId: 'a1',
      recordDay: today(),
    });
    const completion = (
      store.state.task.entities.a1!.personalProgress as PersonalProgressOnTask
    ).completions[0];
    const entry = (
      store.state.task.entities.a1!.personalProgress as PersonalProgressOnTask
    ).entries[0];

    const edited = await service.editEntry({
      operationId: 'e1',
      projectId: 'A',
      entryId: entry.id,
      expectedRevision: 1,
      body: 'Edited actual result',
    });
    expect(edited.status).toBe('persisted');

    const undo = await service.undoLatestCompletion({
      operationId: 'u1',
      projectId: 'A',
    });
    expect(undo.status).toBe('rejected');
    if (undo.status === 'rejected') {
      expect(undo.code).toBe('EDITED_ENTRY');
    }
    expect(store.state.task.entities.a1!.isDone).toBeTrue();
    expect(completion.entryRevisionAtCompletion).toBe(1);
  });

  it('inserts after the selected step and leaves the other project order alone', async () => {
    const a1 = makeTask('a1', 'A', 'One');
    const a2 = makeTask('a2', 'A', 'Two');
    const b1 = makeTask('b1', 'B', 'Other');
    setup(
      [a1, a2, b1],
      [makeProject('A', 'Alpha', ['a1', 'a2']), makeProject('B', 'Beta', ['b1'])],
    );

    const result = await service.insertStepAfter({
      operationId: 'insert-1',
      projectId: 'A',
      afterStepId: 'a1',
      title: 'Inserted',
    });
    expect(result.status).toBe('persisted');
    if (result.status !== 'persisted') return;
    expect(store.state.project.entities.A!.taskIds).toEqual([
      'a1',
      result.value.stepId,
      'a2',
    ]);
    expect(store.state.project.entities.B!.taskIds).toEqual(['b1']);

    const empty = await service.insertStepAfter({
      operationId: 'insert-empty',
      projectId: 'A',
      afterStepId: 'a1',
      title: '   ',
    });
    expect(empty.status).toBe('rejected');
  });

  it('keeps multiple manual entries for the same day instead of overwriting', async () => {
    setup([], [makeProject('A', 'Alpha', [])]);
    const day = today();
    const first = await service.addEntry({
      operationId: 'same-day-1',
      projectId: 'A',
      recordDay: day,
      body: 'First',
    });
    const second = await service.addEntry({
      operationId: 'same-day-2',
      projectId: 'A',
      recordDay: day,
      body: 'Second',
    });
    expect(first.status).toBe('persisted');
    expect(second.status).toBe('persisted');
    const project = store.state.project.entities.A!;
    expect(project.personalProgress?.entries.length).toBe(2);
    expect(project.personalProgress?.entries.map((e) => e.body)).toEqual([
      'First',
      'Second',
    ]);
  });

  it('locks past entries until history editing is enabled', async () => {
    setup([], [makeProject('A', 'Alpha', [])]);
    const added = await service.addEntry({
      operationId: 'e-past',
      projectId: 'A',
      recordDay: '2000-01-01',
      body: 'Old note',
    });
    expect(added.status).toBe('persisted');
    if (added.status !== 'persisted') return;

    const locked = await service.editEntry({
      operationId: 'edit-locked',
      projectId: 'A',
      entryId: added.value.entryId,
      expectedRevision: 1,
      body: 'Changed',
    });
    expect(locked.status).toBe('rejected');
    if (locked.status === 'rejected') expect(locked.code).toBe('HISTORY_LOCKED');

    service.setHistoryEditing(true);
    const edited = await service.editEntry({
      operationId: 'edit-open',
      projectId: 'A',
      entryId: added.value.entryId,
      expectedRevision: 1,
      body: 'Changed',
    });
    expect(edited.status).toBe('persisted');
    service.resetHistoryEditing();
  });

  it('does not undo a second completion when the same undo is retried', async () => {
    setup(
      [makeTask('a1', 'A', 'One'), makeTask('a2', 'A', 'Two')],
      [makeProject('A', 'Alpha', ['a1', 'a2'])],
    );
    for (const stepId of ['a1', 'a2']) {
      await service.completeStep({
        operationId: `complete-${stepId}`,
        projectId: 'A',
        stepId,
        recordDay: today(),
      });
    }
    const input = { operationId: 'undo-once', projectId: 'A' };
    expect((await service.undoLatestCompletion(input)).status).toBe('persisted');
    expect((await service.undoLatestCompletion(input)).status).toBe('persisted');
    expect(store.state.task.entities.a1!.isDone).toBeTrue();
    expect(store.state.task.entities.a2!.isDone).toBeFalse();
  });

  it('acknowledges a repeated edit without applying it twice', async () => {
    setup([], [makeProject('A', 'Alpha', [])]);
    const added = await service.addEntry({
      operationId: 'entry',
      projectId: 'A',
      recordDay: today(),
      body: 'Original',
    });
    if (added.status !== 'persisted') throw new Error('Test setup failed');
    const input = {
      operationId: 'edit-once',
      projectId: 'A',
      entryId: added.value.entryId,
      expectedRevision: 1,
      body: 'Edited',
    };
    expect((await service.editEntry(input)).status).toBe('persisted');
    expect((await service.editEntry(input)).status).toBe('persisted');
    expect(store.state.project.entities.A!.personalProgress!.entries[0].revision).toBe(2);
  });

  it('keeps both notes when two commands arrive together', async () => {
    setup([], [makeProject('A', 'Alpha', [])]);
    const results = await Promise.all(
      ['First', 'Second'].map((body) =>
        service.addEntry({
          operationId: body,
          projectId: 'A',
          recordDay: today(),
          body,
        }),
      ),
    );
    expect(results.every((result) => result.status === 'persisted')).toBeTrue();
    expect(
      store.state.project.entities.A!.personalProgress!.entries.map(
        (entry) => entry.body,
      ),
    ).toEqual(['First', 'Second']);
  });

  it('does not offer recent undo for completions loaded from a previous session', async () => {
    setup([makeTask('a1', 'A', 'One')], [makeProject('A', 'Alpha', ['a1'])]);
    await service.completeStep({
      operationId: 'old-completion',
      projectId: 'A',
      stepId: 'a1',
      recordDay: today(),
    });
    const task = store.state.task.entities.a1!;
    const project = store.state.project.entities.A!;
    TestBed.resetTestingModule();
    setup([task], [project]);
    expect(
      (
        await service.undoLatestCompletion({
          operationId: 'new-session-undo',
          projectId: 'A',
        })
      ).status,
    ).toBe('rejected');
    expect(store.state.task.entities.a1!.isDone).toBeTrue();
  });

  it('rolls the optimistic task change back when the receipt fails', async () => {
    const a1 = makeTask('a1', 'A', 'One');
    setup([a1], [makeProject('A', 'Alpha', ['a1'])]);
    flush.createCommandReceipt.and.returnValue(Promise.reject(new Error('disk full')));

    const result = await service.completeStep({
      operationId: 'c-fail',
      projectId: 'A',
      stepId: 'a1',
      recordDay: today(),
    });

    expect(result.status).toBe('failed');
    expect(store.state.task.entities.a1!.isDone).toBeFalse();
    expect(store.state.task.entities.a1!.doneOn).toBeUndefined();
    expect(store.state.task.entities.a1!.personalProgress).toBeUndefined();
  });

  it('edits only the selected remaining step text and keeps order/IDs', async () => {
    const a1 = makeTask('a1', 'A', 'One');
    const a2 = makeTask('a2', 'A', 'Two');
    const b1 = makeTask('b1', 'B', 'Other');
    setup(
      [a1, a2, b1],
      [makeProject('A', 'Alpha', ['a1', 'a2']), makeProject('B', 'Beta', ['b1'])],
    );

    const result = await service.editStep({
      operationId: 'step-edit-1',
      expectedRevision: 0,
      projectId: 'A',
      stepId: 'a1',
      expectedTitle: 'One',
      title: 'One edited',
    });

    expect(result.status).toBe('persisted');
    expect(store.state.task.entities.a1!.title).toBe('One edited');
    expect(store.state.task.entities.a2!.title).toBe('Two');
    expect(store.state.task.entities.b1!.title).toBe('Other');
    expect(store.state.project.entities.A!.taskIds).toEqual(['a1', 'a2']);
    expect(store.state.task.entities.a1!.personalProgress).toEqual({
      schemaVersion: 1,
      entries: [],
      completions: [],
      stepEdit: { revision: 1, operationId: 'step-edit-1' },
    });
  });

  it('rejects a stale step edit and a completed step edit without changing the title', async () => {
    const a1 = makeTask('a1', 'A', 'One');
    setup([a1], [makeProject('A', 'Alpha', ['a1'])]);

    const stale = await service.editStep({
      operationId: 'stale-step',
      expectedRevision: 0,
      projectId: 'A',
      stepId: 'a1',
      expectedTitle: 'Old text',
      title: 'New text',
    });
    expect(stale.status).toBe('rejected');
    if (stale.status === 'rejected') expect(stale.code).toBe('STALE_STEP');
    expect(store.state.task.entities.a1!.title).toBe('One');

    store.state.task.entities.a1 = { ...store.state.task.entities.a1!, isDone: true };
    const done = await service.editStep({
      operationId: 'done-step',
      expectedRevision: 0,
      projectId: 'A',
      stepId: 'a1',
      expectedTitle: 'One',
      title: 'New text',
    });
    expect(done.status).toBe('rejected');
    if (done.status === 'rejected') expect(done.code).toBe('ALREADY_DONE');
  });

  it('rejects a cross-project step edit and treats an identical retry as persisted', async () => {
    const a1 = makeTask('a1', 'A', 'One');
    const b1 = makeTask('b1', 'B', 'Other');
    setup(
      [a1, b1],
      [makeProject('A', 'Alpha', ['a1']), makeProject('B', 'Beta', ['b1'])],
    );

    const cross = await service.editStep({
      operationId: 'cross-step',
      expectedRevision: 0,
      projectId: 'B',
      stepId: 'a1',
      expectedTitle: 'One',
      title: 'Nope',
    });
    expect(cross.status).toBe('rejected');
    if (cross.status === 'rejected') expect(cross.code).toBe('OWNER_MISMATCH');

    const first = await service.editStep({
      operationId: 'same-step',
      expectedRevision: 0,
      projectId: 'A',
      stepId: 'a1',
      expectedTitle: 'One',
      title: 'One again',
    });
    const second = await service.editStep({
      operationId: 'same-step',
      expectedRevision: 0,
      projectId: 'A',
      stepId: 'a1',
      expectedTitle: 'One',
      title: 'One again',
    });
    expect(first.status).toBe('persisted');
    expect(second.status).toBe('persisted');
    expect(store.state.task.entities.a1!.title).toBe('One again');
    // A retry after success must not dispatch a second Task update.
    expect(store.actions.length).toBe(1);
  });

  it('rejects an older edit after a newer edit restores the original title', async () => {
    setup([makeTask('a1', 'A', 'One')], [makeProject('A', 'Alpha', ['a1'])]);
    const first = {
      operationId: 'edit-first',
      projectId: 'A',
      stepId: 'a1',
      expectedTitle: 'One',
      expectedRevision: 0,
      title: 'Changed',
    };
    await service.editStep(first);
    await service.editStep({
      ...first,
      operationId: 'edit-back',
      expectedTitle: 'Changed',
      expectedRevision: 1,
      title: 'One',
    });
    const result = await service.editStep(first);
    expect(result.status).toBe('rejected');
    if (result.status === 'rejected') expect(result.code).toBe('STALE_STEP');
    expect(store.state.task.entities.a1!.title).toBe('One');
    expect(store.state.task.entities.a1!.personalProgress!.stepEdit!.revision).toBe(2);
    expect(store.actions.length).toBe(2);
  });

  it('restores the edit revision after a failed write so the unchanged draft can retry', async () => {
    setup([makeTask('a1', 'A', 'One')], [makeProject('A', 'Alpha', ['a1'])]);
    flush.createCommandReceipt.and.callFake((id: string) =>
      id === 'edit-fail' ? Promise.reject(new Error('disk full')) : Promise.resolve(),
    );
    const input = {
      operationId: 'edit-fail',
      projectId: 'A',
      stepId: 'a1',
      expectedTitle: 'One',
      expectedRevision: 0,
      title: 'Changed',
    };
    expect((await service.editStep(input)).status).toBe('failed');
    expect(store.state.task.entities.a1!.title).toBe('One');
    expect(store.state.task.entities.a1!.personalProgress!.stepEdit).toBeUndefined();
    flush.createCommandReceipt.and.resolveTo();
    expect((await service.editStep(input)).status).toBe('persisted');
    expect(store.state.task.entities.a1!.title).toBe('Changed');
  });

  it('edits an archived completion record atomically with the archive snapshot', async () => {
    const archived = makeTask('arch-1', 'A', 'Old step', {
      isDone: true,
      personalProgress: {
        schemaVersion: 1,
        completions: [],
        entries: [
          {
            id: 'arch-entry',
            projectId: 'A',
            stepId: 'arch-1',
            recordDay: '2025-01-10',
            body: 'Old body',
            source: 'step-completion',
            createdAt: 1,
            updatedAt: 1,
            revision: 1,
            operationId: 'original',
          },
        ],
      },
    });
    setup([], [makeProject('A', 'Alpha', [])]);
    archiveState.young = makeArchive(archived);
    service.setHistoryEditing(true);

    const result = await service.editEntry({
      operationId: 'archive-edit-1',
      projectId: 'A',
      entryId: 'arch-entry',
      expectedRevision: 1,
      body: 'New archived body',
    });

    expect(result.status).toBe('persisted');
    const action = store.actions.at(-1) as unknown as {
      meta?: {
        archiveWrite?: {
          storeName: string;
          data: ArchiveModel;
        };
      };
    };
    expect(action.meta?.archiveWrite?.storeName).toBe('archive_young');
    const updated = action.meta?.archiveWrite?.data.task.entities['arch-1'];
    const entry = updated?.personalProgress?.entries[0];
    expect(entry?.body).toBe('New archived body');
    expect(entry?.revision).toBe(2);
    expect(entry?.recordDay).toBe('2025-01-10');
    expect(updated?.title).toBe('Old step');
    // The archive object handed to the transaction is the only persisted copy;
    // the original test fixture must not be mutated in place.
    expect(archived.personalProgress?.entries[0].body).toBe('Old body');
  });

  it('keeps archive history locked until editing is enabled', async () => {
    const archived = makeTask('arch-2', 'A', 'Old step', {
      isDone: true,
      personalProgress: {
        schemaVersion: 1,
        completions: [],
        entries: [
          {
            id: 'arch-entry-2',
            projectId: 'A',
            recordDay: '2025-01-10',
            body: 'Old body',
            source: 'manual',
            createdAt: 1,
            updatedAt: 1,
            revision: 1,
            operationId: 'original-2',
          },
        ],
      },
    });
    setup([], [makeProject('A', 'Alpha', [])]);
    archiveState.old = makeArchive(archived);

    const locked = await service.editEntry({
      operationId: 'archive-locked',
      projectId: 'A',
      entryId: 'arch-entry-2',
      expectedRevision: 1,
      body: 'Nope',
    });
    expect(locked.status).toBe('rejected');
    if (locked.status === 'rejected') expect(locked.code).toBe('HISTORY_LOCKED');

    service.setHistoryEditing(true);
    const edited = await service.editEntry({
      operationId: 'archive-old-edit',
      projectId: 'A',
      entryId: 'arch-entry-2',
      expectedRevision: 1,
      body: 'Edited old',
    });
    expect(edited.status).toBe('persisted');
    const action = store.actions.at(-1) as unknown as {
      meta?: { archiveWrite?: { storeName: string } };
    };
    expect(action.meta?.archiveWrite?.storeName).toBe('archive_old');
  });

  it('rejects archived edits with a stale revision or a foreign project', async () => {
    const archived = makeTask('arch-3', 'A', 'Old step', {
      isDone: true,
      personalProgress: {
        schemaVersion: 1,
        completions: [],
        entries: [
          {
            id: 'arch-entry-3',
            projectId: 'A',
            recordDay: '2025-01-10',
            body: 'Old body',
            source: 'manual',
            createdAt: 1,
            updatedAt: 1,
            revision: 3,
            operationId: 'original-3',
          },
        ],
      },
    });
    setup([], [makeProject('A', 'Alpha', []), makeProject('B', 'Beta', [])]);
    archiveState.young = makeArchive(archived);
    service.setHistoryEditing(true);

    const stale = await service.editEntry({
      operationId: 'archive-stale',
      projectId: 'A',
      entryId: 'arch-entry-3',
      expectedRevision: 1,
      body: 'Nope',
    });
    expect(stale.status).toBe('rejected');
    if (stale.status === 'rejected') expect(stale.code).toBe('STALE_REVISION');

    const foreign = await service.editEntry({
      operationId: 'archive-foreign',
      projectId: 'B',
      entryId: 'arch-entry-3',
      expectedRevision: 3,
      body: 'Nope',
    });
    expect(foreign.status).toBe('rejected');
    if (foreign.status === 'rejected') expect(foreign.code).toBe('OWNER_MISMATCH');
  });

  it('classifies only the selected project and preserves its records', async () => {
    const pA = {
      ...makeProject('A', 'Alpha', []),
      personalProgress: {
        schemaVersion: 1,
        entries: [
          {
            id: 'manual-a',
            projectId: 'A',
            recordDay: '2026-10-24',
            body: 'Keep me',
            source: 'manual',
            createdAt: 1,
            updatedAt: 1,
            revision: 1,
            operationId: 'manual-op',
          },
        ],
      },
    } as Project;
    setup([], [pA, makeProject('B', 'Beta', [])]);

    const result = await service.setProjectQuadrant({
      operationId: 'quadrant-1',
      projectId: 'A',
      expectedRevision: 0,
      quadrant: 'important',
    });

    expect(result.status).toBe('persisted');
    const a = store.state.project.entities.A!
      .personalProgress as PersonalProgressOnProject;
    expect(a.quadrant).toEqual({
      value: 'important',
      revision: 1,
      operationId: 'quadrant-1',
    });
    expect(a.entries.map((e) => e.body)).toEqual(['Keep me']);
    expect(store.state.project.entities.B!.personalProgress?.quadrant).toBeUndefined();
    expect(store.actions.length).toBe(1);
  });

  it('rejects an old command after A→B→A and does not replay it', async () => {
    setup([], [makeProject('A', 'Alpha', []), makeProject('B', 'Beta', [])]);
    await service.setProjectQuadrant({
      operationId: 'q-a1',
      projectId: 'A',
      expectedRevision: 0,
      quadrant: 'urgent-important',
    });
    await service.setProjectQuadrant({
      operationId: 'q-b',
      projectId: 'A',
      expectedRevision: 1,
      quadrant: 'urgent',
    });
    await service.setProjectQuadrant({
      operationId: 'q-a2',
      projectId: 'A',
      expectedRevision: 2,
      quadrant: 'urgent-important',
    });

    const retry = await service.setProjectQuadrant({
      operationId: 'q-a1',
      projectId: 'A',
      expectedRevision: 0,
      quadrant: 'urgent-important',
    });
    expect(retry.status).toBe('rejected');
    if (retry.status === 'rejected') expect(retry.code).toBe('STALE_REVISION');
    expect(store.state.project.entities.A!.personalProgress?.quadrant).toEqual(
      jasmine.objectContaining({
        value: 'urgent-important',
        revision: 3,
        operationId: 'q-a2',
      }),
    );
  });

  it('deduplicates the same command and treats an identical value as a no-op', async () => {
    setup([], [makeProject('A', 'Alpha', [])]);
    const input = {
      operationId: 'same-q',
      projectId: 'A',
      expectedRevision: 0,
      quadrant: 'neither' as const,
    };
    const first = await service.setProjectQuadrant(input);
    const second = await service.setProjectQuadrant(input);
    const sameValue = await service.setProjectQuadrant({
      operationId: 'another-op',
      projectId: 'A',
      expectedRevision: 1,
      quadrant: 'neither',
    });
    expect(first.status).toBe('persisted');
    expect(second.status).toBe('persisted');
    expect(sameValue.status).toBe('persisted');
    expect(store.actions.length).toBe(1);
    expect(store.state.project.entities.A!.personalProgress?.quadrant?.revision).toBe(1);
  });

  it('keeps board row order independent of overview order and allows routine rows', async () => {
    setup(
      [],
      [
        makeProject('A', 'Alpha', []),
        makeProject('B', 'Beta', []),
        makeRoutineProject('R', 'Routine'),
        makeRoutineProject('S', 'Second routine'),
      ],
    );
    expect(
      (
        await orderService.reorder({
          operationId: 'board-b',
          projectId: 'B',
          targetId: 'A',
          after: false,
          expectedRevision: 0,
          scope: 'board',
        })
      ).status,
    ).toBe('persisted');
    expect(
      (
        await orderService.reorder({
          operationId: 'routine-s',
          projectId: 'S',
          targetId: 'R',
          after: false,
          expectedRevision: 0,
          scope: 'board',
          ownerKind: 'routine',
        })
      ).status,
    ).toBe('persisted');
    const projects = (store.state.project.ids as string[]).map(
      (id) => store.state.project.entities[id]!,
    );
    expect(
      buildPersonalProgressView(projects, [], [], '2026-11-05').rows.map(
        (row) => row.project.id,
      ),
    ).toEqual(['B', 'A']);
    expect(
      buildPersonalOverview(projects, []).groups[4].rows.map((row) => row.project.id),
    ).toEqual(['A', 'B']);
    expect(
      store.state.project.entities.S?.personalProgress?.boardOrder?.position,
    ).toBeLessThan(
      store.state.project.entities.R!.personalProgress!.boardOrder!.position,
    );
    expect(
      (
        await orderService.reorder({
          operationId: 'cross-kind',
          projectId: 'B',
          targetId: 'R',
          after: false,
          expectedRevision: 1,
          scope: 'board',
        })
      ).status,
    ).toBe('rejected');
  });

  it('persists a project reorder without changing other project contents or classification', async () => {
    setup(
      [],
      [
        makeProject('A', 'Alpha', []),
        makeProject('B', 'Beta', []),
        makeProject('C', 'Gamma', []),
      ],
    );
    const result = await orderService.reorder({
      operationId: 'move-c',
      projectId: 'C',
      targetId: 'A',
      after: false,
      expectedRevision: 0,
    });
    expect(result.status).toBe('persisted');
    const projects = (store.state.project.ids as string[]).map(
      (id) => store.state.project.entities[id]!,
    );
    expect(
      buildPersonalOverview(projects, []).groups[4].rows.map((row) => row.project.id),
    ).toEqual(['C', 'A', 'B']);
    expect(store.state.project.entities.A!.personalProgress?.entries).toEqual([]);
    expect(store.state.project.entities.A!.personalProgress?.quadrant).toBeUndefined();
    expect(store.state.project.entities.C!.personalProgress?.quadrant).toBeUndefined();
  });

  it('keeps a saved relative order after an earlier project is permanently removed', async () => {
    setup(
      [],
      [
        makeProject('A', 'Alpha', []),
        makeProject('B', 'Beta', []),
        makeProject('C', 'Gamma', []),
      ],
    );
    const result = await orderService.reorder({
      operationId: 'move-c-before-b',
      projectId: 'C',
      targetId: 'B',
      after: false,
      expectedRevision: 0,
    });
    expect(result.status).toBe('persisted');
    const projects = ['B', 'C'].map((id) => store.state.project.entities[id]!);
    expect(
      buildPersonalOverview(projects, []).groups[4].rows.map((row) => row.project.id),
    ).toEqual(['C', 'B']);
  });

  it('rejects moves across categories and compensates a failed order write', async () => {
    setup(
      [],
      [
        makeProject('A', 'Alpha', []),
        makeProject('B', 'Beta', []),
        makeProject('C', 'Gamma', []),
      ],
    );
    await service.setProjectQuadrant({
      operationId: 'classify-c',
      projectId: 'C',
      expectedRevision: 0,
      quadrant: 'important',
    });
    const cross = await orderService.reorder({
      operationId: 'cross',
      projectId: 'A',
      targetId: 'C',
      after: false,
      expectedRevision: 0,
    });
    expect(cross.status).toBe('rejected');
    let calls = 0;
    flush.createCommandReceipt.and.callFake(() =>
      ++calls === 1 ? Promise.reject(new Error('disk full')) : Promise.resolve(),
    );
    const failed = await orderService.reorder({
      operationId: 'failed-move',
      projectId: 'B',
      targetId: 'A',
      after: false,
      expectedRevision: 0,
    });
    expect(failed.status).toBe('failed');
    expect(
      store.state.project.entities.B!.personalProgress?.overviewOrder,
    ).toBeUndefined();
  });

  it('supports explicit clearing back to unclassified', async () => {
    setup([], [makeProject('A', 'Alpha', [])]);
    await service.setProjectQuadrant({
      operationId: 'classify',
      projectId: 'A',
      expectedRevision: 0,
      quadrant: 'important',
    });
    const cleared = await service.setProjectQuadrant({
      operationId: 'clear',
      projectId: 'A',
      expectedRevision: 1,
      quadrant: null,
    });
    expect(cleared.status).toBe('persisted');
    const q = store.state.project.entities.A!.personalProgress?.quadrant;
    expect(q?.value).toBeNull();
    expect(q?.revision).toBe(2);
    expect(q?.operationId).toBe('clear');
  });

  it('rejects invalid values and unavailable projects', async () => {
    setup(
      [],
      [
        makeProject('A', 'Alpha', []),
        makeProject(INBOX_PROJECT.id, 'Inbox', []),
        makeProject('Archived', 'Archived', [], true),
      ],
    );
    const invalid = await service.setProjectQuadrant({
      operationId: 'bad-value',
      projectId: 'A',
      expectedRevision: 0,
      quadrant: 'bad' as never,
    });
    expect(invalid.status).toBe('rejected');
    if (invalid.status === 'rejected') expect(invalid.code).toBe('INVALID_INPUT');

    const inbox = await service.setProjectQuadrant({
      operationId: 'inbox',
      projectId: INBOX_PROJECT.id,
      expectedRevision: 0,
      quadrant: 'neither',
    });
    expect(inbox.status).toBe('rejected');
    if (inbox.status === 'rejected') expect(inbox.code).toBe('PROJECT_UNAVAILABLE');

    const archived = await service.setProjectQuadrant({
      operationId: 'archived',
      projectId: 'Archived',
      expectedRevision: 0,
      quadrant: 'neither',
    });
    expect(archived.status).toBe('rejected');
    if (archived.status === 'rejected') expect(archived.code).toBe('PROJECT_UNAVAILABLE');

    const missing = await service.setProjectQuadrant({
      operationId: 'missing',
      projectId: 'Missing',
      expectedRevision: 0,
      quadrant: 'neither',
    });
    expect(missing.status).toBe('rejected');
    if (missing.status === 'rejected') expect(missing.code).toBe('NOT_FOUND');
  });

  it('keeps manual records and unknown fields when a classification save fails', async () => {
    const project = {
      ...makeProject('A', 'Alpha', []),
      personalProgress: {
        schemaVersion: 1,
        entries: [],
        futureField: 'keep-this',
      } as unknown as PersonalProgressOnProject,
    } as Project;
    setup([], [project]);
    let receiptCalls = 0;
    flush.createCommandReceipt.and.callFake(() => {
      receiptCalls += 1;
      return receiptCalls === 1
        ? Promise.reject(new Error('disk full'))
        : Promise.resolve();
    });

    const result = await service.setProjectQuadrant({
      operationId: 'failing-classification',
      projectId: 'A',
      expectedRevision: 0,
      quadrant: 'urgent',
    });
    expect(result.status).toBe('failed');
    const current = store.state.project.entities.A!.personalProgress as
      | PersonalProgressOnProject
      | undefined;
    expect(current?.quadrant).toBeUndefined();
    expect((current as unknown as { futureField?: string })?.futureField).toBe(
      'keep-this',
    );
  });

  it('creates a routine item in one addProject write and rejects a type-conflicting retry', async () => {
    setup([], []);
    const first = await service.createProject('routine-create', 'Routine A', 'routine');
    expect(first.status).toBe('persisted');
    const project = store.state.project.entities['pp-project-routine-create']!;
    const personal = project.personalProgress as PersonalProgressOnProject;
    expect(project.isHiddenFromMenu).toBeTrue();
    expect(personal.kind).toBe('routine');
    expect(personal.entries).toEqual([]);
    expect(typeof personal.createdAt).toBe('number');
    expect(project.taskIds).toEqual([]);
    const adds = store.actions.filter((a) => a.type === '[Project] Add Project');
    expect(adds.length).toBe(1);

    expect(
      (await service.createProject('routine-create', 'Routine A', 'routine')).status,
    ).toBe('persisted');
    expect(store.actions.filter((a) => a.type === '[Project] Add Project').length).toBe(
      1,
    );

    const conflict = await service.createProject(
      'routine-create',
      'Project A',
      'project',
    );
    expect(conflict.status).toBe('rejected');
    if (conflict.status === 'rejected') expect(conflict.code).toBe('TYPE_CONFLICT');
  });

  it('adds and edits routine entries with owner-kind and revision checks', async () => {
    const routine = makeRoutineProject('R', 'Routine');
    const normal = makeProject('P', 'Normal', []);
    setup([], [routine, normal]);
    const operationId = 'routine-add';
    const added = await service.addEntry({
      operationId,
      projectId: 'R',
      recordDay: today(),
      body: '  first observation  ',
      ownerKind: 'routine',
    });
    expect(added.status).toBe('persisted');
    if (added.status !== 'persisted') return;
    const entry = (
      store.state.project.entities.R!.personalProgress as PersonalProgressOnProject
    ).entries.find((e) => e.id === added.value.entryId)!;
    expect(entry.body).toBe('first observation');
    expect(entry.projectId).toBe('R');

    const wrongRoutineOwner = await service.addEntry({
      operationId: 'wrong-routine-owner',
      projectId: 'R',
      recordDay: today(),
      body: 'no',
      ownerKind: 'project',
    });
    expect(wrongRoutineOwner.status).toBe('rejected');
    if (wrongRoutineOwner.status === 'rejected')
      expect(wrongRoutineOwner.code).toBe('TYPE_CONFLICT');

    const wrongProjectOwner = await service.addEntry({
      operationId: 'wrong-project-owner',
      projectId: 'P',
      recordDay: today(),
      body: 'no',
      ownerKind: 'routine',
    });
    expect(wrongProjectOwner.status).toBe('rejected');
    if (wrongProjectOwner.status === 'rejected')
      expect(wrongProjectOwner.code).toBe('TYPE_CONFLICT');

    const edited = await service.editEntry({
      operationId: 'routine-edit-1',
      projectId: 'R',
      entryId: entry.id,
      expectedRevision: entry.revision,
      body: 'corrected observation',
      ownerKind: 'routine',
    });
    expect(edited.status).toBe('persisted');
    const afterEdit = (
      store.state.project.entities.R!.personalProgress as PersonalProgressOnProject
    ).entries.find((e) => e.id === entry.id)!;
    expect(afterEdit.body).toBe('corrected observation');
    expect(afterEdit.revision).toBe(2);
    expect(afterEdit.recordDay).toBe(entry.recordDay);

    const stale = await service.editEntry({
      operationId: 'routine-stale',
      projectId: 'R',
      entryId: entry.id,
      expectedRevision: 1,
      body: 'stale',
      ownerKind: 'routine',
    });
    expect(stale.status).toBe('rejected');
    if (stale.status === 'rejected') expect(stale.code).toBe('STALE_REVISION');
  });

  it('requires history editing for routine past entries but not for backfilling', async () => {
    setup([], [makeRoutineProject('R', 'Routine')]);
    const past = '2020-01-02';
    const added = await service.addEntry({
      operationId: 'routine-backfill',
      projectId: 'R',
      recordDay: past,
      body: 'backfilled',
      ownerKind: 'routine',
    });
    expect(added.status).toBe('persisted');
    if (added.status !== 'persisted') return;
    const entry = (
      store.state.project.entities.R!.personalProgress as PersonalProgressOnProject
    ).entries.find((e) => e.id === added.value.entryId)!;
    const locked = await service.editEntry({
      operationId: 'routine-locked',
      projectId: 'R',
      entryId: entry.id,
      expectedRevision: entry.revision,
      body: 'changed',
      ownerKind: 'routine',
    });
    expect(locked.status).toBe('rejected');
    if (locked.status === 'rejected') expect(locked.code).toBe('HISTORY_LOCKED');
    service.setHistoryEditing(true);
    const unlocked = await service.editEntry({
      operationId: 'routine-unlocked',
      projectId: 'R',
      entryId: entry.id,
      expectedRevision: entry.revision,
      body: 'changed',
      ownerKind: 'routine',
    });
    expect(unlocked.status).toBe('persisted');
    expect(
      (store.state.project.entities.R!.personalProgress as PersonalProgressOnProject)
        .entries[0].recordDay,
    ).toBe(past);
  });

  it('rejects invalid routine dates, archived owners and step/quadrant commands', async () => {
    const routine = makeRoutineProject('R', 'Routine');
    const archived = {
      ...makeRoutineProject('AR', 'Archived routine'),
      isArchived: true,
    } as Project;
    setup([], [routine, archived]);
    const future = await service.addEntry({
      operationId: 'routine-future',
      projectId: 'R',
      recordDay: '2999-01-01',
      body: 'future',
      ownerKind: 'routine',
    });
    expect(future.status).toBe('rejected');
    if (future.status === 'rejected') expect(future.code).toBe('INVALID_INPUT');

    const invalidDay = await service.addEntry({
      operationId: 'routine-invalid-day',
      projectId: 'R',
      recordDay: '2026-02-31',
      body: 'invalid',
      ownerKind: 'routine',
    });
    expect(invalidDay.status).toBe('rejected');

    const empty = await service.addEntry({
      operationId: 'routine-empty',
      projectId: 'R',
      recordDay: today(),
      body: '   ',
      ownerKind: 'routine',
    });
    expect(empty.status).toBe('rejected');

    const archivedAdd = await service.addEntry({
      operationId: 'routine-archived',
      projectId: 'AR',
      recordDay: today(),
      body: 'no',
      ownerKind: 'routine',
    });
    expect(archivedAdd.status).toBe('rejected');
    if (archivedAdd.status === 'rejected')
      expect(archivedAdd.code).toBe('PROJECT_UNAVAILABLE');

    const addStep = await service.addStep('routine-step', 'R', 'not a step');
    expect(addStep.status).toBe('rejected');
    if (addStep.status === 'rejected') expect(addStep.code).toBe('TYPE_CONFLICT');

    const quadrant = await service.setProjectQuadrant({
      operationId: 'routine-quadrant',
      projectId: 'R',
      expectedRevision: 0,
      quadrant: 'important',
    });
    expect(quadrant.status).toBe('rejected');
    if (quadrant.status === 'rejected') expect(quadrant.code).toBe('TYPE_CONFLICT');
  });

  it('rejects residual step and entry commands after a project is archived', async () => {
    const task = makeTask('a1', 'Archived', 'Kept step');
    const archived = makeProject('Archived', 'Archived', ['a1'], true);
    setup([task], [archived]);
    const completed = await service.completeStep({
      operationId: 'archived-complete',
      projectId: 'Archived',
      stepId: 'a1',
      recordDay: today(),
    });
    expect(completed.status).toBe('rejected');
    if (completed.status === 'rejected')
      expect(completed.code).toBe('PROJECT_UNAVAILABLE');

    const added = await service.addStep('archived-step', 'Archived', 'no');
    expect(added.status).toBe('rejected');
    if (added.status === 'rejected') expect(added.code).toBe('PROJECT_UNAVAILABLE');

    const edited = await service.editStep({
      operationId: 'archived-edit-step',
      projectId: 'Archived',
      stepId: 'a1',
      expectedTitle: 'Kept step',
      expectedRevision: 0,
      title: 'changed',
    });
    expect(edited.status).toBe('rejected');
    if (edited.status === 'rejected') expect(edited.code).toBe('PROJECT_UNAVAILABLE');

    const entry = await service.addEntry({
      operationId: 'archived-entry',
      projectId: 'Archived',
      recordDay: today(),
      body: 'no',
    });
    expect(entry.status).toBe('rejected');
    if (entry.status === 'rejected') expect(entry.code).toBe('PROJECT_UNAVAILABLE');

    const quadrant = await service.setProjectQuadrant({
      operationId: 'archived-quadrant',
      projectId: 'Archived',
      expectedRevision: 0,
      quadrant: 'important',
    });
    expect(quadrant.status).toBe('rejected');
    if (quadrant.status === 'rejected') expect(quadrant.code).toBe('PROJECT_UNAVAILABLE');
  });

  it('compensates only a failed routine add and preserves other fields', async () => {
    const existing = makeEntry('e1', 'R', '2026-10-20', 'keep me');
    const routine = makeRoutineProject('R', 'Routine', [existing], {
      quadrant: { value: 'important', revision: 2, operationId: 'q' },
      futureField: 'keep-this-too',
    });
    setup([], [routine]);
    let calls = 0;
    flush.createCommandReceipt.and.callFake(() => {
      calls += 1;
      return calls === 1 ? Promise.reject(new Error('disk full')) : Promise.resolve();
    });
    const result = await service.addEntry({
      operationId: 'routine-failing-add',
      projectId: 'R',
      recordDay: today(),
      body: 'will fail',
      ownerKind: 'routine',
    });
    expect(result.status).toBe('failed');
    const current = store.state.project.entities.R!.personalProgress as
      | (PersonalProgressOnProject & { futureField?: string })
      | undefined;
    expect(current?.entries.map((e) => e.body)).toEqual(['keep me']);
    expect(current?.kind).toBe('routine');
    expect(current?.quadrant?.value).toBe('important');
    expect(current?.futureField).toBe('keep-this-too');
  });

  it('compensates only a failed routine edit and leaves other entries untouched', async () => {
    const first = makeEntry('e1', 'R', '2026-10-20', 'one');
    const second = makeEntry('e2', 'R', '2026-10-21', 'two');
    const routine = makeRoutineProject('R', 'Routine', [first, second], {
      futureField: 'keep',
    });
    setup([], [routine]);
    service.setHistoryEditing(true);
    let calls = 0;
    flush.createCommandReceipt.and.callFake(() => {
      calls += 1;
      return calls === 1 ? Promise.reject(new Error('disk full')) : Promise.resolve();
    });
    const result = await service.editEntry({
      operationId: 'routine-failing-edit',
      projectId: 'R',
      entryId: first.id,
      expectedRevision: first.revision,
      body: 'changed',
      ownerKind: 'routine',
    });
    expect(result.status).toBe('failed');
    const current = store.state.project.entities.R!.personalProgress as
      | (PersonalProgressOnProject & { futureField?: string })
      | undefined;
    expect(current?.entries.map((e) => e.body)).toEqual(['one', 'two']);
    expect(current?.entries[0].revision).toBe(1);
    expect(current?.kind).toBe('routine');
    expect(current?.futureField).toBe('keep');
  });

  it('does not duplicate a routine add when the same command is retried', async () => {
    setup([], [makeRoutineProject('R', 'Routine')]);
    const input = {
      operationId: 'routine-same-add',
      projectId: 'R',
      recordDay: today(),
      body: 'once',
      ownerKind: 'routine' as const,
    };
    const first = await service.addEntry(input);
    const second = await service.addEntry(input);
    expect(first.status).toBe('persisted');
    expect(second.status).toBe('persisted');
    const entries = (
      store.state.project.entities.R!.personalProgress as PersonalProgressOnProject
    ).entries;
    expect(entries.length).toBe(1);
    expect(
      store.actions.filter((a) => a.type === '[Project] Update Project').length,
    ).toBe(1);
  });

  it('rejects an old routine edit after a later edit restored the original body', async () => {
    setup([], [makeRoutineProject('R', 'Routine')]);
    const added = await service.addEntry({
      operationId: 'routine-edit-base',
      projectId: 'R',
      recordDay: today(),
      body: 'original',
      ownerKind: 'routine',
    });
    expect(added.status).toBe('persisted');
    if (added.status !== 'persisted') return;
    expect(
      (
        await service.editEntry({
          operationId: 'routine-edit-first',
          projectId: 'R',
          entryId: added.value.entryId,
          expectedRevision: 1,
          body: 'different',
          ownerKind: 'routine',
        })
      ).status,
    ).toBe('persisted');
    expect(
      (
        await service.editEntry({
          operationId: 'routine-edit-revert',
          projectId: 'R',
          entryId: added.value.entryId,
          expectedRevision: 2,
          body: 'original',
          ownerKind: 'routine',
        })
      ).status,
    ).toBe('persisted');
    const stale = await service.editEntry({
      operationId: 'routine-edit-first',
      projectId: 'R',
      entryId: added.value.entryId,
      expectedRevision: 1,
      body: 'different',
      ownerKind: 'routine',
    });
    expect(stale.status).toBe('rejected');
    if (stale.status === 'rejected') expect(stale.code).toBe('STALE_REVISION');
    expect(
      (store.state.project.entities.R!.personalProgress as PersonalProgressOnProject)
        .entries[0].body,
    ).toBe('original');
  });
  it('persists format-only step/entry edits and the completion snapshot', async () => {
    setup([makeTask('a1', 'A', 'One')], [makeProject('A', 'Alpha', ['a1'])]);
    const stepFormat = {
      version: 1 as const,
      runs: [{ text: 'One', bold: true }],
    };
    const stepEdit = await service.editStep({
      operationId: 'format-step',
      projectId: 'A',
      stepId: 'a1',
      expectedTitle: 'One',
      expectedRevision: 0,
      title: 'One',
      format: stepFormat,
    });
    expect(stepEdit.status).toBe('persisted');
    let personal = store.state.task.entities.a1!
      .personalProgress as PersonalProgressOnTask;
    expect(personal.stepEdit?.revision).toBe(1);
    expect(personal.stepFormat).toEqual(stepFormat);

    const completed = await service.completeStep({
      operationId: 'format-complete',
      projectId: 'A',
      stepId: 'a1',
      recordDay: today(),
    });
    expect(completed.status).toBe('persisted');
    personal = store.state.task.entities.a1!.personalProgress as PersonalProgressOnTask;
    expect(personal.entries[0].bodyFormat).toEqual(stepFormat);

    const undone = await service.undoLatestCompletion({
      operationId: 'format-undo',
      projectId: 'A',
    });
    expect(undone.status).toBe('persisted');
    personal = store.state.task.entities.a1!.personalProgress as PersonalProgressOnTask;
    expect(personal.stepFormat).toEqual(stepFormat);

    const added = await service.addEntry({
      operationId: 'format-entry-add',
      projectId: 'A',
      recordDay: today(),
      body: 'Plain',
    });
    if (added.status !== 'persisted') throw new Error('Test setup failed');
    const entryFormat = {
      version: 1 as const,
      runs: [{ text: 'Plain', italic: true, color: 'green' as const }],
    };
    const edited = await service.editEntry({
      operationId: 'format-entry-edit',
      projectId: 'A',
      entryId: added.value.entryId,
      expectedRevision: 1,
      body: 'Plain',
      bodyFormat: entryFormat,
    });
    expect(edited.status).toBe('persisted');
    const entry = store.state.project.entities.A!.personalProgress!.entries.find(
      (candidate) => candidate.id === added.value.entryId,
    )!;
    expect(entry.revision).toBe(2);
    expect(entry.bodyFormat).toEqual(entryFormat);
  });

  it('does not leave a half-created formatted step when the single batch write fails', async () => {
    setup([], [makeProject('A', 'Alpha', [])]);
    flush.createCommandReceipt.and.returnValue(Promise.reject(new Error('disk full')));
    const result = await service.insertStepAfter({
      operationId: 'failed-single-step',
      projectId: 'A',
      afterStepId: null,
      title: 'One',
      format: {
        version: 1,
        runs: [{ text: 'One', bold: true }],
      },
    });
    expect(result.status).toBe('failed');
    expect(store.state.task.entities['pp-step-failed-single-step']).toBeUndefined();
    expect(store.state.project.entities.A!.taskIds).toEqual([]);
  });
  it('creates a formatted step with one batch action and idempotent retry', async () => {
    setup([], [makeProject('A', 'Alpha', [])]);
    const format = {
      version: 1 as const,
      runs: [{ text: 'One', bold: true, color: 'blue' as const }],
    };
    const input = {
      operationId: 'single-op-step',
      projectId: 'A',
      afterStepId: null,
      title: 'One',
      format,
    };
    const first = await service.insertStepAfter(input);
    expect(first.status).toBe('persisted');
    expect(store.actions.length).toBe(1);
    const action = store.actions[0] as unknown as {
      type: string;
      createdTaskPersonalProgress?: Record<string, PersonalProgressOnTask>;
    };
    expect(action.type).toBe('[Task Shared] batchUpdateForProject');
    expect(action.createdTaskPersonalProgress?.['pp-step-single-op-step']).toEqual({
      schemaVersion: 1,
      entries: [],
      completions: [],
      stepFormat: format,
    });
    expect(store.state.task.entities['pp-step-single-op-step']!.personalProgress).toEqual(
      action.createdTaskPersonalProgress?.['pp-step-single-op-step'],
    );

    const retry = await service.insertStepAfter(input);
    expect(retry.status).toBe('persisted');
    expect(store.actions.length).toBe(1);
  });

  it('compensates bodyFormat and leaves concurrent records untouched on failure', async () => {
    const blue = {
      version: 1 as const,
      runs: [{ text: 'one', color: 'blue' as const }],
    };
    const entry = {
      ...makeEntry('e1', 'A', '2026-10-20', 'one'),
      bodyFormat: blue,
    };
    const other = makeEntry('e2', 'A', '2026-10-20', 'two');
    const project = {
      ...makeProject('A', 'Alpha', []),
      personalProgress: {
        schemaVersion: 1 as const,
        entries: [entry, other],
      },
    };
    setup([], [project]);
    service.setHistoryEditing(true);
    flush.createCommandReceipt.and.callFake(() => Promise.reject(new Error('disk full')));
    const result = await service.editEntry({
      operationId: 'format-failing-edit',
      projectId: 'A',
      entryId: entry.id,
      expectedRevision: entry.revision,
      body: 'one',
      bodyFormat: {
        version: 1,
        runs: [{ text: 'one', color: 'red' }],
      },
    });
    expect(result.status).toBe('failed');
    const entries = store.state.project.entities.A!.personalProgress!.entries;
    expect(entries[0].body).toBe('one');
    expect(entries[0].bodyFormat).toEqual(blue);
    expect(entries[0].revision).toBe(entry.revision);
    expect(entries[1]).toEqual(other);
  });
});

describe('buildPersonalProgressView', () => {
  it('retains completion records after the upstream task archive removes taskIds', () => {
    const archived = makeTask('a1', 'A', 'Archived step', {
      isDone: true,
      personalProgress: {
        schemaVersion: 1,
        completions: [],
        entries: [
          {
            id: 'e-archive',
            projectId: 'A',
            stepId: 'a1',
            recordDay: '2026-01-01',
            body: 'Historical completed work',
            source: 'step-completion',
            createdAt: 1,
            updatedAt: 1,
            revision: 1,
            operationId: 'archived-completion',
          },
        ],
      },
    });
    const view = buildPersonalProgressView(
      [makeProject('A', 'Alpha', [])],
      [],
      [archived],
      '2026-01-02',
    );
    expect(view.dates).toEqual(['2026-01-01', '2026-01-02']);
    expect(view.rows[0].entriesByDay.get('2026-01-01')?.[0].body).toBe(
      'Historical completed work',
    );
    expect(view.rows[0].steps).toEqual([]);
    const collapsed = buildPersonalProgressView(
      [makeProject('A', 'Alpha', [])],
      [],
      [archived],
      '2026-01-02',
      new Set(['A']),
    );
    expect(collapsed.dates).toEqual(['2026-01-02']);
    expect(collapsed.rows[0].isExpanded).toBeFalse();
    expect(collapsed.rows[0].completionEntries[0].body).toBe('Historical completed work');
  });

  it('merges manual and completion entries into sorted dates and derives Roman numerals', () => {
    const a1 = makeTask('a1', 'A', 'One');
    const a2 = makeTask('a2', 'A', 'Two', { isDone: true });
    const project: Project = {
      ...makeProject('A', 'Alpha', ['a1', 'a2']),
      personalProgress: {
        schemaVersion: 1,
        entries: [
          {
            id: 'e1',
            projectId: 'A',
            recordDay: '2026-01-01',
            body: 'manual',
            source: 'manual',
            createdAt: 1,
            updatedAt: 1,
            revision: 1,
            operationId: 'o1',
          },
        ],
      },
    };
    const doneTask: Task = {
      ...a2,
      personalProgress: {
        schemaVersion: 1,
        entries: [
          {
            id: 'e2',
            projectId: 'A',
            stepId: 'a2',
            recordDay: '2026-01-02',
            body: 'completed',
            source: 'step-completion',
            createdAt: 2,
            updatedAt: 2,
            revision: 1,
            operationId: 'o2',
          },
        ],
        completions: [],
      },
    };

    const view = buildPersonalProgressView([project], [a1, doneTask], [], '2026-01-03');

    expect(view.dates).toEqual(['2026-01-01', '2026-01-02', '2026-01-03']);
    expect(view.rows[0].steps.length).toBe(1);
    expect(view.rows[0].steps[0].roman).toBe('Ⅰ');
    expect(view.rows[0].entriesByDay.get('2026-01-02')![0].body).toBe('completed');
  });
});
