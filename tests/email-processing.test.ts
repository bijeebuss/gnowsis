import { afterEach, describe, expect, it, vi } from 'vitest';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import {
  convertHtmlToPdf,
  detectEmailAttachmentType,
  isInlineEmailAttachment,
  replaceInlineImageReference,
} from '../activities/email-processing';

describe('email attachment processing', () => {
  let tempDirectory: string | undefined;

  afterEach(async () => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    delete process.env.GOTENBURG_URL;
    if (tempDirectory) await fs.rm(tempDirectory, { recursive: true, force: true });
    tempDirectory = undefined;
  });

  it('treats MIME-inline and CID-referenced parts as body assets', () => {
    const content = Buffer.from('image');

    expect(isInlineEmailAttachment(
      { content, contentDisposition: 'inline' },
      '<p>Body</p>',
    )).toBe(true);

    expect(isInlineEmailAttachment(
      { content, contentDisposition: 'attachment', cid: 'logo@example' },
      '<img src="cid:logo@example">',
    )).toBe(true);

    expect(isInlineEmailAttachment(
      { content, contentDisposition: 'attachment', filename: 'scan.jpg' },
      '<p>Body</p>',
    )).toBe(false);
  });

  it('rewrites normal and URL-encoded CID image references for rendering', () => {
    const html = '<img src="cid:image one@example"><img src="CID:image%20one%40example">';

    expect(replaceInlineImageReference(html, '<image one@example>', 'inline-1.png'))
      .toBe('<img src="inline-1.png"><img src="inline-1.png">');
  });

  it('accepts supported attachments by byte signature and rejects other content', () => {
    expect(detectEmailAttachmentType(Buffer.from('%PDF-1.7\n'))).toEqual({
      extension: 'pdf',
      mimeType: 'application/pdf',
    });
    expect(detectEmailAttachmentType(Buffer.from([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
    ]))).toEqual({ extension: 'png', mimeType: 'image/png' });
    expect(detectEmailAttachmentType(Buffer.from([0xff, 0xd8, 0xff, 0xe0])))
      .toEqual({ extension: 'jpg', mimeType: 'image/jpeg' });
    expect(detectEmailAttachmentType(Buffer.from('plain text'))).toBeNull();
  });

  it('sends inline image assets with the HTML conversion request', async () => {
    tempDirectory = await fs.mkdtemp(path.join(os.tmpdir(), 'gnowsis-email-test-'));
    const inlineImagePath = path.join(tempDirectory, 'inline-1.png');
    const inlineImage = Buffer.from([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
    ]);
    await fs.writeFile(inlineImagePath, inlineImage);
    vi.spyOn(process, 'cwd').mockReturnValue(tempDirectory);
    process.env.GOTENBURG_URL = 'http://gotenberg:3000';

    const fetchMock = vi.fn().mockResolvedValue(new Response(Buffer.from('%PDF-1.7'), {
      status: 200,
      headers: { 'Content-Type': 'application/pdf' },
    }));
    vi.stubGlobal('fetch', fetchMock);

    await convertHtmlToPdf(
      'document-id',
      '<img src="inline-1.png">',
      [{
        filePath: inlineImagePath,
        filename: 'inline-1.png',
        fileType: 'image/png',
      }],
    );

    const request = fetchMock.mock.calls[0]?.[1] as RequestInit;
    const requestBody = request.body as Buffer;
    expect(requestBody.includes(Buffer.from('filename="index.html"'))).toBe(true);
    expect(requestBody.includes(Buffer.from('filename="inline-1.png"'))).toBe(true);
    expect(requestBody.includes(inlineImage)).toBe(true);
  });
});
