import { useId } from 'react';
import { MONTH_NAMES } from '../model/dates';
import { DATE_QUALIFIERS, type DateQualifier } from '../model/types';
import type { DateDraft } from './dateDraft';
import { QUALIFIER_LABELS } from './labels';

interface Props {
  legend: string;
  value: DateDraft;
  onChange: (value: DateDraft) => void;
  error?: string;
}

function PartFields({
  prefix,
  day,
  month,
  year,
  onChange,
  groupLabel,
}: {
  prefix: string;
  day: string;
  month: string;
  year: string;
  onChange: (part: 'day' | 'month' | 'year', value: string) => void;
  groupLabel?: string;
}) {
  return (
    <div className="date-parts" role={groupLabel ? 'group' : undefined} aria-label={groupLabel}>
      <label className="date-part date-day">
        <span className="field-label-small">Day</span>
        <input
          className="input"
          id={`${prefix}-day`}
          inputMode="numeric"
          autoComplete="off"
          value={day}
          maxLength={2}
          onChange={(e) => onChange('day', e.target.value)}
        />
      </label>
      <label className="date-part date-month">
        <span className="field-label-small">Month</span>
        <select className="input" value={month} onChange={(e) => onChange('month', e.target.value)}>
          <option value="">—</option>
          {MONTH_NAMES.map((name, i) => (
            <option key={name} value={String(i + 1)}>
              {name}
            </option>
          ))}
        </select>
      </label>
      <label className="date-part date-year">
        <span className="field-label-small">Year</span>
        <input
          className="input"
          inputMode="numeric"
          autoComplete="off"
          value={year}
          maxLength={6}
          onChange={(e) => onChange('year', e.target.value)}
        />
      </label>
    </div>
  );
}

/**
 * Date entry that allows any level of precision: leave day and month blank for a
 * year-only date, choose "About" for approximate dates, or leave everything blank
 * when the date is unknown.
 */
export function DateInput({ legend, value, onChange, error }: Props) {
  const id = useId();
  const set = (patch: Partial<DateDraft>) => onChange({ ...value, ...patch });
  return (
    <fieldset className="date-input" aria-describedby={error ? `${id}-error` : undefined}>
      <legend className="field-label">{legend}</legend>
      <div className="date-row">
        <label className="date-part date-qualifier">
          <span className="field-label-small">Precision</span>
          <select className="input" value={value.qualifier} onChange={(e) => set({ qualifier: e.target.value as DateQualifier })}>
            {DATE_QUALIFIERS.map((q) => (
              <option key={q} value={q}>
                {QUALIFIER_LABELS[q]}
              </option>
            ))}
          </select>
        </label>
        <PartFields
          prefix={`${id}-start`}
          groupLabel={value.qualifier === 'between' ? `${legend}, from` : undefined}
          day={value.day}
          month={value.month}
          year={value.year}
          onChange={(part, v) => set({ [part]: v })}
        />
      </div>
      {value.qualifier === 'between' && (
        <div className="date-row">
          <span className="date-and">and</span>
          <PartFields
            prefix={`${id}-end`}
            groupLabel={`${legend}, to`}
            day={value.endDay}
            month={value.endMonth}
            year={value.endYear}
            onChange={(part, v) =>
              set({ [`end${part[0]!.toUpperCase()}${part.slice(1)}`]: v } as Partial<DateDraft>)
            }
          />
        </div>
      )}
      <label className="date-text">
        <span className="field-label-small">Original wording (optional)</span>
        <input
          className="input"
          value={value.text}
          placeholder="e.g. “Spring 1890” or “shortly after the war”"
          onChange={(e) => set({ text: e.target.value })}
        />
      </label>
      {error && (
        <p className="field-error" id={`${id}-error`} role="alert">
          {error}
        </p>
      )}
    </fieldset>
  );
}
