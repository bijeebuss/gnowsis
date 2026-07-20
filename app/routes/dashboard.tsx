/**
 * Dashboard Page
 * Features:
 * - Apply ProtectedRoute wrapper
 * - Fetch documents from GET /api/documents on load
 * - Display grid of document cards using shadcn Card
 * - Search documents with hybrid vector search
 * - Filter by date range and tags
 * - Status badges: UPLOADED (gray), PROCESSING (blue), READY (green), ERROR (red)
 * - Implement polling (5 second interval) to refresh document list
 * - Show empty state when no documents
 * - Add "Upload Document" button in header
 * - Sorting controls: Newest First, Oldest First, Filename A-Z, Filename Z-A
 * - Show document count and storage usage summary
 */

import { createFileRoute, Link } from '@tanstack/react-router';
import { useState, useEffect } from 'react';
import { ProtectedRoute } from '../components/ProtectedRoute';
import { Button } from '../components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../components/ui/card';
import { Badge } from '../components/ui/badge';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../components/ui/select';
import { UploadWidget } from '../components/UploadWidget';
import { Upload, FileText, Search, X, Filter, ChevronDown, ChevronLeft, ChevronRight, Trash2, Settings, LogOut } from 'lucide-react';
import { authFetch, logout } from '../utils/auth';

export interface DashboardSearchParams {
  q?: string;
  dateFrom?: string;
  dateTo?: string;
  tags?: string[];
}

const parseSearchString = (value: unknown): string | undefined =>
  typeof value === 'string' && value.trim() ? value : undefined;

const parseSearchTags = (value: unknown): string[] | undefined => {
  const tags = Array.isArray(value)
    ? value.filter((tag): tag is string => typeof tag === 'string' && Boolean(tag))
    : typeof value === 'string' && value
      ? [value]
      : [];

  return tags.length > 0 ? tags : undefined;
};

export const Route = createFileRoute('/dashboard')({
  validateSearch: (search: Record<string, unknown>): DashboardSearchParams => {
    const q = parseSearchString(search.q);
    const dateFrom = parseSearchString(search.dateFrom);
    const dateTo = parseSearchString(search.dateTo);
    const tags = parseSearchTags(search.tags);

    return {
      ...(q ? { q } : {}),
      ...(dateFrom ? { dateFrom } : {}),
      ...(dateTo ? { dateTo } : {}),
      ...(tags ? { tags } : {}),
    };
  },
  component: () => (
    <ProtectedRoute>
      <DashboardPage />
    </ProtectedRoute>
  ),
});

interface Document {
  id: string;
  filename: string;
  file_type: string;
  file_size: number;
  status: 'UPLOADED' | 'PROCESSING' | 'OCR_COMPLETE' | 'INDEXED' | 'READY' | 'ERROR';
  upload_date: string;
  updated_at: string;
  tags: Array<{ id: string; name: string }>;
}

interface SearchResult {
  document_id: string;
  filename: string;
  upload_date: string;
  file_type: string;
  relevance_score: number;
  snippet: string;
  page_number: number;
}

interface Tag {
  id: string;
  name: string;
  document_count: number;
}

function DashboardPage() {
  const navigate = Route.useNavigate();
  const committedSearch = Route.useSearch();
  const committedTagKey = (committedSearch.tags || []).join(',');
  const [documents, setDocuments] = useState<Document[]>([]);
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [allTags, setAllTags] = useState<Tag[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isSearching, setIsSearching] = useState(Boolean(committedSearch.q));
  const [error, setError] = useState('');
  const [isUploadOpen, setIsUploadOpen] = useState(false);
  const [sortBy, setSortBy] = useState<'upload_date' | 'filename'>('upload_date');
  const [order, setOrder] = useState<'asc' | 'desc'>('desc');

  // Pagination state
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [totalDocuments, setTotalDocuments] = useState(0);
  const [totalStorage, setTotalStorage] = useState(0);

  // Search state
  const [searchQuery, setSearchQuery] = useState(committedSearch.q || '');
  const [dateFrom, setDateFrom] = useState(committedSearch.dateFrom || '');
  const [dateTo, setDateTo] = useState(committedSearch.dateTo || '');
  const [selectedTags, setSelectedTags] = useState<string[]>(committedSearch.tags || []);
  const [showFilters, setShowFilters] = useState(
    Boolean(committedSearch.dateFrom || committedSearch.dateTo || committedSearch.tags?.length)
  );
  const isSearchMode = Boolean(committedSearch.q);

  const fetchDocuments = async (pageNum: number = page) => {
    try {
      const response = await authFetch(
        `/api/documents?sort_by=${sortBy}&order=${order}&page=${pageNum}&per_page=25`
      );

      if (!response.ok) {
        throw new Error('Failed to fetch documents');
      }

      const data = await response.json();
      setDocuments(data.documents);
      setTotalPages(data.total_pages);
      setTotalDocuments(data.total);
      setTotalStorage(data.total_storage);
      setError('');
    } catch (err) {
      setError('Failed to load documents');
    } finally {
      setIsLoading(false);
    }
  };

  const fetchTags = async () => {
    try {
      const response = await authFetch('/api/tags');

      if (response.ok) {
        const data = await response.json();
        setAllTags(data);
      }
    } catch (err) {
      // Session expired, authFetch will handle redirect
    }
  };

  const performSearch = async (search: DashboardSearchParams) => {
    setIsSearching(true);
    setError('');

    try {
      const params = new URLSearchParams({ q: search.q || '' });

      if (search.dateFrom) params.append('date_from', search.dateFrom);
      if (search.dateTo) params.append('date_to', search.dateTo);
      search.tags?.forEach(tagId => params.append('tags', tagId));

      const response = await authFetch(`/api/documents/search?${params}`);

      if (!response.ok) {
        throw new Error('Search failed');
      }

      const data = await response.json();
      setSearchResults(data.results || []);
    } catch (err) {
      setError('Failed to perform search');
      setSearchResults([]);
    } finally {
      setIsSearching(false);
    }
  };

  const handleSearch = () => {
    const q = searchQuery.trim();
    if (!q) {
      setError('Please enter a search query');
      return;
    }

    const nextSearch: DashboardSearchParams = {
      q,
      ...(dateFrom ? { dateFrom } : {}),
      ...(dateTo ? { dateTo } : {}),
      ...(selectedTags.length > 0 ? { tags: selectedTags } : {}),
    };
    const isSameSearch =
      committedSearch.q === nextSearch.q &&
      committedSearch.dateFrom === nextSearch.dateFrom &&
      committedSearch.dateTo === nextSearch.dateTo &&
      committedTagKey === (nextSearch.tags || []).join(',');

    if (isSameSearch) {
      void performSearch(nextSearch);
      return;
    }

    void navigate({ search: nextSearch });
  };

  const handleClearSearch = () => {
    setSearchQuery('');
    setDateFrom('');
    setDateTo('');
    setSelectedTags([]);
    setSearchResults([]);
    setError('');
    setShowFilters(false);
    void navigate({ search: {} });
  };

  const toggleTag = (tagId: string) => {
    setSelectedTags(prev =>
      prev.includes(tagId)
        ? prev.filter(id => id !== tagId)
        : [...prev, tagId]
    );
  };

  useEffect(() => {
    fetchTags();
  }, []);

  useEffect(() => {
    setSearchQuery(committedSearch.q || '');
    setDateFrom(committedSearch.dateFrom || '');
    setDateTo(committedSearch.dateTo || '');
    setSelectedTags(committedSearch.tags || []);
    setShowFilters(
      Boolean(committedSearch.dateFrom || committedSearch.dateTo || committedSearch.tags?.length)
    );

    if (committedSearch.q) {
      void performSearch(committedSearch);
    } else {
      setSearchResults([]);
      setIsSearching(false);
      setError('');
    }
  }, [committedSearch.q, committedSearch.dateFrom, committedSearch.dateTo, committedTagKey]);

  useEffect(() => {
    fetchDocuments(page);

    // Polling every 5 seconds for real-time status updates (only when not in search mode)
    const interval = setInterval(() => {
      if (!isSearchMode) {
        fetchDocuments(page);
      }
    }, 5000);

    return () => clearInterval(interval);
  }, [sortBy, order, isSearchMode, page]);

  const handleSortChange = (value: string) => {
    setPage(1); // Reset to first page when sort changes
    switch (value) {
      case 'newest':
        setSortBy('upload_date');
        setOrder('desc');
        break;
      case 'oldest':
        setSortBy('upload_date');
        setOrder('asc');
        break;
      case 'filename-asc':
        setSortBy('filename');
        setOrder('asc');
        break;
      case 'filename-desc':
        setSortBy('filename');
        setOrder('desc');
        break;
    }
  };

  const handleDelete = async (documentId: string, e: React.MouseEvent) => {
    e.preventDefault(); // Prevent Link navigation
    e.stopPropagation();

    try {
      const response = await authFetch(`/api/documents/${documentId}`, {
        method: 'DELETE',
      });

      if (response.ok) {
        // Refresh the document list
        await fetchDocuments();
      }
    } catch (err) {
      // Session expired, authFetch will handle redirect
    }
  };

  const getStatusBadge = (status: Document['status']) => {
    switch (status) {
      case 'UPLOADED':
        return <Badge variant="secondary">Uploaded</Badge>;
      case 'PROCESSING':
      case 'OCR_COMPLETE':
      case 'INDEXED':
        return <Badge variant="default">Processing</Badge>;
      case 'READY':
        return <Badge variant="default" className="bg-green-600">Ready</Badge>;
      case 'ERROR':
        return <Badge variant="destructive">Error</Badge>;
    }
  };

  const formatFileSize = (bytes: number): string => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
    return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
  };

  const formatDate = (dateString: string): string => {
    const date = new Date(dateString);
    return date.toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });
  };

  // Get document details for search results
  const getDocumentById = (id: string) => documents.find(doc => doc.id === id);

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <div className="bg-card border-b">
        <div className="container mx-auto px-4 py-4 sm:py-6">
          <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
            <div>
              <h1 className="text-2xl font-bold text-foreground sm:text-3xl">Dashboard</h1>
              <p className="text-muted-foreground mt-1">
                {totalDocuments} {totalDocuments === 1 ? 'document' : 'documents'} • {formatFileSize(totalStorage)}
              </p>
            </div>
            <div className="grid w-full grid-cols-2 gap-2 md:flex md:w-auto">
              <Link to="/settings" className="min-w-0">
                <Button variant="outline" className="w-full md:w-auto">
                  <Settings className="w-4 h-4 mr-2" />
                  Settings
                </Button>
              </Link>
              <Button variant="outline" onClick={() => void logout()} className="min-w-0 w-full md:w-auto">
                <LogOut className="w-4 h-4 mr-2" />
                Sign out
              </Button>
              <Button
                onClick={() => setIsUploadOpen(true)}
                className="col-span-2 w-full md:w-auto"
              >
                <Upload className="w-4 h-4 mr-2" />
                Upload Document
              </Button>
            </div>
          </div>
        </div>
      </div>

      {/* Main Content */}
      <main className="container mx-auto px-3 py-4 sm:px-4 sm:py-8">
        {/* Search Section */}
        <Card className="mb-4 sm:mb-6">
          <CardContent className="p-3 sm:p-6">
            <div className="space-y-3 sm:space-y-4">
              {/* Search Input */}
              <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto]">
                <div className="relative min-w-0">
                  <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                  <Input
                    type="text"
                    placeholder="Search documents..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        handleSearch();
                      }
                    }}
                    className="h-11 pl-10"
                  />
                </div>
                <div className="flex w-full gap-2">
                  <Button
                    onClick={handleSearch}
                    disabled={isSearching}
                    className="min-w-0 flex-1 px-3 sm:flex-none sm:px-4"
                  >
                    {isSearching ? 'Searching...' : 'Search'}
                  </Button>
                  <Button
                    variant="outline"
                    onClick={() => setShowFilters(!showFilters)}
                    aria-expanded={showFilters}
                    className="min-w-0 flex-1 px-3 sm:flex-none sm:px-4"
                  >
                    <Filter className="w-4 h-4" />
                    Filters
                    <ChevronDown className={`w-4 h-4 transition-transform ${showFilters ? 'rotate-180' : ''}`} />
                  </Button>
                  {isSearchMode && (
                    <Button
                      variant="ghost"
                      onClick={handleClearSearch}
                      className="h-10 w-10 shrink-0 px-0 sm:w-auto sm:px-4"
                      aria-label="Clear search"
                      title="Clear search"
                    >
                      <X className="w-4 h-4" />
                      <span className="sr-only sm:not-sr-only">Clear</span>
                    </Button>
                  )}
                </div>
              </div>

              {/* Filters Panel */}
              {showFilters && (
                <div className="border-t pt-3 space-y-3 sm:pt-4 sm:space-y-4">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {/* Date Range */}
                    <div className="space-y-2">
                      <Label>Date Range</Label>
                      <div className="grid grid-cols-1 gap-2 min-[440px]:grid-cols-2">
                        <Input
                          type="date"
                          value={dateFrom}
                          onChange={(e) => setDateFrom(e.target.value)}
                          placeholder="From"
                        />
                        <Input
                          type="date"
                          value={dateTo}
                          onChange={(e) => setDateTo(e.target.value)}
                          placeholder="To"
                        />
                      </div>
                    </div>

                    {/* Tags */}
                    <div className="space-y-2">
                      <Label>Tags</Label>
                      <div className="border rounded-md p-2 max-h-40 overflow-y-auto">
                        {allTags.length === 0 ? (
                          <p className="text-sm text-muted-foreground">No tags available</p>
                        ) : (
                          <div className="space-y-2">
                            {allTags.map((tag) => (
                              <label
                                key={tag.id}
                                className="flex items-center gap-2 cursor-pointer hover:bg-muted p-1 rounded"
                              >
                                <input
                                  type="checkbox"
                                  checked={selectedTags.includes(tag.id)}
                                  onChange={() => toggleTag(tag.id)}
                                  className="rounded"
                                />
                                <span className="text-sm">{tag.name}</span>
                                <Badge variant="secondary" className="text-xs ml-auto">
                                  {tag.document_count}
                                </Badge>
                              </label>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </CardContent>
        </Card>

        {/* Controls */}
        {!isSearchMode && (
          <div className="mb-4 flex items-center justify-between gap-2 sm:mb-6">
            <h2 className="text-lg font-semibold text-foreground">Your Documents</h2>
            <Select onValueChange={handleSortChange} defaultValue="newest">
              <SelectTrigger className="w-36 shrink-0 sm:w-48">
                <SelectValue placeholder="Sort by" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="newest">Newest First</SelectItem>
                <SelectItem value="oldest">Oldest First</SelectItem>
                <SelectItem value="filename-asc">Filename A-Z</SelectItem>
                <SelectItem value="filename-desc">Filename Z-A</SelectItem>
              </SelectContent>
            </Select>
          </div>
        )}

        {isSearchMode && (
          <div className="mb-6">
            <h2 className="text-lg font-semibold text-foreground">
              Search Results
              {searchResults.length > 0 && (
                <span className="text-muted-foreground font-normal ml-2">
                  ({searchResults.length} {searchResults.length === 1 ? 'result' : 'results'})
                </span>
              )}
            </h2>
          </div>
        )}

        {/* Error State */}
        {error && (
          <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded mb-4">
            {error}
          </div>
        )}

        {/* Loading State */}
        {isLoading && !isSearchMode && (
          <div className="text-center py-12">
            <p className="text-muted-foreground">Loading documents...</p>
          </div>
        )}

        {/* Search Results */}
        {isSearchMode && (
          <>
            {searchResults.length === 0 && !isSearching && (
              <Card className="text-center py-8 sm:py-12">
                <CardContent className="px-4 pt-4 sm:px-6 sm:pt-6">
                  <Search className="w-12 h-12 mx-auto text-muted-foreground mb-3 sm:h-16 sm:w-16 sm:mb-4" />
                  <h3 className="text-xl font-semibold text-foreground mb-2">
                    No results found
                  </h3>
                  <p className="text-muted-foreground mb-6">
                    Try adjusting your search query or filters
                  </p>
                </CardContent>
              </Card>
            )}

            {searchResults.length > 0 && (
              <div className="space-y-4">
                {searchResults.map((result, index) => {
                  const doc = getDocumentById(result.document_id);
                  return (
                    <Link
                      key={`${result.document_id}-${index}`}
                      to="/documents/$id/viewer"
                      params={{ id: result.document_id }}
                    >
                      <Card className="hover:shadow-lg transition-shadow">
                        <CardHeader className="p-4 sm:p-6">
                          <div className="flex items-start justify-between">
                            <div className="min-w-0 flex-1">
                              <CardTitle className="truncate text-lg" title={result.filename}>{result.filename}</CardTitle>
                              <CardDescription className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1">
                                <span>{formatDate(result.upload_date)}</span>
                                <span>•</span>
                                <span>{result.page_number < 0 ? 'Title / notes' : `Page ${result.page_number + 1}`}</span>
                                <span>•</span>
                                <Badge variant="outline">
                                  Score: {(result.relevance_score * 100).toFixed(1)}%
                                </Badge>
                                {doc && getStatusBadge(doc.status)}
                              </CardDescription>
                            </div>
                          </div>
                        </CardHeader>
                        <CardContent className="px-4 pb-4 sm:px-6 sm:pb-6">
                          <div className="bg-muted rounded p-3 text-sm">
                            <p className="text-foreground line-clamp-3">{result.snippet}</p>
                          </div>
                          {doc && doc.tags.length > 0 && (
                            <div className="flex flex-wrap gap-1 mt-3">
                              {doc.tags.map((tag) => (
                                <Badge key={tag.id} variant="outline" className="text-xs">
                                  {tag.name}
                                </Badge>
                              ))}
                            </div>
                          )}
                        </CardContent>
                      </Card>
                    </Link>
                  );
                })}
              </div>
            )}
          </>
        )}

        {/* Empty State */}
        {!isLoading && !isSearchMode && documents.length === 0 && (
          <Card className="text-center py-8 sm:py-12">
            <CardContent className="px-4 pt-4 sm:px-6 sm:pt-6">
              <FileText className="w-12 h-12 mx-auto text-muted-foreground mb-3 sm:h-16 sm:w-16 sm:mb-4" />
              <h3 className="text-xl font-semibold text-foreground mb-2">
                No documents yet
              </h3>
              <p className="text-muted-foreground mb-6">
                Upload your first document to get started!
              </p>
              <Button onClick={() => setIsUploadOpen(true)}>
                <Upload className="w-4 h-4 mr-2" />
                Upload Document
              </Button>
            </CardContent>
          </Card>
        )}

        {/* Document Grid */}
        {!isLoading && !isSearchMode && documents.length > 0 && (
          <>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 sm:gap-6 lg:grid-cols-3 xl:grid-cols-4">
              {documents.map((doc) => (
                <Link
                  key={doc.id}
                  to="/documents/$id/viewer"
                  params={{ id: doc.id }}
                  className="block"
                >
                  <Card className="hover:shadow-lg transition-shadow h-full">
                    <CardHeader className="p-4 sm:p-6">
                      {/* Thumbnail */}
                      <div className="flex h-32 w-full items-center justify-center overflow-hidden rounded-md bg-muted sm:h-40">
                        <img
                          src={`/api/documents/${doc.id}/pages/0`}
                          alt={doc.filename}
                          className="w-full h-full object-contain"
                          onError={(e) => {
                            e.currentTarget.style.display = 'none';
                            e.currentTarget.nextElementSibling?.classList.remove('hidden');
                          }}
                        />
                        <FileText className="w-12 h-12 text-muted-foreground hidden" />
                      </div>

                      <CardTitle className="text-base truncate" title={doc.filename}>
                        {doc.filename}
                      </CardTitle>
                      <CardDescription className="flex items-center justify-between mt-2">
                        <span className="text-xs">{formatDate(doc.upload_date)}</span>
                        {getStatusBadge(doc.status)}
                      </CardDescription>
                    </CardHeader>
                    <CardContent className="px-4 pb-4 sm:px-6 sm:pb-6">
                      <div className="flex items-center justify-between">
                        <div className="text-xs text-muted-foreground">
                          {formatFileSize(doc.file_size)}
                        </div>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={(e) => handleDelete(doc.id, e)}
                          className="h-8 w-8 p-0 hover:bg-red-100 hover:text-red-600"
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                      {doc.tags.length > 0 && (
                        <div className="flex flex-wrap gap-1 mt-2">
                          {doc.tags.slice(0, 3).map((tag) => (
                            <Badge key={tag.id} variant="outline" className="text-xs">
                              {tag.name}
                            </Badge>
                          ))}
                          {doc.tags.length > 3 && (
                            <Badge variant="outline" className="text-xs">
                              +{doc.tags.length - 3}
                            </Badge>
                          )}
                        </div>
                      )}
                    </CardContent>
                  </Card>
                </Link>
              ))}
            </div>

            {/* Pagination Controls */}
            {totalPages > 1 && (
              <div className="mt-6 flex items-center justify-center gap-2 sm:mt-8 sm:gap-4">
                <Button
                  variant="outline"
                  onClick={() => setPage(p => Math.max(1, p - 1))}
                  disabled={page === 1}
                  className="px-3 sm:px-4"
                >
                  <ChevronLeft className="w-4 h-4" />
                  Previous
                </Button>
                <span className="whitespace-nowrap text-xs text-muted-foreground sm:text-sm">
                  Page {page} of {totalPages}
                </span>
                <Button
                  variant="outline"
                  onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                  disabled={page === totalPages}
                  className="px-3 sm:px-4"
                >
                  Next
                  <ChevronRight className="w-4 h-4" />
                </Button>
              </div>
            )}
          </>
        )}
      </main>

      {/* Upload Widget */}
      <UploadWidget
        isOpen={isUploadOpen}
        onClose={() => setIsUploadOpen(false)}
        onUploadComplete={fetchDocuments}
      />
    </div>
  );
}
