import { getTemporalClient } from './client.js';
import { EmailIngestionSchedulerWorkflow } from './email-processing.workflow.js';
import * as dotenv from 'dotenv';

dotenv.config();

async function initSchedule() {
  const client = await getTemporalClient();

  const scheduleId = 'email-ingestion-schedule';

  try {
    const handle = client.schedule.getHandle(scheduleId);
    await handle.describe();
    console.log(`Schedule ${scheduleId} already exists`);
  } catch (error) {
    console.log(`Creating schedule ${scheduleId}...`);

    await client.schedule.create({
      scheduleId,
      spec: {
        intervals: [{ every: '1m' }]
      },
      action: {
        type: 'startWorkflow',
        workflowType: EmailIngestionSchedulerWorkflow,
        taskQueue: 'email-processing',
      },
      policies: {
        overlap: 'SKIP',
        catchupWindow: '1h',
      }
    });

    console.log(`Schedule ${scheduleId} created successfully`);
    console.log('The schedule will check for new emails every 1 minute');
  }

  process.exit(0);
}

initSchedule().catch((error) => {
  console.error('Failed to initialize schedule:', error);
  process.exit(1);
});
