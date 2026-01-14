import { Worker, NativeConnection } from '@temporalio/worker';
import * as documentActivities from '../activities/document-processing';
import * as emailActivities from '../activities/email-processing';
import * as path from 'path';
import { fileURLToPath } from 'url';
import * as dotenv from 'dotenv';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Combined Temporal worker for document and email processing
 */
async function run() {
  const temporalAddress = process.env.TEMPORAL_ADDRESS || 'localhost:7233';

  console.log('Starting Combined Worker');
  console.log('Temporal Server:', temporalAddress);
  console.log('Environment check:');
  console.log('- OPENAI_API_KEY:', process.env.OPENAI_API_KEY ? 'SET' : 'NOT SET');
  console.log('- OPENAI_API_ENDPOINT:', process.env.OPENAI_API_ENDPOINT || 'NOT SET');
  console.log('- OPENAI_MODEL:', process.env.OPENAI_MODEL || 'NOT SET');
  console.log('- ENCRYPTION_SECRET:', process.env.ENCRYPTION_SECRET ? 'SET' : 'NOT SET');
  console.log('- GOTENBURG_URL:', process.env.GOTENBURG_URL || 'NOT SET');

  const connection = await NativeConnection.connect({
    address: temporalAddress,
  });

  console.log('Connected to Temporal server');

  // Create document processing worker
  const documentWorker = await Worker.create({
    connection,
    namespace: 'default',
    taskQueue: 'document-processing',
    workflowsPath: path.join(__dirname, 'document-processing.workflow.ts'),
    activities: documentActivities,
  });

  // Create email processing worker
  const emailWorker = await Worker.create({
    connection,
    namespace: 'default',
    taskQueue: 'email-processing',
    workflowsPath: path.join(__dirname, 'email-processing.workflow.ts'),
    activities: emailActivities,
  });

  console.log('Workers started successfully');
  console.log('Task Queues: document-processing, email-processing');
  console.log('Namespace: default');
  console.log('Waiting for workflow tasks...');

  // Run both workers concurrently
  await Promise.all([
    documentWorker.run(),
    emailWorker.run(),
  ]);
}

run().catch((err) => {
  console.error('Worker failed:', err);
  process.exit(1);
});
