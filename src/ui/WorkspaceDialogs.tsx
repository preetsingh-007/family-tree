import { useId, useState, type FormEvent } from 'react';
import { createSessionKey, type SessionKey } from '../crypto/container';
import type { FamilyTreeDocument } from '../model/types';
import { ErrorMessage } from './ErrorMessage';
import { describeError, type UserFacingError } from './errors';
import { MarkdownEditor } from './MarkdownEditor';
import { Modal } from './Modal';
import { EMPTY_NEW_PASSPHRASE, NewPassphraseFields, newPassphraseProblem, type NewPassphraseValue } from './NewPassphraseFields';

export function ChangePassphraseDialog({ onChanged, onClose }: { onChanged: (session: SessionKey) => void; onClose: () => void }) {
  const formId = useId();
  const [value, setValue] = useState<NewPassphraseValue>(EMPTY_NEW_PASSPHRASE);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<UserFacingError>();

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const problem = newPassphraseProblem(value);
    if (problem) {
      setError({ message: problem });
      return;
    }
    setBusy(true);
    try {
      const session = await createSessionKey(value.passphrase);
      setValue(EMPTY_NEW_PASSPHRASE);
      onChanged(session);
    } catch (e) {
      setError(describeError(e));
      setBusy(false);
    }
  };

  return (
    <Modal
      title="Change passphrase"
      onClose={onClose}
      busy={busy}
      footer={
        <>
          <button type="button" className="button" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button type="submit" form={formId} className="button button-primary" disabled={busy}>
            {busy ? 'Preparing encryption…' : 'Change passphrase'}
          </button>
        </>
      }
    >
      <form id={formId} className="stack" onSubmit={submit} noValidate>
        <p>
          The new passphrase applies the next time you save. Files you saved earlier keep their old passphrase — delete or
          replace them if the old passphrase may be known to others.
        </p>
        <NewPassphraseFields value={value} onChange={setValue} disabled={busy} />
        <ErrorMessage error={error} />
      </form>
    </Modal>
  );
}

export function TreeSettingsDialog({
  tree,
  onSave,
  onClose,
}: {
  tree: FamilyTreeDocument;
  onSave: (title: string, notes: string) => void;
  onClose: () => void;
}) {
  const formId = useId();
  const [title, setTitle] = useState(tree.title);
  const [notes, setNotes] = useState(tree.notes);
  return (
    <Modal
      title="Tree name and notes"
      onClose={onClose}
      size="large"
      footer={
        <>
          <button type="button" className="button" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" form={formId} className="button button-primary">
            Save
          </button>
        </>
      }
    >
      <form
        id={formId}
        className="stack"
        onSubmit={(e) => {
          e.preventDefault();
          onSave(title.trim() || tree.title, notes);
        }}
      >
        <div className="field">
          <label className="field-label" htmlFor={`${formId}-title`}>
            Name of the tree
          </label>
          <input id={`${formId}-title`} className="input" value={title} onChange={(e) => setTitle(e.target.value)} data-autofocus />
        </div>
        <MarkdownEditor
          label="Family notes"
          value={notes}
          onChange={setNotes}
          rows={12}
          placeholder="Family history, sources, research notes, stories…"
        />
      </form>
    </Modal>
  );
}
