import { Router, type Request, type Response } from 'express';
import { prisma } from "../db.js";
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';

const router = Router();
// Use shared Prisma client from db.ts

/**
 * Email validation regex
 */
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Password validation: minimum 8 characters, must contain letters and numbers
 */
function validatePassword(password: string): { valid: boolean; error?: string } {
  if (password.length < 8) {
    return { valid: false, error: 'Password must be at least 8 characters long' };
  }

  const hasLetters = /[a-zA-Z]/.test(password);
  const hasNumbers = /[0-9]/.test(password);

  if (!hasLetters || !hasNumbers) {
    return { valid: false, error: 'Password must contain both letters and numbers' };
  }

  return { valid: true };
}

/**
 * POST /api/auth/signup
 * Accept JSON body: { email, password }
 * Validate email format and password strength
 * Hash password with bcrypt (10 rounds)
 * Create user in Users table
 * Return 201 Created with user ID (exclude password_hash)
 * Return 400 Bad Request if validation fails
 */
router.post('/signup', async (req: Request, res: Response) => {
  try {
    const { email, password } = req.body;

    // Validate required fields
    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password are required' });
    }

    // Validate email format
    if (!EMAIL_REGEX.test(email)) {
      return res.status(400).json({ error: 'Invalid email format' });
    }

    // Validate password strength
    const passwordValidation = validatePassword(password);
    if (!passwordValidation.valid) {
      return res.status(400).json({ error: passwordValidation.error });
    }

    // Check if user already exists
    const existingUser = await prisma.users.findUnique({
      where: { email }
    });

    if (existingUser) {
      return res.status(400).json({ error: 'User with this email already exists' });
    }

    // Hash password with bcrypt (10 rounds)
    const password_hash = await bcrypt.hash(password, 10);

    // Create user in Users table
    const user = await prisma.users.create({
      data: {
        email,
        password_hash
      },
      select: {
        id: true,
        email: true,
        created_at: true,
        updated_at: true
      }
    });

    // Return 201 Created with user info (password_hash excluded via select)
    return res.status(201).json(user);
  } catch (error) {
    console.error('Signup error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * POST /api/auth/login
 * Accept JSON body: { email, password }
 * Query Users table for email
 * Verify password with bcrypt.compare
 * Generate JWT token with payload: { user_id, exp: 6 months }
 * Set httpOnly secure cookie with token
 * Return 200 OK with token and user info
 * Return 401 Unauthorized if credentials invalid
 */
router.post('/login', async (req: Request, res: Response) => {
  try {
    const { email, password } = req.body;

    // Validate required fields
    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password are required' });
    }

    // Query Users table for email
    const user = await prisma.users.findUnique({
      where: { email }
    });

    if (!user) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    // Verify password with bcrypt.compare
    const passwordMatch = await bcrypt.compare(password, user.password_hash);

    if (!passwordMatch) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    // Generate JWT token with 6 month expiration
    const jwtSecret = process.env.JWT_SECRET;
    if (!jwtSecret) {
      console.error('JWT_SECRET is not configured');
      return res.status(500).json({ error: 'Server configuration error' });
    }

    const token = jwt.sign(
      { user_id: user.id },
      jwtSecret,
      { expiresIn: '180d' }
    );

    // Set httpOnly secure cookie with token
    res.cookie('token', token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      maxAge: 180 * 24 * 60 * 60 * 1000, // 6 months in milliseconds
      sameSite: 'strict'
    });

    // Return 200 OK with token and user info
    return res.status(200).json({
      token,
      user: {
        id: user.id,
        email: user.email,
        created_at: user.created_at
      }
    });
  } catch (error) {
    console.error('Login error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * POST /api/auth/logout
 * Clear session cookie
 * Return 200 OK
 */
router.post('/logout', (req: Request, res: Response) => {
  // Clear the token cookie
  res.clearCookie('token', {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'strict'
  });

  return res.status(200).json({ message: 'Logged out successfully' });
});

export default router;
