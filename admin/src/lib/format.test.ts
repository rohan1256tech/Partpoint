import { describe, expect, it } from 'vitest';
import { dateTime, humanize, istToday, rupees } from './format';

describe('format', () => {
  it('formats paise as rupees with Indian grouping', () => {
    expect(rupees(12_345_650)).toBe('₹1,23,456.50');
    expect(rupees(12_345_650, { decimals: false })).toBe('₹1,23,457');
    expect(rupees(0)).toBe('₹0.00');
  });

  it('shows times in IST regardless of the browser time zone', () => {
    expect(dateTime('2026-11-25T20:00:00Z')).toBe('26 Nov 2026, 01:30');
  });

  it('gives the IST calendar date', () => {
    expect(istToday(new Date('2026-11-25T19:00:00Z'))).toBe('2026-11-26');
    expect(istToday(new Date('2026-11-25T18:00:00Z'))).toBe('2026-11-25');
  });

  it('humanizes status codes', () => {
    expect(humanize('out_for_delivery')).toBe('Out for delivery');
  });
});
