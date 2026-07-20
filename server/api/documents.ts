import { Router, type Response } from 'express';
import { prisma } from "../db.js";
import multer from 'multer';
import { v4 as uuidv4 } from 'uuid';
import fs from 'fs/promises';
import path from 'path';
import { createReadStream } from 'fs';
import archiver from 'archiver';
import { requireAuth, type AuthRequest } from '../middleware/auth.js';
import { getWorkflowHandle, startDocumentProcessing } from '../../workflows/client.js';
import { hybridSearch, updateDocumentMetadata, type SearchFilters } from '../utils/search.js';

const router = Router();
// Use shared Prisma client from db.ts

/**
 * Configure multer for file uploads
 * Store files in memory temporarily for validation
 */
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 1024 * 1024 * 1024 // 1GB limit
  }
});

/**
 * Allowed file types
 */
const ALLOWED_MIME_TYPES = [
  'application/pdf',
  'image/png',
  'image/jpeg',
  'image/jpg'
];

/**
 * Get file extension from MIME type
 */
function getFileExtension(mimeType: string): string {
  const mimeToExt: { [key: string]: string } = {
    'application/pdf': 'pdf',
    'image/png': 'png',
    'image/jpeg': 'jpg',
    'image/jpg': 'jpg'
  };
  return mimeToExt[mimeType] || 'bin';
}

function isValidDateFilter(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

/**
 * POST /api/documents/upload
 * Accept multipart/form-data with multiple files, title, notes, and tags
 * Apply requireAuth middleware
 * Validate file types (PDF, PNG, JPG only) - return 400 if invalid
 * Validate file sizes (max 1GB each) - return 413 if too large
 * Generate UUID for document ID
 * Create /uploads/{document-id}/ directory
 * Save all files to /uploads/{document-id}/file-{index}.{ext}
 * Create Documents record with status UPLOADED
 * Create tag associations if tags provided
 * Initiate Temporal workflow with all file paths and notes
 * Return 201 Created with JSON: { id, title, upload_date, status }
 */
router.post('/upload', requireAuth, upload.array('files', 10), async (req: AuthRequest, res: Response) => {
  let uploadDir: string | undefined;
  try {
    const files = req.files as Express.Multer.File[];
    const userId = req.user_id;
    const title = req.body.title as string | undefined;
    const notes = req.body.notes as string | undefined;
    const tagsString = req.body.tags as string | undefined;

    if (!userId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    if (!files || files.length === 0) {
      return res.status(400).json({ error: 'No files uploaded' });
    }

    // Validate all file types
    for (const file of files) {
      if (!ALLOWED_MIME_TYPES.includes(file.mimetype)) {
        return res.status(400).json({
          error: `Invalid file type: ${file.originalname}. Only PDF, PNG, and JPG files are allowed.`
        });
      }
    }

    // Generate UUID for document ID
    const documentId = uuidv4();

    // Create uploads directory structure
    uploadDir = path.join(process.cwd(), 'uploads', documentId);
    await fs.mkdir(uploadDir, { recursive: true });

    // Save all files to disk
    const filePaths: string[] = [];
    const storedFiles: Array<{
      position: number;
      filename: string;
      original_filename: string;
      file_path: string;
      file_size: number;
      file_type: string;
    }> = [];
    let totalSize = 0;
    let combinedFilename = '';

    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      if (!file) continue; // Skip if undefined

      totalSize += file.size;

      if (i === 0) {
        combinedFilename = file.originalname;
      } else if (i === 1) {
        combinedFilename += ` and ${files.length - 1} more`;
      }

      const fileExtension = getFileExtension(file.mimetype);
      const filename = `file-${i}.${fileExtension}`;
      const filePath = path.join(uploadDir, filename);

      await fs.writeFile(filePath, file.buffer);
      filePaths.push(filePath);
      storedFiles.push({
        position: i,
        filename,
        original_filename: file.originalname,
        file_path: filePath,
        file_size: file.size,
        file_type: file.mimetype,
      });
    }

    if (filePaths.length === 0 || !files[0]) {
      return res.status(400).json({ error: 'No valid files provided' });
    }

    // Determine primary file type (use first file's type)
    const primaryFileType = files[0].mimetype;

    // Create Documents record with status UPLOADED
    const tagNames = tagsString?.split(',').map(t => t.trim()).filter(Boolean) ?? [];
    const document = await prisma.$transaction(async (tx) => {
      const created = await tx.documents.create({
        data: {
          id: documentId,
          user_id: userId,
          ...(title ? { title } : {}),
          ...(notes ? { notes } : {}),
          filename: `file-0.${getFileExtension(primaryFileType)}`,
          original_filename: combinedFilename,
          file_path: filePaths[0]!,
          file_size: totalSize,
          file_type: primaryFileType,
          status: 'UPLOADED',
          files: { create: storedFiles },
        }
      });

      for (const tagName of new Set(tagNames)) {
        const tag = await tx.tags.upsert({
          where: { name_user_id: { name: tagName, user_id: userId } },
          update: {},
          create: { name: tagName, user_id: userId },
        });
        await tx.documentTags.create({
          data: { document_id: documentId, tag_id: tag.id },
        });
      }
      return created;
    });

    // Initiate Temporal workflow for document processing
    let responseStatus = document.status;
    try {
      await startDocumentProcessing(documentId, filePaths, title || undefined, notes || undefined);
    } catch (workflowError) {
      console.error('Failed to start document processing workflow:', workflowError);
      // Update document status to ERROR
      await prisma.documents.update({
        where: { id: documentId },
        data: { status: 'ERROR' }
      });
      responseStatus = 'ERROR';
    }

    // Return 201 Created with document info
    return res.status(201).json({
      id: document.id,
      title: document.title || document.original_filename,
      filename: document.original_filename,
      upload_date: document.upload_date,
      status: responseStatus
    });
  } catch (error: any) {
    console.error('Upload error:', error);

    // Handle multer file size error
    if (error.code === 'LIMIT_FILE_SIZE') {
      return res.status(413).json({ error: 'File size exceeds maximum limit of 1GB' });
    }

    if (uploadDir) {
      await fs.rm(uploadDir, { recursive: true, force: true }).catch(() => undefined);
    }

    return res.status(500).json({ error: 'Internal server error' });
  }
});

/** Authenticated access to a rendered document page. */
router.get('/:id/pages/:page', requireAuth, async (req: AuthRequest, res: Response) => {
  const documentId = req.params.id;
  const pageRaw = req.params.page;
  const userId = req.user_id;
  if (!userId) return res.status(401).json({ error: 'Unauthorized' });
  if (!documentId || Array.isArray(documentId) || !pageRaw || Array.isArray(pageRaw) || !/^\d+$/.test(pageRaw)) {
    return res.status(400).json({ error: 'Invalid document or page number' });
  }

  const document = await prisma.documents.findFirst({
    where: { id: documentId, user_id: userId },
    select: { id: true },
  });
  if (!document) return res.status(404).json({ error: 'Document not found' });

  const pagesDir = path.join(process.cwd(), 'uploads', document.id, 'pages');
  const candidates = [
    { path: path.join(pagesDir, `page-${pageRaw}.png`), type: 'image/png' },
    { path: path.join(pagesDir, `page-${pageRaw}.jpg`), type: 'image/jpeg' },
  ];
  const pageFile = await Promise.all(candidates.map(async candidate =>
    fs.access(candidate.path).then(() => candidate).catch(() => null)
  )).then(results => results.find(Boolean));

  if (!pageFile) return res.status(404).json({ error: 'Page image not found' });
  res.setHeader('Content-Type', pageFile.type);
  res.setHeader('Cache-Control', 'private, max-age=3600');
  createReadStream(pageFile.path).pipe(res);
  return;
});

/**
 * GET /api/documents
 * Apply requireAuth middleware
 * Query Documents table filtered by current user_id
 * Include related tags in response
 * Support query params: sort_by (upload_date, filename), order (asc, desc)
 * Support pagination: page (default 1), per_page (default 25)
 * Return 200 OK with paginated response: { documents, page, per_page, total, total_pages }
 */
router.get('/', requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user_id;

    if (!userId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    // Parse query params
    const sortBy = (req.query.sort_by as string) || 'upload_date';
    const order = (req.query.order as string) || 'desc';

    // Parse pagination parameters
    const page = parseInt(req.query.page as string) || 1;
    const perPage = parseInt(req.query.per_page as string) || 25;

    // Validate pagination
    if (page < 1 || perPage < 1 || perPage > 100) {
      return res.status(400).json({ error: 'Invalid pagination parameters' });
    }

    // Validate sort parameters
    const validSortFields = ['upload_date', 'filename', 'original_filename'];
    const validOrders = ['asc', 'desc'];

    const orderByField = validSortFields.includes(sortBy) ? sortBy : 'upload_date';
    const orderDirection = validOrders.includes(order) ? order : 'desc';

    const [total, storage, documents] = await Promise.all([
      prisma.documents.count({ where: { user_id: userId } }),
      prisma.documents.aggregate({ where: { user_id: userId }, _sum: { file_size: true } }),
      prisma.documents.findMany({
        where: { user_id: userId },
        include: {
          tags: {
            include: {
              tag: true
            }
          }
        },
        orderBy: { [orderByField]: orderDirection },
        skip: (page - 1) * perPage,
        take: perPage
      }),
    ]);

    // Format response to include tags array
    const formattedDocuments = documents.map(doc => ({
      id: doc.id,
      filename: doc.original_filename,
      file_type: doc.file_type,
      file_size: doc.file_size,
      status: doc.status,
      upload_date: doc.upload_date,
      updated_at: doc.updated_at,
      tags: doc.tags.map(dt => ({
        id: dt.tag.id,
        name: dt.tag.name
      }))
    }));

    // Return paginated response
    return res.status(200).json({
      documents: formattedDocuments,
      page,
      per_page: perPage,
      total,
      total_storage: storage._sum.file_size ?? 0,
      total_pages: Math.ceil(total / perPage)
    });
  } catch (error) {
    console.error('Get documents error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * GET /api/documents/search
 * Apply requireAuth middleware
 * Accept query params: q (query text), date_from, date_to, document_type, tags (array)
 * Call hybridSearch with query and filters
 * For each result, extract text snippet with highlighting
 * Return 200 OK with array: { document_id, filename, upload_date, relevance_score, snippet }
 * Support pagination: page (default 1), per_page (default 25)
 */
router.get('/search', requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user_id;

    if (!userId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    // Get query parameter
    const query = (req.query.q as string) || '';

    if (!query.trim()) {
      return res.status(400).json({ error: 'Query parameter "q" is required' });
    }

    // Parse filters
    const filters: SearchFilters = {};

    if (req.query.date_from !== undefined) {
      if (!isValidDateFilter(req.query.date_from)) {
        return res.status(400).json({ error: 'date_from must be a valid YYYY-MM-DD date' });
      }
      filters.date_from = req.query.date_from;
    }

    if (req.query.date_to !== undefined) {
      if (!isValidDateFilter(req.query.date_to)) {
        return res.status(400).json({ error: 'date_to must be a valid YYYY-MM-DD date' });
      }
      filters.date_to = req.query.date_to;
    }

    if (req.query.document_type) {
      filters.document_type = req.query.document_type as string;
    }

    if (req.query.tags) {
      // Handle both single tag and array of tags
      filters.tags = Array.isArray(req.query.tags)
        ? req.query.tags as string[]
        : [req.query.tags as string];
    }

    // Parse pagination parameters
    const page = parseInt(req.query.page as string) || 1;
    const perPage = parseInt(req.query.per_page as string) || 25;

    // Validate pagination
    if (page < 1 || perPage < 1 || perPage > 100) {
      return res.status(400).json({ error: 'Invalid pagination parameters' });
    }

    // Execute hybrid search
    const searchPage = await hybridSearch(query, userId, filters, page, perPage);

    // Format results
    const formattedResults = searchPage.results.map(result => ({
      document_id: result.document_id,
      filename: result.filename,
      upload_date: result.upload_date,
      file_type: result.file_type,
      relevance_score: result.relevance_score,
      snippet: result.snippet,
      page_number: result.page_number,
    }));

    // Return paginated response
    return res.status(200).json({
      results: formattedResults,
      page: page,
      per_page: perPage,
      total: searchPage.total,
      total_pages: Math.ceil(searchPage.total / perPage),
    });
  } catch (error) {
    console.error('Search error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * GET /api/documents/:id
 * Apply requireAuth middleware
 * Query Documents table by ID
 * Verify document belongs to current user (403 if not)
 * Include tags, metadata fields, processing status in response
 * Return 200 OK with document object
 * Return 404 Not Found if document doesn't exist
 */
router.get('/:id', requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user_id;
    const documentIdRaw = req.params.id;

    if (!userId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    if (!documentIdRaw || Array.isArray(documentIdRaw)) {
      return res.status(400).json({ error: 'Invalid Document ID' });
    }

    const documentId: string = documentIdRaw;

    // Query document with related data
    const document: any = await prisma.documents.findUnique({
      where: { id: documentId },
      include: {
        tags: {
          include: {
            tag: true
          }
        },
        metadata: true,
        processingStatus: {
          orderBy: {
            started_at: 'desc'
          }
        }
      }
    });

    // Check if document exists
    if (!document) {
      return res.status(404).json({ error: 'Document not found' });
    }

    // Verify document belongs to current user
    if (document.user_id !== userId) {
      return res.status(403).json({ error: 'Forbidden: You do not have access to this document' });
    }

    // Format response
    const formattedDocument = {
      id: document.id,
      title: document.title,
      notes: document.notes,
      filename: document.original_filename,
      file_type: document.file_type,
      file_size: document.file_size,
      status: document.status,
      upload_date: document.upload_date,
      updated_at: document.updated_at,
      tags: document.tags.map((dt: any) => ({
        id: dt.tag.id,
        name: dt.tag.name
      })),
      metadata: document.metadata.map((m: any) => ({
        id: m.id,
        field_name: m.field_name,
        field_value: m.field_value,
        created_at: m.created_at
      })),
      processing_status: document.processingStatus.map((ps: any) => ({
        stage: ps.stage,
        started_at: ps.started_at,
        completed_at: ps.completed_at,
        error_message: ps.error_message,
        retry_count: ps.retry_count
      }))
    };

    return res.status(200).json(formattedDocument);
  } catch (error) {
    console.error('Get document error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * GET /api/documents/:id/download
 * Apply requireAuth middleware
 * Verify document belongs to current user
 * Stream original file from /uploads/{document-id}/original.{ext}
 * Set Content-Disposition header with original_filename
 * Return 200 OK with file stream
 */
router.get('/:id/download', requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user_id;
    const documentIdRaw = req.params.id;

    if (!userId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    if (!documentIdRaw || Array.isArray(documentIdRaw)) {
      return res.status(400).json({ error: 'Invalid Document ID' });
    }

    const documentId: string = documentIdRaw;

    // Query document
    const document = await prisma.documents.findUnique({
      where: { id: documentId },
      include: { files: { orderBy: { position: 'asc' } } },
    });

    // Check if document exists
    if (!document) {
      return res.status(404).json({ error: 'Document not found' });
    }

    // Verify document belongs to current user
    if (document.user_id !== userId) {
      return res.status(403).json({ error: 'Forbidden: You do not have access to this document' });
    }

    const documentFiles = document.files.length > 0 ? document.files : [{
      file_path: document.file_path,
      original_filename: document.original_filename,
      file_type: document.file_type,
    }];

    if (documentFiles.length > 1) {
      res.setHeader('Content-Disposition', `attachment; filename="${document.id}.zip"`);
      res.setHeader('Content-Type', 'application/zip');
      const archive = archiver('zip', { zlib: { level: 6 } });
      archive.on('error', (error) => res.destroy(error));
      archive.pipe(res);
      const usedNames = new Set<string>();
      for (const [index, file] of documentFiles.entries()) {
        await fs.access(file.file_path);
        const baseName = path.basename(file.original_filename).replace(/[\r\n]/g, '_') || `file-${index}`;
        let archiveName = baseName;
        if (usedNames.has(archiveName)) archiveName = `${index + 1}-${baseName}`;
        usedNames.add(archiveName);
        archive.file(file.file_path, { name: archiveName });
      }
      await archive.finalize();
      return;
    }

    const primaryFile = documentFiles[0]!;
    // Check if file exists
    try {
      await fs.access(primaryFile.file_path);
    } catch {
      return res.status(404).json({ error: 'File not found on server' });
    }

    // Set Content-Disposition header with original filename
    const downloadName = path.basename(primaryFile.original_filename).replace(/[\r\n"]/g, '_');
    res.setHeader('Content-Disposition', `attachment; filename="${downloadName}"`);
    res.setHeader('Content-Type', primaryFile.file_type);

    // Stream file to response
    const fileStream = createReadStream(primaryFile.file_path);
    fileStream.pipe(res);

    fileStream.on('error', (error) => {
      console.error('File stream error:', error);
      if (!res.headersSent) {
        res.status(500).json({ error: 'Error streaming file' });
      }
    });
    // Return explicitly to satisfy TypeScript
    return;
  } catch (error) {
    console.error('Download error:', error);
    if (!res.headersSent) {
      res.status(500).json({ error: 'Internal server error' });
    }
    return;
  }
});

/**
 * POST /api/documents/:id/tags
 * Apply requireAuth middleware
 * Accept JSON body: { tag_name }
 * Verify document belongs to current user
 * Find or create tag in Tags table with name and user_id
 * Create DocumentTags association
 * Return 201 Created with tag object
 * Return 400 if tag_name missing
 */
router.post('/:id/tags', requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user_id;
    const documentIdRaw = req.params.id;
    const { tag_name } = req.body;

    if (!userId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    if (!documentIdRaw || Array.isArray(documentIdRaw)) {
      return res.status(400).json({ error: 'Invalid Document ID' });
    }

    const documentId: string = documentIdRaw;

    // Validate tag_name
    if (!tag_name || typeof tag_name !== 'string' || !tag_name.trim()) {
      return res.status(400).json({ error: 'tag_name is required and must be a non-empty string' });
    }

    // Verify document exists and belongs to current user
    const document = await prisma.documents.findUnique({
      where: { id: documentId }
    });

    if (!document) {
      return res.status(404).json({ error: 'Document not found' });
    }

    if (document.user_id !== userId) {
      return res.status(403).json({ error: 'Forbidden: You do not have access to this document' });
    }

    // Find or create tag
    let tag = await prisma.tags.findUnique({
      where: {
        name_user_id: {
          name: tag_name.trim(),
          user_id: userId
        }
      }
    });

    if (!tag) {
      tag = await prisma.tags.create({
        data: {
          name: tag_name.trim(),
          user_id: userId
        }
      });
    }

    // Create DocumentTags association (if not already exists)
    try {
      await prisma.documentTags.create({
        data: {
          document_id: documentId,
          tag_id: tag.id
        }
      });
    } catch (error: any) {
      // If association already exists, ignore the error
      if (error.code === 'P2002') {
        // Unique constraint violation - association already exists
        return res.status(201).json({
          id: tag.id,
          name: tag.name,
          user_id: tag.user_id,
          created_at: tag.created_at
        });
      }
      throw error;
    }

    // Return 201 Created with tag object
    return res.status(201).json({
      id: tag.id,
      name: tag.name,
      user_id: tag.user_id,
      created_at: tag.created_at
    });
  } catch (error) {
    console.error('Create tag association error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * DELETE /api/documents/:id/tags/:tagId
 * Apply requireAuth middleware
 * Verify document and tag belong to current user
 * Delete DocumentTags association
 * Return 204 No Content
 * Return 404 if association doesn't exist
 */
router.delete('/:id/tags/:tagId', requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user_id;
    const documentIdRaw = req.params.id;
    const tagIdRaw = req.params.tagId;

    if (!userId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    if (!documentIdRaw || Array.isArray(documentIdRaw) || !tagIdRaw || Array.isArray(tagIdRaw)) {
      return res.status(400).json({ error: 'Invalid Document ID or Tag ID' });
    }

    const documentId: string = documentIdRaw;
    const tagId: string = tagIdRaw;

    // Verify document exists and belongs to current user
    const document = await prisma.documents.findUnique({
      where: { id: documentId }
    });

    if (!document) {
      return res.status(404).json({ error: 'Document not found' });
    }

    if (document.user_id !== userId) {
      return res.status(403).json({ error: 'Forbidden: You do not have access to this document' });
    }

    // Verify tag exists and belongs to current user
    const tag = await prisma.tags.findUnique({
      where: { id: tagId }
    });

    if (!tag) {
      return res.status(404).json({ error: 'Tag not found' });
    }

    if (tag.user_id !== userId) {
      return res.status(403).json({ error: 'Forbidden: You do not have access to this tag' });
    }

    // Check if association exists
    const association = await prisma.documentTags.findUnique({
      where: {
        document_id_tag_id: {
          document_id: documentId,
          tag_id: tagId
        }
      }
    });

    if (!association) {
      return res.status(404).json({ error: 'Tag association not found' });
    }

    // Delete DocumentTags association
    await prisma.documentTags.delete({
      where: {
        document_id_tag_id: {
          document_id: documentId,
          tag_id: tagId
        }
      }
    });

    // Return 204 No Content
    return res.status(204).send();
  } catch (error) {
    console.error('Delete tag association error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * POST /api/documents/:id/metadata
 * Apply requireAuth middleware
 * Accept JSON body: { field_name, field_value }
 * Verify document belongs to current user
 * Create or update MetadataFields record
 * Return 201 Created with metadata object
 */
router.post('/:id/metadata', requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user_id;
    const documentIdRaw = req.params.id;
    const { field_name, field_value } = req.body;

    if (!userId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    if (!documentIdRaw || Array.isArray(documentIdRaw)) {
      return res.status(400).json({ error: 'Invalid Document ID' });
    }

    const documentId: string = documentIdRaw;

    // Validate required fields
    if (!field_name || typeof field_name !== 'string' || !field_name.trim()) {
      return res.status(400).json({ error: 'field_name is required and must be a non-empty string' });
    }

    if (field_value === undefined || field_value === null) {
      return res.status(400).json({ error: 'field_value is required' });
    }

    // Verify document exists and belongs to current user
    const document = await prisma.documents.findUnique({
      where: { id: documentId }
    });

    if (!document) {
      return res.status(404).json({ error: 'Document not found' });
    }

    if (document.user_id !== userId) {
      return res.status(403).json({ error: 'Forbidden: You do not have access to this document' });
    }

    const normalizedFieldName = field_name.trim();
    const metadataField = await prisma.metadataFields.upsert({
      where: {
        document_id_field_name: { document_id: documentId, field_name: normalizedFieldName },
      },
      update: { field_value: String(field_value) },
      create: {
        document_id: documentId,
        field_name: normalizedFieldName,
        field_value: String(field_value),
      },
    });

    // Return 201 Created with metadata object
    return res.status(201).json({
      id: metadataField.id,
      document_id: metadataField.document_id,
      field_name: metadataField.field_name,
      field_value: metadataField.field_value,
      created_at: metadataField.created_at
    });
  } catch (error) {
    console.error('Create/update metadata error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * GET /api/documents/:id/metadata
 * Apply requireAuth middleware
 * Query MetadataFields for document_id
 * Return 200 OK with array of metadata fields
 */
router.get('/:id/metadata', requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user_id;
    const documentIdRaw = req.params.id;

    if (!userId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    if (!documentIdRaw || Array.isArray(documentIdRaw)) {
      return res.status(400).json({ error: 'Invalid Document ID' });
    }

    const documentId: string = documentIdRaw;

    // Verify document exists and belongs to current user
    const document = await prisma.documents.findUnique({
      where: { id: documentId }
    });

    if (!document) {
      return res.status(404).json({ error: 'Document not found' });
    }

    if (document.user_id !== userId) {
      return res.status(403).json({ error: 'Forbidden: You do not have access to this document' });
    }

    // Query MetadataFields for document_id
    const metadataFields = await prisma.metadataFields.findMany({
      where: {
        document_id: documentId
      },
      orderBy: {
        created_at: 'asc'
      }
    });

    // Format response
    const formattedFields = metadataFields.map(field => ({
      id: field.id,
      document_id: field.document_id,
      field_name: field.field_name,
      field_value: field.field_value,
      created_at: field.created_at
    }));

    // Return 200 OK with array of metadata fields
    return res.status(200).json(formattedFields);
  } catch (error) {
    console.error('Get metadata error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * GET /api/documents/:id/vectors
 * Apply requireAuth middleware
 * Query Vectors table for document_id
 * Return 200 OK with array of page texts (page_number and text_content)
 */
router.get('/:id/vectors', requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user_id;
    const documentIdRaw = req.params.id;

    if (!userId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    if (!documentIdRaw || Array.isArray(documentIdRaw)) {
      return res.status(400).json({ error: 'Invalid Document ID' });
    }

    const documentId: string = documentIdRaw;

    // Verify document exists and belongs to current user
    const document = await prisma.documents.findUnique({
      where: { id: documentId }
    });

    if (!document) {
      return res.status(404).json({ error: 'Document not found' });
    }

    if (document.user_id !== userId) {
      return res.status(403).json({ error: 'Forbidden: You do not have access to this document' });
    }

    // Query Vectors for document_id
    // Filter out page -1 (notes) which is only used for search, not viewing
    const vectors = await prisma.vectors.findMany({
      where: {
        document_id: documentId,
        page_number: {
          gte: 0  // Only include actual document pages, not notes (page -1)
        }
      },
      orderBy: {
        page_number: 'asc'
      },
      select: {
        page_number: true,
        text_content: true
      }
    });

    // Format response
    const pageTexts = vectors.map(vector => ({
      pageNumber: vector.page_number,
      text: vector.text_content
    }));

    // Return 200 OK with array of page texts
    return res.status(200).json(pageTexts);
  } catch (error) {
    console.error('Get vectors error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * PUT /api/documents/:id
 * Update document notes and title
 */
router.put('/:id', requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user_id;
    const documentIdRaw = req.params.id;
    const { notes, title } = req.body;

    if (notes !== undefined && notes !== null && typeof notes !== 'string') {
      return res.status(400).json({ error: 'notes must be a string or null' });
    }
    if (title !== undefined && title !== null && typeof title !== 'string') {
      return res.status(400).json({ error: 'title must be a string or null' });
    }

    if (!documentIdRaw || Array.isArray(documentIdRaw)) {
      return res.status(400).json({ error: 'Invalid Document ID' });
    }

    const documentId: string = documentIdRaw;

    // Verify document exists and belongs to user
    const document = await prisma.documents.findUnique({
      where: { id: documentId },
    });

    if (!document) {
      return res.status(404).json({ error: 'Document not found' });
    }

    if (document.user_id !== userId) {
      return res.status(403).json({ error: 'Forbidden: You do not have access to this document' });
    }

    const nextNotes = notes !== undefined ? notes : document.notes;
    const nextTitle = title !== undefined ? title : document.title;
    if (notes !== undefined || title !== undefined) {
      await updateDocumentMetadata(documentId, nextTitle, nextNotes);
    }

    const updatedDocument: any = await prisma.documents.findUnique({
      where: { id: documentId },
      include: {
        tags: {
          include: {
            tag: true
          }
        },
        metadata: true,
        processingStatus: {
          orderBy: {
            started_at: 'desc'
          }
        }
      }
    });

    // Format response to match expected structure
    const formattedDocument = {
      id: updatedDocument.id,
      title: updatedDocument.title,
      notes: updatedDocument.notes,
      filename: updatedDocument.original_filename,
      file_type: updatedDocument.file_type,
      file_size: updatedDocument.file_size,
      status: updatedDocument.status,
      upload_date: updatedDocument.upload_date,
      updated_at: updatedDocument.updated_at,
      tags: updatedDocument.tags.map((dt: any) => ({
        id: dt.tag.id,
        name: dt.tag.name
      })),
      metadata: updatedDocument.metadata.map((m: any) => ({
        id: m.id,
        field_name: m.field_name,
        field_value: m.field_value,
        created_at: m.created_at
      })),
      processing_status: updatedDocument.processingStatus.map((ps: any) => ({
        stage: ps.stage,
        started_at: ps.started_at,
        completed_at: ps.completed_at,
        error_message: ps.error_message,
        retry_count: ps.retry_count
      }))
    };

    return res.status(200).json(formattedDocument);
  } catch (error) {
    console.error('Update document error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * DELETE /api/documents/:id
 * Delete a document and its associated files
 */
router.delete('/:id', requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user_id;
    const documentIdRaw = req.params.id;

    if (!documentIdRaw || Array.isArray(documentIdRaw)) {
      return res.status(400).json({ error: 'Invalid Document ID' });
    }

    const documentId: string = documentIdRaw;

    // Verify document exists and belongs to user
    const document = await prisma.documents.findUnique({
      where: { id: documentId },
    });

    if (!document) {
      return res.status(404).json({ error: 'Document not found' });
    }

    if (document.user_id !== userId) {
      return res.status(403).json({ error: 'Forbidden: You do not have access to this document' });
    }

    // Cancel in-flight processing before removing its database record.
    await getWorkflowHandle(documentId).then(handle => handle.cancel()).catch(() => undefined);

    // Delete the database record first so a filesystem cleanup failure cannot leave
    // an accessible document pointing at missing files.
    const uploadsRoot = path.resolve(process.cwd(), 'uploads');
    const documentDir = path.resolve(uploadsRoot, documentId);
    if (path.dirname(documentDir) !== uploadsRoot) {
      throw new Error('Refusing to delete a path outside the uploads directory');
    }
    await prisma.documents.delete({
      where: { id: documentId },
    });

    await fs.rm(documentDir, { recursive: true, force: true }).catch((error) => {
      console.error('Failed to clean up deleted document files:', error);
    });

    return res.status(204).send();
  } catch (error) {
    console.error('Delete document error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
