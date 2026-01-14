/**
 * Search Page
 * Task 8.9: Build search page at /app/routes/search.tsx
 *
 * Features:
 * - Apply ProtectedRoute wrapper
 * - Search input with shadcn Input component
 * - Filter controls: date range, document type Select, tags multi-select
 * - Submit query to GET /api/documents/search with query params
 * - Display results list using shadcn Card components
 * - Each result shows: filename, relevance score, upload date, text snippet
 * - Highlight query terms in snippets with <mark> tags (yellow background)
 * - Show "No results found" empty state
 * - Add pagination controls: Previous/Next, 25 per page
 * - Click result card navigates to /documents/{id}/viewer
 */

import { createFileRoute, Link, useNavigate } from '@tanstack/react-router';
import { useState, useEffect } from 'react';
import { ProtectedRoute } from '../components/ProtectedRoute';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../components/ui/card';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../components/ui/select';
import { Search as SearchIcon, ChevronLeft, ChevronRight } from 'lucide-react';
import { authFetch } from '../utils/auth';

export const Route = createFileRoute('/search')({
  component: () => (
    <ProtectedRoute>
      <SearchPage />
    </ProtectedRoute>
  ),
});

interface SearchResult {
  document_id: string;
  filename: string;
  upload_date: string;
  file_type: string;
  relevance_score: number;
  snippet: string;
  page_number: number;
}

interface SearchResponse {
  results: SearchResult[];
  page: number;
  per_page: number;
  total: number;
  total_pages: number;
}

function SearchPage() {
  const [query, setQuery] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(0);
  const [total, setTotal] = useState(0);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');
  const [hasSearched, setHasSearched] = useState(false);

  // Filters
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [documentType, setDocumentType] = useState('');

  const performSearch = async (currentPage: number = 1) => {
    if (!searchQuery.trim()) {
      setError('Please enter a search query');
      return;
    }

    setIsLoading(true);
    setError('');
    setHasSearched(true);

    try {
      // Build query params
      const params = new URLSearchParams({
        q: searchQuery,
        page: currentPage.toString(),
        per_page: '25',
      });

      if (dateFrom) params.append('date_from', dateFrom);
      if (dateTo) params.append('date_to', dateTo);
      if (documentType) params.append('document_type', documentType);

      const response = await authFetch(`/api/documents/search?${params}`);

      if (!response.ok) {
        throw new Error('Search failed');
      }

      const data: SearchResponse = await response.json();
      setResults(data.results);
      setPage(data.page);
      setTotalPages(data.total_pages);
      setTotal(data.total);
    } catch (err) {
      setError('Failed to perform search');
      setResults([]);
    } finally {
      setIsLoading(false);
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setSearchQuery(query);
    setPage(1);
  };

  useEffect(() => {
    if (searchQuery) {
      performSearch(page);
    }
  }, [searchQuery, page, dateFrom, dateTo, documentType]);

  const highlightSnippet = (snippet: string, query: string): JSX.Element => {
    // Split query into terms
    const terms = query.toLowerCase().split(/\s+/);
    let highlightedSnippet = snippet;

    // Highlight each term
    terms.forEach((term) => {
      if (term.length > 2) {
        const regex = new RegExp(`(${term})`, 'gi');
        highlightedSnippet = highlightedSnippet.replace(regex, '<mark>$1</mark>');
      }
    });

    return <span dangerouslySetInnerHTML={{ __html: highlightedSnippet }} />;
  };

  const formatDate = (dateString: string): string => {
    const date = new Date(dateString);
    return date.toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });
  };

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <div className="bg-card border-b">
        <div className="container mx-auto px-4 py-6">
          <h1 className="text-3xl font-bold text-foreground mb-6">Search Documents</h1>

          {/* Search Form */}
          <form onSubmit={handleSubmit} className="space-y-4">
            {/* Search Input */}
            <div className="flex gap-2">
              <div className="flex-1">
                <Input
                  type="text"
                  placeholder="Search for keywords or ask a question..."
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  className="text-lg py-6"
                />
              </div>
              <Button type="submit" size="lg" disabled={isLoading}>
                <SearchIcon className="w-5 h-5 mr-2" />
                {isLoading ? 'Searching...' : 'Search'}
              </Button>
            </div>

            {/* Filters */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              {/* Date From */}
              <div className="space-y-2">
                <Label htmlFor="date-from">From Date</Label>
                <Input
                  id="date-from"
                  type="date"
                  value={dateFrom}
                  onChange={(e) => setDateFrom(e.target.value)}
                />
              </div>

              {/* Date To */}
              <div className="space-y-2">
                <Label htmlFor="date-to">To Date</Label>
                <Input
                  id="date-to"
                  type="date"
                  value={dateTo}
                  onChange={(e) => setDateTo(e.target.value)}
                />
              </div>

              {/* Document Type */}
              <div className="space-y-2">
                <Label htmlFor="doc-type">Document Type</Label>
                <Select value={documentType} onValueChange={setDocumentType}>
                  <SelectTrigger id="doc-type">
                    <SelectValue placeholder="All types" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="">All types</SelectItem>
                    <SelectItem value="application/pdf">PDF</SelectItem>
                    <SelectItem value="image/png">PNG</SelectItem>
                    <SelectItem value="image/jpeg">JPG</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
          </form>
        </div>
      </div>

      {/* Main Content */}
      <div className="container mx-auto px-4 py-8">
        {/* Error State */}
        {error && (
          <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded mb-4">
            {error}
          </div>
        )}

        {/* Results Summary */}
        {hasSearched && !isLoading && (
          <div className="mb-6">
            <p className="text-muted-foreground">
              {total === 0 ? 'No results found' : `Found ${total} ${total === 1 ? 'result' : 'results'}`}
              {searchQuery && ` for "${searchQuery}"`}
            </p>
          </div>
        )}

        {/* Loading State */}
        {isLoading && (
          <div className="text-center py-12">
            <p className="text-muted-foreground">Searching...</p>
          </div>
        )}

        {/* Empty State */}
        {!isLoading && hasSearched && results.length === 0 && (
          <Card className="text-center py-12">
            <CardContent className="pt-6">
              <SearchIcon className="w-16 h-16 mx-auto text-muted-foreground mb-4" />
              <h3 className="text-xl font-semibold text-foreground mb-2">
                No results found
              </h3>
              <p className="text-muted-foreground mb-4">
                Try adjusting your search query or filters
              </p>
              <ul className="text-sm text-muted-foreground text-left max-w-md mx-auto space-y-1">
                <li>• Use different keywords</li>
                <li>• Remove date filters</li>
                <li>• Try a broader search term</li>
              </ul>
            </CardContent>
          </Card>
        )}

        {/* Results List */}
        {!isLoading && results.length > 0 && (
          <>
            <div className="space-y-4">
              {results.map((result) => (
                <Link
                  key={`${result.document_id}-${result.page_number}`}
                  to="/documents/$id/viewer"
                  params={{ id: result.document_id }}
                >
                  <Card className="hover:shadow-lg transition-shadow">
                    <CardHeader>
                      <div className="flex items-start justify-between">
                        <div className="flex-1 min-w-0">
                          <CardTitle className="text-lg truncate" title={result.filename}>
                            {result.filename}
                          </CardTitle>
                          <CardDescription className="mt-1">
                            <span className="text-xs">
                              {formatDate(result.upload_date)} • Page {result.page_number + 1} • Relevance: {(result.relevance_score * 100).toFixed(0)}%
                            </span>
                          </CardDescription>
                        </div>
                      </div>
                    </CardHeader>
                    <CardContent>
                      <p className="text-sm text-foreground search-snippet">
                        ...{highlightSnippet(result.snippet, searchQuery)}...
                      </p>
                    </CardContent>
                  </Card>
                </Link>
              ))}
            </div>

            {/* Pagination Controls */}
            {totalPages > 1 && (
              <div className="flex items-center justify-center gap-4 mt-8">
                <Button
                  variant="outline"
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  disabled={page === 1 || isLoading}
                >
                  <ChevronLeft className="w-4 h-4 mr-2" />
                  Previous
                </Button>
                <span className="text-sm text-muted-foreground">
                  Page {page} of {totalPages}
                </span>
                <Button
                  variant="outline"
                  onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                  disabled={page === totalPages || isLoading}
                >
                  Next
                  <ChevronRight className="w-4 h-4 ml-2" />
                </Button>
              </div>
            )}
          </>
        )}

        {/* Initial State */}
        {!hasSearched && !isLoading && (
          <Card className="text-center py-12">
            <CardContent className="pt-6">
              <SearchIcon className="w-16 h-16 mx-auto text-muted-foreground mb-4" />
              <h3 className="text-xl font-semibold text-foreground mb-2">
                Start searching
              </h3>
              <p className="text-muted-foreground">
                Enter keywords or ask a question to search your documents
              </p>
            </CardContent>
          </Card>
        )}
      </div>

      <style>{`
        .search-snippet mark {
          background-color: #fef08a;
          padding: 0 2px;
          font-weight: 500;
        }
      `}</style>
    </div>
  );
}
