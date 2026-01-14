/**
 * Dense vector generation for semantic search
 *
 * This implementation uses a simple but effective approach:
 * - Tokenize text into words
 * - Create a fixed-size vector representation
 * - Use word frequency and position weighting
 *
 * For production, consider using:
 * - OpenAI embeddings API
 * - Sentence transformers (via Python bridge)
 * - Hugging Face transformers
 */

/**
 * Generate a dense vector representation of text
 * Returns a 1536-dimension vector to match common embedding models
 *
 * @param text - Input text to vectorize
 * @returns Array of 1536 floating point numbers
 */
export async function generateDenseVector(text: string): Promise<number[]> {
  // Normalize text
  const normalizedText = text.toLowerCase().trim();

  // Handle empty text
  if (!normalizedText) {
    return new Array(1536).fill(0);
  }

  // Tokenize into words
  const words = normalizedText.match(/\b\w+\b/g) || [];

  // Create a fixed-size vector (1536 dimensions to match OpenAI embeddings)
  const vectorSize = 1536;
  const vector = new Array(vectorSize).fill(0);

  // If no words, return zero vector
  if (words.length === 0) {
    return vector;
  }

  // Generate hash-based embeddings with positional weighting
  // This provides a deterministic, fixed-size representation
  for (let i = 0; i < words.length; i++) {
    const word = words[i];

    // Skip undefined or very short words
    if (!word || word.length < 2) continue;

    // Calculate position weight (earlier words weighted slightly higher)
    const positionWeight = 1.0 - (i / (words.length * 2));

    // Generate multiple hash positions for each word for better distribution
    for (let j = 0; j < 3; j++) {
      const hashSeed = simpleHash(word, j);
      const position = Math.abs(hashSeed) % vectorSize;

      // Increment vector at hash position with position weight
      vector[position] += positionWeight;
    }
  }

  // Normalize the vector to unit length (L2 normalization)
  const magnitude = Math.sqrt(vector.reduce((sum, val) => sum + val * val, 0));

  if (magnitude > 0) {
    for (let i = 0; i < vector.length; i++) {
      vector[i] = vector[i] / magnitude;
    }
  }

  return vector;
}

/**
 * Simple hash function for distributing words across vector dimensions
 * Uses a seed for multiple hash positions per word
 *
 * @param str - String to hash
 * @param seed - Seed value for variation
 * @returns Hash value
 */
function simpleHash(str: string, seed: number = 0): number {
  let hash = seed;

  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash; // Convert to 32-bit integer
  }

  return hash;
}

/**
 * Calculate cosine similarity between two vectors
 * Used for testing and validation
 *
 * @param vec1 - First vector
 * @param vec2 - Second vector
 * @returns Similarity score between -1 and 1
 */
export function cosineSimilarity(vec1: number[], vec2: number[]): number {
  if (vec1.length !== vec2.length) {
    throw new Error('Vectors must have the same length');
  }

  let dotProduct = 0;
  let mag1 = 0;
  let mag2 = 0;

  for (let i = 0; i < vec1.length; i++) {
    const v1 = vec1[i] ?? 0;
    const v2 = vec2[i] ?? 0;
    dotProduct += v1 * v2;
    mag1 += v1 * v1;
    mag2 += v2 * v2;
  }

  mag1 = Math.sqrt(mag1);
  mag2 = Math.sqrt(mag2);

  if (mag1 === 0 || mag2 === 0) {
    return 0;
  }

  return dotProduct / (mag1 * mag2);
}
