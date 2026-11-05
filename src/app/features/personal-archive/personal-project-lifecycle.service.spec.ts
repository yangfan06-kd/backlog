import { TestBed } from '@angular/core/testing';
import { Action, Store } from '@ngrx/store';
import { of } from 'rxjs';
import { OperationWriteFlushService } from '../../op-log/sync/operation-write-flush.service';
import { DEFAULT_PROJECT, INBOX_PROJECT } from '../project/project.const';
import { Project, ProjectState } from '../project/project.model';
import { PersonalProjectLifecycleService } from './personal-project-lifecycle.service';
import { PersonalProgressOnProject } from '../personal-progress/personal-progress.model';

const projectState = (projects: Project[]): ProjectState => ({
  ids: projects.map((project) => project.id),
  entities: Object.fromEntries(projects.map((project) => [project.id, project])),
});

class FakeStore {
  state: { projects: ProjectState };
  actions: Action[] = [];
  afterDispatch?: (action: Action) => void;

  constructor(projects: Project[]) {
    this.state = { projects: projectState(projects) };
  }

  select = (selector: (state: { projects: ProjectState }) => unknown): unknown =>
    of(
      selector({
        projects: {
          ...this.state.projects,
          ids: [...(this.state.projects.ids as string[])],
          entities: { ...this.state.projects.entities },
        },
      }),
    );

  dispatch = (action: Action): void => {
    this.actions.push(action);
    const a = action as unknown as {
      type: string;
      project?: { id: string; changes: Partial<Project> };
    };
    if (a.type === '[Project] Update Project' && a.project) {
      const existing = this.state.projects.entities[a.project.id];
      if (existing) {
        this.state.projects.entities[a.project.id] = {
          ...existing,
          ...a.project.changes,
        };
      }
    }
    this.afterDispatch?.(action);
  };
}

const makeProject = (
  id: string,
  extra: Partial<Project> = {},
  personalProgress?: PersonalProgressOnProject,
): Project =>
  ({
    ...DEFAULT_PROJECT,
    id,
    title: id,
    taskIds: [],
    backlogTaskIds: [],
    noteIds: [],
    ...(personalProgress ? { personalProgress } : {}),
    ...extra,
  }) as Project;

const flushMock = (): {
  createCommandReceipt: jasmine.Spy;
  settleCommandReceipt: jasmine.Spy;
} => ({
  createCommandReceipt: jasmine.createSpy('createCommandReceipt').and.resolveTo(),
  settleCommandReceipt: jasmine.createSpy('settleCommandReceipt'),
});

describe('PersonalProjectLifecycleService', () => {
  let store: FakeStore;
  let service: PersonalProjectLifecycleService;
  let flush: ReturnType<typeof flushMock>;

  const setup = (projects: Project[]): void => {
    store = new FakeStore(projects);
    flush = flushMock();
    TestBed.configureTestingModule({
      providers: [
        PersonalProjectLifecycleService,
        { provide: Store, useValue: store as unknown as Store },
        { provide: OperationWriteFlushService, useValue: flush },
      ],
    });
    service = TestBed.inject(PersonalProjectLifecycleService);
  };

  it('finishes with one project update and preserves all non-root fields', async () => {
    const entries = [
      {
        id: 'e1',
        projectId: 'A',
        recordDay: '2026-10-20',
        body: 'keep',
        source: 'manual' as const,
        createdAt: 1,
        updatedAt: 1,
        revision: 1,
        operationId: 'op-e1',
      },
    ];
    const personal: PersonalProgressOnProject & { unknownField: string } = {
      schemaVersion: 1,
      entries,
      quadrant: { value: 'important', revision: 3, operationId: 'q' },
      unknownField: 'keep',
    };
    setup([makeProject('A', { taskIds: ['a1'], noteIds: ['n1'] }, personal)]);
    const result = await service.finishProject({
      operationId: 'finish-1',
      projectId: 'A',
      expectedRevision: 0,
    });
    expect(result.status).toBe('persisted');
    const project = store.state.projects.entities.A!;
    expect(project.isArchived).toBeTrue();
    expect(project.isDone).toBeTrue();
    expect(typeof project.doneOn).toBe('number');
    expect(project.taskIds).toEqual(['a1']);
    expect(project.noteIds).toEqual(['n1']);
    const next = project.personalProgress as PersonalProgressOnProject & {
      unknownField: string;
    };
    expect(next.entries).toEqual(entries);
    expect(next.quadrant?.value).toBe('important');
    expect(next.unknownField).toBe('keep');
    expect(next.lifecycle).toEqual({
      revision: 1,
      operationId: 'finish-1',
      action: 'finish',
    });
    expect(store.actions.length).toBe(1);
    expect((store.actions[0] as unknown as { isSkipSnack?: boolean }).isSkipSnack).toBe(
      true,
    );
  });

  it('is idempotent for the same finish command and rejects stale old commands', async () => {
    setup([makeProject('A', { taskIds: ['a1'] })]);
    expect(
      (
        await service.finishProject({
          operationId: 'finish-1',
          projectId: 'A',
          expectedRevision: 0,
        })
      ).status,
    ).toBe('persisted');
    expect(
      (
        await service.finishProject({
          operationId: 'finish-1',
          projectId: 'A',
          expectedRevision: 0,
        })
      ).status,
    ).toBe('persisted');
    expect(store.actions.length).toBe(1);
    const stale = await service.finishProject({
      operationId: 'finish-2',
      projectId: 'A',
      expectedRevision: 0,
    });
    expect(stale.status).toBe('rejected');
    if (stale.status === 'rejected') expect(stale.code).toBe('STALE_REVISION');
    const already = await service.finishProject({
      operationId: 'finish-3',
      projectId: 'A',
      expectedRevision: 1,
    });
    expect(already.status).toBe('rejected');
    if (already.status === 'rejected') expect(already.code).toBe('ALREADY_DONE');
  });

  it('restores root flags and keeps task/order/entries/category data', async () => {
    setup([
      makeProject(
        'A',
        { taskIds: ['a1'], isArchived: true, isDone: true, doneOn: 1000 },
        {
          schemaVersion: 1,
          entries: [],
          quadrant: { value: 'urgent', revision: 1, operationId: 'q' },
          lifecycle: { revision: 1, operationId: 'finish-old', action: 'finish' },
        },
      ),
    ]);
    const result = await service.restoreProject({
      operationId: 'restore-1',
      projectId: 'A',
      expectedRevision: 1,
    });
    expect(result.status).toBe('persisted');
    const project = store.state.projects.entities.A!;
    expect(project.isArchived).toBeFalse();
    expect(project.isDone).toBeFalse();
    expect(project.doneOn).toBeNull();
    expect(project.taskIds).toEqual(['a1']);
    expect(project.personalProgress?.quadrant?.value).toBe('urgent');
    expect(project.personalProgress?.lifecycle?.action).toBe('restore');
  });

  it('rejects invalid owner types, inbox, missing and mismatched state', async () => {
    setup([
      makeProject('A'),
      makeProject('R', {}, { schemaVersion: 1, entries: [], kind: 'routine' }),
      INBOX_PROJECT,
    ]);
    const routine = await service.finishProject({
      operationId: 'routine',
      projectId: 'R',
      expectedRevision: 0,
    });
    expect(routine.status).toBe('rejected');
    if (routine.status === 'rejected') expect(routine.code).toBe('TYPE_CONFLICT');
    const inbox = await service.finishProject({
      operationId: 'inbox',
      projectId: INBOX_PROJECT.id,
      expectedRevision: 0,
    });
    expect(inbox.status).toBe('rejected');
    if (inbox.status === 'rejected') expect(inbox.code).toBe('PROJECT_UNAVAILABLE');
    const missing = await service.finishProject({
      operationId: 'missing',
      projectId: 'missing',
      expectedRevision: 0,
    });
    expect(missing.status).toBe('rejected');
    if (missing.status === 'rejected') expect(missing.code).toBe('NOT_FOUND');
    const restoreActive = await service.restoreProject({
      operationId: 'restore-active',
      projectId: 'A',
      expectedRevision: 0,
    });
    expect(restoreActive.status).toBe('rejected');
    if (restoreActive.status === 'rejected')
      expect(restoreActive.code).toBe('NOT_ARCHIVED');
  });

  it('rejects old finish/restore commands after a later lifecycle action', async () => {
    setup([makeProject('A')]);
    expect(
      (
        await service.finishProject({
          operationId: 'finish-1',
          projectId: 'A',
          expectedRevision: 0,
        })
      ).status,
    ).toBe('persisted');
    expect(
      (
        await service.restoreProject({
          operationId: 'restore-1',
          projectId: 'A',
          expectedRevision: 1,
        })
      ).status,
    ).toBe('persisted');
    expect(
      (
        await service.finishProject({
          operationId: 'finish-2',
          projectId: 'A',
          expectedRevision: 2,
        })
      ).status,
    ).toBe('persisted');
    const oldFinish = await service.finishProject({
      operationId: 'finish-1',
      projectId: 'A',
      expectedRevision: 0,
    });
    expect(oldFinish.status).toBe('rejected');
    if (oldFinish.status === 'rejected') expect(oldFinish.code).toBe('STALE_REVISION');
    const oldRestore = await service.restoreProject({
      operationId: 'restore-1',
      projectId: 'A',
      expectedRevision: 1,
    });
    expect(oldRestore.status).toBe('rejected');
    if (oldRestore.status === 'rejected') expect(oldRestore.code).toBe('STALE_REVISION');
  });

  it('compensates only root/lifecycle fields after a failed write', async () => {
    setup([
      makeProject('A', { taskIds: ['a1'] }, {
        schemaVersion: 1,
        entries: [],
        quadrant: { value: 'neither', revision: 1, operationId: 'q' },
        futureField: 'keep',
      } as PersonalProgressOnProject),
    ]);
    let calls = 0;
    flush.createCommandReceipt.and.callFake(() => {
      calls += 1;
      return calls === 1 ? Promise.reject(new Error('disk full')) : Promise.resolve();
    });
    store.afterDispatch = (action) => {
      if (
        action.type === '[Project] Update Project' &&
        (action as unknown as { project: { changes: { isArchived?: boolean } } }).project
          .changes.isArchived
      ) {
        const current = store.state.projects.entities.A!;
        const data = current.personalProgress as PersonalProgressOnProject;
        store.state.projects.entities.A = {
          ...current,
          personalProgress: {
            ...data,
            entries: [
              ...data.entries,
              {
                id: 'concurrent',
                projectId: 'A',
                recordDay: '2026-10-21',
                body: 'concurrent record',
                source: 'manual',
                createdAt: 2,
                updatedAt: 2,
                revision: 1,
                operationId: 'concurrent',
              },
            ],
          },
        };
        store.afterDispatch = undefined;
      }
    };
    const result = await service.finishProject({
      operationId: 'finish-fail',
      projectId: 'A',
      expectedRevision: 0,
    });
    expect(result.status).toBe('failed');
    const project = store.state.projects.entities.A!;
    expect(project.isArchived).toBeFalse();
    expect(project.isDone).toBeFalse();
    expect(project.doneOn).toBeNull();
    expect(project.taskIds).toEqual(['a1']);
    expect(project.personalProgress?.quadrant?.value).toBe('neither');
    expect(
      (project.personalProgress as PersonalProgressOnProject & { futureField: string })
        .futureField,
    ).toBe('keep');
    expect(project.personalProgress?.entries[0].body).toBe('concurrent record');
    expect(project.personalProgress?.lifecycle).toBeUndefined();
  });

  it('does not overwrite a newer root lifecycle change after a late failure', async () => {
    setup([makeProject('A')]);
    flush.createCommandReceipt.and.returnValue(Promise.reject(new Error('late failure')));
    store.afterDispatch = (action) => {
      if (
        action.type === '[Project] Update Project' &&
        (action as unknown as { project: { changes: { isArchived?: boolean } } }).project
          .changes.isArchived
      ) {
        const current = store.state.projects.entities.A!;
        store.state.projects.entities.A = {
          ...current,
          isArchived: false,
          isDone: false,
          doneOn: null,
          personalProgress: {
            ...(current.personalProgress as PersonalProgressOnProject),
            lifecycle: {
              revision: 2,
              operationId: 'newer-command',
              action: 'restore',
            },
          },
        };
        store.afterDispatch = undefined;
      }
    };
    const result = await service.finishProject({
      operationId: 'older-command',
      projectId: 'A',
      expectedRevision: 0,
    });
    expect(result.status).toBe('failed');
    const latest = store.state.projects.entities.A!;
    expect(latest.isArchived).toBeFalse();
    expect(latest.isDone).toBeFalse();
    expect(latest.doneOn).toBeNull();
    expect(latest.personalProgress?.lifecycle?.operationId).toBe('newer-command');
  });

  it('continues the shared queue after a rejected lifecycle command', async () => {
    setup([makeProject('A'), makeProject('B')]);
    const rejected = await service.restoreProject({
      operationId: 'restore-active',
      projectId: 'A',
      expectedRevision: 0,
    });
    expect(rejected.status).toBe('rejected');
    const finish = await service.finishProject({
      operationId: 'finish-b',
      projectId: 'B',
      expectedRevision: 0,
    });
    expect(finish.status).toBe('persisted');
    expect(store.state.projects.entities.B!.isArchived).toBeTrue();
  });

  it('rejects a reused command with a different expected revision', async () => {
    setup([makeProject('A')]);
    await service.finishProject({
      operationId: 'finish',
      projectId: 'A',
      expectedRevision: 0,
    });
    const retry = await service.finishProject({
      operationId: 'finish',
      projectId: 'A',
      expectedRevision: 42,
    });
    expect(retry.status).toBe('rejected');
    expect(store.actions.length).toBe(1);
  });

  it('does not persist commands with an empty operation ID', async () => {
    setup([makeProject('A')]);
    const result = await service.finishProject({
      operationId: '',
      projectId: 'A',
      expectedRevision: 0,
    });
    expect(result.status).toBe('rejected');
    expect(store.actions.length).toBe(0);
  });

  it('rejects malformed persisted lifecycle markers instead of incrementing them', async () => {
    setup([
      makeProject(
        'A',
        { isArchived: true, isDone: true, doneOn: 100 },
        {
          schemaVersion: 1,
          entries: [],
          lifecycle: { revision: 1.5, operationId: 'finish', action: 'finish' },
        },
      ),
    ]);
    const result = await service.finishProject({
      operationId: 'finish',
      projectId: 'A',
      expectedRevision: 0,
    });
    expect(result.status).toBe('rejected');
    expect(store.actions.length).toBe(0);
  });

  it('does not call a finish retry persisted when its root completion time is invalid', async () => {
    setup([
      makeProject(
        'A',
        { isArchived: true, isDone: true, doneOn: NaN },
        {
          schemaVersion: 1,
          entries: [],
          lifecycle: { revision: 1, operationId: 'finish', action: 'finish' },
        },
      ),
    ]);
    const result = await service.finishProject({
      operationId: 'finish',
      projectId: 'A',
      expectedRevision: 0,
    });
    expect(result.status).toBe('rejected');
    expect(store.actions.length).toBe(0);
  });
});
