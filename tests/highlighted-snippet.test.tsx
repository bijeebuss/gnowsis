import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { HighlightedSnippet } from '../app/components/HighlightedSnippet';

describe('HighlightedSnippet', () => {
  it('escapes document HTML while retaining highlights', () => {
    const html = renderToStaticMarkup(
      <HighlightedSnippet snippet={'invoice <img src=x onerror=alert(1)>'} query="invoice" />,
    );
    expect(html).toContain('<mark>invoice</mark>');
    expect(html).toContain('&lt;img');
    expect(html).not.toContain('<img');
  });

  it('treats regex characters in the query literally', () => {
    expect(() => renderToStaticMarkup(
      <HighlightedSnippet snippet="price is (test) today" query="(test)" />,
    )).not.toThrow();
  });
});
