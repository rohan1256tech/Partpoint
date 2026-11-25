import { badRequest } from './errors.js';

/** Opaque keyset-pagination cursor over (createdAt DESC, id DESC). */
export function encodeCursor(createdAt: Date, id: string): string {
  return Buffer.from(`${createdAt.toISOString()}|${id}`).toString('base64url');
}

export function decodeCursor(cursor: string): { createdAt: Date; id: string } {
  const [iso, id] = Buffer.from(cursor, 'base64url').toString().split('|');
  const createdAt = new Date(iso ?? '');
  if (!id || Number.isNaN(createdAt.getTime()) || !/^[0-9a-f-]{36}$/i.test(id)) {
    throw badRequest('INVALID_CURSOR', 'Invalid cursor');
  }
  return { createdAt, id };
}

/** Splits a `limit + 1` result into a page and the cursor for the next one. */
export function paginate<T extends { createdAt: Date; id: string }>(
  rows: T[],
  limit: number,
): { page: T[]; nextCursor: string | null } {
  const page = rows.slice(0, limit);
  const last = page.at(-1);
  return { page, nextCursor: rows.length > limit && last ? encodeCursor(last.createdAt, last.id) : null };
}
