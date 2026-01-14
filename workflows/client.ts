import { Connection, Client, type WorkflowHandle } from '@temporalio/client';
import { DocumentProcessingWorkflow } from './document-processing.workflow';

let client: Client | null = null;

/**
 * Get or create Temporal client connection
 */
export async function getTemporalClient(): Promise<Client> {
  if (client) {
    return client;
  }

  // Get Temporal address from environment or use default
  const temporalAddress = process.env.TEMPORAL_ADDRESS || 'localhost:7233';

  // Create connection to Temporal server
  const connection = await Connection.connect({
    address: temporalAddress,
  });

  // Create and cache client
  client = new Client({
    connection,
    namespace: 'default',
  });

  return client;
}

/**
 * Start document processing workflow
 * @param documentId - UUID of the document to process
 * @param filePaths - Array of paths to the uploaded files
 * @param title - Optional title to vectorize as a searchable page
 * @param notes - Optional notes to vectorize as a searchable page
 * @returns Workflow handle for tracking execution
 */
export async function startDocumentProcessing(
  documentId: string,
  filePaths: string[],
  title?: string,
  notes?: string
): Promise<WorkflowHandle<typeof DocumentProcessingWorkflow>> {
  const temporalClient = await getTemporalClient();

  const handle = await temporalClient.workflow.start(DocumentProcessingWorkflow, {
    args: [documentId, filePaths, title, notes],
    taskQueue: 'document-processing',
    workflowId: `doc-processing-${documentId}`,
  });

  return handle;
}

/**
 * Get handle to existing workflow
 * @param documentId - UUID of the document
 */
export async function getWorkflowHandle(
  documentId: string
): Promise<WorkflowHandle<typeof DocumentProcessingWorkflow>> {
  const temporalClient = await getTemporalClient();

  const handle = temporalClient.workflow.getHandle<typeof DocumentProcessingWorkflow>(
    `doc-processing-${documentId}`
  );

  return handle;
}

/**
 * Close the Temporal client connection
 */
export async function closeTemporalClient(): Promise<void> {
  if (client) {
    await client.connection.close();
    client = null;
  }
}
