// models/Entry.ts
// Journal entry model

import mongoose, { Schema, models, Model } from 'mongoose';

/**
 * Mood Type
 * Same as before - simple enum
 */
export type Mood = 'calm' | 'joyful' | 'anxious' | 'tired' | 'reflective' | 'heavy';

/**
 * Entry Interface (TypeScript)
 * Defines the shape of an Entry document
 */
export interface IEntry {
  _id: string;
  userId: string; // Reference to User._id
  entryText: string;
  reflectionText?: string;
  mood?: Mood;
  audioKey?: string; // S3 key or cloud storage path
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Entry Schema (Mongoose)
 *
 * Why this structure?
 * - userId: Links entry to user (1-to-many relationship)
 * - entryText: User's journal entry (required)
 * - reflectionText: AI-generated reflection (optional, added later)
 * - mood: Emotional state (optional)
 * - audioKey: Path to audio file in S3 (optional)
 */
const EntrySchema = new Schema<IEntry>(
  {
    userId: {
      type: String,
      required: true,
      index: true, // Index for fast user queries
    },
    entryText: {
      type: String,
      required: true,
    },
    reflectionText: {
      type: String,
      required: false,
    },
    mood: {
      type: String,
      enum: ['calm', 'joyful', 'anxious', 'tired', 'reflective', 'heavy'],
      required: false,
    },
    audioKey: {
      type: String,
      required: false,
    },
  },
  {
    timestamps: true, // Adds createdAt and updatedAt
  }
);

/**
 * Indexes for performance
 *
 * Compound index on [userId, createdAt]
 * - Fast queries: "Get user's entries, sorted by date"
 * - Most common query pattern
 * - -1 means descending (newest first)
 */
EntrySchema.index({ userId: 1, createdAt: -1 });

/**
 * Single field index on audioKey
 * - Fast lookups when fetching audio
 */
EntrySchema.index({ audioKey: 1 });

/**
 * Create or retrieve Entry model
 */
const Entry: Model<IEntry> = models.Entry || mongoose.model<IEntry>('Entry', EntrySchema);

export default Entry;

/**
 * Usage examples:
 *
 * // Create entry
 * const entry = await Entry.create({
 *   userId: user._id,
 *   entryText: 'Today was a great day!',
 *   mood: 'joyful'
 * });
 *
 * // Get user's entries (newest first)
 * const entries = await Entry.find({ userId: user._id })
 *   .sort({ createdAt: -1 })
 *   .limit(10);
 *
 * // Get single entry
 * const entry = await Entry.findById(entryId);
 *
 * // Update entry with reflection
 * await Entry.findByIdAndUpdate(
 *   entryId,
 *   { reflectionText: 'AI reflection here...' },
 *   { new: true } // Return updated document
 * );
 *
 * // Delete entry
 * await Entry.findByIdAndDelete(entryId);
 *
 * // Count user's entries
 * const count = await Entry.countDocuments({ userId: user._id });
 *
 * // Pagination
 * const entries = await Entry.find({ userId: user._id })
 *   .sort({ createdAt: -1 })
 *   .skip(page * limit)
 *   .limit(limit);
 *
 * Interview talking points:
 *
 * Q: "Why use compound index [userId, createdAt]?"
 * A: "Most queries filter by userId AND sort by createdAt.
 *     A compound index optimizes both operations in one index.
 *     Without it, MongoDB would scan all documents, then sort.
 *     With it, results come back pre-sorted - much faster."
 *
 * Q: "What's the difference between userId as String vs ObjectId?"
 * A: "I'm using String for simplicity. MongoDB ObjectIds are 12-byte values
 *     that include timestamp, machine ID, etc. For this app, storing
 *     the user ID as a string is simpler and works fine. For very large
 *     scale, I'd use ObjectId references with populate()."
 *
 * Q: "How do you handle the user-entry relationship?"
 * A: "It's a one-to-many relationship. One user has many entries.
 *     I store userId in each entry. To get a user's entries,
 *     I query Entry.find({ userId }). This is denormalized but
 *     fast for reads, which is what journaling apps need."
 *
 * Q: "What about cascade delete? If user deletes account?"
 * A: "I'd add a pre-remove hook on User model that deletes all entries:
 *     UserSchema.pre('remove', async function() {
 *       await Entry.deleteMany({ userId: this._id });
 *     })
 *     This ensures orphaned entries don't accumulate."
 */
