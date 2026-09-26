// @vitest-environment node
/**
 * The stand-alone recovery script must decrypt files produced by the app,
 * proving the documented format can be read without the web application.
 */
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { createSessionKey } from '../crypto/container';
import { encryptTree } from '../storage/treeFile';
import { complexFamily } from './fixtures';

const dir = mkdtempSync(join(tmpdir(), 'family-tree-'));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

describe('scripts/decrypt.mjs', () => {
  it('recovers the tree with the right passphrase and refuses a wrong one', async () => {
    const { tree } = complexFamily();
    const file = join(dir, 'tree.ftree');
    writeFileSync(file, await encryptTree(tree, await createSessionKey('harbour lantern violet oatmeal')));

    const ok = spawnSync(process.execPath, ['scripts/decrypt.mjs', file], { input: 'harbour lantern violet oatmeal\n', encoding: 'utf8' });
    expect(ok.status).toBe(0);
    expect(JSON.parse(ok.stdout)).toEqual(tree);

    const bad = spawnSync(process.execPath, ['scripts/decrypt.mjs', file], { input: 'wrong\n', encoding: 'utf8' });
    expect(bad.status).toBe(1);
    expect(bad.stdout).toBe('');
    expect(bad.stderr).toMatch(/Could not decrypt/);
  });
});
