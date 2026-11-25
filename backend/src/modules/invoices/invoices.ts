import { and, asc, eq, sql, type SQL } from 'drizzle-orm';
import type { FastifyPluginAsync, FastifyRequest } from 'fastify';
import PDFDocument from 'pdfkit';
import { z } from 'zod';
import type { Database } from '../../db/index.js';
import { invoiceCounters, orderItems, orders, retailerProfiles, wholesalerProfiles } from '../../db/schema.js';
import { conflict, notFound } from '../../lib/errors.js';
import { istDateTime } from '../../lib/time.js';
import { parse } from '../../lib/validate.js';
import { currentUser, type Authenticate } from '../../plugins/auth.js';
import type { AddressSnapshot } from '../addresses/addresses.js';
import { computeInvoice, financialYear, taxMode, type Invoice } from './invoice-calc.js';

type Tx = Parameters<Parameters<Database['transaction']>[0]>[0];

/** Seller and buyer details frozen when the invoice number is assigned. */
export interface InvoiceSnapshot {
  seller: { businessName: string; gstin: string | null; addressLine: string; city: string; state: string; pincode: string };
  buyer: { shopName: string; gstin: string | null; address: AddressSnapshot };
}

/**
 * Assigns the next invoice number of the wholesaler's series for the current financial year and
 * freezes the parties' details. Called inside the "packed" transition (the order row is locked).
 */
export async function assignInvoice(tx: Tx, orderId: string): Promise<void> {
  const [o] = await tx
    .select({
      invoiceNumber: orders.invoiceNumber,
      wholesalerId: orders.wholesalerId,
      retailerId: orders.retailerId,
      address: orders.addressSnapshot,
    })
    .from(orders)
    .where(eq(orders.id, orderId));
  if (!o || o.invoiceNumber) return;

  const now = new Date();
  const fy = financialYear(now);
  // Upsert-and-increment is atomic per (wholesaler, year): serials are consecutive with no duplicates.
  const [counter] = await tx
    .insert(invoiceCounters)
    .values({ wholesalerId: o.wholesalerId, financialYear: fy, lastSerial: 1 })
    .onConflictDoUpdate({
      target: [invoiceCounters.wholesalerId, invoiceCounters.financialYear],
      set: { lastSerial: sql`${invoiceCounters.lastSerial} + 1` },
    })
    .returning({ serial: invoiceCounters.lastSerial });

  const [seller] = await tx
    .select({
      businessName: wholesalerProfiles.businessName,
      gstin: wholesalerProfiles.gstin,
      addressLine: wholesalerProfiles.addressLine,
      city: wholesalerProfiles.city,
      state: wholesalerProfiles.state,
      pincode: wholesalerProfiles.pincode,
    })
    .from(wholesalerProfiles)
    .where(eq(wholesalerProfiles.userId, o.wholesalerId));
  const [buyer] = await tx
    .select({ shopName: retailerProfiles.shopName, gstin: retailerProfiles.gstin })
    .from(retailerProfiles)
    .where(eq(retailerProfiles.userId, o.retailerId));
  if (!seller || !buyer) throw new Error('missing profile for invoice');

  const snapshot: InvoiceSnapshot = { seller, buyer: { ...buyer, address: o.address as AddressSnapshot } };
  await tx
    .update(orders)
    .set({
      invoiceNumber: `PP${fy}-${String(counter?.serial).padStart(6, '0')}`, // 13 chars; GST allows 16
      invoiceDate: now,
      invoiceSnapshot: snapshot,
    })
    .where(eq(orders.id, orderId));
}

export interface InvoiceDocument {
  invoiceNumber: string;
  invoiceDate: Date;
  orderNumber: string;
  cancelled: boolean;
  deliveryFeePaise: number;
  snapshot: InvoiceSnapshot;
  invoice: Invoice;
}

type Viewer = 'retailer' | 'wholesaler' | 'admin';

export class InvoicesService {
  constructor(private readonly db: Database) {}

  async load(viewer: Viewer, userId: string, orderId: string): Promise<InvoiceDocument> {
    const scope: SQL | undefined =
      viewer === 'retailer' ? eq(orders.retailerId, userId) : viewer === 'wholesaler' ? eq(orders.wholesalerId, userId) : undefined;
    const [o] = await this.db
      .select()
      .from(orders)
      .where(and(eq(orders.id, orderId), scope));
    if (!o) throw notFound('ORDER_NOT_FOUND', 'Order not found');
    if (!o.invoiceNumber || !o.invoiceDate || !o.invoiceSnapshot) {
      throw conflict('INVOICE_NOT_READY', 'The invoice is issued when the wholesaler packs the order');
    }
    const snapshot = o.invoiceSnapshot as InvoiceSnapshot;
    const items = await this.db
      .select()
      .from(orderItems)
      .where(eq(orderItems.orderId, orderId))
      .orderBy(asc(orderItems.productName), asc(orderItems.variantName));
    const mode = taxMode(snapshot.seller.gstin, snapshot.seller.state, snapshot.buyer.address.state);
    return {
      invoiceNumber: o.invoiceNumber,
      invoiceDate: o.invoiceDate,
      orderNumber: o.orderNumber,
      cancelled: o.status === 'cancelled',
      deliveryFeePaise: o.deliveryFeePaise,
      snapshot,
      invoice: computeInvoice(items, o.discountPaise, mode),
    };
  }

  render(doc: InvoiceDocument, opts: { compress?: boolean } = {}): Promise<Buffer> {
    return renderInvoicePdf(doc, opts.compress ?? true);
  }
}

// ---------------------------------------------------------------- PDF

/** Standard PDF fonts have no ₹ glyph, so amounts read "Rs. 1,234.50". */
const money = (paise: number) =>
  `Rs. ${(paise / 100).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const pct = (bps: number) => `${(bps / 100).toFixed(bps % 100 ? 2 : 0)}%`;

function renderInvoicePdf(d: InvoiceDocument, compress: boolean): Promise<Buffer> {
  const pdf = new PDFDocument({ size: 'A4', margin: 40, compress, info: { Title: `Invoice ${d.invoiceNumber}` } });
  const chunks: Buffer[] = [];
  pdf.on('data', (c: Buffer) => chunks.push(c));
  const done = new Promise<Buffer>((resolve, reject) => {
    pdf.on('end', () => resolve(Buffer.concat(chunks)));
    pdf.on('error', reject);
  });

  const { seller, buyer } = d.snapshot;
  const inv = d.invoice;
  const left = 40;
  const width = pdf.page.width - 80;

  pdf.font('Helvetica-Bold').fontSize(16).text(inv.mode === 'none' ? 'BILL OF SUPPLY' : 'TAX INVOICE', left, 40, { width, align: 'center' });
  pdf.font('Helvetica').fontSize(8).fillColor('#555').text('Original for recipient', { width, align: 'center' });
  if (d.cancelled) pdf.font('Helvetica-Bold').fontSize(10).fillColor('#b42318').text('ORDER CANCELLED', { width, align: 'center' });
  pdf.fillColor('#000');

  // Parties
  const top = 95;
  const col = width / 2 - 10;
  pdf.font('Helvetica-Bold').fontSize(9).text('Seller', left, top);
  pdf.font('Helvetica').text(
    [seller.businessName, seller.addressLine, `${seller.city}, ${seller.state} ${seller.pincode}`, `GSTIN: ${seller.gstin ?? 'Not registered'}`].join('\n'),
    left,
    top + 12,
    { width: col },
  );
  const a = buyer.address;
  const rightX = left + width / 2 + 10;
  pdf.font('Helvetica-Bold').text('Bill to / Ship to', rightX, top);
  pdf.font('Helvetica').text(
    [
      buyer.shopName,
      [a.line1, a.line2, a.landmark].filter(Boolean).join(', '),
      `${a.city}, ${a.state} ${a.pincode}`,
      `GSTIN: ${buyer.gstin ?? 'Unregistered'}`,
      `Place of supply: ${a.state}`,
    ].join('\n'),
    rightX,
    top + 12,
    { width: col },
  );

  const metaY = top + 80;
  pdf.font('Helvetica').fontSize(9).text(
    `Invoice no: ${d.invoiceNumber}    Date: ${istDateTime(d.invoiceDate).slice(0, 10)}    Order no: ${d.orderNumber}`,
    left,
    metaY,
    { width },
  );

  // Items table
  const cols = [
    { h: '#', w: 18, align: 'left' as const },
    { h: 'Item', w: 150, align: 'left' as const },
    { h: 'HSN', w: 45, align: 'left' as const },
    { h: 'Qty', w: 30, align: 'right' as const },
    { h: 'Rate', w: 60, align: 'right' as const },
    { h: 'Discount', w: 50, align: 'right' as const },
    { h: 'Taxable', w: 60, align: 'right' as const },
    { h: 'GST', w: 30, align: 'right' as const },
    { h: 'Amount', w: width - 443, align: 'right' as const },
  ];
  let y = metaY + 22;
  const row = (cells: string[], bold = false) => {
    pdf.font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(8);
    let x = left;
    const heights = cells.map((c, i) => pdf.heightOfString(c, { width: (cols[i]?.w ?? 40) - 4 }));
    cells.forEach((c, i) => {
      const spec = cols[i];
      if (!spec) return;
      pdf.text(c, x + 2, y, { width: spec.w - 4, align: spec.align });
      x += spec.w;
    });
    y += Math.max(...heights) + 6;
    pdf.moveTo(left, y - 3).lineTo(left + width, y - 3).strokeColor('#ddd').lineWidth(0.5).stroke();
    if (y > pdf.page.height - 160) {
      pdf.addPage();
      y = 40;
    }
  };
  row(cols.map((c) => c.h), true);
  inv.lines.forEach((l, i) =>
    row([
      String(i + 1),
      `${l.productName} (${l.variantName})`,
      l.hsnCode ?? '-',
      String(l.qty),
      money(l.unitPricePaise),
      l.discountPaise ? money(l.discountPaise) : '-',
      money(l.taxablePaise),
      inv.mode === 'none' ? '-' : pct(l.gstRateBps),
      money(l.netPaise),
    ]),
  );

  // Totals
  y += 6;
  const line = (label: string, value: string, bold = false) => {
    pdf.font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(9);
    pdf.text(label, left + width - 260, y, { width: 150, align: 'right' });
    pdf.text(value, left + width - 105, y, { width: 105, align: 'right' });
    y += 14;
  };
  line('Taxable value', money(inv.totals.taxablePaise));
  if (inv.mode === 'intra') {
    line('CGST', money(inv.totals.cgstPaise));
    line('SGST', money(inv.totals.sgstPaise));
  } else if (inv.mode === 'inter') {
    line('IGST', money(inv.totals.igstPaise));
  }
  line('Invoice total', money(inv.totals.totalPaise), true);

  if (inv.byRate.length) {
    y += 6;
    pdf.font('Helvetica-Bold').fontSize(8).text('Tax summary', left, y);
    y += 12;
    pdf.font('Helvetica').fontSize(8);
    for (const r of inv.byRate) {
      const tax = inv.mode === 'intra' ? `CGST ${money(r.cgstPaise)} + SGST ${money(r.sgstPaise)}` : `IGST ${money(r.igstPaise)}`;
      pdf.text(`GST ${pct(r.rateBps)} on ${money(r.taxablePaise)}: ${tax}`, left, y);
      y += 12;
    }
  }

  y += 10;
  const notes = [
    'Prices are inclusive of GST.',
    inv.mode === 'none' ? 'Supplier not registered under GST: no tax charged on this bill of supply.' : null,
    d.deliveryFeePaise > 0
      ? `Delivery fee of ${money(d.deliveryFeePaise)} is charged by Partpoint separately and is not part of this invoice.`
      : null,
    `Sold by ${seller.businessName} through the Partpoint marketplace. This is a computer-generated invoice and needs no signature.`,
  ].filter((n): n is string => !!n);
  pdf.font('Helvetica').fontSize(7.5).fillColor('#555').text(notes.join('\n'), left, y, { width });

  pdf.end();
  return done;
}

// ---------------------------------------------------------------- routes

interface Deps {
  invoices: InvoicesService;
  authenticate: Authenticate;
}

function invoiceRoute(viewer: Viewer): FastifyPluginAsync<Deps> {
  return async (app, { invoices, authenticate }) => {
    app.get(
      '/:id/invoice.pdf',
      { preHandler: authenticate({ roles: [viewer] }) },
      async (req: FastifyRequest, reply) => {
        const { id } = parse(z.object({ id: z.uuid() }), req.params);
        const doc = await invoices.load(viewer, currentUser(req).id, id);
        const pdf = await invoices.render(doc);
        return reply
          .header('content-type', 'application/pdf')
          .header('content-disposition', `inline; filename="invoice-${doc.invoiceNumber}.pdf"`)
          .header('cache-control', 'private, no-store')
          .send(pdf);
      },
    );
  };
}

/** Mounted at /v1/orders, /v1/wholesaler/orders and /v1/admin/orders respectively. */
export const retailerInvoiceRoutes = invoiceRoute('retailer');
export const wholesalerInvoiceRoutes = invoiceRoute('wholesaler');
export const adminInvoiceRoutes = invoiceRoute('admin');
