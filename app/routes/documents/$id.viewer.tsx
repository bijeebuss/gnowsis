/**
 * Document Viewer Page
 * Task 8.10: Create document viewer page at /app/routes/documents/$id/viewer.tsx
 *
 * Features:
 * - Apply ProtectedRoute wrapper
 * - Fetch document from GET /api/documents/:id
 * - Fetch page images from /uploads/{document-id}/pages/page-{n}.png
 * - Display images in scrollable viewer with zoom controls: 50%, 100%, 150%, 200%
 * - Show extracted OCR text in side panel synchronized with page number
 * - Implement page navigation: Previous/Next buttons, page number selector
 * - Display metadata in header: filename, upload date, file size, page count
 * - Add Download button calling GET /api/documents/:id/download
 * - Show tag chips using shadcn Badge component
 * - Add tag management UI with autocomplete and add/remove functionality
 */

import { createFileRoute, Link } from '@tanstack/react-router';
import { useState, useEffect } from 'react';
import { ProtectedRoute } from '../../components/ProtectedRoute';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { Badge } from '../../components/ui/badge';
import { Textarea } from '../../components/ui/textarea';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../../components/ui/select';
import { Card, CardContent, CardHeader, CardTitle } from '../../components/ui/card';
import {
  ChevronLeft,
  ChevronRight,
  Download,
  ZoomIn,
  ZoomOut,
  X,
  Plus,
  Edit,
  Save,
} from 'lucide-react';
import { authFetch } from '../../utils/auth';

export const Route = createFileRoute('/documents/$id/viewer')({
  component: () => (
    <ProtectedRoute>
      <DocumentViewerPage />
    </ProtectedRoute>
  ),
});

interface Document {
  id: string;
  title?: string;
  notes?: string;
  filename: string;
  file_type: string;
  file_size: number;
  status: string;
  upload_date: string;
  updated_at: string;
  tags: Array<{ id: string; name: string }>;
  metadata: Array<{ id: string; field_name: string; field_value: string }>;
  processing_status: Array<{
    stage: string;
    started_at: string;
    completed_at: string | null;
    error_message: string | null;
  }>;
}

interface PageText {
  pageNumber: number;
  text: string;
}

interface Tag {
  id: string;
  name: string;
}

function DocumentViewerPage() {
  const { id } = Route.useParams();
  const [documentData, setDocumentData] = useState<Document | null>(null);
  const [pageTexts, setPageTexts] = useState<PageText[]>([]);
  const [currentPage, setCurrentPage] = useState(0);
  const [zoom, setZoom] = useState(100);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');
  const [totalPages, setTotalPages] = useState(0);

  // Tag management
  const [allTags, setAllTags] = useState<Tag[]>([]);
  const [newTagName, setNewTagName] = useState('');
  const [isAddingTag, setIsAddingTag] = useState(false);

  // Notes management
  const [isEditingNotes, setIsEditingNotes] = useState(false);
  const [notesValue, setNotesValue] = useState('');
  const [isSavingNotes, setIsSavingNotes] = useState(false);

  const fetchDocument = async () => {
    try {
      const response = await authFetch(`/api/documents/${id}`);

      if (!response.ok) {
        throw new Error('Failed to fetch document');
      }

      const data: Document = await response.json();
      setDocumentData(data);
      setNotesValue(data.notes || '');
      setError('');

      // Fetch page texts from vectors
      await fetchPageTexts();
    } catch (err) {
      setError('Failed to load document');
    } finally {
      setIsLoading(false);
    }
  };

  const fetchPageTexts = async () => {
    try {
      const response = await authFetch(`/api/documents/${id}/vectors`);

      if (response.ok) {
        const data = await response.json();
        setPageTexts(data);
        // Update total pages based on actual data
        if (data.length > 0) {
          setTotalPages(data.length);
        } else {
          setTotalPages(1); // Default to 1 if no vectors yet
        }
      }
    } catch (err) {
      // Session expired, authFetch will handle redirect
    }
  };

  const fetchAllTags = async () => {
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

  useEffect(() => {
    fetchDocument();
    fetchAllTags();
  }, [id]);

  const handleDownload = async () => {
    try {
      const response = await authFetch(`/api/documents/${id}/download`);

      if (response.ok) {
        const blob = await response.blob();
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = documentData?.filename || 'document';
        document.body.appendChild(a);
        a.click();
        window.URL.revokeObjectURL(url);
        document.body.removeChild(a);
      }
    } catch (err) {
      // Session expired, authFetch will handle redirect
    }
  };

  const handleAddTag = async () => {
    if (!newTagName.trim()) return;

    setIsAddingTag(true);

    try {
      const response = await authFetch(`/api/documents/${id}/tags`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ tag_name: newTagName.trim() }),
      });

      if (response.ok) {
        setNewTagName('');
        await fetchDocument(); // Refresh document to get updated tags
        await fetchAllTags(); // Refresh tag list
      }
    } catch (err) {
      // Session expired, authFetch will handle redirect
    }

    setIsAddingTag(false);
  };

  const handleRemoveTag = async (tagId: string) => {
    try {
      const response = await authFetch(`/api/documents/${id}/tags/${tagId}`, {
        method: 'DELETE',
      });

      if (response.ok) {
        await fetchDocument(); // Refresh document to get updated tags
      }
    } catch (err) {
      // Session expired, authFetch will handle redirect
    }
  };

  const handleSaveNotes = async () => {
    setIsSavingNotes(true);

    try {
      const response = await authFetch(`/api/documents/${id}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ notes: notesValue }),
      });

      if (response.ok) {
        await fetchDocument();
        setIsEditingNotes(false);
      }
    } catch (error) {
      console.error('Failed to save notes:', error);
    } finally {
      setIsSavingNotes(false);
    }
  };

  const handleCancelEditNotes = () => {
    setNotesValue(documentData?.notes || '');
    setIsEditingNotes(false);
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
      month: 'long',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  if (isLoading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <p className="text-muted-foreground">Loading document...</p>
      </div>
    );
  }

  if (error || !documentData) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <Card className="max-w-md">
          <CardContent className="pt-6">
            <p className="text-red-600">{error || 'Document not found'}</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <div className="bg-card border-b">
        <div className="container mx-auto px-4 py-4">
          <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
            <div className="flex-1 min-w-0">
              <Link to="/dashboard">
                <Button variant="ghost" size="sm" className="mb-2">
                  <ChevronLeft className="w-4 h-4 mr-1" />
                  Back to Dashboard
                </Button>
              </Link>
              <h1 className="text-2xl font-bold text-foreground truncate" title={documentData.title || documentData.filename}>
                {documentData.title || documentData.filename}
              </h1>
              {documentData.title && (
                <p className="text-sm text-muted-foreground mt-1 truncate" title={documentData.filename}>
                  {documentData.filename}
                </p>
              )}
              <div className="flex flex-wrap items-center gap-4 mt-2 text-sm text-muted-foreground">
                <span>{formatDate(documentData.upload_date)}</span>
                <span>•</span>
                <span>{formatFileSize(documentData.file_size)}</span>
                <span>•</span>
                <span>{totalPages} {totalPages === 1 ? 'page' : 'pages'}</span>
                <Badge variant={documentData.status === 'READY' ? 'default' : 'secondary'}>
                  {documentData.status}
                </Badge>
              </div>
            </div>
            <Button onClick={handleDownload}>
              <Download className="w-4 h-4 mr-2" />
              Download
            </Button>
          </div>
        </div>
      </div>

      {/* Main Content */}
      <div className="container mx-auto px-4 py-6">
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Document Viewer */}
          <div className="lg:col-span-2">
            <Card>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <CardTitle className="text-lg">Document Preview</CardTitle>

                  {/* Zoom Controls */}
                  <div className="flex items-center gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setZoom((z) => Math.max(50, z - 25))}
                      disabled={zoom <= 50}
                    >
                      <ZoomOut className="w-4 h-4" />
                    </Button>
                    <Select
                      value={zoom.toString()}
                      onValueChange={(value) => setZoom(parseInt(value))}
                    >
                      <SelectTrigger className="w-24">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="50">50%</SelectItem>
                        <SelectItem value="100">100%</SelectItem>
                        <SelectItem value="150">150%</SelectItem>
                        <SelectItem value="200">200%</SelectItem>
                      </SelectContent>
                    </Select>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setZoom((z) => Math.min(200, z + 25))}
                      disabled={zoom >= 200}
                    >
                      <ZoomIn className="w-4 h-4" />
                    </Button>
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                {/* Page Image */}
                <div className="bg-muted rounded-lg p-4 overflow-auto max-h-[600px]">
                  <img
                    src={`/uploads/${documentData.id}/pages/page-${currentPage}.png`}
                    alt={`Page ${currentPage + 1}`}
                    style={{ width: `${zoom}%` }}
                    className="mx-auto"
                    onError={(e) => {
                      e.currentTarget.src = '';
                      e.currentTarget.alt = 'Image not available';
                    }}
                  />
                </div>

                {/* Page Navigation */}
                <div className="flex items-center justify-center gap-4 mt-4">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setCurrentPage((p) => Math.max(0, p - 1))}
                    disabled={currentPage === 0}
                  >
                    <ChevronLeft className="w-4 h-4 mr-1" />
                    Previous
                  </Button>
                  <span className="text-sm text-muted-foreground">
                    Page {currentPage + 1} of {totalPages}
                  </span>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setCurrentPage((p) => Math.min(totalPages - 1, p + 1))}
                    disabled={currentPage >= totalPages - 1}
                  >
                    Next
                    <ChevronRight className="w-4 h-4 ml-1" />
                  </Button>
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Side Panel */}
          <div className="space-y-6">
            {/* OCR Text Panel */}
            <Card>
              <CardHeader>
                <CardTitle className="text-lg">Extracted Text (Page {currentPage + 1})</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="bg-muted rounded p-4 max-h-64 overflow-y-auto text-sm text-foreground">
                  {pageTexts[currentPage] ? (
                    <p className="whitespace-pre-wrap">{pageTexts[currentPage].text}</p>
                  ) : (
                    <p className="text-muted-foreground italic">
                      {documentData.status === 'READY'
                        ? 'OCR text will appear here once processing is complete'
                        : 'Processing...'}
                    </p>
                  )}
                </div>
              </CardContent>
            </Card>

            {/* Notes */}
            <Card>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <CardTitle className="text-lg">Notes</CardTitle>
                  {!isEditingNotes ? (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setIsEditingNotes(true)}
                    >
                      <Edit className="w-4 h-4 mr-1" />
                      {documentData.notes ? 'Edit' : 'Add'}
                    </Button>
                  ) : (
                    <div className="flex gap-2">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={handleCancelEditNotes}
                        disabled={isSavingNotes}
                      >
                        Cancel
                      </Button>
                      <Button
                        variant="default"
                        size="sm"
                        onClick={handleSaveNotes}
                        disabled={isSavingNotes}
                      >
                        <Save className="w-4 h-4 mr-1" />
                        {isSavingNotes ? 'Saving...' : 'Save'}
                      </Button>
                    </div>
                  )}
                </div>
              </CardHeader>
              <CardContent>
                {isEditingNotes ? (
                  <Textarea
                    value={notesValue}
                    onChange={(e) => setNotesValue(e.target.value)}
                    placeholder="Add notes about this document..."
                    rows={6}
                    className="w-full"
                  />
                ) : (
                  <div className="bg-muted rounded p-4 text-sm text-foreground min-h-[100px]">
                    {documentData.notes ? (
                      <p className="whitespace-pre-wrap">{documentData.notes}</p>
                    ) : (
                      <p className="text-muted-foreground italic">No notes yet. Click "Add" to add notes.</p>
                    )}
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Tags */}
            <Card>
              <CardHeader>
                <CardTitle className="text-lg">Tags</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                {/* Tag List */}
                <div className="flex flex-wrap gap-2">
                  {documentData.tags.map((tag) => (
                    <Badge key={tag.id} variant="secondary" className="gap-1">
                      {tag.name}
                      <button
                        onClick={() => handleRemoveTag(tag.id)}
                        className="ml-1 hover:text-red-600"
                      >
                        <X className="w-3 h-3" />
                      </button>
                    </Badge>
                  ))}
                  {documentData.tags.length === 0 && (
                    <p className="text-sm text-muted-foreground">No tags yet</p>
                  )}
                </div>

                {/* Add Tag */}
                <div className="flex gap-2">
                  <Input
                    placeholder="Add tag..."
                    value={newTagName}
                    onChange={(e) => setNewTagName(e.target.value)}
                    onKeyPress={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        handleAddTag();
                      }
                    }}
                    list="tags-autocomplete"
                  />
                  <datalist id="tags-autocomplete">
                    {allTags
                      .filter((tag) => !documentData.tags.some((t) => t.id === tag.id))
                      .map((tag) => (
                        <option key={tag.id} value={tag.name} />
                      ))}
                  </datalist>
                  <Button
                    size="sm"
                    onClick={handleAddTag}
                    disabled={isAddingTag || !newTagName.trim()}
                  >
                    <Plus className="w-4 h-4" />
                  </Button>
                </div>
              </CardContent>
            </Card>

            {/* Metadata */}
            {documentData.metadata.length > 0 && (
              <Card>
                <CardHeader>
                  <CardTitle className="text-lg">Metadata</CardTitle>
                </CardHeader>
                <CardContent>
                  <dl className="space-y-2 text-sm">
                    {documentData.metadata.map((field) => (
                      <div key={field.id}>
                        <dt className="font-medium text-foreground">{field.field_name}</dt>
                        <dd className="text-muted-foreground">{field.field_value}</dd>
                      </div>
                    ))}
                  </dl>
                </CardContent>
              </Card>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
