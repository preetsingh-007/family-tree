/**
 * Family-tree data model (document format version 1).
 *
 * The document is plain JSON so it can be read without this application.
 * See docs/DATA_FORMAT.md for the full, versioned specification.
 */

export type Id = string;

/** A partial calendar date. Any part may be missing. */
export interface DateParts {
  year?: number;
  /** 1–12 */
  month?: number;
  /** 1–31, validated against the month (and year, when known). */
  day?: number;
}

export const DATE_QUALIFIERS = ['exact', 'about', 'before', 'after', 'between'] as const;
export type DateQualifier = (typeof DATE_QUALIFIERS)[number];

/**
 * A date that may be incomplete or uncertain.
 * "Unknown" is represented by omitting the date entirely.
 */
export interface FuzzyDate extends DateParts {
  qualifier: DateQualifier;
  /** End of the range; only meaningful when qualifier is "between". */
  end?: DateParts;
  /** Original wording from a source, e.g. "Spring 1890" or "Michaelmas". */
  text?: string;
}

export interface LifeEvent {
  date?: FuzzyDate;
  place?: string;
  note?: string;
}

export const ALTERNATE_NAME_TYPES = ['birth', 'married', 'nickname', 'religious', 'other'] as const;
export type AlternateNameType = (typeof ALTERNATE_NAME_TYPES)[number];

export interface AlternateName {
  name: string;
  type: AlternateNameType;
}

export const SEX_VALUES = ['female', 'male', 'intersex', 'unknown'] as const;
export type Sex = (typeof SEX_VALUES)[number];

export const LIVING_STATUSES = ['living', 'deceased', 'unknown'] as const;
export type LivingStatus = (typeof LIVING_STATUSES)[number];

/** Any other dated event in a person's life (baptism, emigration, occupation, …). */
export interface PersonEvent extends LifeEvent {
  id: Id;
  type: string;
}

export interface CustomField {
  id: Id;
  label: string;
  value: string;
}

export interface Person {
  id: Id;
  givenNames: string;
  surname: string;
  /** Optional override for how the name is displayed (e.g. with titles or particles). */
  fullName?: string;
  alternateNames: AlternateName[];
  /** Omitted when the user chooses not to record it. */
  sex?: Sex;
  /** Free-text gender identity, recorded only if the user chooses to. */
  gender?: string;
  living: LivingStatus;
  birth?: LifeEvent;
  death?: LifeEvent;
  events: PersonEvent[];
  /** Markdown. */
  notes: string;
  customFields: CustomField[];
  /** References into FamilyTreeDocument.media; the first entry is the portrait. */
  mediaIds: Id[];
}

export const PARENT_LINK_KINDS = ['biological', 'adoptive', 'step', 'foster', 'guardian', 'unknown'] as const;
export type ParentLinkKind = (typeof PARENT_LINK_KINDS)[number];

/** A directed parent → child relationship. Siblings are derived from shared parents. */
export interface ParentLink {
  id: Id;
  parentId: Id;
  childId: Id;
  kind: ParentLinkKind;
  note?: string;
}

export const PARTNERSHIP_KINDS = ['marriage', 'civil-union', 'partnership', 'engagement', 'other'] as const;
export type PartnershipKind = (typeof PARTNERSHIP_KINDS)[number];

export const PARTNERSHIP_END_REASONS = ['divorce', 'separation', 'annulment', 'death', 'other'] as const;
export type PartnershipEndReason = (typeof PARTNERSHIP_END_REASONS)[number];

export interface PartnershipEnd extends LifeEvent {
  reason?: PartnershipEndReason;
}

/**
 * A couple relationship. A person may have any number of partnerships,
 * including more than one with the same person (e.g. remarriage).
 */
export interface Partnership {
  id: Id;
  partnerIds: [Id, Id];
  kind: PartnershipKind;
  start?: LifeEvent;
  end?: PartnershipEnd;
  note?: string;
}

/** Any other relationship between two people (godparent, guardian, close friend, …). */
export interface Association {
  id: Id;
  personIds: [Id, Id];
  /** What the first person is to the second, e.g. "godparent" (first person is the second's godparent). */
  label: string;
  note?: string;
}

export const MEDIA_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const;
export type MediaMimeType = (typeof MEDIA_MIME_TYPES)[number];

/** An image stored inline (base64) so it is encrypted together with the rest of the tree. */
export interface MediaItem {
  id: Id;
  mimeType: MediaMimeType;
  /** Base64-encoded image bytes. */
  data: string;
  caption?: string;
  width?: number;
  height?: number;
}

export const DOCUMENT_FORMAT = 'family-tree';
export const DOCUMENT_VERSION = 1;

export interface FamilyTreeDocument {
  format: typeof DOCUMENT_FORMAT;
  version: typeof DOCUMENT_VERSION;
  id: Id;
  title: string;
  /** Markdown notes about the family as a whole. */
  notes: string;
  /** ISO-8601 timestamps. */
  createdAt: string;
  updatedAt: string;
  people: Person[];
  parentLinks: ParentLink[];
  partnerships: Partnership[];
  associations: Association[];
  media: MediaItem[];
}
