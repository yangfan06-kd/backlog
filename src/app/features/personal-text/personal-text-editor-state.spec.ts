import { EditorState } from '@codemirror/state';
import { history, redo, undo } from '@codemirror/commands';
import {
  personalTextEditing,
  PersonalTypingStyle,
  runsField,
  setRunsEffect,
} from './personal-text-editor-state';
import { PersonalTextRun } from './personal-text.model';

describe('personal text editing transactions', () => {
  let state: EditorState;
  let pending: PersonalTypingStyle | null;
  const init = (text: string, runs: PersonalTextRun[]): void => {
    pending = null;
    state = EditorState.create({
      doc: text,
      extensions: [
        history(),
        runsField.init(() => ({ text, runs })),
        personalTextEditing(() => pending),
      ],
    });
  };
  const dispatch = (transaction: ReturnType<EditorState['update']>): void => {
    state = transaction.state;
  };
  const runs = (): PersonalTextRun[] => state.field(runsField).runs;

  it('locates insertion among repeated characters from the actual change positions', () => {
    init('aa', [{ text: 'a', bold: true }, { text: 'a' }]);
    pending = { color: 'blue' };
    dispatch(state.update({ changes: { from: 0, insert: 'a' } }));
    expect(runs()).toEqual([
      { text: 'a', color: 'blue' },
      { text: 'a', bold: true },
      { text: 'a' },
    ]);
  });

  it('inherits the formatted word and treats Clear as an explicit plain typing style', () => {
    init('abcd', [{ text: 'abcd', bold: true }]);
    dispatch(state.update({ changes: { from: 1, insert: 'x' } }));
    expect(runs()).toEqual([{ text: 'axbcd', bold: true }]);
    pending = {};
    dispatch(state.update({ changes: { from: 2, insert: 'y' } }));
    expect(runs()).toEqual([
      { text: 'ax', bold: true },
      { text: 'y' },
      { text: 'bcd', bold: true },
    ]);
  });

  it('undoes and redoes typed text with its complete formatting snapshot', () => {
    init('', []);
    pending = { bold: true, color: 'blue' };
    dispatch(state.update({ changes: { from: 0, insert: '中文' } }));
    expect(runs()).toEqual([{ text: '中文', bold: true, color: 'blue' }]);
    expect(undo({ state, dispatch })).toBe(true);
    expect(state.doc.toString()).toBe('');
    expect(redo({ state, dispatch })).toBe(true);
    expect(state.doc.toString()).toBe('中文');
    expect(runs()).toEqual([{ text: '中文', bold: true, color: 'blue' }]);
  });

  it('undoes a style change while retaining the original text', () => {
    init('abcd', [{ text: 'abcd' }]);
    dispatch(state.update({ effects: setRunsEffect.of([{ text: 'abcd', bold: true }]) }));
    expect(undo({ state, dispatch })).toBe(true);
    expect(state.doc.toString()).toBe('abcd');
    expect(runs()).toEqual([{ text: 'abcd' }]);
    expect(redo({ state, dispatch })).toBe(true);
    expect(runs()).toEqual([{ text: 'abcd', bold: true }]);
  });

  it('maps multiple edits without changing untouched formatting', () => {
    init('abcd', [{ text: 'ab', bold: true }, { text: 'cd' }]);
    dispatch(
      state.update({
        changes: [
          { from: 1, to: 2 },
          { from: 3, insert: 'X' },
        ],
      }),
    );
    expect(state.doc.toString()).toBe('acXd');
    expect(runs()).toEqual([{ text: 'a', bold: true }, { text: 'cXd' }]);
  });
});
