import NextAuth, { type DefaultSession } from "next-auth"
import Google from "next-auth/providers/google"
import Credentials from "next-auth/providers/credentials"
import type { NextAuthConfig } from "next-auth"
// Dynamic import to avoid Edge Runtime issues - only import when needed (in JWT callback which runs in Node.js)
let hashEmailForUserId: ((email: string) => string) | null = null;

// Lazy load the hash function only in Node.js runtime
function getHashFunction() {
  if (!hashEmailForUserId) {
    // Only import in Node.js runtime (JWT callbacks run in Node.js)
    const encryption = require("@/app/utils/encryption");
    hashEmailForUserId = encryption.hashEmailForUserId;
  }
  return hashEmailForUserId;
}

declare module "next-auth" {
  interface Session {
    user: {
      id: string
    } & DefaultSession["user"]
  }
}

declare module "@auth/core/jwt" {
  interface JWT {
    id?: string
  }
}

export const authConfig = {
  secret: process.env.AUTH_SECRET,
  trustHost: true, // Required for NextAuth v5 with Next.js 16
  providers: [
    // Google OAuth (required)
    Google({
      clientId: process.env.GOOGLE_CLIENT_ID!,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
      allowDangerousEmailAccountLinking: true,
    }),
    // Dev login provider (only works in development)
    ...(process.env.NODE_ENV === 'development' ? [
      Credentials({
        id: "DevLogin",
        name: "DevLogin",
        credentials: {},
        async authorize(credentials) {
          // Only allow in development environment
          if (process.env.NODE_ENV !== 'development') {
            return null
          }
          // Simple dev login - no credentials needed
          // User ID is dev@admin for database storage
          return {
            id: 'dev@admin',
            email: 'dev@admin',
            name: 'Dev User',
          }
        },
      }),
    ] : []),
  ],
  pages: {
    signIn: "/login",
  },
  callbacks: {
    async jwt({ token, user, account, profile }) {
      if (user) {
        // SECURITY: Hash email to create secure user ID instead of storing plain email
        // This prevents email addresses (including Gmail) from being stored in plain text
        // The hash is deterministic - same email ALWAYS produces same hash
        // This ensures users can access their data after logout/login
        // Note: JWT callbacks run in Node.js runtime, so we can use Node.js crypto
        const hashFn = getHashFunction();
        
        if (!hashFn) {
          console.error('[NextAuth] Failed to load hash function');
          return token;
        }
        
        if (user.email) {
          const hashedId = hashFn(user.email);
          token.id = hashedId;
          console.log(`[NextAuth] User ID set: ${hashedId.substring(0, 20)}... (from email: ${user.email.substring(0, 5)}***)`);
        } else if (account?.providerAccountId) {
          // For OAuth providers without email, hash the provider account ID
          // For Google: this is the stable 'sub' claim which is always the same
          const hashedId = hashFn(account.providerAccountId);
          token.id = hashedId;
          console.log(`[NextAuth] User ID set: ${hashedId.substring(0, 20)}... (from provider account ID)`);
        } else if (user.id) {
          // Last fallback: hash the user.id
          const hashedId = hashFn(user.id);
          token.id = hashedId;
          console.log(`[NextAuth] User ID set: ${hashedId.substring(0, 20)}... (from user.id)`);
        } else {
          console.error('[NextAuth] No user identifier found!', { 
            hasEmail: !!user.email, 
            hasProviderAccountId: !!account?.providerAccountId,
            hasUserId: !!user.id 
          });
        }
      }
      return token
    },
    session({ session, token }) {
      if (token?.id && session?.user) {
        session.user.id = token.id
      }
      return session
    },
  },
} satisfies NextAuthConfig

export const { handlers, auth, signIn, signOut } = NextAuth(authConfig)
