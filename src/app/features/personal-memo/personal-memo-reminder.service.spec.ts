import { fakeAsync, flushMicrotasks, TestBed, tick } from '@angular/core/testing';
import { Router } from '@angular/router';
import { BehaviorSubject } from 'rxjs';
import { DataInitStateService } from '../../core/data-init/data-init-state.service';
import { NotifyService } from '../../core/notify/notify.service';
import { Note } from '../note/note.model';
import { PersonalMemoService } from './personal-memo.service';
import { PersonalMemoReminderService } from './personal-memo-reminder.service';

describe('PersonalMemoReminderService', () => {
  let notes: BehaviorSubject<Note[]>;
  let notify: jasmine.Spy;
  let read: jasmine.Spy;
  let service: PersonalMemoReminderService;
  const makeNote = (id: string, remindAt: number, advanceMinutes = 0): Note => ({
    id,
    projectId: null,
    isPinnedToToday: false,
    content: '提醒内容',
    created: 1,
    modified: 1,
    personalMemo: {
      format: null,
      remindAt,
      advanceMinutes,
      deletedAt: null,
      revision: 1,
      operationId: id,
    },
  });
  beforeEach(() => {
    notes = new BehaviorSubject<Note[]>([]);
    notify = jasmine.createSpy().and.resolveTo(undefined);
    read = jasmine
      .createSpy()
      .and.callFake(async (id: string, key: string, now: number) => {
        const note = notes.value.find((item) => item.id === id);
        const meta = note?.personalMemo;
        const offsetMs = (meta?.advanceMinutes ?? 0) * 60000;
        return meta &&
          !meta.deletedAt &&
          `${meta.remindAt}:${meta.advanceMinutes ?? 0}` === key &&
          meta.remindAt! - offsetMs <= now
          ? note
          : null;
      });
    TestBed.configureTestingModule({
      providers: [
        {
          provide: DataInitStateService,
          useValue: { isAllDataLoadedInitially$: new BehaviorSubject(true) },
        },
        { provide: PersonalMemoService, useValue: { notes$: notes, readReminder: read } },
        { provide: NotifyService, useValue: { notifyDesktop: notify } },
        { provide: Router, useValue: { navigate: jasmine.createSpy() } },
      ],
    });
    service = TestBed.inject(PersonalMemoReminderService);
  });
  it('notifies once at the chosen advance time across pages', fakeAsync(() => {
    service.start();
    const advanceMs = 5 * 60000;
    notes.next([makeNote('a', Date.now() + advanceMs + 2000, 5)]);
    tick(1000);
    flushMicrotasks();
    expect(notify).not.toHaveBeenCalled();
    tick(1000);
    flushMicrotasks();
    expect(notify).toHaveBeenCalledTimes(1);
    tick(5000);
    flushMicrotasks();
    expect(notify).toHaveBeenCalledTimes(1);
  }));
  it('does not repeat overdue reminders at startup or notify deleted memos', fakeAsync(() => {
    const past = makeNote('old', Date.now() - 10000);
    const trashed = makeNote('trash', Date.now() + 1000);
    trashed.personalMemo!.deletedAt = Date.now();
    notes.next([past, trashed]);
    service.start();
    tick(3000);
    flushMicrotasks();
    expect(notify).not.toHaveBeenCalled();
  }));
  it('does not alert a reminder cancelled while its queued write is settling', fakeAsync(() => {
    service.start();
    const note = makeNote('a', Date.now() + 1000);
    notes.next([note]);
    read.and.resolveTo(null);
    tick(1000);
    flushMicrotasks();
    expect(notify).not.toHaveBeenCalled();
  }));
});
