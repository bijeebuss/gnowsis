/**
 * ProtectedRoute Component
 * Task 8.6: Create protected route wrapper component
 *
 * Checks authentication against the server's httpOnly-cookie session
 * Redirects to /login if not authenticated
 * Renders children if authenticated
 * Used in dashboard, search, document viewer routes
 */

import React, { useEffect } from 'react';
import { useNavigate } from '@tanstack/react-router';

interface ProtectedRouteProps {
  children: React.ReactNode;
}

export function ProtectedRoute({ children }: ProtectedRouteProps) {
  const navigate = useNavigate();
  const [status, setStatus] = React.useState<'checking' | 'authenticated' | 'unauthenticated'>('checking');

  useEffect(() => {
    let cancelled = false;
    fetch('/api/auth/me', { credentials: 'include' })
      .then((response) => {
        if (cancelled) return;
        if (response.ok) setStatus('authenticated');
        else {
          setStatus('unauthenticated');
          navigate({ to: '/login' });
        }
      })
      .catch(() => {
        if (!cancelled) {
          setStatus('unauthenticated');
          navigate({ to: '/login' });
        }
      });
    return () => { cancelled = true; };
  }, [navigate]);

  // Only render children if authenticated
  if (status !== 'authenticated') {
    return null;
  }

  return <>{children}</>;
}
