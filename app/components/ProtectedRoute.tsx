/**
 * ProtectedRoute Component
 * Task 8.6: Create protected route wrapper component
 *
 * Checks authentication with isAuthenticated()
 * Redirects to /login if not authenticated
 * Renders children if authenticated
 * Used in dashboard, search, document viewer routes
 */

import { useEffect } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { isAuthenticated } from '../utils/auth';

interface ProtectedRouteProps {
  children: React.ReactNode;
}

export function ProtectedRoute({ children }: ProtectedRouteProps) {
  const navigate = useNavigate();

  useEffect(() => {
    // Check authentication status
    if (!isAuthenticated()) {
      // Redirect to login if not authenticated
      navigate({ to: '/login' });
    }
  }, [navigate]);

  // Only render children if authenticated
  if (!isAuthenticated()) {
    return null;
  }

  return <>{children}</>;
}
