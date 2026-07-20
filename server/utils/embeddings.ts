/** Dense semantic embeddings backed by an OpenAI-compatible embeddings API. */

export const VECTOR_SIZE = 1024;
export const DEFAULT_EMBEDDING_MODEL = 'baai/bge-m3';

export type EmbeddingInputType = 'search_document' | 'search_query';

interface EmbeddingResponse {
  data?: Array<{ embedding?: number[] }>;
}

export async function generateDenseVector(
  text: string,
  inputType: EmbeddingInputType = 'search_document',
): Promise<number[]> {
  const normalizedText = text.trim();
  if (!normalizedText) return new Array(VECTOR_SIZE).fill(0);

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error('OPENAI_API_KEY environment variable is not set');

  const endpoint = (process.env.OPENAI_API_ENDPOINT || 'https://api.openai.com/v1').replace(/\/$/, '');
  const model = process.env.OPENAI_EMBEDDING_MODEL || DEFAULT_EMBEDDING_MODEL;
  const isOpenRouter = new URL(endpoint).hostname === 'openrouter.ai';
  const requestBody: Record<string, unknown> = { model, input: normalizedText };
  if (isOpenRouter) {
    requestBody.input_type = inputType;
    requestBody.provider = {
      zdr: true,
      data_collection: 'deny',
    };
  }

  const response = await fetch(`${endpoint}/embeddings`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(requestBody),
  });

  if (!response.ok) {
    const detail = (await response.text()).slice(0, 1000);
    throw new Error(`Embeddings API error ${response.status}: ${detail}`);
  }

  const payload = await response.json() as EmbeddingResponse;
  const embedding = payload.data?.[0]?.embedding;
  if (!embedding || embedding.length !== VECTOR_SIZE || embedding.some(value => !Number.isFinite(value))) {
    throw new Error(`Embeddings API returned an invalid ${embedding?.length ?? 0}-dimension vector`);
  }
  return embedding;
}

export function cosineSimilarity(vec1: number[], vec2: number[]): number {
  if (vec1.length !== vec2.length) throw new Error('Vectors must have the same length');
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
  return mag1 === 0 || mag2 === 0 ? 0 : dotProduct / Math.sqrt(mag1 * mag2);
}
