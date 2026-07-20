interface HighlightedSnippetProps {
  snippet: string;
  query: string;
}

export function HighlightedSnippet({ snippet, query }: HighlightedSnippetProps) {
  const terms = query.split(/\s+/).filter((term) => term.length > 2);
  if (terms.length === 0) return <span>{snippet}</span>;

  const escaped = terms.map((term) => term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  const regex = new RegExp(`(${escaped.join('|')})`, 'gi');
  const normalizedTerms = new Set(terms.map((term) => term.toLowerCase()));

  return (
    <span>
      {snippet.split(regex).map((part, index) =>
        normalizedTerms.has(part.toLowerCase())
          ? <mark key={index}>{part}</mark>
          : <span key={index}>{part}</span>
      )}
    </span>
  );
}
