import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';
import { exec } from 'child_process';
import { promisify } from 'util';
import * as fs from 'fs/promises';
import * as path from 'path';
import { generateDenseVector } from '../server/utils/embeddings.js';
import { generateSparseVector } from '../server/utils/sparse-vectors.js';

const execAsync = promisify(exec);

// Create PostgreSQL connection pool with explicit parameters
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
      // Convert PDF to PNG images using ImageMagick with OCR-optimized settings
      // Process page-by-page to avoid memory exhaustion on large PDFs

      // ImageMagick command with optimal OCR settings:
      // -density 300: High resolution (300 DPI) for better OCR accuracy
      // -depth 8: 8-bit color depth (standard for images)
      // -quality 100: Maximum quality output
      // -alpha remove: Remove transparency (white background)
      // -background white: Set white background when removing alpha
      // -sharpen 0x1: Slight sharpening to enhance text edges
      // -contrast-stretch 0: Normalize contrast across the image
      const magickArgs = [
        '-density 300',
        '-depth 8',
        '-quality 100',
        '-alpha remove',
        '-background white',
        '-sharpen 0x1',
        '-contrast-stretch 0',
      ].join(' ');

      // First, get the number of pages in the PDF
      const { stdout } = await execAsync(`identify -format "%n\n" "${filePath}"`);
      const pageCount = parseInt(stdout.trim().split('\n')[0] || '1');

      // Process each page individually to avoid memory exhaustion
      for (let pageNum = 0; pageNum < pageCount; pageNum++) {
        const outputPath = path.join(pagesDir, `page-${pageOffset + pageNum}.png`);

        // Convert specific page: [pageNum] selects the page (0-indexed)
        await execAsync(`convert ${magickArgs} "${filePath}[${pageNum}]" "${outputPath}"`);

        imagePaths.push(outputPath);
      }
    } else if (fileExt === '.png' || fileExt === '.jpg' || fileExt === '.jpeg') {
      // For image files, copy to pages directory without preprocessing
      // LLM-based OCR works better with original images
      const targetPath = path.join(pagesDir, `page-${pageOffset}.png`);
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
  const OPENAI_API_ENDPOINT = process.env.OPENAI_API_ENDPOINT || 'https://api.openai.com/v1';
  const OPENAI_MODEL = process.env.OPENAI_MODEL || 'gpt-4o-mini';

  if (!OPENAI_API_KEY) {
    throw new Error('OPENAI_API_KEY environment variable is not set');
  }

  // Read image file and convert to base64
  const imageBuffer = await fs.readFile(imagePath);
  const base64Image = imageBuffer.toString('base64');
  const imageExt = path.extname(imagePath).toLowerCase().substring(1);
  const mimeType = imageExt === 'png' ? 'image/png' : 'image/jpeg';

  console.log(`Processing image: ${imagePath} (${mimeType})`);

  // Call OpenAI Chat Completions API with vision
  const response = await fetch(`${OPENAI_API_ENDPOINT}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${OPENAI_API_KEY}`,
    },
    body: JSON.stringify({
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
    }),
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

    for (const page of textPages) {
      // Skip empty pages
      if (!page.text.trim()) {
        console.log(`Skipping empty page ${page.pageNumber} for document ${documentId}`);
        continue;
      }

      // Generate dense vector (semantic embedding)
      const denseVector = await generateDenseVector(page.text);

      // Generate sparse vector (TF-IDF keyword weights)
      const sparseVector = generateSparseVector(page.text);

      // Format dense vector as pgvector string: [val1,val2,val3,...]
      const denseVectorStr = `[${denseVector.join(',')}]`;

      // Store vectors in database using raw SQL for pgvector support
      await pool.query(
        `INSERT INTO vectors (id, document_id, page_number, dense_vector, sparse_vector, text_content)
         VALUES (gen_random_uuid(), $1::uuid, $2, $3::vector, $4::jsonb, $5)`,
        [documentId, page.pageNumber, denseVectorStr, JSON.stringify(sparseVector), page.text]
      );
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
