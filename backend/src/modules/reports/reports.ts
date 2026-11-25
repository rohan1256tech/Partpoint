import { sql } from 'drizzle-orm';
import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { Database } from '../../db/index.js';
import { rupees, toCsv } from '../../lib/csv.js';
import { badRequest } from '../../lib/errors.js';
import { istBoundaries, istDateRange, istDateTime } from '../../lib/time.js';
import { parse } from '../../lib/validate.js';
import { currentUser, type Authenticate } from '../../plugins/auth.js';

const DASHBOARD_CACHE_MS = 60_000;
export const MAX_REPORT_DAYS = 366;
export const MAX_CSV_ROWS = 50_000;

const isoDay = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD');
export const rangeQuery = z
  .object({ from: isoDay, to: isoDay, format: z.enum(['json', 'csv']).default('json') })
  .superRefine((q, ctx) => {
    const { start, end } = istDateRange(q.from, q.to);
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
      ctx.addIssue({ code: 'custom', path: ['from'], message: 'Invalid date' });
    } else if (end <= start) {
      ctx.addIssue({ code: 'custom', path: ['to'], message: '"to" must not be before "from"' });
    } else if ((end.getTime() - start.getTime()) / 86_400_000 > MAX_REPORT_DAYS) {
      ctx.addIssue({ code: 'custom', path: ['to'], message: `At most ${MAX_REPORT_DAYS} days per report` });
    }
  });

const n = (v: unknown) => Number(v ?? 0);

export class ReportsService {
  private dashboardCache: { at: number; value: unknown } | null = null;

  constructor(private readonly db: Database) {}

  /** Admin home screen. Cancelled orders are excluded from sales figures. */
  async dashboard() {
    if (this.dashboardCache && Date.now() - this.dashboardCache.at < DASHBOARD_CACHE_MS) {
      return this.dashboardCache.value;
    }
    const b = istBoundaries();
    const one = async <T>(q: ReturnType<typeof sql>) => (await this.db.execute<T & Record<string, unknown>>(q)).rows;

    const [[users], [orders], byStatus, series, topWholesalers, topProducts, [moderation], [unpaid]] = await Promise.all([
      one<{ pending: number; retailers: number; wholesalers: number; delivery: number }>(sql`
        SELECT count(*) FILTER (WHERE status = 'pending')::int AS pending,
               count(*) FILTER (WHERE role = 'retailer' AND status = 'approved')::int AS retailers,
               count(*) FILTER (WHERE role = 'wholesaler' AND status = 'approved')::int AS wholesalers,
               count(*) FILTER (WHERE role = 'delivery' AND status = 'approved')::int AS delivery
        FROM users WHERE deleted_at IS NULL AND role <> 'admin'`),
      one<Record<string, string | number>>(sql`
        SELECT count(*) FILTER (WHERE created_at >= ${b.today})::int AS orders_today,
               count(*) FILTER (WHERE created_at >= ${b.month})::int AS orders_month,
               COALESCE(sum(total_paise) FILTER (WHERE created_at >= ${b.today}), 0) AS gmv_today,
               COALESCE(sum(total_paise) FILTER (WHERE created_at >= ${b.month}), 0) AS gmv_month,
               COALESCE(sum(commission_paise) FILTER (WHERE status = 'delivered' AND delivered_at >= ${b.month}), 0) AS commission_month,
               COALESCE(sum(delivery_fee_paise) FILTER (WHERE status = 'delivered' AND delivered_at >= ${b.month}), 0) AS delivery_fees_month
        FROM orders WHERE status <> 'cancelled'`),
      one<{ status: string; count: number }>(sql`SELECT status, count(*)::int AS count FROM orders GROUP BY status`),
      one<{ day: string; orders: number; gmv: string }>(sql`
        SELECT to_char(d, 'YYYY-MM-DD') AS day, count(o.id)::int AS orders, COALESCE(sum(o.total_paise), 0) AS gmv
        FROM generate_series((now() AT TIME ZONE 'Asia/Kolkata')::date - 29, (now() AT TIME ZONE 'Asia/Kolkata')::date, interval '1 day') d
        LEFT JOIN orders o ON (o.created_at AT TIME ZONE 'Asia/Kolkata')::date = d::date AND o.status <> 'cancelled'
        GROUP BY d ORDER BY d`),
      one<{ id: string; name: string; orders: number; gmv: string }>(sql`
        SELECT o.wholesaler_id AS id, wp.business_name AS name, count(*)::int AS orders, sum(o.total_paise) AS gmv
        FROM orders o JOIN wholesaler_profiles wp ON wp.user_id = o.wholesaler_id
        WHERE o.status <> 'cancelled' AND o.created_at >= ${b.month}
        GROUP BY o.wholesaler_id, wp.business_name ORDER BY gmv DESC LIMIT 5`),
      one<{ id: string; name: string; qty: string; sales: string }>(sql`
        SELECT oi.product_id AS id, max(oi.product_name) AS name, sum(oi.qty) AS qty, sum(oi.line_total_paise) AS sales
        FROM order_items oi JOIN orders o ON o.id = oi.order_id
        WHERE o.status <> 'cancelled' AND o.created_at >= ${b.month}
        GROUP BY oi.product_id ORDER BY qty DESC LIMIT 5`),
      one<{ open_reports: number }>(sql`
        SELECT count(DISTINCT review_id)::int AS open_reports FROM review_reports WHERE resolved_at IS NULL`),
      one<{ delivery: string }>(sql`
        SELECT COALESCE(sum(amount_paise), 0) AS delivery FROM delivery_earnings WHERE paid_out_at IS NULL`),
    ]);

    const value = {
      generatedAt: new Date().toISOString(),
      users: {
        pendingApprovals: users?.pending ?? 0,
        retailers: users?.retailers ?? 0,
        wholesalers: users?.wholesalers ?? 0,
        deliveryPartners: users?.delivery ?? 0,
      },
      orders: {
        today: n(orders?.orders_today),
        thisMonth: n(orders?.orders_month),
        byStatus: Object.fromEntries(byStatus.map((r) => [r.status, r.count])),
      },
      sales: {
        gmvTodayPaise: n(orders?.gmv_today),
        gmvThisMonthPaise: n(orders?.gmv_month),
        commissionThisMonthPaise: n(orders?.commission_month),
        deliveryFeesThisMonthPaise: n(orders?.delivery_fees_month),
      },
      last30Days: series.map((r) => ({ date: r.day, orders: r.orders, gmvPaise: n(r.gmv) })),
      topWholesalers: topWholesalers.map((r) => ({ id: r.id, name: r.name, orders: r.orders, gmvPaise: n(r.gmv) })),
      topProducts: topProducts.map((r) => ({ id: r.id, name: r.name, qty: n(r.qty), salesPaise: n(r.sales) })),
      openReviewReports: moderation?.open_reports ?? 0,
      unpaidDeliveryEarningsPaise: n(unpaid?.delivery),
    };
    this.dashboardCache = { at: Date.now(), value };
    return value;
  }

  /** Every order placed in the range (IST dates), for accounting. */
  async ordersCsv(from: string, to: string): Promise<string> {
    const { start, end } = istDateRange(from, to);
    const { rows } = await this.db.execute<{
      order_number: string;
      created_at: Date;
      status: string;
      shop_name: string;
      city: string;
      pincode: string;
      business_name: string;
      subtotal_paise: string;
      discount_paise: string;
      delivery_fee_paise: string;
      total_paise: string;
      commission_paise: string;
      delivered_at: Date | null;
      cancel_reason: string | null;
    }>(sql`
      SELECT o.order_number, o.created_at, o.status, rp.shop_name,
             o.address_snapshot->>'city' AS city, o.address_snapshot->>'pincode' AS pincode,
             wp.business_name, o.subtotal_paise, o.discount_paise, o.delivery_fee_paise, o.total_paise,
             o.commission_paise, o.delivered_at, o.cancel_reason
      FROM orders o
      JOIN retailer_profiles rp ON rp.user_id = o.retailer_id
      JOIN wholesaler_profiles wp ON wp.user_id = o.wholesaler_id
      WHERE o.created_at >= ${start} AND o.created_at < ${end}
      ORDER BY o.created_at, o.order_number
      LIMIT ${MAX_CSV_ROWS + 1}`);
    if (rows.length > MAX_CSV_ROWS) {
      throw badRequest('REPORT_TOO_LARGE', `More than ${MAX_CSV_ROWS} orders; choose a shorter date range`);
    }
    return toCsv(
      [
        'Order number', 'Placed at (IST)', 'Status', 'Retailer', 'City', 'PIN code', 'Wholesaler',
        'Subtotal (₹)', 'Discount (₹)', 'Delivery fee (₹)', 'Total (₹)', 'Commission (₹)', 'Delivered at (IST)', 'Cancel reason',
      ],
      rows.map((r) => [
        r.order_number,
        istDateTime(new Date(r.created_at)),
        r.status,
        r.shop_name,
        r.city,
        r.pincode,
        r.business_name,
        rupees(n(r.subtotal_paise)),
        rupees(n(r.discount_paise)),
        rupees(n(r.delivery_fee_paise)),
        rupees(n(r.total_paise)),
        rupees(n(r.commission_paise)),
        r.delivered_at ? istDateTime(new Date(r.delivered_at)) : '',
        r.cancel_reason,
      ]),
    );
  }

  /** A wholesaler's delivered sales in the range (by delivery date), per product. */
  async wholesalerSales(wholesalerId: string, from: string, to: string) {
    const { start, end } = istDateRange(from, to);
    const [[totals], products] = await Promise.all([
      this.db
        .execute<{ orders: number; goods: string; commission: string }>(sql`
          SELECT count(*)::int AS orders, COALESCE(sum(subtotal_paise - discount_paise), 0) AS goods,
                 COALESCE(sum(commission_paise), 0) AS commission
          FROM orders WHERE wholesaler_id = ${wholesalerId} AND status = 'delivered'
            AND delivered_at >= ${start} AND delivered_at < ${end}`)
        .then((r) => r.rows),
      this.db
        .execute<{ product_id: string; name: string; variant: string; qty: string; sales: string }>(sql`
          SELECT oi.product_id, max(oi.product_name) AS name, oi.variant_name AS variant,
                 sum(oi.qty) AS qty, sum(oi.line_total_paise) AS sales
          FROM order_items oi JOIN orders o ON o.id = oi.order_id
          WHERE o.wholesaler_id = ${wholesalerId} AND o.status = 'delivered'
            AND o.delivered_at >= ${start} AND o.delivered_at < ${end}
          GROUP BY oi.product_id, oi.variant_name ORDER BY sales DESC`)
        .then((r) => r.rows),
    ]);
    const goods = n(totals?.goods);
    const commission = n(totals?.commission);
    return {
      from,
      to,
      deliveredOrders: totals?.orders ?? 0,
      goodsPaise: goods,
      commissionPaise: commission,
      netPaise: goods - commission,
      products: products.map((p) => ({
        productId: p.product_id,
        name: p.name,
        variant: p.variant,
        qty: n(p.qty),
        salesPaise: n(p.sales),
      })),
    };
  }
}

// ---------------------------------------------------------------- routes

interface Deps {
  reports: ReportsService;
  authenticate: Authenticate;
}

function sendCsv(reply: FastifyReply, filename: string, body: string) {
  return reply
    .header('content-type', 'text/csv; charset=utf-8')
    .header('content-disposition', `attachment; filename="${filename}"`)
    .header('cache-control', 'no-store')
    .send(body);
}

/** Mounted at /v1/admin. */
export const adminReportRoutes: FastifyPluginAsync<Deps> = async (app, { reports, authenticate }) => {
  app.addHook('preHandler', authenticate({ roles: ['admin'] }));
  app.get('/dashboard', async () => reports.dashboard());
  app.get('/reports/orders.csv', async (req, reply) => {
    const q = parse(rangeQuery, req.query);
    return sendCsv(reply, `partpoint-orders-${q.from}-to-${q.to}.csv`, await reports.ordersCsv(q.from, q.to));
  });
};

/** Mounted at /v1/wholesaler/reports. */
export const wholesalerReportRoutes: FastifyPluginAsync<Deps> = async (app, { reports, authenticate }) => {
  app.addHook('preHandler', authenticate({ roles: ['wholesaler'] }));
  app.get('/sales', async (req: FastifyRequest, reply) => {
    const q = parse(rangeQuery, req.query);
    const report = await reports.wholesalerSales(currentUser(req).id, q.from, q.to);
    if (q.format === 'json') return report;
    const csv = toCsv(
      ['Product', 'Variant', 'Quantity', 'Sales (₹)'],
      report.products.map((p) => [p.name, p.variant, p.qty, rupees(p.salesPaise)]),
    );
    return sendCsv(reply, `sales-${q.from}-to-${q.to}.csv`, csv);
  });
};
