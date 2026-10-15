import { useContext } from 'react';
import { AuthContext, AuthContextType } from '@/context/AuthContext';

/**
 * Access the global authentication and session state safely
 */
export const useAuth = (): AuthContextType => {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};
