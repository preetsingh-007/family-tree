import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent, { type UserEvent } from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createSessionKey } from '../crypto/container';
import { clearDraft } from '../storage/drafts';
import { PUBLISH_PATH } from '../storage/github';
import { encryptTree, openEncryptedTree } from '../storage/treeFile';
import { complexFamily } from '../test/fixtures';
import { installFakeGitHub } from '../test/githubMock';
import { addPersonViaForm, createTree, PASSPHRASE, peopleList, useWideViewport } from '../test/ui';
import { App } from './App';

const TOKEN = 'github_pat_TEST_TOKEN_VALUE';

beforeEach(async () => {
  useWideViewport();
  await clearDraft();
});
afterEach(() => vi.restoreAllMocks());

async function openPublishDialog(user: UserEvent) {
  await user.click(screen.getByRole('button', { name: 'More actions' }));
  await user.click(screen.getByRole('menuitem', { name: /Publish to website/ }));
  return screen.findByRole('dialog', { name: 'Publish to website' });
}

async function fillAndPublish(user: UserEvent, dialog: HTMLElement) {
  await user.type(within(dialog).getByLabelText('Repository'), 'someone/family-tree');
  await user.type(within(dialog).getByLabelText('GitHub access token', { selector: 'input' }), TOKEN);
  await user.click(within(dialog).getByRole('button', { name: 'Publish' }));
}

describe('publishing to GitHub', () => {
  it('commits only the encrypted tree and reuses the token for the session', async () => {
    const fake = installFakeGitHub();
    const user = userEvent.setup();
    render(<App />);
    await createTree(user, 'Published family');
    await addPersonViaForm(user, 'Wilhelmina', 'Secretson');

    await fillAndPublish(user, await openPublishDialog(user));
    await screen.findByRole('dialog', { name: 'Published' }, { timeout: 10_000 });

    const committed = fake.files.get(PUBLISH_PATH)!;
    expect(JSON.parse(committed).format).toBe('family-tree-encrypted');
    expect(committed).not.toContain('Wilhelmina');
    expect((await openEncryptedTree(committed, PASSPHRASE)).tree.people[0]!.givenNames).toBe('Wilhelmina');
    // The token went only to GitHub's API.
    for (const r of fake.requests.filter((req) => req.headers?.Authorization)) {
      expect(r.url.startsWith('https://api.github.com/')).toBe(true);
    }

    await user.click(screen.getByRole('button', { name: 'Done' }));
    expect(screen.getAllByText(/^Published/).length).toBeGreaterThan(0);
    expect(screen.queryAllByText(/Unsaved changes/)).toHaveLength(0);

    // Publishing again in the same session needs no token and no conflict confirmation.
    await addPersonViaForm(user, 'Second', 'Person');
    const again = await openPublishDialog(user);
    expect(within(again).getByText(/Using the access token you entered earlier/)).toBeInTheDocument();
    await user.click(within(again).getByRole('button', { name: 'Publish' }));
    await screen.findByRole('dialog', { name: 'Published' }, { timeout: 10_000 });
    expect((await openEncryptedTree(fake.files.get(PUBLISH_PATH)!, PASSPHRASE)).tree.people).toHaveLength(2);
  });

  it('asks before replacing a different published version', async () => {
    const fake = installFakeGitHub();
    const other = await encryptTree(complexFamily().tree, await createSessionKey(PASSPHRASE));
    fake.files.set(PUBLISH_PATH, other);
    const user = userEvent.setup();
    render(<App />);
    await createTree(user);
    await addPersonViaForm(user, 'New', 'Version');

    const dialog = await openPublishDialog(user);
    await fillAndPublish(user, dialog);
    expect(await within(dialog).findByText(/already has a different version/, {}, { timeout: 10_000 })).toBeInTheDocument();
    expect(fake.files.get(PUBLISH_PATH)).toBe(other);

    await user.click(within(dialog).getByRole('button', { name: 'Replace published tree' }));
    await screen.findByRole('dialog', { name: 'Published' }, { timeout: 10_000 });
    expect((await openEncryptedTree(fake.files.get(PUBLISH_PATH)!, PASSPHRASE)).tree.people[0]!.givenNames).toBe('New');
  });

  it('republishes a tree opened from the website without a conflict', async () => {
    const fake = installFakeGitHub();
    fake.files.set(PUBLISH_PATH, await encryptTree(complexFamily().tree, await createSessionKey(PASSPHRASE)));
    const user = userEvent.setup();
    render(<App />);
    const card = await screen.findByRole('region', { name: 'Open the published tree' });
    await user.click(within(card).getByRole('button', { name: 'Unlock' }));
    await user.type(screen.getByLabelText('Passphrase', { selector: 'input' }), PASSPHRASE);
    await user.click(screen.getByRole('button', { name: /Unlock/ }));
    await screen.findByRole('button', { name: 'More actions' }, { timeout: 10_000 });
    expect(within(peopleList()).getByRole('button', { name: /^Arthur Testfield/ })).toBeInTheDocument();

    await addPersonViaForm(user, 'Added', 'Later');
    await fillAndPublish(user, await openPublishDialog(user));
    await screen.findByRole('dialog', { name: 'Published' }, { timeout: 10_000 });
    expect((await openEncryptedTree(fake.files.get(PUBLISH_PATH)!, PASSPHRASE)).tree.people).toHaveLength(10);
  });

  it('explains a rejected token', async () => {
    const fake = installFakeGitHub();
    fake.failWith = 401;
    const user = userEvent.setup();
    render(<App />);
    await createTree(user);
    const dialog = await openPublishDialog(user);
    await fillAndPublish(user, dialog);
    const alert = await within(dialog).findByRole('alert');
    expect(alert).toHaveTextContent(/rejected the token/);
    expect(alert).not.toHaveTextContent(TOKEN);
    await waitFor(() => expect(within(dialog).getByRole('button', { name: 'Publish' })).toBeEnabled());
  });
});
