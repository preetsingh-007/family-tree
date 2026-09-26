/** Conversion between FuzzyDate and the string-valued form fields used while editing. */
import { validateFuzzyDate } from '../model/dates';
import type { DateParts, DateQualifier, FuzzyDate } from '../model/types';

export interface DateDraft {
  qualifier: DateQualifier;
  day: string;
  month: string;
  year: string;
  endDay: string;
  endMonth: string;
  endYear: string;
  text: string;
}

export const EMPTY_DATE_DRAFT: DateDraft = {
  qualifier: 'exact',
  day: '',
  month: '',
  year: '',
  endDay: '',
  endMonth: '',
  endYear: '',
  text: '',
};

const str = (n: number | undefined) => (n === undefined ? '' : String(n));

export function toDateDraft(date: FuzzyDate | undefined): DateDraft {
  if (!date) return EMPTY_DATE_DRAFT;
  return {
    qualifier: date.qualifier,
    day: str(date.day),
    month: str(date.month),
    year: str(date.year),
    endDay: str(date.end?.day),
    endMonth: str(date.end?.month),
    endYear: str(date.end?.year),
    text: date.text ?? '',
  };
}

function parseNumber(value: string, label: string, errors: string[]): number | undefined {
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  if (!/^-?\d+$/.test(trimmed)) {
    errors.push(`${label} must be a whole number.`);
    return undefined;
  }
  return Number(trimmed);
}

function parts(day: string, month: string, year: string, label: string, errors: string[]): DateParts {
  const result: DateParts = {};
  const d = parseNumber(day, `${label}: day`, errors);
  const m = parseNumber(month, `${label}: month`, errors);
  const y = parseNumber(year, `${label}: year`, errors);
  if (d !== undefined) result.day = d;
  if (m !== undefined) result.month = m;
  if (y !== undefined) result.year = y;
  return result;
}

/** Returns the date (undefined when all fields are empty) and any problems with it. */
export function fromDateDraft(draft: DateDraft, label: string): { date?: FuzzyDate; errors: string[] } {
  const errors: string[] = [];
  const start = parts(draft.day, draft.month, draft.year, label, errors);
  const text = draft.text.trim();
  const hasStart = Object.keys(start).length > 0;
  if (!hasStart && !text) {
    return { errors };
  }
  const date: FuzzyDate = { ...start, qualifier: draft.qualifier };
  if (draft.qualifier === 'between') {
    const end = parts(draft.endDay, draft.endMonth, draft.endYear, `${label} (end)`, errors);
    if (Object.keys(end).length) date.end = end;
  }
  if (text) date.text = text;
  if (errors.length) return { errors };
  if (hasStart) errors.push(...validateFuzzyDate(date, label));
  return errors.length ? { errors } : { date, errors };
}
