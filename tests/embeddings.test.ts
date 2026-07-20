import { afterEach, describe, expect, it, vi } from 'vitest';
import { generateDenseVector } from '../server/utils/embeddings';

describe('generateDenseVector', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.OPENAI_API_KEY;
    delete process.env.OPENAI_API_ENDPOINT;
    delete process.env.OPENAI_EMBEDDING_MODEL;
  });

  it('calls the embeddings endpoint and validates dimensions', async () => {
    process.env.OPENAI_API_KEY = 'test-key';
    process.env.OPENAI_API_ENDPOINT = 'https://openrouter.ai/api/v1';
    const embedding = new Array(1024).fill(0.25);
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ data: [{ embedding }] }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(generateDenseVector('hello')).resolves.toEqual(embedding);
    expect(fetchMock).toHaveBeenCalledWith(
      'https://openrouter.ai/api/v1/embeddings',
      expect.objectContaining({ method: 'POST' }),
    );
    const request = fetchMock.mock.calls[0]?.[1] as RequestInit;
    expect(JSON.parse(String(request.body))).toEqual({
      model: 'baai/bge-m3',
      input: 'hello',
      input_type: 'search_document',
      provider: { zdr: true, data_collection: 'deny' },
    });
  });
});
