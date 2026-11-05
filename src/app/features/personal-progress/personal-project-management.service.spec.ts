import { TestBed } from '@angular/core/testing';
import { Action, Store } from '@ngrx/store';
import { of } from 'rxjs';
import { DEFAULT_PROJECT, INBOX_PROJECT } from '../project/project.const';
import { Project, ProjectState } from '../project/project.model';
import { OperationWriteFlushService } from '../../op-log/sync/operation-write-flush.service';
import {
  ManageProjectInput,
  PersonalProjectManagementService,
} from './personal-project-management.service';
import { buildPersonalArchiveView } from '../personal-archive/personal-archive.view';
import { buildPersonalOverview } from '../personal-overview/personal-overview.view';

class ProjectStore {
  project: Project = {
    ...DEFAULT_PROJECT,
    id: 'A',
    title: '项目 A',
    taskIds: ['step-a'],
    backlogTaskIds: [],
    noteIds: ['note-a'],
  };
  select = (selector: (state: { projects: ProjectState }) => unknown): unknown =>
    of(
      selector({
        projects: {
          ids: [this.project.id],
          entities: { [this.project.id]: this.project },
        },
      }),
    );
  dispatch = (action: Action): void => {
    const update = action as Action & {
      project?: { id: string; changes: Partial<Project> };
    };
    if (update.project) this.project = { ...this.project, ...update.project.changes };
  };
}

describe('PersonalProjectManagementService', () => {
  let store: ProjectStore;
  let service: PersonalProjectManagementService;
  let flush: { createCommandReceipt: jasmine.Spy; settleCommandReceipt: jasmine.Spy };
  const command = (operationId: string, expectedRevision = 0): ManageProjectInput => ({
    operationId,
    expectedRevision,
    projectId: store.project.id,
  });
  beforeEach(() => {
    store = new ProjectStore();
    flush = {
      createCommandReceipt: jasmine.createSpy().and.resolveTo(),
      settleCommandReceipt: jasmine.createSpy(),
    };
    TestBed.configureTestingModule({
      providers: [
        { provide: Store, useValue: store },
        { provide: OperationWriteFlushService, useValue: flush },
      ],
    });
    service = TestBed.inject(PersonalProjectManagementService);
  });

  it('converts in both directions without changing task IDs, plan, category or history', async () => {
    store.project = {
      ...store.project,
      personalProgress: {
        schemaVersion: 1,
        entries: [],
        planning: { day: '2099-01-01', revision: 1, operationId: 'plan' },
      },
    };
    const before = structuredClone(store.project);
    const first = { ...command('convert'), ownerKind: 'project' as const };
    expect((await service.convert(first)).status).toBe('persisted');
    expect(store.project.personalProgress?.kind).toBe('routine');
    expect((await service.convert(first)).status).toBe('persisted');
    expect(store.project.taskIds).toEqual(before.taskIds);
    expect(store.project.personalProgress?.planning).toEqual(
      before.personalProgress?.planning,
    );
    expect(
      (await service.convert({ ...command('back', 1), ownerKind: 'routine' })).status,
    ).toBe('persisted');
    expect(store.project.personalProgress?.kind).toBe('project');
    expect(store.project.personalProgress?.entries).toEqual(
      before.personalProgress?.entries,
    );
  });

  it('rolls conversion back on a failed write and refuses unavailable projects', async () => {
    flush.createCommandReceipt.and.rejectWith(new Error('disk failed'));
    expect((await service.convert(command('convert-fail'))).status).toBe('failed');
    expect(store.project.personalProgress?.kind).toBeUndefined();
    store.project = { ...store.project, isArchived: true };
    expect((await service.convert(command('archived'))).status).toBe('rejected');
  });

  it('renames the existing project and preserves its plan, task order and records', async () => {
    store.project = {
      ...store.project,
      personalProgress: {
        schemaVersion: 1,
        entries: [],
        planning: { day: '2027-02-18', revision: 3, operationId: 'plan' },
      },
    };
    const before = structuredClone(store.project);
    const input = {
      ...command('rename'),
      expectedTitle: before.title,
      title: '  新项目名称  ',
    };
    expect((await service.rename(input)).status).toBe('persisted');
    expect(store.project.id).toBe(before.id);
    expect(store.project.title).toBe('新项目名称');
    expect(store.project.taskIds).toEqual(before.taskIds);
    expect(store.project.noteIds).toEqual(before.noteIds);
    expect(store.project.personalProgress?.entries).toEqual(
      before.personalProgress?.entries,
    );
    expect(store.project.personalProgress?.planning).toEqual(
      before.personalProgress?.planning,
    );
    expect(store.project.personalProgress?.nameEdit?.revision).toBe(1);
    expect((await service.rename(input)).status).toBe('persisted');
    expect(flush.createCommandReceipt.calls.count()).toBe(1);
  });

  it('renames and reversibly deletes routine items only with their explicit owner kind', async () => {
    store.project = {
      ...store.project,
      personalProgress: { schemaVersion: 1, kind: 'routine', entries: [] },
    };
    const before = structuredClone(store.project);
    expect(
      (
        await service.rename({
          ...command('rename-routine'),
          ownerKind: 'routine',
          expectedTitle: before.title,
          title: '常态事项',
        })
      ).status,
    ).toBe('persisted');
    expect(
      (await service.trash({ ...command('trash-routine'), ownerKind: 'routine' })).status,
    ).toBe('persisted');
    expect(store.project.isArchived).toBeTrue();
    expect(store.project.personalProgress?.kind).toBe('routine');
    expect(
      (await service.restore({ ...command('restore-routine', 1), ownerKind: 'routine' }))
        .status,
    ).toBe('persisted');
    expect(store.project.isArchived).toBe(before.isArchived);
    expect(store.project.personalProgress?.entries).toEqual(
      before.personalProgress?.entries,
    );
    expect(
      (
        await service.schedule({
          ...command('no-routine-date'),
          ownerKind: 'routine',
          day: '2027-01-01',
        })
      ).status,
    ).toBe('rejected');
  });

  it('rejects empty names and outdated title snapshots without writing', async () => {
    const input = {
      ...command('rename'),
      expectedTitle: store.project.title,
      title: '新名称',
    };
    expect((await service.rename({ ...input, title: '   ' })).status).toBe('rejected');
    expect(
      (await service.rename({ ...input, expectedTitle: '已经过时的名称' })).status,
    ).toBe('rejected');
    expect(flush.createCommandReceipt).not.toHaveBeenCalled();
    await service.rename(input);
    expect((await service.rename({ ...input, operationId: 'old-command' })).status).toBe(
      'rejected',
    );
  });

  it('keeps the original title after a failed rename write', async () => {
    const before = structuredClone(store.project);
    let calls = 0;
    flush.createCommandReceipt.and.callFake(() =>
      calls++ === 0 ? Promise.reject(new Error('disk full')) : Promise.resolve(),
    );
    expect(
      (
        await service.rename({
          ...command('rename'),
          expectedTitle: before.title,
          title: '未保存的名称',
        })
      ).status,
    ).toBe('failed');
    expect(store.project.title).toBe(before.title);
    expect(store.project.taskIds).toEqual(before.taskIds);
    expect(store.project.personalProgress?.nameEdit).toBeUndefined();
  });

  it('does not rename archived projects or routine items', async () => {
    const input = {
      ...command('rename'),
      expectedTitle: store.project.title,
      title: '新名称',
    };
    store.project = { ...store.project, isArchived: true };
    expect((await service.rename(input)).status).toBe('rejected');
    store.project = {
      ...store.project,
      isArchived: false,
      personalProgress: { schemaVersion: 1, kind: 'routine', entries: [] },
    };
    expect((await service.rename(input)).status).toBe('rejected');
    expect(flush.createCommandReceipt).not.toHaveBeenCalled();
  });

  it('persists a future plan without creating actual records or changing steps', async () => {
    const before = structuredClone(store.project);
    const result = await service.schedule({ ...command('plan'), day: '2027-02-18' });
    expect(result.status).toBe('persisted');
    expect(store.project.personalProgress?.planning?.day).toBe('2027-02-18');
    expect(store.project.personalProgress?.entries).toEqual([]);
    expect(store.project.taskIds).toEqual(before.taskIds);
    expect(store.project.isDone).toBe(before.isDone);
    expect(store.project.doneOn).toBe(before.doneOn);
  });

  it('rejects impossible calendar dates, inbox writes and stale revisions', async () => {
    expect(
      (await service.schedule({ ...command('invalid'), day: '2027-02-30' })).status,
    ).toBe('rejected');
    expect(
      (await service.schedule({ ...command('stale', 2), day: '2027-02-18' })).status,
    ).toBe('rejected');
    store.project = { ...store.project, id: INBOX_PROJECT.id };
    expect((await service.trash(command('inbox'))).status).toBe('rejected');
    expect(flush.createCommandReceipt).not.toHaveBeenCalled();
  });

  it('removes a project from active and completed lists, retaining all data for recovery', async () => {
    const before = structuredClone(store.project);
    expect((await service.trash(command('delete'))).status).toBe('persisted');
    expect(store.project.personalProgress?.trash?.deletedAt).toBeGreaterThan(0);
    expect(store.project.isDone).toBe(before.isDone);
    expect(store.project.taskIds).toEqual(['step-a']);
    expect(store.project.noteIds).toEqual(['note-a']);
    expect(buildPersonalOverview([store.project], []).projectCount).toBe(0);
    expect(buildPersonalArchiveView([store.project], [], []).rows).toEqual([]);
    expect((await service.restore(command('restore', 1))).status).toBe('persisted');
    expect(store.project.isArchived).toBe(before.isArchived);
    expect(store.project.personalProgress?.trash?.deletedAt).toBeNull();
    expect(buildPersonalOverview([store.project], []).projectCount).toBe(1);
  });

  it('does not allow scheduling a deleted project and supports idempotent deletion retry', async () => {
    const input = command('delete');
    await service.trash(input);
    expect((await service.trash(input)).status).toBe('persisted');
    expect(
      (await service.schedule({ ...command('plan'), day: '2027-02-18' })).status,
    ).toBe('rejected');
    expect(flush.createCommandReceipt.calls.count()).toBe(1);
  });

  it('rolls back a failed delete, preserving unrelated metadata and keeping an error result', async () => {
    const before = structuredClone(store.project);
    let calls = 0;
    flush.createCommandReceipt.and.callFake(() =>
      calls++ === 0 ? Promise.reject(new Error('disk full')) : Promise.resolve(),
    );
    const result = await service.trash(command('fail'));
    expect(result.status).toBe('failed');
    expect(store.project.isArchived).toBe(before.isArchived);
    expect(store.project.taskIds).toEqual(before.taskIds);
    expect(store.project.personalProgress?.trash).toBeUndefined();
  });

  it('clears a plan and rejects an outdated recovery operation', async () => {
    await service.schedule({ ...command('plan'), day: '2027-02-18' });
    expect((await service.schedule({ ...command('clear', 1), day: null })).status).toBe(
      'persisted',
    );
    expect(store.project.personalProgress?.planning?.day).toBeNull();
    await service.trash(command('delete'));
    expect((await service.restore(command('stale-recovery', 0))).status).toBe('rejected');
    expect(store.project.isArchived).toBeTrue();
  });
});
