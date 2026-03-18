import React, { useState, useEffect, useRef } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useAuth } from './AuthContext';
import { localDb, LocalMessage, LocalRoom } from './db';
import { useLiveQuery } from 'dexie-react-hooks';
import { collection, query, orderBy, onSnapshot, doc, setDoc, deleteDoc, getDoc } from 'firebase/firestore';
import { db } from './firebase';
import { encryptMessage, decryptMessage } from './crypto';
import { ArrowLeft, Send, Download, Shield, Clock, Info } from 'lucide-react';
import { format } from 'date-fns';

export default function ChatRoom() {
  const { roomId } = useParams<{ roomId: string }>();
  const { user, privateKey } = useAuth();
  const [newMessage, setNewMessage] = useState('');
  const [room, setRoom] = useState<LocalRoom | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  
  // Fetch local messages
  const messages = useLiveQuery(
    () => localDb.messages.where('roomId').equals(roomId || '').sortBy('timestamp'),
    [roomId]
  );

  useEffect(() => {
    if (!roomId) return;
    localDb.rooms.get(roomId).then(r => {
      if (r) setRoom(r);
    });
  }, [roomId]);

  // Listen for new messages in Firestore
  useEffect(() => {
    if (!roomId || !user || !room?.roomKey) return;

    const q = query(collection(db, `rooms/${roomId}/messages`), orderBy('timestamp', 'asc'));
    const unsubscribe = onSnapshot(q, async (snapshot) => {
      for (const change of snapshot.docChanges()) {
        if (change.type === 'added') {
          const msgData = change.doc.data();
          const msgId = change.doc.id;
          
          // Check if we already have it
          const localMsg = await localDb.messages.get(msgId);
          if (!localMsg) {
            try {
              // Decrypt message
              const decryptedText = await decryptMessage(msgData.ciphertext, msgData.iv, room.roomKey);
              
              // Save locally
              await localDb.messages.put({
                id: msgId,
                roomId: roomId,
                senderId: msgData.senderId,
                text: decryptedText,
                timestamp: msgData.timestamp,
                isSent: msgData.senderId === user.uid,
              });
              
              // Optional: Delete from Firestore to act as a pure relay
              // But if there are multiple members, we can't delete immediately.
              // We'll leave it in Firestore for now, and rely on a 30-day TTL or local cleanup.
            } catch (e) {
              console.error("Failed to decrypt message", e);
            }
          }
        }
      }
    });

    return () => unsubscribe();
  }, [roomId, user, room?.roomKey]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const handleSendMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newMessage.trim() || !roomId || !user || !room?.roomKey) return;

    const text = newMessage;
    setNewMessage('');
    
    const msgId = crypto.randomUUID();
    const timestamp = Date.now();
    
    // Save locally immediately (optimistic)
    await localDb.messages.put({
      id: msgId,
      roomId: roomId,
      senderId: user.uid,
      text: text,
      timestamp: timestamp,
      isSent: true,
    });

    try {
      // Encrypt and send to Firestore
      const { ciphertext, iv } = await encryptMessage(text, room.roomKey);
      
      await setDoc(doc(db, `rooms/${roomId}/messages/${msgId}`), {
        senderId: user.uid,
        ciphertext,
        iv,
        timestamp
      });
    } catch (error) {
      console.error("Failed to send message", error);
      // Handle offline/error state
    }
  };

  const handleExportChat = async () => {
    if (!messages || !room) return;
    
    let html = `
      <!DOCTYPE html>
      <html>
      <head>
        <title>Exported Chat: ${room.name}</title>
        <style>
          body { font-family: sans-serif; max-width: 800px; margin: 0 auto; padding: 20px; background: #f9fafb; }
          .message { margin-bottom: 15px; padding: 10px; border-radius: 8px; background: white; box-shadow: 0 1px 2px rgba(0,0,0,0.05); }
          .sender { font-weight: bold; color: #374151; margin-bottom: 4px; }
          .time { font-size: 0.8em; color: #9ca3af; }
          .text { color: #111827; white-space: pre-wrap; }
          .me { background: #eff6ff; border-left: 4px solid #3b82f6; }
          .header { border-bottom: 1px solid #e5e7eb; padding-bottom: 20px; margin-bottom: 20px; }
        </style>
      </head>
      <body>
        <div class="header">
          <h1>${room.name}</h1>
          <p>Exported on: ${new Date().toLocaleString()}</p>
          <p><em>End-to-End Encrypted Chat Log</em></p>
        </div>
    `;

    for (const msg of messages) {
      const isMe = msg.senderId === user?.uid;
      const senderName = isMe ? 'Me' : msg.senderId; // Could fetch real names
      const time = new Date(msg.timestamp).toLocaleString();
      
      html += `
        <div class="message ${isMe ? 'me' : ''}">
          <div class="sender">${senderName} <span class="time">${time}</span></div>
          <div class="text">${msg.text}</div>
        </div>
      `;
    }

    html += `</body></html>`;

    const blob = new Blob([html], { type: 'text/html' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `chat-export-${room.name.replace(/\s+/g, '-')}.html`;
    a.click();
    URL.revokeObjectURL(url);
  };

  if (!room) {
    return <div className="flex-1 flex items-center justify-center">Loading room...</div>;
  }

  return (
    <div className="flex flex-col h-screen bg-zinc-50 font-sans">
      {/* Header */}
      <header className="bg-white border-b border-zinc-200 px-4 py-3 flex items-center justify-between sticky top-0 z-10">
        <div className="flex items-center">
          <Link to="/" className="mr-4 p-2 hover:bg-zinc-100 rounded-full text-zinc-500 transition-colors">
            <ArrowLeft className="w-5 h-5" />
          </Link>
          <div>
            <h2 className="text-lg font-semibold text-zinc-900">{room.name}</h2>
            <div className="flex items-center text-xs text-emerald-600 mt-0.5">
              <Shield className="w-3 h-3 mr-1" />
              End-to-end encrypted
            </div>
          </div>
        </div>
        <div className="flex items-center space-x-2">
          <button 
            onClick={handleExportChat}
            className="p-2 hover:bg-zinc-100 rounded-full text-zinc-500 transition-colors"
            title="Export Chat"
          >
            <Download className="w-5 h-5" />
          </button>
          <button className="p-2 hover:bg-zinc-100 rounded-full text-zinc-500 transition-colors">
            <Info className="w-5 h-5" />
          </button>
        </div>
      </header>

      {/* Messages Area */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        <div className="text-center my-6">
          <span className="bg-zinc-100 text-zinc-500 text-xs px-3 py-1 rounded-full font-medium">
            Messages are stored locally and auto-delete after 30 days
          </span>
        </div>
        
        {messages?.map((msg, index) => {
          const isMe = msg.senderId === user?.uid;
          const showSender = index === 0 || messages[index - 1].senderId !== msg.senderId;
          
          return (
            <div key={msg.id} className={`flex flex-col ${isMe ? 'items-end' : 'items-start'}`}>
              {!isMe && showSender && (
                <span className="text-xs text-zinc-500 ml-2 mb-1">{msg.senderId.substring(0, 6)}...</span>
              )}
              <div 
                className={`max-w-[75%] px-4 py-2 rounded-2xl ${
                  isMe 
                    ? 'bg-zinc-900 text-white rounded-br-sm' 
                    : 'bg-white border border-zinc-200 text-zinc-900 rounded-bl-sm shadow-sm'
                }`}
              >
                <p className="whitespace-pre-wrap break-words text-sm">{msg.text}</p>
              </div>
              <span className="text-[10px] text-zinc-400 mt-1 mx-1 flex items-center">
                {format(msg.timestamp, 'h:mm a')}
                {isMe && <Clock className="w-3 h-3 ml-1 opacity-50" />}
              </span>
            </div>
          );
        })}
        <div ref={messagesEndRef} />
      </div>

      {/* Input Area */}
      <div className="p-4 bg-white border-t border-zinc-200">
        <form onSubmit={handleSendMessage} className="flex items-end space-x-2 max-w-4xl mx-auto">
          <div className="flex-1 bg-zinc-100 rounded-2xl border border-transparent focus-within:border-zinc-300 focus-within:bg-white transition-all">
            <textarea
              value={newMessage}
              onChange={(e) => setNewMessage(e.target.value)}
              placeholder="Message securely..."
              className="w-full bg-transparent border-none focus:ring-0 resize-none py-3 px-4 max-h-32 min-h-[44px] text-sm"
              rows={1}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  handleSendMessage(e);
                }
              }}
            />
          </div>
          <button 
            type="submit"
            disabled={!newMessage.trim()}
            className="p-3 bg-zinc-900 text-white rounded-full hover:bg-zinc-800 disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex-shrink-0"
          >
            <Send className="w-5 h-5" />
          </button>
        </form>
      </div>
    </div>
  );
}
