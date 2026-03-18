import React, { createContext, useContext, useEffect, useState } from 'react';
import { User, onAuthStateChanged } from 'firebase/auth';
import { doc, getDoc, setDoc } from 'firebase/firestore';
import { auth, db } from './firebase';
import { localDb } from './db';
import { generateECDHKeyPair, exportPublicKey } from './crypto';

interface AuthContextType {
  user: User | null;
  loading: boolean;
  privateKey: CryptoKey | null;
}

const AuthContext = createContext<AuthContextType>({ user: null, loading: true, privateKey: null });

export const useAuth = () => useContext(AuthContext);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [privateKey, setPrivateKey] = useState<CryptoKey | null>(null);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (firebaseUser) => {
      if (firebaseUser) {
        setUser(firebaseUser);
        
        // Check for local keys
        let localKey = await localDb.keys.get('my-keys');
        if (!localKey) {
          console.log('Generating new ECDH key pair...');
          const keyPair = await generateECDHKeyPair();
          const publicKeyJwk = await exportPublicKey(keyPair.publicKey);
          
          localKey = {
            id: 'my-keys',
            privateKey: keyPair.privateKey,
            publicKey: keyPair.publicKey,
          };
          await localDb.keys.put(localKey);
          
          // Save public key to Firestore
          await setDoc(doc(db, 'users', firebaseUser.uid), {
            username: firebaseUser.displayName || 'Anonymous',
            email: firebaseUser.email,
            publicKey: publicKeyJwk,
          }, { merge: true });
        } else {
          // Ensure public key is in Firestore (in case they cleared Firestore but kept IndexedDB)
          const userDoc = await getDoc(doc(db, 'users', firebaseUser.uid));
          if (!userDoc.exists()) {
            const publicKeyJwk = await exportPublicKey(localKey.publicKey);
            await setDoc(doc(db, 'users', firebaseUser.uid), {
              username: firebaseUser.displayName || 'Anonymous',
              email: firebaseUser.email,
              publicKey: publicKeyJwk,
            }, { merge: true });
          }
        }
        
        setPrivateKey(localKey.privateKey);
      } else {
        setUser(null);
        setPrivateKey(null);
      }
      setLoading(false);
    });

    return () => unsubscribe();
  }, []);

  return (
    <AuthContext.Provider value={{ user, loading, privateKey }}>
      {children}
    </AuthContext.Provider>
  );
};
