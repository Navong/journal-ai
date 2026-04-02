import mongoose from 'mongoose';

type GlobalWithMongoose = typeof globalThis & {
  __mongooseConn?: {
    conn: typeof mongoose | null;
    promise: Promise<typeof mongoose> | null;
  };
};

const globalForMongoose = globalThis as GlobalWithMongoose;

if (!globalForMongoose.__mongooseConn) {
  globalForMongoose.__mongooseConn = { conn: null, promise: null };
}

export async function connectMongo(): Promise<typeof mongoose | null> {
  const uri = process.env.MONGODB_URI;
  if (!uri) return null;

  const cached = globalForMongoose.__mongooseConn!;
  if (cached.conn) return cached.conn;

  if (!cached.promise) {
    cached.promise = mongoose
      .connect(uri, {
        // Keep defaults; configure only if needed.
        serverSelectionTimeoutMS: 15000,
      })
      .then((m) => m);
  }

  cached.conn = await cached.promise;
  return cached.conn;
}

