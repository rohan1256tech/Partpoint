/** India Standard Time helpers. Business days, reports and order numbers follow IST. */
export const IST_OFFSET_MS = 330 * 60_000;
const DAY_MS = 86_400_000;

/** Midnight IST of the day containing `now`, as a UTC instant. */
export function istStartOfDay(now = new Date()): Date {
  const local = new Date(now.getTime() + IST_OFFSET_MS);
  return new Date(Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate()) - IST_OFFSET_MS);
}

export function istStartOfMonth(now = new Date()): Date {
  const local = new Date(now.getTime() + IST_OFFSET_MS);
  return new Date(Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), 1) - IST_OFFSET_MS);
}

export function istBoundaries(now = new Date()) {
  const today = istStartOfDay(now);
  return { today, week: new Date(today.getTime() - 6 * DAY_MS), month: istStartOfMonth(now) };
}

/** "2026-11-26" (IST calendar date) → [start, end) as UTC instants. `to` is inclusive. */
export function istDateRange(from: string, to: string): { start: Date; end: Date } {
  const start = new Date(`${from}T00:00:00+05:30`);
  const end = new Date(new Date(`${to}T00:00:00+05:30`).getTime() + DAY_MS);
  return { start, end };
}

/** IST calendar date of an instant, "YYYY-MM-DD". */
export function istDate(d: Date): string {
  return new Date(d.getTime() + IST_OFFSET_MS).toISOString().slice(0, 10);
}

/** "2026-11-26 14:05" in IST, for reports. */
export function istDateTime(d: Date): string {
  return new Date(d.getTime() + IST_OFFSET_MS).toISOString().slice(0, 16).replace('T', ' ');
}
