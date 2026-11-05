import {
  isPersonalRecordDay,
  PersonalRecordDay,
} from '../personal-progress/personal-progress.model';

export type PersonalRoutineRange = 'week' | 'month' | 'threeMonths';

export interface PersonalRoutineRangeBounds {
  start: PersonalRecordDay;
  end: PersonalRecordDay;
}

const pad2 = (value: number): string => String(value).padStart(2, '0');

const formatLocalDay = (date: Date): PersonalRecordDay =>
  `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;

const parseLocalDay = (day: PersonalRecordDay): Date => {
  const [year, month, date] = day.split('-').map(Number);
  return new Date(year, month - 1, date);
};

const daysInMonth = (year: number, monthIndex: number): number =>
  new Date(year, monthIndex + 1, 0).getDate();

/** Calendar-day arithmetic in local time, never fixed milliseconds / UTC. */
export const addCalendarDays = (
  day: PersonalRecordDay,
  days: number,
): PersonalRecordDay => {
  const date = parseLocalDay(day);
  date.setDate(date.getDate() + days);
  return formatLocalDay(date);
};

export const compareRecordDays = (a: PersonalRecordDay, b: PersonalRecordDay): number =>
  a < b ? -1 : a > b ? 1 : 0;

export const isRecordDayInRange = (
  day: PersonalRecordDay,
  bounds: PersonalRoutineRangeBounds,
): boolean => day >= bounds.start && day <= bounds.end;

export const isPastRecordDay = (
  day: PersonalRecordDay,
  today: PersonalRecordDay,
): boolean => day < today;

export const isFutureRecordDay = (
  day: PersonalRecordDay,
  today: PersonalRecordDay,
): boolean => day > today;

/**
 * One week includes today plus the previous six calendar days. One/three months
 * subtract calendar months, clamp the day to that target month's last day, then
 * add one day; both ends are inclusive. This is the boundary documented in
 * NEXT_STAGE_ROUTINE.md (not a fixed 30/90-day offset).
 */
export const buildRoutineRange = (
  today: PersonalRecordDay,
  range: PersonalRoutineRange,
): PersonalRoutineRangeBounds => {
  if (!isPersonalRecordDay(today)) {
    throw new Error(`Invalid logical today: ${today}`);
  }
  if (range === 'week') {
    return { start: addCalendarDays(today, -6), end: today };
  }
  const [year, monthIndex, date] = today.split('-').map(Number);
  const months = range === 'month' ? 1 : 3;
  const target = new Date(year, monthIndex - 1 - months, 1);
  const targetYear = target.getFullYear();
  const targetMonthIndex = target.getMonth();
  const clampedDay = Math.min(date, daysInMonth(targetYear, targetMonthIndex));
  return {
    start: formatLocalDay(new Date(targetYear, targetMonthIndex, clampedDay + 1)),
    end: today,
  };
};

/** Display only; page passes the current UI language. */
export const formatRoutineDay = (
  day: PersonalRecordDay,
  today: PersonalRecordDay,
  language: string,
): string => {
  const date = parseLocalDay(day);
  const showYear = day.slice(0, 4) !== today.slice(0, 4);
  const isEnglish = language.toLowerCase().startsWith('en');
  const month = date.getMonth() + 1;
  const dayNumber = date.getDate();
  if (isEnglish) {
    const monthNames = [
      'Jan',
      'Feb',
      'Mar',
      'Apr',
      'May',
      'Jun',
      'Jul',
      'Aug',
      'Sep',
      'Oct',
      'Nov',
      'Dec',
    ];
    return `${monthNames[date.getMonth()]} ${dayNumber}${showYear ? `, ${date.getFullYear()}` : ''}`;
  }
  return `${showYear ? `${date.getFullYear()}年` : ''}${month}月${dayNumber}日`;
};
