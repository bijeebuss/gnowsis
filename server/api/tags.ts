import { Router, type Response } from 'express';
import { prisma } from "../db.js";
import { requireAuth, type AuthRequest } from '../middleware/auth.js';

const router = Router();

/**
 * GET /api/tags
 * Apply requireAuth middleware
 * Query Tags table for current user_id
 * Include document count for each tag
 * Return 200 OK with array of tag objects
 */
router.get('/', requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user_id;

    if (!userId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    // Query Tags table with document count
    const tags = await prisma.tags.findMany({
      where: {
        user_id: userId
      },
      include: {
        _count: {
          select: {
            documentTags: true
          }
        }
      },
      orderBy: {
        name: 'asc'
      }
    });

    // Format response with document count
    const formattedTags = tags.map(tag => ({
      id: tag.id,
      name: tag.name,
      user_id: tag.user_id,
      created_at: tag.created_at,
      document_count: tag._count.documentTags
    }));

    return res.status(200).json(formattedTags);
  } catch (error) {
    console.error('Get tags error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
