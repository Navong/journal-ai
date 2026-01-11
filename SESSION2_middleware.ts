// middleware.ts
// Protects routes - redirects to login if not authenticated

import { auth } from "@/auth";

/**
 * Next.js Middleware
 *
 * What is middleware?
 * - Runs BEFORE every request
 * - Can redirect, rewrite, or modify requests
 * - Perfect for authentication checks
 *
 * Why use it for auth?
 * - Protects pages without code in each page
 * - Works for both Server and Client Components
 * - Runs on Edge (very fast)
 *
 * Flow:
 * 1. User requests page (e.g., /dashboard)
 * 2. Middleware checks if logged in
 * 3. If yes: allow request to continue
 * 4. If no: redirect to /login
 */

export default auth((req) => {
  const { pathname } = req.nextUrl;
  const isLoggedIn = !!req.auth;

  // Public routes - accessible without login
  const publicRoutes = [
    "/login",
    "/api/auth",  // NextAuth endpoints
  ];

  const isPublicRoute = publicRoutes.some((route) =>
    pathname.startsWith(route)
  );

  // If public route, allow access
  if (isPublicRoute) {
    return;
  }

  // If not logged in and trying to access protected route
  if (!isLoggedIn) {
    // Redirect to login
    const loginUrl = new URL("/login", req.url);
    // Add callback URL so we can redirect back after login
    loginUrl.searchParams.set("callbackUrl", pathname);
    return Response.redirect(loginUrl);
  }

  // User is logged in, allow access
  return;
});

/**
 * Matcher configuration
 * Defines which routes this middleware runs on
 *
 * We want it to run on:
 * - All pages (/)
 * - All API routes (/api)
 *
 * Except:
 * - Static files (_next/static)
 * - Images (_next/image)
 * - Favicon, etc.
 */
export const config = {
  matcher: [
    /*
     * Match all request paths except:
     * - _next/static (static files)
     * - _next/image (image optimization)
     * - favicon.ico, sitemap.xml, robots.txt (SEO files)
     * - images in public folder (*.png, *.jpg, *.svg, etc.)
     */
    "/((?!_next/static|_next/image|favicon.ico|sitemap.xml|robots.txt|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};

/**
 * Interview talking points:
 *
 * Q: "Why use middleware instead of checking auth in each page?"
 * A: "Middleware runs before the page loads, so it's more secure and faster.
 *     If I checked in each page, the page would load first, then check auth,
 *     then redirect - causing a flash of content. Middleware prevents this."
 *
 * Q: "What's the performance impact?"
 * A: "Minimal. Middleware runs on Edge (Cloudflare/Vercel Edge), not your server.
 *     It's extremely fast (< 10ms) and doesn't count toward serverless function time."
 *
 * Q: "How would you handle role-based access control?"
 * A: "I'd add a role field to the User model, include it in the session,
 *     then check req.auth.user.role in middleware. For example:
 *     if (pathname.startsWith('/admin') && user.role !== 'admin') { redirect }"
 */
