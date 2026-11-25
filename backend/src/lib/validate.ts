import type { z } from 'zod';
import { badRequest } from './errors.js';

/** Validates untrusted input. Throws a 400 listing each invalid field. */
export function parse<S extends z.ZodType>(schema: S, data: unknown): z.infer<S> {
  const result = schema.safeParse(data);
  if (!result.success) {
    const fields = result.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message }));
    throw badRequest('VALIDATION_FAILED', 'Request validation failed', fields);
  }
  return result.data;
}
