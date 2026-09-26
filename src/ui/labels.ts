import type {
  AlternateNameType,
  DateQualifier,
  LivingStatus,
  ParentLinkKind,
  PartnershipEndReason,
  PartnershipKind,
  Sex,
} from '../model/types';
import type { SiblingKind } from '../model/relatives';

export const SEX_LABELS: Record<Sex, string> = {
  female: 'Female',
  male: 'Male',
  intersex: 'Intersex',
  unknown: 'Unknown',
};

export const LIVING_LABELS: Record<LivingStatus, string> = {
  living: 'Living',
  deceased: 'Deceased',
  unknown: 'Not known',
};

export const ALTERNATE_NAME_LABELS: Record<AlternateNameType, string> = {
  birth: 'Birth name',
  married: 'Married name',
  nickname: 'Nickname',
  religious: 'Religious name',
  other: 'Other name',
};

export const PARENT_KIND_LABELS: Record<ParentLinkKind, string> = {
  biological: 'Biological',
  adoptive: 'Adoptive',
  step: 'Step',
  foster: 'Foster',
  guardian: 'Guardian',
  unknown: 'Not specified',
};

export const PARTNERSHIP_KIND_LABELS: Record<PartnershipKind, string> = {
  marriage: 'Marriage',
  'civil-union': 'Civil union',
  partnership: 'Partnership',
  engagement: 'Engagement',
  other: 'Other',
};

export const END_REASON_LABELS: Record<PartnershipEndReason, string> = {
  divorce: 'Divorce',
  separation: 'Separation',
  annulment: 'Annulment',
  death: 'Death of a partner',
  other: 'Other',
};

export const QUALIFIER_LABELS: Record<DateQualifier, string> = {
  exact: 'Exactly',
  about: 'About',
  before: 'Before',
  after: 'After',
  between: 'Between',
};

export const SIBLING_LABELS: Record<SiblingKind, string> = {
  full: 'Sibling',
  half: 'Half-sibling',
  step: 'Step-sibling',
};

export const EVENT_TYPE_SUGGESTIONS = [
  'Baptism',
  'Christening',
  'Bar/Bat mitzvah',
  'Graduation',
  'Education',
  'Occupation',
  'Military service',
  'Residence',
  'Immigration',
  'Emigration',
  'Naturalisation',
  'Retirement',
  'Burial',
  'Cremation',
];
