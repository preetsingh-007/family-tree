// Shared helpers for the build/data safety checks (no dependencies).
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

export function* walk(dir) {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) yield* walk(path);
    else yield path;
  }
}

/** Returns a problem description if `text` is not a well-formed encrypted container. */
export function containerProblem(text) {
  let value;
  try {
    value = JSON.parse(text);
  } catch {
    return 'is not JSON';
  }
  if (value?.format === 'family-tree') return 'is an UNENCRYPTED family-tree document';
  if (value?.format !== 'family-tree-encrypted') return 'is not an encrypted family-tree container';
  const ok =
    value.version === 1 &&
    value.kdf?.name === 'PBKDF2' &&
    typeof value.kdf?.salt === 'string' &&
    Number.isInteger(value.kdf?.iterations) &&
    value.cipher?.name === 'AES-GCM' &&
    typeof value.cipher?.iv === 'string' &&
    typeof value.ciphertext === 'string';
  return ok ? undefined : 'is a malformed encrypted container';
}

/** True if the text looks like a plaintext family-tree document. */
export function looksLikePlaintextTree(text) {
  return /"format"\s*:\s*"family-tree"/.test(text) && /"people"\s*:/.test(text);
}

export function read(path) {
  return readFileSync(path, 'utf8');
}
