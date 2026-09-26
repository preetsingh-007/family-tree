import { describe, expect, it } from 'vitest';
import { clearDraft, loadDraft, saveDraft } from './drafts';

describe('encrypted drafts', () => {
  it('stores, loads and clears a draft', async () => {
    expect(await loadDraft()).toBeUndefined();
    await saveDraft({ container: '{"format":"family-tree-encrypted"}', savedAt: '2026-01-01T00:00:00.000Z' });
    expect(await loadDraft()).toEqual({ container: '{"format":"family-tree-encrypted"}', savedAt: '2026-01-01T00:00:00.000Z' });
    await clearDraft();
    expect(await loadDraft()).toBeUndefined();
  });
});
