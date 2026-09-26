import { useId, useState } from 'react';

interface Props {
  label: string;
  value: string;
  onChange: (value: string) => void;
  autoComplete: 'current-password' | 'new-password';
  autoFocus?: boolean;
  describedBy?: string;
  invalid?: boolean;
  disabled?: boolean;
}

export function PassphraseInput({ label, value, onChange, autoComplete, autoFocus, describedBy, invalid, disabled }: Props) {
  const id = useId();
  const [visible, setVisible] = useState(false);
  return (
    <div className="field">
      <label htmlFor={id} className="field-label">
        {label}
      </label>
      <div className="passphrase-row">
        <input
          id={id}
          className="input"
          type={visible ? 'text' : 'password'}
          value={value}
          autoComplete={autoComplete}
          autoCapitalize="off"
          autoCorrect="off"
          spellCheck={false}
          autoFocus={autoFocus}
          data-autofocus={autoFocus || undefined}
          aria-describedby={describedBy}
          aria-invalid={invalid || undefined}
          disabled={disabled}
          onChange={(e) => onChange(e.target.value)}
        />
        <button
          type="button"
          className="button button-small"
          aria-pressed={visible}
          aria-label={visible ? `Hide ${label.toLowerCase()}` : `Show ${label.toLowerCase()}`}
          onClick={() => setVisible((v) => !v)}
          disabled={disabled}
        >
          {visible ? 'Hide' : 'Show'}
        </button>
      </div>
    </div>
  );
}
