// app/layout.tsx
// Root layout - wraps entire app

import type { Metadata } from "next";
import { SessionProvider } from "@/components/SessionProvider";
import "./globals.css";

/**
 * Root Layout Component
 *
 * What is this?
 * - Wraps every page in your app
 * - Only runs once when app loads
 * - Perfect for providers, fonts, global styles
 *
 * Why SessionProvider here?
 * - All pages need access to session data
 * - Wrap once at root instead of every page
 * - Follows React best practices (context at top level)
 */

export const metadata: Metadata = {
  title: "Serenity - AI Journaling",
  description: "AI-powered journaling with context-aware reflections",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className="antialiased">
        {/*
          SessionProvider wraps the entire app
          - Enables useSession() in all client components
          - Provides session context via React Context API
        */}
        <SessionProvider>{children}</SessionProvider>
      </body>
    </html>
  );
}

/**
 * What happens when app loads:
 *
 * 1. Next.js renders RootLayout
 * 2. SessionProvider initializes
 * 3. Fetches session from /api/auth/session
 * 4. Stores in React Context
 * 5. Children (pages) can access via useSession()
 * 6. On session change (login/logout), all components re-render
 *
 * Interview talking points:
 *
 * Q: "Why not fetch session in each page?"
 * A: "That would cause multiple API calls. With SessionProvider,
 *     we fetch once and share via Context. It's more efficient
 *     and keeps components simple."
 *
 * Q: "What if I need different layouts for different pages?"
 * A: "I can create nested layouts. For example:
 *     - app/layout.tsx (root - has SessionProvider)
 *     - app/(app)/layout.tsx (dashboard layout - has sidebar)
 *     - app/(marketing)/layout.tsx (marketing layout - different header)
 *     Next.js composes them automatically."
 */
