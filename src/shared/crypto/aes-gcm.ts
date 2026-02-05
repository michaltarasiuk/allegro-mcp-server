import { base64UrlDecode, base64UrlEncode } from "../utils/base64.js";

const ALGORITHM = "AES-GCM";
const KEY_LENGTH = 256;
const IV_LENGTH = 12;
const TAG_LENGTH = 128;

async function deriveKey(secret: string) {
  const keyBytes = base64UrlDecode(secret);
  if (keyBytes.length !== 32) {
    throw new Error(
      `Invalid key length: expected 32 bytes, got ${keyBytes.length}`
    );
  }
  return await crypto.subtle.importKey(
    "raw",
    keyBytes,
    { name: ALGORITHM, length: KEY_LENGTH },
    false,
    ["encrypt", "decrypt"]
  );
}

export async function encrypt(plaintext: string, secret: string) {
  const key = await deriveKey(secret);
  const iv = crypto.getRandomValues(new Uint8Array(IV_LENGTH));
  const plaintextBytes = new TextEncoder().encode(plaintext);
  const ciphertext = await crypto.subtle.encrypt(
    { name: ALGORITHM, iv, tagLength: TAG_LENGTH },
    key,
    plaintextBytes
  );
  const combined = new Uint8Array(iv.length + ciphertext.byteLength);
  combined.set(iv, 0);
  combined.set(new Uint8Array(ciphertext), iv.length);
  return base64UrlEncode(combined);
}

export async function decrypt(ciphertext: string, secret: string) {
  const key = await deriveKey(secret);
  const combined = base64UrlDecode(ciphertext);
  if (combined.length < IV_LENGTH + 16) {
    throw new Error("Invalid ciphertext: too short");
  }
  const iv = combined.slice(0, IV_LENGTH);
  const encrypted = combined.slice(IV_LENGTH);
  const plaintextBytes = await crypto.subtle.decrypt(
    { name: ALGORITHM, iv, tagLength: TAG_LENGTH },
    key,
    encrypted
  );
  return new TextDecoder().decode(plaintextBytes);
}

export function generateKey() {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return base64UrlEncode(bytes);
}

export interface Encryptor {
  encrypt: (plaintext: string) => Promise<string>;
  decrypt: (ciphertext: string) => Promise<string>;
}

export function createEncryptor(secret: string) {
  return {
    encrypt: (plaintext: string) => encrypt(plaintext, secret),
    decrypt: (ciphertext: string) => decrypt(ciphertext, secret),
  };
}
