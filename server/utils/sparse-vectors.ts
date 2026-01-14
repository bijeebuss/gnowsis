/**
 * Sparse vector generation using TF-IDF (Term Frequency-Inverse Document Frequency)
 *
 * This provides keyword-based matching for hybrid search.
 * Sparse vectors capture exact term matches and keyword relevance.
 */

/**
 * Common stop words to filter out (noise reduction)
 */
const STOP_WORDS = new Set([
  'a', 'an', 'and', 'are', 'as', 'at', 'be', 'by', 'for', 'from',
  'has', 'he', 'in', 'is', 'it', 'its', 'of', 'on', 'that', 'the',
  'to', 'was', 'will', 'with', 'the', 'this', 'but', 'they', 'have',
  'had', 'what', 'when', 'where', 'who', 'which', 'why', 'how',
]);

/**
 * Generate a sparse vector representation of text using TF-IDF
 *
 * Returns a JSON object mapping tokens to their weights.
 * Higher weights indicate more important/distinctive terms.
 *
 * @param text - Input text to vectorize
 * @returns Object mapping tokens to numeric weights
 */
export function generateSparseVector(text: string): { [token: string]: number } {
  // Normalize text
  const normalizedText = text.toLowerCase().trim();

  // Handle empty text
  if (!normalizedText) {
    return {};
  }

  // Tokenize into words
  const words = normalizedText.match(/\b\w+\b/g) || [];

  // Filter stop words and short words
  const filteredWords = words.filter(
    word => word.length > 2 && !STOP_WORDS.has(word)
  );

  // Count term frequencies
  const termFrequency: { [token: string]: number } = {};
  const totalTerms = filteredWords.length;

  for (const word of filteredWords) {
    termFrequency[word] = (termFrequency[word] || 0) + 1;
  }

  // Calculate TF scores (Term Frequency)
  // Using logarithmic scaling to prevent overly dominant frequent terms
  const tfScores: { [token: string]: number } = {};

  for (const [term, count] of Object.entries(termFrequency)) {
    // TF = log(1 + count) to dampen the effect of very frequent terms
    tfScores[term] = Math.log(1 + count);
  }

  // For a single document, we approximate IDF using term rarity within the document
  // In production, you'd calculate IDF across your entire document corpus
  const sparseVector: { [token: string]: number } = {};

  for (const [term, tfScore] of Object.entries(tfScores)) {
    const termCount = termFrequency[term];
    if (!termCount) continue; // Skip if term count is undefined
    const termRarity = totalTerms / termCount; // Higher for rarer terms

    // Simplified IDF approximation: log(term rarity)
    const idfApprox = Math.log(1 + termRarity);

    // TF-IDF = TF * IDF
    sparseVector[term] = tfScore * idfApprox;
  }

  // Normalize weights to [0, 1] range
  const maxWeight = Math.max(...Object.values(sparseVector), 1);
  for (const term in sparseVector) {
    const weight = sparseVector[term];
    if (weight !== undefined) {
      sparseVector[term] = weight / maxWeight;
    }
  }

  return sparseVector;
}

/**
 * Calculate BM25 score between query and document sparse vectors
 * BM25 is an improved version of TF-IDF with better term saturation
 *
 * @param querySparseVector - Sparse vector of query text
 * @param docSparseVector - Sparse vector of document text
 * @param k1 - Term frequency saturation parameter (default 1.5)
 * @param b - Length normalization parameter (default 0.75)
 * @returns BM25 similarity score
 */
export function calculateBM25Score(
  querySparseVector: { [token: string]: number },
  docSparseVector: { [token: string]: number },
  k1: number = 1.5,
  b: number = 0.75
): number {
  let score = 0;

  // Calculate document length (sum of all term frequencies)
  const docLength = Object.values(docSparseVector).reduce((sum, weight) => sum + weight, 0);

  // Average document length (we approximate as current doc length for single-doc context)
  const avgDocLength = docLength || 1;

  // For each query term
  for (const [term, queryWeight] of Object.entries(querySparseVector)) {
    const docWeight = docSparseVector[term] || 0;

    if (docWeight > 0) {
      // BM25 formula component
      const numerator = docWeight * (k1 + 1);
      const denominator = docWeight + k1 * (1 - b + b * (docLength / avgDocLength));

      score += queryWeight * (numerator / denominator);
    }
  }

  return score;
}

/**
 * Calculate simple dot product between two sparse vectors
 * Used for basic sparse vector similarity
 *
 * @param vec1 - First sparse vector
 * @param vec2 - Second sparse vector
 * @returns Dot product score
 */
export function sparseDotProduct(
  vec1: { [token: string]: number },
  vec2: { [token: string]: number }
): number {
  let dotProduct = 0;

  // Iterate over smaller vector for efficiency
  const smallerVec = Object.keys(vec1).length <= Object.keys(vec2).length ? vec1 : vec2;
  const largerVec = smallerVec === vec1 ? vec2 : vec1;

  for (const [token, weight] of Object.entries(smallerVec)) {
    const largerWeight = largerVec[token];
    if (largerWeight !== undefined) {
      dotProduct += weight * largerWeight;
    }
  }

  return dotProduct;
}
