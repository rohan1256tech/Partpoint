import { hash, verify } from '@node-rs/argon2';

// Argon2id (the library default) with OWASP-recommended parameters: 19 MiB, 2 iterations, 1 lane.
const OPTIONS = { memoryCost: 19456, timeCost: 2, parallelism: 1 } as const;

export function hashPassword(password: string): Promise<string> {
  return hash(password, OPTIONS);
}

export async function verifyPassword(passwordHash: string, password: string): Promise<boolean> {
  try {
    return await verify(passwordHash, password);
  } catch {
    return false; // malformed hash
  }
}

let dummyHash: Promise<string> | undefined;

/** Runs a verification against a throwaway hash so unknown accounts take as long as known ones. */
export async function burnPasswordCheck(password: string): Promise<void> {
  dummyHash ??= hash('partpoint-timing-equaliser', OPTIONS);
  await verifyPassword(await dummyHash, password);
}
