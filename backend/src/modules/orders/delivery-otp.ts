import { createHmac } from 'node:crypto';
import { safeEqual } from '../../lib/crypto.js';

export const DELIVERY_OTP_MAX_ATTEMPTS = 5;

/**
 * The 4-digit code the retailer reads out to the delivery partner at handover.
 * It is derived from a server secret and the order id, so nothing is stored: the retailer's
 * app can always show it, a database leak alone does not reveal it, and it never changes.
 */
export function deliveryOtp(secret: string, orderId: string): string {
  const digest = createHmac('sha256', secret).update(`delivery-otp:${orderId}`).digest();
  return (digest.readUInt32BE(0) % 10_000).toString().padStart(4, '0');
}

export function checkDeliveryOtp(secret: string, orderId: string, code: string): boolean {
  return safeEqual(deliveryOtp(secret, orderId), code);
}
