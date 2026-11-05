import {
  addCalendarDays,
  buildRoutineRange,
  formatRoutineDay,
  isFutureRecordDay,
  isPastRecordDay,
  isRecordDayInRange,
} from './personal-routine.date';

describe('personal routine date ranges', () => {
  it('moves by calendar dates across daylight-saving boundaries', () => {
    expect(addCalendarDays('2026-03-29', 1)).toBe('2026-03-30');
    expect(addCalendarDays('2026-10-25', -1)).toBe('2026-10-24');
    expect(buildRoutineRange('2026-03-30', 'week').start).toBe('2026-03-24');
    expect(buildRoutineRange('2026-10-26', 'week').start).toBe('2026-10-20');
  });
  it('uses inclusive 7-day weeks', () => {
    expect(buildRoutineRange('2026-10-26', 'week')).toEqual({
      start: '2026-10-20',
      end: '2026-10-26',
    });
    expect(
      isRecordDayInRange('2026-10-20', buildRoutineRange('2026-10-26', 'week')),
    ).toBe(true);
    expect(
      isRecordDayInRange('2026-10-19', buildRoutineRange('2026-10-26', 'week')),
    ).toBe(false);
  });

  it('uses calendar months and documents the example boundaries', () => {
    expect(buildRoutineRange('2026-10-26', 'month')).toEqual({
      start: '2026-09-27',
      end: '2026-10-26',
    });
    expect(buildRoutineRange('2026-10-26', 'threeMonths')).toEqual({
      start: '2026-07-27',
      end: '2026-10-26',
    });
  });

  it('clamps month-end and adds one day', () => {
    expect(buildRoutineRange('2026-03-31', 'month').start).toBe('2026-03-01');
    expect(buildRoutineRange('2026-05-31', 'month').start).toBe('2026-05-01');
    expect(buildRoutineRange('2026-03-30', 'month').start).toBe('2026-03-01');
  });

  it('handles leap years and cross-year ranges', () => {
    expect(buildRoutineRange('2024-02-29', 'month').start).toBe('2024-01-30');
    expect(buildRoutineRange('2024-03-31', 'month').start).toBe('2024-03-01');
    expect(buildRoutineRange('2026-01-05', 'threeMonths').start).toBe('2025-10-06');
    expect(addCalendarDays('2025-12-31', 1)).toBe('2026-01-01');
  });

  it('formats dates with a year only across years and localizes English/Chinese', () => {
    expect(formatRoutineDay('2026-10-02', '2026-10-26', 'zh')).toBe('10月2日');
    expect(formatRoutineDay('2025-12-31', '2026-10-26', 'zh')).toBe('2025年12月31日');
    expect(formatRoutineDay('2026-10-02', '2026-10-26', 'en')).toBe('Oct 2');
    expect(formatRoutineDay('2025-12-31', '2026-10-26', 'en')).toBe('Dec 31, 2025');
  });

  it('compares days and identifies past/future without UTC truncation', () => {
    expect(isPastRecordDay('2026-10-25', '2026-10-26')).toBe(true);
    expect(isFutureRecordDay('2026-10-27', '2026-10-26')).toBe(true);
    expect(isPastRecordDay('2026-10-26', '2026-10-26')).toBe(false);
    expect(addCalendarDays('2026-03-08', 1)).toBe('2026-03-09');
    expect(addCalendarDays('2026-03-29', 1)).toBe('2026-03-30');
  });
});
