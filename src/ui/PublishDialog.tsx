import { useId, useState, type FormEvent } from 'react';
import { parseRepository, type GitHubTarget } from '../storage/github';
import { ErrorMessage } from './ErrorMessage';
import { describeError, type UserFacingError } from './errors';
import { Modal } from './Modal';
import { PassphraseInput } from './PassphraseInput';

export type PublishOutcome = { status: 'published'; target: GitHubTarget } | { status: 'conflict' };

interface Props {
  initialTarget: Partial<GitHubTarget> & { path: string };
  /** A token entered earlier in this session, if any. */
  sessionToken?: string;
  /** Encrypts and commits the tree. With `replace`, overwrites a newer published version. */
  onPublish: (target: GitHubTarget, token: string, replace: boolean) => Promise<PublishOutcome>;
  onClose: () => void;
}

const TOKEN_URL = 'https://github.com/settings/personal-access-tokens/new';

export function PublishDialog({ initialTarget, sessionToken, onPublish, onClose }: Props) {
  const formId = useId();
  const [repository, setRepository] = useState(
    initialTarget.owner && initialTarget.repo ? `${initialTarget.owner}/${initialTarget.repo}` : '',
  );
  const [branch, setBranch] = useState(initialTarget.branch ?? 'main');
  const [useSessionToken, setUseSessionToken] = useState(!!sessionToken);
  const [token, setToken] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<UserFacingError>();
  const [conflict, setConflict] = useState(false);
  const [published, setPublished] = useState<GitHubTarget>();

  const publish = async (replace: boolean) => {
    const parsed = parseRepository(repository);
    if (!parsed) {
      setError({ message: 'Enter the repository as owner/name, for example “your-name/family-tree”.' });
      return;
    }
    const activeToken = useSessionToken && sessionToken ? sessionToken : token.trim();
    if (!activeToken) {
      setError({ message: 'Paste your GitHub access token.' });
      return;
    }
    if (!branch.trim()) {
      setError({ message: 'Enter the branch to publish to.' });
      return;
    }
    setBusy(true);
    setError(undefined);
    try {
      const outcome = await onPublish({ ...parsed, branch: branch.trim(), path: initialTarget.path }, activeToken, replace);
      if (outcome.status === 'conflict') setConflict(true);
      else {
        setToken('');
        setPublished(outcome.target);
      }
    } catch (e) {
      setError(describeError(e, 'The tree could not be published.'));
    } finally {
      setBusy(false);
    }
  };

  const submit = (event: FormEvent) => {
    event.preventDefault();
    void publish(false);
  };

  if (published) {
    const actions = `https://github.com/${published.owner}/${published.repo}/actions`;
    return (
      <Modal
        title="Published"
        onClose={onClose}
        size="small"
        footer={
          <button type="button" className="button button-primary" onClick={onClose} data-autofocus>
            Done
          </button>
        }
      >
        <p role="status">The encrypted tree was committed to {published.owner}/{published.repo}.</p>
        <p>
          The website updates once the deploy finishes, usually within a few minutes. You can follow it on the{' '}
          <a href={actions} target="_blank" rel="noopener noreferrer">
            repository’s Actions page
          </a>
          .
        </p>
      </Modal>
    );
  }

  return (
    <Modal
      title="Publish to website"
      onClose={onClose}
      busy={busy}
      footer={
        conflict ? (
          <>
            <button type="button" className="button" onClick={onClose} disabled={busy}>
              Cancel
            </button>
            <button type="button" className="button button-danger" onClick={() => void publish(true)} disabled={busy}>
              {busy ? 'Publishing…' : 'Replace published tree'}
            </button>
          </>
        ) : (
          <>
            <button type="button" className="button" onClick={onClose} disabled={busy}>
              Cancel
            </button>
            <button type="submit" form={formId} className="button button-primary" disabled={busy}>
              {busy ? 'Encrypting and publishing…' : 'Publish'}
            </button>
          </>
        )
      }
    >
      {conflict ? (
        <div className="stack" role="alert">
          <p>
            <strong>The website already has a different version of the tree</strong> — for example one published from another
            device, or one newer than the copy you opened.
          </p>
          <p>
            Publishing now replaces it with the tree you have open. The replaced version remains in the repository’s history. To
            keep its changes instead, cancel, then open the tree from the website once its deploy has finished.
          </p>
          <ErrorMessage error={error} />
        </div>
      ) : (
        <form id={formId} className="stack" onSubmit={submit} noValidate aria-busy={busy}>
          <p>
            The tree is encrypted with your passphrase and committed to the repository as <code>{initialTarget.path}</code>.
            Anyone you give the passphrase to can then open it from the website. Only the encrypted file is uploaded.
          </p>
          <div className="field-grid">
            <div className="field">
              <label className="field-label" htmlFor={`${formId}-repo`}>
                Repository
              </label>
              <input
                id={`${formId}-repo`}
                className="input"
                value={repository}
                placeholder="owner/name"
                autoComplete="off"
                spellCheck={false}
                disabled={busy}
                onChange={(e) => setRepository(e.target.value)}
              />
            </div>
            <div className="field">
              <label className="field-label" htmlFor={`${formId}-branch`}>
                Branch
              </label>
              <input
                id={`${formId}-branch`}
                className="input"
                value={branch}
                autoComplete="off"
                spellCheck={false}
                disabled={busy}
                onChange={(e) => setBranch(e.target.value)}
              />
            </div>
          </div>

          {useSessionToken && sessionToken ? (
            <p>
              Using the access token you entered earlier in this session.{' '}
              <button type="button" className="link-button" onClick={() => setUseSessionToken(false)} disabled={busy}>
                Use a different token
              </button>
            </p>
          ) : (
            <>
              <PassphraseInput
                label="GitHub access token"
                value={token}
                onChange={setToken}
                autoComplete="off"
                autoFocus
                disabled={busy}
              />
              <div className="hint">
                <p>
                  Create a{' '}
                  <a href={TOKEN_URL} target="_blank" rel="noopener noreferrer">
                    fine-grained personal access token
                  </a>{' '}
                  with <strong>Repository access: Only select repositories</strong> (this repository only) and{' '}
                  <strong>Permissions → Contents: Read and write</strong>. Nothing else is needed.
                </p>
                <p>
                  The token is kept only in memory until you lock the tree, and is sent only to GitHub. Anyone with it can change
                  this repository, so never share it.
                </p>
              </div>
            </>
          )}
          <ErrorMessage error={error} />
        </form>
      )}
    </Modal>
  );
}
