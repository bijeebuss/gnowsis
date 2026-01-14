/**
 * Hybrid vector search implementation
 * Combines dense (semantic) and sparse (keyword) search with weighted scoring
 */

import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';
import { generateDenseVector } from './embeddings.js';
import { generateSparseVector, sparseDotProduct } from './sparse-vectors.js';

// Create PostgreSQL connection pool
const pool = new Pool({
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT || '5432'),
  user: process.env.DB_USER || 'postgres',
  password: process.env.DB_PASSWORD || 'postgres',
  database: process.env.DB_NAME || 'tldr',
});

const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

/**
 * Search filters for refining results
 */
export interface SearchFilters {
  date_from?: string;
  date_to?: string;
  document_type?: string;
  tags?: string[];
}

/**
 * Search result structure
 */
export interface SearchResult {
  document_id: string;
  filename: string;
  upload_date: Date;
  file_type: string;
  relevance_score: number;
  snippet: string;
  page_number: number;
}

/**
 * Perform hybrid search combining dense and sparse vectors
 *
 * Scoring: 60% dense (semantic) + 40% sparse (keyword)
 * Groups results by document, returning only the highest-scoring page per document
 *
 * @param query - Search query text
 * @param userId - User ID for filtering results
 * @param filters - Optional filters for date range, document type, tags
 * @returns Array of search results (one per document) ranked by relevance score
 */
export async function hybridSearch(
  query: string,
  userId: string,
  filters?: SearchFilters
): Promise<SearchResult[]> {
  // Generate query vectors
  const queryDenseVector = await generateDenseVector(query);
  const querySparseVector = generateSparseVector(query);

  // Format dense vector for pgvector: [val1,val2,val3,...]
  const queryDenseVectorStr = `[${queryDenseVector.join(',')}]`;

  // Build SQL query with filters
  // Use window function to rank vectors within each document by dense distance
  // This ensures we get the best match from each document before limiting
  let sqlQuery = `
    WITH ranked_vectors AS (
      SELECT
        v.id as vector_id,
        v.document_id,
        v.page_number,
        v.text_content,
        v.dense_vector,
        v.sparse_vector,
        d.filename,
        d.original_filename,
        d.upload_date,
        d.file_type,
        d.status,
        (v.dense_vector <-> $1::vector) as dense_distance,
        -- Rank vectors within each document by dense distance (best match = rank 1)
        ROW_NUMBER() OVER (PARTITION BY v.document_id ORDER BY (v.dense_vector <-> $1::vector)) as rank
      FROM vectors v
      INNER JOIN documents d ON v.document_id = d.id
      WHERE d.user_id = $2
        AND d.status = 'READY'
  `;

  const queryParams: any[] = [queryDenseVectorStr, userId];
  let paramIndex = 3;

  // Apply date filters
  if (filters?.date_from) {
    sqlQuery += ` AND d.upload_date >= $${paramIndex}`;
    queryParams.push(new Date(filters.date_from));
    paramIndex++;
  }

  if (filters?.date_to) {
    sqlQuery += ` AND d.upload_date <= $${paramIndex}`;
    queryParams.push(new Date(filters.date_to));
    paramIndex++;
  }

  // Apply document type filter
  if (filters?.document_type) {
    sqlQuery += ` AND d.file_type = $${paramIndex}`;
    queryParams.push(filters.document_type);
    paramIndex++;
  }

  // Apply tag filter if provided
  if (filters?.tags && filters.tags.length > 0) {
    sqlQuery += `
      AND d.id IN (
        SELECT dt.document_id
        FROM document_tags dt
        INNER JOIN tags t ON dt.tag_id = t.id
        WHERE t.name = ANY($${paramIndex})
      )
    `;
    queryParams.push(filters.tags);
    paramIndex++;
  }

  // Close the CTE and select only the top-ranked vector per document
  sqlQuery += `
    )
    SELECT
      vector_id,
      document_id,
      page_number,
      text_content,
      dense_vector,
      sparse_vector,
      filename,
      original_filename,
      upload_date,
      file_type,
      status,
      dense_distance,
      sparse_vector as sparse_vec
    FROM ranked_vectors
    WHERE rank = 1
    ORDER BY dense_distance
    LIMIT 100
  `;

  // Execute query
  const rawResults = await pool.query(sqlQuery, queryParams);

  // Calculate hybrid scores (SQL already gives us one result per document)
  const results: SearchResult[] = rawResults.rows.map((row) => {
    // Dense score: convert distance to similarity (1 - normalized_distance)
    // pgvector L2 distance is >= 0, normalize to [0, 1]
    const denseDistance = parseFloat(row.dense_distance);
    const denseScore = Math.max(0, 1 - denseDistance / 2); // Normalize assuming max distance ~2

    // Sparse score: calculate dot product between query and document sparse vectors
    const docSparseVector = row.sparse_vec as { [token: string]: number };
    const sparseScore = sparseDotProduct(querySparseVector, docSparseVector);

    // Hybrid score: 60% dense + 40% sparse
    const hybridScore = 0.6 * denseScore + 0.4 * sparseScore;

    // Extract snippet
    const snippet = extractSnippet(row.text_content, query);

    return {
      document_id: row.document_id,
      filename: row.original_filename,
      upload_date: row.upload_date,
      file_type: row.file_type,
      relevance_score: hybridScore,
      snippet: snippet,
      page_number: row.page_number,
    };
  });

  // Sort by hybrid relevance score (highest first)
  results.sort((a, b) => b.relevance_score - a.relevance_score);

  return results;
}

/**
 * Extract a text snippet around the query terms with context
 *
 * Returns up to 150 characters before and after the first match.
 *
 * @param fullText - Full text content
 * @param query - Search query
 * @returns Snippet with context around query match
 */
export function extractSnippet(fullText: string, query: string): string {
  const snippetRadius = 150; // Characters before and after match

  // Normalize for searching
  const normalizedText = fullText;
  const normalizedQuery = query.toLowerCase();

  // Split query into terms
  const queryTerms = normalizedQuery.match(/\b\w+\b/g) || [];

  if (queryTerms.length === 0 || !fullText) {
    // No query terms or empty text, return beginning of text
    return fullText.substring(0, snippetRadius * 2) + (fullText.length > snippetRadius * 2 ? '...' : '');
  }

  // Find first occurrence of any query term
  let matchPosition = -1;
  let matchLength = 0;

  for (const term of queryTerms) {
    const position = normalizedText.toLowerCase().indexOf(term);
    if (position !== -1 && (matchPosition === -1 || position < matchPosition)) {
      matchPosition = position;
      matchLength = term.length;
    }
  }

  // If no match found, return beginning of text
  if (matchPosition === -1) {
    return fullText.substring(0, snippetRadius * 2) + (fullText.length > snippetRadius * 2 ? '...' : '');
  }

  // Calculate snippet boundaries
  const snippetStart = Math.max(0, matchPosition - snippetRadius);
  const snippetEnd = Math.min(fullText.length, matchPosition + matchLength + snippetRadius);

  // Extract snippet
  let snippet = fullText.substring(snippetStart, snippetEnd);

  // Add ellipsis if truncated
  if (snippetStart > 0) {
    snippet = '...' + snippet;
  }
  if (snippetEnd < fullText.length) {
    snippet = snippet + '...';
  }

  return snippet.trim();
}

/**
 * Get total count of search results (for pagination)
 *
 * @param query - Search query text
 * @param userId - User ID for filtering results
 * @param filters - Optional filters
 * @returns Total count of matching documents
 */
export async function getSearchResultCount(
  query: string,
  userId: string,
  filters?: SearchFilters
): Promise<number> {
  // Build count query
  let sqlQuery = `
    SELECT COUNT(DISTINCT v.document_id) as total
    FROM vectors v
    INNER JOIN documents d ON v.document_id = d.id
    WHERE d.user_id = $1
      AND d.status = 'READY'
  `;

  const queryParams: any[] = [userId];
  let paramIndex = 2;

  // Apply filters (same as main search)
  if (filters?.date_from) {
    sqlQuery += ` AND d.upload_date >= $${paramIndex}`;
    queryParams.push(new Date(filters.date_from));
    paramIndex++;
  }

  if (filters?.date_to) {
    sqlQuery += ` AND d.upload_date <= $${paramIndex}`;
    queryParams.push(new Date(filters.date_to));
    paramIndex++;
  }

  if (filters?.document_type) {
    sqlQuery += ` AND d.file_type = $${paramIndex}`;
    queryParams.push(filters.document_type);
    paramIndex++;
  }

  if (filters?.tags && filters.tags.length > 0) {
    sqlQuery += `
      AND d.id IN (
        SELECT dt.document_id
        FROM document_tags dt
        INNER JOIN tags t ON dt.tag_id = t.id
        WHERE t.name = ANY($${paramIndex})
      )
    `;
    queryParams.push(filters.tags);
    paramIndex++;
  }

  const result = await pool.query(sqlQuery, queryParams);
  return parseInt(result.rows[0].total) || 0;
}

/**
 * Update or create the metadata vector (page -1) for a document
 * This stores title and notes for searchability
 *
 * @param documentId - Document UUID
 * @param title - Document title (optional)
 * @param notes - Document notes (optional)
 */
export async function updateMetadataVector(
  documentId: string,
  title?: string | null,
  notes?: string | null
): Promise<void> {
  // Build metadata text from title and notes
  const metadataText: string[] = [];

  if (title && title.trim()) {
    metadataText.push(`Title: ${title.trim()}`);
  }

  if (notes && notes.trim()) {
    metadataText.push(`Notes: ${notes.trim()}`);
  }

  // Delete existing page -1 vector
  await pool.query(
    `DELETE FROM vectors WHERE document_id = $1::uuid AND page_number = -1`,
    [documentId]
  );

  // If we have metadata to index, create new vector
  if (metadataText.length > 0) {
    const text = metadataText.join('\n\n');

    // Generate vectors
    const denseVector = await generateDenseVector(text);
    const sparseVector = generateSparseVector(text);

    // Format dense vector for pgvector
    const denseVectorStr = `[${denseVector.join(',')}]`;

    // Insert new vector
    await pool.query(
      `INSERT INTO vectors (id, document_id, page_number, dense_vector, sparse_vector, text_content)
       VALUES (gen_random_uuid(), $1::uuid, -1, $2::vector, $3::jsonb, $4)`,
      [documentId, denseVectorStr, JSON.stringify(sparseVector), text]
    );
  }
}

export { prisma, pool };
