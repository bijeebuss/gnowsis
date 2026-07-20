import { afterEach, describe, expect, it, vi } from 'vitest';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { extractTextFromPage } from '../activities/document-processing';

describe('image text extraction', () => {
  let tempDirectory: string | undefined;

  afterEach(async () => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    delete process.env.OPENAI_API_KEY;
    delete process.env.OPENAI_API_ENDPOINT;
    delete process.env.OPENAI_MODEL;
    if (tempDirectory) await fs.rm(tempDirectory, { recursive: true, force: true });
    tempDirectory = undefined;
  });

  it('requires a ZDR provider for OpenRouter vision requests', async () => {
    process.env.OPENAI_API_KEY = 'test-key';
    process.env.OPENAI_API_ENDPOINT = 'https://openrouter.ai/api/v1/';
    process.env.OPENAI_MODEL = 'x-ai/grok-4.5';

    tempDirectory = await fs.mkdtemp(path.join(os.tmpdir(), 'gnowsis-vision-test-'));
    const imagePath = path.join(tempDirectory, 'page.png');
    await fs.writeFile(
      imagePath,
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    );

    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      choices: [{ message: { content: 'Extracted text' } }],
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }));
    vi.stubGlobal('fetch', fetchMock);
    vi.spyOn(console, 'log').mockImplementation(() => undefined);

    await expect(extractTextFromPage(imagePath, 3)).resolves.toEqual({
      pageNumber: 3,
      text: 'Extracted text',
    });

    expect(fetchMock).toHaveBeenCalledWith(
      'https://openrouter.ai/api/v1/chat/completions',
      expect.objectContaining({ method: 'POST' }),
    );
    const request = fetchMock.mock.calls[0]?.[1] as RequestInit;
    const body = JSON.parse(String(request.body));
    expect(body.model).toBe('x-ai/grok-4.5');
    expect(body.provider).toEqual({ zdr: true, data_collection: 'deny' });
    expect(body.messages[0].content[1].image_url.url).toMatch(/^data:image\/png;base64,/);
  });
});
