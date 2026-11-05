import { TestBed } from '@angular/core/testing';
import { Action, Store } from '@ngrx/store';
import { defer, of, Observable } from 'rxjs';
import { Note, NoteState } from '../note/note.model';
import { initialNoteState, noteReducer } from '../note/store/note.reducer';
import { OperationWriteFlushService } from '../../op-log/sync/operation-write-flush.service';
import { PersonalMemoService } from './personal-memo.service';

class MemoStore {
  state: NoteState = initialNoteState;
  select = (): Observable<Note[]> =>
    defer(() => of(this.state.ids.map((id) => this.state.entities[id]!)));
  dispatch = (action: Action): void => {
    this.state = noteReducer(this.state, action);
  };
}

describe('PersonalMemoService', () => {
  let store: MemoStore;
  let service: PersonalMemoService;
  let flush: { createCommandReceipt: jasmine.Spy; settleCommandReceipt: jasmine.Spy };
  const format = { version: 1 as const, runs: [{ text: '备忘', bold: true as const }] };
  beforeEach(() => {
    store = new MemoStore();
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
    service = TestBed.inject(PersonalMemoService);
  });
  it('persists text, formatting and optional reminder and preserves them through trash and restore', async () => {
    await service.save({ text: '备忘', format, remindAt: 1800000000000 });
    const first = store.state.entities[store.state.ids[0]]!;
    expect(first.personalMemo?.format).toEqual(format);
    expect(first.personalMemo?.remindAt).toBe(1800000000000);
    await service.save({
      id: first.id,
      revision: 1,
      text: first.content,
      format,
      remindAt: 1800000000000,
      deletedAt: 1800000000001,
    });
    const deleted = store.state.entities[first.id]!;
    expect(deleted.personalMemo?.deletedAt).toBe(1800000000001);
    await service.save({
      id: first.id,
      revision: 2,
      text: deleted.content,
      format,
      remindAt: 1800000000000,
      deletedAt: null,
    });
    const restored = store.state.entities[first.id]!;
    expect(restored.personalMemo?.deletedAt).toBeNull();
    expect(restored.personalMemo?.format).toEqual(format);
    expect(restored.personalMemo?.remindAt).toBe(1800000000000);
  });
  it('refuses stale edits without overwriting the current memo', async () => {
    await service.save({ text: '备忘', format, remindAt: null });
    const id = store.state.ids[0];
    await expectAsync(
      service.save({ id, revision: 0, text: '错误覆盖', format: null, remindAt: null }),
    ).toBeRejected();
    expect(store.state.entities[id]!.content).toBe('备忘');
  });
  it('only permanently deletes a current trashed memo, leaving other records intact', async () => {
    await service.save({ text: '保留', format: null, remindAt: null });
    const kept = store.state.ids[0];
    await service.save({ text: '待删除', format, remindAt: null });
    const id = store.state.ids[0];
    await expectAsync(service.removeFromTrash(id, 1)).toBeRejected();
    await service.save({
      id,
      revision: 1,
      text: '待删除',
      format: null,
      remindAt: null,
      deletedAt: 123,
    });
    await expectAsync(service.removeFromTrash(id, 1)).toBeRejected();
    await service.removeFromTrash(id, 2);
    expect(store.state.entities[id]).toBeUndefined();
    expect(store.state.entities[kept]?.content).toBe('保留');
  });
  it('restores the trashed memo when permanent deletion fails to persist', async () => {
    await service.save({ text: '待删除', format: null, remindAt: null, deletedAt: 123 });
    const id = store.state.ids[0];
    flush.createCommandReceipt.and.returnValues(
      Promise.reject(new Error('disk failure')),
      Promise.resolve(),
    );
    await expectAsync(service.removeFromTrash(id, 1)).toBeRejected();
    expect(store.state.entities[id]?.content).toBe('待删除');
    expect(store.state.entities[id]?.personalMemo?.deletedAt).toBe(123);
  });
  it('stores the chosen advance and checks the latest reminder before notifying', async () => {
    await service.save({
      text: '会议',
      format: null,
      remindAt: 1800000000000,
      advanceMinutes: 15,
    });
    const note = store.state.entities[store.state.ids[0]]!;
    expect(note.personalMemo?.advanceMinutes).toBe(15);
    expect(
      await service.readReminder(note.id, '1800000000000:15', 1799999099999),
    ).toBeNull();
    expect(
      (await service.readReminder(note.id, '1800000000000:15', 1799999100000))?.content,
    ).toBe('会议');
    expect(
      await service.readReminder(note.id, '1800000000000:5', 1800000000000),
    ).toBeNull();
  });
  it('rolls back a failed new memo without losing existing notes', async () => {
    await service.save({ text: '已有', format: null, remindAt: null });
    flush.createCommandReceipt.and.returnValues(
      Promise.reject(new Error('disk failure')),
      Promise.resolve(),
    );
    await expectAsync(
      service.save({ text: '未保存', format: null, remindAt: null }),
    ).toBeRejected();
    expect(store.state.ids.length).toBe(1);
    expect(store.state.entities[store.state.ids[0]]!.content).toBe('已有');
  });
  it('reorders cards without changing text, reminder or content revision and retains the position on editing', async () => {
    await service.save({ text: '备忘', format, remindAt: 1800000000000 });
    await service.save({ text: '第二条', format: null, remindAt: null });
    const first = Object.values(store.state.entities).find((n) => n?.content === '备忘')!;
    const second = Object.values(store.state.entities).find(
      (n) => n?.content === '第二条',
    )!;
    store.state = {
      ...store.state,
      entities: {
        ...store.state.entities,
        [first.id]: { ...first, created: 1000 },
        [second.id]: { ...second, created: 2000 },
      },
    };
    await service.reorder(first.id, second.id, false, 0);
    const moved = store.state.entities[first.id]!;
    expect(moved.content).toBe('备忘');
    expect(moved.personalMemo?.format).toEqual(format);
    expect(moved.personalMemo?.remindAt).toBe(1800000000000);
    expect(moved.personalMemo?.revision).toBe(1);
    expect(moved.personalMemo?.order?.position).toBeLessThan(-2000);
    await service.save({
      id: first.id,
      revision: 1,
      text: '原位修改',
      format,
      remindAt: null,
    });
    expect(store.state.entities[first.id]?.personalMemo?.order).toEqual(
      moved.personalMemo?.order,
    );
    expect(store.state.entities[first.id]?.personalMemo?.remindAt).toBeNull();
  });
  it('restores the previous card position on a failed ordering write', async () => {
    await service.save({ text: 'A', format: null, remindAt: null });
    await service.save({ text: 'B', format: null, remindAt: null });
    const [a, b] = store.state.ids;
    flush.createCommandReceipt.and.returnValues(
      Promise.reject(new Error('disk failure')),
      Promise.resolve(),
    );
    await expectAsync(service.reorder(a, b, false, 0)).toBeRejected();
    expect(store.state.entities[a]?.personalMemo?.order).toBeUndefined();
    expect(store.state.entities[a]?.content).toBeDefined();
  });
});
