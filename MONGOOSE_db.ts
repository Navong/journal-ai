// lib/db.ts
// MongoDB connection with Mongoose

import mongoose from 'mongoose';

/**
 * MongoDB Connection with Mongoose
 *
 * What is Mongoose?
 * - ODM (Object Data Modeling) library for MongoDB
 * - Provides schema validation
 * - Simpler than Prisma for MongoDB-only projects
 *
 * Why singleton pattern?
 * - Next.js hot-reloads in development
 * - Without this, each reload creates new connection
 * - Result: "Too many connections" error
 *
 * How it works:
 * - First call: Creates connection, stores in global
 * - Subsequent calls: Reuses existing connection
 */

const MONGODB_URI = process.env.DATABASE_URL;

if (!MONGODB_URI) {
  throw new Error(
    'Please define the DATABASE_URL environment variable in .env'
  );
}

/**
 * Global object to store connection
 * Persists across hot reloads in development
 */
interface MongooseCache {
  conn: typeof mongoose | null;
  promise: Promise<typeof mongoose> | null;
}

declare global {
  var mongoose: MongooseCache | undefined;
}

let cached: MongooseCache = global.mongoose || { conn: null, promise: null };

if (!global.mongoose) {
  global.mongoose = cached;
}

/**
 * Connect to MongoDB
 * Returns existing connection if available
 * Creates new connection if needed
 */
export async function connectDB(): Promise<typeof mongoose> {
  // If already connected, return connection
  if (cached.conn) {
    return cached.conn;
  }

  // If connection is in progress, wait for it
  if (!cached.promise) {
    const options = {
      bufferCommands: false, // Disable Mongoose buffering
    };

    // Start connection
    cached.promise = mongoose.connect(MONGODB_URI!, options);
  }

  try {
    // Wait for connection to complete
    cached.conn = await cached.promise;
  } catch (error) {
    // If connection fails, reset promise so we can retry
    cached.promise = null;
    throw error;
  }

  return cached.conn;
}

/**
 * Usage in API routes:
 *
 * import { connectDB } from '@/lib/db';
 * import { User } from '@/models/User';
 *
 * export async function GET() {
 *   await connectDB();
 *   const users = await User.find();
 *   return Response.json({ users });
 * }
 *
 * Interview talking points:
 *
 * Q: "Why Mongoose over Prisma?"
 * A: "Mongoose is more MongoDB-native and easier to understand.
 *     Prisma adds abstraction that's great for multi-database apps,
 *     but for MongoDB-only, Mongoose is simpler. The query syntax
 *     is also closer to MongoDB's native queries, which helps with learning."
 *
 * Q: "How do you handle connection pooling?"
 * A: "Mongoose handles pooling automatically. By default, it maintains
 *     5 connections. In production, I'd increase this based on load.
 *     The singleton pattern ensures we reuse the pool instead of
 *     creating new connections on each request."
 *
 * Q: "What happens if MongoDB is down?"
 * A: "The connection throws an error, which I catch in the API route
 *     and return a 500 error. For production, I'd add retry logic
 *     with exponential backoff and health check endpoints."
 */
