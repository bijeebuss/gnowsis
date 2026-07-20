import { executeChild, proxyActivities } from '@temporalio/workflow';
import type * as emailActivities from '../activities/email-processing';
import { DocumentProcessingWorkflow } from './document-processing.workflow';

const {
  getAllEnabledUsers,
  getUserEmails,
  fetchEmailHtml,
  convertHtmlToPdf,
  createDocumentRecord,
  updateDocumentPath,
  failEmailDocument,
  updateImapLastUid,
} = proxyActivities<typeof emailActivities>({
  startToCloseTimeout: '2 minutes',
  retry: {
    initialInterval: '1s',
    maximumInterval: '30s',
    backoffCoefficient: 2,
    maximumAttempts: 3,
  },
});

/**
 * Scheduled workflow that runs every minute
 * Gets all users with IMAP enabled and starts a workflow for each
 */
export async function EmailIngestionSchedulerWorkflow(): Promise<void> {
  const users = await getAllEnabledUsers();

  console.log(`Found ${users.length} users with email sync enabled`);

  for (const user of users) {
    await executeChild(CheckUserEmailsWorkflow, {
      workflowId: `check-emails-${user.userId}-${Date.now()}`,
      args: [user.userId],
      taskQueue: 'email-processing',
    });
  }
}

/**
 * Check emails for a single user and start workflow for each email
 */
export async function CheckUserEmailsWorkflow(userId: string): Promise<void> {
  console.log(`Checking emails for user ${userId}`);

  const { emails, uidValidity } = await getUserEmails(userId);
  console.log(`Found ${emails.length} new emails for user ${userId}`);

  if (emails.length > 0) {
    const uids = emails.map(e => e.uid).sort((a, b) => a - b);
    console.log(`Email UIDs to process: [${uids.join(', ')}]`);
  }

  for (const email of [...emails].sort((a, b) => a.uid - b.uid)) {
    await executeChild(EmailDocumentProcessingWorkflow, {
      workflowId: `email-doc-${email.emailId}-${uidValidity}`,
      args: [userId, email.uid, email.emailId, email.subject, uidValidity],
      taskQueue: 'email-processing',
    });
    await updateImapLastUid(userId, email.uid, uidValidity);
    console.log(`Updated last UID to ${email.uid} for user ${userId}`);
  }
}

/**
 * Format email metadata as searchable text for vectorization
 * Note: Subject is passed separately as title, so not included here
 */
function formatEmailMetadataForSearch(
  metadata: { from: string; to: string; cc: string; date?: string },
  attachmentNames: string[],
  skippedAttachments: Array<{ filename: string; reason: string }>,
): string {
  const lines: string[] = [];

  if (metadata.from) {
    lines.push(`From: ${metadata.from}`);
  }

  if (metadata.to) {
    lines.push(`To: ${metadata.to}`);
  }

  if (metadata.cc) {
    lines.push(`CC: ${metadata.cc}`);
  }

  if (metadata.date) {
    const date = new Date(metadata.date);
    lines.push(`Date: ${date.toISOString()}`);
  }

  if (attachmentNames.length > 0) {
    lines.push(`Attachments: ${attachmentNames.join(', ')}`);
  }

  if (skippedAttachments.length > 0) {
    lines.push(`Skipped attachments: ${skippedAttachments
      .map(attachment => `${attachment.filename} (${attachment.reason})`)
      .join(', ')}`);
  }

  return lines.join('\n');
}

/**
 * Process a single email: fetch HTML, convert to PDF, create document, process
 */
export async function EmailDocumentProcessingWorkflow(
  userId: string,
  emailUid: number,
  emailId: string,
  subject: string,
  uidValidity: string,
): Promise<void> {
  console.log(`Processing email "${subject}" (${emailId})`);

  // Create document record first to get the document ID
  const sourceKey = `imap:${userId}:${uidValidity}:${emailUid}`;
  const documentId = await createDocumentRecord(userId, subject, sourceKey);
  console.log(`Created document record: ${documentId}`);

  try {
    const { html, metadata, attachments, inlineImages, skippedAttachments } = await fetchEmailHtml(
      userId,
      emailUid,
      documentId,
    );
    console.log(
      `Fetched email HTML with ${attachments.length} processable attachments `
      + `and ${skippedAttachments.length} skipped attachments`,
    );

    // Convert HTML to PDF and save it beside the extracted attachments.
    const pdfPath = await convertHtmlToPdf(documentId, html, inlineImages);
    console.log(`Converted to PDF: ${pdfPath}`);
    await updateDocumentPath(documentId, pdfPath, attachments);
    const emailMetadataText = formatEmailMetadataForSearch(
      metadata,
      attachments.map(attachment => attachment.originalFilename),
      skippedAttachments,
    );
    await executeChild(DocumentProcessingWorkflow, {
      workflowId: `doc-processing-${documentId}`,
      args: [
        documentId,
        [pdfPath, ...attachments.map(attachment => attachment.filePath)],
        subject,
        emailMetadataText,
      ],
      taskQueue: 'document-processing',
    });
    console.log(`Completed document processing for ${documentId}`);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown email processing error';
    await failEmailDocument(documentId, message);
    throw error;
  }
}
