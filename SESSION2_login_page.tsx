// app/login/page.tsx
// Login page with Google OAuth button

import { signIn } from "@/auth";
import { redirect } from "next/navigation";
import { auth } from "@/auth";

/**
 * Login Page Component
 *
 * What this page does:
 * - Shows "Sign in with Google" button
 * - Redirects to home if already logged in
 * - Handles OAuth flow
 *
 * Flow:
 * 1. User visits /login
 * 2. Server checks if already logged in
 * 3. If yes: redirect to home
 * 4. If no: show login button
 * 5. User clicks button
 * 6. Server action starts OAuth flow
 * 7. Redirect to Google
 */

export default async function LoginPage() {
  // Check if user is already logged in
  const session = await auth();

  // If logged in, redirect to home
  if (session?.user) {
    redirect("/");
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-stone-50">
      <div className="w-full max-w-md space-y-8 rounded-lg bg-white p-8 shadow-lg">
        {/* Logo / App Name */}
        <div className="text-center">
          <h1 className="text-4xl font-serif font-bold text-stone-900">
            Serenity
          </h1>
          <p className="mt-2 text-sm text-stone-600">
            AI-powered journaling for mindful reflection
          </p>
        </div>

        {/* Sign In Button */}
        <form
          action={async () => {
            "use server"; // This is a Server Action

            /**
             * What is a Server Action?
             * - Function that runs on the server
             * - Triggered by form submission
             * - Secure (credentials never exposed to client)
             *
             * Why use it here?
             * - OAuth flow must start from server
             * - Keeps client IDs/secrets secure
             * - No API route needed
             */
            await signIn("google", {
              redirectTo: "/", // Where to go after successful login
            });
          }}
        >
          <button
            type="submit"
            className="flex w-full items-center justify-center gap-3 rounded-lg bg-white px-4 py-3 text-sm font-medium text-stone-700 shadow-md ring-1 ring-stone-200 transition-all hover:bg-stone-50 hover:shadow-lg focus:outline-none focus:ring-2 focus:ring-emerald-500"
          >
            {/* Google Logo SVG */}
            <svg className="h-5 w-5" viewBox="0 0 24 24">
              <path
                fill="#4285F4"
                d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
              />
              <path
                fill="#34A853"
                d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
              />
              <path
                fill="#FBBC05"
                d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
              />
              <path
                fill="#EA4335"
                d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
              />
            </svg>
            Continue with Google
          </button>
        </form>

        {/* Privacy Notice */}
        <p className="text-center text-xs text-stone-500">
          By continuing, you agree to our Terms of Service and Privacy Policy
        </p>
      </div>
    </div>
  );
}

/**
 * Why this design?
 *
 * 1. Simple: One button, clear action
 * 2. Trusted: Google OAuth is familiar to users
 * 3. Secure: Server Actions keep credentials safe
 * 4. Accessible: Semantic HTML, keyboard navigation
 * 5. Responsive: Works on mobile and desktop
 *
 * Interview talking points:
 *
 * Q: "Why use Server Actions instead of API route?"
 * A: "Server Actions are simpler - no need for a separate API endpoint.
 *     They're secure by default (run on server), and have built-in CSRF protection.
 *     For simple operations like sign-in, they're perfect."
 *
 * Q: "Why only Google OAuth?"
 * A: "For MVP, one provider is enough. Google has high trust and coverage.
 *     Adding more providers (GitHub, email/password) is easy with NextAuth -
 *     just add to the providers array. I'd add them based on user feedback."
 *
 * Q: "How would you handle sign-in errors?"
 * A: "NextAuth redirects to /login?error=OAuthSignin on error.
 *     I'd check searchParams for error and display a user-friendly message.
 *     For production, I'd also log errors to a service like Sentry."
 */
