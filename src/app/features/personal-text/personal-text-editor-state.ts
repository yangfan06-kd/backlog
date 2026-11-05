import { EditorState, Extension, StateEffect, StateField } from '@codemirror/state';
import { invertedEffects } from '@codemirror/commands';
import {
  PersonalTextRun,
  formatForText,
  formatFromRuns,
  styleAt,
  trimFormat,
} from './personal-text.model';

export type PersonalTypingStyle = Omit<PersonalTextRun, 'text'>;
export const setRunsEffect = StateEffect.define<PersonalTextRun[]>();
export const runsField = StateField.define<{ text: string; runs: PersonalTextRun[] }>({
  create: (state) => ({
    text: state.doc.toString(),
    runs: [{ text: state.doc.toString() }],
  }),
  update: (value, transaction) => {
    let runs = value.runs;
    for (const effect of transaction.effects) {
      if (effect.is(setRunsEffect)) runs = effect.value;
    }
    return { text: transaction.newDoc.toString(), runs };
  },
});

/** Text and style enter the same transaction and the same native history event.
 * Use actual change positions: a prefix/suffix diff cannot locate repeated text.
 * null inherits surrounding style; {} explicitly types plain text after Clear.
 */
export const personalTextEditing = (
  pendingStyle: () => PersonalTypingStyle | null,
): Extension => [
  invertedEffects.of((transaction) =>
    transaction.effects.some((effect) => effect.is(setRunsEffect))
      ? [setRunsEffect.of(transaction.startState.field(runsField).runs)]
      : [],
  ),
  EditorState.transactionExtender.of((transaction) => {
    if (!transaction.docChanged || transaction.effects.some((e) => e.is(setRunsEffect))) {
      return null;
    }
    const old = transaction.startState.field(runsField);
    const format = formatForText(old.text, formatFromRuns(old.runs));
    const runs: PersonalTextRun[] = [];
    const append = (from: number, to: number): void => {
      if (from < to)
        runs.push(
          ...(trimFormat(format, from, to)?.runs ?? [{ text: old.text.slice(from, to) }]),
        );
    };
    let cursor = 0;
    transaction.changes.iterChanges((from, to, _fromNew, _toNew, inserted) => {
      append(cursor, from);
      if (inserted.length) {
        const position = from === to && from > 0 ? from - 1 : from;
        runs.push({
          text: inserted.toString(),
          ...(pendingStyle() ?? styleAt(format, old.text, position)),
        });
      }
      cursor = to;
    });
    append(cursor, old.text.length);
    return {
      effects: setRunsEffect.of(
        formatFromRuns(runs)?.runs ?? [{ text: transaction.newDoc.toString() }],
      ),
    };
  }),
];
