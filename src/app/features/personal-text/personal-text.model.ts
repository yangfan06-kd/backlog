export type PersonalTextColor = 'red' | 'blue' | 'green' | 'purple';

export interface PersonalTextRun {
  text: string;
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  color?: PersonalTextColor;
}

export interface PersonalTextFormat {
  version: 1;
  runs: PersonalTextRun[];
}

export interface PersonalTextDraft {
  text: string;
  format: PersonalTextFormat | null;
}

export const PERSONAL_TEXT_COLORS: readonly PersonalTextColor[] = [
  'red',
  'blue',
  'green',
  'purple',
];

export const isPersonalTextColor = (value: unknown): value is PersonalTextColor =>
  typeof value === 'string' &&
  (PERSONAL_TEXT_COLORS as readonly string[]).includes(value);

const hasStyle = (run: PersonalTextRun): boolean =>
  !!run.bold || !!run.italic || !!run.underline || !!run.color;

const cleanRun = (run: PersonalTextRun): PersonalTextRun => {
  const result: PersonalTextRun = { text: run.text };
  if (run.bold) result.bold = true;
  if (run.italic) result.italic = true;
  if (run.underline) result.underline = true;
  if (run.color && isPersonalTextColor(run.color)) result.color = run.color;
  return result;
};

export const runsToText = (runs: readonly PersonalTextRun[]): string =>
  runs.map((run) => run.text).join('');

/** Adjacent identical runs are merged; empty/unstyled text is dropped. */
export const normalizeRuns = (runs: readonly PersonalTextRun[]): PersonalTextRun[] => {
  const result: PersonalTextRun[] = [];
  for (const raw of runs) {
    if (!raw || typeof raw.text !== 'string' || raw.text.length === 0) continue;
    const run = cleanRun(raw);
    const previous = result[result.length - 1];
    if (
      previous &&
      previous.bold === run.bold &&
      previous.italic === run.italic &&
      previous.underline === run.underline &&
      previous.color === run.color
    ) {
      previous.text += run.text;
    } else {
      result.push(run);
    }
  }
  return result;
};

export const formatFromRuns = (
  runs: readonly PersonalTextRun[],
): PersonalTextFormat | null => {
  const normalized = normalizeRuns(runs);
  return normalized.some(hasStyle) ? { version: 1, runs: normalized } : null;
};

/** True only for the exact frozen contract shape/version/colors. */
export const isPersonalTextFormat = (value: unknown): value is PersonalTextFormat => {
  if (!value || typeof value !== 'object') return false;
  const format = value as Partial<PersonalTextFormat>;
  if (format.version !== 1 || !Array.isArray(format.runs)) return false;
  return format.runs.every((run) => {
    if (!run || typeof run !== 'object') return false;
    const candidate = run as Partial<PersonalTextRun>;
    return (
      typeof candidate.text === 'string' &&
      (candidate.bold === undefined || typeof candidate.bold === 'boolean') &&
      (candidate.italic === undefined || typeof candidate.italic === 'boolean') &&
      (candidate.underline === undefined || typeof candidate.underline === 'boolean') &&
      (candidate.color === undefined || isPersonalTextColor(candidate.color))
    );
  });
};

/** Format is usable only when its runs exactly reconstruct the current text. */
export const formatForText = (
  text: string,
  format: unknown,
): PersonalTextFormat | null => {
  if (!isPersonalTextFormat(format)) return null;
  const runs = normalizeRuns(format.runs);
  if (runsToText(runs) !== text) return null;
  return formatFromRuns(runs);
};

export const textDraft = (text: string, format: unknown): PersonalTextDraft => {
  const normalizedText = text.trim();
  const exact = formatForText(text, format);
  if (exact) {
    const lead = text.length - text.trimStart().length;
    const trail = text.length - text.trimEnd().length;
    return { text: normalizedText, format: trimFormat(exact, lead, text.length - trail) };
  }
  const trimmedFormat = formatForText(normalizedText, format);
  return { text: normalizedText, format: trimmedFormat };
};

export const trimFormat = (
  format: PersonalTextFormat | null,
  from: number,
  to: number,
): PersonalTextFormat | null => {
  if (!format) return null;
  const text = runsToText(format.runs);
  const start = Math.max(0, Math.min(from, text.length));
  const end = Math.max(start, Math.min(to, text.length));
  const result: PersonalTextRun[] = [];
  let cursor = 0;
  for (const run of format.runs) {
    const runStart = cursor;
    const runEnd = cursor + run.text.length;
    cursor = runEnd;
    const overlapStart = Math.max(runStart, start);
    const overlapEnd = Math.min(runEnd, end);
    if (overlapStart < overlapEnd) {
      result.push({
        ...cleanRun(run),
        text: run.text.slice(overlapStart - runStart, overlapEnd - runStart),
      });
    }
  }
  return formatFromRuns(result);
};

export const formatEquals = (a: unknown, b: unknown): boolean =>
  JSON.stringify(formatForTextStrict(a)) === JSON.stringify(formatForTextStrict(b));

const formatForTextStrict = (value: unknown): PersonalTextFormat | null => {
  if (!isPersonalTextFormat(value)) return null;
  const runs = normalizeRuns(value.runs);
  return formatFromRuns(runs);
};

export const runsForDisplay = (text: string, format: unknown): PersonalTextRun[] =>
  formatForText(text, format)?.runs ?? [{ text }];

export const styleAt = (
  format: PersonalTextFormat | null,
  text: string,
  position: number,
): Omit<PersonalTextRun, 'text'> => {
  if (!format) return {};
  let cursor = 0;
  for (const run of format.runs) {
    const end = cursor + run.text.length;
    if (position < end || (position === end && end === text.length)) {
      return {
        ...(run.bold ? { bold: true } : {}),
        ...(run.italic ? { italic: true } : {}),
        ...(run.underline ? { underline: true } : {}),
        ...(run.color ? { color: run.color } : {}),
      };
    }
    cursor = end;
  }
  return {};
};

export type PersonalTextStyleKey = 'bold' | 'italic' | 'underline';

export const toggleFormatInRange = (
  format: PersonalTextFormat | null,
  text: string,
  from: number,
  to: number,
  key: PersonalTextStyleKey,
): PersonalTextFormat | null => {
  const target = formatForText(text, format);
  const start = Math.max(0, Math.min(from, to));
  const end = Math.min(text.length, Math.max(from, to));
  let allStyled = true;
  for (let position = start; position < end; position++) {
    if (!styleAt(target, text, position)[key]) {
      allStyled = false;
      break;
    }
  }
  const nextValue = !allStyled;
  const source = target?.runs ?? [{ text }];
  const result: PersonalTextRun[] = [];
  let cursor = 0;
  for (const run of source) {
    const runStart = cursor;
    const runEnd = cursor + run.text.length;
    cursor = runEnd;
    const before = Math.max(runStart, start);
    const after = Math.min(runEnd, end);
    if (before >= after) {
      result.push(run);
      continue;
    }
    if (before > runStart)
      result.push({ ...run, text: run.text.slice(0, before - runStart) });
    const selected = run.text.slice(before - runStart, after - runStart);
    const style = { ...styleAt(target, text, before) };
    if (nextValue) style[key] = true;
    else delete style[key];
    result.push({ text: selected, ...style });
    if (after < runEnd) result.push({ ...run, text: run.text.slice(after - runStart) });
  }
  return formatFromRuns(result);
};

export const setColorInRange = (
  format: PersonalTextFormat | null,
  text: string,
  from: number,
  to: number,
  color: PersonalTextColor | null,
): PersonalTextFormat | null => {
  const target = formatForText(text, format);
  const start = Math.max(0, Math.min(from, to));
  const end = Math.min(text.length, Math.max(from, to));
  const source = target?.runs ?? [{ text }];
  const result: PersonalTextRun[] = [];
  let cursor = 0;
  for (const run of source) {
    const runStart = cursor;
    const runEnd = cursor + run.text.length;
    cursor = runEnd;
    const before = Math.max(runStart, start);
    const after = Math.min(runEnd, end);
    if (before >= after) {
      result.push(run);
      continue;
    }
    if (before > runStart)
      result.push({ ...run, text: run.text.slice(0, before - runStart) });
    const selected = run.text.slice(before - runStart, after - runStart);
    const style = styleAt(target, text, before);
    result.push({
      text: selected,
      ...style,
      ...(color ? { color } : { color: undefined }),
    });
    if (after < runEnd) result.push({ ...run, text: run.text.slice(after - runStart) });
  }
  return formatFromRuns(result);
};

export const clearFormatInRange = (
  format: PersonalTextFormat | null,
  text: string,
  from: number,
  to: number,
): PersonalTextFormat | null => {
  const target = formatForText(text, format);
  if (!target) return null;
  const start = Math.max(0, Math.min(from, to));
  const end = Math.min(text.length, Math.max(from, to));
  const result: PersonalTextRun[] = [];
  let cursor = 0;
  for (const run of target.runs) {
    const runStart = cursor;
    const runEnd = cursor + run.text.length;
    cursor = runEnd;
    const before = Math.max(runStart, start);
    const after = Math.min(runEnd, end);
    if (before >= after) {
      result.push(run);
      continue;
    }
    if (before > runStart)
      result.push({ ...run, text: run.text.slice(0, before - runStart) });
    result.push({ text: run.text.slice(before - runStart, after - runStart) });
    if (after < runEnd) result.push({ ...run, text: run.text.slice(after - runStart) });
  }
  return formatFromRuns(result);
};

/** Map runs through a plain-text edit, keeping style around inserted text. */
export const mapRunsForEdit = (
  oldText: string,
  oldFormat: PersonalTextFormat | null,
  newText: string,
  insertedStyle: Omit<PersonalTextRun, 'text'>,
): PersonalTextFormat | null => {
  if (oldText === newText) return oldFormat;
  let prefix = 0;
  while (
    prefix < oldText.length &&
    prefix < newText.length &&
    oldText[prefix] === newText[prefix]
  )
    prefix++;
  let suffix = 0;
  while (
    suffix < oldText.length - prefix &&
    suffix < newText.length - prefix &&
    oldText[oldText.length - 1 - suffix] === newText[newText.length - 1 - suffix]
  )
    suffix++;
  const oldMiddleEnd = oldText.length - suffix;
  const newMiddleEnd = newText.length - suffix;
  const source = formatForText(oldText, oldFormat)?.runs ?? [{ text: oldText }];
  const result: PersonalTextRun[] = [];
  let cursor = 0;
  for (const run of source) {
    const runStart = cursor;
    const runEnd = cursor + run.text.length;
    cursor = runEnd;
    const leftEnd = Math.min(runEnd, prefix);
    if (leftEnd > runStart) {
      result.push({ ...run, text: run.text.slice(0, leftEnd - runStart) });
    }
  }
  const inserted = newText.slice(prefix, newMiddleEnd);
  if (inserted) result.push({ text: inserted, ...insertedStyle });
  cursor = 0;
  for (const run of source) {
    const runStart = cursor;
    const runEnd = cursor + run.text.length;
    cursor = runEnd;
    const rightStart = Math.max(runStart, oldMiddleEnd);
    if (runEnd > rightStart) {
      result.push({ ...run, text: run.text.slice(rightStart - runStart) });
    }
  }
  return formatFromRuns(result);
};

// Structural validity is independent of whether old runs still match the body.
// Stale but valid metadata must survive backups; display falls back to plain text.
const hasValidFormat = (format: unknown): boolean =>
  format === undefined || format === null ? true : isPersonalTextFormat(format);

const asRecord = (value: unknown): Record<string, unknown> | null =>
  value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;

const validateTaskFormats = (value: unknown): boolean => {
  const task = asRecord(value);
  if (!task) return true;
  const data = task.personalProgress;
  if (data === undefined || data === null) return true;
  const personal = asRecord(data);
  if (!personal) return false;
  if (!hasValidFormat(personal.stepFormat)) return false;
  return Array.isArray(personal.entries)
    ? personal.entries.every((entry: unknown) =>
        hasValidFormat(asRecord(entry)?.bodyFormat),
      )
    : true;
};

/**
 * Reject unsupported/malformed personal text formats before a restore or a
 * backup write. Non-personal data is left to the existing full validators.
 */
export const hasSupportedPersonalTextFormats = (data: unknown): boolean => {
  if (!data || typeof data !== 'object') return false;
  const root = asRecord(data);
  if (!root) return false;
  const entities = (state: unknown): unknown[] =>
    Object.values(asRecord(asRecord(state)?.entities) ?? {});
  if (!entities(root.project).every(validateTaskFormats)) return false;
  if (
    !entities(root.note).every((value) => {
      const memo = asRecord(asRecord(value)?.personalMemo);
      return !memo || hasValidFormat(memo.format);
    })
  )
    return false;
  const tasks = entities(root.task);
  if (!tasks.every(validateTaskFormats)) return false;
  for (const archiveKey of ['archiveYoung', 'archiveOld']) {
    const archived = entities(asRecord(root[archiveKey])?.task);
    if (!archived.every(validateTaskFormats)) return false;
  }
  return true;
};

export const assertSupportedPersonalTextFormats = (data: unknown): void => {
  if (!hasSupportedPersonalTextFormats(data)) {
    throw new Error('INVALID_PERSONAL_TEXT_FORMAT');
  }
};
