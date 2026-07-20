import { ImapFlow } from 'imapflow';
import * as fs from 'fs/promises';
import * as path from 'path';
import { prisma } from '../server/db.js';
import { decryptPassword } from '../server/utils/encryption.js';

export interface UserInfo {
  userId: string;
}

export interface EmailToProcess {
  uid: number;
  emailId: string;
  subject: string;
}

export interface EmailBatch {
  emails: EmailToProcess[];
  uidValidity: string;
}

export interface EmailMetadata {
  from: string;
  to: string;
  cc: string;
  date?: string;
  subject?: string;
}

export interface StoredEmailAttachment {
  filePath: string;
  filename: string;
  originalFilename: string;
  fileSize: number;
  fileType: string;
}

export interface StoredEmailInlineImage {
  filePath: string;
  filename: string;
  fileType: string;
}

export interface SkippedEmailAttachment {
  filename: string;
  reason: string;
}

interface ParsedEmailAttachment {
  content: Buffer;
  contentType?: string;
  contentDisposition?: string;
  contentId?: string;
  cid?: string;
  filename?: string;
  related?: boolean;
  size?: number;
}

const MAX_EMAIL_ATTACHMENT_COUNT = 20;
const MAX_EMAIL_ATTACHMENT_FILE_SIZE = 50 * 1024 * 1024;
const MAX_EMAIL_ATTACHMENT_TOTAL_SIZE = 100 * 1024 * 1024;

function attachmentName(attachment: ParsedEmailAttachment, index: number): string {
  const suppliedName = attachment.filename?.trim();
  if (!suppliedName) return `attachment-${index + 1}`;

  // MIME filenames are untrusted and later become ZIP entry names.
  const basename = path.basename(suppliedName.replace(/\\/g, '/'));
  const sanitized = basename.replace(/[\x00-\x1f\x7f]/g, '_').slice(0, 255);
  return sanitized || `attachment-${index + 1}`;
}

function attachmentDownloadName(
  originalFilename: string,
  detectedExtension: 'pdf' | 'png' | 'jpg',
): string {
  const currentExtension = path.extname(originalFilename).slice(1).toLowerCase();
  const matchesDetectedType = currentExtension === detectedExtension
    || (detectedExtension === 'jpg' && currentExtension === 'jpeg');
  return matchesDetectedType ? originalFilename : `${originalFilename}.${detectedExtension}`;
}

/**
 * Inline and multipart/related parts are body assets (most commonly signature
 * logos and icons), not standalone document pages. CID references provide a
 * fallback for messages whose Content-Disposition header is incomplete.
 */
export function isInlineEmailAttachment(
  attachment: ParsedEmailAttachment,
  htmlContent: string,
): boolean {
  if (attachment.contentDisposition?.toLowerCase() === 'inline' || attachment.related) {
    return true;
  }

  const cid = (attachment.cid || attachment.contentId || '')
    .trim()
    .replace(/^<|>$/g, '')
    .toLowerCase();
  if (!cid) return false;

  const normalizedHtml = htmlContent.toLowerCase();
  return normalizedHtml.includes(`cid:${cid}`)
    || normalizedHtml.includes(`cid:${encodeURIComponent(cid).toLowerCase()}`);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Replace a CID URL with a local asset name that Gotenberg receives alongside the HTML. */
export function replaceInlineImageReference(
  htmlContent: string,
  cidValue: string,
  replacement: string,
): string {
  let renderedHtml = htmlContent;
  const cid = cidValue.trim().replace(/^<|>$/g, '');
  for (const cidForm of new Set([cid, encodeURIComponent(cid)])) {
    renderedHtml = renderedHtml.replace(
      new RegExp(`cid:${escapeRegExp(cidForm)}`, 'gi'),
      replacement,
    );
  }
  return renderedHtml;
}

function detectRenderableInlineImageType(
  attachment: ParsedEmailAttachment,
): { extension: string; mimeType: string } | null {
  const documentType = detectEmailAttachmentType(attachment.content);
  if (documentType?.mimeType.startsWith('image/')) return documentType;

  const header = attachment.content.subarray(0, 12);
  if (header.subarray(0, 6).toString('ascii') === 'GIF87a'
    || header.subarray(0, 6).toString('ascii') === 'GIF89a') {
    return { extension: 'gif', mimeType: 'image/gif' };
  }
  if (header.subarray(0, 4).toString('ascii') === 'RIFF'
    && header.subarray(8, 12).toString('ascii') === 'WEBP') {
    return { extension: 'webp', mimeType: 'image/webp' };
  }

  return null;
}

/** Detect supported content from its bytes instead of trusting MIME headers. */
export function detectEmailAttachmentType(
  content: Buffer,
): { extension: 'pdf' | 'png' | 'jpg'; mimeType: string } | null {
  const pdfHeader = content.subarray(0, Math.min(content.length, 1024)).indexOf(Buffer.from('%PDF-'));
  if (pdfHeader >= 0) return { extension: 'pdf', mimeType: 'application/pdf' };

  if (content.subarray(0, 8).equals(
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  )) {
    return { extension: 'png', mimeType: 'image/png' };
  }

  if (content[0] === 0xff && content[1] === 0xd8 && content[2] === 0xff) {
    return { extension: 'jpg', mimeType: 'image/jpeg' };
  }

  return null;
}

/**
 * Get all users with IMAP enabled
 */
export async function getAllEnabledUsers(): Promise<UserInfo[]> {
  const users = await prisma.users.findMany({
    where: { imap_enabled: true },
    select: { id: true }
  });

  return users.map(u => ({ userId: u.id }));
}

/**
 * Get all new emails for a specific user
 */
export async function getUserEmails(userId: string): Promise<EmailBatch> {
  const user = await prisma.users.findUnique({
    where: { id: userId },
    select: {
      imap_server: true,
      imap_port: true,
      imap_username: true,
      imap_password_encrypted: true,
      imap_folder: true,
      imap_last_uid: true,
      imap_uid_validity: true,
    }
  });

  if (!user || !user.imap_server || !user.imap_password_encrypted) {
    return { emails: [], uidValidity: '' };
  }

  const password = decryptPassword(user.imap_password_encrypted);

  const client = new ImapFlow({
    host: user.imap_server,
    port: user.imap_port || 993,
    secure: true,
    auth: {
      user: user.imap_username || '',
      pass: password
    },
    logger: false
  });

  await client.connect();

  try {
    const lock = await client.getMailboxLock(user.imap_folder || 'INBOX');

    try {
      if (!client.mailbox) {
        throw new Error('IMAP mailbox was not selected');
      }
      const uidValidity = String(client.mailbox.uidValidity);
      const lastUid = user.imap_uid_validity === uidValidity ? user.imap_last_uid : null;
      let searchCriteria;
      if (lastUid) {
        searchCriteria = `${lastUid + 1}:*`;
        console.log(`Searching for UIDs > ${lastUid} (query: "${searchCriteria}")`);
      } else {
        searchCriteria = '1:*';
        console.log(`First sync - searching for all emails`);
      }

      const emailsToProcess: EmailToProcess[] = [];

      try {
        const messages = client.fetch(
          searchCriteria,
          { uid: true, envelope: true },
          { uid: true },
        );

        for await (const message of messages) {
          // Only include messages with UID greater than last_uid
          if (!lastUid || message.uid > lastUid) {
            emailsToProcess.push({
              uid: message.uid,
              emailId: `${userId}-${message.uid}`,
              subject: message.envelope?.subject || `Email UID ${message.uid}`
            });
          }
        }
      } catch (fetchError: any) {
        // If the UID range is invalid (no messages in that range), return empty array
        if (fetchError.responseText && fetchError.responseText.includes('Invalid messageset')) {
          console.log(`No new messages found (UID range ${searchCriteria} is empty)`);
          return { emails: [], uidValidity };
        }
        throw fetchError;
      }

      console.log(`Fetched ${emailsToProcess.length} emails after filtering`);
      return { emails: emailsToProcess, uidValidity };
    } finally {
      lock.release();
    }
  } finally {
    await client.logout();
  }
}

/**
 * Format email address(es) for display
 */
function formatAddress(addr: any): string {
  if (!addr) return '';
  if (Array.isArray(addr.value)) {
    return addr.value.map((a: any) => a.address || a.name || '').filter(Boolean).join(', ');
  }
  if (addr.text) return addr.text;
  return '';
}

/**
 * Fetch HTML content and metadata from specific email
 */
export async function fetchEmailHtml(
  userId: string,
  uid: number,
  documentId: string,
): Promise<{
  html: string;
  metadata: EmailMetadata;
  attachments: StoredEmailAttachment[];
  inlineImages: StoredEmailInlineImage[];
  skippedAttachments: SkippedEmailAttachment[];
}> {
  const user = await prisma.users.findUnique({
    where: { id: userId },
    select: {
      imap_server: true,
      imap_port: true,
      imap_username: true,
      imap_password_encrypted: true,
      imap_folder: true,
    }
  });

  if (!user || !user.imap_password_encrypted) {
    throw new Error('User not found or IMAP not configured');
  }

  const password = decryptPassword(user.imap_password_encrypted);

  const client = new ImapFlow({
    host: user.imap_server!,
    port: user.imap_port || 993,
    secure: true,
    auth: {
      user: user.imap_username!,
      pass: password
    },
    logger: false
  });

  await client.connect();

  try {
    const lock = await client.getMailboxLock(user.imap_folder || 'INBOX');

    try {
      const messages = client.fetch(
        String(uid),
        {
          uid: true,
          bodyStructure: true,
          envelope: true,
          source: true,
        },
        { uid: true },
      );

      let htmlContent = '';
      let metadata: EmailMetadata = { from: '', to: '', cc: '' };
      let storedAttachments: StoredEmailAttachment[] = [];
      let storedInlineImages: StoredEmailInlineImage[] = [];
      let skippedAttachments: SkippedEmailAttachment[] = [];

      for await (const message of messages) {
        if (!message.source) {
          throw new Error('Email source is empty');
        }

        const { simpleParser } = await import('mailparser');
        const parsed = await simpleParser(message.source);

        // Extract metadata
        metadata = {
          from: formatAddress(parsed.from),
          to: formatAddress(parsed.to),
          cc: formatAddress(parsed.cc),
          ...(parsed.date && { date: parsed.date.toISOString() }),
          ...(parsed.subject && { subject: parsed.subject }),
        };

        if (parsed.html) {
          htmlContent = parsed.html as string;
        } else if (parsed.text) {
          htmlContent = `<html><body><pre>${parsed.text}</pre></body></html>`;
        } else {
          // Attachment-only messages still need a body page so they can enter
          // the same PDF-first document pipeline.
          htmlContent = '<html><body><p>This email has no text body.</p></body></html>';
        }

        const parsedAttachments = parsed.attachments as ParsedEmailAttachment[];
        // Determine which parts are inline before replacing their cid: URLs.
        const inlineAttachments = new Set(
          parsedAttachments.filter(attachment => isInlineEmailAttachment(attachment, htmlContent)),
        );

        const uploadDir = path.join(process.cwd(), 'uploads', documentId);
        await fs.mkdir(uploadDir, { recursive: true });
        let totalAttachmentSize = 0;

        for (const [index, parsedAttachment] of parsedAttachments.entries()) {
          const originalFilename = attachmentName(parsedAttachment, index);

          if (inlineAttachments.has(parsedAttachment)) {
            const cid = parsedAttachment.cid || parsedAttachment.contentId || '';
            const inlineType = detectRenderableInlineImageType(parsedAttachment);
            if (cid && inlineType) {
              const filename = `inline-${index + 1}.${inlineType.extension}`;
              const filePath = path.join(uploadDir, filename);
              await fs.writeFile(filePath, parsedAttachment.content);
              htmlContent = replaceInlineImageReference(htmlContent, cid, filename);
              storedInlineImages.push({
                filePath,
                filename,
                fileType: inlineType.mimeType,
              });
            } else {
              console.log(`Skipping non-renderable inline email body asset: ${originalFilename}`);
            }
            continue;
          }

          const detectedType = detectEmailAttachmentType(parsedAttachment.content);
          if (!detectedType) {
            skippedAttachments.push({ filename: originalFilename, reason: 'unsupported file type' });
            continue;
          }

          const fileSize = parsedAttachment.content.length;
          if (fileSize > MAX_EMAIL_ATTACHMENT_FILE_SIZE) {
            skippedAttachments.push({ filename: originalFilename, reason: 'file exceeds 50 MB limit' });
            continue;
          }
          if (storedAttachments.length >= MAX_EMAIL_ATTACHMENT_COUNT) {
            skippedAttachments.push({ filename: originalFilename, reason: 'attachment count exceeds 20' });
            continue;
          }
          if (totalAttachmentSize + fileSize > MAX_EMAIL_ATTACHMENT_TOTAL_SIZE) {
            skippedAttachments.push({ filename: originalFilename, reason: 'total attachments exceed 100 MB limit' });
            continue;
          }

          const filename = `attachment-${index + 1}.${detectedType.extension}`;
          const filePath = path.join(uploadDir, filename);
          await fs.writeFile(filePath, parsedAttachment.content);
          totalAttachmentSize += fileSize;
          storedAttachments.push({
            filePath,
            filename,
            originalFilename: attachmentDownloadName(originalFilename, detectedType.extension),
            fileSize,
            fileType: detectedType.mimeType,
          });
        }
      }

      if (!htmlContent) {
        throw new Error('Email not found');
      }

      return {
        html: htmlContent,
        metadata,
        attachments: storedAttachments,
        inlineImages: storedInlineImages,
        skippedAttachments,
      };
    } finally {
      lock.release();
    }
  } finally {
    await client.logout();
  }
}

/**
 * Convert HTML email to PDF using Gotenberg
 */
export async function convertHtmlToPdf(
  documentId: string,
  htmlContent: string,
  inlineImages: StoredEmailInlineImage[] = [],
): Promise<string> {
  const GOTENBERG_URL = process.env.GOTENBURG_URL;
  if (!GOTENBERG_URL) {
    throw new Error('GOTENBURG_URL not configured');
  }

  const gotenbergUrl = GOTENBERG_URL.startsWith('http')
    ? GOTENBERG_URL
    : `http://${GOTENBERG_URL}`;

  const boundary = `----WebKitFormBoundary${Math.random().toString(36).substring(2)}`;
  const htmlData = Buffer.from(htmlContent, 'utf-8');

  const parts: Buffer[] = [
    Buffer.from(`--${boundary}\r\n`),
    Buffer.from('Content-Disposition: form-data; name="files"; filename="index.html"\r\n'),
    Buffer.from('Content-Type: text/html\r\n\r\n'),
    htmlData,
    Buffer.from('\r\n'),
  ];

  for (const inlineImage of inlineImages) {
    parts.push(
      Buffer.from(`--${boundary}\r\n`),
      Buffer.from(`Content-Disposition: form-data; name="files"; filename="${inlineImage.filename}"\r\n`),
      Buffer.from(`Content-Type: ${inlineImage.fileType}\r\n\r\n`),
      await fs.readFile(inlineImage.filePath),
      Buffer.from('\r\n'),
    );
  }
  parts.push(Buffer.from(`--${boundary}--\r\n`));
  const body = Buffer.concat(parts);

  const response = await fetch(`${gotenbergUrl}/forms/chromium/convert/html`, {
    method: 'POST',
    headers: {
      'Content-Type': `multipart/form-data; boundary=${boundary}`,
      'Content-Length': body.length.toString()
    },
    body: body
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Gotenberg conversion failed: ${response.statusText} - ${errorText}`);
  }

  const pdfDir = path.join(process.cwd(), 'uploads', documentId);
  await fs.mkdir(pdfDir, { recursive: true });
  const pdfPath = path.join(pdfDir, 'email.pdf');

  const pdfBuffer = await response.arrayBuffer();
  await fs.writeFile(pdfPath, Buffer.from(pdfBuffer));

  return pdfPath;
}

/**
 * Create document record for email (without file path initially)
 */
export async function createDocumentRecord(
  userId: string,
  subject: string,
  sourceKey: string,
): Promise<string> {
  const document = await prisma.documents.upsert({
    where: { source_key: sourceKey },
    update: { title: subject, status: 'UPLOADED' },
    create: {
      user_id: userId,
      source_key: sourceKey,
      title: subject,
      filename: 'email.pdf',
      original_filename: `${subject}.pdf`,
      file_path: '', // Will be updated after PDF conversion
      file_size: 0, // Will be updated after PDF conversion
      file_type: 'application/pdf',
      status: 'UPLOADED',
    }
  });

  return document.id;
}

/**
 * Update document with PDF path and file size after conversion
 */
export async function updateDocumentPath(
  documentId: string,
  pdfPath: string,
  attachments: StoredEmailAttachment[] = [],
): Promise<void> {
  const stats = await fs.stat(pdfPath);
  const totalSize = stats.size + attachments.reduce((sum, attachment) => sum + attachment.fileSize, 0);

  await prisma.$transaction(async (tx) => {
    await tx.documents.update({
      where: { id: documentId },
      data: { file_path: pdfPath, file_size: totalSize },
    });

    // Replace the list atomically so activity retries cannot leave stale rows.
    await tx.documentFiles.deleteMany({ where: { document_id: documentId } });
    await tx.documentFiles.createMany({
      data: [
        {
          document_id: documentId,
          position: 0,
          filename: 'email.pdf',
          original_filename: 'email.pdf',
          file_path: pdfPath,
          file_size: stats.size,
          file_type: 'application/pdf',
        },
        ...attachments.map((attachment, index) => ({
          document_id: documentId,
          position: index + 1,
          filename: attachment.filename,
          original_filename: attachment.originalFilename,
          file_path: attachment.filePath,
          file_size: attachment.fileSize,
          file_type: attachment.fileType,
        })),
      ],
    });
  });
}

export async function failEmailDocument(documentId: string, message: string): Promise<void> {
  await prisma.documents.update({
    where: { id: documentId },
    data: { status: 'ERROR' },
  });
  console.error(`Email document ${documentId} failed: ${message.slice(0, 500)}`);
}

/**
 * Update user's last processed UID
 */
export async function updateImapLastUid(
  userId: string,
  uid: number,
  uidValidity: string,
): Promise<void> {
  await prisma.users.update({
    where: { id: userId },
    data: { imap_last_uid: uid, imap_uid_validity: uidValidity }
  });
}
