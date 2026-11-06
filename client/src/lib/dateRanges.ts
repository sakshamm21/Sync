/**
 * Date filters for Explore, computed on the campus calendar: "today" means
 * today on campus, wherever the browser is.
 */
import { campusDateKey, fromDateTimeInput } from './format.ts';

export type DatePreset = 'today' | 'tomorrow' | 'weekend' | 'week';

export const DATE_PRESET_LABELS: Record<DatePreset, string> = {
  today: 'Today',
  tomorrow: 'Tomorrow',
  weekend: 'This weekend',
  week: 'Next 7 days',
};

const DAY_MS = 24 * 60 * 60 * 1000;

/** Campus day key `days` after the one `now` falls on. Noon avoids any edge at midnight. */
function shiftDay(key: string, days: number): string {
  return new Date(Date.parse(`${key}T12:00:00Z`) + days * DAY_MS).toISOString().slice(0, 10);
}

const startOf = (key: string) => fromDateTimeInput(`${key}T00:00`);

/** `[from, to)` for a preset or a picked `YYYY-MM-DD` day, as ISO strings. */
export function rangeFor(choice: DatePreset | string, now = new Date()): { from: string; to: string } {
  const today = campusDateKey(now);
  let first = today;
  let days = 1;
  if (choice === 'tomorrow') first = shiftDay(today, 1);
  else if (choice === 'week') days = 7;
  else if (choice === 'weekend') {
    const weekday = new Date(`${today}T12:00:00Z`).getUTCDay(); // 0 Sunday … 6 Saturday
    if (weekday === 0) days = 1;
    else {
      first = shiftDay(today, 6 - weekday);
      days = 2;
    }
  } else if (/^\d{4}-\d{2}-\d{2}$/.test(choice)) first = choice;
  return { from: startOf(first).toISOString(), to: startOf(shiftDay(first, days)).toISOString() };
}
