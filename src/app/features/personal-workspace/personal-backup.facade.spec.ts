import { TestBed } from '@angular/core/testing';
import { BackupService } from '../../op-log/backup/backup.service';
import { OperationWriteFlushService } from '../../op-log/sync/operation-write-flush.service';
import { PersonalCommandCoordinatorService } from '../personal-progress/personal-command-coordinator.service';
import { PersonalBackupFacade } from './personal-backup.facade';
import {
  PersonalBackupActivityService,
  PersonalBackupGuard,
} from './personal-backup-activity.service';
import { PERSONAL_PREVIEW_MODE } from './personal-preview-mode';
import { PersonalAutoBackupStore } from './personal-auto-backup.store';
import { PersonalBackupValidator } from './personal-backup-validator.service';
import { ImexViewService } from '../../imex/imex-meta/imex-view.service';

class FakeCoordinator {
  calls: Array<() => Promise<unknown>> = [];
  enqueue<T>(fn: () => Promise<T>): Promise<T> {
    this.calls.push(fn);
    return fn();
  }
}

class FakeFlush {
  flushThenRunExclusive<T>(fn: () => Promise<T>): Promise<T> {
    return fn();
  }
}

class FakeBackup {
  snapshot = {
    timestamp: 1,
    lastUpdate: 1,
    crossModelVersion: 1,
    data: {
      task: { ids: [], entities: {} },
      project: { ids: ['A'], entities: { A: { id: 'A', title: 'A' } } },
    },
  };
  loadCompleteBackup = jasmine
    .createSpy('loadCompleteBackup')
    .and.returnValue(Promise.resolve(this.snapshot));
  importCompleteBackup = jasmine
    .createSpy('importCompleteBackup')
    .and.resolveTo(undefined);
}

describe('PersonalBackupFacade', () => {
  let facade: PersonalBackupFacade;
  let coordinator: FakeCoordinator;
  let flush: FakeFlush;
  let backup: FakeBackup;
  let saveFileDialog: jasmine.Spy;
  let autoStore: { write: jasmine.Spy };

  const setup = (preview = true): void => {
    coordinator = new FakeCoordinator();
    flush = new FakeFlush();
    backup = new FakeBackup();
    saveFileDialog = jasmine
      .createSpy('saveFileDialog')
      .and.resolveTo({ success: true, path: 'G:/project1/output/runtime/x.json' });
    autoStore = {
      write: jasmine.createSpy('autoWrite').and.resolveTo({
        id: 'recovery-1.json',
        kind: 'recovery',
        createdAt: 1,
        size: 1,
        valid: true,
      }),
    };
    TestBed.configureTestingModule({
      providers: [
        PersonalBackupFacade,
        { provide: PersonalCommandCoordinatorService, useValue: coordinator },
        { provide: OperationWriteFlushService, useValue: flush },
        { provide: BackupService, useValue: backup },
        { provide: PERSONAL_PREVIEW_MODE, useValue: preview },
        { provide: PersonalAutoBackupStore, useValue: autoStore },
        { provide: PersonalBackupValidator, useValue: { isValid: () => true } },
        {
          provide: ImexViewService,
          useValue: { setDataImportInProgress: jasmine.createSpy('setImport') },
        },
      ],
    });
    (window as unknown as { ea: unknown }).ea = { saveFileDialog };
    facade = TestBed.inject(PersonalBackupFacade);
  };

  afterEach(() => {
    delete (window as unknown as { ea?: unknown }).ea;
  });

  it('takes the complete snapshot after the queue and real write cutoff, then saves', async () => {
    setup();
    const result = await facade.exportBackup();
    expect(result.status).toBe('saved');
    expect(backup.loadCompleteBackup).toHaveBeenCalledWith(true);
    expect(coordinator.calls.length).toBe(1);
    expect(saveFileDialog).toHaveBeenCalled();
    const [filename, data] = saveFileDialog.calls.mostRecent().args as [string, string];
    expect(filename).toContain('project1-personal-backup-');
    expect(JSON.parse(data).data.project).toBeTruthy();
  });

  it('reports cancel and failed native save without claiming success', async () => {
    setup();
    saveFileDialog.and.resolveTo({ success: false });
    expect((await facade.exportBackup()).status).toBe('cancelled');
    saveFileDialog.and.resolveTo({ success: false, error: 'PREVIEW_PATH_OUTSIDE' });
    const failed = await facade.exportBackup();
    expect(failed.status).toBe('failed');
    if (failed.status === 'failed') expect(failed.code).toBe('PREVIEW_PATH_OUTSIDE');
  });

  it('imports a complete backup through the existing non-preview import path', async () => {
    setup(false);
    await facade.restoreFromText(JSON.stringify({ project: { ids: [], entities: {} } }));
    expect(backup.importCompleteBackup).toHaveBeenCalled();
    const args = backup.importCompleteBackup.calls.mostRecent().args;
    expect(args[1]).toBeFalse();
    expect(args[2]).toBeTrue();
  });

  it('captures a recovery copy in the same coordinator operation before preview restore', async () => {
    setup(true);
    await facade.restoreFromText('{}');
    expect(autoStore.write).toHaveBeenCalledWith(jasmine.anything(), 'recovery');
    expect(backup.importCompleteBackup).toHaveBeenCalled();
  });

  it('aborts preview import when the recovery copy fails', async () => {
    setup(true);
    autoStore.write.and.rejectWith(new Error('disk full'));
    let error: unknown;
    try {
      await facade.restoreFromText('{}');
    } catch (e) {
      error = e;
    }
    expect(String(error)).toContain('RECOVERY_COPY_FAILED');
    expect(backup.importCompleteBackup).not.toHaveBeenCalled();
  });

  it('never falls back to a browser download when the preview save bridge is absent', async () => {
    setup();
    (window as unknown as { ea: unknown }).ea = {};
    const anchor = document.createElement('a');
    spyOn(anchor, 'click');
    spyOn(document, 'createElement').and.returnValue(anchor);
    const result = await facade.exportBackup();
    expect(result.status).toBe('failed');
    expect(anchor.click).not.toHaveBeenCalled();
  });

  it('rejects malformed JSON before touching the import path', async () => {
    setup();
    let error: unknown;
    try {
      await facade.restoreFromText('{not json');
    } catch (e) {
      error = e;
    }
    expect(error).toBeTruthy();
    expect(backup.importCompleteBackup).not.toHaveBeenCalled();
  });
});

describe('PersonalBackupGuard', () => {
  it('blocks route changes while a backup operation is in flight', () => {
    TestBed.configureTestingModule({ providers: [PersonalBackupActivityService] });
    const activity = TestBed.inject(PersonalBackupActivityService);
    const guard = TestBed.runInInjectionContext(
      () => new PersonalBackupGuard(),
    ) as PersonalBackupGuard;
    expect(guard.canDeactivate()).toBeTrue();
    activity.isBusy.set(true);
    expect(guard.canDeactivate()).toBeFalse();
    activity.isBusy.set(false);
    expect(guard.canDeactivate()).toBeTrue();
  });
});
