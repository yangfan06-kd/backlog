import type { PersonalTextFormat } from '../personal-text/personal-text.model';

/**
 * Personal progress: a minimal, local-first project/step/daily-entry model.
 *
 * Storage decision: the data lives in optional fields on the existing Project
 * and Task entities instead of a new synced slice. That keeps the one-user-
 * intent-one-op contract for each command (a completion is one TASK update,
 * a manual entry is one PROJECT update, an insertion is one PROJECT batch) and
 * automatically puts the records into the existing snapshot, validation,
 * export, import and archive paths. See docs/project1-minimal-offline.md.
 */
export const PERSONAL_PROGRESS_SCHEMA_VERSION = 1 as const;

/** Local calendar day, YYYY-MM-DD. */
export type PersonalRecordDay = string;

export type PersonalEntrySource = 'manual' | 'step-completion';

export type PersonalOwnerKind = 'project' | 'routine';

export type PersonalProjectLifecycleAction = 'finish' | 'restore';

export interface PersonalProjectLifecycleState {
  /** Missing on old data: revision 0. Constant-size latest-command marker. */
  revision: number;
  operationId: string;
  action: PersonalProjectLifecycleAction | null;
}

export interface PersonalProgressEntry {
  id: string;
  projectId: string;
  /** Set for entries created by completing a step. */
  stepId?: string;
  recordDay: PersonalRecordDay;
  /** Snapshot of the text at creation time; never a live task.title reference. */
  body: string;
  /** Optional inline formatting attached to body. Old entries omit it. */
  bodyFormat?: PersonalTextFormat | null;
  source: PersonalEntrySource;
  createdAt: number;
  updatedAt: number;
  /** Starts at 1; every edit increments it. */
  revision: number;
  /** The command that created the entry; used for idempotent retries. */
  operationId: string;
  /** The command that last edited the entry, if any. */
  lastEditOperationId?: string;
}

export interface PersonalCompletionReceipt {
  id: string;
  operationId: string;
  projectId: string;
  stepId: string;
  entryId: string;
  /** Monotonic within the project at completion time. */
  sequence: number;
  entryRevisionAtCompletion: number;
  createdAt: number;
  undoneAt?: number;
  undoOperationId?: string;
}

export interface PersonalProgressOnTask {
  schemaVersion: typeof PERSONAL_PROGRESS_SCHEMA_VERSION;
  entries: PersonalProgressEntry[];
  completions: PersonalCompletionReceipt[];
  /** Absent on older data: revision 0. Constant space, not an edit history. */
  stepEdit?: { revision: number; operationId: string };
  /** Optional inline formatting for the step title. */
  stepFormat?: PersonalTextFormat | null;
}

export type PersonalProjectQuadrant =
  | 'urgent-important'
  | 'important'
  | 'urgent'
  | 'neither';

export interface PersonalProjectQuadrantState {
  /** null is an explicit "unclassified" value; absent is old-data revision 0. */
  value: PersonalProjectQuadrant | null;
  revision: number;
  operationId: string;
}

export interface PersonalProgressOnProject {
  schemaVersion: typeof PERSONAL_PROGRESS_SCHEMA_VERSION;
  entries: PersonalProgressEntry[];
  /** Optional and fixed-size; no per-quadrant project ID lists are stored. */
  quadrant?: PersonalProjectQuadrantState;
  /** Per-project overview ordering; absent on existing data keeps its original order. */
  overviewOrder?: { position: number; revision: number; operationId: string };
  /** Optional persistent row position for the progress/routine boards. */
  boardOrder?: { position: number; revision: number; operationId: string };
  /** Presentation overrides only: not entry membership. At most one rank per entry. */
  entryOrder?: {
    positions: Record<string, number>;
    revision: number;
    operationId: string;
  };
  /** Latest conversion marker; old clients ignore it and understand kind as before. */
  kindEdit?: { revision: number; operationId: string };
  /** Absent on old data means 'project'. Unknown future values are not rewritten. */
  kind?: PersonalOwnerKind;
  /** New routine items only; old data is not backfilled. */
  createdAt?: number;
  /** Latest finish/restore command; root isArchived/isDone/doneOn stay authoritative. */
  lifecycle?: PersonalProjectLifecycleState;
  /** Optional plan, distinct from an actual-work record or a deadline. */
  planning?: { day: PersonalRecordDay | null; revision: number; operationId: string };
  /** Latest title edit only. Task IDs, records and their text remain unchanged. */
  nameEdit?: { revision: number; operationId: string };
  /** Reversible deletion; tasks, entries and completion state remain intact. */
  trash?: {
    deletedAt: number | null;
    wasArchived: boolean;
    revision: number;
    operationId: string;
  };
}

export const emptyTaskPersonalProgress = (): PersonalProgressOnTask => ({
  schemaVersion: PERSONAL_PROGRESS_SCHEMA_VERSION,
  entries: [],
  completions: [],
});

export const emptyProjectPersonalProgress = (): PersonalProgressOnProject => ({
  schemaVersion: PERSONAL_PROGRESS_SCHEMA_VERSION,
  entries: [],
});

export const PERSONAL_PROJECT_QUADRANTS: readonly PersonalProjectQuadrant[] = [
  'urgent-important',
  'important',
  'urgent',
  'neither',
];

export const PERSONAL_OWNER_KINDS: readonly PersonalOwnerKind[] = ['project', 'routine'];

export const isPersonalOwnerKind = (value: unknown): value is PersonalOwnerKind =>
  typeof value === 'string' &&
  (PERSONAL_OWNER_KINDS as readonly string[]).includes(value);

/**
 * Missing kind is the backward-compatible project kind. An unknown future kind
 * returns null so a new client never silently treats it as a project/routine.
 */
export const personalProjectKind = (
  project: { personalProgress?: PersonalProgressOnProject } | null | undefined,
): PersonalOwnerKind | null => {
  const kind = project?.personalProgress?.kind;
  if (kind === undefined) return 'project';
  return isPersonalOwnerKind(kind) ? kind : null;
};

export const personalProjectLifecycle = (
  project: { personalProgress?: PersonalProgressOnProject } | null | undefined,
): PersonalProjectLifecycleState =>
  project?.personalProgress?.lifecycle ?? {
    revision: 0,
    operationId: '',
    action: null,
  };

export const isPersonalProjectLifecycleAction = (
  value: unknown,
): value is PersonalProjectLifecycleAction => value === 'finish' || value === 'restore';

export const isPersonalProjectQuadrant = (
  value: unknown,
): value is PersonalProjectQuadrant =>
  typeof value === 'string' &&
  (PERSONAL_PROJECT_QUADRANTS as readonly string[]).includes(value);

export const personalProjectQuadrant = (
  project: { personalProgress?: PersonalProgressOnProject } | null | undefined,
): PersonalProjectQuadrantState =>
  project?.personalProgress?.quadrant ?? {
    value: null,
    revision: 0,
    operationId: '',
  };

export type PersonalCommandCode =
  | 'OWNER_MISMATCH'
  | 'HISTORY_LOCKED'
  | 'STALE_REVISION'
  | 'STALE_STEP'
  | 'NOT_LATEST'
  | 'EDITED_ENTRY'
  | 'INVALID_INPUT'
  | 'NOT_FOUND'
  | 'PROJECT_UNAVAILABLE'
  | 'TYPE_CONFLICT'
  | 'NOT_ARCHIVED'
  | 'ALREADY_DONE';

export type PersonalCommandResult<T> =
  | { status: 'persisted'; operationId: string; value: T }
  | { status: 'rejected'; operationId: string; code: PersonalCommandCode }
  | { status: 'failed'; operationId: string; retryable: boolean; message: string };

const RECORD_DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

export const isPersonalRecordDay = (value: unknown): value is PersonalRecordDay => {
  if (typeof value !== 'string' || !RECORD_DAY_RE.test(value)) return false;
  const [y, m, d] = value.split('-').map(Number);
  const date = new Date(y, m - 1, d);
  return date.getFullYear() === y && date.getMonth() === m - 1 && date.getDate() === d;
};

export const personalTaskData = (
  task: { personalProgress?: PersonalProgressOnTask } | null | undefined,
): PersonalProgressOnTask => task?.personalProgress ?? emptyTaskPersonalProgress();

export const personalProjectData = (
  project: { personalProgress?: PersonalProgressOnProject } | null | undefined,
): PersonalProgressOnProject =>
  project?.personalProgress ?? emptyProjectPersonalProgress();

const ROMAN = ['', 'Ⅰ', 'Ⅱ', 'Ⅲ', 'Ⅳ', 'Ⅴ', 'Ⅵ', 'Ⅶ', 'Ⅷ', 'Ⅸ', 'Ⅹ', 'Ⅺ', 'Ⅻ'];

/** Display-only numbering: derived from the current position, never stored. */
export const personalRoman = (index: number): string => {
  if (!Number.isSafeInteger(index) || index < 0) return '';
  let value = index + 1;
  if (value < ROMAN.length) return ROMAN[value];
  let numeral = '';
  const units: readonly (readonly [number, string])[] = [
    [1000, 'Ⅿ'],
    [900, 'ⅭⅯ'],
    [500, 'Ⅾ'],
    [400, 'ⅭⅮ'],
    [100, 'Ⅽ'],
    [90, 'ⅩⅭ'],
    [50, 'Ⅼ'],
    [40, 'ⅩⅬ'],
    [10, 'Ⅹ'],
  ];
  for (const [amount, symbol] of units) {
    while (value >= amount) {
      numeral += symbol;
      value -= amount;
    }
  }
  return numeral + ROMAN[value];
};

export const normalizeBody = (body: string): string => body.trim();

export const entryBelongsToProject = (
  entry: PersonalProgressEntry,
  projectId: string,
): boolean => entry.projectId === projectId;

/** Same-day presentation order; absent overrides retain the historic stable order. */
export const comparePersonalEntries = (
  project: { personalProgress?: PersonalProgressOnProject },
  a: PersonalProgressEntry,
  b: PersonalProgressEntry,
): number => {
  const ranks = project.personalProgress?.entryOrder?.positions;
  const aRank = ranks?.[a.id],
    bRank = ranks?.[b.id];
  const rankedA = Number.isFinite(aRank),
    rankedB = Number.isFinite(bRank);
  if (rankedA && rankedB) return aRank! - bRank! || a.id.localeCompare(b.id);
  if (rankedA !== rankedB) return rankedA ? -1 : 1;
  return a.createdAt - b.createdAt || a.id.localeCompare(b.id);
};
