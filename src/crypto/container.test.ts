import { describe, expect, it } from 'vitest';
import { base64ToBytes, bytesToBase64 } from './base64';
import {
  createSessionKey,
  CryptoError,
  decryptContainer,
  decryptText,
  DEFAULT_PBKDF2_ITERATIONS,
  deriveKey,
  encryptText,
  IV_BYTES,
  MIN_PBKDF2_ITERATIONS,
  parseContainer,
  SALT_BYTES,
} from './container';

const PASSPHRASE = 'correct horse battery staple';
const PLAINTEXT = JSON.stringify({ secret: 'Great-grandmother was born in Exampleton', emoji: '🌳', accents: 'Zoë Ñúñez' });

async function encrypted(text = PLAINTEXT, passphrase = PASSPHRASE) {
  const session = await createSessionKey(passphrase);
  return { json: await encryptText(text, session), session };
}

async function expectDecryptError(input: string | unknown, code: CryptoError['code'], passphrase = PASSPHRASE) {
  const error = await decryptText(input, passphrase).catch((e: unknown) => e);
  expect(error).toBeInstanceOf(CryptoError);
  expect((error as CryptoError).code).toBe(code);
}

/** Flips one bit of a base64 field. */
function flipBit(base64: string, byteIndex = 0): string {
  const bytes = base64ToBytes(base64);
  bytes[byteIndex]! ^= 0x01;
  return bytesToBase64(bytes);
}

describe('encryption round trip', () => {
  it('decrypts with the correct passphrase', async () => {
    const { json } = await encrypted();
    const { text } = await decryptText(json, PASSPHRASE);
    expect(text).toBe(PLAINTEXT);
  });

  it('produces a self-describing container with no plaintext', async () => {
    const { json } = await encrypted();
    const container = JSON.parse(json);
    expect(container).toMatchObject({
      format: 'family-tree-encrypted',
      version: 1,
      kdf: { name: 'PBKDF2', hash: 'SHA-256', iterations: DEFAULT_PBKDF2_ITERATIONS },
      cipher: { name: 'AES-GCM', keyBits: 256, tagBits: 128 },
    });
    expect(base64ToBytes(container.kdf.salt)).toHaveLength(SALT_BYTES);
    expect(base64ToBytes(container.cipher.iv)).toHaveLength(IV_BYTES);
    // Ciphertext = plaintext length + 16-byte authentication tag.
    expect(base64ToBytes(container.ciphertext)).toHaveLength(new TextEncoder().encode(PLAINTEXT).length + 16);
    expect(json).not.toContain('Exampleton');
    expect(json).not.toContain(PASSPHRASE);
    expect(atob(container.ciphertext)).not.toContain('Exampleton');
  });

  it('encrypts the same plaintext differently every time', async () => {
    const { session } = await encrypted();
    const a = JSON.parse(await encryptText(PLAINTEXT, session));
    const b = JSON.parse(await encryptText(PLAINTEXT, session));
    expect(a.cipher.iv).not.toBe(b.cipher.iv);
    expect(a.ciphertext).not.toBe(b.ciphertext);
    // Both still decrypt.
    expect((await decryptText(a, PASSPHRASE)).text).toBe(PLAINTEXT);
    expect((await decryptText(b, PASSPHRASE)).text).toBe(PLAINTEXT);
  });

  it('uses a fresh random salt for each new passphrase', async () => {
    const a = await createSessionKey(PASSPHRASE);
    const b = await createSessionKey(PASSPHRASE);
    expect(bytesToBase64(a.salt)).not.toBe(bytesToBase64(b.salt));
  });

  it('handles empty and large payloads', async () => {
    const { session } = await encrypted();
    expect((await decryptText(await encryptText('', session), PASSPHRASE)).text).toBe('');
    const large = 'x'.repeat(3_000_000);
    expect((await decryptText(await encryptText(large, session), PASSPHRASE)).text).toBe(large);
  });

  it('normalises Unicode passphrases', async () => {
    const composed = 'café lantern violet';
    const decomposed = 'café lantern violet';
    const { json } = await encrypted(PLAINTEXT, composed);
    expect((await decryptText(json, decomposed)).text).toBe(PLAINTEXT);
  });
});

describe('key derivation', () => {
  it('derives non-extractable AES-GCM keys', async () => {
    const session = await createSessionKey(PASSPHRASE);
    expect(session.key.extractable).toBe(false);
    expect(session.key.algorithm).toMatchObject({ name: 'AES-GCM', length: 256 });
    expect(session.key.usages.sort()).toEqual(['decrypt', 'encrypt']);
    await expect(crypto.subtle.exportKey('raw', session.key)).rejects.toThrow();
  });

  it('derives the same key from the same passphrase and salt', async () => {
    const { json, session } = await encrypted();
    const again = await deriveKey(PASSPHRASE, session.salt, session.iterations);
    const container = parseContainer(json);
    const { plaintext } = await decryptContainer(container, PASSPHRASE);
    expect(new TextDecoder().decode(plaintext)).toBe(PLAINTEXT);
    const reencrypted = await encryptText('check', again);
    expect((await decryptText(reencrypted, PASSPHRASE)).text).toBe('check');
  });

  it('refuses weak or absurd iteration counts', async () => {
    const salt = crypto.getRandomValues(new Uint8Array(SALT_BYTES));
    await expect(deriveKey(PASSPHRASE, salt, 1000)).rejects.toBeInstanceOf(CryptoError);
    await expect(deriveKey(PASSPHRASE, salt, 100_000_000)).rejects.toBeInstanceOf(CryptoError);
    await expect(deriveKey(PASSPHRASE, salt, MIN_PBKDF2_ITERATIONS + 0.5)).rejects.toBeInstanceOf(CryptoError);
  });
});

describe('failures', () => {
  it('rejects an incorrect passphrase without returning plaintext', async () => {
    const { json } = await encrypted();
    await expectDecryptError(json, 'decryption-failed', 'Correct horse battery staple');
    await expectDecryptError(json, 'decryption-failed', '');
  });

  it('explains failures without claiming the passphrase is definitely wrong', async () => {
    const { json } = await encrypted();
    const error = (await decryptText(json, 'wrong passphrase!').catch((e: unknown) => e)) as CryptoError;
    expect(error.message).toMatch(/could not be decrypted/);
    expect(error.message).toMatch(/damaged or modified/);
  });

  it('detects corrupted ciphertext and authentication tag', async () => {
    const { json } = await encrypted();
    const container = JSON.parse(json);
    const length = base64ToBytes(container.ciphertext).length;
    await expectDecryptError({ ...container, ciphertext: flipBit(container.ciphertext, 0) }, 'decryption-failed');
    await expectDecryptError({ ...container, ciphertext: flipBit(container.ciphertext, length - 1) }, 'decryption-failed');
    const truncated = bytesToBase64(base64ToBytes(container.ciphertext).slice(0, length - 1));
    await expectDecryptError({ ...container, ciphertext: truncated }, 'decryption-failed');
  });

  it('detects modified metadata (authenticated as additional data)', async () => {
    const { json } = await encrypted();
    const c = JSON.parse(json);
    await expectDecryptError({ ...c, cipher: { ...c.cipher, iv: flipBit(c.cipher.iv) } }, 'decryption-failed');
    await expectDecryptError({ ...c, kdf: { ...c.kdf, salt: flipBit(c.kdf.salt) } }, 'decryption-failed');
    await expectDecryptError({ ...c, kdf: { ...c.kdf, iterations: c.kdf.iterations + 1 } }, 'decryption-failed');
  });

  it('detects ciphertext moved between containers', async () => {
    const a = JSON.parse((await encrypted('first')).json);
    const b = JSON.parse((await encrypted('second')).json);
    await expectDecryptError({ ...a, ciphertext: b.ciphertext }, 'decryption-failed');
  });

  it('reports unsupported versions and algorithms', async () => {
    const c = JSON.parse((await encrypted()).json);
    await expectDecryptError({ ...c, version: 2 }, 'unsupported-version');
    await expectDecryptError({ ...c, cipher: { ...c.cipher, name: 'AES-CBC' } }, 'unsupported-algorithm');
    await expectDecryptError({ ...c, kdf: { ...c.kdf, name: 'scrypt' } }, 'unsupported-algorithm');
    await expectDecryptError({ ...c, kdf: { ...c.kdf, hash: 'SHA-1' } }, 'unsupported-algorithm');
    await expectDecryptError({ ...c, kdf: { ...c.kdf, iterations: 1 } }, 'unsupported-algorithm');
  });

  it('rejects malformed containers', async () => {
    const c = JSON.parse((await encrypted()).json);
    await expectDecryptError('not json', 'malformed');
    await expectDecryptError('{}', 'malformed');
    await expectDecryptError({ ...c, ciphertext: '***' }, 'malformed');
    await expectDecryptError({ ...c, cipher: { ...c.cipher, iv: 'AAAA' } }, 'malformed');
    await expectDecryptError({ ...c, kdf: { ...c.kdf, salt: 'AAAA' } }, 'malformed');
    await expectDecryptError({ ...c, ciphertext: 'AAAA' }, 'malformed');
    await expectDecryptError({ ...c, extra: 'field' }, 'malformed');
    await expectDecryptError({ ...c, version: 'one' }, 'malformed');
  });
});
