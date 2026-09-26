/**
 * Converting between in-memory trees and file contents (encrypted or plain JSON).
 */
import { CryptoError, decryptText, encryptText, looksLikeContainer, type SessionKey } from '../crypto/container';
import { validateTreeDocument } from '../model/schema';
import type { FamilyTreeDocument } from '../model/types';

export const ENCRYPTED_EXTENSION = '.ftree';
export const PLAINTEXT_EXTENSION = '.plaintext.json';

/** A problem with the family-tree data itself (as opposed to encryption). */
export class InvalidTreeError extends Error {
  readonly details: string[];
  constructor(message: string, details: string[] = []) {
    super(message);
    this.name = 'InvalidTreeError';
    this.details = details;
  }
}

export function serializeTree(tree: FamilyTreeDocument): string {
  return JSON.stringify(tree, null, 2);
}

export function encryptTree(tree: FamilyTreeDocument, session: SessionKey): Promise<string> {
  return encryptText(serializeTree(tree), session);
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    throw new InvalidTreeError('This file is not valid JSON, so it cannot be a family-tree file.');
  }
}

export type FileKind = 'encrypted' | 'plaintext';

/** Inspects file contents to decide how they should be opened. */
export function detectFileKind(text: string): FileKind {
  const value = parseJson(text);
  if (looksLikeContainer(value)) return 'encrypted';
  if (typeof value === 'object' && value !== null && (value as Record<string, unknown>).format === 'family-tree') {
    return 'plaintext';
  }
  throw new InvalidTreeError('This file is not a family-tree file.');
}

function validated(value: unknown): FamilyTreeDocument {
  const result = validateTreeDocument(value);
  if (!result.ok) {
    throw new InvalidTreeError('The family-tree data in this file is invalid or incomplete.', result.errors);
  }
  return result.tree;
}

export async function openEncryptedTree(
  text: string,
  passphrase: string,
): Promise<{ tree: FamilyTreeDocument; session: SessionKey }> {
  const { text: json, session } = await decryptText(text, passphrase);
  let value: unknown;
  try {
    value = JSON.parse(json);
  } catch {
    // Authenticated but not JSON: produced by something other than this application.
    throw new CryptoError('malformed');
  }
  return { tree: validated(value), session };
}

export function parsePlaintextTree(text: string): FamilyTreeDocument {
  const value = parseJson(text);
  if (looksLikeContainer(value)) {
    throw new InvalidTreeError('This file is encrypted. Use “Open encrypted file” instead.');
  }
  return validated(value);
}

/** A file name that does not reveal anything about the family. */
export function defaultFileName(kind: FileKind, now = new Date()): string {
  const date = now.toISOString().slice(0, 10);
  return kind === 'encrypted' ? `family-tree-${date}${ENCRYPTED_EXTENSION}` : `family-tree-${date}${PLAINTEXT_EXTENSION}`;
}
