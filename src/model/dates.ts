import type { DateParts, FuzzyDate } from './types';

export const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
] as const;

const MONTH_ABBREVIATIONS = MONTH_NAMES.map((m) => m.slice(0, 3));

export const MIN_YEAR = -9999;
export const MAX_YEAR = 9999;

function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

/** Days in a month; when the year is unknown February allows 29 days. */
export function daysInMonth(month: number, year?: number): number {
  if (month === 2) return year === undefined || isLeapYear(year) ? 29 : 28;
  return [4, 6, 9, 11].includes(month) ? 30 : 31;
}

export function hasDateParts(parts: DateParts | undefined): boolean {
  return !!parts && (parts.year !== undefined || parts.month !== undefined || parts.day !== undefined);
}

/** True when the date carries any information at all. */
export function isDateKnown(date: FuzzyDate | undefined): date is FuzzyDate {
  return !!date && (hasDateParts(date) || !!date.text?.trim());
}

/** Returns human-readable problems with a set of date parts (empty when valid). */
export function validateDateParts(parts: DateParts, label = 'Date'): string[] {
  const errors: string[] = [];
  const { year, month, day } = parts;
  if (year !== undefined && (!Number.isInteger(year) || year < MIN_YEAR || year > MAX_YEAR || year === 0)) {
    errors.push(`${label}: year must be a whole number between ${MIN_YEAR} and ${MAX_YEAR} (and not 0).`);
  }
  if (month !== undefined && (!Number.isInteger(month) || month < 1 || month > 12)) {
    errors.push(`${label}: month must be between 1 and 12.`);
  }
  if (day !== undefined) {
    if (month === undefined) {
      errors.push(`${label}: a day needs a month.`);
    } else if (!Number.isInteger(day) || day < 1 || (Number.isInteger(month) && day > daysInMonth(month, year))) {
      errors.push(`${label}: day ${day} does not exist in ${MONTH_NAMES[month - 1] ?? 'that month'}.`);
    }
  }
  return errors;
}

/** Numeric key used to order dates; undefined when the year is unknown. */
export function dateSortKey(parts: DateParts | undefined): number | undefined {
  if (!parts || parts.year === undefined) return undefined;
  return parts.year * 10_000 + (parts.month ?? 0) * 100 + (parts.day ?? 0);
}

export function validateFuzzyDate(date: FuzzyDate, label = 'Date'): string[] {
  const errors = validateDateParts(date, label);
  if (date.qualifier === 'between') {
    if (!date.end || !hasDateParts(date.end)) {
      errors.push(`${label}: a "between" date needs an end date.`);
    } else {
      errors.push(...validateDateParts(date.end, `${label} (end)`));
      const start = dateSortKey(date);
      const end = dateSortKey(date.end);
      if (errors.length === 0 && start !== undefined && end !== undefined && end < start) {
        errors.push(`${label}: the end of the range is before its start.`);
      }
    }
  }
  return errors;
}

function formatYear(year: number): string {
  return year < 0 ? `${-year} BC` : String(year);
}

export function formatDateParts(parts: DateParts, style: 'long' | 'short' = 'long'): string {
  const names = style === 'long' ? MONTH_NAMES : MONTH_ABBREVIATIONS;
  const pieces: string[] = [];
  if (parts.day !== undefined) pieces.push(String(parts.day));
  if (parts.month !== undefined) pieces.push(names[parts.month - 1] ?? '?');
  if (parts.year !== undefined) pieces.push(formatYear(parts.year));
  return pieces.join(' ');
}

/** Formats a fuzzy date for display, e.g. "about 1890", "between 1890 and 1895", "12 March 1890". */
export function formatFuzzyDate(date: FuzzyDate | undefined, style: 'long' | 'short' = 'long'): string {
  if (!date) return '';
  const text = date.text?.trim();
  if (!hasDateParts(date)) return text ?? '';
  const main = formatDateParts(date, style);
  let formatted: string;
  switch (date.qualifier) {
    case 'about':
      formatted = style === 'short' ? `c. ${main}` : `about ${main}`;
      break;
    case 'before':
      formatted = `before ${main}`;
      break;
    case 'after':
      formatted = `after ${main}`;
      break;
    case 'between':
      formatted = date.end && hasDateParts(date.end)
        ? `${main} – ${formatDateParts(date.end, style)}`
        : main;
      if (style === 'long' && date.end && hasDateParts(date.end)) {
        formatted = `between ${main} and ${formatDateParts(date.end, style)}`;
      }
      break;
    default:
      formatted = main;
  }
  return text && style === 'long' ? `${formatted} (“${text}”)` : formatted;
}

/** A compact year label such as "c. 1890" used in tree nodes. */
export function formatYearOnly(date: FuzzyDate | undefined): string {
  if (!date || date.year === undefined) return date?.text?.trim() ? '?' : '';
  const year = formatYear(date.year);
  switch (date.qualifier) {
    case 'about':
      return `c. ${year}`;
    case 'before':
      return `bef. ${year}`;
    case 'after':
      return `aft. ${year}`;
    case 'between':
      return date.end?.year !== undefined && date.end.year !== date.year ? `${year}–${formatYear(date.end.year)}` : year;
    default:
      return year;
  }
}
