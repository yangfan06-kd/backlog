import { TestBed } from '@angular/core/testing';
import { Subject } from 'rxjs';
import {
  BEFORE_CLOSE_REQUESTS,
  ExecBeforeCloseService,
} from './exec-before-close.service';

describe('ExecBeforeCloseService close coordination', () => {
  let requests: Subject<string[]>;
  let service: ExecBeforeCloseService;
  let bridge: jasmine.SpyObj<Window['ea']>;
  let originalBridge: Window['ea'];

  beforeEach(() => {
    requests = new Subject<string[]>();
    originalBridge = window.ea;
    bridge = jasmine.createSpyObj<Window['ea']>('ea', [
      'scheduleRegisterBeforeClose',
      'unscheduleRegisterBeforeClose',
      'setDoneRegisterBeforeClose',
    ]);
    window.ea = bridge;
    TestBed.configureTestingModule({
      providers: [{ provide: BEFORE_CLOSE_REQUESTS, useValue: requests }],
    });
    service = TestBed.inject(ExecBeforeCloseService);
    service.onBeforeClose$.subscribe();
    service.schedule('draft');
    service.schedule('finish');
  });

  afterEach(() => {
    requests.complete();
    window.ea = originalBridge;
  });

  it('does not approve the draft check until other handlers explicitly finish', async () => {
    requests.next(['draft', 'finish']);
    let resolved = false;
    const allowed = service.waitForOtherHandlers('draft').then((value) => {
      resolved = true;
      return value;
    });
    await Promise.resolve();
    expect(resolved).toBeFalse();
    service.setDone('finish');
    expect(await allowed).toBeTrue();
  });

  it('propagates cancellation instead of treating a dismissed dialog as permission', async () => {
    requests.next(['draft', 'finish']);
    const allowed = service.waitForOtherHandlers('draft');
    service.cancelClose();
    expect(await allowed).toBeFalse();
    service.setDone('draft');
    expect(bridge.setDoneRegisterBeforeClose).not.toHaveBeenCalled();
  });

  it('restores completed checks after cancellation and protects the next close', async () => {
    requests.next(['draft', 'finish']);
    service.setDone('finish');
    service.cancelClose();
    expect(bridge.scheduleRegisterBeforeClose.calls.allArgs()).toEqual([
      ['draft'],
      ['finish'],
      ['finish'],
    ]);
    requests.next(['draft', 'finish']);
    const allowed = service.waitForOtherHandlers('draft');
    service.setDone('finish');
    expect(await allowed).toBeTrue();
  });

  it('shares repeated close clicks without abandoning existing waiters', async () => {
    service.onBeforeClose$.subscribe();
    requests.next(['draft', 'finish']);
    const allowed = service.waitForOtherHandlers('draft');
    requests.next(['draft', 'finish']);
    service.setDone('finish');
    expect(await allowed).toBeTrue();
  });

  it('does not re-register a destroyed handler when an attempt is cancelled', () => {
    requests.next(['draft', 'finish']);
    service.setDone('finish');
    service.unschedule('finish');
    bridge.scheduleRegisterBeforeClose.calls.reset();
    service.cancelClose();
    expect(bridge.scheduleRegisterBeforeClose).not.toHaveBeenCalled();
  });

  it('finishes drafts before the final backup handler without a circular wait', async () => {
    (service.schedule as (id: string, afterOthers: boolean) => void)('backup', true);
    requests.next(['draft', 'finish', 'backup']);
    let backupAllowed = false;
    const finalBackup = service.waitForOtherHandlers('backup').then((allowed) => {
      backupAllowed = allowed;
      return allowed;
    });
    let draftAllowed = false;
    const draft = service.waitForOtherHandlers('draft').then((allowed) => {
      draftAllowed = allowed;
      return allowed;
    });
    service.setDone('finish');
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(backupAllowed).toBeFalse();
    expect(draftAllowed).toBeTrue();
    service.setDone('backup');
    expect(await draft).toBeTrue();
    service.setDone('draft');
    expect(await finalBackup).toBeTrue();
  });
});
