export type JuniorApplicationDay = 'day1' | 'day2';
export type JuniorApplicationDays = JuniorApplicationDay[];

const DAY1_PATTERN = /^(day1|1)$/i;
const DAY2_PATTERN = /^(day2|2)$/i;

const parseSearch = (search: string) => new URLSearchParams(search);

const parseQueryValuesFromSearchString = (
  search: string,
  key: string,
): Array<string | null> => {
  const query = search.startsWith('?') ? search.slice(1) : search;
  const knownKeys = ['class_day', 'gym_day', 'day', 'application_day'];
  const segments = query.split('&').filter(Boolean);
  const parsedValues: Array<string | null> = [];
  let currentKey: string | null = null;

  for (const segment of segments) {
    const [name, ...rest] = segment.split('=');
    const rawValue = rest.join('=');

    if (name === key) {
      currentKey = key;
      parsedValues.push(rawValue ?? null);
      continue;
    }

    if (knownKeys.includes(name)) {
      currentKey = name;
      continue;
    }

    if (currentKey === key) {
      const lastIndex = parsedValues.length - 1;
      parsedValues[lastIndex] = parsedValues[lastIndex]
        ? `${parsedValues[lastIndex]}&${rawValue}`
        : rawValue;
    }
  }

  return parsedValues.filter((value) => value !== null);
};

export const normalizeJuniorApplicationDayValue = (
  value: string | null | undefined,
): JuniorApplicationDay | null => {
  if (!value) {
    return null;
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }

  if (DAY1_PATTERN.test(trimmed)) {
    return 'day1';
  }

  if (DAY2_PATTERN.test(trimmed)) {
    return 'day2';
  }

  return null;
};

export const normalizeJuniorApplicationDaysValue = (
  value: string | null | undefined,
): JuniorApplicationDays | null => {
  if (!value) {
    return null;
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }

  const parts = trimmed
    .split(/[,&]/)
    .map((part) => part.trim())
    .filter(Boolean);

  if (parts.length === 0) {
    return null;
  }

  const normalized = parts
    .map((part) => normalizeJuniorApplicationDayValue(part))
    .filter((part): part is JuniorApplicationDay => part !== null);

  if (normalized.length === 0) {
    return null;
  }

  return Array.from(new Set(normalized));
};

export const resolveJuniorApplicationDay = (
  search: string,
): JuniorApplicationDay | null => {
  const params = parseSearch(search);
  const directDay = params.get('day');
  const applicationDay = directDay ?? params.get('application_day');

  return normalizeJuniorApplicationDayValue(applicationDay);
};

export const parseJuniorApplicationDaySelection = (
  value: string | null | undefined,
): {
  classDay: JuniorApplicationDays | null;
  gymDay: JuniorApplicationDays | null;
} => {
  if (!value) {
    return { classDay: null, gymDay: null };
  }

  const trimmedValue = value.trim();
  if (!trimmedValue) {
    return { classDay: null, gymDay: null };
  }

  const segments = trimmedValue
    .split(';')
    .map((segment) => segment.trim())
    .filter(Boolean);
  const classDayValues = segments
    .find((segment) => segment.startsWith('class_day='))
    ?.slice('class_day='.length)
    .trim();
  const gymDayValues = segments
    .find((segment) => segment.startsWith('gym_day='))
    ?.slice('gym_day='.length)
    .trim();

  const classDay = normalizeJuniorApplicationDaysValue(classDayValues);
  const gymDay = normalizeJuniorApplicationDaysValue(gymDayValues);

  if (classDay || gymDay) {
    return { classDay, gymDay };
  }

  const fallbackDays = normalizeJuniorApplicationDaysValue(trimmedValue);
  return { classDay: fallbackDays, gymDay: fallbackDays };
};

export const serializeJuniorApplicationDaySelection = (
  classDay: JuniorApplicationDays | null,
  gymDay: JuniorApplicationDays | null,
): string | null => {
  const classSegment =
    classDay && classDay.length > 0 ? `class_day=${classDay.join('&')}` : null;
  const gymSegment =
    gymDay && gymDay.length > 0 ? `gym_day=${gymDay.join('&')}` : null;

  if (!classSegment && !gymSegment) {
    return null;
  }

  return [classSegment, gymSegment].filter(Boolean).join(';');
};

export const getJuniorApplicationDayVisibility = (selection: {
  classDay: JuniorApplicationDays | null;
  gymDay: JuniorApplicationDays | null;
}): {
  showClassPerformances: boolean;
  showGymPerformances: boolean;
} => {
  const hasClassSelection = Boolean(
    selection.classDay && selection.classDay.length > 0,
  );
  const hasGymSelection = Boolean(
    selection.gymDay && selection.gymDay.length > 0,
  );

  return {
    showClassPerformances: hasClassSelection || !hasGymSelection,
    showGymPerformances: hasGymSelection || !hasClassSelection,
  };
};

export const resolveJuniorApplicationDays = (
  search: string,
): {
  classDay: JuniorApplicationDays | null;
  gymDay: JuniorApplicationDays | null;
} => {
  const classDayValues = parseQueryValuesFromSearchString(search, 'class_day');
  const gymDayValues = parseQueryValuesFromSearchString(search, 'gym_day');
  const fallbackValues = parseQueryValuesFromSearchString(search, 'day');
  const legacyFallbackValues = parseQueryValuesFromSearchString(
    search,
    'application_day',
  );

  const classDay = normalizeJuniorApplicationDaysValue(
    classDayValues.length > 0
      ? classDayValues.join('&')
      : fallbackValues.length > 0
        ? fallbackValues.join('&')
        : legacyFallbackValues.length > 0
          ? legacyFallbackValues.join('&')
          : null,
  );
  const gymDay = normalizeJuniorApplicationDaysValue(
    gymDayValues.length > 0
      ? gymDayValues.join('&')
      : fallbackValues.length > 0
        ? fallbackValues.join('&')
        : legacyFallbackValues.length > 0
          ? legacyFallbackValues.join('&')
          : null,
  );

  return { classDay, gymDay };
};

export const isScheduleVisibleForApplicationDay = (
  roundName: string,
  scheduleId: number,
  applicationDays: JuniorApplicationDays | null,
): boolean => {
  if (!applicationDays || applicationDays.length === 0) {
    return true;
  }

  const day1Schedules = [1, 2, 3, 4];
  const day2Schedules = [5, 6, 7, 8];

  const matchesDay1 = applicationDays.includes('day1');
  const matchesDay2 = applicationDays.includes('day2');

  const allowedScheduleIds = [
    ...(matchesDay1 ? day1Schedules : []),
    ...(matchesDay2 ? day2Schedules : []),
  ];

  if (!allowedScheduleIds.includes(scheduleId)) {
    return false;
  }

  if (applicationDays.includes('day1') && applicationDays.includes('day2')) {
    return true;
  }

  if (applicationDays.includes('day1')) {
    return !roundName.includes('2日目');
  }

  return roundName.includes('2日目');
};
