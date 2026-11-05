import { DEFAULT_PROJECT } from '../project/project.const';
import { Project } from '../project/project.model';
import { matchesPersonalPlan } from './personal-overview.view';

describe('Personal plan date filters', () => {
  const project = (day: string | null): Project => ({
    ...DEFAULT_PROJECT,
    id: 'A',
    title: 'A',
    personalProgress: {
      schemaVersion: 1,
      entries: [],
      planning: { day, revision: 1, operationId: 'plan' },
    },
  });
  const today = '2026-11-01';
  it('distinguishes today, future and past dates without completing or rescheduling', () => {
    for (const [day, filter] of [
      ['2026-10-31', 'overdue'],
      [today, 'today'],
      ['2027-01-01', 'future'],
    ] as const) {
      const item = project(day),
        before = structuredClone(item);
      expect(matchesPersonalPlan(item, filter, today)).toBeTrue();
      expect(matchesPersonalPlan(item, 'unplanned', today)).toBeFalse();
      expect(matchesPersonalPlan(item, 'all', today)).toBeTrue();
      expect(item).toEqual(before);
    }
  });
  it('keeps old projects and cleared dates visible under unplanned', () => {
    expect(
      matchesPersonalPlan({ ...DEFAULT_PROJECT, id: 'old' }, 'unplanned', today),
    ).toBeTrue();
    expect(matchesPersonalPlan(project(null), 'unplanned', today)).toBeTrue();
    expect(matchesPersonalPlan(project('invalid'), 'unplanned', today)).toBeTrue();
    expect(matchesPersonalPlan(project(null), 'today', today)).toBeFalse();
    expect(matchesPersonalPlan(project('2027-01-01'), 'overdue', today)).toBeFalse();
  });
});
