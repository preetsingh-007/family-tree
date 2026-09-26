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

  it('shows hidden relatives in place when their "+" is clicked', async () => {
    const user = userEvent.setup();
    render(<App />);
    await createTree(user);
    await addPersonViaForm(user, 'Alpha', 'Test');
    await addChildAndGoToIt(user, 'Bravo');
    await addChildAndGoToIt(user, 'Charlie');
    await addRelative(user, 'Child', 'Delta', 'Test');

    // Show only close family around Delta: Alpha (three generations up) is hidden behind Bravo's "+".
    await user.click(within(personPanel()).getByRole('button', { name: /^Delta Test/ }));
    await user.click(screen.getByRole('button', { name: 'Show in tree' }));
    await user.selectOptions(screen.getByLabelText('How much of the family to show'), 'Close family');
    expect(treeNode('Alpha Test')).toBeNull();

    await user.click(within(diagram()).getByRole('button', { name: 'Show 1 more relative of Bravo Test' }));
    // Alpha appears and nothing else disappears: the view grew instead of jumping.
    expect(treeNode('Alpha Test')).not.toBeNull();
    expect(treeNode('Delta Test')).not.toBeNull();
    expect(screen.getByRole('heading', { level: 2, name: 'Delta Test' })).toBeInTheDocument();

    // "Reset view" undoes it.
    await user.click(screen.getByRole('button', { name: /Reset view/ }));
    expect(treeNode('Alpha Test')).toBeNull();
  });

  it('hides and shows a person’s descendants', async () => {
    const user = userEvent.setup();
    render(<App />);
    await createTree(user);
    await addPersonViaForm(user, 'Alpha', 'Test');
    await addChildAndGoToIt(user, 'Bravo');
    await addRelative(user, 'Child', 'Charlie', 'Test');
    await user.click(within(personPanel()).getByRole('button', { name: /^Charlie Test/ }));
    await addRelative(user, 'Child', 'Delta', 'Test');
    expect(treeNode('Delta Test')).not.toBeNull();

    await user.click(within(diagram()).getByRole('button', { name: 'Hide descendants of Bravo Test' }));
    expect(treeNode('Charlie Test')).toBeNull();
    expect(treeNode('Delta Test')).toBeNull();
    expect(treeNode('Bravo Test')).not.toBeNull();

    await user.click(within(diagram()).getByRole('button', { name: 'Show 2 hidden descendants of Bravo Test' }));
    expect(treeNode('Charlie Test')).not.toBeNull();
    expect(treeNode('Delta Test')).not.toBeNull();
  });

  it('lets boxes be dragged, moving partners together, and resets the view', async () => {
    const user = userEvent.setup();
    render(<App />);
    await createTree(user);
    await addPersonViaForm(user, 'Alpha', 'Test');
    await addRelative(user, 'Partner or spouse', 'Beta', 'Test');
    const position = (name: string) =>
      diagram().querySelector(`[aria-label^="${name}"][data-node-key]`)!.getAttribute('transform');
    const alphaBefore = position('Alpha Test');
    const betaBefore = position('Beta Test');

    const beta = diagram().querySelector('[aria-label^="Beta Test"][data-node-key]')!;
    await user.pointer([
      { keys: '[MouseLeft>]', target: beta, coords: { clientX: 100, clientY: 100 } },
      { target: beta, coords: { clientX: 140, clientY: 160 } },
      { keys: '[/MouseLeft]', target: beta, coords: { clientX: 140, clientY: 160 } },
    ]);
    // Partners move together.
    expect(position('Alpha Test')).not.toBe(alphaBefore);
    expect(position('Beta Test')).not.toBe(betaBefore);
    // Dragging is not a click: Beta was not selected.
    expect(screen.getByRole('heading', { level: 2, name: 'Alpha Test' })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /Reset view/ }));
    expect(position('Alpha Test')).toBe(alphaBefore);
    expect(position('Beta Test')).toBe(betaBefore);
  });
});
