import {
  clearFormatInRange,
  formatEquals,
  formatForText,
  formatFromRuns,
  mapRunsForEdit,
  normalizeRuns,
  runsToText,
  setColorInRange,
  textDraft,
  toggleFormatInRange,
  hasSupportedPersonalTextFormats,
  runsForDisplay,
} from './personal-text.model';

describe('personal text model', () => {
  it('preserves structurally valid stale and unstyled formats through backup validation', () => {
    const stale = { version: 1, runs: [{ text: 'old', bold: true }] };
    const state = {
      task: {
        entities: {
          one: {
            title: 'new',
            personalProgress: {
              stepFormat: stale,
              entries: [{ body: 'new entry', bodyFormat: stale }],
            },
          },
        },
      },
    };
    expect(hasSupportedPersonalTextFormats(state)).toBe(true);
    expect(runsForDisplay('new', stale)).toEqual([{ text: 'new' }]);
    expect(
      hasSupportedPersonalTextFormats({
        task: {
          entities: {
            one: {
              title: 'plain',
              personalProgress: { stepFormat: { version: 1, runs: [{ text: 'plain' }] } },
            },
          },
        },
      }),
    ).toBe(true);
    expect(
      hasSupportedPersonalTextFormats({
        task: {
          entities: {
            one: { personalProgress: { stepFormat: { version: 2, runs: [] } } },
          },
        },
      }),
    ).toBe(false);
    expect(
      hasSupportedPersonalTextFormats({
        archiveOld: {
          task: {
            entities: {
              one: {
                personalProgress: {
                  stepFormat: { version: 1, runs: [{ text: 'bad', color: 'pink' }] },
                },
              },
            },
          },
        },
      }),
    ).toBe(false);
  });
  it('normalizes adjacent equal runs and keeps plain text as null', () => {
    const runs = normalizeRuns([
      { text: 'a', bold: true },
      { text: 'b', bold: true },
      { text: '', italic: true },
      { text: 'c' },
    ]);
    expect(runs).toEqual([{ text: 'ab', bold: true }, { text: 'c' }]);
    expect(runsToText(runs)).toBe('abc');
    expect(formatFromRuns([{ text: 'abc' }])).toBeNull();
  });

  it('rejects stale or malformed formats without changing text', () => {
    const format = formatFromRuns([{ text: 'old', bold: true }]);
    expect(formatForText('new', format)).toBeNull();
    expect(formatForText('old', { version: 2, runs: [] })).toBeNull();
    expect(
      formatForText('old', { version: 1, runs: [{ text: 'old', color: 'pink' }] }),
    ).toBeNull();
  });

  it('toggles bold and color only in the selected range', () => {
    const text = 'abcd';
    const bold = toggleFormatInRange(null, text, 1, 3, 'bold');
    expect(runsToText(bold!.runs)).toBe(text);
    expect(bold!.runs).toEqual([
      { text: 'a' },
      { text: 'bc', bold: true },
      { text: 'd' },
    ]);
    const colored = setColorInRange(bold, text, 1, 3, 'blue');
    expect(colored!.runs).toEqual([
      { text: 'a' },
      { text: 'bc', bold: true, color: 'blue' },
      { text: 'd' },
    ]);
  });

  it('clears only the selected formatting', () => {
    const format = formatFromRuns([
      { text: 'a', bold: true },
      { text: 'bc', bold: true, italic: true },
      { text: 'd' },
    ]);
    const cleared = clearFormatInRange(format, 'abcd', 1, 3);
    expect(cleared?.runs).toEqual([{ text: 'a', bold: true }, { text: 'bcd' }]);
  });

  it('maps edits to the correct run order and strips surrounding whitespace', () => {
    const format = formatFromRuns([{ text: 'ab', bold: true }, { text: 'cd' }]);
    const mapped = mapRunsForEdit('abcd', format, 'abXcd', {});
    expect(mapped?.runs).toEqual([{ text: 'ab', bold: true }, { text: 'Xcd' }]);
    expect(textDraft('  abcd  ', format)).toEqual({
      text: 'abcd',
      format,
    });
    expect(formatEquals(format, formatForText('abcd', format))).toBe(true);
  });
});
