/** Helpers for UI workflow tests. */
import { screen, waitFor, within } from '@testing-library/react';
import type { UserEvent } from '@testing-library/user-event';
import { expect, vi } from 'vitest';

export const PASSPHRASE = 'harbour lantern violet oatmeal';

/** Pretends the viewport is a wide desktop screen (jsdom has no layout engine). */
export function useWideViewport() {
  window.matchMedia = vi.fn().mockImplementation((query: string) => ({
    matches: query.includes('min-width'),
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
  }));
}

/** Captures files the app "downloads" instead of navigating. */
export function captureDownloads() {
  const files: { name: string; blob: Blob }[] = [];
  let lastBlob: Blob | undefined;
  URL.createObjectURL = vi.fn((blob: Blob) => {
    lastBlob = blob;
    return 'blob:test';
  });
  URL.revokeObjectURL = vi.fn();
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
    if (lastBlob) files.push({ name: this.download, blob: lastBlob });
  });
  return files;
}

export async function createTree(user: UserEvent, title = 'Test family') {
  await user.click(screen.getByRole('button', { name: 'New tree' }));
  await user.type(screen.getByLabelText('Name of the tree'), title);
  await user.type(screen.getByLabelText('Passphrase', { selector: 'input' }), PASSPHRASE);
  await user.type(screen.getByLabelText('Repeat passphrase', { selector: 'input' }), PASSPHRASE);
  await user.click(screen.getByRole('checkbox'));
  await user.click(screen.getByRole('button', { name: 'Create tree' }));
  await screen.findByRole('button', { name: 'More actions' }, { timeout: 10_000 });
}

export async function addPersonViaForm(user: UserEvent, given: string, surname: string) {
  await user.click(screen.getAllByRole('button', { name: 'Add person' })[0]!);
  const form = await screen.findByRole('form', { name: 'New person' });
  await user.type(within(form).getByLabelText('Given names'), given);
  await user.type(within(form).getByLabelText('Surname / family name'), surname);
  await user.click(within(form).getByRole('button', { name: 'Add person' }));
  await screen.findByRole('heading', { level: 2, name: `${given} ${surname}` });
}

export async function addRelative(user: UserEvent, menuItem: string, given: string, surname: string) {
  await user.click(screen.getByRole('button', { name: 'Add relative' }));
  await user.click(screen.getByRole('menuitem', { name: menuItem }));
  const dialog = await screen.findByRole('dialog');
  await user.type(within(dialog).getByLabelText('Given names'), given);
  const surnameInput = within(dialog).getByLabelText('Surname');
  await user.clear(surnameInput);
  await user.type(surnameInput, surname);
  await user.click(within(dialog).getByRole('button', { name: 'Add' }));
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
}

export function personPanel() {
  return screen.getByRole('complementary', { name: 'Person' });
}

/** The searchable list of people (as opposed to nodes in the tree diagram). */
export function peopleList() {
  return within(screen.getByRole('region', { name: 'People' })).getByRole('list');
}
