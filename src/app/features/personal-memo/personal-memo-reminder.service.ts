import { DestroyRef, Injectable, inject } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Router } from '@angular/router';
import { filter, take } from 'rxjs/operators';
import { DataInitStateService } from '../../core/data-init/data-init-state.service';
import { NotifyService } from '../../core/notify/notify.service';
import { Note } from '../note/note.model';
import { PersonalMemoService } from './personal-memo.service';

/** Lives for the whole desktop session, independent of the current page. */
@Injectable({ providedIn: 'root' })
export class PersonalMemoReminderService {
  private readonly _destroy = inject(DestroyRef);
  private readonly _data = inject(DataInitStateService);
  private readonly _memos = inject(PersonalMemoService);
  private readonly _notify = inject(NotifyService);
  private readonly _router = inject(Router);
  private _notes: Note[] = [];
  private _seen = new Map<string, string>();
  private _started = false;
  private _initial = true;

  start(): void {
    if (this._started) return;
    this._started = true;
    this._data.isAllDataLoadedInitially$
      .pipe(filter(Boolean), take(1), takeUntilDestroyed(this._destroy))
      .subscribe(() => {
        this._memos.notes$.pipe(takeUntilDestroyed(this._destroy)).subscribe((notes) => {
          this._notes = notes;
          const ids = new Set(notes.map((note) => note.id));
          for (const id of this._seen.keys()) if (!ids.has(id)) this._seen.delete(id);
          if (this._initial) {
            // Reminders missed while the app was closed stay visible in the list;
            // reopening must not repeatedly pop up every old item.
            for (const note of notes) {
              const candidate = this._candidate(note);
              if (candidate && candidate.trigger <= Date.now())
                this._seen.set(note.id, candidate.key);
            }
            this._initial = false;
          }
          this._scan();
        });
        const timer = setInterval(() => this._scan(), 1000);
        this._destroy.onDestroy(() => clearInterval(timer));
      });
  }

  private _candidate(note: Note): { key: string; trigger: number } | null {
    const meta = note.personalMemo;
    if (
      !meta ||
      meta.deletedAt ||
      meta.remindAt === null ||
      !Number.isFinite(meta.remindAt)
    )
      return null;
    const advance = meta.advanceMinutes ?? 0;
    if (!Number.isSafeInteger(advance) || advance < 0 || advance > 10080) return null;
    const offsetMs = advance * 60000;
    return {
      key: `${meta.remindAt}:${advance}`,
      trigger: meta.remindAt - offsetMs,
    };
  }

  private _scan(): void {
    const now = Date.now();
    for (const note of this._notes) {
      const candidate = this._candidate(note);
      if (
        !candidate ||
        candidate.trigger > now ||
        this._seen.get(note.id) === candidate.key
      )
        continue;
      this._seen.set(note.id, candidate.key);
      void this._deliver(note.id, candidate.key, now);
    }
  }

  private async _deliver(id: string, key: string, now: number): Promise<void> {
    try {
      const note = await this._memos.readReminder(id, key, now);
      if (!note) {
        if (this._seen.get(id) === key) this._seen.delete(id);
        return;
      }
      const notification = await this._notify.notifyDesktop({
        title: '备忘提醒',
        body: note.content.slice(0, 160),
      });
      if (notification)
        notification.onclick = () => {
          notification.close();
          window.ea?.showOrFocus();
          void this._router.navigate(['/personal-memo']);
        };
    } catch {
      // Permit a later tick to retry a failed read/notification, without logging memo text.
      if (this._seen.get(id) === key) this._seen.delete(id);
    }
  }
}
