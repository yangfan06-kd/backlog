import { TestBed } from '@angular/core/testing';
import { of } from 'rxjs';
import { Router } from '@angular/router';
import { Store } from '@ngrx/store';
import { Project } from '../project/project.model';
import { PersonalProgressService } from '../personal-progress/personal-progress.service';
import { PersonalMemoService } from '../personal-memo/personal-memo.service';
import { SnackService } from '../../core/snack/snack.service';
import { PersonalQuickCapturePanelComponent } from './personal-quick-capture-panel.component';

const project = {
  id: 'p1',
  title: '做义工',
  isArchived: false,
  isDone: false,
  personalProgress: { schemaVersion: 1, entries: [], kind: 'project' },
  taskIds: [],
  backlogTaskIds: [],
  noteIds: [],
} as unknown as Project;

const routine = {
  id: 'r1',
  title: '广告调整',
  isArchived: false,
  isDone: false,
  personalProgress: { schemaVersion: 1, entries: [], kind: 'routine' },
  taskIds: [],
  backlogTaskIds: [],
  noteIds: [],
} as unknown as Project;

describe('PersonalQuickCapturePanelComponent', () => {
  const addEntry = jasmine
    .createSpy('addEntry')
    .and.resolveTo({ status: 'persisted', operationId: 'op', value: { entryId: 'e1' } });
  const memoSave = jasmine.createSpy('memoSave').and.resolveTo(undefined);
  const snackOpen = jasmine.createSpy('snackOpen');

  beforeEach(async () => {
    localStorage.clear();
    await TestBed.configureTestingModule({
      imports: [PersonalQuickCapturePanelComponent],
      providers: [
        { provide: Store, useValue: { select: () => of([project, routine]) } },
        {
          provide: Router,
          useValue: { url: '/personal-progress?projectId=p1' },
        },
        {
          provide: PersonalProgressService,
          useValue: {
            todayStr: () => '2026-11-05',
            addEntry,
          },
        },
        { provide: PersonalMemoService, useValue: { save: memoSave } },
        { provide: SnackService, useValue: { open: snackOpen } },
      ],
    }).compileComponents();
  });

  afterEach(() => {
    addEntry.calls.reset();
    memoSave.calls.reset();
    snackOpen.calls.reset();
    localStorage.clear();
  });

  it('defaults to the project in the current route', () => {
    const fixture = TestBed.createComponent(PersonalQuickCapturePanelComponent);
    fixture.detectChanges();
    expect(fixture.componentInstance.selectedProjectId()).toBe('p1');
    expect(fixture.componentInstance.canSave()).toBeFalse();
  });

  it('saves one manual entry for today and closes the panel', async () => {
    const fixture = TestBed.createComponent(PersonalQuickCapturePanelComponent);
    fixture.detectChanges();
    fixture.componentInstance.body.set('今天去了南区篮球场');
    expect(fixture.componentInstance.canSave()).toBeTrue();

    await fixture.componentInstance.save();

    expect(addEntry).toHaveBeenCalledOnceWith(
      jasmine.objectContaining({
        projectId: 'p1',
        recordDay: '2026-11-05',
        body: '今天去了南区篮球场',
        ownerKind: 'project',
      }),
    );
    expect(snackOpen).toHaveBeenCalled();
    expect(fixture.componentInstance.body()).toBe('');
  });

  it('saves one routine record with the routine owner kind', async () => {
    const fixture = TestBed.createComponent(PersonalQuickCapturePanelComponent);
    fixture.detectChanges();
    fixture.componentInstance.setTarget('routine');
    fixture.componentInstance.body.set('今天调整了广告预算');
    expect(fixture.componentInstance.selectedRoutineId()).toBe('r1');
    expect(fixture.componentInstance.canSave()).toBeTrue();

    await fixture.componentInstance.save();

    expect(addEntry).toHaveBeenCalledOnceWith(
      jasmine.objectContaining({
        projectId: 'r1',
        recordDay: '2026-11-05',
        body: '今天调整了广告预算',
        ownerKind: 'routine',
      }),
    );
  });

  it('saves a memo without a project target', async () => {
    const fixture = TestBed.createComponent(PersonalQuickCapturePanelComponent);
    fixture.detectChanges();
    fixture.componentInstance.setTarget('memo');
    fixture.componentInstance.body.set('记得周五复盘');
    expect(fixture.componentInstance.hasTarget()).toBeTrue();
    expect(fixture.componentInstance.canSave()).toBeTrue();

    await fixture.componentInstance.save();

    expect(memoSave).toHaveBeenCalledOnceWith(
      jasmine.objectContaining({
        text: '记得周五复盘',
        format: null,
        remindAt: null,
      }),
    );
    expect(addEntry).not.toHaveBeenCalled();
  });
});
