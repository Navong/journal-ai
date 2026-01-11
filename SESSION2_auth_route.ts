// app/api/auth/[...nextauth]/route.ts
// NextAuth API route handler

import { handlers } from "@/auth";

/**
 * NextAuth Route Handler
 *
 * This file handles ALL authentication routes:
 * - /api/auth/signin
 * - /api/auth/signout
 * - /api/auth/callback/google
 * - /api/auth/session
 * - /api/auth/csrf
 *
 * The [...nextauth] in the folder name is a "catch-all" route
 * It catches any path starting with /api/auth/
 *
 * Why we need this:
 * - NextAuth needs an API endpoint to handle OAuth flow
 * - Google redirects here after user approves
 * - Session checks use this endpoint
 *
 * You don't need to modify this file!
 * All configuration is in auth.ts
 */

export const { GET, POST } = handlers;

/**
 * How this works:
 *
 * 1. User visits /api/auth/signin/google
 *    → NextAuth redirects to Google OAuth page
 *
 * 2. User approves on Google
 *    → Google redirects to /api/auth/callback/google
 *    → This route (GET handler) processes the callback
 *    → Creates/updates user in database
 *    → Creates session cookie
 *    → Redirects to home page
 *
 * 3. App checks if user is logged in
 *    → Calls /api/auth/session
 *    → This route (GET handler) returns session data
 *
 * 4. User clicks logout
 *    → Calls /api/auth/signout
 *    → This route (POST handler) clears session cookie
 */
