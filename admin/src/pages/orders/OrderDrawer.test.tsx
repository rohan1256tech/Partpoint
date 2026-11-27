import { MantineProvider } from '@mantine/core';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { OrderDetail, SupplierOptions } from '../../api/types';
import { OrderDrawer } from './OrderDrawer';

const base: OrderDetail = {
  id: 'o1',
  orderNumber: 'PP-20261126-000001',
  status: 'packed',
  totalPaise: 100_000,
  itemCount: 1,
  wholesaler: { id: 'w1', businessName: 'Lamington Mobile Hub' },
  retailer: { id: 'r1', shopName: 'Sharma Mobile Repair' },
  createdAt: '2026-11-26T05:00:00Z',
  subtotalPaise: 100_000,
  discountPaise: 0,
  deliveryFeePaise: 0,
  commissionPaise: 5_000,
  supplyTotalPaise: 95_000,
  address: { contactName: 'Ravi', contactPhone: '+919876543210', line1: 'Shop 4', line2: null, landmark: null, city: 'Nashik', state: 'Maharashtra', pincode: '422001' },
  items: [
    {
      id: 'i1',
      productId: 'p1',
      variantId: 'v1',
      productName: 'Battery for Pulse Note 12',
      variantName: '5000 mAh',
      hsnCode: '85076000',
      gstRateBps: 1800,
      qty: 4,
      unitPricePaise: 25_000,
      lineTotalPaise: 100_000,
      supplyUnitPricePaise: 23_750,
    },
  ],
  timeline: [{ status: 'placed', note: null, at: '2026-11-26T05:00:00Z' }],
  siblings: [],
  cancelReason: null,
  deliveredAt: null,
  deliveryPartner: null,
  deliveryAccepted: false,
  deliveryOtpAttempts: 0,
  pickup: { businessName: 'Lamington Mobile Hub', addressLine: '1 Market Rd', city: 'Pune', state: 'Maharashtra', pincode: '411001', phone: null },
};

const suppliers: SupplierOptions = {
  orderId: 'o1',
  status: 'placed',
  deliveryArea: { city: 'Nashik', state: 'Maharashtra', pincode: '422001' },
  items: [
    {
      id: 'i1',
      productName: 'Battery for Pulse Note 12',
      variantName: '5000 mAh',
      qty: 4,
      unitPricePaise: 25_000,
      offers: [{ wholesalerId: 'w2', supplyPricePaise: 23_000, stockQty: 40 }],
    },
  ],
  wholesalers: [
    { id: 'w2', businessName: 'Nashik Cell Spares', city: 'Nashik', state: 'Maharashtra', pincode: '422001', sameCity: true, itemIds: ['i1'], coversAll: true, supplyTotalPaise: 92_000 },
  ],
  suggestedWholesalerId: 'w2',
};

function show(order: OrderDetail) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      const body = url.includes('/delivery-partners') ? { items: [] } : url.includes('/suppliers') ? suppliers : order;
      return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
    }),
  );
  render(
    <MantineProvider>
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <OrderDrawer orderId={order.id} onClose={() => {}} />
      </QueryClientProvider>
    </MantineProvider>,
  );
}

beforeEach(() => vi.unstubAllGlobals());
afterEach(() => vi.unstubAllGlobals());

describe('OrderDrawer', () => {
  it('offers assignment, cancellation and the invoice for a packed order', async () => {
    show(base);
    expect(await screen.findByText('Order PP-20261126-000001')).toBeInTheDocument();
    expect(screen.getByText('Assign a rider')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /cancel order/i })).toBeDisabled(); // until a reason is typed
    expect(screen.getByRole('button', { name: /gst invoice/i })).toBeInTheDocument();
    expect(screen.getByText('₹50.00')).toBeInTheDocument(); // Partpoint margin
    expect(screen.queryByText(/choose who fulfils/i)).not.toBeInTheDocument();
  });

  it('asks the admin to choose a wholesaler for a new order, with a suggestion', async () => {
    show({ ...base, status: 'placed', wholesaler: null, pickup: null, commissionPaise: null, supplyTotalPaise: null });
    expect(await screen.findByText('Choose who fulfils this order')).toBeInTheDocument();
    expect(await screen.findByText('Suggested: Nashik Cell Spares')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Forward to Nashik Cell Spares' })).toBeInTheDocument();
    expect(screen.getByText('Not chosen yet')).toBeInTheDocument();
    expect(screen.queryByText('Assign a rider')).not.toBeInTheDocument();
  });

  it('offers neither assignment nor cancellation once delivered', async () => {
    show({ ...base, status: 'delivered', deliveredAt: '2026-11-27T05:00:00Z' });
    expect(await screen.findByText('Order PP-20261126-000001')).toBeInTheDocument();
    expect(screen.queryByText('Assign a rider')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /cancel order/i })).not.toBeInTheDocument();
  });

  it('warns when the delivery code is locked', async () => {
    show({
      ...base,
      status: 'out_for_delivery',
      deliveryPartner: { id: 'd1', name: 'Raju', phone: '+919000000002' },
      deliveryAccepted: true,
      deliveryOtpAttempts: 5,
    });
    expect(await screen.findByText('Delivery code locked')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /unlock code/i })).toBeInTheDocument();
  });
});
