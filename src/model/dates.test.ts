import { describe, expect, it } from 'vitest';
import { dateSortKey, daysInMonth, formatFuzzyDate, formatYearOnly, validateFuzzyDate } from './dates';

describe('fuzzy dates', () => {
  it('formats every level of precision', () => {
    expect(formatFuzzyDate({ qualifier: 'exact', year: 1890, month: 3, day: 12 })).toBe('12 March 1890');
    expect(formatFuzzyDate({ qualifier: 'exact', year: 1890, month: 3 })).toBe('March 1890');
    expect(formatFuzzyDate({ qualifier: 'exact', year: 1890 })).toBe('1890');
    expect(formatFuzzyDate({ qualifier: 'exact', month: 3, day: 12 })).toBe('12 March');
    expect(formatFuzzyDate({ qualifier: 'about', year: 1890 })).toBe('about 1890');
    expect(formatFuzzyDate({ qualifier: 'before', year: 1890 })).toBe('before 1890');
    expect(formatFuzzyDate({ qualifier: 'after', year: 1890 })).toBe('after 1890');
    expect(formatFuzzyDate({ qualifier: 'between', year: 1890, end: { year: 1895 } })).toBe('between 1890 and 1895');
    expect(formatFuzzyDate({ qualifier: 'exact', text: 'Spring, year unknown' })).toBe('Spring, year unknown');
    expect(formatFuzzyDate({ qualifier: 'exact', year: 1890, text: 'Spring 1890' })).toBe('1890 (“Spring 1890”)');
    expect(formatFuzzyDate({ qualifier: 'exact', year: -44 })).toBe('44 BC');
    expect(formatFuzzyDate(undefined)).toBe('');
  });

  it('formats short year labels for the tree', () => {
    expect(formatYearOnly({ qualifier: 'about', year: 1890 })).toBe('c. 1890');
    expect(formatYearOnly({ qualifier: 'between', year: 1890, end: { year: 1895 } })).toBe('1890–1895');
    expect(formatYearOnly({ qualifier: 'exact', text: 'unknown' })).toBe('?');
    expect(formatYearOnly(undefined)).toBe('');
  });

  it('accepts real dates and partial dates', () => {
    expect(validateFuzzyDate({ qualifier: 'exact', year: 2000, month: 2, day: 29 })).toEqual([]);
    expect(validateFuzzyDate({ qualifier: 'exact', month: 2, day: 29 })).toEqual([]);
    expect(validateFuzzyDate({ qualifier: 'exact', year: 1890 })).toEqual([]);
  });

  it('rejects malformed dates', () => {
    expect(validateFuzzyDate({ qualifier: 'exact', year: 1900, month: 2, day: 29 })).toHaveLength(1);
    expect(validateFuzzyDate({ qualifier: 'exact', year: 1900, month: 13 })).toHaveLength(1);
    expect(validateFuzzyDate({ qualifier: 'exact', year: 1900, day: 3 })).toHaveLength(1);
    expect(validateFuzzyDate({ qualifier: 'exact', year: 0 })).toHaveLength(1);
    expect(validateFuzzyDate({ qualifier: 'exact', year: 1.5 })).toHaveLength(1);
    expect(validateFuzzyDate({ qualifier: 'between', year: 1900 })).toHaveLength(1);
    expect(validateFuzzyDate({ qualifier: 'between', year: 1900, end: { year: 1890 } })).toHaveLength(1);
  });

  it('orders dates and knows month lengths', () => {
    expect(dateSortKey({ year: 1890, month: 3, day: 12 })).toBeLessThan(dateSortKey({ year: 1890, month: 4 })!);
    expect(dateSortKey({ month: 4 })).toBeUndefined();
    expect(daysInMonth(2, 1900)).toBe(28);
    expect(daysInMonth(2)).toBe(29);
    expect(daysInMonth(4, 2001)).toBe(30);
  });
});
