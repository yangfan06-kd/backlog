import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  computed,
  inject,
  signal,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { CdkDrag, CdkDragHandle, CdkDropList, CdkDragDrop } from '@angular/cdk/drag-drop';
import { NotifyService } from '../../core/notify/notify.service';
import { FormsModule } from '@angular/forms';
import { toSignal } from '@angular/core/rxjs-interop';
import { filter } from 'rxjs/operators';
import { IS_ELECTRON } from '../../app.constants';
import { ExecBeforeCloseService } from '../../core/electron/exec-before-close.service';
import { Note } from '../note/note.model';
import { PersonalRichTextEditorComponent } from '../personal-text/personal-rich-text-editor.component';
import { PersonalTextViewComponent } from '../personal-text/personal-text-view.component';
import { PersonalTextDraft, formatEquals } from '../personal-text/personal-text.model';
import { PersonalMemoService, memoPosition } from './personal-memo.service';

const localInput = (timestamp: number | null): string => {
  if (timestamp === null) return '';
  const d = new Date(timestamp);
  const offset = d.getTimezoneOffset() * 60000;
  return new Date(timestamp - offset).toISOString().slice(0, 16);
};

@Component({
  selector: 'personal-memo-page',
  standalone: true,
  imports: [
    CommonModule,
    CdkDrag,
    CdkDragHandle,
    CdkDropList,
    FormsModule,
    PersonalRichTextEditorComponent,
    PersonalTextViewComponent,
  ],
  templateUrl: './personal-memo-page.component.html',
  styleUrls: ['./personal-memo-page.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PersonalMemoPageComponent {
  private readonly _service = inject(PersonalMemoService);
  private readonly _notify = inject(NotifyService);
  readonly reminderEnabled = signal(false);
  private readonly _destroy = inject(DestroyRef);
  private readonly _close = inject(ExecBeforeCloseService);
  private readonly _notes = toSignal(this._service.notes$, { initialValue: [] });
  private readonly _closeId = 'personal-memo-close';
  private _pendingClose = false;
  private _closeOpen = false;
  readonly now = signal(Date.now());
  readonly trashed = signal(false);
  readonly saving = signal(false);
  readonly editorOpen = signal(false);
  readonly message = signal('');
  readonly selected = signal<Note | null>(null);
  readonly draft = signal<PersonalTextDraft>({ text: '', format: null });
  readonly reminder = signal('');
  readonly advanceMinutes = signal(0);
  readonly resetKey = signal('new');
  readonly notes = computed(() =>
    this._notes()
      .filter(
        (note) => note.personalMemo && !!note.personalMemo.deletedAt === this.trashed(),
      )
      .sort((a, b) =>
        this.trashed()
          ? (b.personalMemo?.deletedAt ?? 0) - (a.personalMemo?.deletedAt ?? 0)
          : memoPosition(a) - memoPosition(b),
      ),
  );
  readonly dirty = computed(() => {
    const note = this.selected(),
      draft = this.draft();
    return (
      draft.text !== (note?.content ?? '') ||
      !formatEquals(draft.format, note?.personalMemo?.format ?? null) ||
      this.reminderEnabled() !== (note?.personalMemo?.remindAt != null) ||
      (this.reminderEnabled() &&
        this.reminder() !== localInput(note?.personalMemo?.remindAt ?? null)) ||
      this.advanceMinutes() !== (note?.personalMemo?.advanceMinutes ?? 0)
    );
  });

  constructor() {
    const timer = setInterval(() => this.now.set(Date.now()), 1000);
    if (IS_ELECTRON) {
      this._close.schedule(this._closeId);
      const subscription = this._close.onBeforeClose$
        .pipe(filter((ids) => ids.includes(this._closeId)))
        .subscribe(() => void this._requestClose());
      this._destroy.onDestroy(() => {
        subscription.unsubscribe();
        this._close.unschedule(this._closeId);
      });
    } else window.addEventListener('beforeunload', this._beforeUnload);
    this._destroy.onDestroy(() => {
      clearInterval(timer);
      window.removeEventListener('beforeunload', this._beforeUnload);
    });
  }

  private _beforeUnload = (event: BeforeUnloadEvent): void => {
    if (this.dirty() || this.saving()) {
      event.preventDefault();
      event.returnValue = '';
    }
  };
  async canDeactivate(): Promise<boolean> {
    return (
      !this.saving() &&
      (!this.dirty() || window.confirm('备忘尚未保存，放弃修改并离开？'))
    );
  }
  private async _requestClose(): Promise<void> {
    if (this._closeOpen) return;
    if (this.saving()) {
      this._pendingClose = true;
      return;
    }
    this._closeOpen = true;
    try {
      if (!(await this._close.waitForOtherHandlers(this._closeId))) return;
      if (await this.canDeactivate()) this._close.setDone(this._closeId);
      else this._close.cancelClose();
    } finally {
      this._closeOpen = false;
    }
  }
  private _resumeClose(): void {
    if (this._pendingClose) {
      this._pendingClose = false;
      setTimeout(() => void this._requestClose(), 0);
    }
  }
  open(note: Note | null): boolean {
    if (this.saving() || (this.dirty() && !window.confirm('备忘尚未保存，放弃修改？')))
      return false;
    this.selected.set(note);
    this.draft.set({
      text: note?.content ?? '',
      format: note?.personalMemo?.format ?? null,
    });
    this.reminder.set(localInput(note?.personalMemo?.remindAt ?? null));
    this.reminderEnabled.set(note?.personalMemo?.remindAt != null);
    this.advanceMinutes.set(note?.personalMemo?.advanceMinutes ?? 0);
    this.resetKey.set(note?.id ?? `new-${Date.now()}`);
    this.message.set('');
    this.editorOpen.set(true);
    return true;
  }
  closeEditor(): void {
    if (this.open(null)) this.editorOpen.set(false);
  }
  async save(): Promise<void> {
    if (this.saving() || !this.draft().text.trim()) return;
    if (this.reminderEnabled() && !this.reminder()) {
      this.message.set('请选择提醒时间');
      return;
    }
    const date =
      this.reminderEnabled() && this.reminder()
        ? new Date(this.reminder()).getTime()
        : null;
    if (date !== null && !Number.isFinite(date)) {
      this.message.set('请选择有效的提醒时间');
      return;
    }
    this.saving.set(true);
    this.message.set('');
    try {
      const selected = this.selected();
      await this._service.save({
        id: selected?.id,
        revision: selected?.personalMemo?.revision,
        text: this.draft().text,
        format: this.draft().format,
        remindAt: date,
        advanceMinutes: this.advanceMinutes(),
      });
      this.selected.set(null);
      this.draft.set({ text: '', format: null });
      this.reminder.set('');
      this.reminderEnabled.set(false);
      this.advanceMinutes.set(0);
      this.resetKey.set(`saved-${Date.now()}`);
      this.editorOpen.set(false);
      this.message.set('已保存到本机');
    } catch {
      this.message.set('保存失败，内容仍保留，请重试');
    } finally {
      this.saving.set(false);
      this._resumeClose();
    }
  }
  async toggleTrash(note: Note): Promise<void> {
    if (
      this.saving() ||
      !note.personalMemo ||
      (this.dirty() && !window.confirm('备忘尚未保存，放弃修改？'))
    )
      return;
    if (!note.personalMemo.deletedAt && !window.confirm('将这条备忘移入回收站？')) return;
    this.saving.set(true);
    this.message.set('');
    try {
      await this._service.save({
        id: note.id,
        revision: note.personalMemo.revision,
        text: note.content,
        format: note.personalMemo.format,
        remindAt: note.personalMemo.remindAt,
        advanceMinutes: note.personalMemo.advanceMinutes ?? 0,
        deletedAt: note.personalMemo.deletedAt ? null : Date.now(),
      });
      this.selected.set(null);
      this.draft.set({ text: '', format: null });
      this.reminder.set('');
      this.reminderEnabled.set(false);
      this.advanceMinutes.set(0);
      this.resetKey.set(`trash-${Date.now()}`);
      this.editorOpen.set(false);
      this.message.set('已保存到本机');
    } catch {
      this.message.set('操作失败，请重试');
    } finally {
      this.saving.set(false);
      this._resumeClose();
    }
  }
  switchTrash(value: boolean): void {
    if (this.saving() || (this.dirty() && !window.confirm('备忘尚未保存，放弃修改？')))
      return;
    this.selected.set(null);
    this.draft.set({ text: '', format: null });
    this.reminder.set('');
    this.reminderEnabled.set(false);
    this.advanceMinutes.set(0);
    this.resetKey.set(`tab-${Date.now()}`);
    this.trashed.set(value);
    this.editorOpen.set(false);
  }
  async deleteForever(note: Note): Promise<void> {
    if (this.saving() || !note.personalMemo?.deletedAt) return;
    if (!window.confirm('彻底删除这条备忘？删除后不能从回收站恢复。')) return;
    this.saving.set(true);
    this.message.set('');
    try {
      await this._service.removeFromTrash(note.id, note.personalMemo.revision);
      this.message.set('已删除');
    } catch {
      this.message.set('删除失败，请重试');
    } finally {
      this.saving.set(false);
      this._resumeClose();
    }
  }
  async dropCards(event: CdkDragDrop<Note[]>): Promise<void> {
    if (
      event.previousContainer !== event.container ||
      event.previousIndex === event.currentIndex
    )
      return;
    const notes = this.notes();
    await this._moveCard(
      notes[event.previousIndex],
      notes[event.currentIndex],
      event.currentIndex > event.previousIndex,
    );
  }
  async moveCard(event: Event, note: Note, delta: number): Promise<void> {
    event.preventDefault();
    event.stopPropagation();
    const notes = this.notes(),
      index = notes.findIndex((n) => n.id === note.id),
      target = notes[index + delta];
    if (target) await this._moveCard(note, target, delta > 0);
  }
  private async _moveCard(note: Note, target: Note, after: boolean): Promise<void> {
    if (!note || !target || this.saving() || this.editorOpen() || this.trashed()) return;
    this.saving.set(true);
    this.message.set('');
    try {
      await this._service.reorder(
        note.id,
        target.id,
        after,
        note.personalMemo?.order?.revision ?? 0,
      );
      this.message.set('已保存到本机');
    } catch {
      this.message.set('排序保存失败，请重试');
    } finally {
      this.saving.set(false);
      this._resumeClose();
    }
  }
  async testNotification(): Promise<void> {
    try {
      const notification = await this._notify.notifyDesktop({
        title: '备忘提醒（测试）',
        body: '这是项目进展的测试提醒，可以在软件最小化时收到。',
      });
      this.message.set(
        notification
          ? '已发送测试提醒，请查看 Windows 通知'
          : '通知未开启，请允许系统通知后重试',
      );
    } catch {
      this.message.set('提醒发送失败，请检查 Windows 通知设置');
    }
  }

  timeLabel(timestamp: number): string {
    return new Date(timestamp).toLocaleString('zh-CN', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    });
  }
}
