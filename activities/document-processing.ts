import { execFile } from 'child_process';
import { promisify } from 'util';
import * as fs from 'fs/promises';
import * as path from 'path';
import { generateDenseVector } from '../server/utils/embeddings.js';
import { generateSparseVector } from '../server/utils/sparse-vectors.js';
import { pool, prisma } from '../server/db.js';

const execFileAsync = promisify(execFile);

/**
 * Convert PDF to images or copy image file to pages directory
 * @param documentId - UUID of the document
 * @param filePath - Path to the original file
 * @param pageOffset - Starting page number for sequential numbering (default 0)
 * @returns Array of image file paths
 */
export async function convertPdfToImages(
  documentId: string,
  filePath: string,
  pageOffset: number = 0
): Promise<string[]> {
  try {
    // Update processing status
    await prisma.processingStatus.create({
      data: {
        document_id: documentId,
        stage: 'PDF_CONVERSION',
      },
    });

    await prisma.documents.update({
      where: { id: documentId },
      data: { status: 'PROCESSING' },
    });

    // Create pages directory
    const pagesDir = path.join(path.dirname(filePath), 'pages');
    await fs.mkdir(pagesDir, { recursive: true });

    const fileExt = path.extname(filePath).toLowerCase();
    const imagePaths: string[] = [];

    if (fileExt === '.pdf') {
      // Poppler handles large and unusually proportioned pages more predictably
      // than ImageMagick. Normal pages stay at 300 DPI for OCR quality, while
      // long-edge and pixel-area caps prevent cache or memory exhaustion.
      const { stdout: documentInfo } = await execFileAsync('pdfinfo', [filePath]);
      const pageCount = Number.parseInt(documentInfo.match(/^Pages:\s+(\d+)$/m)?.[1] || '', 10);
      if (!Number.isInteger(pageCount) || pageCount < 1) {
        throw new Error('PDF has no readable pages');
      }

      // Process each page individually to avoid memory exhaustion
      for (let pageNum = 0; pageNum < pageCount; pageNum++) {
        const outputPath = path.join(pagesDir, `page-${pageOffset + pageNum}.png`);

        const selectedPage = String(pageNum + 1);
        const { stdout: pageInfo } = await execFileAsync(
          'pdfinfo',
          ['-f', selectedPage, '-l', selectedPage, filePath],
        );
        const sizeMatch = pageInfo.match(/^Page(?:\s+\d+)?\s+size:\s+([0-9.]+)\s+x\s+([0-9.]+)\s+pts/m);
        if (!sizeMatch) throw new Error('Could not determine PDF page dimensions');
        const widthPoints = Number(sizeMatch[1]);
        const heightPoints = Number(sizeMatch[2]);
        const longestEdgeDpi = (12_000 * 72) / Math.max(widthPoints, heightPoints);
        const pixelAreaDpi = Math.sqrt((20_000_000 * 72 * 72) / (widthPoints * heightPoints));
        const density = Math.max(10, Math.floor(Math.min(300, longestEdgeDpi, pixelAreaDpi)));
        const outputPrefix = outputPath.replace(/\.png$/i, '');

        await execFileAsync('pdftoppm', [
          '-f', selectedPage,
          '-l', selectedPage,
          '-singlefile',
          '-r', String(density),
          '-png',
          filePath,
          outputPrefix,
        ]);

        imagePaths.push(outputPath);
      }
    } else if (fileExt === '.png' || fileExt === '.jpg' || fileExt === '.jpeg') {
      // For image files, copy to pages directory without preprocessing
      // LLM-based OCR works better with original images
      const targetExtension = fileExt === '.png' ? 'png' : 'jpg';
      const targetPath = path.join(pagesDir, `page-${pageOffset}.${targetExtension}`);
      await fs.copyFile(filePath, targetPath);
      imagePaths.push(targetPath);
    } else {
      throw new Error(`Unsupported file type: ${fileExt}`);
    }

    // Update completion timestamp
    const statusRecord = await prisma.processingStatus.findFirst({
      where: {
        document_id: documentId,
        stage: 'PDF_CONVERSION',
      },
      orderBy: { started_at: 'desc' },
    });

    if (statusRecord) {
      await prisma.processingStatus.update({
        where: { id: statusRecord.id },
        data: { completed_at: new Date() },
      });
    }

    return imagePaths;
  } catch (error) {
    // Log error to processing status
    const statusRecord = await prisma.processingStatus.findFirst({
      where: {
        document_id: documentId,
        stage: 'PDF_CONVERSION',
      },
      orderBy: { started_at: 'desc' },
    });

    if (statusRecord) {
      await prisma.processingStatus.update({
        where: { id: statusRecord.id },
        data: {
          error_message: error instanceof Error ? error.message : 'Unknown error',
          retry_count: { increment: 1 },
        },
      });
    }

    // Update document status to ERROR
    await prisma.documents.update({
      where: { id: documentId },
      data: { status: 'ERROR' },
    });

    throw error;
  }
}

/**
 * Start OCR processing - creates status record and verifies document exists
 * @param documentId - UUID of the document
 */
export async function startOcrProcessing(documentId: string): Promise<void> {
  // Verify document exists before proceeding
  const document = await prisma.documents.findUnique({
    where: { id: documentId },
    select: { id: true }
  });

  if (!document) {
    throw new Error(`Document ${documentId} not found in database. It may not have been created yet.`);
  }

  // Update processing status
  await prisma.processingStatus.create({
    data: {
      document_id: documentId,
      stage: 'OCR_EXTRACTION',
    },
  });
}

/**
 * Complete OCR processing - updates status and marks document as OCR_COMPLETE
 * @param documentId - UUID of the document
 */
export async function completeOcrProcessing(documentId: string): Promise<void> {
  // Update document status
  await prisma.documents.update({
    where: { id: documentId },
    data: { status: 'OCR_COMPLETE' },
  });

  // Update completion timestamp
  const statusRecord = await prisma.processingStatus.findFirst({
    where: {
      document_id: documentId,
      stage: 'OCR_EXTRACTION',
    },
    orderBy: { started_at: 'desc' },
  });

  if (statusRecord) {
    await prisma.processingStatus.update({
      where: { id: statusRecord.id },
      data: { completed_at: new Date() },
    });
  }
}

/**
 * Record a terminal OCR failure so the UI does not show processing forever.
 */
export async function failOcrProcessing(documentId: string, errorMessage: string): Promise<void> {
  const statusRecord = await prisma.processingStatus.findFirst({
    where: {
      document_id: documentId,
      stage: 'OCR_EXTRACTION',
    },
    orderBy: { started_at: 'desc' },
  });

  await prisma.$transaction([
    prisma.documents.update({
      where: { id: documentId },
      data: { status: 'ERROR' },
    }),
    ...(statusRecord
      ? [prisma.processingStatus.update({
          where: { id: statusRecord.id },
          data: {
            error_message: errorMessage.slice(0, 2000),
            retry_count: { increment: 1 },
          },
        })]
      : []),
  ]);
}

/**
 * Extract text from a single page image using OpenAI Vision API
 * This is an activity that can be fanned out in parallel from the workflow
 * @param imagePath - Path to the image file
 * @param pageNumber - Page number for the result
 * @returns Object with page number and extracted text
 */
export async function extractTextFromPage(
  imagePath: string,
  pageNumber: number
): Promise<{ pageNumber: number; text: string }> {
  const text = await extractTextWithLLM(imagePath);
  return { pageNumber, text };
}

/**
 * Extract text from an image using OpenAI Vision API
 * @param imagePath - Path to the image file
 * @returns Extracted text content
 */
async function extractTextWithLLM(imagePath: string): Promise<string> {
  // Read environment variables at runtime (not at module load time)
  const OPENAI_API_KEY = process.env.OPENAI_API_KEY || '';
  const OPENAI_API_ENDPOINT = (process.env.OPENAI_API_ENDPOINT || 'https://api.openai.com/v1').replace(/\/$/, '');
  const OPENAI_MODEL = process.env.OPENAI_MODEL || 'gpt-4o-mini';

  if (!OPENAI_API_KEY) {
    throw new Error('OPENAI_API_KEY environment variable is not set');
  }

  // Read image file and convert to base64
  const imageBuffer = await fs.readFile(imagePath);
  const base64Image = imageBuffer.toString('base64');
  // Verify the image signature rather than trusting only the file extension.
  const isPng = imageBuffer.subarray(0, 8).equals(
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
  );
  const isJpeg = imageBuffer[0] === 0xff && imageBuffer[1] === 0xd8 && imageBuffer[2] === 0xff;

  if (!isPng && !isJpeg) {
    throw new Error(`Unsupported image data in ${imagePath}`);
  }

  const mimeType = isPng ? 'image/png' : 'image/jpeg';

  console.log(`Processing image: ${imagePath} (${mimeType})`);

  const requestBody: Record<string, unknown> = {
    model: OPENAI_MODEL,
    messages: [
      {
        role: 'user',
        content: [
          {
            type: 'text',
            text:
`Extract all visible text from this image.
Return the text content, preserving the layout and structure as much as possible.
Include all text you can see, regardless of color, size, or position.
Also output a short description 100 characters or less of the image content at the end.`,
          },
          {
            type: 'image_url',
            image_url: {
              url: `data:${mimeType};base64,${base64Image}`,
            },
          },
        ],
      },
    ],
    max_tokens: 4096,
  };

  // OpenRouter will reject the request rather than route image data to a
  // provider that does not support Zero Data Retention.
  if (new URL(OPENAI_API_ENDPOINT).hostname === 'openrouter.ai') {
    requestBody.provider = {
      zdr: true,
      data_collection: 'deny',
    };
  }

  // Call the configured OpenAI-compatible Chat Completions API with vision.
  const response = await fetch(`${OPENAI_API_ENDPOINT}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${OPENAI_API_KEY}`,
    },
    body: JSON.stringify(requestBody),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`OpenAI API error: ${response.status} - ${errorText}`);
  }

  const data = await response.json();
  const extractedText = data.choices?.[0]?.message?.content || '';
  console.log(`Extracted ${extractedText.length} characters of text`);
  return extractedText.trim();
}

/**
 * Generate dense and sparse vectors for text pages
 * @param textPages - Array of objects with page number and text
 * @param documentId - UUID of the document
 */
export async function generateVectors(
  textPages: { pageNumber: number; text: string }[],
  documentId: string
): Promise<void> {
  try {
    // Update processing status
    await prisma.processingStatus.create({
      data: {
        document_id: documentId,
        stage: 'VECTORIZATION',
      },
    });

    const generatedPages: Array<{
      pageNumber: number;
      denseVector: string | null;
      sparseVector: string | null;
      text: string;
    }> = [];

    for (const page of textPages) {
      // Preserve empty page rows for viewer page counts, but do not make them
      // search candidates or send empty content to the embedding provider.
      if (!page.text.trim()) {
        generatedPages.push({
          pageNumber: page.pageNumber,
          denseVector: null,
          sparseVector: null,
          text: '',
        });
        continue;
      }

      // Generate dense vector (semantic embedding)
      const denseVector = await generateDenseVector(page.text);

      // Generate sparse vector (TF-IDF keyword weights)
      const sparseVector = generateSparseVector(page.text);

      // Format dense vector as pgvector string: [val1,val2,val3,...]
      generatedPages.push({
        pageNumber: page.pageNumber,
        denseVector: `[${denseVector.join(',')}]`,
        sparseVector: JSON.stringify(sparseVector),
        text: page.text,
      });
    }

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('DELETE FROM vectors WHERE document_id = $1', [documentId]);
      for (const page of generatedPages) {
        await client.query(
          `INSERT INTO vectors (id, document_id, page_number, dense_vector, sparse_vector, text_content)
           VALUES (gen_random_uuid()::text, $1, $2, $3::vector, $4::jsonb, $5)
           ON CONFLICT (document_id, page_number) DO UPDATE SET
             dense_vector = EXCLUDED.dense_vector,
             sparse_vector = EXCLUDED.sparse_vector,
             text_content = EXCLUDED.text_content`,
          [documentId, page.pageNumber, page.denseVector, page.sparseVector, page.text]
        );
      }
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }

    // Update completion timestamp
    const statusRecord = await prisma.processingStatus.findFirst({
      where: {
        document_id: documentId,
        stage: 'VECTORIZATION',
      },
      orderBy: { started_at: 'desc' },
    });

    if (statusRecord) {
      await prisma.processingStatus.update({
        where: { id: statusRecord.id },
        data: { completed_at: new Date() },
      });
    }
  } catch (error) {
    // Log error to processing status
    const statusRecord = await prisma.processingStatus.findFirst({
      where: {
        document_id: documentId,
        stage: 'VECTORIZATION',
      },
      orderBy: { started_at: 'desc' },
    });

    if (statusRecord) {
      await prisma.processingStatus.update({
        where: { id: statusRecord.id },
        data: {
          error_message: error instanceof Error ? error.message : 'Unknown error',
          retry_count: { increment: 1 },
        },
      });
    }

    // Update document status to ERROR
    await prisma.documents.update({
      where: { id: documentId },
      data: { status: 'ERROR' },
    });

    throw error;
  }
}

/**
 * Finalize document indexing
 * @param documentId - UUID of the document
 */
export async function indexDocument(documentId: string): Promise<void> {
  try {
    // Create final processing status
    await prisma.processingStatus.create({
      data: {
        document_id: documentId,
        stage: 'INDEXING_COMPLETE',
        completed_at: new Date(),
      },
    });

    // Update document status to READY
    await prisma.documents.update({
      where: { id: documentId },
      data: { status: 'READY' },
    });
  } catch (error) {
    // Log error
    await prisma.processingStatus.create({
      data: {
        document_id: documentId,
        stage: 'INDEXING_COMPLETE',
        error_message: error instanceof Error ? error.message : 'Unknown error',
      },
    });

    // Update document status to ERROR
    await prisma.documents.update({
      where: { id: documentId },
      data: { status: 'ERROR' },
    });

    throw error;
  }
}

export { pool };
