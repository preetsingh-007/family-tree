import { useId, useRef, useState } from 'react';
import { Markdown } from './Markdown';

interface Props {
  label: string;
  value: string;
  onChange: (value: string) => void;
  rows?: number;
  placeholder?: string;
}

type Format =
  | { kind: 'wrap'; before: string; after: string; placeholder: string }
  | { kind: 'line'; prefix: string; placeholder: string };

const ACTIONS: { label: string; title: string; format: Format }[] = [
  { label: 'B', title: 'Bold', format: { kind: 'wrap', before: '**', after: '**', placeholder: 'bold text' } },
  { label: 'I', title: 'Italic', format: { kind: 'wrap', before: '_', after: '_', placeholder: 'italic text' } },
  { label: 'H', title: 'Heading', format: { kind: 'line', prefix: '## ', placeholder: 'Heading' } },
  { label: '•', title: 'Bulleted list', format: { kind: 'line', prefix: '- ', placeholder: 'List item' } },
  { label: '1.', title: 'Numbered list', format: { kind: 'line', prefix: '1. ', placeholder: 'List item' } },
  { label: '❝', title: 'Quote', format: { kind: 'line', prefix: '> ', placeholder: 'Quotation' } },
  { label: '</>', title: 'Code', format: { kind: 'wrap', before: '`', after: '`', placeholder: 'code' } },
  { label: 'Link', title: 'Link', format: { kind: 'wrap', before: '[', after: '](https://)', placeholder: 'link text' } },
];

/** Markdown textarea with a formatting toolbar and a live preview tab. */
export function MarkdownEditor({ label, value, onChange, rows = 8, placeholder }: Props) {
  const id = useId();
  const [tab, setTab] = useState<'write' | 'preview'>('write');
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const applyFormat = (format: Format) => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    const { selectionStart: start, selectionEnd: end } = textarea;
    const selected = value.slice(start, end) || format.placeholder;
    let insert: string;
    let selectFrom: number;
    if (format.kind === 'line') {
      const atLineStart = start === 0 || value[start - 1] === '\n';
      insert = (atLineStart ? '' : '\n') + selected.split('\n').map((line) => format.prefix + line).join('\n');
      selectFrom = start + (atLineStart ? 0 : 1) + format.prefix.length;
    } else {
      insert = format.before + selected + format.after;
      selectFrom = start + format.before.length;
    }
    onChange(value.slice(0, start) + insert + value.slice(end));
    requestAnimationFrame(() => {
      textarea.focus();
      textarea.setSelectionRange(selectFrom, selectFrom + selected.length);
    });
  };

  return (
    <div className="md-editor">
      <div className="md-editor-bar">
        <label htmlFor={id} className="field-label">
          {label}
        </label>
        <div className="segmented" role="group" aria-label={`${label} view`}>
          <button type="button" aria-pressed={tab === 'write'} onClick={() => setTab('write')}>
            Write
          </button>
          <button type="button" aria-pressed={tab === 'preview'} onClick={() => setTab('preview')}>
            Preview
          </button>
        </div>
      </div>
      {tab === 'write' ? (
        <>
          <div className="md-toolbar" role="toolbar" aria-label="Formatting">
            {ACTIONS.map((action) => (
              <button
                key={action.title}
                type="button"
                className="md-tool"
                title={action.title}
                aria-label={action.title}
                onClick={() => applyFormat(action.format)}
              >
                {action.label}
              </button>
            ))}
          </div>
          <textarea
            id={id}
            ref={textareaRef}
            className="input md-textarea"
            value={value}
            rows={rows}
            placeholder={placeholder}
            onChange={(event) => onChange(event.target.value)}
          />
          <p className="hint">
            Supports Markdown: **bold**, _italic_, # headings, - lists, &gt; quotes, [links](https://…). HTML is shown as plain text.
          </p>
        </>
      ) : (
        <div className="md-preview" aria-live="polite">
          {value.trim() ? <Markdown source={value} /> : <p className="muted">Nothing to preview yet.</p>}
        </div>
      )}
    </div>
  );
}
