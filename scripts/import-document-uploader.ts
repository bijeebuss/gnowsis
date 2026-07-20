import { createHash } from 'crypto';
import { execFile } from 'child_process';
import { promisify } from 'util';
import * as fs from 'fs/promises';
import * as path from 'path';
import pg from 'pg';
import { Connection, Client as TemporalClient } from '@temporalio/client';
import { generateDenseVector } from '../server/utils/embeddings.js';
import { generateSparseVector } from '../server/utils/sparse-vectors.js';

const { Client, Pool } = pg;
const execFileAsync = promisify(execFile);

const TARGET_EMAIL = process.env.IMPORT_TARGET_EMAIL || 'michael@welnick.net';
const SOURCE_DIR = path.resolve(process.env.LEGACY_UPLOADS_DIR || '/legacy-uploads');
const TARGET_DIR = path.resolve(process.env.TARGET_UPLOADS_DIR || '/app/uploads');
const SOURCE_PREFIX = 'legacy-document-uploader:';
const UUID_ASSET = /^([0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})\.(pdf|png)$/i;
const BATCH_SIZE = 25;
const PROVIDED_PAGE_COUNTS = new Map<string, number>(
  Object.entries(JSON.parse(process.env.LEGACY_PAGE_COUNTS_JSON || '{}'))
    .map(([id, count]) => [id.toLowerCase(), Number(count)]),
);

type Phase = 'dry-run' | 'stage' | 'previews' | 'embed' | 'finalize' | 'launch' | 'verify';

interface LegacyRow {
  id: string;
  tags: string[] | null;
  notes: string | null;
  text: string | null;
  timestamp: Date;
}

interface Asset {
  id: string;
  extension: 'pdf' | 'png';
  sourcePath: string;
  size: number;
  timestamp: Date;
  pageCount: number;
  row: LegacyRow | null;
  mode: 'reuse' | 'reprocess';
}

interface Inventory {
  assets: Asset[];
  sourceRows: number;
  orphanAssets: number;
  reuseDocuments: number;
  reprocessDocuments: number;
  totalPages: number;
  reprocessPages: number;
  normalizedTagAssignments: number;
}

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Required environment variable ${name} is not set`);
  return value;
}

function sourceConfig(): pg.ClientConfig {
  return {
    host: required('LEGACY_DB_HOST'),
    port: Number(process.env.LEGACY_DB_PORT || '5432'),
    database: process.env.LEGACY_DB_NAME || 'documents',
    user: process.env.LEGACY_DB_USER || 'postgres',
    password: required('LEGACY_DB_PASSWORD'),
  };
}

function normalizedTags(tags: string[] | null): string[] {
  return [...new Set((tags || []).filter((tag): tag is string => typeof tag === 'string' && tag.trim() !== ''))];
}

async function pageCount(id: string, assetPath: string, extension: 'pdf' | 'png'): Promise<number> {
  if (extension === 'png') return 1;
  const provided = PROVIDED_PAGE_COUNTS.get(id);
  if (Number.isInteger(provided) && provided! > 0) return provided!;
  const { stdout } = await execFileAsync('pdfinfo', [assetPath], { maxBuffer: 1024 * 1024 });
  const count = Number.parseInt(stdout.match(/^Pages:\s+(\d+)$/m)?.[1] || '', 10);
  if (!Number.isInteger(count) || count < 1) throw new Error('A source PDF has no readable pages');
  return count;
}

async function loadInventory(source: pg.Client): Promise<Inventory> {
  const result = await source.query<LegacyRow>(
    'SELECT id::text, tags, notes, text, timestamp FROM documents ORDER BY id',
  );
  const rows = new Map(result.rows.map(row => [row.id.toLowerCase(), row]));
  const entries = await fs.readdir(SOURCE_DIR, { withFileTypes: true });
  const candidates = entries
    .filter(entry => entry.isFile() && UUID_ASSET.test(entry.name))
    .map(entry => {
      const match = entry.name.match(UUID_ASSET)!;
      return { name: entry.name, id: match[1]!.toLowerCase(), extension: match[2]!.toLowerCase() as 'pdf' | 'png' };
    })
    .sort((a, b) => a.id.localeCompare(b.id));

  const seen = new Set<string>();
  const assets: Asset[] = [];
  for (const candidate of candidates) {
    if (seen.has(candidate.id)) throw new Error('A source UUID has more than one asset');
    seen.add(candidate.id);
    const sourcePath = path.join(SOURCE_DIR, candidate.name);
    const stat = await fs.stat(sourcePath);
    const row = rows.get(candidate.id) || null;
    const pages = await pageCount(candidate.id, sourcePath, candidate.extension);
    const mode = row && row.text && row.text.trim() && pages === 1 ? 'reuse' : 'reprocess';
    assets.push({
      id: candidate.id,
      extension: candidate.extension,
      sourcePath,
      size: stat.size,
      timestamp: row?.timestamp || stat.mtime,
      pageCount: pages,
      row,
      mode,
    });
  }

  const missingAssets = [...rows.keys()].filter(id => !seen.has(id));
  if (missingAssets.length) throw new Error(`${missingAssets.length} database rows have no source asset`);

  return {
    assets,
    sourceRows: rows.size,
    orphanAssets: assets.filter(asset => !asset.row).length,
    reuseDocuments: assets.filter(asset => asset.mode === 'reuse').length,
    reprocessDocuments: assets.filter(asset => asset.mode === 'reprocess').length,
    totalPages: assets.reduce((sum, asset) => sum + asset.pageCount, 0),
    reprocessPages: assets.filter(asset => asset.mode === 'reprocess').reduce((sum, asset) => sum + asset.pageCount, 0),
    normalizedTagAssignments: assets.reduce((sum, asset) => sum + normalizedTags(asset.row?.tags || null).length, 0),
  };
}

function printInventory(inventory: Inventory): void {
  console.log(JSON.stringify({
    source_database_rows: inventory.sourceRows,
    source_assets: inventory.assets.length,
    orphan_assets_recovered: inventory.orphanAssets,
    total_pages: inventory.totalPages,
    reuse_documents: inventory.reuseDocuments,
    reprocess_documents: inventory.reprocessDocuments,
    reprocess_pages: inventory.reprocessPages,
    normalized_tag_assignments: inventory.normalizedTagAssignments,
  }));
}

async function resolveUserId(target: pg.Pool): Promise<string> {
  const result = await target.query<{ id: string }>(
    'SELECT id FROM users WHERE lower(email) = lower($1)',
    [TARGET_EMAIL],
  );
  if (result.rowCount !== 1) throw new Error(`Target email resolved to ${result.rowCount} users instead of one`);
  return result.rows[0]!.id;
}

async function renderSinglePagePdf(sourcePath: string, outputPath: string): Promise<void> {
  const { stdout: pdfMetadata } = await execFileAsync('pdfinfo', [sourcePath], { maxBuffer: 1024 * 1024 });
  const sizeMatch = pdfMetadata.match(/^Page size:\s+([0-9.]+)\s+x\s+([0-9.]+)\s+pts/m);
  if (!sizeMatch) throw new Error('Could not determine source PDF page dimensions');
  const widthPoints = Number(sizeMatch[1]);
  const heightPoints = Number(sizeMatch[2]);
  const longestEdgeDpi = (12_000 * 72) / Math.max(widthPoints, heightPoints);
  const pixelAreaDpi = Math.sqrt((20_000_000 * 72 * 72) / (widthPoints * heightPoints));
  const density = Math.max(10, Math.floor(Math.min(150, longestEdgeDpi, pixelAreaDpi)));
  const outputPrefix = outputPath.replace(/\.png$/i, '');
  await execFileAsync('pdftoppm', [
    '-f', '1',
    '-l', '1',
    '-singlefile',
    '-r', String(density),
    '-png',
    sourcePath,
    outputPrefix,
  ], { maxBuffer: 1024 * 1024 });
}

async function stageFiles(asset: Asset): Promise<string> {
  const deferPdfPreviews = process.env.DEFER_PDF_PREVIEWS === '1';
  const documentDir = path.join(TARGET_DIR, asset.id);
  const existing = await fs.stat(documentDir).then(() => true).catch(() => false);
  if (existing) {
    const filename = `file-0.${asset.extension}`;
    const existingOriginal = path.join(documentDir, filename);
    const existingHash = await fileHash(existingOriginal).catch(() => null);
    if (!existingHash || existingHash !== await fileHash(asset.sourcePath)) {
      throw new Error('A resumed destination directory does not match its source asset');
    }
    if (asset.mode === 'reuse') {
      const pagesDir = path.join(documentDir, 'pages');
      const preview = path.join(pagesDir, 'page-0.png');
      const hasPreview = await fs.stat(preview).then(() => true).catch(() => false);
      if (!hasPreview && !(deferPdfPreviews && asset.extension === 'pdf')) {
        await fs.mkdir(pagesDir, { recursive: true });
        if (asset.extension === 'png') await fs.copyFile(asset.sourcePath, preview);
        else await renderSinglePagePdf(asset.sourcePath, preview);
      }
    }
    return documentDir;
  }

  const temporaryDir = path.join(TARGET_DIR, `.legacy-${asset.id}.tmp`);
  await fs.rm(temporaryDir, { recursive: true, force: true });
  await fs.mkdir(temporaryDir, { recursive: false });
  try {
    const filename = `file-0.${asset.extension}`;
    await fs.copyFile(asset.sourcePath, path.join(temporaryDir, filename));
    if (asset.mode === 'reuse') {
      const pagesDir = path.join(temporaryDir, 'pages');
      await fs.mkdir(pagesDir);
      if (asset.extension === 'png') {
        await fs.copyFile(asset.sourcePath, path.join(pagesDir, 'page-0.png'));
      } else if (!deferPdfPreviews) {
        await renderSinglePagePdf(asset.sourcePath, path.join(pagesDir, 'page-0.png'));
      }
    }
    await fs.rename(temporaryDir, documentDir);
  } catch (error) {
    await fs.rm(temporaryDir, { recursive: true, force: true });
    throw error;
  }
  return documentDir;
}

async function renderMissingPreviews(inventory: Inventory): Promise<void> {
  const pending = inventory.assets.filter(asset => asset.mode === 'reuse' && asset.extension === 'pdf');
  const concurrency = Math.max(1, Math.min(4, Number(process.env.PREVIEW_CONCURRENCY || '2')));
  let cursor = 0;
  let rendered = 0;
  let skipped = 0;

  async function worker(): Promise<void> {
    while (true) {
      const index = cursor++;
      const asset = pending[index];
      if (!asset) return;
      const documentDir = path.join(TARGET_DIR, asset.id);
      const original = path.join(documentDir, `file-0.${asset.extension}`);
      const previewDir = path.join(documentDir, 'pages');
      const preview = path.join(previewDir, 'page-0.png');
      const originalExists = await fs.stat(original).then(() => true).catch(() => false);
      if (!originalExists) throw new Error('A staged PDF is missing its destination original');
      const previewExists = await fs.stat(preview).then(() => true).catch(() => false);
      if (previewExists) {
        skipped++;
        continue;
      }
      await fs.mkdir(previewDir, { recursive: true });
      const temporaryPreview = `${preview}.tmp.png`;
      await fs.rm(temporaryPreview, { force: true });
      await renderSinglePagePdf(original, temporaryPreview);
      await fs.rename(temporaryPreview, preview);
      rendered++;
      if ((rendered + skipped) % 10 === 0) console.log(JSON.stringify({ previews_rendered: rendered, previews_skipped: skipped }));
    }
  }

  await Promise.all(Array.from({ length: concurrency }, () => worker()));
  console.log(JSON.stringify({ previews_rendered: rendered, previews_skipped: skipped, previews_complete: true }));
}

async function stage(inventory: Inventory, target: pg.Pool, userId: string): Promise<void> {
  let created = 0;
  let skipped = 0;
  for (const asset of inventory.assets) {
    const sourceKey = `${SOURCE_PREFIX}${asset.id}`;
    const existing = await target.query<{ id: string; user_id: string }>(
      'SELECT id, user_id FROM documents WHERE id = $1 OR source_key = $2',
      [asset.id, sourceKey],
    );
    if (existing.rowCount) {
      if (existing.rowCount !== 1 || existing.rows[0]!.id !== asset.id || existing.rows[0]!.user_id !== userId) {
        throw new Error('An imported document conflicts with an existing destination record');
      }
      await stageFiles(asset);
      skipped++;
      continue;
    }

    const documentDir = await stageFiles(asset);
    const filename = `file-0.${asset.extension}`;
    const targetPath = path.join(documentDir, filename);
    const mimeType = asset.extension === 'pdf' ? 'application/pdf' : 'image/png';
    const client = await target.connect();
    try {
      await client.query('BEGIN');
      await client.query(
        `INSERT INTO documents
          (id, user_id, title, notes, filename, original_filename, file_path, file_size, file_type,
           source_key, status, upload_date, updated_at)
         VALUES ($1, $2, NULL, $3, $4, $5, $6, $7, $8, $9, $10, $11, $11)`,
        [
          asset.id,
          userId,
          asset.row?.notes ?? null,
          filename,
          `${asset.id}.${asset.extension}`,
          targetPath,
          asset.size,
          mimeType,
          sourceKey,
          asset.mode === 'reuse' ? 'OCR_COMPLETE' : 'UPLOADED',
          asset.timestamp,
        ],
      );
      await client.query(
        `INSERT INTO document_files
          (id, document_id, position, filename, original_filename, file_path, file_size, file_type)
         VALUES (gen_random_uuid()::text, $1, 0, $2, $3, $4, $5, $6)`,
        [asset.id, filename, `${asset.id}.${asset.extension}`, targetPath, asset.size, mimeType],
      );

      for (const tagName of normalizedTags(asset.row?.tags || null)) {
        const tag = await client.query<{ id: string }>(
          `INSERT INTO tags (id, name, user_id, created_at)
           VALUES (gen_random_uuid()::text, $1, $2, $3)
           ON CONFLICT (name, user_id) DO UPDATE SET name = EXCLUDED.name
           RETURNING id`,
          [tagName, userId, asset.timestamp],
        );
        await client.query(
          `INSERT INTO document_tags (document_id, tag_id) VALUES ($1, $2)
           ON CONFLICT DO NOTHING`,
          [asset.id, tag.rows[0]!.id],
        );
      }

      await client.query(
        `INSERT INTO processing_status
          (id, document_id, stage, started_at, completed_at, error_message, retry_count)
         VALUES (gen_random_uuid()::text, $1, 'FILE_RECEIVED', $2, $2, NULL, 0)`,
        [asset.id, asset.timestamp],
      );

      if (asset.mode === 'reuse') {
        const text = asset.row!.text!;
        await client.query(
          `INSERT INTO vectors
            (id, document_id, page_number, dense_vector, sparse_vector, text_content)
           VALUES (gen_random_uuid()::text, $1, 0, NULL, $2::jsonb, $3)`,
          [asset.id, JSON.stringify(generateSparseVector(text)), text],
        );
        const notes = asset.row?.notes?.trim();
        if (notes) {
          const noteText = `Notes: ${notes}`;
          await client.query(
            `INSERT INTO vectors
              (id, document_id, page_number, dense_vector, sparse_vector, text_content)
             VALUES (gen_random_uuid()::text, $1, -1, NULL, $2::jsonb, $3)`,
            [asset.id, JSON.stringify(generateSparseVector(noteText)), noteText],
          );
        }
        await client.query(
          `INSERT INTO processing_status
            (id, document_id, stage, started_at, completed_at, error_message, retry_count)
           VALUES (gen_random_uuid()::text, $1, 'OCR_EXTRACTION', $2, $2, NULL, 0)`,
          [asset.id, asset.timestamp],
        );
      }
      await client.query('COMMIT');
      created++;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }

    if ((created + skipped) % BATCH_SIZE === 0) {
      console.log(JSON.stringify({ staged: created, already_staged: skipped }));
    }
  }
  console.log(JSON.stringify({ staged: created, already_staged: skipped }));
}

async function embed(target: pg.Pool, userId: string): Promise<void> {
  let embedded = 0;
  while (true) {
    const batch = await target.query<{ id: string; text_content: string }>(
      `SELECT v.id, v.text_content
       FROM vectors v
       JOIN documents d ON d.id = v.document_id
       WHERE d.user_id = $1
         AND d.source_key LIKE $2
         AND d.status = 'OCR_COMPLETE'
         AND v.dense_vector IS NULL
         AND btrim(v.text_content) <> ''
       ORDER BY v.id
       LIMIT $3`,
      [userId, `${SOURCE_PREFIX}%`, BATCH_SIZE],
    );
    if (!batch.rowCount) break;
    for (const row of batch.rows) {
      let vector: number[];
      try {
        vector = await generateDenseVector(row.text_content, 'search_document');
      } catch {
        throw new Error(`Embedding failed after ${embedded} successful imported vectors; rerun is safe`);
      }
      await target.query(
        'UPDATE vectors SET dense_vector = $2::vector WHERE id = $1 AND dense_vector IS NULL',
        [row.id, `[${vector.join(',')}]`],
      );
      embedded++;
    }
    console.log(JSON.stringify({ embedded_vectors: embedded }));
  }
  console.log(JSON.stringify({ embedded_vectors: embedded, embedding_complete: true }));
}

async function finalize(inventory: Inventory, target: pg.Pool, userId: string): Promise<void> {
  const reuseIds = inventory.assets.filter(asset => asset.mode === 'reuse').map(asset => asset.id);
  const client = await target.connect();
  try {
    await client.query('BEGIN');
    const incomplete = await client.query<{ count: string }>(
      `SELECT count(*)::text AS count
       FROM vectors v JOIN documents d ON d.id = v.document_id
       WHERE d.user_id = $1 AND d.id = ANY($2::text[])
         AND btrim(v.text_content) <> '' AND v.dense_vector IS NULL`,
      [userId, reuseIds],
    );
    if (Number(incomplete.rows[0]!.count) !== 0) throw new Error('Some reusable vectors are not embedded');
    const updated = await client.query(
      `UPDATE documents SET status = 'READY', updated_at = NOW()
       WHERE user_id = $1 AND id = ANY($2::text[]) AND status = 'OCR_COMPLETE'`,
      [userId, reuseIds],
    );
    await client.query(
      `INSERT INTO processing_status
        (id, document_id, stage, started_at, completed_at, error_message, retry_count)
       SELECT gen_random_uuid()::text, d.id, 'VECTORIZATION', NOW(), NOW(), NULL, 0
       FROM documents d
       WHERE d.user_id = $1 AND d.id = ANY($2::text[])
         AND NOT EXISTS (
           SELECT 1 FROM processing_status p WHERE p.document_id = d.id AND p.stage = 'VECTORIZATION'
         )`,
      [userId, reuseIds],
    );
    await client.query(
      `INSERT INTO processing_status
        (id, document_id, stage, started_at, completed_at, error_message, retry_count)
       SELECT gen_random_uuid()::text, d.id, 'INDEXING_COMPLETE', NOW(), NOW(), NULL, 0
       FROM documents d
       WHERE d.user_id = $1 AND d.id = ANY($2::text[])
         AND NOT EXISTS (
           SELECT 1 FROM processing_status p WHERE p.document_id = d.id AND p.stage = 'INDEXING_COMPLETE'
         )`,
      [userId, reuseIds],
    );
    await client.query('COMMIT');
    console.log(JSON.stringify({ reusable_documents_ready: updated.rowCount || 0 }));
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

async function launch(inventory: Inventory, target: pg.Pool, userId: string): Promise<void> {
  const address = process.env.TEMPORAL_ADDRESS || 'localhost:7233';
  const connection = await Connection.connect({ address });
  const temporal = new TemporalClient({ connection, namespace: 'default' });
  let launched = 0;
  let alreadyRunningOrComplete = 0;
  try {
    for (const asset of inventory.assets.filter(item => item.mode === 'reprocess')) {
      const document = await target.query<{ status: string; notes: string | null; file_path: string }>(
        'SELECT status::text, notes, file_path FROM documents WHERE id = $1 AND user_id = $2',
        [asset.id, userId],
      );
      if (document.rowCount !== 1) throw new Error('A staged reprocessing document is missing');
      if (document.rows[0]!.status === 'READY') {
        alreadyRunningOrComplete++;
        continue;
      }
      try {
        await temporal.workflow.start('DocumentProcessingWorkflow', {
          args: [asset.id, [document.rows[0]!.file_path], undefined, document.rows[0]!.notes || undefined],
          taskQueue: 'document-processing',
          workflowId: `doc-processing-${asset.id}`,
          workflowIdReusePolicy: 'ALLOW_DUPLICATE',
        });
        launched++;
      } catch (error) {
        const name = error instanceof Error ? error.name : '';
        if (name.includes('WorkflowExecutionAlreadyStarted')) {
          alreadyRunningOrComplete++;
        } else {
          throw new Error(`Workflow launch failed after ${launched} launches; rerun is safe`);
        }
      }
    }
  } finally {
    await connection.close();
  }
  console.log(JSON.stringify({ workflows_launched: launched, workflows_already_active_or_complete: alreadyRunningOrComplete }));
}

async function fileHash(filePath: string): Promise<string> {
  const hash = createHash('sha256');
  const handle = await fs.open(filePath, 'r');
  try {
    const buffer = Buffer.allocUnsafe(1024 * 1024);
    while (true) {
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, null);
      if (!bytesRead) break;
      hash.update(buffer.subarray(0, bytesRead));
    }
  } finally {
    await handle.close();
  }
  return hash.digest('hex');
}

async function verify(inventory: Inventory, target: pg.Pool, userId: string): Promise<void> {
  const stats = {
    missing_documents: 0,
    ownership_mismatches: 0,
    source_key_mismatches: 0,
    note_mismatches: 0,
    timestamp_mismatches: 0,
    tag_mismatches: 0,
    direct_text_mismatches: 0,
    file_size_mismatches: 0,
    file_hash_mismatches: 0,
    page_count_mismatches: 0,
    page_count_mismatch_details: {} as Record<string, number>,
    ready: 0,
    processing: 0,
    error: 0,
    other_status: 0,
  };

  for (const asset of inventory.assets) {
    const document = await target.query<{
      user_id: string;
      notes: string | null;
      source_key: string | null;
      status: string;
      upload_date: Date;
      file_path: string;
      file_size: number;
    }>(
      'SELECT user_id, notes, source_key, status::text, upload_date, file_path, file_size FROM documents WHERE id = $1',
      [asset.id],
    );
    if (document.rowCount !== 1) {
      stats.missing_documents++;
      continue;
    }
    const doc = document.rows[0]!;
    if (doc.user_id !== userId) stats.ownership_mismatches++;
    if (doc.source_key !== `${SOURCE_PREFIX}${asset.id}`) stats.source_key_mismatches++;
    if ((doc.notes ?? null) !== (asset.row?.notes ?? null)) stats.note_mismatches++;
    if (new Date(doc.upload_date).getTime() !== asset.timestamp.getTime()) stats.timestamp_mismatches++;
    if (Number(doc.file_size) !== asset.size) stats.file_size_mismatches++;
    if (await fileHash(doc.file_path) !== await fileHash(asset.sourcePath)) stats.file_hash_mismatches++;

    const actualTags = await target.query<{ name: string }>(
      `SELECT t.name FROM tags t JOIN document_tags dt ON dt.tag_id = t.id
       WHERE dt.document_id = $1 ORDER BY t.name`,
      [asset.id],
    );
    const expectedTags = normalizedTags(asset.row?.tags || null).sort();
    if (JSON.stringify(actualTags.rows.map(row => row.name).sort()) !== JSON.stringify(expectedTags)) stats.tag_mismatches++;

    const pageVectors = await target.query<{ page_number: number; text_content: string }>(
      'SELECT page_number, text_content FROM vectors WHERE document_id = $1 AND page_number >= 0 ORDER BY page_number',
      [asset.id],
    );
    if (asset.mode === 'reuse') {
      if (pageVectors.rowCount !== 1 || pageVectors.rows[0]!.text_content !== asset.row!.text) {
        stats.direct_text_mismatches++;
      }
    }
    if (doc.status === 'READY' && pageVectors.rowCount !== asset.pageCount) {
      stats.page_count_mismatches++;
      const detail = `${asset.extension}:${asset.mode}:${asset.pageCount}->${pageVectors.rowCount}`;
      stats.page_count_mismatch_details[detail] = (stats.page_count_mismatch_details[detail] || 0) + 1;
    }

    if (doc.status === 'READY') stats.ready++;
    else if (doc.status === 'PROCESSING' || doc.status === 'UPLOADED' || doc.status === 'OCR_COMPLETE') stats.processing++;
    else if (doc.status === 'ERROR') stats.error++;
    else stats.other_status++;
  }
  console.log(JSON.stringify(stats));
}

async function main(): Promise<void> {
  const phase = (process.argv[2] || 'dry-run') as Phase;
  if (!['dry-run', 'stage', 'previews', 'embed', 'finalize', 'launch', 'verify'].includes(phase)) {
    throw new Error('Usage: import-document-uploader.ts [dry-run|stage|previews|embed|finalize|launch|verify]');
  }

  const source = new Client(sourceConfig());
  const target = new Pool({ connectionString: required('DATABASE_URL') });
  try {
    await source.connect();
    await source.query('SET default_transaction_read_only = on');
    const inventory = await loadInventory(source);
    printInventory(inventory);
    const userId = await resolveUserId(target);

    if (phase === 'stage') await stage(inventory, target, userId);
    else if (phase === 'previews') await renderMissingPreviews(inventory);
    else if (phase === 'embed') await embed(target, userId);
    else if (phase === 'finalize') await finalize(inventory, target, userId);
    else if (phase === 'launch') await launch(inventory, target, userId);
    else if (phase === 'verify') await verify(inventory, target, userId);
    else console.log(JSON.stringify({ dry_run_complete: true, target_user_matches: 1 }));
  } finally {
    await source.end().catch(() => undefined);
    await target.end().catch(() => undefined);
  }
}

main().catch(error => {
  const rawMessage = error instanceof Error ? error.message.split('\n')[0] || 'unknown error' : 'unknown error';
  const safeMessage = rawMessage
    .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/gi, '[document]')
    .slice(0, 300);
  const code = typeof (error as { code?: unknown })?.code === 'string'
    ? (error as { code: string }).code
    : undefined;
  console.error(JSON.stringify({
    import_failed: true,
    error_name: error instanceof Error ? error.name : 'UnknownError',
    ...(code ? { error_code: code } : {}),
    safe_message: safeMessage,
  }));
  process.exitCode = 1;
});
