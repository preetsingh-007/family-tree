import { describe, expect, it } from 'vitest';
import { addPerson, createEmptyTree } from '../model/tree';
import { person } from '../test/fixtures';
import { editorReducer, initialEditorState } from './editor';

describe('editor history', () => {
  const base = createEmptyTree('T');
  const one = addPerson(base, person('A', 'X'));
  const two = addPerson(one, person('B', 'X'));

  it('tracks unsaved changes, including undo back to the saved state', () => {
    let state = initialEditorState(base, true);
    const dirty = () => state.current.revision !== state.savedRevision;
    expect(dirty()).toBe(false);

    state = editorReducer(state, { type: 'commit', tree: one, label: 'Add A' });
    expect(dirty()).toBe(true);
    state = editorReducer(state, { type: 'undo' });
    expect(state.current.tree).toBe(base);
    expect(dirty()).toBe(false);
    state = editorReducer(state, { type: 'redo' });
    expect(state.current.tree).toBe(one);
    expect(dirty()).toBe(true);

    state = editorReducer(state, { type: 'markSaved', revision: state.current.revision });
    expect(dirty()).toBe(false);
  });

  it('discards the redo stack after a new change', () => {
    let state = initialEditorState(base, false);
    state = editorReducer(state, { type: 'commit', tree: one, label: 'Add A' });
    state = editorReducer(state, { type: 'undo' });
    state = editorReducer(state, { type: 'commit', tree: two, label: 'Add B' });
    expect(state.future).toEqual([]);
    expect(state.past.map((s) => s.tree)).toEqual([base]);
  });

  it('marks newly created or imported trees as unsaved', () => {
    const state = initialEditorState(base, false);
    expect(state.current.revision).not.toBe(state.savedRevision);
  });

  it('ignores undo/redo at the ends of history', () => {
    const state = initialEditorState(base, true);
    expect(editorReducer(state, { type: 'undo' })).toBe(state);
    expect(editorReducer(state, { type: 'redo' })).toBe(state);
  });
});
