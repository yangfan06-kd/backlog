import { Injectable, computed, signal } from '@angular/core';

export interface PersonalFolder {
  id: string;
  name: string;
  order: number;
}

export interface PersonalFolderBackupState {
  folders: PersonalFolder[];
  assignments: Record<string, string>;
}

const FOLDERS_KEY = 'project1.folders.v1';
const ASSIGNMENTS_KEY = 'project1.folder-assignments.v1';

const readJson = <T>(key: string, fallback: T): T => {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
};

const writeJson = (key: string, value: unknown): void => {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Folders are a local convenience; a storage failure must not break projects.
  }
};

@Injectable({ providedIn: 'root' })
export class PersonalFolderService {
  private readonly _folders = signal<PersonalFolder[]>(
    readJson<PersonalFolder[]>(FOLDERS_KEY, []).sort((a, b) => a.order - b.order),
  );
  private readonly _assignments = signal<Record<string, string>>(
    readJson<Record<string, string>>(ASSIGNMENTS_KEY, {}),
  );

  readonly folders = this._folders.asReadonly();
  readonly assignments = this._assignments.asReadonly();
  readonly folderMap = computed(
    () => new Map(this._folders().map((folder) => [folder.id, folder])),
  );

  folderFor(projectId: string): PersonalFolder | null {
    const folderId = this._assignments()[projectId];
    return folderId ? (this.folderMap().get(folderId) ?? null) : null;
  }

  create(name = '新文件夹'): PersonalFolder {
    const folder: PersonalFolder = {
      id: `folder-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      name: name.trim() || '新文件夹',
      order: this._folders().length,
    };
    this._folders.update((folders) => [...folders, folder]);
    this._persistFolders();
    return folder;
  }

  rename(folderId: string, name: string): void {
    const clean = name.trim();
    if (!clean) return;
    this._folders.update((folders) =>
      folders.map((folder) =>
        folder.id === folderId ? { ...folder, name: clean } : folder,
      ),
    );
    this._persistFolders();
  }

  remove(folderId: string): void {
    this._folders.update((folders) => folders.filter((folder) => folder.id !== folderId));
    this._assignments.update((assignments) => {
      const next = { ...assignments };
      for (const [projectId, assignedFolderId] of Object.entries(next)) {
        if (assignedFolderId === folderId) delete next[projectId];
      }
      return next;
    });
    this._persistFolders();
    this._persistAssignments();
  }

  move(folderId: string, targetId: string): void {
    if (folderId === targetId) return;
    const current = [...this._folders()];
    const from = current.findIndex((folder) => folder.id === folderId);
    const to = current.findIndex((folder) => folder.id === targetId);
    if (from < 0 || to < 0) return;
    const [moved] = current.splice(from, 1);
    current.splice(to, 0, moved);
    this._folders.set(current.map((folder, index) => ({ ...folder, order: index })));
    this._persistFolders();
  }

  assign(projectId: string, folderId: string | null): void {
    this._assignments.update((assignments) => {
      const next = { ...assignments };
      if (folderId) next[projectId] = folderId;
      else delete next[projectId];
      return next;
    });
    this._persistAssignments();
  }

  exportState(): PersonalFolderBackupState {
    return {
      folders: this._folders().map((folder) => ({ ...folder })),
      assignments: { ...this._assignments() },
    };
  }

  restoreState(value: unknown): void {
    if (!value || typeof value !== 'object') return;
    const state = value as Partial<PersonalFolderBackupState>;
    const rawFolders = Array.isArray(state.folders) ? state.folders : [];
    const folders: PersonalFolder[] = [];
    for (const item of rawFolders) {
      if (!item || typeof item !== 'object') continue;
      const candidate = item as Partial<PersonalFolder>;
      if (typeof candidate.id !== 'string' || !candidate.id.trim()) continue;
      if (typeof candidate.name !== 'string' || !candidate.name.trim()) continue;
      folders.push({
        id: candidate.id,
        name: candidate.name.trim(),
        order:
          typeof candidate.order === 'number' && Number.isFinite(candidate.order)
            ? candidate.order
            : folders.length,
      });
    }
    folders.sort((a, b) => a.order - b.order);
    const validIds = new Set(folders.map((folder) => folder.id));
    const rawAssignments =
      state.assignments && typeof state.assignments === 'object' ? state.assignments : {};
    const assignments: Record<string, string> = {};
    for (const [projectId, folderId] of Object.entries(rawAssignments)) {
      if (typeof folderId === 'string' && validIds.has(folderId)) {
        assignments[projectId] = folderId;
      }
    }
    this._folders.set(folders.map((folder, index) => ({ ...folder, order: index })));
    this._assignments.set(assignments);
    this._persistFolders();
    this._persistAssignments();
  }

  private _persistFolders(): void {
    writeJson(FOLDERS_KEY, this._folders());
  }

  private _persistAssignments(): void {
    writeJson(ASSIGNMENTS_KEY, this._assignments());
  }
}
