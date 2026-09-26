/**
 * Undoable editing state for an open tree.
 *
 * Each committed change gets a new revision number; the tree is "dirty" when the
 * current revision differs from the last saved one, so undoing back to the saved
 * state correctly clears the unsaved-changes indicator.
 */
import { useCallback, useMemo, useReducer, useRef } from 'react';
import { TreeError } from '../model/tree';
import type { FamilyTreeDocument } from '../model/types';

const HISTORY_LIMIT = 100;

interface Snapshot {
  tree: FamilyTreeDocument;
  revision: number;
  label: string;
}

export interface EditorState {
  current: Snapshot;
  past: Snapshot[];
  future: Snapshot[];
  savedRevision: number;
  nextRevision: number;
}

type Action =
  | { type: 'commit'; tree: FamilyTreeDocument; label: string }
  | { type: 'undo' }
  | { type: 'redo' }
  | { type: 'markSaved'; revision: number };

export function initialEditorState(tree: FamilyTreeDocument, saved: boolean): EditorState {
  return {
    current: { tree, revision: 1, label: 'Open' },
    past: [],
    future: [],
    savedRevision: saved ? 1 : 0,
    nextRevision: 2,
  };
}

export function editorReducer(state: EditorState, action: Action): EditorState {
  switch (action.type) {
    case 'commit':
      return {
        ...state,
        current: { tree: action.tree, revision: state.nextRevision, label: action.label },
        past: [...state.past, state.current].slice(-HISTORY_LIMIT),
        future: [],
        nextRevision: state.nextRevision + 1,
      };
    case 'undo': {
      const previous = state.past[state.past.length - 1];
      if (!previous) return state;
      return { ...state, current: previous, past: state.past.slice(0, -1), future: [state.current, ...state.future] };
    }
    case 'redo': {
      const [next, ...rest] = state.future;
      if (!next) return state;
      return { ...state, current: next, past: [...state.past, state.current], future: rest };
    }
    case 'markSaved':
      return { ...state, savedRevision: action.revision };
  }
}

export interface TreeEditor {
  tree: FamilyTreeDocument;
  revision: number;
  dirty: boolean;
  canUndo: boolean;
  canRedo: boolean;
  undoLabel?: string;
  redoLabel?: string;
  /**
   * Applies a change. Returns an error message if the change was rejected
   * (e.g. it would create an impossible relationship), otherwise undefined.
   */
  apply: (label: string, change: (tree: FamilyTreeDocument) => FamilyTreeDocument) => string | undefined;
  undo: () => void;
  redo: () => void;
  markSaved: (revision: number) => void;
}

export function useTreeEditor(initialTree: FamilyTreeDocument, initiallySaved: boolean): TreeEditor {
  const [state, dispatch] = useReducer(editorReducer, undefined, () => initialEditorState(initialTree, initiallySaved));
  const treeRef = useRef(state.current.tree);
  treeRef.current = state.current.tree;

  const apply = useCallback<TreeEditor['apply']>((label, change) => {
    try {
      const next = change(treeRef.current);
      if (next === treeRef.current) return undefined;
      const stamped = { ...next, updatedAt: new Date().toISOString() };
      treeRef.current = stamped;
      dispatch({ type: 'commit', tree: stamped, label });
      return undefined;
    } catch (error) {
      if (error instanceof TreeError) return error.message;
      throw error;
    }
  }, []);

  const undo = useCallback(() => dispatch({ type: 'undo' }), []);
  const redo = useCallback(() => dispatch({ type: 'redo' }), []);
  const markSaved = useCallback((revision: number) => dispatch({ type: 'markSaved', revision }), []);

  return useMemo(
    () => ({
      tree: state.current.tree,
      revision: state.current.revision,
      dirty: state.current.revision !== state.savedRevision,
      canUndo: state.past.length > 0,
      canRedo: state.future.length > 0,
      undoLabel: state.past.length > 0 ? state.current.label : undefined,
      redoLabel: state.future[0]?.label,
      apply,
      undo,
      redo,
      markSaved,
    }),
    [state, apply, undo, redo, markSaved],
  );
}
