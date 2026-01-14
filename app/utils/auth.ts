/**
 * Session Management Utilities
 * Task 8.5: Create session management utilities
 *
 * Provides helpers for JWT token management:
 * - getSession(): Retrieve current JWT token
 * - setSession(token): Store JWT token
 * - clearSession(): Remove JWT token
 * - isAuthenticated(): Check if user has valid session
 *
 * JWT stored in localStorage as fallback (httpOnly cookie set by API is primary)
 */

const TOKEN_KEY = 'tldr_token';

/**
 * Get current session token
 * Checks localStorage for token
 * Returns token string or null if not found
 */
export function getSession(): string | null {
  if (typeof window === 'undefined') {
    return null;
  }

  return localStorage.getItem(TOKEN_KEY);
}

/**
 * Store JWT token in session
 * Saves token to localStorage
 * Used after successful login
 */
export function setSession(token: string): void {
  if (typeof window === 'undefined') {
    return;
  }

  localStorage.setItem(TOKEN_KEY, token);
}

/**
 * Clear session token
 * Removes token from localStorage
 * Used during logout
 */
export function clearSession(): void {
  if (typeof window === 'undefined') {
    return;
  }

  localStorage.removeItem(TOKEN_KEY);
}

/**
 * Check if user is authenticated
 * Returns true if valid token exists
 * Returns false if no token or token is invalid
 */
export function isAuthenticated(): boolean {
  const token = getSession();
  if (!token) {
    return false;
  }

  // Basic JWT structure validation
  // Full validation happens on the server
  try {
    const parts = token.split('.');
    if (parts.length !== 3 || !parts[1]) {
      return false;
    }

    // Decode payload to check expiration
    const payload = JSON.parse(atob(parts[1]));
    const now = Math.floor(Date.now() / 1000);

    // Check if token is expired
    if (payload.exp && payload.exp < now) {
      clearSession();
      return false;
    }

    return true;
  } catch (error) {
    console.error('Error validating token:', error);
    return false;
  }
}

/**
 * Get user ID from current session token
 * Returns user_id from JWT payload or null if not authenticated
 */
export function getUserId(): string | null {
  const token = getSession();
  if (!token) {
    return null;
  }

  try {
    const parts = token.split('.');
    if (parts.length !== 3 || !parts[1]) {
      return null;
    }

    const payload = JSON.parse(atob(parts[1]));
    return payload.user_id || null;
  } catch (error) {
    console.error('Error extracting user ID:', error);
    return null;
  }
}

/**
 * Authenticated fetch wrapper
 * Automatically adds Authorization header and handles 401 responses
 * Redirects to login page when token is expired or invalid
 */
export async function authFetch(
  url: string,
  options: RequestInit = {}
): Promise<Response> {
  const token = getSession();

  // Check if already expired locally before making request
  if (!isAuthenticated()) {
    clearSession();
    window.location.href = '/login';
    throw new Error('Session expired');
  }

  // Add auth headers
  const headers = new Headers(options.headers);
  if (token) {
    headers.set('Authorization', `Bearer ${token}`);
  }

  const response = await fetch(url, {
    ...options,
    headers,
    credentials: 'include',
  });

  // Handle 401 Unauthorized - token expired or invalid
  if (response.status === 401) {
    clearSession();
    window.location.href = '/login';
    throw new Error('Session expired');
  }

  return response;
}
