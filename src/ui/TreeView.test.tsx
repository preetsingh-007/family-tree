import { render, screen, within } from '@testing-library/react';
import userEvent, { type UserEvent } from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';
import { clearDraft } from '../storage/drafts';
import { addPersonViaForm, addRelative, createTree, personPanel, useWideViewport } from '../test/ui';
import { App } from './App';

beforeEach(async () => {
  useWideViewport();
  await clearDraft();
});

const diagram = () => screen.getByRole('group', { name: 'Family tree' });
const treeNode = (name: string) => within(diagram()).queryByRole('button', { name: new RegExp(`^${name},|^${name}$`) });

/** Adds a child to the person shown in the details panel, then moves the details panel (not the tree) to that child. */
async function addChildAndGoToIt(user: UserEvent, given: string) {
  await addRelative(user, 'Child', given, 'Test');
  await user.click(within(personPanel()).getByRole('button', { name: new RegExp(`^${given} Test`) }));
  await screen.findByRole('heading', { level: 2, name: `${given} Test` });
}

describe('tree view', () => {
  it('shows a newly added relative even when they are far from the centre person', async () => {
    const user = userEvent.setup();
    render(<App />);
    await createTree(user);
    await addPersonViaForm(user, 'Alpha', 'Test'); // becomes the tree's centre person
    await addChildAndGoToIt(user, 'Bravo');
    await addChildAndGoToIt(user, 'Charlie');
    await addChildAndGoToIt(user, 'Delta'); // three steps from Alpha: still drawn with the default "3 steps"
    expect(treeNode('Delta Test')).not.toBeNull();

    // Echo is four steps from Alpha, outside the default view: the tree re-centres on Delta to show them.
    await addRelative(user, 'Child', 'Echo', 'Test');
    expect(treeNode('Echo Test')).not.toBeNull();
    expect(treeNode('Delta Test')).not.toBeNull();
  });

  it('shows hidden relatives when their "+" is clicked', async () => {
    const user = userEvent.setup();
    render(<App />);
    await createTree(user);
    await addPersonViaForm(user, 'Alpha', 'Test');
    await addChildAndGoToIt(user, 'Bravo');
    await addChildAndGoToIt(user, 'Charlie');
    await addRelative(user, 'Child', 'Delta', 'Test');

    // Show only close family around Charlie: Alpha (two generations up) is then hidden behind Bravo's "+".
    await user.click(within(personPanel()).getByRole('button', { name: 'Show in tree' }));
    await user.selectOptions(screen.getByLabelText('How much of the family to show'), 'Close family');
    await user.click(within(personPanel()).getByRole('button', { name: /^Delta Test/ }));
    await user.click(screen.getByRole('button', { name: 'Show in tree' }));
    expect(treeNode('Alpha Test')).toBeNull();

    const plus = within(diagram()).getByRole('button', { name: 'Show 1 more relative of Bravo Test' });
    await user.click(plus);
    expect(treeNode('Alpha Test')).not.toBeNull();
    // The tree is now centred on (and has selected) Bravo.
    expect(await screen.findByRole('heading', { level: 2, name: 'Bravo Test' })).toBeInTheDocument();
  });
});
