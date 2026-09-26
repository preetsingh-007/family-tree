/**
 * Random passphrase suggestions using the EFF large Diceware wordlist
 * (7,776 words, ≈12.9 bits per word; six words ≈ 77 bits).
 *
 * Wordlist: Electronic Frontier Foundation, https://www.eff.org/dice
 * (Creative Commons Attribution 3.0 US). Loaded lazily so it is only
 * downloaded when a suggestion is requested.
 */

export const SUGGESTED_WORD_COUNT = 6;

/** Uniform random integer in [0, max) from the platform CSPRNG (rejection sampling, no modulo bias). */
export function randomIndex(max: number): number {
  const limit = Math.floor(0x1_0000_0000 / max) * max;
  const buffer = new Uint32Array(1);
  for (;;) {
    crypto.getRandomValues(buffer);
    if (buffer[0]! < limit) return buffer[0]! % max;
  }
}

export function pickWords(words: readonly string[], count: number): string[] {
  return Array.from({ length: count }, () => words[randomIndex(words.length)]!);
}

export async function loadWordlist(): Promise<string[]> {
  const { default: list } = await import('./eff_large_wordlist.txt?raw');
  return list.split('\n').filter(Boolean);
}

export async function suggestPassphrase(count = SUGGESTED_WORD_COUNT): Promise<string> {
  return pickWords(await loadWordlist(), count).join(' ');
}
