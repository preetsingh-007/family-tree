import { render, screen, within } from '@testing-library/react';
import userEvent, { type UserEvent } from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';
import { createSessionKey } from '../crypto/container';
import { clearDraft } from '../storage/drafts';
import { PUBLISH_PATH } from '../storage/github';
import { encryptTree } from '../storage/treeFile';
import { complexFamily } from '../test/fixtures';
import { installFakeGitHub } from '../test/githubMock';
import { PASSPHRASE, peopleList, personPanel, useWideViewport } from '../test/ui';
import { App } from './App';
import { PANE_LIMITS } from './panes';

const STORAGE_KEY = 'family-tree.ui.panes.v1';
const EDITING_LAYOUT = {
  left: { width: PANE_LIMITS.left.default + 50, collapsed: false },
  right: { width: PANE_LIMITS.right.default, collapsed: false },
};

beforeEach(async () => {
  useWideViewport();
  localStorage.setItem(STORAGE_KEY, JSON.stringify(EDITING_LAYOUT));
  await clearDraft();
});

async function openPublished(user: UserEvent) {
  const fake = installFakeGitHub();
  fake.files.set(PUBLISH_PATH, await encryptTree(complexFamily().tree, await createSessionKey(PASSPHRASE)));
  render(<App />);
  const card = await screen.findByRole('region', { name: 'Open the published tree' });
  await user.click(within(card).getByRole('button', { name: 'Unlock' }));
  await user.type(screen.getByLabelText('Passphrase', { selector: 'input' }), PASSPHRASE);
  await user.click(screen.getByRole('button', { name: /Unlock/ }));
  await screen.findByText('View only', {}, { timeout: 10_000 });
}

describe('the published tree', () => {
  it('opens view-only with both side panes collapsed', async () => {
    const user = userEvent.setup();
    await openPublished(user);

    expect(screen.queryByRole('region', { name: 'People' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Show people ([)' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Show person (])' })).toBeInTheDocument();
    for (const name of ['Save', /^Undo/, /^Redo/]) expect(screen.queryByRole('button', { name })).not.toBeInTheDocument();

    // People and details can still be browsed, without any editing controls.
    await user.click(screen.getByRole('button', { name: 'Show people ([)' }));
    expect(screen.queryByRole('button', { name: /Add person/ })).not.toBeInTheDocument();
    await user.click(within(peopleList()).getByRole('button', { name: /^Arthur Testfield/ }));
    const details = personPanel();
    expect(within(details).getByRole('heading', { level: 2, name: 'Arthur Testfield' })).toBeInTheDocument();
    for (const name of ['Edit', 'Delete', /Add relative/, /^Edit relationship/, /^Edit partnership/, /Add photo/]) {
      expect(within(details).queryByRole('button', { name })).not.toBeInTheDocument();
    }
    expect(within(details).getByRole('button', { name: /Show in tree/ })).toBeInTheDocument();

    // Browsing never overwrites the layout remembered for editing.
    expect(JSON.parse(localStorage.getItem(STORAGE_KEY)!)).toEqual(EDITING_LAYOUT);
  });

  it('switches to editing with the remembered layout', async () => {
    const user = userEvent.setup();
    await openPublished(user);
    await user.click(screen.getByRole('button', { name: 'Edit' }));

    expect(screen.queryByText('View only')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Save/ })).toBeInTheDocument();
    expect(screen.getByRole('separator', { name: 'Resize people list' })).toHaveAttribute('aria-valuenow', String(EDITING_LAYOUT.left.width));
    await user.click(within(peopleList()).getByRole('button', { name: /^Arthur Testfield/ }));
    expect(within(personPanel()).getByRole('button', { name: 'Edit' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Add person/ })).toBeInTheDocument();
  });
});
