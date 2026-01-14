import crypto from 'crypto';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12;
const AUTH_TAG_LENGTH = 16;

function getEncryptionKey(): Buffer {
  const secret = process.env.ENCRYPTION_SECRET;
  if (!secret || secret.length !== 64) {
    throw new Error('ENCRYPTION_SECRET must be 64 hex characters (32 bytes)');
  }
  return Buffer.from(secret, 'hex');
}

/**
 * Encrypts a password using AES-256-GCM
 * @param plaintext - The password to encrypt
 * @returns Encrypted string in format: {iv}:{encryptedData}:{authTag}
 */
export function encryptPassword(plaintext: string): string {
  const key = getEncryptionKey();
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);

  const encrypted = Buffer.concat([
    cipher.update(plaintext, 'utf8'),
    cipher.final()
  ]);

  const authTag = cipher.getAuthTag();

  return `${iv.toString('base64')}:${encrypted.toString('base64')}:${authTag.toString('base64')}`;
}

/**
 * Decrypts a password encrypted with encryptPassword
 * @param encrypted - Encrypted string in format: {iv}:{encryptedData}:{authTag}
 * @returns Decrypted password
 */
export function decryptPassword(encrypted: string): string {
  const key = getEncryptionKey();
  const [ivB64, encryptedB64, authTagB64] = encrypted.split(':');

  if (!ivB64 || !encryptedB64 || !authTagB64) {
    throw new Error('Invalid encrypted password format');
  }

  const iv = Buffer.from(ivB64, 'base64');
  const encryptedData = Buffer.from(encryptedB64, 'base64');
  const authTag = Buffer.from(authTagB64, 'base64');

  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);

  return decipher.update(encryptedData, undefined, 'utf8') + decipher.final('utf8');
}
