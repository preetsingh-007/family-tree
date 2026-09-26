import { describe, expect, it } from 'vitest';
import { createSessionKey, CryptoError, encryptText } from '../crypto/container';
import { complexFamily } from '../test/fixtures';
import { defaultFileName, detectFileKind, encryptTree, InvalidTreeError, openEncryptedTree, parsePlaintextTree, serializeTree } from './treeFile';

const PASSPHRASE = 'harbour lantern violet oatmeal';

describe('tree files', () => {
  it('encrypts and reopens a whole tree', async () => {
    const { tree } = complexFamily();
    const session = await createSessionKey(PASSPHRASE);
    const file = await encryptTree(tree, session);
    expect(detectFileKind(file)).toBe('encrypted');
    for (const word of ['Testfield', 'Beatrice', 'Exampleton', 'Newbury']) expect(file).not.toContain(word);
    const opened = await openEncryptedTree(file, PASSPHRASE);
    expect(opened.tree).toEqual(tree);
  });

  it('validates the decrypted content', async () => {
    const session = await createSessionKey(PASSPHRASE);
    const broken = JSON.parse(serializeTree(complexFamily().tree));
    broken.parentLinks[0].parentId = 'ghost';
    const file = await encryptText(JSON.stringify(broken), session);
    await expect(openEncryptedTree(file, PASSPHRASE)).rejects.toBeInstanceOf(InvalidTreeError);
    const notJson = await encryptText('hello', session);
    await expect(openEncryptedTree(notJson, PASSPHRASE)).rejects.toBeInstanceOf(CryptoError);
  });

  it('parses plaintext backups and refuses to treat encrypted files as plaintext', async () => {
    const { tree } = complexFamily();
    expect(parsePlaintextTree(serializeTree(tree))).toEqual(tree);
    expect(detectFileKind(serializeTree(tree))).toBe('plaintext');
    const encrypted = await encryptTree(tree, await createSessionKey(PASSPHRASE));
    expect(() => parsePlaintextTree(encrypted)).toThrow(InvalidTreeError);
  });

  it('rejects files that are not family trees', () => {
    expect(() => detectFileKind('not json')).toThrow(InvalidTreeError);
    expect(() => detectFileKind('{"hello": 1}')).toThrow(InvalidTreeError);
    expect(() => parsePlaintextTree('{"format":"family-tree","version":1}')).toThrow(InvalidTreeError);
  });

  it('uses file names that reveal nothing about the family', () => {
    const now = new Date('2026-01-02T03:04:05Z');
    expect(defaultFileName('encrypted', now)).toBe('family-tree-2026-01-02.ftree');
    expect(defaultFileName('plaintext', now)).toBe('family-tree-2026-01-02.plaintext.json');
  });
});
