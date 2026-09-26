#!/usr/bin/env node
/**
 * Stand-alone recovery tool: decrypts a .ftree file without the web application.
 *
 *   node scripts/decrypt.mjs family-tree.ftree > family-tree.plaintext.json
 *
 * It implements the documented container format (docs/DATA_FORMAT.md) using only
 * Node's built-in Web Crypto API, and asks for the passphrase on the terminal
 * (it is never accepted as a command-line argument, which would end up in shell history).
 * The output is UNENCRYPTED — store it carefully.
 */
import { readFileSync } from 'node:fs';
import { webcrypto as crypto } from 'node:crypto';
import { createInterface } from 'node:readline';

function askPassphrase() {
  return new Promise((resolve) => {
    const rl = createInterface({ input: process.stdin, output: process.stderr, terminal: true });
    rl._writeToOutput = (s) => {
      if (s.includes('Passphrase')) process.stderr.write(s);
    };
    rl.question('Passphrase: ', (answer) => {
      rl.close();
      process.stderr.write('\n');
      resolve(answer);
    });
  });
}

function b64(s) {
  if (typeof s !== 'string' || !/^[A-Za-z0-9+/]*={0,2}$/.test(s) || s.length % 4 !== 0) throw new Error('The file is malformed (invalid base64).');
  return Uint8Array.from(Buffer.from(s, 'base64'));
}

async function main() {
  const [path] = process.argv.slice(2);
  if (!path) {
    console.error('Usage: node scripts/decrypt.mjs <file.ftree> > output.plaintext.json');
    process.exit(2);
  }
  const c = JSON.parse(readFileSync(path, 'utf8'));
  if (c.format !== 'family-tree-encrypted' || c.version !== 1) throw new Error('Unsupported file format or version.');
  if (c.kdf?.name !== 'PBKDF2' || c.kdf.hash !== 'SHA-256' || c.cipher?.name !== 'AES-GCM' || c.cipher.keyBits !== 256 || c.cipher.tagBits !== 128) {
    throw new Error('Unsupported algorithms.');
  }
  if (!Number.isInteger(c.kdf.iterations) || c.kdf.iterations < 310_000 || c.kdf.iterations > 10_000_000) {
    throw new Error('Unsupported key-derivation iteration count.');
  }
  if (b64(c.kdf.salt).length < 16 || b64(c.cipher.iv).length !== 12 || b64(c.ciphertext).length < 16) {
    throw new Error('The file is malformed.');
  }

  const passphrase = await askPassphrase();
  const material = await crypto.subtle.importKey('raw', new TextEncoder().encode(passphrase.normalize('NFC')), 'PBKDF2', false, ['deriveKey']);
  const key = await crypto.subtle.deriveKey(
    { name: 'PBKDF2', hash: 'SHA-256', salt: b64(c.kdf.salt), iterations: c.kdf.iterations },
    material,
    { name: 'AES-GCM', length: 256 },
    false,
    ['decrypt'],
  );
  const aad = new TextEncoder().encode(
    JSON.stringify([c.format, c.version, c.kdf.name, c.kdf.hash, c.kdf.iterations, c.kdf.salt, c.cipher.name, c.cipher.keyBits, c.cipher.iv, c.cipher.tagBits]),
  );
  let plaintext;
  try {
    plaintext = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: b64(c.cipher.iv), additionalData: aad, tagLength: c.cipher.tagBits },
      key,
      b64(c.ciphertext),
    );
  } catch {
    throw new Error('Could not decrypt: check the passphrase. If it is correct, the file may be damaged or modified.');
  }
  process.stdout.write(new TextDecoder('utf-8', { fatal: true }).decode(plaintext));
  process.stdout.write('\n');
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
