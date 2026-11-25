import { z } from 'zod';

/** Accepts "+919876543210", "919876543210", "09876543210" or "9876543210"; outputs E.164. */
export const phoneSchema = z
  .string()
  .trim()
  .transform((v) => {
    const digits = v.replace(/[\s-]/g, '');
    if (/^[6-9]\d{9}$/.test(digits)) return `+91${digits}`;
    if (/^0[6-9]\d{9}$/.test(digits)) return `+91${digits.slice(1)}`;
    if (/^91[6-9]\d{9}$/.test(digits)) return `+${digits}`;
    return digits;
  })
  .pipe(z.string().regex(/^\+91[6-9]\d{9}$/, 'Enter a valid Indian mobile number'));

export const emailSchema = z.string().trim().toLowerCase().max(254).pipe(z.email('Enter a valid email address'));
export const passwordSchema = z.string().min(8, 'Use at least 8 characters').max(128);
export const otpCodeSchema = z.string().regex(/^\d{6}$/, 'Enter the 6-digit code');
export const appSchema = z.enum(['partpoint', 'delivery', 'admin']);
export const deviceIdSchema = z.string().trim().min(8).max(128);

const gstin = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/, 'Enter a valid GSTIN');
const text = (max: number) => z.string().trim().min(1).max(max);

/** Role-specific profile. Admins cannot self-register. */
export const profileSchema = z.discriminatedUnion('role', [
  z.object({
    role: z.literal('retailer'),
    shopName: text(120),
    gstin: gstin.optional(),
  }),
  z.object({
    role: z.literal('wholesaler'),
    businessName: text(120),
    gstin: gstin.optional(),
    addressLine: text(300),
    city: text(80),
    state: text(80),
    pincode: z.string().regex(/^[1-9]\d{5}$/, 'Enter a valid 6-digit PIN code'),
  }),
  z.object({
    role: z.literal('delivery'),
    vehicleType: text(40).optional(),
    vehicleNumber: text(20).optional(),
  }),
]);
export type ProfileInput = z.infer<typeof profileSchema>;

const deviceContext = { app: appSchema, deviceId: deviceIdSchema };
const signupCommon = {
  name: text(100),
  /** DPDP: explicit consent to the privacy policy is required to sign up. */
  consent: z.literal(true, 'You must accept the privacy policy'),
  profile: profileSchema,
  ...deviceContext,
};

export const otpRequestBody = z.object({ phone: phoneSchema });
export const otpVerifyBody = z.object({ phone: phoneSchema, code: otpCodeSchema, ...deviceContext });

export const registerPhoneBody = z.object({
  registrationToken: z.string().min(1),
  email: emailSchema.optional(),
  ...signupCommon,
});

export const registerEmailBody = z.object({
  email: emailSchema,
  password: passwordSchema,
  phone: phoneSchema.optional(),
  ...signupCommon,
});

export const emailOnlyBody = z.object({ email: emailSchema });
export const emailVerifyBody = z.object({ email: emailSchema, code: otpCodeSchema, ...deviceContext });
export const emailLoginBody = z.object({ email: emailSchema, password: z.string().min(1).max(128), ...deviceContext });
export const passwordResetBody = z.object({ email: emailSchema, code: otpCodeSchema, newPassword: passwordSchema });
export const refreshBody = z.object({ refreshToken: z.string().min(1).max(512), deviceId: deviceIdSchema });
export const logoutBody = z.object({ refreshToken: z.string().min(1).max(512) });
