// models/User.ts
// User model for authentication

import mongoose, { Schema, models, Model } from 'mongoose';

/**
 * User Interface (TypeScript)
 * Defines the shape of a User document
 */
export interface IUser {
  _id: string;
  name?: string;
  email: string;
  emailVerified?: Date;
  image?: string;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * User Schema (Mongoose)
 * Defines the structure in MongoDB
 *
 * Why separate interface and schema?
 * - Interface: TypeScript type checking
 * - Schema: MongoDB validation and defaults
 */
const UserSchema = new Schema<IUser>(
  {
    name: {
      type: String,
      required: false,
    },
    email: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
    },
    emailVerified: {
      type: Date,
      required: false,
    },
    image: {
      type: String,
      required: false,
    },
  },
  {
    timestamps: true, // Automatically adds createdAt and updatedAt
  }
);

/**
 * Indexes for performance
 * Email is unique and frequently queried
 */
UserSchema.index({ email: 1 });

/**
 * Create or retrieve User model
 *
 * Why this pattern?
 * - In development, Next.js hot-reloads files
 * - Without this check, Mongoose throws "model already exists" error
 * - Check if model exists before creating
 */
const User: Model<IUser> = models.User || mongoose.model<IUser>('User', UserSchema);

export default User;

/**
 * Usage examples:
 *
 * // Create user
 * const user = await User.create({
 *   email: 'user@example.com',
 *   name: 'John Doe',
 *   image: 'https://...'
 * });
 *
 * // Find user by email
 * const user = await User.findOne({ email: 'user@example.com' });
 *
 * // Find user by ID
 * const user = await User.findById(userId);
 *
 * // Update user
 * await User.findByIdAndUpdate(userId, { name: 'Jane Doe' });
 *
 * // Delete user
 * await User.findByIdAndDelete(userId);
 *
 * Interview talking points:
 *
 * Q: "What's the difference between Schema and Model?"
 * A: "Schema defines the structure (fields, types, validation).
 *     Model is the compiled version you use to query.
 *     Think of Schema as a blueprint, Model as the builder."
 *
 * Q: "Why check 'models.User' before creating?"
 * A: "Next.js hot-reloads in development. Without this check,
 *     Mongoose would try to recreate the model on each reload
 *     and throw an error. This pattern prevents that."
 *
 * Q: "What does timestamps: true do?"
 * A: "Automatically adds createdAt and updatedAt fields.
 *     Mongoose updates them on create/save. Saves boilerplate code."
 */
