import React, { useState, useEffect } from 'react';
import { useAuth } from './AuthContext';
import { localDb, LocalRoom } from './db';
import { useLiveQuery } from 'dexie-react-hooks';
import { collection, query, where, onSnapshot, getDocs, doc, setDoc, getDoc } from 'firebase/firestore';
import { db } from './firebase';
import { Link, useNavigate } from 'react-router-dom';
import { MessageSquare, Plus, Search, Settings, User, LogOut } from 'lucide-react';
import { auth } from './firebase';
import { generateRoomKey, encryptRoomKey, importPublicKey, exportPublicKey } from './crypto';

export default function Dashboard() {
  const { user, privateKey } = useAuth();
  const navigate = useNavigate();
  const [isCreatingRoom, setIsCreatingRoom] = useState(false);
  const [newRoomName, setNewRoomName] = useState('');
  const [newRoomMembers, setNewRoomMembers] = useState(''); // Comma separated emails
  
  // Fetch rooms from local IndexedDB
  const rooms = useLiveQuery(() => localDb.rooms.toArray(), []);

  // Listen to Firestore for new rooms we are a member of
  useEffect(() => {
    if (!user || !privateKey) return;

    const q = query(collection(db, 'rooms'), where('members', 'array-contains', user.uid));
    const unsubscribe = onSnapshot(q, async (snapshot) => {
      for (const change of snapshot.docChanges()) {
        if (change.type === 'added' || change.type === 'modified') {
          const roomData = change.doc.data();
          const roomId = change.doc.id;
          
          // Check if we already have this room locally
          const localRoom = await localDb.rooms.get(roomId);
          if (!localRoom || !localRoom.roomKey) {
            // We need to fetch our encrypted key and decrypt it
            const keyDoc = await getDoc(doc(db, `rooms/${roomId}/keys/${user.uid}`));
            if (keyDoc.exists()) {
              const { encryptedKey, iv } = keyDoc.data();
              // To decrypt, we need the creator's public key
              // Wait, the room key is encrypted with the shared key between Creator and Member.
              // So we need the creator's public key.
              const creatorDoc = await getDoc(doc(db, 'users', roomData.creatorId));
              if (creatorDoc.exists()) {
                const creatorPublicKeyJwk = creatorDoc.data().publicKey;
                const creatorPublicKey = await importPublicKey(creatorPublicKeyJwk);
                
                // Derive shared key
                const { deriveAESKey, decryptRoomKey } = await import('./crypto');
                const sharedKey = await deriveAESKey(privateKey, creatorPublicKey);
                
                // Decrypt room key
                try {
                  const roomKey = await decryptRoomKey(encryptedKey, iv, sharedKey);
                  
                  // Save to IndexedDB
                  await localDb.rooms.put({
                    id: roomId,
                    name: roomData.name,
                    isDirect: roomData.isDirect,
                    members: roomData.members,
                    roomKey: roomKey
                  });
                } catch (e) {
                  console.error("Failed to decrypt room key", e);
                }
              }
            }
          }
        }
      }
    });

    return () => unsubscribe();
  }, [user, privateKey]);

  const handleCreateRoom = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user || !privateKey) return;

    // 1. Find members by email
    const emails = newRoomMembers.split(',').map(e => e.trim()).filter(e => e);
    const memberUids = [user.uid];
    const memberPublicKeys: Record<string, CryptoKey> = {};

    for (const email of emails) {
      const q = query(collection(db, 'users'), where('email', '==', email));
      const snap = await getDocs(q);
      if (!snap.empty) {
        const memberDoc = snap.docs[0];
        memberUids.push(memberDoc.id);
        memberPublicKeys[memberDoc.id] = await importPublicKey(memberDoc.data().publicKey);
      }
    }

    // 2. Generate Room Key
    const roomKey = await generateRoomKey();
    const roomId = crypto.randomUUID();

    // 3. Save Room to Firestore
    await setDoc(doc(db, 'rooms', roomId), {
      name: newRoomName || 'New Chat',
      creatorId: user.uid,
      isDirect: memberUids.length === 2,
      members: memberUids
    });

    // 4. Encrypt Room Key for each member
    const { deriveAESKey } = await import('./crypto');
    
    // For the creator (self)
    // We can just encrypt it with a shared key derived from our own private + public key
    // Or we can just store it locally and not put it in Firestore for ourselves?
    // Actually, if we use multiple devices, we need it in Firestore.
    // Let's derive shared key with ourselves.
    const myDoc = await getDoc(doc(db, 'users', user.uid));
    const myPublicKey = await importPublicKey(myDoc.data()!.publicKey);
    const mySharedKey = await deriveAESKey(privateKey, myPublicKey);
    const myEncrypted = await encryptRoomKey(roomKey, mySharedKey);
    await setDoc(doc(db, `rooms/${roomId}/keys/${user.uid}`), myEncrypted);

    // For other members
    for (const uid of memberUids) {
      if (uid === user.uid) continue;
      const sharedKey = await deriveAESKey(privateKey, memberPublicKeys[uid]);
      const encrypted = await encryptRoomKey(roomKey, sharedKey);
      await setDoc(doc(db, `rooms/${roomId}/keys/${uid}`), encrypted);
    }

    // 5. Save locally
    await localDb.rooms.put({
      id: roomId,
      name: newRoomName || 'New Chat',
      isDirect: memberUids.length === 2,
      members: memberUids,
      roomKey: roomKey
    });

    setIsCreatingRoom(false);
    setNewRoomName('');
    setNewRoomMembers('');
    navigate(`/room/${roomId}`);
  };

  return (
    <div className="flex h-screen bg-zinc-50 font-sans">
      {/* Sidebar */}
      <div className="w-80 border-r border-zinc-200 bg-white flex flex-col">
        <div className="p-4 border-b border-zinc-200 flex justify-between items-center">
          <h1 className="text-xl font-semibold text-zinc-800">Chats</h1>
          <button 
            onClick={() => setIsCreatingRoom(true)}
            className="p-2 hover:bg-zinc-100 rounded-full transition-colors"
          >
            <Plus className="w-5 h-5 text-zinc-600" />
          </button>
        </div>
        
        <div className="p-4">
          <div className="relative">
            <Search className="w-4 h-4 absolute left-3 top-3 text-zinc-400" />
            <input 
              type="text" 
              placeholder="Search chats..." 
              className="w-full pl-9 pr-4 py-2 bg-zinc-100 border-transparent rounded-lg text-sm focus:bg-white focus:border-zinc-300 focus:ring-0 transition-all"
            />
          </div>
        </div>

        <div className="flex-1 overflow-y-auto">
          {rooms?.map(room => (
            <Link 
              key={room.id} 
              to={`/room/${room.id}`}
              className="flex items-center px-4 py-3 hover:bg-zinc-50 cursor-pointer border-b border-zinc-100"
            >
              <div className="w-10 h-10 bg-zinc-200 rounded-full flex items-center justify-center mr-3">
                {room.isDirect ? <User className="w-5 h-5 text-zinc-500" /> : <MessageSquare className="w-5 h-5 text-zinc-500" />}
              </div>
              <div className="flex-1 min-w-0">
                <h3 className="text-sm font-medium text-zinc-900 truncate">{room.name}</h3>
                <p className="text-xs text-zinc-500 truncate">Encrypted chat</p>
              </div>
            </Link>
          ))}
          {rooms?.length === 0 && (
            <div className="p-8 text-center text-zinc-500 text-sm">
              No chats yet. Create one to start messaging securely.
            </div>
          )}
        </div>

        <div className="p-4 border-t border-zinc-200 flex items-center justify-between">
          <div className="flex items-center">
            <div className="w-8 h-8 bg-zinc-800 rounded-full flex items-center justify-center text-white font-medium text-sm mr-2">
              {user?.email?.[0].toUpperCase()}
            </div>
            <div className="text-sm font-medium text-zinc-700 truncate w-32">
              {user?.displayName || user?.email}
            </div>
          </div>
          <button onClick={() => auth.signOut()} className="p-2 hover:bg-zinc-100 rounded-full text-zinc-500">
            <LogOut className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Main Content Area */}
      <div className="flex-1 flex flex-col bg-zinc-50">
        {isCreatingRoom ? (
          <div className="flex-1 flex items-center justify-center p-8">
            <div className="bg-white p-8 rounded-2xl shadow-sm border border-zinc-200 w-full max-w-md">
              <h2 className="text-2xl font-semibold text-zinc-800 mb-6">New Chat</h2>
              <form onSubmit={handleCreateRoom} className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-zinc-700 mb-1">Chat Name</label>
                  <input 
                    type="text" 
                    required
                    value={newRoomName}
                    onChange={e => setNewRoomName(e.target.value)}
                    className="w-full px-3 py-2 border border-zinc-300 rounded-lg focus:ring-zinc-500 focus:border-zinc-500"
                    placeholder="e.g. Project Alpha"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-zinc-700 mb-1">Invite Members (Emails)</label>
                  <input 
                    type="text" 
                    required
                    value={newRoomMembers}
                    onChange={e => setNewRoomMembers(e.target.value)}
                    className="w-full px-3 py-2 border border-zinc-300 rounded-lg focus:ring-zinc-500 focus:border-zinc-500"
                    placeholder="alice@example.com, bob@example.com"
                  />
                </div>
                <div className="flex justify-end space-x-3 pt-4">
                  <button 
                    type="button"
                    onClick={() => setIsCreatingRoom(false)}
                    className="px-4 py-2 text-sm font-medium text-zinc-600 hover:text-zinc-800"
                  >
                    Cancel
                  </button>
                  <button 
                    type="submit"
                    className="px-4 py-2 text-sm font-medium text-white bg-zinc-900 rounded-lg hover:bg-zinc-800"
                  >
                    Create Secure Chat
                  </button>
                </div>
              </form>
            </div>
          </div>
        ) : (
          <div className="flex-1 flex items-center justify-center text-zinc-400 flex-col">
            <MessageSquare className="w-16 h-16 mb-4 opacity-20" />
            <p>Select a chat or create a new one</p>
            <p className="text-xs mt-2 opacity-60">All messages are end-to-end encrypted</p>
          </div>
        )}
      </div>
    </div>
  );
}
