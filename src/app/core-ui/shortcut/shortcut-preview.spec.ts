import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { of } from 'rxjs';
import { Router, ActivatedRoute } from '@angular/router';
import { OverlayContainer } from '@angular/cdk/overlay';
import { MatDialog } from '@angular/material/dialog';
import { Store } from '@ngrx/store';
import { ShortcutService } from './shortcut.service';
import { PERSONAL_PREVIEW_MODE } from '../../features/personal-workspace/personal-preview-mode';
import { GlobalConfigService } from '../../features/config/global-config.service';
import { TaskService } from '../../features/tasks/task.service';
import { WorkContextService } from '../../features/work-context/work-context.service';
import { LayoutService } from '../layout/layout.service';
import { UiHelperService } from '../../features/ui-helper/ui-helper.service';
import { SyncWrapperService } from '../../imex/sync/sync-wrapper.service';
import { PluginBridgeService } from '../../plugins/plugin-bridge.service';
import { TaskShortcutService } from '../../features/tasks/task-shortcut.service';

describe('preview shortcut boundary', () => {
  let service: ShortcutService;
  let dispatch: jasmine.Spy;
  let open: jasmine.Spy;
  let focus: jasmine.Spy;
  let taskShortcut: jasmine.Spy;
  beforeEach(() => {
    dispatch = jasmine.createSpy('dispatch');
    open = jasmine.createSpy('open');
    focus = jasmine.createSpy('focus');
    taskShortcut = jasmine.createSpy('taskShortcut');
    TestBed.configureTestingModule({
      providers: [
        ShortcutService,
        { provide: PERSONAL_PREVIEW_MODE, useValue: true },
        {
          provide: GlobalConfigService,
          useValue: {
            cfg: signal({
              keyboard: {
                goToFocusMode: 'F',
                addNewProject: 'Shift+P',
                focusSideNav: 'Shift+N',
              },
            }),
            appFeatures: signal({ isFocusModeEnabled: true }),
          },
        },
        { provide: Router, useValue: {} },
        { provide: ActivatedRoute, useValue: { queryParams: of({}) } },
        { provide: LayoutService, useValue: { focusSideNav: focus } },
        { provide: MatDialog, useValue: { openDialogs: [], open } },
        { provide: Store, useValue: { dispatch } },
        { provide: TaskService, useValue: {} },
        { provide: WorkContextService, useValue: {} },
        { provide: UiHelperService, useValue: {} },
        { provide: SyncWrapperService, useValue: {} },
        { provide: PluginBridgeService, useValue: {} },
        { provide: TaskShortcutService, useValue: { handleTaskShortcuts: taskShortcut } },
        {
          provide: OverlayContainer,
          useValue: {
            getContainerElement: () => ({ querySelector: () => null, children: [] }),
          },
        },
      ],
    });
    service = TestBed.inject(ShortcutService);
  });
  const event = (
    code: string,
    shiftKey = false,
    target: HTMLElement = document.body,
  ): KeyboardEvent => {
    const ev = new KeyboardEvent('keydown', { code, shiftKey, cancelable: true });
    Object.defineProperty(ev, 'target', { value: target });
    return ev;
  };
  it('does not dispatch focus mode or open an upstream project dialog', async () => {
    await service.handleKeyDown(event('KeyF'));
    await service.handleKeyDown(event('KeyP', true));
    expect(dispatch).not.toHaveBeenCalled();
    expect(open).not.toHaveBeenCalled();
    expect(taskShortcut).not.toHaveBeenCalled();
  });
  it('preserves the side navigation shortcut', async () => {
    const ev = event('KeyN', true);
    await service.handleKeyDown(ev);
    expect(focus).toHaveBeenCalled();
    expect(ev.defaultPrevented).toBeTrue();
  });
  it('does not intercept normal text input', async () => {
    const ev = event('KeyF', false, document.createElement('textarea'));
    await service.handleKeyDown(ev);
    expect(ev.defaultPrevented).toBeFalse();
    expect(dispatch).not.toHaveBeenCalled();
  });
});
