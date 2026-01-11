// auth.ts
// NextAuth v5 configuration with MongoDB adapter

import NextAuth from "next-auth";
import Google from "next-auth/providers/google";
import { MongoDBAdapter } from "@auth/mongodb-adapter";
import clientPromise from "@/lib/mongodb-client";

/**
 * NextAuth v5 Configuration with MongoDB
 *
 * Changes from Prisma version:
 * - Uses MongoDBAdapter instead of PrismaAdapter
 * - Requires MongoDB client (not Mongoose)
 * - NextAuth creates its own collections (users, accounts, sessions)
 *
 * Why separate MongoDB client?
 * - NextAuth adapter needs raw MongoDB client (not Mongoose)
 * - We use Mongoose for our app collections (entries)
 * - NextAuth uses MongoDB driver for its collections
 * - Both connect to same database, different libraries
 */

export const { handlers, signIn, signOut, auth } = NextAuth({
  // MongoDB adapter - connects NextAuth to MongoDB
  adapter: MongoDBAdapter(clientPromise, {
    databaseName: "serenity-journal", // Optional: specify database name
  }),

  // Authentication providers
  providers: [
    Google({
      clientId: process.env.GOOGLE_CLIENT_ID!,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
      authorization: {
        params: {
          prompt: "consent",
          access_type: "offline",
          response_type: "code",
        },
      },
    }),
  ],

  // Session strategy
  session: {
    strategy: "jwt", // Use JWT tokens (faster, stateless)
  },

  // Custom pages
  pages: {
    signIn: "/login",
    error: "/login",
  },

  // Callbacks
  callbacks: {
    /**
     * JWT callback: add user ID to token
     */
    async jwt({ token, user }) {
      if (user) {
        token.id = user.id;
      }
      return token;
    },

    /**
     * Session callback: add user ID to session
     */
    async session({ session, token }) {
      if (session.user) {
        session.user.id = token.id as string;
      }
      return session;
    },

    /**
     * Authorized callback: control page access
     */
    authorized({ auth, request: { nextUrl } }) {
      const isLoggedIn = !!auth?.user;
      const isOnLoginPage = nextUrl.pathname === "/login";

      if (isLoggedIn && isOnLoginPage) {
        return Response.redirect(new URL("/", nextUrl));
      }

      if (!isLoggedIn && !isOnLoginPage) {
        return false;
      }

      return true;
    },
  },

  debug: process.env.NODE_ENV === "development",
});

/**
 * MongoDB Collections Created by NextAuth:
 *
 * 1. users - User accounts
 *    { _id, name, email, emailVerified, image }
 *
 * 2. accounts - OAuth provider info
 *    { _id, userId, type, provider, providerAccountId, ... }
 *
 * 3. sessions - Database sessions (optional, we use JWT)
 *    { _id, userId, sessionToken, expires }
 *
 * 4. verification_tokens - Email verification (if using email auth)
 *    { _id, identifier, token, expires }
 *
 * Our app collections (created by Mongoose):
 *
 * 5. entries - Journal entries
 *    { _id, userId, entryText, reflectionText, ... }
 *
 * Interview talking points:
 *
 * Q: "Why use both MongoDB client AND Mongoose?"
 * A: "NextAuth's MongoDB adapter requires the raw MongoDB driver
 *     for compatibility with its auth schema. Mongoose is better
 *     for our app logic (entries) with schemas and validation.
 *     They both connect to the same database but serve different purposes."
 *
 * Q: "Could you use only Mongoose for everything?"
 * A: "Yes, but I'd need to implement NextAuth adapter manually.
 *     The official MongoDB adapter is battle-tested and handles
 *     edge cases. It's simpler to use their adapter with MongoDB driver
 *     and Mongoose for our custom collections."
 *
 * Q: "What's the performance impact of two connections?"
 * A: "Minimal. Both use connection pooling to the same database.
 *     The MongoDB driver and Mongoose pools are separate, but
 *     MongoDB Atlas handles both efficiently. In practice,
 *     it's the same as one connection."
 */
