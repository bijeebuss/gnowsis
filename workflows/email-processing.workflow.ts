import { proxyActivities, startChild, ParentClosePolicy } from '@temporalio/workflow';
import type * as emailActivities from '../activities/email-processing';
import { DocumentProcessingWorkflow } from './document-processing.workflow';

const {
  getAllEnabledUsers,
  getUserEmails,
  fetchEmailHtml,
  convertHtmlToPdf,
  createDocumentRecord,
  updateDocumentPath,
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
    await startChild(CheckUserEmailsWorkflow, {
      workflowId: `check-emails-${user.userId}-${Date.now()}`,
      args: [user.userId],
      taskQueue: 'email-processing',
      parentClosePolicy: ParentClosePolicy.ABANDON,
    });
  }
}

/**
 * Check emails for a single user and start workflow for each email
 */
export async function CheckUserEmailsWorkflow(userId: string): Promise<void> {
  console.log(`Checking emails for user ${userId}`);

  const emails = await getUserEmails(userId);
  console.log(`Found ${emails.length} new emails for user ${userId}`);

  if (emails.length > 0) {
    const uids = emails.map(e => e.uid).sort((a, b) => a - b);
    console.log(`Email UIDs to process: [${uids.join(', ')}]`);
  }

  for (const email of emails) {
    await startChild(EmailDocumentProcessingWorkflow, {
      workflowId: `email-doc-${email.emailId}`,
      args: [userId, email.uid, email.emailId, email.subject],
      taskQueue: 'email-processing',
      parentClosePolicy: ParentClosePolicy.ABANDON,
    });
  }

  if (emails.length > 0) {
    const lastUid = Math.max(...emails.map(e => e.uid));
    await updateImapLastUid(userId, lastUid);
    console.log(`Updated last UID from previous value to ${lastUid} for user ${userId}`);
  }
}

/**
 * Format email metadata as searchable text for vectorization
 * Note: Subject is passed separately as title, so not included here
 */
function formatEmailMetadataForSearch(
  metadata: { from: string; to: string; cc: string; date?: string }
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
    lines.push(`Date: ${date.toLocaleDateString()} ${date.toLocaleTimeString()}`);
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
  subject: string
): Promise<void> {
  console.log(`Processing email "${subject}" (${emailId})`);

  const { html, metadata } = await fetchEmailHtml(userId, emailUid);
  console.log(`Fetched email HTML with metadata: from=${metadata.from}, to=${metadata.to}`);

  // Create document record first to get the document ID
  const documentId = await createDocumentRecord(userId, subject);
  console.log(`Created document record: ${documentId}`);

  // Convert HTML to PDF and save under the document ID
  const pdfPath = await convertHtmlToPdf(documentId, html);
  console.log(`Converted to PDF: ${pdfPath}`);

  // Update document with the PDF path
  await updateDocumentPath(documentId, pdfPath);

  // Format email metadata as searchable notes
  const emailMetadataText = formatEmailMetadataForSearch(metadata);

  // Start document processing child workflow and wait for it to start
  // This ensures the document exists before the child begins processing
  // Pass subject as title and formatted metadata as notes for vectorization
  const childHandle = await startChild(DocumentProcessingWorkflow, {
    workflowId: `doc-processing-${documentId}`,
    args: [documentId, [pdfPath], subject, emailMetadataText],
    taskQueue: 'document-processing',
    parentClosePolicy: ParentClosePolicy.ABANDON,
  });

  console.log(`Started document processing for ${documentId} (workflow ${childHandle.workflowId})`);
}
