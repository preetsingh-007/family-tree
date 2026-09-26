/**
 * Encrypted container format (version 1).
 *
 * The whole family-tree document is encrypted as a single authenticated unit:
 *
 *   key        = PBKDF2-HMAC-SHA-256(passphrase (NFC, UTF-8), salt, iterations) → 256-bit AES key
 *   ciphertext = AES-256-GCM(key, iv, plaintext = UTF-8 JSON document, additionalData = header AAD)
 *
 * Only standard primitives provided by the browser's Web Crypto API are used.
 * The non-secret parameters (salt, iv, iteration count, algorithm names) are
 * stored in a JSON header and bound to the ciphertext as GCM additional
 * authenticated data, so changing any of them makes decryption fail.
 *
 * See docs/DATA_FORMAT.md for the byte-level description.
 */
import { base64ToBytes, bytesToBase64 } from './base64';

export const CONTAINER_FORMAT = 'family-tree-encrypted';
export const CONTAINER_VERSION = 1;

/** OWASP (2023) guidance for PBKDF2-HMAC-SHA-256. */
export const DEFAULT_PBKDF2_ITERATIONS = 600_000;
/** Files with fewer iterations are refused, so weakly protected files are never produced or trusted. */
export const MIN_PBKDF2_ITERATIONS = 310_000;
/** Upper bound to stop a crafted file from locking up the browser. */
export const MAX_PBKDF2_ITERATIONS = 10_000_000;

export const SALT_BYTES = 16;
export const IV_BYTES = 12;
export const TAG_BITS = 128;
export const MIN_PASSPHRASE_LENGTH = 12;

export interface EncryptedContainerV1 {
  format: typeof CONTAINER_FORMAT;
  version: typeof CONTAINER_VERSION;
  kdf: { name: 'PBKDF2'; hash: 'SHA-256'; iterations: number; salt: string };
  cipher: { name: 'AES-GCM'; keyBits: 256; iv: string; tagBits: typeof TAG_BITS };
  /** Base64 of the AES-GCM output (ciphertext followed by the 16-byte tag). */
  ciphertext: string;
}

export type CryptoErrorCode =
  | 'unavailable'
  | 'malformed'
  | 'unsupported-version'
  | 'unsupported-algorithm'
  | 'decryption-failed';

const MESSAGES: Record<CryptoErrorCode, string> = {
  unavailable:
    'This browser does not provide the Web Crypto features needed to protect your data. Please use a current version of Firefox, Chrome, Edge, or Safari over HTTPS.',
  malformed: 'This file is not a valid encrypted family-tree file, or it has been damaged.',
  'unsupported-version': 'This encrypted file was created by a newer version of the application. Please use a newer version to open it.',
  'unsupported-algorithm': 'This encrypted file uses encryption settings that this application does not support.',
  'decryption-failed':
    'The file could not be decrypted. Check that the passphrase is correct. If it is, the file may have been damaged or modified.',
};

export class CryptoError extends Error {
  readonly code: CryptoErrorCode;
  constructor(code: CryptoErrorCode) {
    super(MESSAGES[code]);
    this.name = 'CryptoError';
    this.code = code;
  }
}

/**
 * A derived key held in memory for the current session. The CryptoKey is
 * created non-extractable, so its raw bytes cannot be read back by script.
 */
export interface SessionKey {
  key: CryptoKey;
  salt: Uint8Array<ArrayBuffer>;
  iterations: number;
}

function subtle(): SubtleCrypto {
  const s = globalThis.crypto?.subtle;
  if (!s || typeof globalThis.crypto.getRandomValues !== 'function') throw new CryptoError('unavailable');
  return s;
}

export function isCryptoAvailable(): boolean {
  return !!globalThis.crypto?.subtle && typeof globalThis.crypto.getRandomValues === 'function' && globalThis.isSecureContext !== false;
}

function randomBytes(length: number): Uint8Array<ArrayBuffer> {
  return crypto.getRandomValues(new Uint8Array(new ArrayBuffer(length)));
}

/** UTF-8 encoding. (TextEncoder always returns an ArrayBuffer-backed array; Node's typings are looser.) */
function utf8(text: string): Uint8Array<ArrayBuffer> {
  return new TextEncoder().encode(text) as Uint8Array<ArrayBuffer>;
}

/** Passphrases are Unicode-normalised so the same text typed on different systems derives the same key. */
function encodePassphrase(passphrase: string): Uint8Array<ArrayBuffer> {
  return utf8(passphrase.normalize('NFC'));
}

export async function deriveKey(passphrase: string, salt: Uint8Array<ArrayBuffer>, iterations: number): Promise<SessionKey> {
  if (!Number.isInteger(iterations) || iterations < MIN_PBKDF2_ITERATIONS || iterations > MAX_PBKDF2_ITERATIONS) {
    throw new CryptoError('unsupported-algorithm');
  }
  const s = subtle();
  const material = await s.importKey('raw', encodePassphrase(passphrase), 'PBKDF2', false, ['deriveKey']);
  const key = await s.deriveKey(
    { name: 'PBKDF2', hash: 'SHA-256', salt, iterations },
    material,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
  return { key, salt, iterations };
}

/** Derives a key for a new passphrase with a fresh random salt. */
export function createSessionKey(passphrase: string, iterations = DEFAULT_PBKDF2_ITERATIONS): Promise<SessionKey> {
  return deriveKey(passphrase, randomBytes(SALT_BYTES), iterations);
}

/**
 * Canonical additional authenticated data: every header field, in a fixed order.
 * Tampering with any header value (e.g. lowering the iteration count) breaks authentication.
 */
function headerAad(c: Omit<EncryptedContainerV1, 'ciphertext'>): Uint8Array<ArrayBuffer> {
  return utf8(
    JSON.stringify([
      c.format,
      c.version,
      c.kdf.name,
      c.kdf.hash,
      c.kdf.iterations,
      c.kdf.salt,
      c.cipher.name,
      c.cipher.keyBits,
      c.cipher.iv,
      c.cipher.tagBits,
    ]),
  );
}

/** Encrypts bytes with a fresh random IV. Each call produces a different ciphertext. */
export async function encryptBytes(plaintext: Uint8Array<ArrayBuffer>, session: SessionKey): Promise<EncryptedContainerV1> {
  const header: Omit<EncryptedContainerV1, 'ciphertext'> = {
    format: CONTAINER_FORMAT,
    version: CONTAINER_VERSION,
    kdf: { name: 'PBKDF2', hash: 'SHA-256', iterations: session.iterations, salt: bytesToBase64(session.salt) },
    cipher: { name: 'AES-GCM', keyBits: 256, iv: bytesToBase64(randomBytes(IV_BYTES)), tagBits: TAG_BITS },
  };
  const ciphertext = await subtle().encrypt(
    { name: 'AES-GCM', iv: base64ToBytes(header.cipher.iv), additionalData: headerAad(header), tagLength: TAG_BITS },
    session.key,
    plaintext,
  );
  return { ...header, ciphertext: bytesToBase64(new Uint8Array(ciphertext)) };
}

export async function encryptText(text: string, session: SessionKey): Promise<string> {
  const container = await encryptBytes(utf8(text), session);
  return JSON.stringify(container, null, 2);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** True if the value looks like an encrypted container (of any version). */
export function looksLikeContainer(value: unknown): boolean {
  return isRecord(value) && value.format === CONTAINER_FORMAT;
}

/** Strictly parses and checks a container, without attempting decryption. */
export function parseContainer(input: string | unknown): EncryptedContainerV1 {
  let value: unknown = input;
  if (typeof input === 'string') {
    try {
      value = JSON.parse(input);
    } catch {
      throw new CryptoError('malformed');
    }
  }
  if (!isRecord(value) || value.format !== CONTAINER_FORMAT) throw new CryptoError('malformed');
  if (typeof value.version !== 'number') throw new CryptoError('malformed');
  if (value.version !== CONTAINER_VERSION) {
    throw new CryptoError(value.version > CONTAINER_VERSION ? 'unsupported-version' : 'malformed');
  }
  const { kdf, cipher, ciphertext } = value;
  if (!isRecord(kdf) || !isRecord(cipher) || typeof ciphertext !== 'string') throw new CryptoError('malformed');
  if (kdf.name !== 'PBKDF2' || kdf.hash !== 'SHA-256' || cipher.name !== 'AES-GCM' || cipher.keyBits !== 256 || cipher.tagBits !== TAG_BITS) {
    throw new CryptoError('unsupported-algorithm');
  }
  if (typeof kdf.iterations !== 'number' || !Number.isInteger(kdf.iterations)) throw new CryptoError('malformed');
  if (kdf.iterations < MIN_PBKDF2_ITERATIONS || kdf.iterations > MAX_PBKDF2_ITERATIONS) {
    throw new CryptoError('unsupported-algorithm');
  }
  if (typeof kdf.salt !== 'string' || typeof cipher.iv !== 'string') throw new CryptoError('malformed');

  let salt: Uint8Array;
  let iv: Uint8Array;
  let body: Uint8Array;
  try {
    salt = base64ToBytes(kdf.salt);
    iv = base64ToBytes(cipher.iv);
    body = base64ToBytes(ciphertext);
  } catch {
    throw new CryptoError('malformed');
  }
  if (salt.length < SALT_BYTES || iv.length !== IV_BYTES || body.length < TAG_BITS / 8) throw new CryptoError('malformed');

  const extraKeys = Object.keys(value).filter((k) => !['format', 'version', 'kdf', 'cipher', 'ciphertext'].includes(k));
  if (extraKeys.length) throw new CryptoError('malformed');

  return {
    format: CONTAINER_FORMAT,
    version: CONTAINER_VERSION,
    kdf: { name: 'PBKDF2', hash: 'SHA-256', iterations: kdf.iterations, salt: kdf.salt },
    cipher: { name: 'AES-GCM', keyBits: 256, iv: cipher.iv, tagBits: TAG_BITS },
    ciphertext,
  };
}

/** Decrypts with an already-derived key. Throws CryptoError('decryption-failed') if authentication fails. */
export async function decryptWithKey(container: EncryptedContainerV1, session: SessionKey): Promise<Uint8Array> {
  try {
    const plaintext = await subtle().decrypt(
      {
        name: 'AES-GCM',
        iv: base64ToBytes(container.cipher.iv),
        additionalData: headerAad(container),
        tagLength: TAG_BITS,
      },
      session.key,
      base64ToBytes(container.ciphertext),
    );
    return new Uint8Array(plaintext);
  } catch (error) {
    if (error instanceof CryptoError) throw error;
    // AES-GCM authentication failure: wrong key, or modified/corrupted data. These cannot be told apart.
    throw new CryptoError('decryption-failed');
  }
}

/** Derives the key from the passphrase and the container's salt, then decrypts. */
export async function decryptContainer(
  input: string | unknown,
  passphrase: string,
): Promise<{ plaintext: Uint8Array; session: SessionKey }> {
  const container = parseContainer(input);
  const session = await deriveKey(passphrase, base64ToBytes(container.kdf.salt), container.kdf.iterations);
  const plaintext = await decryptWithKey(container, session);
  return { plaintext, session };
}

export async function decryptText(input: string | unknown, passphrase: string): Promise<{ text: string; session: SessionKey }> {
  const { plaintext, session } = await decryptContainer(input, passphrase);
  try {
    return { text: new TextDecoder('utf-8', { fatal: true }).decode(plaintext), session };
  } catch {
    throw new CryptoError('malformed');
  }
}
