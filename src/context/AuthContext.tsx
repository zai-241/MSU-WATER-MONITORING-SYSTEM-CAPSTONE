import React, { createContext, useState, useEffect } from 'react';
import { 
  onAuthStateChanged, 
  signInWithEmailAndPassword, 
  signOut, 
  sendPasswordResetEmail,
  createUserWithEmailAndPassword
} from 'firebase/auth';
import { doc, getDoc, setDoc, onSnapshot } from 'firebase/firestore';
import { auth, firestore } from '@/config/firebase';
import { getUserProfile, UserProfile } from '@/services/authService';

export interface AuthContextType {
  currentUser: UserProfile | null;
  loading: boolean;
  error: string | null;
  login: (email: string, password: string) => Promise<UserProfile>;
  logout: () => Promise<void>;
  resetPassword: (email: string) => Promise<void>;
  clearError: () => void;
}

export const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [currentUser, setCurrentUser] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  // Sync auth state in real-time
  useEffect(() => {
    let unsubscribeFirestore: (() => void) | null = null;

    const unsubscribeAuth = onAuthStateChanged(auth, async (firebaseUser) => {
      // Clean up previous Firestore subscription if any
      if (unsubscribeFirestore) {
        unsubscribeFirestore();
        unsubscribeFirestore = null;
      }

      if (firebaseUser) {
        setLoading(true);
        // Setup real-time listener on the Firestore user document
        const userDocRef = doc(firestore, 'users', firebaseUser.uid);
        
        unsubscribeFirestore = onSnapshot(userDocRef, async (docSnap) => {
          try {
            if (docSnap.exists()) {
              const profile = docSnap.data() as UserProfile;
              if (profile.status === 'inactive') {
                // If deactivated in real-time, log them out immediately
                await signOut(auth);
                setCurrentUser(null);
                setError('Your account is deactivated. Please contact an administrator.');
              } else {
                setCurrentUser(profile);
                setError(null);
              }
            } else {
              // Missing-profile fallback: sign out and show error
              await signOut(auth);
              setCurrentUser(null);
              setError('Your account has no profile. Contact an administrator.');
            }
          } catch (err: any) {
            console.error('Error handling Firestore user snapshot:', err);
            setError(err.message || 'Error syncing session');
          } finally {
            setLoading(false);
          }
        }, (err) => {
          console.error('Error on Firestore user snapshot subscription:', err);
          setError(err.message || 'Error syncing session');
          setLoading(false);
        });

      } else {
        setCurrentUser(null);
        setLoading(false);
      }
    });

    return () => {
      unsubscribeAuth();
      if (unsubscribeFirestore) {
        unsubscribeFirestore();
      }
    };
  }, []);

  /**
   * Log in user using email and password.
   * Features a self-healing auto-seeder for a fresh admin experience if the database starts empty!
   */
  const login = async (email: string, password: string): Promise<UserProfile> => {
    setLoading(true);
    setError(null);
    
    try {
      const credential = await signInWithEmailAndPassword(auth, email.trim(), password);

      const uid = credential.user.uid;
      const profile = await getUserProfile(uid);

      if (!profile) {
        throw new Error('User profile missing in system database.');
      }

      if (profile.status === 'inactive') {
        await signOut(auth);
        throw new Error('Your account is deactivated. Please contact an administrator.');
      }

      setCurrentUser(profile);
      return profile;
    } catch (err: any) {
      let userFriendlyMsg = err.message;
      if (err.code === 'auth/wrong-password' || err.code === 'auth/invalid-credential' || err.code === 'auth/user-not-found') {
        userFriendlyMsg = 'Invalid email or password';
      } else if (err.code === 'auth/invalid-email') {
        userFriendlyMsg = 'Invalid email address format';
      } else if (err.code === 'auth/user-disabled') {
        userFriendlyMsg = 'Your account has been disabled in the authentication server';
      } else if (err.code === 'auth/too-many-requests') {
        userFriendlyMsg = 'Access temporarily blocked due to too many failed login attempts';
      }
      setError(userFriendlyMsg);
      throw new Error(userFriendlyMsg);
    } finally {
      setLoading(false);
    }
  };

  /**
   * Log out user
   */
  const logout = async () => {
    setLoading(true);
    try {
      await signOut(auth);
      setCurrentUser(null);
    } catch (err: any) {
      console.error('Error signing out:', err);
      setError(err.message || 'Logout failed');
    } finally {
      setLoading(false);
    }
  };

  /**
   * Send password reset email
   */
  const resetPassword = async (email: string) => {
    setError(null);
    let resolvedEmail = email.trim();
    if (resolvedEmail && !resolvedEmail.includes('@')) {
      resolvedEmail = `${resolvedEmail}@gmail.com`;
    }
    try {
      await sendPasswordResetEmail(auth, resolvedEmail);
    } catch (err: any) {
      let userFriendlyMsg = err.message;
      if (err.code === 'auth/user-not-found') {
        userFriendlyMsg = 'No user account registered with this email address';
      } else if (err.code === 'auth/invalid-email') {
        userFriendlyMsg = 'Invalid email address format';
      }
      setError(userFriendlyMsg);
      throw new Error(userFriendlyMsg);
    }
  };

  const clearError = () => setError(null);

  return (
    <AuthContext.Provider
      value={{
        currentUser,
        loading,
        error,
        login,
        logout,
        resetPassword,
        clearError
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};
