import { fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';
import { clearDraft } from '../storage/drafts';
import { addPersonViaForm, createTree, peopleList, useWideViewport } from '../test/ui';
import { App } from './App';
import { clampWidth, DEFAULT_PANES, loadPanes, PANE_LIMITS } from './panes';

const STORAGE_KEY = 'family-tree.ui.panes.v1';

beforeEach(async () => {
  useWideViewport();
  localStorage.clear();
  await clearDraft();
});

describe('pane preferences', () => {
  it('clamps widths and ignores malformed stored values', () => {
    expect(clampWidth('left', 10)).toBe(PANE_LIMITS.left.min);
    expect(clampWidth('right', 5000)).toBe(PANE_LIMITS.right.max);
    localStorage.setItem(STORAGE_KEY, '{not json');
    expect(loadPanes()).toEqual(DEFAULT_PANES);
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ left: { width: 'wide', collapsed: 'yes' }, right: { width: 9999, collapsed: true } }));
    expect(loadPanes()).toEqual({ left: DEFAULT_PANES.left, right: { width: PANE_LIMITS.right.max, collapsed: true } });
  });
});

describe('side panes', () => {
  it('collapse, expand, resize with the keyboard, and remember the layout', async () => {
    const user = userEvent.setup();
    const { unmount } = render(<App />);
    await createTree(user);
    await addPersonViaForm(user, 'Pane', 'Tester');

    // Collapse the people list with its button, and bring it back from the strip.
    await user.click(screen.getByRole('button', { name: 'Hide people ([)' }));
    expect(screen.queryByRole('region', { name: 'People' })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Show people ([)' }));
    expect(peopleList()).toBeInTheDocument();

    // Keyboard shortcuts toggle the panes (but not while typing).
    await user.click(document.body);
    await user.keyboard(']');
    expect(screen.getByRole('button', { name: 'Show person (])' })).toBeInTheDocument();
    await user.click(screen.getByRole('searchbox', { name: 'Search people' }));
    await user.keyboard('[[');
    expect(screen.getByRole('searchbox', { name: 'Search people' })).toHaveValue('[');

    // Opening a person from the list shows the collapsed details pane again.
    await user.clear(screen.getByRole('searchbox', { name: 'Search people' }));
    await user.click(within(peopleList()).getByRole('button', { name: /^Pane Tester/ }));
    expect(screen.getByRole('heading', { level: 2, name: 'Pane Tester' })).toBeInTheDocument();

    // Resize the people list with the arrow keys.
    const handle = screen.getByRole('separator', { name: 'Resize people list' });
    expect(handle).toHaveAttribute('aria-valuenow', String(PANE_LIMITS.left.default));
    handle.focus();
    await user.keyboard('{ArrowRight}{ArrowRight}');
    expect(handle).toHaveAttribute('aria-valuenow', String(PANE_LIMITS.left.default + 32));
    fireEvent.doubleClick(handle);
    expect(handle).toHaveAttribute('aria-valuenow', String(PANE_LIMITS.left.default));
    await user.keyboard('{End}');

    // The layout is remembered after closing and reopening.
    unmount();
    expect(JSON.parse(localStorage.getItem(STORAGE_KEY)!)).toEqual({
      left: { width: PANE_LIMITS.left.max, collapsed: false },
      right: { width: PANE_LIMITS.right.default, collapsed: false },
    });
    // Nothing about the family is stored there.
    expect(localStorage.getItem(STORAGE_KEY)).not.toMatch(/Pane|Tester/);
  });
});
