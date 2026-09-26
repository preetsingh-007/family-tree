import { describe, expect, it } from 'vitest';
import { renderMarkdown } from './render';

describe('markdown rendering', () => {
  it('renders standard Markdown', () => {
    const html = renderMarkdown(
      ['# Title', '', 'Some *emphasis* and **strong** text.', '', '- one', '- two', '', '1. first', '', '> quoted', '', '`code`', '', '[site](https://example.org)'].join('\n'),
    );
    expect(html).toContain('<h1>Title</h1>');
    expect(html).toContain('<em>emphasis</em>');
    expect(html).toContain('<strong>strong</strong>');
    expect(html).toContain('<ul>');
    expect(html).toContain('<ol>');
    expect(html).toContain('<blockquote>');
    expect(html).toContain('<code>code</code>');
    expect(html).toContain('<a href="https://example.org" target="_blank" rel="noopener noreferrer nofollow">site</a>');
  });

  it.each([
    '<script>alert(1)</script>',
    '<img src=x onerror=alert(1)>',
    '<iframe src="https://evil.example"></iframe>',
    '<a href="javascript:alert(1)">x</a>',
    '<svg onload=alert(1)>',
    '<div style="background:url(javascript:alert(1))">x</div>',
  ])('escapes raw HTML: %s', (input) => {
    const html = renderMarkdown(input);
    expect(html).not.toMatch(/<(script|img|iframe|svg|div)\b/i);
    expect(html).not.toMatch(/<a\s[^>]*href="(?!https?:)/i);
    expect(html).not.toMatch(/<[^>]+\son\w+=/i);
  });

  it.each([
    '[click](javascript:alert(1))',
    '[click](JAVASCRIPT:alert(1))',
    '[click]( javascript:alert(1))',
    '[click](vbscript:msgbox(1))',
    '[click](data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==)',
    '[click](file:///etc/passwd)',
    '<javascript:alert(1)>',
  ])('does not create dangerous links: %s', (input) => {
    const html = renderMarkdown(input);
    expect(html).not.toMatch(/href="(?!https?:|mailto:)/i);
    expect(html).not.toMatch(/<a[^>]+href="[^"]*(javascript|vbscript|data|file):/i);
  });

  it('never loads remote images', () => {
    const html = renderMarkdown('![portrait](https://tracker.example/pixel.png)');
    expect(html).not.toContain('<img');
    expect(html).toContain('href="https://tracker.example/pixel.png"');
    expect(renderMarkdown('![x](javascript:alert(1))')).not.toContain('<a');
  });

  it('escapes attribute-breaking characters in link text and targets', () => {
    const html = renderMarkdown('[x](https://example.org/"onmouseover="alert(1))');
    expect(html).not.toMatch(/"\s*onmouseover=/);
  });
});
