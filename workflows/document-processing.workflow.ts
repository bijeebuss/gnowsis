import { proxyActivities, ApplicationFailure } from '@temporalio/workflow';
import type * as activities from '../activities/document-processing';

// Proxy activities with retry policy
const {
  convertPdfToImages,
  startOcrProcessing,
  extractTextFromPage,
  completeOcrProcessing,
  generateVectors,
  indexDocument,
} = proxyActivities<typeof activities>({
  startToCloseTimeout: '10 minutes',
  retry: {
    initialInterval: '1s',
    maximumInterval: '30s',
    backoffCoefficient: 2,
    maximumAttempts: 3,
  },
});

/**
 * Document processing workflow
 * Orchestrates the complete document processing pipeline:
 * 1. Convert multiple PDFs/images to numbered pages
 * 2. Extract text using OCR from all pages
 * 3. Add title and notes as a searchable page (if provided)
 * 4. Generate vectors for search
 * 5. Index document
 *
 * @param documentId - UUID of the document
 * @param filePaths - Array of paths to the uploaded files
 * @param title - Optional title to vectorize as a searchable page
 * @param notes - Optional notes to vectorize as a searchable page
 */
export async function DocumentProcessingWorkflow(
  documentId: string,
  filePaths: string[],
  title?: string,
  notes?: string
): Promise<void> {
  // Stage 1: Convert all files to images with sequential page numbering
  let allImagePaths: string[] = [];
  let pageOffset = 0;

  for (const filePath of filePaths) {
    const imagePaths = await convertPdfToImages(documentId, filePath, pageOffset);

    if (imagePaths && imagePaths.length > 0) {
      allImagePaths = allImagePaths.concat(imagePaths);
      pageOffset += imagePaths.length;
    }
  }

  if (allImagePaths.length === 0) {
    throw ApplicationFailure.create({
      message: 'No images generated from documents',
      type: 'ImageConversionError',
      nonRetryable: true,
    });
  }

  // Stage 2: Extract text from images using OCR (parallel fan-out)
  // Start OCR processing (creates status record, verifies document exists)
  await startOcrProcessing(documentId);

  // Fan out: Process all pages in parallel for faster extraction
  const textPagePromises = allImagePaths.map((imagePath, index) =>
    extractTextFromPage(imagePath, index)
  );
  const textPages = await Promise.all(textPagePromises);

  // Complete OCR processing (updates status)
  await completeOcrProcessing(documentId);

  if (!textPages || textPages.length === 0) {
    throw ApplicationFailure.create({
      message: 'No text extracted from images',
      type: 'OCRExtractionError',
      nonRetryable: false, // Allow retry for OCR failures
    });
  }

  // Stage 3: Add title and notes as a searchable page (page -1) if provided
  const metadataText: string[] = [];
  if (title && title.trim()) {
    metadataText.push(`Title: ${title.trim()}`);
  }
  if (notes && notes.trim()) {
    metadataText.push(`Notes: ${notes.trim()}`);
  }

  if (metadataText.length > 0) {
    textPages.unshift({
      pageNumber: -1,
      text: metadataText.join('\n\n'),
    });
  }

  // Stage 4: Generate vectors for search
  await generateVectors(textPages, documentId);

  // Stage 5: Finalize indexing
  await indexDocument(documentId);
}
