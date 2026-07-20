import { pool } from '../db.js';
import { generateDenseVector } from './embeddings.js';
import { generateSparseVector } from './sparse-vectors.js';

export interface SearchFilters {
  date_from?: string;
  date_to?: string;
  document_type?: string;
  tags?: string[];
}

export interface SearchResult {
  document_id: string;
  filename: string;
  upload_date: Date;
  file_type: string;
  relevance_score: number;
  snippet: string;
  page_number: number;
}

export interface SearchPage {
  results: SearchResult[];
  total: number;
}

function appendFilters(filters: SearchFilters | undefined, params: unknown[], firstParameter: number): string {
  let clause = '';
  let parameter = firstParameter;
  if (filters?.date_from) {
    clause += ` AND d.upload_date >= $${parameter++}`;
    params.push(new Date(filters.date_from));
  }
  if (filters?.date_to) {
    const endExclusive = new Date(filters.date_to);
    endExclusive.setUTCDate(endExclusive.getUTCDate() + 1);
    clause += ` AND d.upload_date < $${parameter++}`;
    params.push(endExclusive);
  }
  if (filters?.document_type) {
    clause += ` AND d.file_type = $${parameter++}`;
    params.push(filters.document_type);
  }
  if (filters?.tags?.length) {
    clause += ` AND EXISTS (
      SELECT 1 FROM document_tags dt
      WHERE dt.document_id = d.id AND dt.tag_id = ANY($${parameter++}::text[])
    )`;
    params.push(filters.tags);
  }
  return clause;
}

export async function hybridSearch(
  query: string,
  userId: string,
  filters: SearchFilters | undefined,
  page: number,
  perPage: number,
): Promise<SearchPage> {
  const denseVector = await generateDenseVector(query, 'search_query');
  const sparseVector = generateSparseVector(query);
  const params: unknown[] = [`[${denseVector.join(',')}]`, userId, JSON.stringify(sparseVector)];
  const filterClause = appendFilters(filters, params, 4);
  const candidateParameter = params.length + 1;
  const limitParameter = params.length + 2;
  const offsetParameter = params.length + 3;
  const candidateLimit = Math.max(1000, page * perPage * 20);
  params.push(candidateLimit, perPage, (page - 1) * perPage);

  const sql = `
    WITH candidate_vectors AS (
      SELECT v.document_id, v.page_number, v.text_content, v.dense_vector, v.sparse_vector,
             d.original_filename, d.upload_date, d.file_type
      FROM vectors v
      JOIN documents d ON d.id = v.document_id
      WHERE d.user_id = $2 AND d.status = 'READY' AND v.dense_vector IS NOT NULL
      ${filterClause}
      ORDER BY v.dense_vector <=> $1::vector
      LIMIT $${candidateParameter}
    ), scored AS (
      SELECT
        v.document_id, v.page_number, v.text_content, v.original_filename,
        v.upload_date, v.file_type,
        GREATEST(0, 1 - (v.dense_vector <=> $1::vector)) AS dense_score,
        COALESCE((
          SELECT SUM((q.value #>> '{}')::double precision * (v.sparse_vector ->> q.key)::double precision)
          FROM jsonb_each($3::jsonb) q
          WHERE v.sparse_vector ? q.key
        ), 0) AS sparse_raw
      FROM candidate_vectors v
    ), ranked AS (
      SELECT *,
        (0.6 * dense_score + 0.4 * (sparse_raw / (1 + sparse_raw))) AS relevance_score,
        ROW_NUMBER() OVER (
          PARTITION BY document_id
          ORDER BY (0.6 * dense_score + 0.4 * (sparse_raw / (1 + sparse_raw))) DESC
        ) AS page_rank
      FROM scored
    )
    SELECT document_id, page_number, text_content, original_filename,
           upload_date, file_type, relevance_score
    FROM ranked
    WHERE page_rank = 1
    ORDER BY relevance_score DESC, upload_date DESC
    LIMIT $${limitParameter} OFFSET $${offsetParameter}
  `;

  const countParams: unknown[] = [userId];
  const countFilters = appendFilters(filters, countParams, 2);
  const [rows, count] = await Promise.all([
    pool.query(sql, params),
    pool.query(
      `SELECT COUNT(DISTINCT d.id) AS total
       FROM documents d JOIN vectors v ON v.document_id = d.id
       WHERE d.user_id = $1 AND d.status = 'READY' AND v.dense_vector IS NOT NULL ${countFilters}`,
      countParams,
    ),
  ]);

  return {
    results: rows.rows.map(row => ({
      document_id: row.document_id,
      filename: row.original_filename,
      upload_date: row.upload_date,
      file_type: row.file_type,
      relevance_score: Number(row.relevance_score),
      snippet: extractSnippet(row.text_content, query),
      page_number: row.page_number,
    })),
    total: Number(count.rows[0]?.total ?? 0),
  };
}

export function extractSnippet(fullText: string, query: string): string {
  const radius = 150;
  const terms = query.toLowerCase().match(/\b\w+\b/g) || [];
  if (!fullText || terms.length === 0) {
    return fullText.substring(0, radius * 2) + (fullText.length > radius * 2 ? '...' : '');
  }
  const lowerText = fullText.toLowerCase();
  let position = -1;
  let matchLength = 0;
  for (const term of terms) {
    const candidate = lowerText.indexOf(term);
    if (candidate !== -1 && (position === -1 || candidate < position)) {
      position = candidate;
      matchLength = term.length;
    }
  }
  if (position === -1) {
    return fullText.substring(0, radius * 2) + (fullText.length > radius * 2 ? '...' : '');
  }
  const start = Math.max(0, position - radius);
  const end = Math.min(fullText.length, position + matchLength + radius);
  return `${start > 0 ? '...' : ''}${fullText.substring(start, end)}${end < fullText.length ? '...' : ''}`.trim();
}

export async function updateDocumentMetadata(
  documentId: string,
  title?: string | null,
  notes?: string | null,
): Promise<void> {
  const parts: string[] = [];
  if (title?.trim()) parts.push(`Title: ${title.trim()}`);
  if (notes?.trim()) parts.push(`Notes: ${notes.trim()}`);
  const text = parts.join('\n\n');
  const denseVector = text ? await generateDenseVector(text) : null;
  const sparseVector = text ? generateSparseVector(text) : null;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(
      'UPDATE documents SET title = $2, notes = $3, updated_at = NOW() WHERE id = $1',
      [documentId, title ?? null, notes ?? null],
    );
    if (!text || !denseVector || !sparseVector) {
      await client.query('DELETE FROM vectors WHERE document_id = $1 AND page_number = -1', [documentId]);
    } else {
      await client.query(
        `INSERT INTO vectors (id, document_id, page_number, dense_vector, sparse_vector, text_content)
         VALUES (gen_random_uuid()::text, $1, -1, $2::vector, $3::jsonb, $4)
         ON CONFLICT (document_id, page_number) DO UPDATE SET
           dense_vector = EXCLUDED.dense_vector,
           sparse_vector = EXCLUDED.sparse_vector,
           text_content = EXCLUDED.text_content`,
        [documentId, `[${denseVector.join(',')}]`, JSON.stringify(sparseVector), text],
      );
    }
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}
