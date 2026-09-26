import { useId, useState } from 'react';
import { MIN_PASSPHRASE_LENGTH } from '../crypto/container';
import { suggestPassphrase } from '../passphrase/generate';
import { passphraseWeakness } from '../passphrase/policy';
import { PassphraseInput } from './PassphraseInput';

export interface NewPassphraseValue {
  passphrase: string;
  confirm: string;
  acknowledged: boolean;
}

export const EMPTY_NEW_PASSPHRASE: NewPassphraseValue = { passphrase: '', confirm: '', acknowledged: false };

/** Returns a problem with the chosen passphrase, or undefined when it is acceptable. */
export function newPassphraseProblem(value: NewPassphraseValue): string | undefined {
  const weakness = passphraseWeakness(value.passphrase);
  if (weakness) return weakness;
  if (value.passphrase !== value.confirm) return 'The two passphrases do not match.';
  if (!value.acknowledged) return 'Please confirm that you understand the passphrase cannot be recovered.';
  return undefined;
}

export function NewPassphraseFields({
  value,
  onChange,
  disabled,
}: {
  value: NewPassphraseValue;
  onChange: (value: NewPassphraseValue) => void;
  disabled?: boolean;
}) {
  const hintId = useId();
  const [suggestion, setSuggestion] = useState<string>();
  const length = value.passphrase.length;

  const suggest = async () => {
    const passphrase = await suggestPassphrase();
    setSuggestion(passphrase);
    onChange({ ...value, passphrase, confirm: passphrase });
  };

  return (
    <>
      <PassphraseInput
        label="Passphrase"
        value={value.passphrase}
        onChange={(passphrase) => onChange({ ...value, passphrase })}
        autoComplete="new-password"
        describedBy={hintId}
        disabled={disabled}
      />
      <p className="hint" id={hintId}>
        At least {MIN_PASSPHRASE_LENGTH} characters ({length} so far). A good choice is five or more random, unrelated words.
        Anyone who obtains your file can try to guess it offline, so avoid names, birthdays, and quotations — especially if
        the file will be published with the website.
      </p>
      <div>
        <button type="button" className="button button-small" onClick={() => void suggest()} disabled={disabled}>
          Suggest a random passphrase
        </button>
      </div>
      {suggestion && suggestion === value.passphrase && (
        <p className="suggestion" role="status">
          Suggested passphrase: <strong className="suggestion-text">{suggestion}</strong>
          <br />
          Write it down or store it in a password manager before continuing.
        </p>
      )}
      <PassphraseInput
        label="Repeat passphrase"
        value={value.confirm}
        onChange={(confirm) => onChange({ ...value, confirm })}
        autoComplete="new-password"
        invalid={value.confirm.length > 0 && value.confirm !== value.passphrase}
        disabled={disabled}
      />
      <label className="checkbox">
        <input
          type="checkbox"
          checked={value.acknowledged}
          disabled={disabled}
          onChange={(e) => onChange({ ...value, acknowledged: e.target.checked })}
        />
        <span>
          I understand that the passphrase <strong>cannot be recovered or reset</strong>. If I forget it, the encrypted family
          tree cannot be opened by anyone, including me.
        </span>
      </label>
    </>
  );
}
