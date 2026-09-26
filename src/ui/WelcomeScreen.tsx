import { useEffect, useId, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { createSessionKey, type SessionKey } from '../crypto/container';
import { createEmptyTree } from '../model/tree';
import type { FamilyTreeDocument } from '../model/types';
import { clearDraft, loadDraft, type Draft } from '../storage/drafts';
import { PickerCancelledError, pickOpenFile, readFileText, supportsOpenPicker, type FileHandle } from '../storage/files';
import { gitBlobSha } from '../storage/github';
import { fetchHostedTree } from '../storage/hosted';
import { detectFileKind, ENCRYPTED_EXTENSION, openEncryptedTree, parsePlaintextTree } from '../storage/treeFile';
import { ErrorMessage } from './ErrorMessage';
import { describeError, type UserFacingError } from './errors';
import { FileIcon, LockIcon, PlusIcon, ShieldIcon, TreeIcon } from './icons';
import { ConfirmDialog } from './Modal';
import { EMPTY_NEW_PASSPHRASE, NewPassphraseFields, newPassphraseProblem, type NewPassphraseValue } from './NewPassphraseFields';
import { PassphraseInput } from './PassphraseInput';
import { SecurityInfo } from './SecurityInfo';

export interface OpenedTree {
  tree: FamilyTreeDocument;
  session: SessionKey;
  /** Whether the tree as opened is already saved in an encrypted file. */
  saved: boolean;
  fileHandle?: FileHandle;
  fileName?: string;
  /** True when this is the recovered draft (so the workspace may replace or delete it). */
  fromDraft?: boolean;
  /** Git blob SHA of the encrypted file this tree was opened from, used to detect newer published versions. */
  baseSha?: string;
  /** Opens for viewing, with editing one click away (used for the published tree). */
  readOnly?: boolean;
}

interface Props {
  onOpen: (opened: OpenedTree) => void;
}

type Pending =
  | { kind: 'encrypted-file'; text: string; fileName: string; handle?: FileHandle }
  | { kind: 'plaintext-import'; tree: FamilyTreeDocument; fileName: string };

function Card({ icon, title, children, actions }: { icon: ReactNode; title: string; children: ReactNode; actions?: ReactNode }) {
  const id = useId();
  return (
    <section className="welcome-card" aria-labelledby={id}>
      <h2 id={id}>
        <span className="welcome-card-icon" aria-hidden="true">
          {icon}
        </span>
        {title}
      </h2>
      <div className="welcome-card-body">{children}</div>
      {actions && <div className="welcome-card-actions">{actions}</div>}
    </section>
  );
}

/** Asks for the passphrase of an encrypted container and decrypts it. */
function UnlockForm({
  text,
  submitLabel,
  onUnlocked,
  onCancel,
  autoFocus = true,
}: {
  text: string;
  submitLabel: string;
  onUnlocked: (result: { tree: FamilyTreeDocument; session: SessionKey; sha: string }) => void;
  onCancel?: () => void;
  autoFocus?: boolean;
}) {
  const [passphrase, setPassphrase] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<UserFacingError>();

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!passphrase) {
      setError({ message: 'Enter the passphrase.' });
      return;
    }
    setBusy(true);
    setError(undefined);
    try {
      const result = await openEncryptedTree(text, passphrase);
      const sha = await gitBlobSha(text);
      setPassphrase('');
      onUnlocked({ ...result, sha });
    } catch (e) {
      setError(describeError(e, 'The file could not be opened.'));
      setBusy(false);
    }
  };

  return (
    <form className="stack" onSubmit={submit} aria-busy={busy}>
      <PassphraseInput label="Passphrase" value={passphrase} onChange={setPassphrase} autoComplete="current-password" autoFocus={autoFocus} disabled={busy} />
      <ErrorMessage error={error} />
      <div className="button-row">
        {onCancel && (
          <button type="button" className="button" onClick={onCancel} disabled={busy}>
            Cancel
          </button>
        )}
        <button type="submit" className="button button-primary" disabled={busy}>
          <LockIcon /> {busy ? 'Decrypting…' : submitLabel}
        </button>
      </div>
      {busy && (
        <p className="muted" role="status">
          Decrypting… this deliberately takes a moment to slow down password guessing.
        </p>
      )}
    </form>
  );
}

/** Chooses a new passphrase and derives the key for a new or imported tree. */
function NewTreeForm({
  initialTree,
  onCreated,
  onCancel,
}: {
  initialTree?: FamilyTreeDocument;
  onCreated: (tree: FamilyTreeDocument, session: SessionKey) => void;
  onCancel: () => void;
}) {
  const titleId = useId();
  const [title, setTitle] = useState('');
  const [pass, setPass] = useState<NewPassphraseValue>(EMPTY_NEW_PASSPHRASE);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<UserFacingError>();

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const problem = newPassphraseProblem(pass);
    if (problem) {
      setError({ message: problem });
      return;
    }
    setBusy(true);
    setError(undefined);
    try {
      const session = await createSessionKey(pass.passphrase);
      setPass(EMPTY_NEW_PASSPHRASE);
      onCreated(initialTree ?? createEmptyTree(title), session);
    } catch (e) {
      setError(describeError(e));
      setBusy(false);
    }
  };

  return (
    <form className="stack" onSubmit={submit} noValidate aria-busy={busy}>
      {!initialTree && (
        <div className="field">
          <label htmlFor={titleId} className="field-label">
            Name of the tree
          </label>
          <input
            id={titleId}
            className="input"
            value={title}
            placeholder="e.g. Our family"
            onChange={(e) => setTitle(e.target.value)}
            autoFocus
            autoComplete="off"
            disabled={busy}
          />
          <p className="hint">This name is stored inside the encrypted file, not in its file name.</p>
        </div>
      )}
      <NewPassphraseFields value={pass} onChange={setPass} disabled={busy} />
      <ErrorMessage error={error} />
      <div className="button-row">
        <button type="button" className="button" onClick={onCancel} disabled={busy}>
          Cancel
        </button>
        <button type="submit" className="button button-primary" disabled={busy}>
          {busy ? 'Preparing encryption…' : initialTree ? 'Encrypt and open' : 'Create tree'}
        </button>
      </div>
    </form>
  );
}

export function WelcomeScreen({ onOpen: onOpenTree }: Props) {
  const [draft, setDraft] = useState<Draft>();
  const [confirmReplaceDraft, setConfirmReplaceDraft] = useState<OpenedTree>();
  /** Opening a different tree will eventually replace the recovery copy, so ask first. */
  const onOpen = (opened: OpenedTree) => {
    if (draft && !opened.fromDraft) setConfirmReplaceDraft(opened);
    else onOpenTree(opened);
  };
  const [hosted, setHosted] = useState<string>();
  const [active, setActive] = useState<'none' | 'new' | 'hosted' | 'draft'>('none');
  const [pending, setPending] = useState<Pending>();
  const [fileError, setFileError] = useState<UserFacingError>();
  const [confirmDiscardDraft, setConfirmDiscardDraft] = useState(false);
  const [showSecurity, setShowSecurity] = useState(false);
  const encryptedInput = useRef<HTMLInputElement>(null);
  const plaintextInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let cancelled = false;
    void loadDraft().then((d) => !cancelled && setDraft(d));
    void fetchHostedTree().then((h) => !cancelled && setHosted(h));
    return () => {
      cancelled = true;
    };
  }, []);

  const handleFile = async (file: File, expected: 'encrypted' | 'plaintext', handle?: FileHandle) => {
    setFileError(undefined);
    try {
      const text = await readFileText(file);
      const kind = detectFileKind(text);
      if (kind === 'encrypted') {
        setPending({ kind: 'encrypted-file', text, fileName: file.name, handle });
      } else if (expected === 'encrypted') {
        setFileError({
          message: 'This is an unencrypted backup. Use “Import unencrypted backup” to open it and protect it with a passphrase.',
        });
      } else {
        setPending({ kind: 'plaintext-import', tree: parsePlaintextTree(text), fileName: file.name });
      }
    } catch (e) {
      setFileError(describeError(e, 'The file could not be read.'));
    }
  };

  const openEncrypted = async () => {
    if (supportsOpenPicker()) {
      try {
        const { file, handle } = await pickOpenFile('Encrypted family tree', [ENCRYPTED_EXTENSION]);
        await handleFile(file, 'encrypted', handle);
      } catch (e) {
        if (!(e instanceof PickerCancelledError)) setFileError(describeError(e, 'The file could not be opened.'));
      }
    } else {
      encryptedInput.current?.click();
    }
  };

  const replaceDraftDialog = confirmReplaceDraft && (
    <ConfirmDialog
      title="Replace unsaved work?"
      confirmLabel="Continue"
      danger
      onCancel={() => setConfirmReplaceDraft(undefined)}
      onConfirm={() => onOpenTree(confirmReplaceDraft)}
    >
      <p>
        This device holds an encrypted recovery copy of unsaved changes from{' '}
        {draft ? new Date(draft.savedAt).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' }) : 'an earlier session'}. There is room for only one, so it will be
        replaced as soon as the tree you are opening has unsaved changes (a new or imported tree has them straight away).
      </p>
      <p>To keep it, cancel and choose “Recover unsaved work” first, then save it to a file.</p>
    </ConfirmDialog>
  );

  if (pending?.kind === 'encrypted-file') {
    return (
      <main className="welcome welcome-focused" id="main">
        <Card icon={<LockIcon />} title="Unlock family tree">
          <p className="muted">
            File: <span className="filename">{pending.fileName}</span>
          </p>
          <UnlockForm
            text={pending.text}
            submitLabel="Unlock"
            onCancel={() => setPending(undefined)}
            onUnlocked={({ tree, session, sha }) =>
              onOpen({ tree, session, saved: true, fileHandle: pending.handle, fileName: pending.fileName, baseSha: sha })
            }
          />
        </Card>
        {replaceDraftDialog}
      </main>
    );
  }

  if (pending?.kind === 'plaintext-import') {
    return (
      <main className="welcome welcome-focused" id="main">
        <Card icon={<ShieldIcon />} title="Protect the imported tree">
          <p>
            <strong>{pending.fileName}</strong> contains {pending.tree.people.length} people and is not encrypted. Choose a
            passphrase to encrypt it. Afterwards, consider securely deleting the unencrypted file.
          </p>
          <NewTreeForm
            initialTree={pending.tree}
            onCancel={() => setPending(undefined)}
            onCreated={(tree, session) => onOpen({ tree, session, saved: false })}
          />
        </Card>
        {replaceDraftDialog}
      </main>
    );
  }

  // A form opened from a card replaces the grid with a single focused card.
  if (active === 'new') {
    return (
      <main className="welcome welcome-focused" id="main">
        <Card icon={<PlusIcon />} title="Start a new family tree">
          <NewTreeForm onCancel={() => setActive('none')} onCreated={(tree, session) => onOpen({ tree, session, saved: false })} />
        </Card>
        {replaceDraftDialog}
      </main>
    );
  }

  if (active === 'hosted' && hosted) {
    return (
      <main className="welcome welcome-focused" id="main">
        <Card icon={<TreeIcon />} title="Open the published tree">
          <UnlockForm
            text={hosted}
            submitLabel="Unlock"
            onCancel={() => setActive('none')}
            onUnlocked={({ tree, session, sha }) => onOpen({ tree, session, saved: true, baseSha: sha, readOnly: true })}
          />
        </Card>
        {replaceDraftDialog}
      </main>
    );
  }

  if (active === 'draft' && draft) {
    return (
      <main className="welcome welcome-focused" id="main">
        <Card icon={<LockIcon />} title="Recover unsaved work">
          <p className="muted">Unsaved changes from {new Date(draft.savedAt).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })}</p>
          <UnlockForm
            text={draft.container}
            submitLabel="Recover"
            onCancel={() => setActive('none')}
            onUnlocked={({ tree, session }) => onOpen({ tree, session, saved: false, fromDraft: true })}
          />
        </Card>
      </main>
    );
  }

  return (
    <main className="welcome" id="main">
      <header className="welcome-hero">
        <TreeIcon width={40} height={40} className="welcome-logo" />
        <h1>Family Tree</h1>
        <p className="welcome-tagline">
          A private place for your family’s history. Everything is encrypted in your browser before it is saved — there is no
          server and no account.
        </p>
        <button type="button" className="link-button" onClick={() => setShowSecurity(true)}>
          <ShieldIcon /> How your data is protected
        </button>
      </header>

      <div className="welcome-grid">
        {draft && (
          <Card
            icon={<LockIcon />}
            title="Recover unsaved work"
            actions={
              <>
                <button type="button" className="button button-primary" onClick={() => setActive('draft')}>
                  Recover
                </button>
                <button type="button" className="button" onClick={() => setConfirmDiscardDraft(true)}>
                  Discard
                </button>
              </>
            }
          >
            <p>Encrypted unsaved changes from {new Date(draft.savedAt).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })} are on this device.</p>
          </Card>
        )}

        {hosted && (
          <Card
            icon={<TreeIcon />}
            title="Open the published tree"
            actions={
              <button type="button" className="button button-primary" onClick={() => setActive('hosted')}>
                Unlock
              </button>
            }
          >
            <p>View the encrypted tree published with this website. It opens read-only; you can switch to editing.</p>
          </Card>
        )}

        <Card
          icon={<FileIcon />}
          title="Open an encrypted file"
          actions={
            <button type="button" className="button button-primary" onClick={() => void openEncrypted()}>
              Choose file…
            </button>
          }
        >
          <p>
            Open a <code>{ENCRYPTED_EXTENSION}</code> file you saved earlier.
          </p>
          <input
            ref={encryptedInput}
            type="file"
            accept={`${ENCRYPTED_EXTENSION},application/json`}
            className="visually-hidden"
            tabIndex={-1}
            aria-label="Encrypted family-tree file"
            onChange={(e) => {
              const file = e.target.files?.[0];
              e.target.value = '';
              if (file) void handleFile(file, 'encrypted');
            }}
          />
        </Card>

        <Card
          icon={<PlusIcon />}
          title="Start a new family tree"
          actions={
            <button type="button" className="button button-primary" onClick={() => setActive('new')}>
              New tree
            </button>
          }
        >
          <p>Create an empty tree protected by a passphrase you choose.</p>
        </Card>

        <Card
          icon={<FileIcon />}
          title="Import a backup"
          actions={
            <button type="button" className="button button-primary" onClick={() => plaintextInput.current?.click()}>
              Choose file…
            </button>
          }
        >
          <p>
            Open an unencrypted <code>.json</code> export and protect it with a passphrase.
          </p>
          <input
            ref={plaintextInput}
            type="file"
            accept=".json,application/json"
            className="visually-hidden"
            tabIndex={-1}
            aria-label="Unencrypted family-tree backup"
            onChange={(e) => {
              const file = e.target.files?.[0];
              e.target.value = '';
              if (file) void handleFile(file, 'plaintext');
            }}
          />
        </Card>
      </div>

      <div className="welcome-error">
        <ErrorMessage error={fileError} />
      </div>

      {confirmDiscardDraft && (
        <ConfirmDialog
          title="Discard unsaved work?"
          confirmLabel="Discard"
          danger
          onCancel={() => setConfirmDiscardDraft(false)}
          onConfirm={() => {
            setConfirmDiscardDraft(false);
            void clearDraft().then(() => setDraft(undefined));
          }}
        >
          <p>The recovery copy of your unsaved changes will be permanently deleted from this device.</p>
        </ConfirmDialog>
      )}
      {showSecurity && <SecurityInfo onClose={() => setShowSecurity(false)} />}
      {replaceDraftDialog}
    </main>
  );
}
