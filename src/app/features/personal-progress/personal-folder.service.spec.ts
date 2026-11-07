import { TestBed } from '@angular/core/testing';
import { PersonalFolderService } from './personal-folder.service';

describe('PersonalFolderService', () => {
  let service: PersonalFolderService;

  beforeEach(() => {
    localStorage.clear();
    TestBed.configureTestingModule({});
    service = TestBed.inject(PersonalFolderService);
  });

  afterEach(() => localStorage.clear());

  it('exports and restores folders with assignments', () => {
    const first = service.create('广告优化');
    const second = service.create('日常事务');
    service.assign('project-a', first.id);
    service.assign('project-b', second.id);
    service.move(second.id, first.id);

    const state = service.exportState();
    localStorage.clear();

    const restored = new PersonalFolderService();
    restored.restoreState(state);

    expect(restored.folders().map((folder) => folder.name)).toEqual([
      '日常事务',
      '广告优化',
    ]);
    expect(restored.folders().map((folder) => folder.order)).toEqual([0, 1]);
    expect(restored.folderFor('project-a')?.name).toBe('广告优化');
    expect(restored.folderFor('project-b')?.name).toBe('日常事务');
  });

  it('drops invalid folders and dangling assignments during restore', () => {
    service.restoreState({
      folders: [
        { id: 'valid', name: ' 保留 ', order: 5 },
        { id: '', name: '空 id', order: 0 },
        { id: 'missing-name', name: '   ', order: 1 },
      ],
      assignments: {
        projectA: 'valid',
        projectB: 'missing-folder',
        projectC: 3,
      },
    });

    expect(service.folders()).toEqual([{ id: 'valid', name: '保留', order: 0 }]);
    expect(service.assignments()).toEqual({ projectA: 'valid' });
  });
});
