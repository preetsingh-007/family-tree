/**
 * Migration of older document versions to the current one.
 *
 * To introduce version N+1: bump DOCUMENT_VERSION in types.ts, add a function to
 * MIGRATIONS that converts a version-N object into version N+1, and document the
 * change in docs/DATA_FORMAT.md. Migrations run in sequence, so a file of any
 * older supported version can always be opened.
 */
import { DOCUMENT_FORMAT, DOCUMENT_VERSION } from './types';

type Migration = (doc: Record<string, unknown>) => Record<string, unknown>;

/** MIGRATIONS[v] upgrades a version-v document to version v + 1. */
const MIGRATIONS: Record<number, Migration> = {};

export type MigrationResult = { ok: true; value: unknown } | { ok: false; errors: string[] };

export function migrateToCurrent(input: unknown): MigrationResult {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    return { ok: false, errors: ['This is not a family-tree document.'] };
  }
  let doc = input as Record<string, unknown>;
  if (doc.format !== DOCUMENT_FORMAT) {
    return { ok: false, errors: ['This is not a family-tree document (unrecognised "format").'] };
  }
  const version = doc.version;
  if (typeof version !== 'number' || !Number.isInteger(version) || version < 1) {
    return { ok: false, errors: ['The document version is missing or invalid.'] };
  }
  if (version > DOCUMENT_VERSION) {
    return {
      ok: false,
      errors: [
        `This file uses data format version ${version}, which is newer than this application supports (version ${DOCUMENT_VERSION}). Please use a newer version of the application.`,
      ],
    };
  }
  for (let v = version; v < DOCUMENT_VERSION; v++) {
    const migrate = MIGRATIONS[v];
    if (!migrate) return { ok: false, errors: [`No migration is available from data format version ${v}.`] };
    doc = { ...migrate(doc), version: v + 1 };
  }
  return { ok: true, value: doc };
}
