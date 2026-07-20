import { closeDatabase, pool } from '../server/db.js';
import { generateDenseVector } from '../server/utils/embeddings.js';

const BATCH_SIZE = 25;

interface VectorRow {
  id: string;
  text_content: string;
}

async function reindexEmbeddings(): Promise<void> {
  let updated = 0;

  while (true) {
    const batch = await pool.query<VectorRow>(
      `SELECT id, text_content
       FROM vectors
       WHERE dense_vector IS NULL AND btrim(text_content) <> ''
       ORDER BY id
       LIMIT $1`,
      [BATCH_SIZE],
    );

    if (batch.rows.length === 0) break;

    for (const row of batch.rows) {
      const embedding = await generateDenseVector(row.text_content, 'search_document');
      const result = await pool.query(
        `UPDATE vectors
         SET dense_vector = $2::vector
         WHERE id = $1 AND dense_vector IS NULL`,
        [row.id, `[${embedding.join(',')}]`],
      );
      updated += result.rowCount ?? 0;
    }

    console.log(`Reindexed ${updated} vectors`);
  }

  console.log(`Embedding reindex complete (${updated} vectors updated)`);
}

reindexEmbeddings()
  .catch((error) => {
    console.error('Embedding reindex failed:', error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await closeDatabase();
  });
