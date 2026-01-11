// lib/mongodb-client.ts
// MongoDB client for NextAuth adapter

import { MongoClient } from 'mongodb';

/**
 * MongoDB Client for NextAuth
 *
 * Why separate from Mongoose?
 * - NextAuth's MongoDB adapter needs raw MongoDB client
 * - Mongoose is for our app collections (entries)
 * - Both connect to same database, different libraries
 *
 * This follows NextAuth's official MongoDB example
 */

const uri = process.env.DATABASE_URL;
const options = {};

if (!uri) {
  throw new Error('Please add your MongoDB URI to .env');
}

let client: MongoClient;
let clientPromise: Promise<MongoClient>;

/**
 * Singleton pattern for MongoDB client
 * Prevents multiple connections in development
 */
if (process.env.NODE_ENV === 'development') {
  // In development, use global variable to preserve value across hot reloads
  let globalWithMongo = global as typeof globalThis & {
    _mongoClientPromise?: Promise<MongoClient>;
  };

  if (!globalWithMongo._mongoClientPromise) {
    client = new MongoClient(uri, options);
    globalWithMongo._mongoClientPromise = client.connect();
  }
  clientPromise = globalWithMongo._mongoClientPromise;
} else {
  // In production, create new client
  client = new MongoClient(uri, options);
  clientPromise = client.connect();
}

export default clientPromise;

/**
 * Usage:
 *
 * This file is ONLY used by NextAuth adapter.
 * For your app logic, use Mongoose:
 *
 * // In API routes (for auth):
 * import { MongoDBAdapter } from "@auth/mongodb-adapter";
 * import clientPromise from "@/lib/mongodb-client";
 * adapter: MongoDBAdapter(clientPromise)
 *
 * // In API routes (for entries):
 * import { connectDB } from "@/lib/db";
 * import Entry from "@/models/Entry";
 * await connectDB();
 * const entries = await Entry.find({ userId });
 *
 * Interview talking points:
 *
 * Q: "Why not use one library for everything?"
 * A: "NextAuth's adapter is built for MongoDB driver, not Mongoose.
 *     While I could write a custom Mongoose adapter, using their
 *     official MongoDB adapter is more reliable and maintained.
 *     Mongoose gives me better DX for app logic with schemas."
 *
 * Q: "Is this connection reused?"
 * A: "Yes. The singleton pattern ensures we create one connection
 *     and reuse it. Both the MongoDB driver and Mongoose maintain
 *     their own connection pools to the same database server."
 *
 * Q: "How do you choose between MongoDB driver vs Mongoose?"
 * A: "MongoDB driver: Lower-level, more control, used by libraries
 *     Mongoose: Higher-level, schemas, validation, better DX
 *     For this app: NextAuth uses driver, app logic uses Mongoose"
 */
