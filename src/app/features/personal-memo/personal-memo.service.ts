import { Injectable, inject } from '@angular/core';
import { Store } from '@ngrx/store';
import { firstValueFrom } from 'rxjs';
import { nanoid } from 'nanoid';
import { Note } from '../note/note.model';
import { addNote, deleteNote, updateNote } from '../note/store/note.actions';
import { selectAllNotes } from '../note/store/note.reducer';
import { PersonalCommandCoordinatorService } from '../personal-progress/personal-command-coordinator.service';
import { PersonalTextFormat, formatForText } from '../personal-text/personal-text.model';

@Injectable({ providedIn: 'root' })
export class PersonalMemoService {
  private readonly _store = inject(Store);
  private readonly _commands = inject(PersonalCommandCoordinatorService);
  readonly notes$ = this._store.select(selectAllNotes);

  /** Delete only a specific, still-trashed revision; recover the note on write failure. */
  removeFromTrash(id: string, revision: number): Promise<void> {
    return this._commands.enqueue(async () => {
      const note = (await firstValueFrom(this.notes$)).find((item) => item.id === id);
      if (!note?.personalMemo?.deletedAt || note.personalMemo.revision !== revision)
        throw new Error('备忘已变化，请刷新后再试');
      const operationId = nanoid();
      try {
        await this._commands.dispatchWithReceipt(
          deleteNote({
            id,
            projectId: note.projectId,
            isPinnedToToday: note.isPinnedToToday,
            note,
          }),
          operationId,
        );
      } catch (error) {
        const latest = (await firstValueFrom(this.notes$)).find((item) => item.id === id);
        if (!latest) {
          try {
            await this._commands.dispatchWithReceipt(
              addNote({ note, isPreventFocus: true }),
              `memo-recover-${nanoid()}`,
            );
          } catch {
            /* Report the original failure. */
          }
        }
        throw error;
      }
    });
  }

  async save(input: {
    id?: string;
    revision?: number;
    text: string;
    format: PersonalTextFormat | null;
    remindAt: number | null;
    advanceMinutes?: number;
    deletedAt?: number | null;
  }): Promise<void> {
    const text = input.text;
    const advanceMinutes = input.remindAt === null ? 0 : (input.advanceMinutes ?? 0);
    if (
      !text.trim() ||
      (input.remindAt !== null && !Number.isFinite(input.remindAt)) ||
      !Number.isSafeInteger(advanceMinutes) ||
      advanceMinutes < 0 ||
      advanceMinutes > 10080
    )
      throw new Error('请填写有效的备忘和提醒时间');
    return this._commands.enqueue(async () => {
      const notes = await firstValueFrom(this.notes$);
      const previous = input.id ? notes.find((note) => note.id === input.id) : undefined;
      if (
        input.id &&
        (!previous?.personalMemo || previous.personalMemo.revision !== input.revision)
      )
        throw new Error('备忘已变化，请重新打开后再试');
      const id = previous?.id ?? nanoid();
      const operationId = nanoid();
      const now = Date.now();
      const personalMemo = {
        ...previous?.personalMemo,
        format: formatForText(text, input.format),
        remindAt: input.remindAt,
        advanceMinutes,
        deletedAt: input.deletedAt ?? null,
        revision: (previous?.personalMemo?.revision ?? 0) + 1,
        operationId,
      };
      const next: Note = previous
        ? { ...previous, content: text, modified: now, personalMemo }
        : {
            id,
            projectId: null,
            isPinnedToToday: false,
            content: text,
            created: now,
            modified: now,
            personalMemo,
          };
      try {
        await this._commands.dispatchWithReceipt(
          previous
            ? updateNote({
                note: { id, changes: { content: text, modified: now, personalMemo } },
              })
            : addNote({ note: next, isPreventFocus: true }),
          operationId,
        );
      } catch (error) {
        const latest = (await firstValueFrom(this.notes$)).find((note) => note.id === id);
        if (latest?.personalMemo?.operationId === operationId) {
          try {
            await this._commands.dispatchWithReceipt(
              previous
                ? updateNote({
                    note: {
                      id,
                      changes: {
                        content: previous.content,
                        modified: previous.modified,
                        personalMemo: previous.personalMemo,
                      },
                    },
                  })
                : deleteNote({
                    id,
                    projectId: null,
                    isPinnedToToday: false,
                    note: latest,
                  }),
              `memo-recover-${nanoid()}`,
            );
          } catch {
            /* Keep the write error visible. */
          }
        }
        throw error;
      }
    });
  }

  reorder(
    id: string,
    targetId: string,
    after: boolean,
    expectedRevision: number,
  ): Promise<void> {
    return this._commands.enqueue(async () => {
      const notes = (await firstValueFrom(this.notes$))
        .filter((n) => n.personalMemo && !n.personalMemo.deletedAt)
        .sort((a, b) => memoPosition(a) - memoPosition(b));
      const note = notes.find((n) => n.id === id),
        target = notes.find((n) => n.id === targetId);
      if (
        !note?.personalMemo ||
        !target ||
        id === targetId ||
        (note.personalMemo.order?.revision ?? 0) !== expectedRevision
      )
        throw new Error('备忘已变化，请刷新后再试');
      const remaining = notes.filter((n) => n.id !== id),
        index = remaining.findIndex((n) => n.id === targetId) + (after ? 1 : 0);
      const before = remaining[index - 1],
        next = remaining[index];
      const halfGap =
        before && next ? (memoPosition(next) - memoPosition(before)) / 2 : 0;
      const position = !before
        ? memoPosition(next) - 1024
        : !next
          ? memoPosition(before) + 1024
          : memoPosition(before) + halfGap;
      if (
        !Number.isFinite(position) ||
        (before && position <= memoPosition(before)) ||
        (next && position >= memoPosition(next))
      )
        throw new Error('当前顺序无法调整，请重试');
      const operationId = nanoid(),
        previous = note.personalMemo;
      try {
        await this._commands.dispatchWithReceipt(
          updateNote({
            note: {
              id,
              changes: {
                personalMemo: {
                  ...previous,
                  order: { position, revision: expectedRevision + 1, operationId },
                },
              },
            },
          }),
          operationId,
        );
      } catch (error) {
        const latest = (await firstValueFrom(this.notes$)).find((n) => n.id === id);
        if (latest?.personalMemo?.order?.operationId === operationId) {
          try {
            await this._commands.dispatchWithReceipt(
              updateNote({
                note: {
                  id,
                  changes: {
                    personalMemo: { ...latest.personalMemo, order: previous.order },
                  },
                },
              }),
              operationId + '-rollback',
            );
          } catch {
            /* Surface the original write failure. */
          }
        }
        throw error;
      }
    });
  }

  /** Read after queued writes settle so failed/changed/deleted drafts cannot notify. */
  readReminder(id: string, expected: string, now: number): Promise<Note | null> {
    return this._commands.enqueue(async () => {
      const note = (await firstValueFrom(this.notes$)).find((item) => item.id === id);
      const meta = note?.personalMemo;
      if (!note || !meta || meta.deletedAt || meta.remindAt === null) return null;
      const key = `${meta.remindAt}:${meta.advanceMinutes ?? 0}`;
      const offsetMs = (meta.advanceMinutes ?? 0) * 60000;
      return key === expected && meta.remindAt - offsetMs <= now ? note : null;
    });
  }
}

/** Newest-first is the existing memo order; explicit ranks do not move on editing. */
export const memoPosition = (note: Note): number => {
  const value = note.personalMemo?.order?.position;
  return typeof value === 'number' && Number.isFinite(value) ? value : -note.created;
};
