import { Injectable, InjectionToken, inject } from '@angular/core';
import { EMPTY, Observable, share, tap } from 'rxjs';
import { IS_ELECTRON } from '../../app.constants';
import { ipcNotifyOnClose$ } from '../ipc-events';

export const BEFORE_CLOSE_REQUESTS = new InjectionToken<Observable<string[]>>(
  'BEFORE_CLOSE_REQUESTS',
  { providedIn: 'root', factory: () => (IS_ELECTRON ? ipcNotifyOnClose$ : EMPTY) },
);

interface CloseRound {
  pending: Set<string>;
  completed: Set<string>;
  cancelled: boolean;
  waiters: Map<string, Array<(allowed: boolean) => void>>;
}

@Injectable({ providedIn: 'root' })
export class ExecBeforeCloseService {
  private _registered = new Set<string>();
  private _afterOthers = new Set<string>();
  private _round: CloseRound | null = null;
  onBeforeClose$: Observable<string[]> = inject(BEFORE_CLOSE_REQUESTS).pipe(
    tap((ids) => {
      // Repeated close clicks while a prompt/write is pending share one round.
      if (this._round && !this._round.cancelled && this._round.pending.size) return;
      this._round = {
        pending: new Set(ids),
        completed: new Set(),
        cancelled: false,
        waiters: new Map(),
      };
    }),
    share(),
  );

  schedule(id: string, afterOthers = false): void {
    if (afterOthers) this._afterOthers.add(id);
    if (this._registered.has(id)) return;
    this._registered.add(id);
    window.ea.scheduleRegisterBeforeClose(id);
  }

  unschedule(id: string): void {
    this._registered.delete(id);
    this._afterOthers.delete(id);
    this._settle(id, true);
    window.ea.unscheduleRegisterBeforeClose(id);
  }

  setDone(id: string): void {
    if (this._round?.cancelled) return;
    this._round?.completed.add(id);
    this._settle(id, true);
    window.ea.setDoneRegisterBeforeClose(id);
  }

  /** Wait for other close checks, including their explicit cancellation. */
  async waitForOtherHandlers(id: string): Promise<boolean> {
    const round = this._round;
    if (!round) return true;
    if (round.cancelled) return false;
    const results = await Promise.all(
      [...round.pending]
        .filter(
          (otherId) =>
            otherId !== id &&
            (this._afterOthers.has(id) || !this._afterOthers.has(otherId)),
        )
        .map(
          (otherId) =>
            new Promise<boolean>((resolve) => {
              const waiters = round.waiters.get(otherId) ?? [];
              waiters.push(resolve);
              round.waiters.set(otherId, waiters);
            }),
        ),
    );
    return !round.cancelled && results.every(Boolean);
  }

  /** Cancel this attempt and restore checks already acknowledged to main. */
  cancelClose(): void {
    const round = this._round;
    if (!round || round.cancelled) return;
    round.cancelled = true;
    for (const id of round.completed) {
      if (this._registered.has(id)) window.ea.scheduleRegisterBeforeClose(id);
    }
    for (const waiters of round.waiters.values()) {
      for (const resolve of waiters) resolve(false);
    }
    round.waiters.clear();
  }

  private _settle(id: string, allowed: boolean): void {
    this._round?.pending.delete(id);
    for (const resolve of this._round?.waiters.get(id) ?? []) resolve(allowed);
    this._round?.waiters.delete(id);
  }
}
