import { MIN_PASSPHRASE_LENGTH } from '../crypto/container';

/**
 * Minimum requirements for a new passphrase. These are deliberately simple and
 * explainable; they cannot guarantee strength, so the UI also recommends (and
 * can generate) several random words.
 */
export function passphraseWeakness(passphrase: string): string | undefined {
  if (passphrase.length < MIN_PASSPHRASE_LENGTH) {
    return `The passphrase must be at least ${MIN_PASSPHRASE_LENGTH} characters long.`;
  }
  if (new Set(passphrase.toLowerCase()).size < 6) {
    return 'The passphrase is too repetitive. Try several unrelated words.';
  }
  const words = passphrase.split(/[\s\-_.,]+/).filter((w) => w.length >= 3);
  if (words.length < 4 && passphrase.length < 16) {
    return 'Use at least four words (for example “harbour lantern violet oatmeal”), or at least 16 characters.';
  }
  return undefined;
}
