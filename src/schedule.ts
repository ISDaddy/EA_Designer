// Turns an Integration Frequency's structured `schedule` into actual points in time, so the
// Schedule page can show real upcoming runs (and cross-reference them against planned downtimes)
// instead of just a descriptive label like "Batch - Hourly" that a computer can't act on.
import { CronExpressionParser } from 'cron-parser';

export type ScheduleDef =
  | { kind: 'none' }
  | { kind: 'cron'; expression: string }
  | { kind: 'interval'; everyMinutes: number }
  | { kind: 'daily'; time: string } // "HH:MM", 24h
  | { kind: 'weekly'; time: string; daysOfWeek: number[] }; // 0=Sun..6=Sat

export const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export const describeSchedule = (schedule: ScheduleDef | undefined): string => {
  if (!schedule) return 'No schedule';
  switch (schedule.kind) {
    case 'cron': return `Cron: ${schedule.expression}`;
    case 'interval': return `Every ${schedule.everyMinutes} min`;
    case 'daily': return `Daily at ${schedule.time}`;
    case 'weekly': return `Weekly ${schedule.daysOfWeek.map(d => DAY_NAMES[d]).join(',')} at ${schedule.time}`;
    default: return 'No schedule';
  }
};

const parseTime = (time: string): { h: number; m: number } => {
  const [h, m] = time.split(':').map(Number);
  return { h: h || 0, m: m || 0 };
};

// Bounded on both ends: `count` caps how many occurrences we ever compute (protects against a
// pathological schedule), and any occurrence past `horizonDays` is dropped by the caller anyway -
// but we still need a hard iteration cap here so a bad cron expression can't loop forever.
export function computeNextOccurrences(schedule: ScheduleDef, from: Date, count: number): Date[] {
  switch (schedule.kind) {
    case 'none':
      return [];

    case 'cron': {
      try {
        const interval = CronExpressionParser.parse(schedule.expression, { currentDate: from });
        return interval.take(count).map(d => d.toDate());
      } catch {
        return [];
      }
    }

    case 'interval': {
      const everyMs = Math.max(1, schedule.everyMinutes) * 60_000;
      const results: Date[] = [];
      for (let i = 1; i <= count; i++) {
        results.push(new Date(from.getTime() + i * everyMs));
      }
      return results;
    }

    case 'daily': {
      const { h, m } = parseTime(schedule.time);
      const results: Date[] = [];
      const cursor = new Date(from);
      cursor.setSeconds(0, 0);
      cursor.setHours(h, m, 0, 0);
      if (cursor <= from) cursor.setDate(cursor.getDate() + 1);
      for (let i = 0; i < count; i++) {
        results.push(new Date(cursor));
        cursor.setDate(cursor.getDate() + 1);
      }
      return results;
    }

    case 'weekly': {
      const { h, m } = parseTime(schedule.time);
      const days = [...new Set(schedule.daysOfWeek)].sort((a, b) => a - b);
      if (days.length === 0) return [];
      const results: Date[] = [];
      const cursor = new Date(from);
      cursor.setHours(h, m, 0, 0);
      // Walk forward day by day (bounded to a few weeks' worth) rather than trying to jump
      // straight to the next matching weekday, since that jump math is easy to get off-by-one on
      // around month/DST boundaries - a plain linear scan is simpler to trust.
      let guard = 0;
      while (results.length < count && guard < 7 * (count + 2)) {
        if (days.includes(cursor.getDay()) && cursor > from) {
          results.push(new Date(cursor));
        }
        cursor.setDate(cursor.getDate() + 1);
        guard++;
      }
      return results;
    }

    default:
      return [];
  }
}
