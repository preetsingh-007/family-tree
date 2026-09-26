/**
 * Safe Markdown rendering.
 *
 * markdown-it is configured with raw HTML disabled, so any HTML in a note is
 * shown as literal text. Link targets are restricted to http(s) and mailto,
 * and images are rendered as plain links: loading remote images would reveal
 * to a third party that the tree is being viewed.
 */
import MarkdownIt from 'markdown-it';

const SAFE_URL = /^(https?:|mailto:)/i;

const md = new MarkdownIt({ html: false, linkify: true, typographer: true, breaks: false });

md.validateLink = (url: string) => SAFE_URL.test(url.trim());

md.renderer.rules.image = (tokens, idx) => {
  const token = tokens[idx]!;
  const src = String(token.attrGet('src') ?? '');
  const alt = md.utils.escapeHtml(token.content || src);
  if (!SAFE_URL.test(src)) return alt;
  return `<a href="${md.utils.escapeHtml(src)}" target="_blank" rel="noopener noreferrer nofollow">${alt}</a>`;
};

const defaultLinkOpen =
  md.renderer.rules.link_open ?? ((tokens, idx, options, _env, self) => self.renderToken(tokens, idx, options));

md.renderer.rules.link_open = (tokens, idx, options, env, self) => {
  const token = tokens[idx]!;
  token.attrSet('target', '_blank');
  token.attrSet('rel', 'noopener noreferrer nofollow');
  return defaultLinkOpen(tokens, idx, options, env, self);
};

export function renderMarkdown(source: string): string {
  return md.render(source);
}
