/**
 * Return-deadline reminder scheduling (Section 22). Dates are local calendar dates with an
 * IANA timezone; execution instants are UTC.
 *
 * DST policy: a nonexistent local time moves forward to the next valid instant; an ambiguous
 * local time uses the earlier occurrence. Luxon implements both of these behaviours for
 * DateTime.fromObject in a zone; tests in reminders.test.ts assert this.
 */
import { DateTime, IANAZone } from "luxon";

export const DEFAULT_REMINDER_OFFSETS_DAYS = [3, 1] as const;
export const DATE_ONLY_REMINDER_HOUR = 9;

export type Deadline = {
  /** YYYY-MM-DD local calendar date. */
  date: string;
  /** Optional HH:mm local cutoff. */
  cutoffTime: string | null;
  timezone: string;
};

export type PlannedReminder = {
  offsetDays: number;
  dueAt: Date;
  localLabel: string;
  status: "scheduled" | "skipped_past";
};

export class DateRuleError extends Error {}

export function isValidTimezone(tz: string): boolean {
  return IANAZone.isValidZone(tz);
}

export function parseLocalDate(date: string): { year: number; month: number; day: number } {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!m) throw new DateRuleError("Date must be YYYY-MM-DD");
  const [year, month, day] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const dt = DateTime.fromObject({ year, month, day }, { zone: "UTC" });
  if (!dt.isValid || dt.day !== day) throw new DateRuleError("Invalid calendar date");
  return { year, month, day };
}

function parseTime(t: string): { hour: number; minute: number } {
  const m = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(t);
  if (!m) throw new DateRuleError("Time must be HH:mm");
  return { hour: Number(m[1]), minute: Number(m[2]) };
}

/** Resolve a local wall time to an instant using the documented DST policy. */
export function resolveLocal(
  parts: { year: number; month: number; day: number; hour: number; minute: number },
  timezone: string,
): DateTime {
  if (!isValidTimezone(timezone)) throw new DateRuleError(`Unknown timezone ${timezone}`);
  const dt = DateTime.fromObject({ ...parts, second: 0, millisecond: 0 }, { zone: timezone });
  if (!dt.isValid) throw new DateRuleError(dt.invalidExplanation ?? "Invalid local time");
  // Luxon resolves an ambiguous wall time to the later occurrence; our policy is the earlier.
  // Try every offset the zone uses around this time and keep the earliest instant whose wall
  // time matches exactly. If none match (nonexistent time), Luxon's forward shift is kept.
  const zone = IANAZone.create(timezone);
  const wallAsUtc = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute);
  const offsets = new Set([zone.offset(wallAsUtc - 86400_000), zone.offset(wallAsUtc + 86400_000), dt.offset]);
  const matches: DateTime[] = [];
  for (const off of offsets) {
    const cand = DateTime.fromMillis(wallAsUtc - off * 60_000, { zone: timezone });
    if (cand.year === parts.year && cand.month === parts.month && cand.day === parts.day && cand.hour === parts.hour && cand.minute === parts.minute) {
      matches.push(cand);
    }
  }
  if (matches.length === 0) return dt;
  return matches.reduce((a, b) => (a.toMillis() <= b.toMillis() ? a : b));
}

export function planReminders(deadline: Deadline, now: Date, offsets: readonly number[] = DEFAULT_REMINDER_OFFSETS_DAYS): PlannedReminder[] {
  const d = parseLocalDate(deadline.date);
  const time = deadline.cutoffTime ? parseTime(deadline.cutoffTime) : { hour: DATE_ONLY_REMINDER_HOUR, minute: 0 };
  return offsets.map((offsetDays) => {
    // Calendar arithmetic on the local date, then apply wall time in the zone.
    const day = DateTime.fromObject(d, { zone: "UTC" }).minus({ days: offsetDays });
    const local = resolveLocal({ year: day.year, month: day.month, day: day.day, ...time }, deadline.timezone);
    const dueAt = local.toUTC().toJSDate();
    return {
      offsetDays,
      dueAt,
      localLabel: local.toFormat("yyyy-LL-dd HH:mm ZZZZ"),
      status: dueAt.getTime() <= now.getTime() ? "skipped_past" : "scheduled",
    };
  });
}

/** Today's local calendar date in a zone, as YYYY-MM-DD. */
export function localToday(now: Date, timezone: string): string {
  return DateTime.fromJSDate(now, { zone: timezone }).toISODate()!;
}
