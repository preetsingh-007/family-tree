import { describe, expect, it } from 'vitest';
import { loadWordlist, pickWords, randomIndex, suggestPassphrase, SUGGESTED_WORD_COUNT } from './generate';
import { passphraseWeakness } from './policy';

describe('passphrase policy', () => {
  it.each(['short', 'aaaaaaaaaaaaaaaa', 'Smith1950!!!', 'password1234'])('rejects %s', (p) => {
    expect(passphraseWeakness(p)).toBeDefined();
  });

  it.each(['harbour lantern violet oatmeal', 'a-much-longer-single-phrase', 'Tr0ub4dor&3-horse-x'])('accepts %s', (p) => {
    expect(passphraseWeakness(p)).toBeUndefined();
  });
});

describe('passphrase suggestions', () => {
  it('uses the full 7,776-word EFF list', async () => {
    const words = await loadWordlist();
    expect(words).toHaveLength(7776);
    expect(new Set(words).size).toBe(7776);
  });

  it('suggests acceptable, different passphrases', async () => {
    const a = await suggestPassphrase();
    const b = await suggestPassphrase();
    expect(a.split(' ')).toHaveLength(SUGGESTED_WORD_COUNT);
    expect(a).not.toBe(b);
    expect(passphraseWeakness(a)).toBeUndefined();
  });

  it('draws indexes uniformly within range', () => {
    const counts = new Array(6).fill(0);
    for (let i = 0; i < 6000; i++) counts[randomIndex(6)]++;
    for (const c of counts) expect(c).toBeGreaterThan(800);
    expect(pickWords(['only'], 3)).toEqual(['only', 'only', 'only']);
  });
});
