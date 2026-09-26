import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { SessionKey } from '../crypto/container';
import { displayName } from '../model/names';
import { buildIndex } from '../model/relatives';
import { addPerson, createPerson, updatePerson } from '../model/tree';
import type { Association, Id, ParentLink, Partnership, Person } from '../model/types';
import { useTreeEditor } from '../state/editor';
import { clearDraft, saveDraft } from '../storage/drafts';
import {
  downloadFile,
  PickerCancelledError,
  pickSaveFile,
  supportsSaveInPlace,
  writeFile,
  type FileHandle,
} from '../storage/files';
import { defaultTarget, getPublishedFile, PUBLISH_PATH, publishFile, type GitHubTarget } from '../storage/github';
import { defaultFileName, ENCRYPTED_EXTENSION, encryptTree, serializeTree } from '../storage/treeFile';
import { AddRelativeDialog, type RelationType } from './AddRelativeDialog';
import { describeError } from './errors';
import { EditIcon, LockIcon, MenuIcon, PeopleIcon, PersonIcon, RedoIcon, SaveIcon, TreeIcon, UndoIcon } from './icons';
import { Markdown } from './Markdown';
import { Menu } from './Menu';
import { ConfirmDialog } from './Modal';
import { PeoplePanel } from './PeoplePanel';
import { PersonDetails } from './PersonDetails';
import { PersonEditor } from './PersonEditor';
import { PublishDialog, type PublishOutcome } from './PublishDialog';
import { EditParentLinkDialog, EditPartnershipDialog, RemoveAssociationDialog } from './RelationshipDialogs';
import { SecurityInfo } from './SecurityInfo';
import { TreeView, type RevealRequest } from './TreeView';
import { usePanes } from './panes';
import { gridColumns, SidePane } from './SidePane';
import { useMediaQuery } from './useMediaQuery';
import type { OpenedTree } from './WelcomeScreen';
import { ChangePassphraseDialog, TreeSettingsDialog } from './WorkspaceDialogs';

type SaveState = { status: 'idle' | 'encrypting' } | { status: 'error'; message: string };
type Panel = { mode: 'view' } | { mode: 'edit' } | { mode: 'new'; person: Person };
type MobileTab = 'people' | 'tree' | 'person';
type Dialog =
  | { kind: 'addRelative'; relation: RelationType }
  | { kind: 'parentLink'; link: ParentLink }
  | { kind: 'partnership'; partnership: Partnership }
  | { kind: 'association'; association: Association }
  | { kind: 'treeSettings' }
  | { kind: 'security' }
  | { kind: 'passphrase' }
  | { kind: 'exportPlaintext' }
  | { kind: 'lock' }
  | { kind: 'publish' };

const DRAFT_DELAY_MS = 800;

interface Props {
  opened: OpenedTree;
  onLock: () => void;
}

export function Workspace({ opened, onLock }: Props) {
  const editor = useTreeEditor(opened.tree, opened.saved);
  // A published tree opens for viewing; "Edit" switches to the full editor.
  const [readOnly, setReadOnly] = useState(!!opened.readOnly);
  const { tree, dirty } = editor;
  const index = useMemo(() => buildIndex(tree), [tree]);

  const [session, setSession] = useState<SessionKey>(opened.session);
  const [fileHandle, setFileHandle] = useState<FileHandle | undefined>(opened.fileHandle);
  const [saveState, setSaveState] = useState<SaveState>({ status: 'idle' });
  const [lastSaved, setLastSaved] = useState<{ at: Date; how: 'Saved' | 'Published' }>();
  // Publishing: the token and target live in memory only, for this unlocked session.
  const [github, setGithub] = useState<{ token: string; target: GitHubTarget }>();
  const publishedSha = useRef<string | undefined>(opened.baseSha);
  const [draftStored, setDraftStored] = useState(false);
  const [selectedId, setSelectedId] = useState<Id | undefined>(() => opened.tree.people[0]?.id);
  const [focusId, setFocusId] = useState<Id | undefined>(() => opened.tree.people[0]?.id);
  const [panel, setPanel] = useState<Panel>({ mode: 'view' });
  // Asks the tree view to bring someone just added into view.
  const [reveal, setReveal] = useState<RevealRequest>();
  const revealPerson = useCallback((id: Id, fallbackFocus: Id) => setReveal({ id, fallbackFocus, token: Date.now() }), []);
  const [dialog, setDialog] = useState<Dialog>();
  const [mobileTab, setMobileTab] = useState<MobileTab>(opened.tree.people.length ? 'tree' : 'people');
  const [announcement, setAnnouncement] = useState('');

  const wide = useMediaQuery('(min-width: 1180px)');
  const narrow = useMediaQuery('(max-width: 759px)');
  const layout = wide ? 'wide' : narrow ? 'narrow' : 'medium';
  const paneControls = usePanes(readOnly);
  const { panes } = paneControls;
  /** Makes sure the details pane is visible (it may have been collapsed). */
  const showDetails = useCallback(() => {
    if (layout !== 'narrow') paneControls.setCollapsed('right', false);
  }, [layout, paneControls]);

  const selected = selectedId ? index.people.get(selectedId) : undefined;

  const announce = useCallback((message: string) => {
    setAnnouncement('');
    requestAnimationFrame(() => setAnnouncement(message));
  }, []);

  // Keep the selection valid after undo/redo/deletion.
  useEffect(() => {
    if (selectedId && !index.people.has(selectedId)) {
      setSelectedId(undefined);
      if (panel.mode === 'edit') setPanel({ mode: 'view' });
    }
    if (focusId && !index.people.has(focusId)) setFocusId(tree.people[0]?.id);
  }, [index, selectedId, focusId, panel.mode, tree.people]);

  // --- Encrypted recovery copy -------------------------------------------------
  // Only a draft written by (or recovered into) this workspace is ever cleared, so
  // opening another tree never silently deletes someone's unsaved work. All draft
  // writes and deletions run through one queue so a late write cannot outlive a save.
  const dirtyRef = useRef(dirty);
  dirtyRef.current = dirty;
  const ownsDraft = useRef(!!opened.fromDraft);
  const draftQueue = useRef<Promise<void>>(Promise.resolve());
  const enqueueDraft = useCallback((operation: () => Promise<void>) => {
    draftQueue.current = draftQueue.current.then(operation).catch(() => setDraftStored(false));
  }, []);

  useEffect(() => {
    if (!dirty) {
      enqueueDraft(async () => {
        if (!ownsDraft.current) return;
        await clearDraft();
        ownsDraft.current = false;
        setDraftStored(false);
      });
      return;
    }
    let cancelled = false;
    const timer = setTimeout(() => {
      enqueueDraft(async () => {
        const container = await encryptTree(tree, session);
        // Re-check at write time: the tree may have been saved meanwhile.
        if (cancelled || !dirtyRef.current) return;
        await saveDraft({ container, savedAt: new Date().toISOString() });
        ownsDraft.current = true;
        setDraftStored(true);
      });
    }, DRAFT_DELAY_MS);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [tree, dirty, session, enqueueDraft]);

  // Warn before leaving with unsaved changes.
  useEffect(() => {
    if (!dirty) return;
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [dirty]);

  // --- Saving ------------------------------------------------------------------
  const save = useCallback(
    async (saveAs = false) => {
      if (saveState.status === 'encrypting') return;
      const revision = editor.revision;
      setSaveState({ status: 'encrypting' });
      try {
        const content = await encryptTree(tree, session);
        let message: string;
        if (supportsSaveInPlace()) {
          const handle =
            fileHandle && !saveAs
              ? fileHandle
              : await pickSaveFile(defaultFileName('encrypted'), 'Encrypted family tree', ENCRYPTED_EXTENSION, 'application/json');
          await writeFile(handle, content);
          setFileHandle(handle);
          message = `Saved and encrypted to ${handle.name}.`;
        } else {
          downloadFile(content, defaultFileName('encrypted'), 'application/json');
          message = 'Encrypted file downloaded. Keep it somewhere safe.';
        }
        editor.markSaved(revision);
        setLastSaved({ at: new Date(), how: 'Saved' });
        setSaveState({ status: 'idle' });
        announce(message);
      } catch (error) {
        if (error instanceof PickerCancelledError) {
          setSaveState({ status: 'idle' });
          return;
        }
        setSaveState({ status: 'error', message: describeError(error, 'The tree could not be saved. Your changes are still open here.').message });
      }
    },
    [saveState.status, editor, tree, session, fileHandle, announce],
  );

  /**
   * Encrypts the tree and commits it to GitHub. Refuses (returns "conflict") when
   * the published file is not the version this session opened or last published,
   * unless the user chose to replace it.
   */
  const publish = useCallback(
    async (target: GitHubTarget, token: string, replace: boolean): Promise<PublishOutcome> => {
      const revision = editor.revision;
      const remote = await getPublishedFile(target, token);
      if (remote && remote.sha !== publishedSha.current && !replace) return { status: 'conflict' };
      const content = await encryptTree(tree, session);
      publishedSha.current = await publishFile(target, token, content, remote?.sha);
      setGithub({ token, target });
      editor.markSaved(revision);
      setLastSaved({ at: new Date(), how: 'Published' });
      announce('Encrypted tree published. The website updates when the deploy finishes.');
      return { status: 'published', target };
    },
    [editor, tree, session, announce],
  );

  const exportPlaintext = () => {
    downloadFile(serializeTree(tree), defaultFileName('plaintext'), 'application/json');
    announce('Unencrypted JSON exported.');
  };

  // Keyboard shortcuts.
  useEffect(() => {
    if (readOnly) return;
    const onKeyDown = (event: KeyboardEvent) => {
      const mod = event.ctrlKey || event.metaKey;
      if (!mod) return;
      const target = event.target as HTMLElement;
      const inField = target.closest('input, textarea, select, [contenteditable="true"]');
      if (event.key.toLowerCase() === 's') {
        event.preventDefault();
        void save(event.shiftKey);
      } else if (!inField && !document.querySelector('.modal') && event.key.toLowerCase() === 'z') {
        event.preventDefault();
        if (event.shiftKey) editor.redo();
        else editor.undo();
      } else if (!inField && !document.querySelector('.modal') && event.key.toLowerCase() === 'y') {
        event.preventDefault();
        editor.redo();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [save, editor, readOnly]);

  // "[" and "]" hide or show the side panes.
  useEffect(() => {
    if (layout === 'narrow') return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.ctrlKey || event.metaKey || event.altKey) return;
      if ((event.target as HTMLElement).closest('input, textarea, select, [contenteditable="true"]')) return;
      if (document.querySelector('.modal')) return;
      if (event.key === '[' && layout === 'wide') paneControls.toggle('left');
      else if (event.key === ']') paneControls.toggle('right');
      else return;
      event.preventDefault();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [layout, paneControls]);

  // --- Navigation --------------------------------------------------------------
  const select = useCallback(
    (id: Id, options: { openDetails?: boolean } = {}) => {
      setSelectedId(id);
      setPanel({ mode: 'view' });
      if (options.openDetails) {
        showDetails();
        if (layout !== 'wide') setMobileTab('person');
      }
    },
    [layout, showDetails],
  );

  const showInTree = (id: Id) => {
    setSelectedId(id);
    setFocusId(id);
    if (layout !== 'wide') setMobileTab('tree');
  };

  const startNewPerson = () => {
    setPanel({ mode: 'new', person: createPerson() });
    showDetails();
    if (layout !== 'wide') setMobileTab('person');
  };

  // --- Rendering ---------------------------------------------------------------
  const statusText = readOnly
    ? 'View only'
    : saveState.status === 'encrypting'
      ? 'Encrypting…'
      : saveState.status === 'error'
        ? 'Save failed'
        : dirty
          ? draftStored
            ? 'Unsaved changes · encrypted recovery copy on this device'
            : 'Unsaved changes'
          : lastSaved
            ? `${lastSaved.how} ${lastSaved.at.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`
            : 'No unsaved changes';

  const personPanel = (() => {
    if (panel.mode === 'new') {
      return (
        <PersonEditor
          key={panel.person.id}
          person={panel.person}
          isNew
          onCancel={() => setPanel({ mode: 'view' })}
          onSave={(person) => {
            const error = editor.apply(`Add ${displayName(person)}`, (t) => addPerson(t, person));
            if (!error) {
              setSelectedId(person.id);
              if (!focusId || tree.people.length === 0) setFocusId(person.id);
              revealPerson(person.id, person.id);
              setPanel({ mode: 'view' });
              announce(`${displayName(person)} added.`);
            }
            return error;
          }}
        />
      );
    }
    if (!selected) {
      return (
        <div className="tree-overview">
          <h2>{tree.title}</h2>
          <p className="muted">
            {tree.people.length} {tree.people.length === 1 ? 'person' : 'people'} · {tree.partnerships.length} partnerships
          </p>
          {tree.people.length === 0 ? (
            <p>Start by adding yourself or the person you know most about, then add their relatives.</p>
          ) : (
            <p className="muted">Select someone in the tree or the list to see their details.</p>
          )}
          {tree.notes.trim() && <Markdown source={tree.notes} className="tree-notes" />}
          {!readOnly && (
            <div className="button-row">
              <button type="button" className="button button-primary" onClick={startNewPerson}>
                Add person
              </button>
              <button type="button" className="button" onClick={() => setDialog({ kind: 'treeSettings' })}>
                Edit tree name &amp; notes
              </button>
            </div>
          )}
        </div>
      );
    }
    if (panel.mode === 'edit') {
      return (
        <PersonEditor
          key={selected.id}
          person={selected}
          onCancel={() => setPanel({ mode: 'view' })}
          onSave={(person) => {
            const error = editor.apply(`Edit ${displayName(person)}`, (t) => updatePerson(t, person));
            if (!error) {
              setPanel({ mode: 'view' });
              announce('Changes applied.');
            }
            return error;
          }}
        />
      );
    }
    return (
      <PersonDetails
        key={selected.id}
        index={index}
        person={selected}
        onSelect={(id) => select(id)}
        onEdit={() => setPanel({ mode: 'edit' })}
        onShowInTree={() => showInTree(selected.id)}
        onAddRelative={(relation) => setDialog({ kind: 'addRelative', relation })}
        onEditParentLink={(link) => setDialog({ kind: 'parentLink', link })}
        onEditPartnership={(partnership) => setDialog({ kind: 'partnership', partnership })}
        onRemoveAssociation={(association) => setDialog({ kind: 'association', association })}
        onApply={editor.apply}
        onDeleted={() => setSelectedId(undefined)}
        announce={announce}
        readOnly={readOnly}
      />
    );
  })();

  const peoplePanel = (
    <PeoplePanel
      people={tree.people}
      selectedId={selectedId}
      onSelect={(id) => {
        select(id, { openDetails: true });
        if (!focusId) setFocusId(id);
      }}
      onAddPerson={readOnly ? undefined : startNewPerson}
    />
  );

  const treePanel = (
    <TreeView
      index={index}
      focusId={focusId}
      selectedId={selectedId}
      onSelect={(id) => select(id)}
      onOpen={(id) => select(id, { openDetails: true })}
      reveal={reveal}
      onFocus={(id) => {
        setFocusId(id);
        setSelectedId(id);
      }}
    />
  );

  const renderDialog = () => {
    if (!dialog) return null;
    const close = () => setDialog(undefined);
    switch (dialog.kind) {
      case 'addRelative':
        return selected ? (
          <AddRelativeDialog
            index={index}
            person={selected}
            relation={dialog.relation}
            onApply={editor.apply}
            onClose={close}
            onDone={(relativeId) => {
              close();
              // Other relationships (e.g. godparents) are not drawn in the tree, so there is nothing to reveal.
              if (dialog.relation !== 'other') revealPerson(relativeId, selected.id);
              announce('Relationship added.');
            }}
          />
        ) : null;
      case 'parentLink': {
        const parent = index.people.get(dialog.link.parentId);
        const child = index.people.get(dialog.link.childId);
        return parent && child ? (
          <EditParentLinkDialog link={dialog.link} parent={parent} child={child} onApply={editor.apply} onClose={close} />
        ) : null;
      }
      case 'partnership': {
        const a = index.people.get(dialog.partnership.partnerIds[0]);
        const b = index.people.get(dialog.partnership.partnerIds[1]);
        return a && b ? <EditPartnershipDialog partnership={dialog.partnership} a={a} b={b} onApply={editor.apply} onClose={close} /> : null;
      }
      case 'association': {
        const from = index.people.get(dialog.association.personIds[0]);
        const to = index.people.get(dialog.association.personIds[1]);
        return from && to ? (
          <RemoveAssociationDialog association={dialog.association} from={from} to={to} onApply={editor.apply} onClose={close} />
        ) : null;
      }
      case 'treeSettings':
        return (
          <TreeSettingsDialog
            tree={tree}
            onClose={close}
            onSave={(title, notes) => {
              editor.apply('Edit tree name and notes', (t) => (t.title === title && t.notes === notes ? t : { ...t, title, notes }));
              close();
            }}
          />
        );
      case 'security':
        return <SecurityInfo onClose={close} />;
      case 'passphrase':
        return (
          <ChangePassphraseDialog
            onClose={close}
            onChanged={(next) => {
              setSession(next);
              editor.markSaved(0);
              close();
              announce('Passphrase changed. Save the tree to apply it.');
            }}
          />
        );
      case 'exportPlaintext':
        return (
          <ConfirmDialog
            title="Export without encryption?"
            confirmLabel="Export unencrypted file"
            danger
            onCancel={close}
            onConfirm={() => {
              close();
              exportPlaintext();
            }}
          >
            <p>
              This creates a readable JSON file containing <strong>all</strong> of your family information and photos,{' '}
              <strong>without any protection</strong>. Anyone who gets the file can read it.
            </p>
            <p>
              It is useful as a long-term, application-independent backup or for moving data to other software. Store it
              somewhere private and never commit or upload it to a public place.
            </p>
          </ConfirmDialog>
        );
      case 'publish':
        return (
          <PublishDialog
            initialTarget={{ ...defaultTarget(), ...github?.target, path: PUBLISH_PATH }}
            sessionToken={github?.token}
            onPublish={publish}
            onClose={close}
          />
        );
      case 'lock':
        return (
          <ConfirmDialog
            title="Lock with unsaved changes?"
            confirmLabel="Lock anyway"
            danger
            onCancel={close}
            onConfirm={() => {
              close();
              onLock();
            }}
          >
            <p>
              You have changes that have not been saved to a file.{' '}
              {draftStored
                ? 'An encrypted recovery copy is kept on this device, and you can recover it with your passphrase from the start screen.'
                : 'They will be lost.'}
            </p>
          </ConfirmDialog>
        );
    }
  };

  return (
    <div className={`workspace layout-${layout}`}>
      <a href="#workspace-main" className="skip-link">
        Skip to content
      </a>
      <header className="app-header">
        <div className="header-identity">
          {readOnly ? (
            <h1 className="tree-title">
              <TreeIcon />
              <span className="tree-title-text">{tree.title}</span>
            </h1>
          ) : (
            <button type="button" className="tree-title" onClick={() => setDialog({ kind: 'treeSettings' })} title="Edit tree name and notes">
              <TreeIcon />
              <span className="tree-title-text">{tree.title}</span>
            </button>
          )}
          <p className={`save-status ${readOnly ? 'view-only' : dirty ? 'dirty' : 'clean'} ${saveState.status}`} role="status" aria-live="polite">
            <span className="save-dot" aria-hidden="true" />
            <span className="save-status-text">{statusText}</span>
          </p>
        </div>
        <div className="header-actions">
          {readOnly ? (
            <>
              <button
                type="button"
                className="button button-primary"
                onClick={() => {
                  setReadOnly(false);
                  announce('Editing turned on.');
                }}
                title="Turn on editing"
              >
                <EditIcon /> Edit
              </button>
              <Menu
                label={<MenuIcon />}
                ariaLabel="More actions"
                buttonClassName="icon-button"
                align="right"
                items={[
                  { label: 'How your data is protected', onSelect: () => setDialog({ kind: 'security' }) },
                  'separator',
                  { label: 'Lock', onSelect: onLock },
                ]}
              />
            </>
          ) : (
            <>
            <button
              type="button"
              className="icon-button"
              onClick={editor.undo}
              disabled={!editor.canUndo}
              aria-label={editor.undoLabel ? `Undo: ${editor.undoLabel}` : 'Undo'}
              title={editor.undoLabel ? `Undo: ${editor.undoLabel}` : 'Undo'}
            >
              <UndoIcon />
            </button>
            <button
              type="button"
              className="icon-button"
              onClick={editor.redo}
              disabled={!editor.canRedo}
              aria-label={editor.redoLabel ? `Redo: ${editor.redoLabel}` : 'Redo'}
              title={editor.redoLabel ? `Redo: ${editor.redoLabel}` : 'Redo'}
            >
              <RedoIcon />
            </button>
            <button
              type="button"
              className={`button ${dirty ? 'button-primary' : ''}`}
              onClick={() => void save(false)}
              disabled={saveState.status === 'encrypting'}
              title="Encrypt and save (Ctrl+S)"
            >
              <SaveIcon /> {saveState.status === 'encrypting' ? 'Encrypting…' : 'Save'}
            </button>
            <Menu
              label={<MenuIcon />}
              ariaLabel="More actions"
              buttonClassName="icon-button"
              align="right"
              items={[
                { label: 'Save as…', description: 'Encrypted copy with a new file name', onSelect: () => void save(true) },
                {
                  label: 'Publish to website…',
                  description: 'Commit the encrypted tree to GitHub',
                  onSelect: () => setDialog({ kind: 'publish' }),
                },
                { label: 'Tree name & notes', onSelect: () => setDialog({ kind: 'treeSettings' }) },
                { label: 'Change passphrase', onSelect: () => setDialog({ kind: 'passphrase' }) },
                'separator',
                {
                  label: 'Export unencrypted JSON…',
                  description: 'Readable backup, not protected',
                  onSelect: () => setDialog({ kind: 'exportPlaintext' }),
                },
                { label: 'How your data is protected', onSelect: () => setDialog({ kind: 'security' }) },
                'separator',
                { label: 'Lock', onSelect: () => (dirty ? setDialog({ kind: 'lock' }) : onLock()) },
              ]}
            />
            </>
          )}
          <button
            type="button"
            className="icon-button hide-narrow"
            onClick={() => (dirty ? setDialog({ kind: 'lock' }) : onLock())}
            aria-label="Lock and close the tree"
            title="Lock and close the tree"
          >
            <LockIcon />
          </button>
        </div>
      </header>

      {saveState.status === 'error' && (
        <div className="banner banner-error" role="alert">
          <p>{saveState.message}</p>
          <button type="button" className="button button-small" onClick={() => setSaveState({ status: 'idle' })}>
            Dismiss
          </button>
        </div>
      )}

      <main
        id="workspace-main"
        className="workspace-main"
        tabIndex={-1}
        style={{ gridTemplateColumns: gridColumns(layout, panes) }}
      >
        {layout === 'wide' && (
          <>
            <SidePane
              side="left"
              title="People"
              icon={PeopleIcon}
              state={panes.left}
              controls={paneControls}
              resizeLabel="Resize people list"
            >
              {peoplePanel}
            </SidePane>
            <section className="pane pane-tree" aria-label="Tree">
              {treePanel}
            </section>
            <SidePane
              side="right"
              title="Person"
              icon={PersonIcon}
              state={panes.right}
              controls={paneControls}
              resizeLabel="Resize details"
            >
              {personPanel}
            </SidePane>
          </>
        )}
        {layout === 'medium' && (
          <>
            <section className="pane pane-tree" aria-label="Tree">
              {treePanel}
            </section>
            <SidePane
              side="right"
              title="Side panel"
              icon={PersonIcon}
              state={panes.right}
              controls={paneControls}
              resizeLabel="Resize side panel"
              header={
                <div className="side-tabs" role="tablist" aria-label="Side panel">
                  <button type="button" role="tab" aria-selected={mobileTab === 'people'} onClick={() => setMobileTab('people')}>
                    <PeopleIcon /> People
                  </button>
                  <button type="button" role="tab" aria-selected={mobileTab !== 'people'} onClick={() => setMobileTab('person')}>
                    <PersonIcon /> Person
                  </button>
                </div>
              }
            >
              <div role="tabpanel" className="side-panel-body">
                {mobileTab === 'people' ? peoplePanel : personPanel}
              </div>
            </SidePane>
          </>
        )}
        {layout === 'narrow' && (
          <div className="pane pane-single">
            {mobileTab === 'people' && peoplePanel}
            {mobileTab === 'tree' && (
              <>
                {treePanel}
                {selected && (
                  <div className="mobile-selection">
                    <span className="mobile-selection-name">{displayName(selected)}</span>
                    <button type="button" className="button button-primary button-small" onClick={() => setMobileTab('person')}>
                      Details
                    </button>
                  </div>
                )}
              </>
            )}
            {mobileTab === 'person' && personPanel}
          </div>
        )}
      </main>

      {layout === 'narrow' && (
        <nav className="bottom-nav" aria-label="Views">
          {(
            [
              ['people', 'People', PeopleIcon],
              ['tree', 'Tree', TreeIcon],
              ['person', 'Person', PersonIcon],
            ] as const
          ).map(([tab, label, Icon]) => (
            <button key={tab} type="button" aria-current={mobileTab === tab ? 'page' : undefined} onClick={() => setMobileTab(tab)}>
              <Icon />
              <span>{label}</span>
            </button>
          ))}
        </nav>
      )}

      <div className="visually-hidden" aria-live="polite" role="status">
        {announcement}
      </div>
      {renderDialog()}
    </div>
  );
}
