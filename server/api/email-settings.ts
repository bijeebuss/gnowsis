import { Router, type Response } from 'express';
import { prisma } from '../db.js';
import { requireAuth, type AuthRequest } from '../middleware/auth.js';
import { encryptPassword, decryptPassword } from '../utils/encryption.js';
import { ImapFlow } from 'imapflow';

const router = Router();

/**
 * GET /api/email-settings
 * Get current user's email settings (password excluded)
 */
router.get('/', requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user_id;
    if (!userId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const user = await prisma.users.findUnique({
      where: { id: userId },
      select: {
        imap_enabled: true,
        imap_server: true,
        imap_port: true,
        imap_username: true,
        imap_folder: true,
        imap_last_uid: true,
      }
    });

    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    return res.status(200).json(user);
  } catch (error) {
    console.error('Get email settings error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * POST /api/email-settings/test
 * Test IMAP connection with provided credentials
 */
router.post('/test', requireAuth, async (req: AuthRequest, res: Response) => {
  let client: ImapFlow | null = null;

  try {
    const { server, port, username, password, folder } = req.body;

    if (!server || !username || !password) {
      return res.status(400).json({
        error: 'Server, username, and password are required'
      });
    }

    client = new ImapFlow({
      host: server,
      port: port || 993,
      secure: true,
      auth: { user: username, pass: password },
      logger: false
    });

    const connectPromise = client.connect();
    const timeoutPromise = new Promise((_, reject) =>
      setTimeout(() => reject(new Error('Connection timeout after 15 seconds')), 15000)
    );

    await Promise.race([connectPromise, timeoutPromise]);

    const lock = await client.getMailboxLock(folder || 'INBOX');
    lock.release();
    await client.logout();

    return res.status(200).json({
      success: true,
      message: 'Connection successful'
    });
  } catch (error: any) {
    console.error('IMAP test connection error:', error);

    if (client) {
      try {
        await client.logout();
      } catch (logoutError) {
        // Ignore logout errors
      }
    }

    return res.status(400).json({
      error: 'Connection failed: ' + (error.message || 'Unknown error')
    });
  }
});

/**
 * PUT /api/email-settings
 * Update user's email settings
 */
router.put('/', requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user_id;
    if (!userId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const {
      enabled,
      server,
      port,
      username,
      password,
      folder
    } = req.body;

    const updateData: any = {};

    if (typeof enabled === 'boolean') {
      updateData.imap_enabled = enabled;
    }

    if (server !== undefined) {
      updateData.imap_server = server;
    }

    if (port !== undefined) {
      updateData.imap_port = port;
    }

    if (username !== undefined) {
      updateData.imap_username = username;
    }

    if (password !== undefined && password !== '') {
      updateData.imap_password_encrypted = encryptPassword(password);
    }

    if (folder !== undefined) {
      updateData.imap_folder = folder;
    }

    const updatedUser = await prisma.users.update({
      where: { id: userId },
      data: updateData,
      select: {
        imap_enabled: true,
        imap_server: true,
        imap_port: true,
        imap_username: true,
        imap_folder: true,
      }
    });

    return res.status(200).json(updatedUser);
  } catch (error) {
    console.error('Update email settings error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * DELETE /api/email-settings
 * Delete user's email settings
 */
router.delete('/', requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user_id;
    if (!userId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    await prisma.users.update({
      where: { id: userId },
      data: {
        imap_enabled: false,
        imap_server: null,
        imap_port: null,
        imap_username: null,
        imap_password_encrypted: null,
        imap_folder: null,
        imap_last_uid: null,
      }
    });

    return res.status(204).send();
  } catch (error) {
    console.error('Delete email settings error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
