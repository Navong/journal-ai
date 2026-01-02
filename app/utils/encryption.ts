/**
 * Encryption utility for securing user data
 * 
 * This module provides functions to:
 * - Hash emails for use as user IDs (one-way, cannot be reversed) - Edge Runtime compatible
 * - Encrypt sensitive data that needs to be decrypted later - Node.js only
 */

// Lazy load Node.js crypto only when needed (not at module load time)
function getNodeCrypto() {
  if (typeof require !== 'undefined') {
    try {
      return require('crypto');
    } catch {
      return null;
    }
  }
  return null;
}

// Get encryption key from environment variable
// For production, use a strong 32-byte key (256-bit)
// Generate with: node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
const ENCRYPTION_KEY = process.env.ENCRYPTION_KEY || process.env.AUTH_SECRET || 'default-key-change-in-production';
const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 16; // 16 bytes for AES
const SALT_LENGTH = 64; // 64 bytes for better security
const TAG_LENGTH = 16; // 16 bytes for GCM tag

/**
 * Hash an email address to create a secure, non-reversible user ID
 * Uses SHA-256 with a deterministic salt to prevent rainbow table attacks
 * 
 * IMPORTANT: This function is deterministic - same email ALWAYS produces same hash
 * The hash does NOT depend on ENCRYPTION_KEY to ensure consistency
 * 
 * Edge Runtime compatible - uses Web Crypto API
 * 
 * @param email - The email address to hash
 * @returns A hashed string that can be used as a user ID
 */
export async function hashEmailForUserIdAsync(email: string): Promise<string> {
  if (!email) {
    throw new Error('Email is required for hashing');
  }

  // Normalize email (lowercase, trim, remove any whitespace)
  // This ensures consistent hashing regardless of input format
  const normalizedEmail = email.toLowerCase().trim().replace(/\s+/g, '');

  // Use a fixed application-level salt (not dependent on ENCRYPTION_KEY)
  // This ensures the hash is always the same for the same email
  const APPLICATION_SALT = 'serenity-journal-user-id-salt-v1';

  // Use Web Crypto API (available in both Edge and Node.js)
  const encoder = new TextEncoder();
  const data = encoder.encode(normalizedEmail + APPLICATION_SALT);
  
  // Hash using Web Crypto API
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  const hash = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');

  // Return a prefixed hash for easy identification
  const userId = `usr_${hash}`;
  
  // Log in development to help debug (only first 10 chars of hash)
  if (process.env.NODE_ENV === 'development') {
    console.log(`[hashEmailForUserId] Email: ${normalizedEmail.substring(0, 5)}*** -> UserID: ${userId.substring(0, 15)}...`);
  }
  
  return userId;
}

/**
 * Synchronous version using Node.js crypto (for Node.js runtime only)
 * Falls back to async version in Edge Runtime
 */
export function hashEmailForUserId(email: string): string {
  if (!email) {
    throw new Error('Email is required for hashing');
  }

  // Normalize email (lowercase, trim, remove any whitespace)
  const normalizedEmail = email.toLowerCase().trim().replace(/\s+/g, '');

  // Use a fixed application-level salt
  const APPLICATION_SALT = 'serenity-journal-user-id-salt-v1';

  // Try to use Node.js crypto if available (synchronous)
  // Only load at runtime, not at module load time (avoids Edge Runtime issues)
  const nodeCrypto = getNodeCrypto();
  if (nodeCrypto) {
    try {
      const salt = nodeCrypto
        .createHash('sha256')
        .update(APPLICATION_SALT + normalizedEmail)
        .digest('hex')
        .substring(0, SALT_LENGTH);

      const hash = nodeCrypto
        .createHash('sha256')
        .update(normalizedEmail + salt)
        .digest('hex');

      const userId = `usr_${hash}`;
      
      if (process.env.NODE_ENV === 'development') {
        console.log(`[hashEmailForUserId] Email: ${normalizedEmail.substring(0, 5)}*** -> UserID: ${userId.substring(0, 15)}...`);
      }
      
      return userId;
    } catch (error) {
      // Fall through to error
    }
  }

  // For Edge Runtime, we need to use async version
  // This is a fallback - in practice, callers in Edge should use hashEmailForUserIdAsync
  // But we provide a sync wrapper that throws to make the issue obvious
  throw new Error('hashEmailForUserId requires Node.js crypto or use hashEmailForUserIdAsync in Edge Runtime');
}

/**
 * Encrypt sensitive data that needs to be decrypted later
 * Uses AES-256-GCM for authenticated encryption
 * 
 * @param text - The plaintext to encrypt
 * @returns Encrypted string in format: iv:tag:encryptedData
 */
export function encrypt(text: string): string {
  if (!text) {
    return text;
  }

  try {
    // Only works in Node.js runtime (not Edge)
    const nodeCrypto = getNodeCrypto();
    if (!nodeCrypto) {
      throw new Error('encrypt() requires Node.js runtime');
    }

    // Derive a 32-byte key from the encryption key
    const key = nodeCrypto
      .createHash('sha256')
      .update(ENCRYPTION_KEY)
      .digest();

    // Generate a random IV for each encryption
    const iv = nodeCrypto.randomBytes(IV_LENGTH);

    // Create cipher
    const cipher = nodeCrypto.createCipheriv(ALGORITHM, key, iv);

    // Encrypt
    let encrypted = cipher.update(text, 'utf8', 'hex');
    encrypted += cipher.final('hex');

    // Get authentication tag
    const tag = cipher.getAuthTag();

    // Return format: iv:tag:encryptedData
    return `${iv.toString('hex')}:${tag.toString('hex')}:${encrypted}`;
  } catch (error) {
    console.error('[Encryption] Failed to encrypt data:', error);
    throw new Error('Encryption failed');
  }
}

/**
 * Decrypt data that was encrypted with encrypt()
 * 
 * @param encryptedText - The encrypted string in format: iv:tag:encryptedData
 * @returns The decrypted plaintext
 */
export function decrypt(encryptedText: string): string {
  if (!encryptedText) {
    return encryptedText;
  }

  try {
    // Only works in Node.js runtime (not Edge)
    const nodeCrypto = getNodeCrypto();
    if (!nodeCrypto) {
      throw new Error('decrypt() requires Node.js runtime');
    }

    // Derive the same key used for encryption
    const key = nodeCrypto
      .createHash('sha256')
      .update(ENCRYPTION_KEY)
      .digest();

    // Split the encrypted string
    const parts = encryptedText.split(':');
    if (parts.length !== 3) {
      throw new Error('Invalid encrypted data format');
    }

    const [ivHex, tagHex, encrypted] = parts;

    // Convert hex strings back to buffers
    const iv = Buffer.from(ivHex, 'hex');
    const tag = Buffer.from(tagHex, 'hex');

    // Create decipher
    const decipher = nodeCrypto.createDecipheriv(ALGORITHM, key, iv);
    decipher.setAuthTag(tag);

    // Decrypt
    let decrypted = decipher.update(encrypted, 'hex', 'utf8');
    decrypted += decipher.final('utf8');

    return decrypted;
  } catch (error) {
    console.error('[Encryption] Failed to decrypt data:', error);
    throw new Error('Decryption failed - data may be corrupted or key may be incorrect');
  }
}

/**
 * Check if a string is encrypted (has the expected format)
 * 
 * @param text - The string to check
 * @returns True if the string appears to be encrypted
 */
export function isEncrypted(text: string): boolean {
  if (!text) {
    return false;
  }
  // Check if it matches the format: iv:tag:encryptedData
  const parts = text.split(':');
  return parts.length === 3 && parts[0].length === IV_LENGTH * 2 && parts[1].length === TAG_LENGTH * 2;
}

/**
 * Safely encrypt a value only if it's not already encrypted
 * Useful for migration scenarios
 * 
 * @param value - The value to encrypt
 * @returns Encrypted value, or original if already encrypted
 */
export function safeEncrypt(value: string | null | undefined): string | null | undefined {
  if (!value) {
    return value;
  }
  if (isEncrypted(value)) {
    return value; // Already encrypted
  }
  return encrypt(value);
}

/**
 * Safely decrypt a value only if it's encrypted
 * Returns original value if not encrypted (for backward compatibility)
 * 
 * @param value - The value to decrypt
 * @returns Decrypted value, or original if not encrypted
 */
export function safeDecrypt(value: string | null | undefined): string | null | undefined {
  if (!value) {
    return value;
  }
  if (!isEncrypted(value)) {
    return value; // Not encrypted, return as-is (backward compatibility)
  }
  try {
    return decrypt(value);
  } catch (error) {
    console.error('[Encryption] Failed to decrypt, returning original value:', error);
    return value; // Return original on error
  }
}

