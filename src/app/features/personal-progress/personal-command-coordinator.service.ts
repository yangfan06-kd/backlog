import { inject, Injectable, signal } from '@angular/core';
import { Action, Store } from '@ngrx/store';
import { OperationWriteFlushService } from '../../op-log/sync/operation-write-flush.service';
import { PersistentAction } from '../../op-log/core/persistent-action.interface';

/**
 * Shared command queue and receipt boundary for the personal slice. All
 * lifecycle, entry and step commands use this one queue; a second queue would
 * allow two commands to read the same snapshot before either write settles.
 */
@Injectable({ providedIn: 'root' })
export class PersonalCommandCoordinatorService {
  private _store = inject(Store);
  private _writeFlush = inject(OperationWriteFlushService);
  private _commandQueue: Promise<unknown> = Promise.resolve();
  readonly isPersistenceSlow = signal(false);

  enqueue<T>(command: () => Promise<T>): Promise<T> {
    const result = this._commandQueue.then(command);
    this._commandQueue = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }

  async dispatchWithReceipt(
    action: Action,
    commandId: string,
    extraMeta?: Record<string, unknown>,
  ): Promise<void> {
    this.isPersistenceSlow.set(false);
    const receipt = this._writeFlush.createCommandReceipt(commandId, () =>
      this.isPersistenceSlow.set(true),
    );
    const meta = (action as unknown as PersistentAction).meta;
    try {
      this._store.dispatch({
        ...action,
        meta: { ...meta, commandId, ...extraMeta },
      } as Action);
    } catch (e) {
      this._writeFlush.settleCommandReceipt(commandId, e);
    }
    try {
      await receipt;
    } finally {
      this.isPersistenceSlow.set(false);
    }
  }
}
