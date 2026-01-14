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
import { Upload, FileText, Search, X, Filter, ChevronDown, ChevronLeft, ChevronRight, Trash2, Settings } from 'lucide-react';
import { getSession, authFetch } from '../utils/auth';

export const Route = createFileRoute('/dashboard')({
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
  const [documents, setDocuments] = useState<Document[]>([]);
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [allTags, setAllTags] = useState<Tag[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isSearching, setIsSearching] = useState(false);
  const [error, setError] = useState('');
  const [isUploadOpen, setIsUploadOpen] = useState(false);
  const [sortBy, setSortBy] = useState<'upload_date' | 'filename'>('upload_date');
  const [order, setOrder] = useState<'asc' | 'desc'>('desc');

  // Pagination state
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [totalDocuments, setTotalDocuments] = useState(0);

  // Search state
  const [searchQuery, setSearchQuery] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [showFilters, setShowFilters] = useState(false);
  const [isSearchMode, setIsSearchMode] = useState(false);

  const fetchDocuments = async (pageNum: number = page) => {
    const token = getSession();
    if (!token) {
      setError('Not authenticated');
      setIsLoading(false);
      return;
    }

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

  const handleSearch = async () => {
    if (!searchQuery.trim()) {
      setError('Please enter a search query');
      return;
    }

    setIsSearching(true);
    setError('');

    try {
      const params = new URLSearchParams({ q: searchQuery });

      if (dateFrom) params.append('date_from', dateFrom);
      if (dateTo) params.append('date_to', dateTo);
      selectedTags.forEach(tagId => params.append('tags', tagId));

      const response = await authFetch(`/api/documents/search?${params}`);

      if (!response.ok) {
        throw new Error('Search failed');
      }

      const data = await response.json();
      setSearchResults(data.results || []);
      setIsSearchMode(true);
    } catch (err) {
      setError('Failed to perform search');
      setSearchResults([]);
    } finally {
      setIsSearching(false);
    }
  };

  const handleClearSearch = () => {
    setSearchQuery('');
    setDateFrom('');
    setDateTo('');
    setSelectedTags([]);
    setSearchResults([]);
    setIsSearchMode(false);
    setError('');
    setShowFilters(false);
  };

  const toggleTag = (tagId: string) => {
    setSelectedTags(prev =>
      prev.includes(tagId)
        ? prev.filter(id => id !== tagId)
        : [...prev, tagId]
    );
  };

  useEffect(() => {
    fetchDocuments(page);
    fetchTags();

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

  const totalStorage = documents.reduce((acc, doc) => acc + doc.file_size, 0);

  // Get document details for search results
  const getDocumentById = (id: string) => documents.find(doc => doc.id === id);

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <div className="bg-card border-b">
        <div className="container mx-auto px-4 py-6">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
            <div>
              <h1 className="text-3xl font-bold text-foreground">Dashboard</h1>
              <p className="text-muted-foreground mt-1">
                {totalDocuments} {totalDocuments === 1 ? 'document' : 'documents'} • {formatFileSize(totalStorage)}
              </p>
            </div>
            <div className="flex gap-2">
              <Link to="/settings">
                <Button variant="outline">
                  <Settings className="w-4 h-4 mr-2" />
                  Settings
                </Button>
              </Link>
              <Button onClick={() => setIsUploadOpen(true)}>
                <Upload className="w-4 h-4 mr-2" />
                Upload Document
              </Button>
            </div>
          </div>
        </div>
      </div>

      {/* Main Content */}
      <div className="container mx-auto px-4 py-8">
        {/* Search Section */}
        <Card className="mb-6">
          <CardContent className="pt-6">
            <div className="space-y-4">
              {/* Search Input */}
              <div className="flex gap-2">
                <div className="flex-1 relative">
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
                    className="pl-10"
                  />
                </div>
                <Button
                  variant="outline"
                  onClick={() => setShowFilters(!showFilters)}
                >
                  <Filter className="w-4 h-4 mr-2" />
                  Filters
                  <ChevronDown className={`w-4 h-4 ml-2 transition-transform ${showFilters ? 'rotate-180' : ''}`} />
                </Button>
                <Button onClick={handleSearch} disabled={isSearching}>
                  {isSearching ? 'Searching...' : 'Search'}
                </Button>
                {isSearchMode && (
                  <Button variant="ghost" onClick={handleClearSearch}>
                    <X className="w-4 h-4 mr-2" />
                    Clear
                  </Button>
                )}
              </div>

              {/* Filters Panel */}
              {showFilters && (
                <div className="border-t pt-4 space-y-4">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {/* Date Range */}
                    <div className="space-y-2">
                      <Label>Date Range</Label>
                      <div className="flex gap-2">
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
          <div className="flex justify-between items-center mb-6">
            <h2 className="text-lg font-semibold text-foreground">Your Documents</h2>
            <Select onValueChange={handleSortChange} defaultValue="newest">
              <SelectTrigger className="w-48">
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
              <Card className="text-center py-12">
                <CardContent className="pt-6">
                  <Search className="w-16 h-16 mx-auto text-muted-foreground mb-4" />
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
                        <CardHeader>
                          <div className="flex items-start justify-between">
                            <div className="flex-1">
                              <CardTitle className="text-lg">{result.filename}</CardTitle>
                              <CardDescription className="flex items-center gap-4 mt-2">
                                <span>{formatDate(result.upload_date)}</span>
                                <span>•</span>
                                <span>Page {result.page_number + 1}</span>
                                <span>•</span>
                                <Badge variant="outline">
                                  Score: {(result.relevance_score * 100).toFixed(1)}%
                                </Badge>
                                {doc && getStatusBadge(doc.status)}
                              </CardDescription>
                            </div>
                          </div>
                        </CardHeader>
                        <CardContent>
                          <div className="bg-muted rounded p-3 text-sm">
                            <p className="text-foreground line-clamp-3" dangerouslySetInnerHTML={{ __html: result.snippet }} />
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
          <Card className="text-center py-12">
            <CardContent className="pt-6">
              <FileText className="w-16 h-16 mx-auto text-muted-foreground mb-4" />
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
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
              {documents.map((doc) => (
                <Link
                  key={doc.id}
                  to="/documents/$id/viewer"
                  params={{ id: doc.id }}
                  className="block"
                >
                  <Card className="hover:shadow-lg transition-shadow h-full">
                    <CardHeader>
                      {/* Thumbnail */}
                      <div className="w-full h-40 bg-muted rounded-md flex items-center justify-center mb-3 overflow-hidden">
                        <img
                          src={`/uploads/${doc.id}/pages/page-0.png`}
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
                    <CardContent>
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
              <div className="flex items-center justify-center gap-4 mt-8">
                <Button
                  variant="outline"
                  onClick={() => setPage(p => Math.max(1, p - 1))}
                  disabled={page === 1}
                >
                  <ChevronLeft className="w-4 h-4 mr-1" />
                  Previous
                </Button>
                <span className="text-sm text-muted-foreground">
                  Page {page} of {totalPages}
                </span>
                <Button
                  variant="outline"
                  onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                  disabled={page === totalPages}
                >
                  Next
                  <ChevronRight className="w-4 h-4 ml-1" />
                </Button>
              </div>
            )}
          </>
        )}
      </div>

      {/* Upload Widget */}
      <UploadWidget
        isOpen={isUploadOpen}
        onClose={() => setIsUploadOpen(false)}
        onUploadComplete={fetchDocuments}
      />
    </div>
  );
}
