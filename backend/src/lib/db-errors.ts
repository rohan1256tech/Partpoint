/** Postgres error code anywhere in the cause chain (drizzle wraps driver errors). */
function pgCode(err: unknown): string | undefined {
  for (let e: unknown = err; e; e = (e as { cause?: unknown }).cause) {
    const code = (e as { code?: unknown }).code;
    if (typeof code === 'string' && /^[0-9A-Z]{5}$/.test(code)) return code;
  }
  return undefined;
}

export const isUniqueViolation = (err: unknown) => pgCode(err) === '23505';
export const isForeignKeyViolation = (err: unknown) => pgCode(err) === '23503';
export const isCheckViolation = (err: unknown) => pgCode(err) === '23514';
