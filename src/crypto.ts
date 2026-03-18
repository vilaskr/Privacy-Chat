// Utility functions for Web Crypto API

// Helper to convert ArrayBuffer to Base64 string
export function bufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

// Helper to convert Base64 string to ArrayBuffer
export function base64ToBuffer(base64: string): ArrayBuffer {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes.buffer;
}

// 1. Generate ECDH Key Pair
export async function generateECDHKeyPair(): Promise<CryptoKeyPair> {
  return await crypto.subtle.generateKey(
    {
      name: 'ECDH',
      namedCurve: 'P-256',
    },
    true, // extractable (needed for public key export, private key can be stored in IndexedDB)
    ['deriveKey', 'deriveBits']
  );
}

// 2. Export Public Key to JWK
export async function exportPublicKey(key: CryptoKey): Promise<string> {
  const jwk = await crypto.subtle.exportKey('jwk', key);
  return JSON.stringify(jwk);
}

// 3. Import Public Key from JWK
export async function importPublicKey(jwkString: string): Promise<CryptoKey> {
  const jwk = JSON.parse(jwkString);
  return await crypto.subtle.importKey(
    'jwk',
    jwk,
    {
      name: 'ECDH',
      namedCurve: 'P-256',
    },
    true,
    []
  );
}

// 4. Derive Shared AES-GCM Key
export async function deriveAESKey(privateKey: CryptoKey, publicKey: CryptoKey): Promise<CryptoKey> {
  return await crypto.subtle.deriveKey(
    {
      name: 'ECDH',
      public: publicKey,
    },
    privateKey,
    {
      name: 'AES-GCM',
      length: 256,
    },
    true, // extractable (needed for wrapKey/unwrapKey)
    ['encrypt', 'decrypt', 'wrapKey', 'unwrapKey']
  );
}

// 5. Generate Random AES-GCM Room Key
export async function generateRoomKey(): Promise<CryptoKey> {
  return await crypto.subtle.generateKey(
    {
      name: 'AES-GCM',
      length: 256,
    },
    true, // extractable
    ['encrypt', 'decrypt']
  );
}

// 6. Encrypt Room Key with Shared Key (Wrap Key)
export async function encryptRoomKey(roomKey: CryptoKey, sharedKey: CryptoKey): Promise<{ encryptedKey: string; iv: string }> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const wrappedKeyBuffer = await crypto.subtle.wrapKey(
    'raw',
    roomKey,
    sharedKey,
    {
      name: 'AES-GCM',
      iv: iv,
    }
  );
  return {
    encryptedKey: bufferToBase64(wrappedKeyBuffer),
    iv: bufferToBase64(iv),
  };
}

// 7. Decrypt Room Key with Shared Key (Unwrap Key)
export async function decryptRoomKey(encryptedKeyBase64: string, ivBase64: string, sharedKey: CryptoKey): Promise<CryptoKey> {
  const encryptedKeyBuffer = base64ToBuffer(encryptedKeyBase64);
  const iv = base64ToBuffer(ivBase64);
  return await crypto.subtle.unwrapKey(
    'raw',
    encryptedKeyBuffer,
    sharedKey,
    {
      name: 'AES-GCM',
      iv: iv,
    },
    {
      name: 'AES-GCM',
      length: 256,
    },
    true,
    ['encrypt', 'decrypt']
  );
}

// 8. Encrypt Message
export async function encryptMessage(text: string, roomKey: CryptoKey): Promise<{ ciphertext: string; iv: string }> {
  const encoder = new TextEncoder();
  const data = encoder.encode(text);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertextBuffer = await crypto.subtle.encrypt(
    {
      name: 'AES-GCM',
      iv: iv,
    },
    roomKey,
    data
  );
  return {
    ciphertext: bufferToBase64(ciphertextBuffer),
    iv: bufferToBase64(iv),
  };
}

// 9. Decrypt Message
export async function decryptMessage(ciphertextBase64: string, ivBase64: string, roomKey: CryptoKey): Promise<string> {
  const ciphertextBuffer = base64ToBuffer(ciphertextBase64);
  const iv = base64ToBuffer(ivBase64);
  const decryptedBuffer = await crypto.subtle.decrypt(
    {
      name: 'AES-GCM',
      iv: iv,
    },
    roomKey,
    ciphertextBuffer
  );
  const decoder = new TextDecoder();
  return decoder.decode(decryptedBuffer);
}
