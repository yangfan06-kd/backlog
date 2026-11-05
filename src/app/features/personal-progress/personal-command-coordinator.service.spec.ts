import { TestBed } from '@angular/core/testing';
import { Action, Store } from '@ngrx/store';
import { PersonalCommandCoordinatorService } from './personal-command-coordinator.service';
import { OperationWriteFlushService } from '../../op-log/sync/operation-write-flush.service';

class FakeStore {
  actions: Action[] = [];
  dispatch = (action: Action): void => {
    this.actions.push(action);
  };
}

class FakeFlush {
  createCommandReceipt = jasmine.createSpy('createCommandReceipt').and.resolveTo();
  settleCommandReceipt = jasmine.createSpy('settleCommandReceipt');
}

describe('PersonalCommandCoordinatorService', () => {
  let coordinator: PersonalCommandCoordinatorService;
  let store: FakeStore;
  let flush: FakeFlush;

  const setup = (): void => {
    store = new FakeStore();
    flush = new FakeFlush();
    TestBed.configureTestingModule({
      providers: [
        PersonalCommandCoordinatorService,
        { provide: Store, useValue: store as unknown as Store },
        { provide: OperationWriteFlushService, useValue: flush },
      ],
    });
    coordinator = TestBed.inject(PersonalCommandCoordinatorService);
  };

  it('adds command id and extra receipt metadata to the dispatched action', async () => {
    setup();
    await coordinator.dispatchWithReceipt(
      {
        type: '[Test] update',
        meta: { isPersistent: true, entityType: 'PROJECT', entityId: 'A' },
      } as Action,
      'command-1',
      { archiveWrite: { storeName: 'archive_young' } },
    );
    const action = store.actions[0] as Action & {
      meta: Record<string, unknown>;
    };
    expect(action.meta.commandId).toBe('command-1');
    expect(action.meta.archiveWrite).toEqual({ storeName: 'archive_young' });
    expect(flush.createCommandReceipt).toHaveBeenCalledWith(
      'command-1',
      jasmine.any(Function),
    );
  });

  it('sets and clears the slow signal from the receipt callback', async () => {
    setup();
    let resolveReceipt: (() => void) | undefined;
    flush.createCommandReceipt.and.callFake(
      (_id: string, onSlow: () => void) =>
        new Promise<void>((resolve) => {
          onSlow();
          expect(coordinator.isPersistenceSlow()).toBeTrue();
          resolveReceipt = resolve;
        }),
    );
    const pending = coordinator.dispatchWithReceipt(
      { type: '[Test] slow' } as Action,
      'slow',
    );
    expect(coordinator.isPersistenceSlow()).toBeTrue();
    resolveReceipt?.();
    await pending;
    expect(coordinator.isPersistenceSlow()).toBeFalse();
  });

  it('continues queued work after a rejected receipt and preserves order', async () => {
    setup();
    const order: string[] = [];
    flush.createCommandReceipt.and.callFake((id: string) => {
      order.push(`receipt:${id}`);
      return id === 'fail' ? Promise.reject(new Error('disk full')) : Promise.resolve();
    });
    let failure: unknown;
    try {
      await coordinator.enqueue(async () => {
        order.push('first');
        await coordinator.dispatchWithReceipt({ type: '[Test] first' } as Action, 'fail');
      });
    } catch (e) {
      failure = e;
    }
    expect((failure as Error).message).toBe('disk full');
    await coordinator.enqueue(async () => {
      order.push('second');
      await coordinator.dispatchWithReceipt({ type: '[Test] second' } as Action, 'ok');
    });
    expect(order).toEqual(['first', 'receipt:fail', 'second', 'receipt:ok']);
    expect(store.actions.map((action) => action.type)).toEqual([
      '[Test] first',
      '[Test] second',
    ]);
  });
});
