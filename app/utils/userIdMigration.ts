import { hashEmailForUserId } from './encryption';
import { prisma } from './prisma';

/**
 * Migration utility to handle user ID changes from plain email to hashed email
 * 
 * This helps migrate existing data when switching from plain-text email user IDs
 * to hashed user IDs.
 */

/**
 * Check if a user ID is in the old format (plain email) or new format (hashed)
 * 
 * @param userId - The user ID to check
 * @returns True if the ID appears to be a plain email (contains @), false if hashed
 */
export function isOldFormatUserId(userId: string): boolean {
  if (!userId) return false;
  // Old format: contains @ (email address)
  // New format: starts with "usr_" (hashed)
  return userId.includes('@') && !userId.startsWith('usr_');
}

/**
 * Convert an old format user ID (plain email) to new format (hashed)
 * 
 * @param oldUserId - The old user ID (plain email)
 * @returns The new hashed user ID
 */
export function convertOldUserIdToNew(oldUserId: string): string {
  if (!oldUserId) {
    throw new Error('User ID is required');
  }
  
  // If already in new format, return as-is
  if (!isOldFormatUserId(oldUserId)) {
    return oldUserId;
  }
  
  // Hash the email to get the new user ID
  return hashEmailForUserId(oldUserId);
}

/**
 * Migrate all journal entries for a user from old ID format to new format
 * 
 * @param oldUserId - The old user ID (plain email)
 * @param newUserId - The new user ID (hashed) - optional, will be calculated if not provided
 * @returns Number of entries migrated
 */
export async function migrateUserEntries(
  oldUserId: string, 
  newUserId?: string
): Promise<number> {
  if (!prisma) {
    throw new Error('Database not configured');
  }

  // Calculate new user ID if not provided
  const targetUserId = newUserId || convertOldUserIdToNew(oldUserId);

  // Don't migrate if already in new format
  if (!isOldFormatUserId(oldUserId)) {
    console.log(`[Migration] User ID ${oldUserId} is already in new format, skipping`);
    return 0;
  }

  // Find all entries with the old user ID
  const entries = await prisma.journalEntry.findMany({
    where: {
      userId: oldUserId,
    },
    select: {
      id: true,
    },
  });

  if (entries.length === 0) {
    console.log(`[Migration] No entries found for user ${oldUserId}`);
    return 0;
  }

  // Update all entries to use the new user ID
  const result = await prisma.journalEntry.updateMany({
    where: {
      userId: oldUserId,
    },
    data: {
      userId: targetUserId,
    },
  });

  console.log(`[Migration] Migrated ${result.count} entries from ${oldUserId} to ${targetUserId.substring(0, 20)}...`);
  return result.count;
}

/**
 * Migrate user preferences from old ID format to new format
 * 
 * @param oldUserId - The old user ID (plain email)
 * @param newUserId - The new user ID (hashed) - optional, will be calculated if not provided
 * @returns True if migration was successful
 */
export async function migrateUserPreferences(
  oldUserId: string,
  newUserId?: string
): Promise<boolean> {
  if (!prisma) {
    throw new Error('Database not configured');
  }

  // Calculate new user ID if not provided
  const targetUserId = newUserId || convertOldUserIdToNew(oldUserId);

  // Don't migrate if already in new format
  if (!isOldFormatUserId(oldUserId)) {
    console.log(`[Migration] User ID ${oldUserId} is already in new format, skipping`);
    return false;
  }

  // Check if preferences exist with old ID
  const oldPrefs = await prisma.userPreference.findUnique({
    where: {
      userId: oldUserId,
    },
  });

  if (!oldPrefs) {
    console.log(`[Migration] No preferences found for user ${oldUserId}`);
    return false;
  }

  // Check if preferences already exist with new ID
  const newPrefs = await prisma.userPreference.findUnique({
    where: {
      userId: targetUserId,
    },
  });

  if (newPrefs) {
    // Preferences already exist with new ID, delete old one
    await prisma.userPreference.delete({
      where: {
        userId: oldUserId,
      },
    });
    console.log(`[Migration] Deleted duplicate preferences for ${oldUserId} (new ID already exists)`);
  } else {
    // Update preferences to use new user ID
    await prisma.userPreference.update({
      where: {
        userId: oldUserId,
      },
      data: {
        userId: targetUserId,
      },
    });
    console.log(`[Migration] Migrated preferences from ${oldUserId} to ${targetUserId.substring(0, 20)}...`);
  }

  return true;
}

/**
 * Migrate all data for a user (entries + preferences)
 * Uses email to find old format entries in database
 * 
 * @param email - The user's email address
 * @param newUserId - The new hashed user ID (already calculated)
 * @returns Migration result with counts
 */
export async function migrateUserDataByEmail(
  email: string,
  newUserId: string
): Promise<{
  entriesMigrated: number;
  preferencesMigrated: boolean;
  newUserId: string;
}> {
  if (!prisma) {
    throw new Error('Database not configured');
  }

  // Normalize email (same as hash function does)
  const normalizedEmail = email.toLowerCase().trim().replace(/\s+/g, '');
  
  // Check if there are entries with the email as userId (old format)
  const oldEntries = await prisma.journalEntry.findMany({
    where: {
      userId: normalizedEmail,
    },
    select: {
      id: true,
    },
  });

  let entriesMigrated = 0;
  if (oldEntries.length > 0) {
    // Migrate entries from email format to hashed format
    const result = await prisma.journalEntry.updateMany({
      where: {
        userId: normalizedEmail,
      },
      data: {
        userId: newUserId,
      },
    });
    entriesMigrated = result.count;
    console.log(`[Migration] Migrated ${entriesMigrated} entries from ${normalizedEmail} to ${newUserId.substring(0, 20)}...`);
  }

  // Check and migrate preferences
  let preferencesMigrated = false;
  const oldPrefs = await prisma.userPreference.findUnique({
    where: {
      userId: normalizedEmail,
    },
  });

  if (oldPrefs) {
    // Check if preferences already exist with new ID
    const newPrefs = await prisma.userPreference.findUnique({
      where: {
        userId: newUserId,
      },
    });

    if (newPrefs) {
      // Delete old preferences if new ones exist
      await prisma.userPreference.delete({
        where: {
          userId: normalizedEmail,
        },
      });
      console.log(`[Migration] Deleted duplicate preferences for ${normalizedEmail} (new ID already exists)`);
    } else {
      // Update preferences to use new user ID
      await prisma.userPreference.update({
        where: {
          userId: normalizedEmail,
        },
        data: {
          userId: newUserId,
        },
      });
      console.log(`[Migration] Migrated preferences from ${normalizedEmail} to ${newUserId.substring(0, 20)}...`);
    }
    preferencesMigrated = true;
  }

  return {
    entriesMigrated,
    preferencesMigrated,
    newUserId,
  };
}

/**
 * Migrate all data for a user (entries + preferences)
 * 
 * @param oldUserId - The old user ID (plain email)
 * @returns Migration result with counts
 */
export async function migrateUserData(oldUserId: string): Promise<{
  entriesMigrated: number;
  preferencesMigrated: boolean;
  newUserId: string;
}> {
  const newUserId = convertOldUserIdToNew(oldUserId);
  
  const entriesMigrated = await migrateUserEntries(oldUserId, newUserId);
  const preferencesMigrated = await migrateUserPreferences(oldUserId, newUserId);

  return {
    entriesMigrated,
    preferencesMigrated,
    newUserId,
  };
}

/**
 * Get the current user ID, converting from old format if necessary
 * This is useful in API routes to handle both old and new formats
 * 
 * @param userId - The user ID from session (could be old or new format)
 * @returns The user ID in new format (hashed)
 */
export function normalizeUserId(userId: string): string {
  if (isOldFormatUserId(userId)) {
    // Convert old format to new format
    return convertOldUserIdToNew(userId);
  }
  return userId;
}

