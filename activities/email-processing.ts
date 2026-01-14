import { ImapFlow } from 'imapflow';
import * as fs from 'fs/promises';
import * as path from 'path';
import fetch from 'node-fetch';
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

export interface EmailMetadata {
  from: string;
  to: string;
  cc: string;
  date?: string;
  subject?: string;
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
export async function getUserEmails(userId: string): Promise<EmailToProcess[]> {
  const user = await prisma.users.findUnique({
    where: { id: userId },
    select: {
      imap_server: true,
      imap_port: true,
      imap_username: true,
      imap_password_encrypted: true,
      imap_folder: true,
      imap_last_uid: true,
    }
  });

  if (!user || !user.imap_server || !user.imap_password_encrypted) {
    return [];
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
      let searchCriteria;
      if (user.imap_last_uid) {
        searchCriteria = `${user.imap_last_uid + 1}:*`;
        console.log(`Searching for UIDs > ${user.imap_last_uid} (query: "${searchCriteria}")`);
      } else {
        searchCriteria = '1:*';
        console.log(`First sync - searching for all emails`);
      }

      const emailsToProcess: EmailToProcess[] = [];

      try {
        const messages = client.fetch(searchCriteria, { uid: true, envelope: true });

        for await (const message of messages) {
          // Only include messages with UID greater than last_uid
          if (!user.imap_last_uid || message.uid > user.imap_last_uid) {
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
          return [];
        }
        throw fetchError;
      }

      console.log(`Fetched ${emailsToProcess.length} emails after filtering`);
      return emailsToProcess;
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
  uid: number
): Promise<{ html: string; metadata: EmailMetadata }> {
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
      const messages = client.fetch(String(uid), {
        uid: true,
        bodyStructure: true,
        envelope: true,
        source: true
      });

      let htmlContent = '';
      let metadata: EmailMetadata = { from: '', to: '', cc: '' };

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
          throw new Error('No HTML or text content found in email');
        }
      }

      if (!htmlContent) {
        throw new Error('Email not found');
      }

      return { html: htmlContent, metadata };
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
  htmlContent: string
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

  const body = Buffer.concat([
    Buffer.from(`--${boundary}\r\n`),
    Buffer.from(`Content-Disposition: form-data; name="files"; filename="index.html"\r\n`),
    Buffer.from(`Content-Type: text/html\r\n\r\n`),
    htmlData,
    Buffer.from(`\r\n--${boundary}--\r\n`)
  ]);

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
  subject: string
): Promise<string> {
  const document = await prisma.documents.create({
    data: {
      user_id: userId,
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
  pdfPath: string
): Promise<void> {
  const stats = await fs.stat(pdfPath);

  await prisma.documents.update({
    where: { id: documentId },
    data: {
      file_path: pdfPath,
      file_size: stats.size,
    }
  });
}

/**
 * Update user's last processed UID
 */
export async function updateImapLastUid(
  userId: string,
  uid: number
): Promise<void> {
  await prisma.users.update({
    where: { id: userId },
    data: { imap_last_uid: uid }
  });
}
