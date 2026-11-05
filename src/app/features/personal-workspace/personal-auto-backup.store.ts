import { inject, Injectable } from '@angular/core';
import { AppDataComplete, AllModelConfig } from '../../op-log/model/model-config';
import { CompleteBackup } from '../../op-log/core/types/sync.types';
import {
  Project1BackupKind,
  Project1BackupMeta,
} from '../../imex/local-backup/local-backup.model';
import { PERSONAL_PREVIEW_MODE } from './personal-preview-mode';
import { PersonalBackupValidator } from './personal-backup-validator.service';

@Injectable({ providedIn: 'root' })
export class PersonalAutoBackupStore {
  private readonly _isPreviewMode = inject(PERSONAL_PREVIEW_MODE);
  private readonly _validator = inject(PersonalBackupValidator);

  get isAvailable(): boolean {
    return (
      this._isPreviewMode &&
      typeof window !== 'undefined' &&
      typeof window.ea?.project1AutoBackupWrite === 'function' &&
      typeof window.ea?.project1AutoBackupList === 'function' &&
      typeof window.ea?.project1AutoBackupRead === 'function' &&
      typeof window.ea?.project1AutoBackupDelete === 'function'
    );
  }

  async write(
    snapshot: CompleteBackup<AllModelConfig>,
    kind: Project1BackupKind,
  ): Promise<Project1BackupMeta> {
    if (!this.isAvailable) throw new Error('PREVIEW_RUNTIME_MISSING');
    return window.ea.project1AutoBackupWrite({
      data: snapshot as unknown as AppDataComplete,
      kind,
    });
  }

  async list(): Promise<Project1BackupMeta[]> {
    if (!this.isAvailable) return [];
    const versions = await window.ea.project1AutoBackupList();
    return Promise.all(
      versions.map(async (version) => {
        if (!version.valid) return version;
        try {
          const { text } = await window.ea.project1AutoBackupRead(version.id);
          const parsed = JSON.parse(text) as { data: AppDataComplete };
          if (await this._validator.isValid(parsed.data)) return version;
        } catch {
          // A valid file checksum does not establish a valid business snapshot.
        }
        return { ...version, valid: false, error: 'INVALID_BACKUP_DATA' };
      }),
    );
  }

  async delete(id: string): Promise<void> {
    if (!this.isAvailable) throw new Error('PREVIEW_RUNTIME_MISSING');
    await window.ea.project1AutoBackupDelete(id);
  }

  async read(id: string): Promise<{ text: string; meta: Project1BackupMeta }> {
    if (!this.isAvailable) throw new Error('PREVIEW_RUNTIME_MISSING');
    return window.ea.project1AutoBackupRead(id);
  }
}
