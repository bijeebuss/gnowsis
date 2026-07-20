/**
 * Session Management Utilities
 * Task 8.5: Create session management utilities
 *
 * Authentication uses an httpOnly cookie. The localStorage cleanup is retained
 * only to remove bearer tokens written by older versions of the application.
 */

const TOKEN_KEY = 'tldr_token';

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
 * Authenticated fetch wrapper
 * Automatically adds Authorization header and handles 401 responses
 * Redirects to login page when token is expired or invalid
 */
export async function authFetch(
  url: string,
  options: RequestInit = {}
): Promise<Response> {
  const headers = new Headers(options.headers);

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

export async function logout(): Promise<void> {
  try {
    await fetch('/api/auth/logout', { method: 'POST', credentials: 'include' });
  } finally {
    clearSession();
    window.location.href = '/login';
  }
}
