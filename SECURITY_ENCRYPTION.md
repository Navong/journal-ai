# Security & Encryption Guide

## Overview

This project implements encryption for sensitive user data, particularly email addresses, to protect user privacy and comply with security best practices.

## What is Encrypted

### User IDs (Hashed)
- **Location**: `app/auth.ts`
- **Method**: One-way SHA-256 hashing
- **Purpose**: User IDs stored in the database are hashed versions of email addresses, preventing plain-text email storage
- **Function**: `hashEmailForUserId()` from `app/utils/encryption.ts`

### Email Addresses (Encrypted)
- **Location**: Database `User` model (if applicable)
- **Method**: AES-256-GCM encryption
- **Purpose**: If email addresses need to be stored and retrieved, they are encrypted
- **Functions**: `encrypt()` and `decrypt()` from `app/utils/encryption.ts`

## Environment Variables

### Required: `ENCRYPTION_KEY`

**IMPORTANT**: You must set a strong encryption key in production!

```bash
# Generate a secure 32-byte (256-bit) key:
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"

# Add to your .env file:
ENCRYPTION_KEY=your-generated-key-here
```

**Security Notes**:
- Never commit the encryption key to version control
- Use different keys for development and production
- Store the key securely (environment variables, secret management service)
- If the key is lost, encrypted data cannot be decrypted
- If the key is changed, existing encrypted data will become unreadable

### Fallback Behavior

If `ENCRYPTION_KEY` is not set, the system will:
1. First try to use `AUTH_SECRET` as a fallback
2. If neither is set, use a default key (⚠️ **NOT SECURE FOR PRODUCTION**)

## Implementation Details

### User ID Hashing

User IDs are created by hashing email addresses:

```typescript
import { hashEmailForUserId } from '@/app/utils/encryption';

// In auth.ts
token.id = hashEmailForUserId(user.email);
// Result: "usr_a1b2c3d4e5f6..." (64 character hash)
```

**Properties**:
- Deterministic: Same email always produces same hash
- One-way: Cannot reverse hash to get original email
- Salted: Uses encryption key + email for salt generation

### Email Encryption

If emails need to be stored and retrieved:

```typescript
import { encrypt, decrypt, safeEncrypt, safeDecrypt } from '@/app/utils/encryption';

// Encrypt before storing
const encryptedEmail = encrypt(userEmail);

// Decrypt when reading
const decryptedEmail = decrypt(encryptedEmail);

// Safe functions handle already-encrypted data
const safe = safeEncrypt(email); // Won't double-encrypt
const original = safeDecrypt(encrypted); // Handles unencrypted data
```

## Migration from Plain Text

If you have existing data with plain-text emails:

1. **For User IDs**: The system will automatically hash new logins. Existing user IDs in the database will need to be migrated.

2. **For Encrypted Emails**: Use `safeEncrypt()` which detects if data is already encrypted and won't double-encrypt.

## Security Best Practices

1. ✅ **Always set `ENCRYPTION_KEY` in production**
2. ✅ **Use strong, randomly generated keys**
3. ✅ **Never log encrypted or hashed values**
4. ✅ **Rotate keys periodically (requires re-encryption)**
5. ✅ **Backup encryption keys securely**
6. ✅ **Use environment-specific keys**

## Troubleshooting

### "Encryption failed" error
- Check that `ENCRYPTION_KEY` is set
- Verify the key hasn't changed since data was encrypted
- Ensure the key is the correct length (64 hex characters = 32 bytes)

### "Decryption failed" error
- Data may be corrupted
- Encryption key may have changed
- Data may not be encrypted (use `safeDecrypt()` for backward compatibility)

### User IDs don't match after update
- This is expected! Old plain-text emails will have different IDs than new hashed ones
- Users may need to re-authenticate
- Consider a migration script to update existing user IDs

## Files Modified

- `app/utils/encryption.ts` - Encryption utility functions
- `app/auth.ts` - Updated to use hashed user IDs
- Database queries - Automatically use hashed IDs from session

