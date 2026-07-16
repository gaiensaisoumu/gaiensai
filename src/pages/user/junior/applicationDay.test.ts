import { describe, expect, it } from 'vitest';
import {
  getJuniorApplicationDayVisibility,
  isScheduleVisibleForApplicationDay,
  normalizeJuniorApplicationDayValue,
  normalizeJuniorApplicationDaysValue,
  parseJuniorApplicationDaySelection,
  resolveJuniorApplicationDay,
  resolveJuniorApplicationDays,
  serializeJuniorApplicationDaySelection,
} from './applicationDay';

describe('resolveJuniorApplicationDay', () => {
  it('supports day1/day2 query parameters', () => {
    expect(resolveJuniorApplicationDay('day=1')).toBe('day1');
    expect(resolveJuniorApplicationDay('day=2')).toBe('day2');
    expect(resolveJuniorApplicationDay('application_day=day2')).toBe('day2');
    expect(resolveJuniorApplicationDay('application_day=day1')).toBe('day1');
  });

  it('returns null for unsupported values', () => {
    expect(resolveJuniorApplicationDay('application_day=day3')).toBeNull();
    expect(resolveJuniorApplicationDay('')).toBeNull();
  });
});

describe('normalizeJuniorApplicationDayValue', () => {
  it('normalizes values from storage or database sources', () => {
    expect(normalizeJuniorApplicationDayValue('day1')).toBe('day1');
    expect(normalizeJuniorApplicationDayValue('DAY2')).toBe('day2');
    expect(normalizeJuniorApplicationDayValue('1')).toBe('day1');
    expect(normalizeJuniorApplicationDayValue('2')).toBe('day2');
    expect(normalizeJuniorApplicationDayValue('unknown')).toBeNull();
  });
});

describe('normalizeJuniorApplicationDaysValue', () => {
  it('parses multiple day values like 1&2', () => {
    expect(normalizeJuniorApplicationDaysValue('1&2')).toEqual([
      'day1',
      'day2',
    ]);
    expect(normalizeJuniorApplicationDaysValue('day1,day2')).toEqual([
      'day1',
      'day2',
    ]);
  });
});

describe('resolveJuniorApplicationDays', () => {
  it('supports separate class and gym query parameters', () => {
    expect(resolveJuniorApplicationDays('class_day=day1&gym_day=day2')).toEqual(
      { classDay: ['day1'], gymDay: ['day2'] },
    );
    expect(
      resolveJuniorApplicationDays('class_day=1&class_day=2&gym_day=day2'),
    ).toEqual({ classDay: ['day1', 'day2'], gymDay: ['day2'] });
    expect(resolveJuniorApplicationDays('day=2')).toEqual({
      classDay: ['day2'],
      gymDay: ['day2'],
    });
  });
});

describe('getJuniorApplicationDayVisibility', () => {
  it('hides the non-matching performance section when only one side is specified', () => {
    expect(
      getJuniorApplicationDayVisibility({ classDay: ['day1'], gymDay: null }),
    ).toEqual({ showClassPerformances: true, showGymPerformances: false });
    expect(
      getJuniorApplicationDayVisibility({ classDay: null, gymDay: ['day2'] }),
    ).toEqual({ showClassPerformances: false, showGymPerformances: true });
    expect(
      getJuniorApplicationDayVisibility({
        classDay: ['day1'],
        gymDay: ['day2'],
      }),
    ).toEqual({ showClassPerformances: true, showGymPerformances: true });
  });
});

describe('parseJuniorApplicationDaySelection', () => {
  it('parses serialized class/gym selections from storage and database values', () => {
    expect(
      parseJuniorApplicationDaySelection('class_day=day1&day2;gym_day=day2'),
    ).toEqual({
      classDay: ['day1', 'day2'],
      gymDay: ['day2'],
    });
    expect(parseJuniorApplicationDaySelection('day1&day2')).toEqual({
      classDay: ['day1', 'day2'],
      gymDay: ['day1', 'day2'],
    });
  });
});

describe('serializeJuniorApplicationDaySelection', () => {
  it('serializes separate class and gym values for storage and RPC payloads', () => {
    expect(
      serializeJuniorApplicationDaySelection(['day1', 'day2'], ['day2']),
    ).toBe('class_day=day1&day2;gym_day=day2');
    expect(serializeJuniorApplicationDaySelection(['day1'], null)).toBe(
      'class_day=day1',
    );
    expect(serializeJuniorApplicationDaySelection(null, ['day2'])).toBe(
      'gym_day=day2',
    );
  });
});

describe('isScheduleVisibleForApplicationDay', () => {
  it('shows only matching day schedules', () => {
    expect(
      isScheduleVisibleForApplicationDay('1日目第1公演', 1, ['day1']),
    ).toBe(true);
    expect(
      isScheduleVisibleForApplicationDay('2日目第1公演', 5, ['day1']),
    ).toBe(false);
    expect(
      isScheduleVisibleForApplicationDay('2日目第1公演', 5, ['day2']),
    ).toBe(true);
  });
});
