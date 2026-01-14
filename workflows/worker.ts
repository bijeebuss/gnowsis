import { Worker, NativeConnection } from '@temporalio/worker';
import * as activities from '../activities/document-processing';
import * as path from 'path';
import { fileURLToPath } from 'url';
import * as dotenv from 'dotenv';

// Load environment variables
dotenv.config();

// Get the directory name in ES modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Start Temporal worker for document processing
 */
async function run() {
  const temporalAddress = process.env.TEMPORAL_ADDRESS || 'localhost:7233';

  console.log('Connecting to Temporal server at:', temporalAddress);
  console.log('Environment check:');
  console.log('- OPENAI_API_KEY:', process.env.OPENAI_API_KEY ? 'SET (length: ' + process.env.OPENAI_API_KEY.length + ')' : 'NOT SET');
  console.log('- OPENAI_API_ENDPOINT:', process.env.OPENAI_API_ENDPOINT || 'NOT SET');
  console.log('- OPENAI_MODEL:', process.env.OPENAI_MODEL || 'NOT SET');

  // Create connection to Temporal server
  const connection = await NativeConnection.connect({
    address: temporalAddress,
  });

  console.log('Connected to Temporal server');

  // Create worker
  const worker = await Worker.create({
    connection,
    namespace: 'default',
    taskQueue: 'document-processing',
    workflowsPath: path.join(__dirname, 'document-processing.workflow.ts'),
    activities,
  });

  console.log('Temporal worker started successfully');
  console.log('Task Queue: document-processing');
  console.log('Namespace: default');
  console.log('Waiting for workflow tasks...');

  // Start worker
  await worker.run();
}

// Start the worker
run().catch((err) => {
  console.error('Worker failed:', err);
  process.exit(1);
});
