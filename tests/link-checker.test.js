import { describe, it, expect } from 'vitest';

function extractLinks(html, sourceUrl, baseUrl) {
  const linkRegex = /href=["']([^"'#][^"']*)["']/gi;
  const links = [];
  let match;
  while ((match = linkRegex.exec(html)) !== null) {
    try {
      const url = new URL(match[1], sourceUrl).href;
      if (url.startsWith('http') && !url.includes(baseUrl)) links.push(url);
    } catch {
      // skip malformed URLs
    }
  }
  return [...new Set(links)];
}

describe('extractLinks', () => {
  const source = 'https://example.com/post/1';
  const base = 'example.com';

  it('extracts external links', () => {
    const html = '<a href="https://other.com/page">link</a>';
    expect(extractLinks(html, source, base)).toContain('https://other.com/page');
  });

  it('excludes internal links', () => {
    const html = '<a href="https://example.com/other">link</a>';
    expect(extractLinks(html, source, base)).toHaveLength(0);
  });

  it('excludes anchor-only links', () => {
    const html = '<a href="#section">link</a>';
    expect(extractLinks(html, source, base)).toHaveLength(0);
  });

  it('deduplicates identical URLs', () => {
    const html = '<a href="https://other.com/p">a</a><a href="https://other.com/p">b</a>';
    expect(extractLinks(html, source, base)).toHaveLength(1);
  });

  it('skips malformed URLs gracefully', () => {
    const html = '<a href="not a url">x</a>';
    expect(() => extractLinks(html, source, base)).not.toThrow();
  });

  it('resolves relative URLs against source', () => {
    const html = '<a href="//other.com/path">link</a>';
    const links = extractLinks(html, source, base);
    expect(links.some((l) => l.includes('other.com'))).toBe(true);
  });
});
