import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { wholesalerProfiles } from '../src/db/schema.js';
import { computeInvoice, financialYear, taxMode, type InvoiceItemInput } from '../src/modules/invoices/invoice-calc.js';
import { InvoicesService } from '../src/modules/invoices/invoices.js';
import { api, catalogProduct, forward, supply, createTestApp, resetDb, signIn, type TestContext } from './helpers.js';

const item = (lineTotalPaise: number, gstRateBps = 1800, qty = 1): InvoiceItemInput => ({
  productName: 'Part',
  variantName: 'Std',
  hsnCode: '8708',
  gstRateBps,
  qty,
  unitPricePaise: lineTotalPaise / qty,
  lineTotalPaise,
});

describe('GST calculation', () => {
  it('carves CGST and SGST out of GST-inclusive prices', () => {
    const inv = computeInvoice([item(118_000)], 0, 'intra');
    expect(inv.lines[0]).toMatchObject({ taxablePaise: 100_000, cgstPaise: 9_000, sgstPaise: 9_000, igstPaise: 0, netPaise: 118_000 });
    expect(inv.byRate).toEqual([{ rateBps: 1800, taxablePaise: 100_000, cgstPaise: 9_000, sgstPaise: 9_000, igstPaise: 0 }]);
  });

  it('uses IGST between states, and no tax for an unregistered seller', () => {
    expect(computeInvoice([item(118_000)], 0, 'inter').totals).toMatchObject({ igstPaise: 18_000, cgstPaise: 0 });
    const none = computeInvoice([item(118_000)], 0, 'none');
    expect(none.totals).toMatchObject({ taxablePaise: 118_000, cgstPaise: 0, sgstPaise: 0, igstPaise: 0 });
    expect(none.byRate).toEqual([]);
  });

  it('spreads the discount over lines and always adds up exactly', () => {
    const items = [item(99_999, 1800, 3), item(12_345, 500), item(7, 2800), item(250_000, 0, 10), item(31_415, 4000)];
    for (const mode of ['intra', 'inter', 'none'] as const) {
      for (const discount of [0, 1, 777, 12_345]) {
        const { lines, totals } = computeInvoice(items, discount, mode);
        expect(totals.discountPaise).toBe(discount);
        expect(totals.totalPaise).toBe(totals.grossPaise - discount);
        expect(totals.taxablePaise + totals.cgstPaise + totals.sgstPaise + totals.igstPaise).toBe(totals.totalPaise);
        for (const l of lines) expect(l.taxablePaise + l.cgstPaise + l.sgstPaise + l.igstPaise).toBe(l.netPaise);
      }
    }
  });

  it('splits an odd paisa of tax between CGST and SGST', () => {
    const [l] = computeInvoice([item(10_001, 500)], 0, 'intra').lines;
    expect((l?.sgstPaise ?? 0) - (l?.cgstPaise ?? 0)).toBeLessThanOrEqual(1);
    expect((l?.cgstPaise ?? 0) + (l?.sgstPaise ?? 0) + (l?.taxablePaise ?? 0)).toBe(10_001);
  });

  it('works out the Indian financial year in IST', () => {
    expect(financialYear(new Date('2026-11-26T10:00:00Z'))).toBe('2627');
    expect(financialYear(new Date('2027-03-31T18:00:00Z'))).toBe('2627'); // 23:30 IST, 31 March
    expect(financialYear(new Date('2027-03-31T18:31:00Z'))).toBe('2728'); // 00:01 IST, 1 April
    expect(financialYear(new Date('2099-06-01T00:00:00Z'))).toBe('9900');
  });

  it('decides intra- or inter-state supply', () => {
    expect(taxMode('27AAPFU0939F1ZV', 'Maharashtra', ' maharashtra ')).toBe('intra');
    expect(taxMode('27AAPFU0939F1ZV', 'Maharashtra', 'Karnataka')).toBe('inter');
    expect(taxMode(null, 'Maharashtra', 'Maharashtra')).toBe('none');
  });
});

// ---------------------------------------------------------------- API

let t: TestContext;
let http: ReturnType<typeof api>;
let admin: string;
let w1: { id: string; token: string };
let w2: { id: string; token: string };
let retailer: { id: string; token: string };
let addressId: string;
const variants: Record<string, string> = {};

beforeEach(async () => {
  t = await createTestApp();
  await resetDb(t.db);
  http = api(t);
  admin = (await signIn(t, 'admin')).token;
  w1 = await signIn(t, 'wholesaler', { name: 'Bharat Spares' });
  w2 = await signIn(t, 'wholesaler', { name: 'Delhi Auto' });
  retailer = await signIn(t, 'retailer');
  await t.db.update(wholesalerProfiles).set({ gstin: '27AAPFU0939F1ZV' }).where(eq(wholesalerProfiles.userId, w1.id));
  const categoryId = (await http.post('/v1/admin/categories', admin, { name: 'Displays' })).json().id;
  for (const [key, w] of [['w1', w1], ['w2', w2]] as const) {
    const { variantId } = await catalogProduct(http, admin, {
      categoryId,
      name: `Display ${key}`,
      hsnCode: '85177900',
      gstRateBps: 1800,
      variants: [{ name: 'Black', mrpPaise: 150_000, pricePaise: 118_000 }],
    });
    await supply(http, w.token, variantId, 110_000, 100);
    variants[key] = variantId;
  }
  addressId = (
    await http.post('/v1/me/addresses', retailer.token, {
      contactName: 'Ravi',
      contactPhone: '9876543210',
      line1: 'Shop 4',
      city: 'Bengaluru',
      state: 'Karnataka',
      pincode: '560001',
    })
  ).json().id;
});
afterEach(async () => {
  await t.close();
});

async function order(variant: string): Promise<string> {
  await http.put(`/v1/cart/items/${variant}`, retailer.token, { qty: 1 });
  return (await http.post('/v1/orders', retailer.token, { addressId, idempotencyKey: `k-${Math.random()}` })).json().orders[0].id;
}
async function pack(id: string, token: string) {
  await forward(http, admin, id, token === w1.token ? w1.id : w2.id);
  await http.post(`/v1/wholesaler/orders/${id}/accept`, token);
  expect((await http.post(`/v1/wholesaler/orders/${id}/pack`, token)).statusCode).toBe(200);
}

describe('invoices', () => {
  it('is issued when the order is packed, numbered per wholesaler and year', async () => {
    const a = await order(variants.w1 as string);
    const early = await http.get(`/v1/orders/${a}/invoice.pdf`, retailer.token);
    expect(early.statusCode).toBe(409);
    expect(early.json().code).toBe('INVOICE_NOT_READY');

    await pack(a, w1.token);
    const b = await order(variants.w1 as string);
    await pack(b, w1.token);
    const c = await order(variants.w2 as string);
    await pack(c, w2.token);

    const svc = new InvoicesService(t.db);
    const fy = financialYear(new Date());
    expect((await svc.load('admin', '', a)).invoiceNumber).toBe(`SC${fy}-000001`);
    expect((await svc.load('admin', '', b)).invoiceNumber).toBe(`SC${fy}-000002`);
    expect((await svc.load('admin', '', c)).invoiceNumber).toBe(`SC${fy}-000001`); // its own series
  });

  it('applies inter-state IGST and freezes the parties’ details', async () => {
    const id = await order(variants.w1 as string);
    await pack(id, w1.token);
    await t.db.update(wholesalerProfiles).set({ businessName: 'Renamed Later' }).where(eq(wholesalerProfiles.userId, w1.id));

    const doc = await new InvoicesService(t.db).load('retailer', retailer.id, id);
    expect(doc.snapshot.seller).toMatchObject({ businessName: 'Bharat Spares', gstin: '27AAPFU0939F1ZV', state: 'Maharashtra' });
    expect(doc.snapshot.buyer.address.state).toBe('Karnataka');
    expect(doc.invoice.mode).toBe('inter');
    expect(doc.invoice.totals).toMatchObject({ taxablePaise: 100_000, igstPaise: 18_000, totalPaise: 118_000 });
  });

  it('issues a bill of supply for a wholesaler without GSTIN', async () => {
    const id = await order(variants.w2 as string);
    await pack(id, w2.token);
    const doc = await new InvoicesService(t.db).load('wholesaler', w2.id, id);
    expect(doc.invoice.mode).toBe('none');
  });

  it('serves a PDF to the retailer, the wholesaler and the admin only', async () => {
    const id = await order(variants.w1 as string);
    await pack(id, w1.token);

    for (const [url, token] of [
      [`/v1/orders/${id}/invoice.pdf`, retailer.token],
      [`/v1/wholesaler/orders/${id}/invoice.pdf`, w1.token],
      [`/v1/admin/orders/${id}/invoice.pdf`, admin],
    ] as const) {
      const res = await http.get(url, token);
      expect(res.statusCode).toBe(200);
      expect(res.headers['content-type']).toBe('application/pdf');
      expect(res.headers['content-disposition']).toMatch(/^inline; filename="invoice-SC\d{4}-000001\.pdf"$/);
      expect(res.rawPayload.subarray(0, 5).toString()).toBe('%PDF-');
      expect(res.rawPayload.subarray(-6).toString()).toContain('%%EOF');
    }
    const otherRetailer = await signIn(t, 'retailer');
    expect((await http.get(`/v1/orders/${id}/invoice.pdf`, otherRetailer.token)).statusCode).toBe(404);
    expect((await http.get(`/v1/wholesaler/orders/${id}/invoice.pdf`, w2.token)).statusCode).toBe(404);
  });

  it('still opens after a cancellation, marked as cancelled', async () => {
    const id = await order(variants.w1 as string);
    await pack(id, w1.token);
    await http.post(`/v1/admin/orders/${id}/cancel`, admin, { reason: 'Retailer closed' });
    const svc = new InvoicesService(t.db);
    const doc = await svc.load('admin', '', id);
    expect(doc.cancelled).toBe(true);
    const pdf = (await svc.render(doc, { compress: false })).toString('latin1');
    expect(pdf.startsWith('%PDF-')).toBe(true);
    expect(pdf.trimEnd().endsWith('%%EOF')).toBe(true);
    expect(pdf).toMatch(/\/Type \/Page\b/);
  });
});
