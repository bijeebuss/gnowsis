import { type Request, type Response, type NextFunction } from 'express';
import jwt from 'jsonwebtoken';

/**
 * Extended Request interface with user_id
 */
export interface AuthRequest extends Request {
  user_id?: string;
}

/**
 * JWT Payload interface
 */
interface JWTPayload {
  user_id: string;
  iat?: number;
  exp?: number;
}

/**
 * Authentication middleware that validates JWT tokens
 * Extracts JWT from Authorization header or cookie
 * Verifies JWT signature using JWT_SECRET
 * Attaches user_id to request object
 * Returns 401 Unauthorized if token invalid/expired
 */
export function requireAuth(req: AuthRequest, res: Response, next: NextFunction): void {
  try {
    // Extract token from Authorization header or cookie
    let token: string | undefined;

    // Check Authorization header (format: "Bearer <token>")
    const authHeader = req.headers.authorization;
    if (authHeader && authHeader.startsWith('Bearer ')) {
      token = authHeader.substring(7);
    }

    // Fallback to cookie
    if (!token && req.cookies && req.cookies.token) {
      token = req.cookies.token;
    }

    // No token found
    if (!token) {
      res.status(401).json({ error: 'Unauthorized: No token provided' });
      return;
    }

    // Verify JWT signature
    const jwtSecret = process.env.JWT_SECRET;
    if (!jwtSecret) {
      console.error('JWT_SECRET is not configured');
      res.status(500).json({ error: 'Server configuration error' });
      return;
    }

    try {
      const decoded = jwt.verify(token, jwtSecret) as JWTPayload;

      // Attach user_id to request object
      req.user_id = decoded.user_id;

      // Continue to next middleware/handler
      next();
    } catch (jwtError) {
      // Token is invalid or expired
      if (jwtError instanceof jwt.TokenExpiredError) {
        res.status(401).json({ error: 'Unauthorized: Token expired' });
      } else if (jwtError instanceof jwt.JsonWebTokenError) {
        res.status(401).json({ error: 'Unauthorized: Invalid token' });
      } else {
        res.status(401).json({ error: 'Unauthorized: Token verification failed' });
      }
      return;
    }
  } catch (error) {
    console.error('Auth middleware error:', error);
    res.status(500).json({ error: 'Internal server error' });
    return;
  }
}
