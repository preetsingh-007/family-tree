import { useMemo } from 'react';
import { renderMarkdown } from '../markdown/render';

/** Renders user-authored Markdown. Raw HTML is disabled in the renderer, so this is safe to inject. */
export function Markdown({ source, className = '' }: { source: string; className?: string }) {
  const html = useMemo(() => renderMarkdown(source), [source]);
  return <div className={`markdown ${className}`} dangerouslySetInnerHTML={{ __html: html }} />;
}
