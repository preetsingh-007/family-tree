import type { Id } from './types';

/** Random (version 4) UUID from the platform's cryptographically secure generator. */
export function newId(): Id {
  return crypto.randomUUID();
}
