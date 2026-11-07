import env from '../config/env';

/** "Saturday 8 November, 10:00 am IST" in the campus time zone. */
export function formatCampusTime(date: Date, timeZone = env.campusTimeZone): string {
  return new Intl.DateTimeFormat('en-IN', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    hour: 'numeric',
    minute: '2-digit',
    timeZone,
    timeZoneName: 'short',
  }).format(date);
}
