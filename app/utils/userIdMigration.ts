import { hashEmailForUserId } from './encryption';

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

