import { EntityState } from '@ngrx/entity';
import type { PersonalTextFormat } from '../personal-text/personal-text.model';

export interface Note {
  id: string;
  projectId: string | null;
  isPinnedToToday: boolean;
  content: string;
  imgUrl?: string;
  isLock?: boolean;
  backgroundColor?: string;
  created: number;
  modified: number;
  /** Optional personal-workspace memo metadata; older notes have none. */
  personalMemo?: {
    order?: { position: number; revision: number; operationId: string };
    format: PersonalTextFormat | null;
    remindAt: number | null;
    /** Minutes before the selected time; missing on old memos means at the time. */
    advanceMinutes?: number;
    deletedAt: number | null;
    revision: number;
    operationId: string;
  };
}

export interface NoteState extends EntityState<Note> {
  ids: string[];
  todayOrder: string[];
}
