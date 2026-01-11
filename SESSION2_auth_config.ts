// auth.ts
// NextAuth v5 configuration for Google OAuth

import NextAuth from "next-auth";
import Google from "next-auth/providers/google";
import { PrismaAdapter } from "@auth/prisma-adapter";
import { prisma } from "@/lib/db";

/**
 * NextAuth v5 Configuration
 *
 * What is NextAuth?
 * - Handles authentication (login/logout)
 * - Manages sessions (who is logged in)
 * - Stores user data in database
 *
 * Why NextAuth?
 * - Built for Next.js (works seamlessly)
 * - Handles OAuth complexity (Google, GitHub, etc.)
 * - Secure by default (CSRF protection, encrypted cookies)
 */

export const { handlers, signIn, signOut, auth } = NextAuth({
  // Adapter connects NextAuth to your database
  // It automatically creates users, sessions, accounts tables
  adapter: PrismaAdapter(prisma),

  // Authentication providers (we're using Google)
  providers: [
    Google({
      clientId: process.env.GOOGLE_CLIENT_ID!,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET!,

      // What data we want from Google
      // profile: email, name, picture (avatar)
      authorization: {
        params: {
          prompt: "consent",          // Always ask for consent
          access_type: "offline",     // Get refresh token
          response_type: "code",      // Use authorization code flow
        },
      },
    }),
  ],

  // Session strategy: how to store session data
  session: {
    strategy: "jwt",  // Store in encrypted JWT cookie (fast, stateless)
    // Alternative: "database" - stores in DB (more secure, slower)
  },

  // Pages configuration
  pages: {
    signIn: "/login",  // Custom login page (we'll create this)
    error: "/login",   // Redirect to login on error
  },

  // Callbacks: customize authentication flow
  callbacks: {
    /**
     * JWT callback: runs when JWT is created or updated
     * Use this to add custom data to the token
     */
    async jwt({ token, user, account }) {
      // On first sign-in, user object is available
      if (user) {
        token.id = user.id;  // Add user ID to token
      }
      return token;
    },

    /**
     * Session callback: runs when session is accessed
     * Use this to add custom data to the session object
     * The session is what you get with useSession() on client
     */
    async session({ session, token }) {
      if (session.user) {
        session.user.id = token.id as string;  // Add user ID to session
      }
      return session;
    },

    /**
     * Authorized callback: controls access to pages
     * Return true to allow, false to redirect to login
     */
    authorized({ auth, request: { nextUrl } }) {
      const isLoggedIn = !!auth?.user;
      const isOnLoginPage = nextUrl.pathname === "/login";

      // If logged in and on login page → redirect to home
      if (isLoggedIn && isOnLoginPage) {
        return Response.redirect(new URL("/", nextUrl));
      }

      // If not logged in and not on login page → redirect to login
      if (!isLoggedIn && !isOnLoginPage) {
        return false;  // Middleware will redirect to login
      }

      return true;  // Allow access
    },
  },

  // Enable debug messages in development
  debug: process.env.NODE_ENV === "development",
});

/**
 * How this works:
 *
 * 1. User clicks "Sign in with Google"
 * 2. Redirected to Google OAuth page
 * 3. User approves access
 * 4. Google redirects back to /api/auth/callback/google
 * 5. NextAuth receives user data (email, name, picture)
 * 6. Prisma Adapter checks if user exists in database
 *    - If yes: update user data
 *    - If no: create new user
 * 7. JWT callback adds user ID to token
 * 8. Session callback adds user ID to session
 * 9. User is now logged in!
 *
 * Accessing user data in your app:
 *
 * // On server (API routes, Server Components)
 * import { auth } from "@/auth";
 * const session = await auth();
 * console.log(session.user.id);
 *
 * // On client (Client Components)
 * import { useSession } from "next-auth/react";
 * const { data: session } = useSession();
 * console.log(session?.user.id);
 */
