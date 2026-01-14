import { Worker, NativeConnection } from '@temporalio/worker';
import * as emailActivities from '../activities/email-processing';
import * as path from 'path';
import { fileURLToPath } from 'url';
import * as dotenv from 'dotenv';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Start Temporal worker for email processing
 */
async function run() {
  const temporalAddress = process.env.TEMPORAL_ADDRESS || 'localhost:7233';

  console.log('Starting Email Processing Worker');
  console.log('Temporal Server:', temporalAddress);
  console.log('Environment check:');
  console.log('- ENCRYPTION_SECRET:', process.env.ENCRYPTION_SECRET ? 'SET' : 'NOT SET');
  console.log('- GOTENBURG_URL:', process.env.GOTENBURG_URL || 'NOT SET');

  const connection = await NativeConnection.connect({
    address: temporalAddress,
  });

  console.log('Connected to Temporal server');

  const worker = await Worker.create({
    connection,
    namespace: 'default',
    taskQueue: 'email-processing',
    workflowsPath: path.join(__dirname, 'email-processing.workflow.ts'),
    activities: emailActivities,
  });

  console.log('Email worker started successfully');
  console.log('Task Queue: email-processing');
  console.log('Namespace: default');
  console.log('Waiting for workflow tasks...');

  await worker.run();
}

run().catch((err) => {
  console.error('Email worker failed:', err);
  process.exit(1);
});
