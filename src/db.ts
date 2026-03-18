import Dexie, { Table } from 'dexie';

export interface LocalMessage {
  id: string; // Firebase message ID or local UUID
  roomId: string;
  senderId: string;
  text: string;
  timestamp: number;
  isSent?: boolean;
}

export interface LocalRoom {
  id: string; // Firebase room ID
  name: string;
  isDirect: boolean;
  members: string[];
  roomKey?: CryptoKey; // Decrypted AES-GCM key
}

export interface LocalUser {
  id: string;
  username: string;
  email: string;
  publicKey: string; // JWK string
}

export interface LocalKey {
  id: string; // e.g., 'my-keys'
  privateKey: CryptoKey;
  publicKey: CryptoKey;
}

export class ChatDatabase extends Dexie {
  messages!: Table<LocalMessage, string>;
  rooms!: Table<LocalRoom, string>;
  users!: Table<LocalUser, string>;
  keys!: Table<LocalKey, string>;

  constructor() {
    super('PrivacyChatDB');
    this.version(1).stores({
      messages: 'id, roomId, timestamp',
      rooms: 'id',
      users: 'id',
      keys: 'id'
    });
  }
}

export const localDb = new ChatDatabase();
