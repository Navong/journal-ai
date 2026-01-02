import NextAuth, { type DefaultSession } from "next-auth"
import Google from "next-auth/providers/google"
import Credentials from "next-auth/providers/credentials"
import type { NextAuthConfig } from "next-auth"

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
        // Use email as the stable user identifier for all providers
        // This ensures the same user always gets the same ID regardless of login method
        if (user.email) {
          token.id = user.email
          console.log(`[NextAuth] Setting stable user ID to email: ${user.email}`)
        } else if (account?.providerAccountId) {
          // Fallback to provider account ID (Google's sub, etc.)
          // For Google: this is the stable 'sub' claim
          token.id = account.providerAccountId
          console.log(`[NextAuth] Setting user ID to provider account ID: ${token.id}`)
        } else if (user.id) {
          // Last fallback to user.id
          token.id = user.id
          console.log(`[NextAuth] Setting user ID to user.id: ${user.id}`)
        } else {
          console.error('[NextAuth] No user identifier found!', { user, account, profile })
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
