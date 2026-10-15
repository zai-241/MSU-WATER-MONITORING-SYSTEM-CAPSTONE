import React from 'react';
import { Navigate } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import AppLayout from '@/components/AppLayout';
import ErrorBoundary from '@/components/ErrorBoundary';
import { Droplet } from 'lucide-react';

interface ProtectedRouteProps {
  children: React.ReactNode;
  allowedRoles?: ('admin' | 'worker' | 'viewer')[];
}

export const ProtectedRoute: React.FC<ProtectedRouteProps> = ({ children, allowedRoles }) => {
  const { currentUser, loading } = useAuth();

  // Premium loading screen to prevent flash-redirects while Firebase restores user session
  if (loading) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center bg-background">
        <div className="flex flex-col items-center gap-4">
          <div className="relative flex h-16 w-16 items-center justify-center rounded-full bg-primary/10 border border-primary/20 animate-pulse">
            <Droplet className="h-8 w-8 text-primary animate-bounce" />
          </div>
          <h2 className="text-lg font-semibold text-primary">MSU Water System</h2>
          <p className="text-xs text-muted-foreground animate-pulse">Restoring secure session state...</p>
        </div>
      </div>
    );
  }

  // Redirect to login if user is not authenticated
  if (!currentUser) {
    return <Navigate to="/login" replace />;
  }

  // Redirect unauthorized users trying to access protected routes
  if (allowedRoles && !allowedRoles.includes(currentUser.role)) {
    console.warn(`Unauthorized access attempt by ${currentUser.email} (Role: ${currentUser.role}) to route.`);
    return <Navigate to="/dashboard" replace />;
  }

  // Session authenticated and authorized - mount layout and page
  return (
    <AppLayout>
      <ErrorBoundary>
        {children}
      </ErrorBoundary>
    </AppLayout>
  );
};
