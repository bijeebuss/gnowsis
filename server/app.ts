import express, { type Express, type Request, type Response, type NextFunction } from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import authRoutes from './api/auth.js';
import documentsRoutes from './api/documents.js';
import tagsRoutes from './api/tags.js';
import emailSettingsRoutes from './api/email-settings.js';
import { getTemporalClient } from '../workflows/client.js';
import { EmailIngestionSchedulerWorkflow } from '../workflows/email-processing.workflow.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export const app: Express = express();

// Middleware
app.use(cors({
  origin: process.env.FRONTEND_URL || 'http://localhost:3000',
  credentials: true
}));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());

// Serve static files from uploads directory
const uploadsPath = join(__dirname, '..', 'uploads');
app.use('/uploads', express.static(uploadsPath));

// In production, serve the frontend static files
const distPath = join(__dirname, '..', 'dist');

// API Routes
app.use('/api/auth', authRoutes);
app.use('/api/documents', documentsRoutes);
app.use('/api/tags', tagsRoutes);
app.use('/api/email-settings', emailSettingsRoutes);

// Health check endpoint
app.get('/health', (req: Request, res: Response) => {
  res.json({ status: 'ok' });
});

// In production, serve frontend static files and handle SPA routing
if (process.env.NODE_ENV === 'production') {
  app.use(express.static(distPath));

  // SPA fallback - serve index.html for non-API routes
  app.get('*', (req: Request, res: Response, next: NextFunction) => {
    // Skip API routes and uploads
    if (req.path.startsWith('/api') || req.path.startsWith('/uploads')) {
      return next();
    }
    res.sendFile(join(distPath, 'index.html'));
  });
}

// Error handling middleware
app.use((err: Error, req: Request, res: Response, next: NextFunction) => {
  console.error('Error:', err);
  res.status(500).json({ error: 'Internal server error' });
});

let server: any = null;

/**
 * Initialize the email ingestion schedule if it doesn't exist
 * Retries on failure since Temporal may not be ready immediately
 */
async function initEmailSchedule(maxRetries = 10, retryDelayMs = 5000): Promise<void> {
  const scheduleId = 'email-ingestion-schedule';

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const client = await getTemporalClient();

      try {
        const handle = client.schedule.getHandle(scheduleId);
        await handle.describe();
        console.log(`Email schedule '${scheduleId}' already exists`);
        return;
      } catch {
        // Schedule doesn't exist, create it
        console.log(`Creating email schedule '${scheduleId}'...`);

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

        console.log(`Email schedule created - checking for new emails every 1 minute`);
        return;
      }
    } catch (error) {
      console.log(`Failed to init email schedule (attempt ${attempt}/${maxRetries}): ${error instanceof Error ? error.message : error}`);
      if (attempt < maxRetries) {
        await new Promise(resolve => setTimeout(resolve, retryDelayMs));
      }
    }
  }

  console.warn('Could not initialize email schedule after max retries - email ingestion will not run automatically');
}

/**
 * Start the Express server
 */
export async function startServer(port: number = 3001): Promise<any> {
  return new Promise((resolve) => {
    server = app.listen(port, '0.0.0.0', () => {
      console.log(`API server running on http://0.0.0.0:${port}`);

      // Initialize email schedule in the background (don't block server startup)
      initEmailSchedule().catch(err => {
        console.error('Email schedule initialization failed:', err);
      });

      resolve(server);
    });
  });
}

/**
 * Close the Express server
 */
export async function closeServer(): Promise<void> {
  if (server) {
    return new Promise((resolve) => {
      server.close(() => {
        console.log('API server closed');
        resolve();
      });
    });
  }
}

// Start server if this file is run directly
if (import.meta.url === `file://${process.argv[1]}`) {
  const port = parseInt(process.env.PORT || process.env.API_PORT || '3001', 10);
  startServer(port);
}
