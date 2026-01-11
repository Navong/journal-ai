// types/next-auth.d.ts
// Extend NextAuth TypeScript types to include user.id

import NextAuth, { DefaultSession, DefaultUser } from "next-auth";
import { DefaultJWT } from "next-auth/jwt";

/**
 * TypeScript Module Augmentation
 *
 * What is this?
 * - Extends existing TypeScript types
 * - Adds custom fields to NextAuth's built-in types
 * - Gives us autocomplete and type safety
 *
 * Why do we need this?
 * - By default, session.user only has: name, email, image
 * - We need to add: id (for database queries)
 * - Without this, TypeScript would error on session.user.id
 *
 * How it works:
 * - We "augment" (extend) the next-auth module
 * - Add our custom fields to the interfaces
 * - TypeScript merges our types with NextAuth's types
 */

declare module "next-auth" {
  /**
   * Extend the Session interface
   * This is what you get from: await auth() or useSession()
   */
  interface Session {
    user: {
      id: string;  // ← We add this
    } & DefaultSession["user"];  // Keep name, email, image
  }

  /**
   * Extend the User interface
   * This is what comes from the database (Prisma)
   */
  interface User extends DefaultUser {
    // Prisma already has id, but we make it explicit
    id: string;
  }
}

declare module "next-auth/jwt" {
  /**
   * Extend the JWT interface
   * This is what's stored in the encrypted cookie
   */
  interface JWT extends DefaultJWT {
    id: string;  // ← We add user ID to the token
  }
}

/**
 * Now TypeScript knows about these fields:
 *
 * // ✅ This works (no TypeScript error)
 * const session = await auth();
 * console.log(session?.user.id);  // TypeScript: string
 *
 * // ✅ This also works
 * const { data: session } = useSession();
 * console.log(session?.user.id);  // TypeScript: string
 *
 * // ✅ And this
 * const entries = await prisma.entry.findMany({
 *   where: { userId: session.user.id }  // TypeScript: ✓ valid
 * });
 *
 *
 * Without this file, you'd get:
 * // ❌ TypeScript error: Property 'id' does not exist on type 'User'
 * console.log(session?.user.id);
 *
 *
 * Interview talking points:
 *
 * Q: "What is module augmentation?"
 * A: "It's a TypeScript feature that lets you add properties to existing types
 *     from third-party libraries. Here, I'm adding 'id' to NextAuth's User type
 *     so TypeScript knows about it throughout my app."
 *
 * Q: "Why not just use 'any' or ignore the error?"
 * A: "Type safety catches bugs at compile-time instead of runtime.
 *     If I typo session.user.idd, TypeScript catches it immediately.
 *     It also enables autocomplete in my editor, speeding up development."
 */
