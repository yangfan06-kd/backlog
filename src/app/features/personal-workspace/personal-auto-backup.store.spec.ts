import { TestBed } from '@angular/core/testing';
import { PersonalAutoBackupStore } from './personal-auto-backup.store';
import { PersonalBackupValidator } from './personal-backup-validator.service';
import { PERSONAL_PREVIEW_MODE } from './personal-preview-mode';

describe('PersonalAutoBackupStore file and business validation', () => {
  let previous: Window['ea'];
  let validator: { isValid: jasmine.Spy };
  let store: PersonalAutoBackupStore;

  beforeEach(() => {
    previous = window.ea;
    validator = { isValid: jasmine.createSpy('validate').and.resolveTo(true) };
    window.ea = {
      project1AutoBackupWrite: async () => undefined,
      project1AutoBackupDelete: async () => undefined,
      project1AutoBackupList: async () => [
        { id: 'auto-test.json', kind: 'auto', valid: true, createdAt: 10, size: 100 },
      ],
      project1AutoBackupRead: async () => ({
        text: JSON.stringify({ data: {} }),
        meta: {},
      }),
    } as unknown as Window['ea'];
    TestBed.configureTestingModule({
      providers: [
        { provide: PERSONAL_PREVIEW_MODE, useValue: true },
        { provide: PersonalBackupValidator, useValue: validator },
      ],
    });
    store = TestBed.inject(PersonalAutoBackupStore);
  });

  afterEach(() => {
    window.ea = previous;
  });

  it('requires valid business data in addition to a valid native checksum', async () => {
    validator.isValid.and.resolveTo(false);
    expect((await store.list())[0].valid).toBeFalse();
  });

  it('offers a version only after reading and validating it', async () => {
    expect((await store.list())[0].valid).toBeTrue();
    expect(validator.isValid).toHaveBeenCalled();
  });

  it('marks a vanished or unreadable file unusable', async () => {
    window.ea.project1AutoBackupRead = async () => {
      throw new Error('unreadable');
    };
    expect((await store.list())[0].valid).toBeFalse();
  });
});
