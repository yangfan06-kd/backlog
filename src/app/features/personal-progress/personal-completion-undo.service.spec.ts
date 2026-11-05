import { TestBed } from '@angular/core/testing';
import { PersonalCompletionUndoService } from './personal-completion-undo.service';
import { PersonalCommandCoordinatorService } from './personal-command-coordinator.service';
import { PersonalProgressService } from './personal-progress.service';
import { DEFAULT_PROJECT } from '../project/project.const';
import { Task } from '../tasks/task.model';
import { PersonalProgressOnTask, personalRoman } from './personal-progress.model';

const completed = (n: number, projectId = 'A'): Task =>
  ({
    id: 'step' + n,
    projectId,
    isDone: true,
    personalProgress: {
      schemaVersion: 1,
      entries: [
        {
          id: 'entry' + n,
          projectId,
          body: 'Done',
          source: 'step-completion',
          recordDay: '2026-11-02',
          revision: 1,
          operationId: 'create' + n,
          createdAt: n,
          updatedAt: n,
        },
      ],
      completions: [
        {
          id: 'completion' + n,
          projectId,
          stepId: 'step' + n,
          entryId: 'entry' + n,
          sequence: n,
          entryRevisionAtCompletion: 1,
          operationId: 'complete' + n,
          createdAt: n,
        },
      ],
    },
  }) as Task;

describe('Project-wide completion undo', () => {
  let tasks: Task[], archived: Task[], service: PersonalCompletionUndoService;
  let progress: {
    getProjects: jasmine.Spy;
    getTasks: jasmine.Spy;
    loadArchivedTasks: jasmine.Spy;
    todayStr: () => string;
    isHistoryEditing: boolean;
  };
  let dispatch: jasmine.Spy;
  beforeEach(() => {
    tasks = [completed(1), completed(2), completed(3, 'B')];
    archived = [];
    progress = {
      getProjects: jasmine.createSpy().and.resolveTo([{ ...DEFAULT_PROJECT, id: 'A' }]),
      getTasks: jasmine.createSpy().and.callFake(async () => tasks),
      loadArchivedTasks: jasmine.createSpy().and.callFake(async () => archived),
      todayStr: () => '2026-11-02',
      isHistoryEditing: false,
    };
    dispatch = jasmine
      .createSpy()
      .and.callFake(async (action: { task: { id: string; changes: Partial<Task> } }) => {
        tasks = tasks.map((t) =>
          t.id === action.task.id ? { ...t, ...action.task.changes } : t,
        );
      });
    TestBed.configureTestingModule({
      providers: [
        { provide: PersonalProgressService, useValue: progress },
        {
          provide: PersonalCommandCoordinatorService,
          useValue: {
            enqueue: (fn: () => Promise<unknown>) => fn(),
            dispatchWithReceipt: dispatch,
          },
        },
      ],
    });
    service = TestBed.inject(PersonalCompletionUndoService);
  });
  const input = (
    n: number,
  ): { projectId: string; completionId: string; operationId: string } => ({
    projectId: 'A',
    completionId: 'completion' + n,
    operationId: 'undo' + n,
  });
  it('rejects undo of step1 until step2 is undone, without touching another project', async () => {
    expect((await service.undo(input(1))).status).toBe('rejected');
    expect(dispatch).not.toHaveBeenCalled();
    expect((await service.undo(input(2))).status).toBe('persisted');
    expect((await service.undo(input(1))).status).toBe('persisted');
    expect(tasks.find((t) => t.projectId === 'B')?.isDone).toBeTrue();
  });
  it('does not skip an edited latest completion to undo an older one', async () => {
    const data = tasks[1].personalProgress as PersonalProgressOnTask;
    tasks[1] = {
      ...tasks[1],
      personalProgress: {
        ...data,
        entries: data.entries.map((e) => ({ ...e, revision: 2 })),
      },
    };
    expect((await service.undo(input(2))).status).toBe('rejected');
    expect((await service.undo(input(1))).status).toBe('rejected');
    expect(dispatch).not.toHaveBeenCalled();
  });
  it('rejects an older active completion when a newer one is in the task archive', async () => {
    archived = [completed(4)];
    expect((await service.undo(input(2))).status).toBe('rejected');
  });
  it('requires history permission and remains idempotent after a successful undo', async () => {
    progress.todayStr = () => '2026-11-03';
    expect((await service.undo(input(2))).status).toBe('rejected');
    progress.isHistoryEditing = true;
    expect((await service.undo(input(2))).status).toBe('persisted');
    expect((await service.undo(input(2))).status).toBe('persisted');
    expect(dispatch).toHaveBeenCalledTimes(1);
  });
  it('fails closed if archived completion order cannot be read', async () => {
    progress.loadArchivedTasks.and.rejectWith(new Error('unavailable'));
    expect((await service.undo(input(2))).status).toBe('failed');
    expect(dispatch).not.toHaveBeenCalled();
  });
  it('restores original completion fields if persistence fails', async () => {
    const before = structuredClone(tasks);
    dispatch.and.callFake(async () => {
      throw new Error('disk full');
    });
    expect((await service.undo(input(2))).status).toBe('failed');
    expect(tasks).toEqual(before);
  });
  it('keeps Roman numerals after step twelve', () => {
    expect(personalRoman(11)).toBe('Ⅻ');
    expect(personalRoman(12)).toBe('ⅩⅢ');
    expect(personalRoman(48)).toBe('ⅩⅬⅨ');
  });
});
