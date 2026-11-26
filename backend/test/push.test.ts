import { describe, expect, it } from 'vitest';
import { androidChannel } from '../src/lib/push.js';

describe('push channels', () => {
  it('sends order updates to the orders channel and everything else to general', () => {
    expect(androidChannel({ type: 'order', orderId: 'x', status: 'packed' })).toBe('orders');
    expect(androidChannel({ type: 'account', status: 'approved' })).toBe('general');
    expect(androidChannel({})).toBe('general');
  });
});
