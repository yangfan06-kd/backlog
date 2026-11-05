export interface LocalBackupMeta {
  folder: string;
  path: string;
  name: string;
  created: number;
}

export type Project1BackupKind = 'auto' | 'recovery';

export interface Project1BackupMeta {
  id: string;
  kind: Project1BackupKind;
  createdAt: number;
  size: number;
  valid: boolean;
  error?: string;
  dataHash?: string;
}
