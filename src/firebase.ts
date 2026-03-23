import { initializeApp } from 'firebase/app';
import { getAuth, GoogleAuthProvider, signInWithPopup, signOut, onAuthStateChanged, User } from 'firebase/auth';
import { getFirestore, doc, setDoc, getDoc, collection, addDoc, onSnapshot, query, where, orderBy, limit, getDocFromServer, Timestamp } from 'firebase/firestore';

// Use environment variables for configuration to avoid exposing secrets in source code
const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
  firestoreDatabaseId: import.meta.env.VITE_FIREBASE_FIRESTORE_DATABASE_ID,
};

// Validate that the configuration is present
if (!firebaseConfig.apiKey) {
  console.error("Firebase API Key is missing. Please add VITE_FIREBASE_API_KEY to your Secrets in AI Studio or GitHub Secrets.");
}

// Initialize Firebase SDK
let app;
try {
  app = initializeApp(firebaseConfig);
} catch (error) {
  console.error("Failed to initialize Firebase:", error);
  // Create a dummy app object to prevent crashes, though features will be disabled
  app = { name: '[DEFAULT]', options: {}, automaticDataCollectionEnabled: false };
}

let db;
let auth;
try {
  db = getFirestore(app, firebaseConfig.firestoreDatabaseId);
  auth = getAuth(app);
} catch (error) {
  console.error("Failed to initialize Firestore or Auth:", error);
  // Create dummy objects to prevent crashes
  db = {} as any;
  auth = { onAuthStateChanged: () => () => {} } as any;
}

export { db, auth };
export const googleProvider = new GoogleAuthProvider();

// Auth Helpers
export const signIn = () => signInWithPopup(auth, googleProvider);
export const logOut = () => signOut(auth);

// Firestore Helpers
export enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

export interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId: string | undefined;
    email: string | null | undefined;
    emailVerified: boolean | undefined;
    isAnonymous: boolean | undefined;
    tenantId: string | null | undefined;
    providerInfo: {
      providerId: string;
      displayName: string | null;
      email: string | null;
      photoUrl: string | null;
    }[];
  }
}

export function handleFirestoreError(error: unknown, operationType: OperationType, path: string | null) {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
      isAnonymous: auth.currentUser?.isAnonymous,
      tenantId: auth.currentUser?.tenantId,
      providerInfo: auth.currentUser?.providerData.map(provider => ({
        providerId: provider.providerId,
        displayName: provider.displayName,
        email: provider.email,
        photoUrl: provider.photoURL
      })) || []
    },
    operationType,
    path
  }
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

// Connection test
async function testConnection() {
  try {
    await getDocFromServer(doc(db, 'test', 'connection'));
  } catch (error) {
    if(error instanceof Error && error.message.includes('the client is offline')) {
      console.error("Please check your Firebase configuration.");
    }
  }
}
testConnection();
