import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';
import { createSessionKey } from '../crypto/container';
import { clearDraft, loadDraft } from '../storage/drafts';
import { encryptTree, serializeTree } from '../storage/treeFile';
import { complexFamily } from '../test/fixtures';
import { addPersonViaForm, addRelative, captureDownloads, createTree, PASSPHRASE, peopleList, personPanel, useWideViewport } from '../test/ui';
import { App } from './App';

beforeEach(async () => {
  useWideViewport();
  await clearDraft();
});

function fileFrom(content: string, name: string) {
  return new File([content], name, { type: 'application/json' });
}

describe('creating a tree', () => {
  it('refuses weak or mismatched passphrases', async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.click(screen.getByRole('button', { name: 'New tree' }));
    const passphrase = screen.getByLabelText('Passphrase', { selector: 'input' });
    const repeat = screen.getByLabelText('Repeat passphrase', { selector: 'input' });

    await user.type(passphrase, 'short');
    await user.click(screen.getByRole('button', { name: 'Create tree' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/at least 12 characters/);

    await user.clear(passphrase);
    await user.type(passphrase, PASSPHRASE);
    await user.type(repeat, `${PASSPHRASE}x`);
    await user.click(screen.getByRole('button', { name: 'Create tree' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/do not match/);

    await user.clear(repeat);
    await user.type(repeat, PASSPHRASE);
    await user.click(screen.getByRole('button', { name: 'Create tree' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/cannot be recovered/);
  });

  it('creates a tree, adds and connects people, edits and searches', async () => {
    const user = userEvent.setup();
    render(<App />);
    await createTree(user, 'The Example family');
    expect(screen.getByRole('button', { name: /The Example family/ })).toBeInTheDocument();

    await addPersonViaForm(user, 'Alice', 'Example');
    expect(screen.getAllByText(/Unsaved changes/).length).toBeGreaterThan(0);

    await addRelative(user, 'Parent', 'Robert', 'Example');
    await addRelative(user, 'Partner or spouse', 'Bob', 'Jones');
    await addRelative(user, 'Child', 'Carol', 'Example');

    const panel = personPanel();
    expect(within(panel).getByRole('button', { name: /^Robert Example/ })).toBeInTheDocument();
    expect(within(panel).getByRole('button', { name: /^Bob Jones/ })).toBeInTheDocument();
    // Carol was added as a child of both Alice and her partner Bob.
    const children = within(panel).getByRole('list', { name: 'Children with Bob Jones' });
    expect(within(children).getByRole('button', { name: /^Carol Example/ })).toBeInTheDocument();

    // Connect two existing people: navigate to Carol and add Robert as a godparent ("other relationship").
    await user.click(within(panel).getByRole('button', { name: /^Carol Example/ }));
    await screen.findByRole('heading', { level: 2, name: 'Carol Example' });
    await user.click(screen.getByRole('button', { name: 'Add relative' }));
    await user.click(screen.getByRole('menuitem', { name: 'Other relationship' }));
    const dialog = await screen.findByRole('dialog');
    await user.click(within(dialog).getByLabelText('Someone already in the tree'));
    await user.type(within(dialog).getByLabelText('Find a person'), 'robert');
    await user.click(within(dialog).getByRole('radio', { name: /Robert Example/ }));
    await user.type(within(dialog).getByLabelText(/This person is/), 'godparent');
    await user.click(within(dialog).getByRole('button', { name: 'Add' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(within(personPanel()).getByText('godparent')).toBeInTheDocument();
    // Siblings and grandparents are derived, not stored: Carol's parents are Alice and Bob.
    expect(within(personPanel()).getByRole('button', { name: /^Alice Example/ })).toBeInTheDocument();

    // Edit information, including an approximate date and Markdown notes.
    await user.click(screen.getByRole('button', { name: 'Edit' }));
    const form = screen.getByRole('form', { name: 'Edit Carol Example' });
    const birth = within(form).getByRole('group', { name: 'Birth date' });
    await user.selectOptions(within(birth).getByLabelText('Precision'), 'about');
    await user.type(within(birth).getByLabelText('Year'), '1990');
    await user.type(within(form).getByLabelText('Birth place'), 'Exampleton');
    await user.type(within(form).getByLabelText('Notes'), '## Early life\n\n*Loved* the sea.');
    await user.click(within(form).getByRole('button', { name: 'Save changes' }));
    const details = personPanel();
    expect(await within(details).findByText('about 1990 · Exampleton')).toBeInTheDocument();
    expect(within(details).getByRole('heading', { name: 'Early life' })).toBeInTheDocument();
    expect(within(details).getByText('Loved').tagName).toBe('EM');

    // Search by place, then open the result.
    const search = screen.getByRole('searchbox', { name: 'Search people' });
    await user.type(search, 'examplet');
    await waitFor(() => expect(screen.getByText('1 match')).toBeInTheDocument());
    expect(within(peopleList()).getByRole('button', { name: /^Carol Example/ })).toBeInTheDocument();
    await user.clear(search);
    await user.type(search, 'jones');
    await waitFor(() => expect(screen.getByText('1 match')).toBeInTheDocument());
    await user.click(within(peopleList()).getByRole('button', { name: /^Bob Jones/ }));
    expect(await screen.findByRole('heading', { level: 2, name: 'Bob Jones' })).toBeInTheDocument();
  });

  it('rejects invalid edits with a clear message and keeps the data unchanged', async () => {
    const user = userEvent.setup();
    render(<App />);
    await createTree(user);
    await addPersonViaForm(user, 'Dora', 'Test');
    await user.click(screen.getByRole('button', { name: 'Edit' }));
    const form = screen.getByRole('form', { name: 'Edit Dora Test' });
    const birth = within(form).getByRole('group', { name: 'Birth date' });
    await user.type(within(birth).getByLabelText('Day'), '31');
    await user.selectOptions(within(birth).getByLabelText('Month'), '2');
    await user.type(within(birth).getByLabelText('Year'), '1950');
    await user.click(within(form).getByRole('button', { name: 'Save changes' }));
    expect(within(form).getByText(/day 31 does not exist in February/)).toBeInTheDocument();
    expect(within(form).getByText(/needs attention/)).toBeInTheDocument();

    // Cancelling with unsaved edits asks for confirmation.
    await user.click(within(form).getByRole('button', { name: 'Cancel' }));
    const confirm = screen.getByRole('alertdialog', { name: 'Discard changes?' });
    await user.click(within(confirm).getByRole('button', { name: 'Discard changes' }));
    expect(within(personPanel()).queryByText(/1950/)).not.toBeInTheDocument();
  });

  it('prevents impossible relationships', async () => {
    const user = userEvent.setup();
    render(<App />);
    await createTree(user);
    await addPersonViaForm(user, 'Parent', 'Test');
    await addRelative(user, 'Child', 'Kid', 'Test');
    await user.click(within(personPanel()).getByRole('button', { name: /^Kid Test/ }));
    await screen.findByRole('heading', { level: 2, name: 'Kid Test' });
    // Try to make Parent a child of Kid.
    await user.click(screen.getByRole('button', { name: 'Add relative' }));
    await user.click(screen.getByRole('menuitem', { name: 'Child' }));
    const dialog = await screen.findByRole('dialog');
    await user.click(within(dialog).getByLabelText('Someone already in the tree'));
    await user.click(within(dialog).getByRole('radio', { name: /Parent Test/ }));
    await user.click(within(dialog).getByRole('button', { name: 'Add' }));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent(/own ancestor/);
  });

  it('deletes a person only after confirmation, and can undo it', async () => {
    const user = userEvent.setup();
    render(<App />);
    await createTree(user);
    await addPersonViaForm(user, 'Temp', 'Person');
    await user.click(screen.getByRole('button', { name: 'Delete' }));
    const confirm = screen.getByRole('alertdialog', { name: 'Delete Temp Person?' });
    await user.click(within(confirm).getByRole('button', { name: 'Cancel' }));
    expect(screen.getByRole('heading', { level: 2, name: 'Temp Person' })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Delete' }));
    await user.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Delete person' }));
    expect(screen.queryByRole('heading', { level: 2, name: 'Temp Person' })).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /^Undo/ }));
    expect(within(peopleList()).getByRole('button', { name: /^Temp Person/ })).toBeInTheDocument();
  });
});

describe('saving and opening', () => {
  it('saves an encrypted file and reopens it only with the right passphrase', async () => {
    const downloads = captureDownloads();
    const user = userEvent.setup();
    const { unmount } = render(<App />);
    await createTree(user, 'Secret family');
    await addPersonViaForm(user, 'Zelda', 'Hiddenname');

    await user.click(screen.getByRole('button', { name: /^Save/ }));
    await waitFor(() => expect(downloads).toHaveLength(1));
    await waitFor(() => expect(screen.getAllByText(/^Saved/).length).toBeGreaterThan(0));
    expect(screen.queryAllByText(/Unsaved changes/)).toHaveLength(0);

    const saved = downloads[0]!;
    expect(saved.name).toMatch(/^family-tree-\d{4}-\d{2}-\d{2}\.ftree$/);
    const content = await saved.blob.text();
    expect(JSON.parse(content).format).toBe('family-tree-encrypted');
    expect(content).not.toContain('Zelda');
    expect(content).not.toContain('Hiddenname');
    expect(content).not.toContain('Secret family');
    expect(content).not.toContain(PASSPHRASE);

    // Lock, then open the saved file again.
    await user.click(screen.getByRole('button', { name: 'Lock and close the tree' }));
    unmount();
    render(<App />);
    await user.upload(screen.getByLabelText('Encrypted family-tree file'), fileFrom(content, saved.name));
    await screen.findByRole('heading', { name: 'Unlock family tree' });

    await user.type(screen.getByLabelText('Passphrase', { selector: 'input' }), 'not the passphrase');
    await user.click(screen.getByRole('button', { name: /Unlock/ }));
    const error = await screen.findByRole('alert', {}, { timeout: 10_000 });
    expect(error).toHaveTextContent(/could not be decrypted/);
    expect(error).toHaveTextContent(/damaged or modified/);
    expect(screen.queryByText(/Zelda/)).not.toBeInTheDocument();

    const input = screen.getByLabelText('Passphrase', { selector: 'input' });
    await user.clear(input);
    await user.type(input, PASSPHRASE);
    await user.click(screen.getByRole('button', { name: /Unlock/ }));
    await screen.findByRole('button', { name: 'More actions' }, { timeout: 10_000 });
    expect(within(peopleList()).getByRole('button', { name: /^Zelda Hiddenname/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Secret family/ })).toBeInTheDocument();
  });

  it('detects a tampered encrypted file', async () => {
    const user = userEvent.setup();
    const session = await createSessionKey(PASSPHRASE);
    const container = JSON.parse(await encryptTree(complexFamily().tree, session));
    const ciphertext = container.ciphertext as string;
    container.ciphertext = (ciphertext[0] === 'A' ? 'B' : 'A') + ciphertext.slice(1);
    render(<App />);
    await user.upload(screen.getByLabelText('Encrypted family-tree file'), fileFrom(JSON.stringify(container), 'x.ftree'));
    await user.type(await screen.findByLabelText('Passphrase', { selector: 'input' }), PASSPHRASE);
    await user.click(screen.getByRole('button', { name: /Unlock/ }));
    expect(await screen.findByRole('alert', {}, { timeout: 10_000 })).toHaveTextContent(/could not be decrypted/);
  });

  it('rejects files that are not family trees', async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.upload(screen.getByLabelText('Encrypted family-tree file'), fileFrom('this is not json', 'notes.txt'));
    expect(await screen.findByRole('alert')).toHaveTextContent(/not valid JSON/);
    await user.upload(screen.getByLabelText('Unencrypted family-tree backup'), fileFrom('{"format":"family-tree","version":7}', 'future.json'));
    expect(await screen.findByRole('alert')).toHaveTextContent(/newer than this application supports/);
  });

  it('imports an unencrypted backup and asks for a passphrase to protect it', async () => {
    const downloads = captureDownloads();
    const user = userEvent.setup();
    render(<App />);
    const { tree } = complexFamily();
    await user.upload(screen.getByLabelText('Unencrypted family-tree backup'), fileFrom(serializeTree(tree), 'backup.plaintext.json'));
    expect(await screen.findByText(/contains 9 people and is not encrypted/)).toBeInTheDocument();
    await user.type(screen.getByLabelText('Passphrase', { selector: 'input' }), PASSPHRASE);
    await user.type(screen.getByLabelText('Repeat passphrase', { selector: 'input' }), PASSPHRASE);
    await user.click(screen.getByRole('checkbox'));
    await user.click(screen.getByRole('button', { name: 'Encrypt and open' }));
    await screen.findByRole('button', { name: 'More actions' }, { timeout: 10_000 });
    expect(within(peopleList()).getByRole('button', { name: /^Arthur Testfield/ })).toBeInTheDocument();
    // Imported data is not yet saved in encrypted form.
    expect(screen.getAllByText(/Unsaved changes/).length).toBeGreaterThan(0);

    // Exporting unencrypted data requires an explicit confirmation.
    await user.click(screen.getByRole('button', { name: 'More actions' }));
    await user.click(screen.getByRole('menuitem', { name: /Export unencrypted JSON/ }));
    const confirm = screen.getByRole('alertdialog', { name: 'Export without encryption?' });
    await user.click(within(confirm).getByRole('button', { name: 'Export unencrypted file' }));
    expect(downloads).toHaveLength(1);
    expect(downloads[0]!.name).toMatch(/\.plaintext\.json$/);
    expect(JSON.parse(await downloads[0]!.blob.text())).toEqual(tree);
  });

  it('recovers unsaved work from the encrypted draft after a reload', async () => {
    const user = userEvent.setup();
    const { unmount } = render(<App />);
    await createTree(user);
    await addPersonViaForm(user, 'Draft', 'Survivor');
    await screen.findByText(/encrypted recovery copy/, {}, { timeout: 10_000 });
    unmount(); // Simulates closing the tab without saving.

    render(<App />);
    const card = await screen.findByRole('region', { name: 'Recover unsaved work' });
    await user.click(within(card).getByRole('button', { name: 'Recover' }));
    await user.type(screen.getByLabelText('Passphrase', { selector: 'input' }), PASSPHRASE);
    await user.click(screen.getByRole('button', { name: /Recover/ }));
    await screen.findByRole('button', { name: 'More actions' }, { timeout: 10_000 });
    expect(within(peopleList()).getByRole('button', { name: /^Draft Survivor/ })).toBeInTheDocument();
  });

  it('never silently discards another tree’s unsaved work', async () => {
    const user = userEvent.setup();
    const first = render(<App />);
    await createTree(user);
    await addPersonViaForm(user, 'Keep', 'Me');
    await screen.findByText(/encrypted recovery copy/, {}, { timeout: 10_000 });
    first.unmount();
    const draftBefore = await loadDraft();
    expect(draftBefore).toBeDefined();

    const saved = await encryptTree(complexFamily().tree, await createSessionKey(PASSPHRASE));
    render(<App />);
    await screen.findByRole('region', { name: 'Recover unsaved work' });
    await user.upload(screen.getByLabelText('Encrypted family-tree file'), fileFrom(saved, 'other.ftree'));
    await user.type(await screen.findByLabelText('Passphrase', { selector: 'input' }), PASSPHRASE);
    await user.click(screen.getByRole('button', { name: /Unlock/ }));
    const confirm = await screen.findByRole('alertdialog', { name: 'Replace unsaved work?' }, { timeout: 10_000 });
    await user.click(within(confirm).getByRole('button', { name: 'Continue' }));
    await screen.findByRole('button', { name: 'More actions' });
    // Opening a clean tree must not delete the other tree's recovery copy.
    await new Promise((resolve) => setTimeout(resolve, 1200));
    expect(await loadDraft()).toEqual(draftBefore);
  });
});
