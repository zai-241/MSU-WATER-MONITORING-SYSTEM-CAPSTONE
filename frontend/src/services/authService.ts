import { getApps, initializeApp } from 'firebase/app';
import { getAuth, createUserWithEmailAndPassword, signOut } from 'firebase/auth';
import { doc, getDoc, setDoc, updateDoc, deleteDoc, collection, getDocs } from 'firebase/firestore';
import { firebaseConfig, firestore } from '@/config/firebase';

// Helper to get secondary Auth instance for creating operators without signing out admin
const getSecondaryAuth = () => {
  const name = 'SecondaryApp';
  const apps = getApps();
  const existingApp = apps.find((app) => app.name === name);
  const app = existingApp || initializeApp(firebaseConfig, name);
  return getAuth(app);
};

export interface UserProfile {
  id: string;
  username: string;
  email: string;
  role: 'admin' | 'worker' | 'viewer';
  jobTitle: string;
  status: 'active' | 'inactive';
  createdAt: number;
}

/**
 * Fetch a user profile from Firestore by UID
 */
export async function getUserProfile(uid: string): Promise<UserProfile | null> {
  try {
    const docRef = doc(firestore, 'users', uid);
    const docSnap = await getDoc(docRef);
    if (docSnap.exists()) {
      return docSnap.data() as UserProfile;
    }
    return null;
  } catch (error) {
    console.error('Error fetching user profile:', error);
    throw error;
  }
}

/**
 * Register a new operator (worker or admin) using a secondary auth instance.
 * Creates the user in Firebase Auth and builds their profile in Firestore.
 */
export async function registerOperator(
  email: string,
  password: string,
  name: string,
  role: 'admin' | 'worker' | 'viewer',
  jobTitle: string
): Promise<UserProfile> {
  const secondaryAuth = getSecondaryAuth();
  try {
    // 1. Create user in Firebase Auth using the secondary app
    const userCredential = await createUserWithEmailAndPassword(secondaryAuth, email, password);
    const uid = userCredential.user.uid;

    // 2. Sign out secondary instance immediately to release state
    await signOut(secondaryAuth);

    // 3. Create user profile document in Firestore
    const profile: UserProfile = {
      id: uid,
      username: name,
      email: email,
      role: role,
      jobTitle: jobTitle,
      status: 'active',
      createdAt: Date.now(),
    };

    const docRef = doc(firestore, 'users', uid);
    await setDoc(docRef, profile);

    return profile;
  } catch (error) {
    console.error('Error registering operator:', error);
    throw error;
  }
}

/**
 * Update user profile in Firestore
 */
export async function updateUserProfile(uid: string, updates: Partial<UserProfile>): Promise<void> {
  try {
    const docRef = doc(firestore, 'users', uid);
    await updateDoc(docRef, updates);
  } catch (error) {
    console.error('Error updating user profile:', error);
    throw error;
  }
}

/**
 * Delete user profile from Firestore
 * Note: Actual Firebase Auth user deletion requires cloud function or admin SDK,
 * but in a client-only implementation, we disable them by updating status to 'inactive'
 * or deleting their profile document. We'll support profile document deletion here.
 */
export async function deleteUserProfile(uid: string): Promise<void> {
  try {
    const docRef = doc(firestore, 'users', uid);
    await deleteDoc(docRef);
  } catch (error) {
    console.error('Error deleting user profile:', error);
    throw error;
  }
}

/**
 * Seed initial default admin profile
 */
export async function seedInitialAdmin(uid: string, email: string): Promise<UserProfile> {
  try {
    const profile: UserProfile = {
      id: uid,
      username: 'Administrator',
      email: email,
      role: 'admin',
      jobTitle: 'System Administrator',
      status: 'active',
      createdAt: Date.now(),
    };

    const docRef = doc(firestore, 'users', uid);
    await setDoc(docRef, profile);
    return profile;
  } catch (error) {
    console.error('Error seeding initial admin profile:', error);
    throw error;
  }
}
