const BOM = String.fromCharCode(0xfeff);

export type Cell = string | number | null | undefined;

/**
 * One CSV cell (RFC 4180). Text that a spreadsheet would treat as a formula
 * (=, +, -, @, tab, CR) is prefixed with an apostrophe: CSV injection protection,
 * since names and comments come from users. Numbers are written as-is.
 */
export function csvCell(value: Cell): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'number') return String(value);
  let s = value;
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** A complete CSV document with a BOM, so Excel opens UTF-8 (₹, Hindi names) correctly. */
export function toCsv(header: readonly string[], rows: readonly (readonly Cell[])[]): string {
  const lines = [header, ...rows].map((r) => r.map(csvCell).join(','));
  return `${BOM}${lines.join('\r\n')}\r\n`;
}

/** Paise → "1234.50" (rupees, two decimals) for reports. */
export const rupees = (paise: number) => (paise / 100).toFixed(2);
