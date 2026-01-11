// components/SessionProvider.tsx
// Wrapper to provide session data to client components

"use client";

import { SessionProvider as NextAuthSessionProvider } from "next-auth/react";
import { ReactNode } from "react";

/**
 * Session Provider Component
 *
 * What is this?
 * - Wrapper that provides session data to all child components
 * - Uses React Context under the hood
 * - Required for useSession() hook to work in client components
 *
 * Why do we need this?
 * - NextAuth sessions work differently on server vs client
 * - Server: await auth() (direct database/token check)
 * - Client: useSession() (from React Context)
 * - This provider bridges the gap
 *
 * Usage in app/layout.tsx:
 * <SessionProvider>
 *   <YourApp />
 * </SessionProvider>
 */

interface SessionProviderProps {
  children: ReactNode;
}

export function SessionProvider({ children }: SessionProviderProps) {
  return <NextAuthSessionProvider>{children}</NextAuthSessionProvider>;
}

/**
 * How to use sessions in your app:
 *
 * === SERVER COMPONENTS (app/page.tsx, API routes) ===
 *
 * import { auth } from "@/auth";
 *
 * export default async function Page() {
 *   const session = await auth();
 *
 *   if (!session?.user) {
 *     return <div>Not logged in</div>;
 *   }
 *
 *   return <div>Hello {session.user.name}!</div>;
 * }
 *
 *
 * === CLIENT COMPONENTS (with "use client") ===
 *
 * "use client";
 * import { useSession } from "next-auth/react";
 *
 * export function UserProfile() {
 *   const { data: session, status } = useSession();
 *
 *   if (status === "loading") {
 *     return <div>Loading...</div>;
 *   }
 *
 *   if (status === "unauthenticated") {
 *     return <div>Not logged in</div>;
 *   }
 *
 *   return <div>Hello {session?.user?.name}!</div>;
 * }
 *
 *
 * === API ROUTES ===
 *
 * import { auth } from "@/auth";
 * import { NextResponse } from "next/server";
 *
 * export async function GET(req: Request) {
 *   const session = await auth();
 *
 *   if (!session?.user) {
 *     return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
 *   }
 *
 *   // Use session.user.id for database queries
 *   const entries = await prisma.entry.findMany({
 *     where: { userId: session.user.id }
 *   });
 *
 *   return NextResponse.json({ entries });
 * }
 *
 *
 * Interview talking points:
 *
 * Q: "Why separate Server vs Client session access?"
 * A: "Server Components can directly access the database/tokens (secure, fast).
 *     Client Components need React Context (enables reactivity, loading states).
 *     This separation follows React Server Components best practices."
 *
 * Q: "What's the performance difference?"
 * A: "Server: auth() is instant (reads JWT from request cookie).
 *     Client: useSession() adds ~50ms for initial load (fetches from API).
 *     For most pages, use server auth. Use client only for interactive components."
 */
