import React, { useEffect } from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './AuthContext';
import Login from './Login';
import Dashboard from './Dashboard';
import ChatRoom from './ChatRoom';
import { localDb } from './db';
import { collectionGroup, query, where, getDocs, deleteDoc } from 'firebase/firestore';
import { db } from './firebase';

const PrivateRoute: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { user, loading } = useAuth();
  
  useEffect(() => {
    // Background cleanup job: Delete messages older than 30 days
    const cleanupOldMessages = async () => {
      if (!user) return;
      
      const thirtyDaysAgo = Date.now() - (30 * 24 * 60 * 60 * 1000);
      
      // 1. Cleanup Local IndexedDB
      try {
        const oldMessages = await localDb.messages
          .where('timestamp')
          .below(thirtyDaysAgo)
          .toArray();
          
        if (oldMessages.length > 0) {
          await localDb.messages.bulkDelete(oldMessages.map(m => m.id));
          console.log(`Cleaned up ${oldMessages.length} old local messages.`);
        }
      } catch (e) {
        console.error("Local cleanup failed", e);
      }
      
      // 2. Cleanup Firestore (Relay) - Delete messages sent by this user older than 30 days
      // Note: In a real production app, this would be handled by a Firestore TTL policy.
      try {
        const q = query(
          collectionGroup(db, 'messages'), 
          where('senderId', '==', user.uid),
          where('timestamp', '<', thirtyDaysAgo)
        );
        const snapshot = await getDocs(q);
        snapshot.forEach(async (docSnap) => {
          await deleteDoc(docSnap.ref);
        });
      } catch (e) {
        console.error("Firestore cleanup failed", e);
      }
    };
    
    cleanupOldMessages();
  }, [user]);

  if (loading) return <div className="min-h-screen flex items-center justify-center bg-zinc-50">Loading secure environment...</div>;
  return user ? <>{children}</> : <Navigate to="/login" />;
};

export default function App() {
  return (
    <AuthProvider>
      <Router>
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route path="/" element={<PrivateRoute><Dashboard /></PrivateRoute>} />
          <Route path="/room/:roomId" element={<PrivateRoute><ChatRoom /></PrivateRoute>} />
        </Routes>
      </Router>
    </AuthProvider>
  );
}
