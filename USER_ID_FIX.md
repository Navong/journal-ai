# User ID Hash Fix - Preventing Data Loss

## Problem

The user ID was changing every time a user logged in, causing data loss because the database couldn't recognize that it was the same user. This happened because:

1. The hash function depended on `ENCRYPTION_KEY` which might not be set or could change
2. There was no migration path for existing users with plain-text email IDs

## Solution

### 1. Fixed Deterministic Hashing

**File**: `app/utils/encryption.ts`

- Changed `hashEmailForUserId()` to use a **fixed application-level salt** instead of depending on `ENCRYPTION_KEY`
- The hash is now **truly deterministic** - same email ALWAYS produces same hash
- Added normalization to handle email format variations (whitespace, case)

```typescript
// Before: Depended on ENCRYPTION_KEY (could change)
const salt = crypto.createHash('sha256')
  .update(ENCRYPTION_KEY + normalizedEmail) // ❌ ENCRYPTION_KEY might change

// After: Uses fixed application salt (always the same)
const APPLICATION_SALT = 'serenity-journal-user-id-salt-v1';
const salt = crypto.createHash('sha256')
  .update(APPLICATION_SALT + normalizedEmail) // ✅ Always produces same hash
```

### 2. Automatic Migration

**File**: `app/utils/userIdMigration.ts` (new)

Created migration utilities that:
- Detect old format user IDs (plain emails like `user@gmail.com`)
- Automatically convert them to new format (hashed like `usr_abc123...`)
- Migrate all user data (journal entries + preferences) to the new ID
- Run automatically on first API call after login

**Files Updated**:
- `app/api/history/route.ts` - GET, POST, DELETE endpoints
- `app/api/preferences/route.ts` - GET, POST endpoints  
- `app/api/history/audio/route.ts` - GET, POST endpoints

### 3. How It Works

When a user logs in:

1. **Check ID Format**: System checks if user ID is old format (contains `@`) or new format (starts with `usr_`)

2. **Auto-Migrate**: If old format detected:
   - Calculate new hashed ID from the email
   - Find all entries with old ID
   - Update all entries to use new ID
   - Update preferences to use new ID
   - Log migration results

3. **Use New ID**: All subsequent operations use the new hashed ID

4. **One-Time Process**: Migration only happens once per user (when old format is detected)

## Testing

To verify the fix works:

1. **Check Hash Consistency**:
   ```typescript
   import { hashEmailForUserId } from '@/app/utils/encryption';
   
   const email = 'test@gmail.com';
   const hash1 = hashEmailForUserId(email);
   const hash2 = hashEmailForUserId(email);
   console.log(hash1 === hash2); // Should be true
   ```

2. **Test Migration**:
   - Login with an account that has old format ID
   - Check server logs for migration messages
   - Verify data is accessible after logout/login

3. **Verify Data Access**:
   - Login → Create entry → Logout → Login again
   - Entry should still be visible (same user ID)

## Important Notes

### ✅ What's Fixed

- **Deterministic Hashing**: Same email always produces same hash
- **No Data Loss**: Automatic migration preserves all user data
- **Backward Compatible**: Handles both old and new format IDs
- **One-Time Migration**: Runs automatically, no manual steps needed

### ⚠️ Important

- **First Login After Update**: Users with old format IDs will trigger migration on first API call
- **Migration is Automatic**: No manual intervention needed
- **Logs Available**: Check server logs to see migration progress
- **No Downtime**: Migration happens per-user on first access

### 🔒 Security

- User IDs are still hashed (not plain emails)
- Hash is deterministic but secure (uses SHA-256)
- Email addresses are not stored in plain text
- Migration preserves data ownership (only migrates user's own data)

## Migration Log Example

```
[NextAuth] User ID set: usr_a1b2c3d4e5f6... (from email: test***)
[Migration] Detected old format user ID, migrating data for: test***
[Migration] Migrated 15 entries from test@gmail.com to usr_a1b2c3d4e5f6...
[Migration] Migrated preferences from test@gmail.com to usr_a1b2c3d4e5f6...
[Migration] Migration complete: 15 entries, preferences: true
```

## Files Changed

1. `app/utils/encryption.ts` - Fixed hash function to be deterministic
2. `app/utils/userIdMigration.ts` - New migration utilities
3. `app/auth.ts` - Enhanced logging
4. `app/api/history/route.ts` - Added migration on all endpoints
5. `app/api/preferences/route.ts` - Added migration on all endpoints
6. `app/api/history/audio/route.ts` - Added migration on all endpoints

## Result

✅ **User IDs are now stable** - Same user always gets same ID  
✅ **No data loss** - Automatic migration preserves all data  
✅ **Backward compatible** - Handles existing users seamlessly  
✅ **Secure** - Still uses hashed IDs, not plain emails

