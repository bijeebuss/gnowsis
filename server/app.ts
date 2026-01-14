import express, { type Express, type Request, type Response, type NextFunction } from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import authRoutes from './api/auth.js';
import documentsRoutes from './api/documents.js';
import tagsRoutes from './api/tags.js';
import emailSettingsRoutes from './api/email-settings.js';

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

// API Routes
app.use('/api/auth', authRoutes);
app.use('/api/documents', documentsRoutes);
app.use('/api/tags', tagsRoutes);
app.use('/api/email-settings', emailSettingsRoutes);

// Health check endpoint
app.get('/health', (req: Request, res: Response) => {
  res.json({ status: 'ok' });
});

// Error handling middleware
app.use((err: Error, req: Request, res: Response, next: NextFunction) => {
  console.error('Error:', err);
  res.status(500).json({ error: 'Internal server error' });
});

let server: any = null;

/**
 * Start the Express server
 */
export async function startServer(port: number = 3001): Promise<any> {
  return new Promise((resolve) => {
    server = app.listen(port, '0.0.0.0', () => {
      console.log(`API server running on http://0.0.0.0:${port}`);
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
  const port = parseInt(process.env.API_PORT || '3001', 10);
  startServer(port);
}
