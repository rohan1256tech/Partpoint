import { allocate } from '../orders/pricing.js';

/**
 * GST maths for one invoice. Prices are GST-inclusive, so tax is carved out of each line:
 *   taxable = round(net × 10000 / (10000 + rate)),  tax = net − taxable.
 * The order's coupon discount is spread over the lines first (it lowers the taxable value).
 * Everything is whole paise, and the parts always add up exactly to the order's goods value.
 */
export type TaxMode = 'intra' | 'inter' | 'none';

export interface InvoiceItemInput {
  productName: string;
  variantName: string;
  hsnCode: string | null;
  gstRateBps: number;
  qty: number;
  unitPricePaise: number;
  lineTotalPaise: number;
}

export interface InvoiceLine extends InvoiceItemInput {
  discountPaise: number;
  netPaise: number;
  taxablePaise: number;
  cgstPaise: number;
  sgstPaise: number;
  igstPaise: number;
}

export interface InvoiceTotals {
  grossPaise: number;
  discountPaise: number;
  taxablePaise: number;
  cgstPaise: number;
  sgstPaise: number;
  igstPaise: number;
  totalPaise: number;
}

export interface Invoice {
  mode: TaxMode;
  lines: InvoiceLine[];
  totals: InvoiceTotals;
  /** Tax summary by rate, as GST invoices usually show. */
  byRate: { rateBps: number; taxablePaise: number; cgstPaise: number; sgstPaise: number; igstPaise: number }[];
}

/** Intra-state supply → CGST + SGST; inter-state → IGST; unregistered seller → no GST (bill of supply). */
export function taxMode(sellerGstin: string | null, sellerState: string, buyerState: string): TaxMode {
  if (!sellerGstin) return 'none';
  const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, ' ');
  return norm(sellerState) === norm(buyerState) ? 'intra' : 'inter';
}

export function computeInvoice(items: readonly InvoiceItemInput[], orderDiscountPaise: number, mode: TaxMode): Invoice {
  const discounts = allocate(
    orderDiscountPaise,
    items.map((i) => i.lineTotalPaise),
  );
  const lines = items.map((item, idx): InvoiceLine => {
    const discountPaise = discounts[idx] as number;
    const netPaise = item.lineTotalPaise - discountPaise;
    const taxablePaise =
      mode === 'none' ? netPaise : Math.round((netPaise * 10_000) / (10_000 + item.gstRateBps));
    const tax = netPaise - taxablePaise;
    const cgstPaise = mode === 'intra' ? Math.floor(tax / 2) : 0;
    const sgstPaise = mode === 'intra' ? tax - cgstPaise : 0;
    const igstPaise = mode === 'inter' ? tax : 0;
    return { ...item, discountPaise, netPaise, taxablePaise, cgstPaise, sgstPaise, igstPaise };
  });

  const sum = (k: keyof InvoiceLine) => lines.reduce((s, l) => s + (l[k] as number), 0);
  const totals: InvoiceTotals = {
    grossPaise: sum('lineTotalPaise'),
    discountPaise: sum('discountPaise'),
    taxablePaise: sum('taxablePaise'),
    cgstPaise: sum('cgstPaise'),
    sgstPaise: sum('sgstPaise'),
    igstPaise: sum('igstPaise'),
    totalPaise: sum('netPaise'),
  };

  const rates = [...new Set(lines.map((l) => l.gstRateBps))].sort((a, b) => a - b);
  const byRate =
    mode === 'none'
      ? []
      : rates.map((rateBps) => {
          const of = lines.filter((l) => l.gstRateBps === rateBps);
          const s = (k: keyof InvoiceLine) => of.reduce((acc, l) => acc + (l[k] as number), 0);
          return {
            rateBps,
            taxablePaise: s('taxablePaise'),
            cgstPaise: s('cgstPaise'),
            sgstPaise: s('sgstPaise'),
            igstPaise: s('igstPaise'),
          };
        });

  return { mode, lines, totals, byRate };
}

/** Indian financial year label for a date in IST: April 2026 – March 2027 → "2627". */
export function financialYear(date: Date): string {
  const ist = new Date(date.getTime() + 330 * 60_000);
  const y = ist.getUTCFullYear();
  const start = ist.getUTCMonth() + 1 >= 4 ? y : y - 1;
  const two = (n: number) => String(n % 100).padStart(2, '0');
  return `${two(start)}${two(start + 1)}`;
}
