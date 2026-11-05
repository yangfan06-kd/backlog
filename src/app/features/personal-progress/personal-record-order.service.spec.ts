import { TestBed } from '@angular/core/testing';
import { Store } from '@ngrx/store';
import { of } from 'rxjs';
import { DEFAULT_PROJECT } from '../project/project.const';
import { Project } from '../project/project.model';
import { selectAllProjects } from '../project/store/project.selectors';
import {
  ReorderRecordsInput,
  PersonalRecordOrderService,
} from './personal-record-order.service';
import { PersonalProgressService } from './personal-progress.service';
import { PersonalCommandCoordinatorService } from './personal-command-coordinator.service';
import { PersonalProgressEntry, comparePersonalEntries } from './personal-progress.model';

const entry = (id: string, day = '2026-11-05'): PersonalProgressEntry => ({
  id,
  projectId: 'p',
  recordDay: day,
  body: id,
  source: 'manual',
  createdAt: id === 'a' ? 1 : 2,
  updatedAt: 1,
  revision: 1,
  operationId: id,
});
describe('PersonalRecordOrderService', () => {
  let project: Project;
  let service: PersonalRecordOrderService;
  let fail: boolean;
  let writes: number;
  beforeEach(() => {
    project = {
      ...DEFAULT_PROJECT,
      id: 'p',
      personalProgress: {
        schemaVersion: 1,
        entries: [entry('a'), entry('b'), entry('other', '2026-11-01')],
      },
    };
    fail = false;
    writes = 0;
    TestBed.configureTestingModule({
      providers: [
        {
          provide: Store,
          useValue: {
            select: (selector: unknown) =>
              of(selector === selectAllProjects ? [project] : []),
          },
        },
        {
          provide: PersonalProgressService,
          useValue: { loadArchivedTasks: async () => [] },
        },
        {
          provide: PersonalCommandCoordinatorService,
          useValue: {
            enqueue: (fn: () => Promise<unknown>) => fn(),
            dispatchWithReceipt: async (action: {
              project: { changes: Partial<Project> };
            }) => {
              project = { ...project, ...action.project.changes };
              writes++;
              if (fail) {
                fail = false;
                throw new Error('disk');
              }
            },
          },
        },
      ],
    });
    service = TestBed.inject(PersonalRecordOrderService);
  });
  const input = (): ReorderRecordsInput => ({
    operationId: 'sort',
    projectId: 'p',
    day: '2026-11-05',
    expectedRevision: 0,
    entryIds: ['b', 'a'],
  });
  it('persists only presentation order, preserving record text/revision/date and idempotency', async () => {
    const before = structuredClone(project.personalProgress?.entries);
    expect((await service.reorder(input())).status).toBe('persisted');
    expect(project.personalProgress?.entries).toEqual(before);
    const sorted = [...project.personalProgress!.entries.slice(0, 2)].sort((a, b) =>
      comparePersonalEntries(project, a, b),
    );
    expect(sorted.map((e) => e.id)).toEqual(['b', 'a']);
    expect((await service.reorder(input())).status).toBe('persisted');
    expect(writes).toBe(1);
  });
  it('rejects crossing dates, missing IDs, duplicates and stale revisions', async () => {
    for (const entryIds of [['a', 'other'], ['a'], ['a', 'a']])
      expect((await service.reorder({ ...input(), entryIds })).status).toBe('rejected');
    expect((await service.reorder({ ...input(), expectedRevision: 1 })).status).toBe(
      'rejected',
    );
    expect(writes).toBe(0);
  });
  it('rolls back optimistic ordering when persistence fails', async () => {
    fail = true;
    expect((await service.reorder(input())).status).toBe('failed');
    expect(project.personalProgress?.entryOrder).toBeUndefined();
    expect(writes).toBe(2);
  });
});
