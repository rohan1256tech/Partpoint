/** Paise → "₹1,23,456.50" (Indian digit grouping). */
export function rupees(paise: number, opts: { decimals?: boolean } = {}): string {
  const decimals = opts.decimals ?? true;
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    minimumFractionDigits: decimals ? 2 : 0,
    maximumFractionDigits: decimals ? 2 : 0,
  }).format(paise / 100);
}

export function count(n: number): string {
  return new Intl.NumberFormat('en-IN').format(n);
}

const IST = 'Asia/Kolkata';

/** "26 Nov 2026, 14:05" in India time, whatever the browser's time zone. */
export function dateTime(iso: string): string {
  return new Intl.DateTimeFormat('en-IN', {
    timeZone: IST,
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(new Date(iso));
}

export function date(iso: string): string {
  return new Intl.DateTimeFormat('en-IN', { timeZone: IST, day: 'numeric', month: 'short', year: 'numeric' }).format(
    new Date(iso),
  );
}

/** Today's date in IST as YYYY-MM-DD (for report date pickers). */
export function istToday(now = new Date()): string {
  return new Date(now.getTime() + 330 * 60_000).toISOString().slice(0, 10);
}

/** "out_for_delivery" → "Out for delivery". */
export function humanize(s: string): string {
  const t = s.replace(/_/g, ' ');
  return t.charAt(0).toUpperCase() + t.slice(1);
}
