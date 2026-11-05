import { TestBed, fakeAsync, tick, flushMicrotasks } from '@angular/core/testing';
import { Subject } from 'rxjs';
import { INBOX_PROJECT } from '../../features/project/project.const';
import { WORKLOG_EXPORT_DEFAULTS } from '../../features/work-context/work-context.const';
import { DataInitStateService } from '../../core/data-init/data-init-state.service';
import { ImexViewService } from '../../imex/imex-meta/imex-view.service';
import { ExecBeforeCloseService } from '../../core/electron/exec-before-close.service';
import { TranslateService } from '@ngx-translate/core';
import { MatDialog } from '@angular/material/dialog';
import { LOCAL_ACTIONS } from '../../util/local-actions.token';
import { PersonalAutoBackupService } from './personal-auto-backup.service';
import { PersonalBackupFacade } from './personal-backup.facade';
import { PersonalAutoBackupStore } from './personal-auto-backup.store';
import { PersonalBackupValidator } from './personal-backup-validator.service';
import { PERSONAL_PREVIEW_MODE } from './personal-preview-mode';
import { Project1BackupMeta } from '../../imex/local-backup/local-backup.model';

const createData = (projectId = INBOX_PROJECT.id): Record<string, unknown> => ({
  task: { ids: [], entities: {}, currentTaskId: null, selectedTaskId: null },
  project: {
    ids: [projectId],
    entities: {
      [projectId]: {
        id: projectId,
        title: projectId,
        taskIds: [],
        backlogTaskIds: [],
        noteIds: [],
        isHiddenFromMenu: false,
        isArchived: false,
        advancedCfg: { worklogExportSettings: { ...WORKLOG_EXPORT_DEFAULTS } },
      },
    },
  },
  tag: {
    ids: ['TODAY'],
    entities: {
      TODAY: {
        id: 'TODAY',
        title: 'Today',
        taskIds: [],
        icon: 'wb_sunny',
        advancedCfg: { worklogExportSettings: { ...WORKLOG_EXPORT_DEFAULTS } },
      },
    },
  },
  globalConfig: {
    misc: { isDisableInitialDialog: true },
    sync: { isEnabled: false, syncProvider: null },
  },
  note: { ids: [], entities: {}, todayOrder: [] },
  simpleCounter: { ids: [], entities: {} },
  taskRepeatCfg: { ids: [], entities: {} },
  metric: { ids: [], entities: {} },
  planner: { days: {} },
  issueProvider: { ids: [], entities: {} },
  boards: { boardCfgs: [] },
  menuTree: { tagTree: [], projectTree: [] },
  timeTracking: { project: {}, tag: {} },
  archiveYoung: {
    task: { ids: [], entities: {} },
    timeTracking: { project: {}, tag: {} },
    lastTimeTrackingFlush: 0,
  },
  archiveOld: {
    task: { ids: [], entities: {} },
    timeTracking: { project: {}, tag: {} },
    lastTimeTrackingFlush: 0,
  },
  reminders: [],
  pluginMetadata: [],
  pluginUserData: [],
});

const snapshot = (projectId = INBOX_PROJECT.id): Record<string, unknown> => ({
  timestamp: 1,
  lastUpdate: 1,
  crossModelVersion: 1,
  data: createData(projectId),
});

class FakeFacade {
  snap = snapshot('project-a');
  captureSnapshot = jasmine
    .createSpy('captureSnapshot')
    .and.callFake(() => Promise.resolve(this.snap));
}

class FakeStore {
  isAvailable = true;
  versions: Project1BackupMeta[] = [];
  latestText: string | null = null;
  write = jasmine
    .createSpy('write')
    .and.callFake((_snapshot: unknown, kind: 'auto' | 'recovery') =>
      Promise.resolve({
        id: 'auto-1.json',
        kind,
        createdAt: 100,
        size: 10,
        valid: true,
      } as Project1BackupMeta),
    );
  list = jasmine.createSpy('list').and.callFake(() => Promise.resolve(this.versions));
  read = jasmine.createSpy('read').and.callFake(() =>
    Promise.resolve({
      text: this.latestText ?? '{}',
      meta: this.versions[0],
    }),
  );
}

describe('PersonalAutoBackupService', () => {
  let service: PersonalAutoBackupService;
  let facade: FakeFacade;
  let store: FakeStore;
  let dataLoaded: Subject<boolean>;
  let importState: Subject<boolean>;
  let actions: Subject<unknown>;

  const setup = (): void => {
    facade = new FakeFacade();
    store = new FakeStore();
    dataLoaded = new Subject<boolean>();
    importState = new Subject<boolean>();
    actions = new Subject<unknown>();
    TestBed.configureTestingModule({
      providers: [
        PersonalAutoBackupService,
        { provide: PersonalBackupFacade, useValue: facade },
        { provide: PersonalAutoBackupStore, useValue: store },
        { provide: PersonalBackupValidator, useValue: { isValid: () => true } },
        { provide: PERSONAL_PREVIEW_MODE, useValue: true },
        {
          provide: DataInitStateService,
          useValue: { isAllDataLoadedInitially$: dataLoaded },
        },
        {
          provide: ImexViewService,
          useValue: { isDataImportInProgress$: importState },
        },
        { provide: LOCAL_ACTIONS, useValue: actions },
        {
          provide: ExecBeforeCloseService,
          useValue: {
            schedule: () => {},
            onBeforeClose$: new Subject<readonly string[]>(),
            waitForOtherHandlers: async () => true,
            setDone: () => {},
            cancelClose: () => {},
            unschedule: () => {},
          },
        },
        { provide: TranslateService, useValue: { instant: (key: string) => key } },
        { provide: MatDialog, useValue: { open: jasmine.createSpy('open') } },
      ],
    });
    service = TestBed.inject(PersonalAutoBackupService);
  };

  const start = async (): Promise<void> => {
    service.init();
    dataLoaded.next(true);
    dataLoaded.complete();
    await new Promise((resolve) => setTimeout(resolve, 0));
  };

  it('does not create a version for an empty/new profile', async () => {
    setup();
    facade.snap = snapshot();
    await start();
    expect(store.write).not.toHaveBeenCalled();
    expect(service.status().kind).toBe('empty');
  });

  it('writes meaningful data from a project/routine/archive-only snapshot', async () => {
    setup();
    facade.snap = snapshot('project-only');
    await start();
    await service.runBackup('manual');
    expect(store.write).toHaveBeenCalled();
    expect(service.status().kind).toBe('success');
  });

  it('does not write the same data twice when the latest version matches', async () => {
    setup();
    const same = snapshot('project-only');
    facade.snap = same;
    store.versions = [
      {
        id: 'auto-1.json',
        kind: 'auto',
        createdAt: 100,
        size: 10,
        valid: true,
      },
    ];
    store.latestText = JSON.stringify(snapshot('project-only'));
    await start();
    expect(store.write).not.toHaveBeenCalled();
  });

  it('keeps a pending state and reports failure without advancing success', async () => {
    setup();
    store.write.and.rejectWith(new Error('disk full'));
    await start();
    expect(service.status().kind).toBe('failed');
    expect(service.status().lastSuccess).toBeNull();
    expect(service.status().pending).toBeTrue();
  });

  it('waits 30 seconds after a saved change and resets the debounce', fakeAsync(() => {
    setup();
    service.init();
    dataLoaded.next(true);
    flushMicrotasks();
    tick(0);
    flushMicrotasks();
    const before = store.write.calls.count();
    actions.next({ type: 'change', meta: { isPersistent: true } });
    tick(29999);
    flushMicrotasks();
    expect(store.write.calls.count()).toBe(before);
    tick(1);
    flushMicrotasks();
    expect(store.write.calls.count()).toBe(before + 1);
  }));

  it('uses the five-minute maximum wait under continuous changes', fakeAsync(() => {
    setup();
    service.init();
    dataLoaded.next(true);
    flushMicrotasks();
    tick(0);
    flushMicrotasks();
    const before = store.write.calls.count();
    for (let elapsed = 0; elapsed < 300000; elapsed += 20000) {
      actions.next({ type: 'change', meta: { isPersistent: true } });
      tick(20000);
      flushMicrotasks();
    }
    expect(store.write.calls.count()).toBeGreaterThan(before);
  }));

  it('backs up again when a change lands after the snapshot started', async () => {
    setup();
    await start();
    expect(store.write).toHaveBeenCalledTimes(1);
    actions.next({ type: 'change', meta: { isPersistent: true } });
    await service.runBackup('tail');
    expect(store.write).toHaveBeenCalledTimes(2);
  });

  it('retains changes made while the native file write is in flight', fakeAsync(() => {
    setup();
    service.init();
    dataLoaded.next(true);
    flushMicrotasks();
    let releaseWrite!: () => void;
    store.write.and.callFake(
      () => new Promise<void>((resolve) => (releaseWrite = resolve)),
    );
    actions.next({ type: 'first-saved-change', meta: { isPersistent: true } });
    void service.runBackup('review');
    flushMicrotasks();
    actions.next({ type: 'second-saved-change', meta: { isPersistent: true } });
    releaseWrite();
    flushMicrotasks();
    expect(service.status().pending).toBeTrue();
    store.write.and.resolveTo({ id: 'auto-next.json', valid: true });
    tick(30000);
    flushMicrotasks();
    expect(store.write.calls.count()).toBe(3);
    TestBed.resetTestingModule();
  }));

  it('reschedules the restored state after an import pause', fakeAsync(() => {
    setup();
    service.init();
    dataLoaded.next(true);
    flushMicrotasks();
    actions.next({ type: 'saved-before-import', meta: { isPersistent: true } });
    importState.next(true);
    importState.next(false);
    tick(30000);
    flushMicrotasks();
    expect(store.write.calls.count()).toBe(2);
    TestBed.resetTestingModule();
  }));

  it('does not report success if the committed file cannot be listed and verified', async () => {
    setup();
    await start();
    store.list.and.rejectWith(new Error('directory unreadable'));
    await service.requestBackupNow();
    expect(service.status().kind).toBe('failed');
  });

  it('does not let idle or other transient actions postpone a saved-data backup', fakeAsync(() => {
    setup();
    service.init();
    dataLoaded.next(true);
    flushMicrotasks();
    const before = store.write.calls.count();
    actions.next({ type: 'saved-data', meta: { isPersistent: true } });
    tick(20000);
    actions.next({ type: 'idle-status' });
    tick(10000);
    flushMicrotasks();
    expect(store.write.calls.count()).toBe(before + 1);
    TestBed.resetTestingModule();
  }));

  it('waits for draft and primary-storage guards before capturing the closing backup', async () => {
    setup();
    await start();
    const before = facade.captureSnapshot.calls.count();
    const guard = TestBed.inject(ExecBeforeCloseService);
    let releaseGuard!: (allowed: boolean) => void;
    spyOn(guard, 'waitForOtherHandlers').and.returnValue(
      new Promise<boolean>((resolve) => (releaseGuard = resolve)),
    );
    const close = (
      service as unknown as { _handleCloseRequested(): Promise<void> }
    )._handleCloseRequested();
    await Promise.resolve();
    expect(facade.captureSnapshot.calls.count()).toBe(before);
    releaseGuard(true);
    await close;
    expect(facade.captureSnapshot.calls.count()).toBe(before + 1);
  });
});
