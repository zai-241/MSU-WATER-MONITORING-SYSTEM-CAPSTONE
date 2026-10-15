import React from 'react';
import { vi, describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { ProtectedRoute } from '@/routes/ProtectedRoute';
import * as authHooks from '@/hooks/useAuth';

vi.mock('@/components/AppLayout', () => ({
  default: ({ children }: { children: React.ReactNode }) =>
    React.createElement('div', { 'data-testid': 'app-layout' }, children),
}));

const renderWithRouter = (ui: React.ReactElement, initialEntries = ['/admin']) => {
  return render(
    React.createElement(
      MemoryRouter,
      { initialEntries },
      React.createElement(
        Routes,
        null,
        React.createElement(Route, {
          path: '/login',
          element: React.createElement('div', { 'data-testid': 'login-page' }, 'Login Page'),
        }),
        React.createElement(Route, {
          path: '/dashboard',
          element: React.createElement('div', { 'data-testid': 'dashboard-page' }, 'Dashboard Page'),
        }),
        React.createElement(Route, { path: '/admin', element: ui })
      )
    )
  );
};

describe('ProtectedRoute', () => {
  it('redirects unauthenticated users to /login', () => {
    vi.spyOn(authHooks, 'useAuth').mockReturnValue({
      currentUser: null,
      loading: false,
      error: null,
      login: vi.fn(),
      logout: vi.fn(),
      resetPassword: vi.fn(),
      clearError: vi.fn(),
    });

    renderWithRouter(
      React.createElement(ProtectedRoute, {
        allowedRoles: ['admin'],
        children: React.createElement('div', null, 'Admin Content'),
      })
    );

    expect(screen.getByTestId('login-page')).toBeInTheDocument();
    expect(screen.queryByText('Admin Content')).not.toBeInTheDocument();
  });

  it('redirects viewer from admin pages to /dashboard', () => {
    vi.spyOn(authHooks, 'useAuth').mockReturnValue({
      currentUser: {
        id: '1',
        username: 'ViewerUser',
        email: 'viewer@example.com',
        role: 'viewer',
        jobTitle: 'Viewer',
        status: 'active',
        createdAt: Date.now(),
      },
      loading: false,
      error: null,
      login: vi.fn(),
      logout: vi.fn(),
      resetPassword: vi.fn(),
      clearError: vi.fn(),
    });

    renderWithRouter(
      React.createElement(ProtectedRoute, {
        allowedRoles: ['admin'],
        children: React.createElement('div', null, 'Admin Content'),
      })
    );

    expect(screen.getByTestId('dashboard-page')).toBeInTheDocument();
    expect(screen.queryByText('Admin Content')).not.toBeInTheDocument();
  });

  it('redirects worker from admin pages to /dashboard', () => {
    vi.spyOn(authHooks, 'useAuth').mockReturnValue({
      currentUser: {
        id: '2',
        username: 'WorkerUser',
        email: 'worker@example.com',
        role: 'worker',
        jobTitle: 'Operator',
        status: 'active',
        createdAt: Date.now(),
      },
      loading: false,
      error: null,
      login: vi.fn(),
      logout: vi.fn(),
      resetPassword: vi.fn(),
      clearError: vi.fn(),
    });

    renderWithRouter(
      React.createElement(ProtectedRoute, {
        allowedRoles: ['admin'],
        children: React.createElement('div', null, 'Admin Content'),
      })
    );

    expect(screen.getByTestId('dashboard-page')).toBeInTheDocument();
    expect(screen.queryByText('Admin Content')).not.toBeInTheDocument();
  });

  it('allows admin access to admin pages', () => {
    vi.spyOn(authHooks, 'useAuth').mockReturnValue({
      currentUser: {
        id: '3',
        username: 'AdminUser',
        email: 'admin@example.com',
        role: 'admin',
        jobTitle: 'Administrator',
        status: 'active',
        createdAt: Date.now(),
      },
      loading: false,
      error: null,
      login: vi.fn(),
      logout: vi.fn(),
      resetPassword: vi.fn(),
      clearError: vi.fn(),
    });

    renderWithRouter(
      React.createElement(ProtectedRoute, {
        allowedRoles: ['admin'],
        children: React.createElement('div', null, 'Admin Content'),
      })
    );

    expect(screen.getByText('Admin Content')).toBeInTheDocument();
    expect(screen.queryByTestId('dashboard-page')).not.toBeInTheDocument();
  });

  it('does not grant admin access based on email when role is viewer (zailanorpundato@gmail.com)', () => {
    vi.spyOn(authHooks, 'useAuth').mockReturnValue({
      currentUser: {
        id: '4',
        username: 'ZailanorViewer',
        email: 'zailanorpundato@gmail.com',
        role: 'viewer',
        jobTitle: 'Viewer',
        status: 'active',
        createdAt: Date.now(),
      },
      loading: false,
      error: null,
      login: vi.fn(),
      logout: vi.fn(),
      resetPassword: vi.fn(),
      clearError: vi.fn(),
    });

    renderWithRouter(
      React.createElement(ProtectedRoute, {
        allowedRoles: ['admin'],
        children: React.createElement('div', null, 'Admin Content'),
      })
    );

    expect(screen.getByTestId('dashboard-page')).toBeInTheDocument();
    expect(screen.queryByText('Admin Content')).not.toBeInTheDocument();
  });

  it('does not grant admin access based on email when role is worker (admin@msu.edu)', () => {
    vi.spyOn(authHooks, 'useAuth').mockReturnValue({
      currentUser: {
        id: '5',
        username: 'MsuWorker',
        email: 'admin@msu.edu',
        role: 'worker',
        jobTitle: 'Worker',
        status: 'active',
        createdAt: Date.now(),
      },
      loading: false,
      error: null,
      login: vi.fn(),
      logout: vi.fn(),
      resetPassword: vi.fn(),
      clearError: vi.fn(),
    });

    renderWithRouter(
      React.createElement(ProtectedRoute, {
        allowedRoles: ['admin'],
        children: React.createElement('div', null, 'Admin Content'),
      })
    );

    expect(screen.getByTestId('dashboard-page')).toBeInTheDocument();
    expect(screen.queryByText('Admin Content')).not.toBeInTheDocument();
  });
});
