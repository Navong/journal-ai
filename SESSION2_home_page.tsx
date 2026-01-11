// app/page.tsx
// Home page - protected by middleware

import { auth, signOut } from "@/auth";
import { redirect } from "next/navigation";
import Image from "next/image";

/**
 * Home Page Component
 *
 * What this does:
 * - Shows welcome message with user info
 * - Displays logout button
 * - Protected by middleware (auto-redirects if not logged in)
 *
 * This is a Server Component (default in App Router)
 * - Runs on server
 * - Can directly access database, auth, etc.
 * - No "use client" needed
 */

export default async function HomePage() {
  // Get current session (server-side)
  const session = await auth();

  // Middleware should prevent this, but double-check
  if (!session?.user) {
    redirect("/login");
  }

  const { user } = session;

  return (
    <div className="flex min-h-screen items-center justify-center bg-stone-50">
      <div className="w-full max-w-2xl space-y-8 rounded-lg bg-white p-8 shadow-lg">
        {/* Header */}
        <div className="flex items-center justify-between">
          <h1 className="text-3xl font-serif font-bold text-stone-900">
            Serenity
          </h1>

          {/* Logout Button */}
          <form
            action={async () => {
              "use server";
              /**
               * Server Action to sign out
               * - Clears session cookie
               * - Redirects to login
               * - Secure (runs on server)
               */
              await signOut({ redirectTo: "/login" });
            }}
          >
            <button
              type="submit"
              className="rounded-lg px-4 py-2 text-sm font-medium text-stone-600 transition-colors hover:bg-stone-100 hover:text-stone-900"
            >
              Sign Out
            </button>
          </form>
        </div>

        {/* User Info */}
        <div className="flex items-center gap-4 border-b border-stone-200 pb-6">
          {/* User Avatar */}
          {user.image && (
            <Image
              src={user.image}
              alt={user.name || "User avatar"}
              width={64}
              height={64}
              className="rounded-full ring-2 ring-emerald-500"
            />
          )}

          <div>
            <h2 className="text-2xl font-semibold text-stone-900">
              Welcome back, {user.name}!
            </h2>
            <p className="text-sm text-stone-600">{user.email}</p>
            <p className="mt-1 text-xs text-stone-500">User ID: {user.id}</p>
          </div>
        </div>

        {/* Placeholder Content */}
        <div className="space-y-4">
          <h3 className="text-lg font-semibold text-stone-900">
            🎉 Authentication is working!
          </h3>
          <p className="text-stone-600">
            You&apos;re successfully logged in with Google OAuth.
          </p>

          <div className="rounded-lg bg-emerald-50 p-4">
            <h4 className="font-medium text-emerald-900">
              What we&apos;ve built:
            </h4>
            <ul className="mt-2 space-y-1 text-sm text-emerald-800">
              <li>✅ Google OAuth integration</li>
              <li>✅ Protected routes with middleware</li>
              <li>✅ Session management</li>
              <li>✅ Database user storage</li>
              <li>✅ TypeScript type safety</li>
            </ul>
          </div>

          <div className="rounded-lg bg-blue-50 p-4">
            <h4 className="font-medium text-blue-900">Next session:</h4>
            <p className="mt-2 text-sm text-blue-800">
              We&apos;ll build the journal interface where you can write entries.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * How authentication flow works (complete picture):
 *
 * 1. User visits / (this page)
 *    ↓
 * 2. Middleware runs (checks auth)
 *    ↓ Not logged in
 * 3. Redirect to /login
 *    ↓
 * 4. User clicks "Sign in with Google"
 *    ↓
 * 5. Server Action calls signIn("google")
 *    ↓
 * 6. Redirect to Google OAuth page
 *    ↓
 * 7. User approves
 *    ↓
 * 8. Google redirects to /api/auth/callback/google
 *    ↓
 * 9. NextAuth processes:
 *    - Gets user data from Google
 *    - Checks database (via Prisma Adapter)
 *    - Creates/updates user in MongoDB
 *    - Creates JWT token with user ID
 *    - Sets session cookie
 *    ↓
 * 10. Redirect to / (this page)
 *     ↓
 * 11. Middleware checks auth → logged in ✓
 *     ↓
 * 12. Page renders with user data
 *
 *
 * Database structure after first login:
 *
 * MongoDB collections created by Prisma Adapter:
 * - users: { id, email, name, image, createdAt }
 * - accounts: OAuth account info (Google)
 * - sessions: (optional, we use JWT so this is empty)
 *
 *
 * Interview talking points:
 *
 * Q: "Walk me through the authentication flow"
 * A: [Explain the 12-step flow above]
 *
 * Q: "Where is the session stored?"
 * A: "In an encrypted JWT cookie called next-auth.session-token.
 *     It's httpOnly (JavaScript can't access it) and secure (HTTPS only).
 *     The JWT contains the user ID, which we use for database queries."
 *
 * Q: "How do you prevent CSRF attacks?"
 * A: "NextAuth includes built-in CSRF protection. Every state-changing
 *     request requires a CSRF token from /api/auth/csrf. Server Actions
 *     handle this automatically."
 *
 * Q: "What happens if the JWT expires?"
 * A: "NextAuth automatically refreshes it. The default expiry is 30 days.
 *     When the user visits, if the token is close to expiry, NextAuth
 *     refreshes it silently. If fully expired, user must log in again."
 */
