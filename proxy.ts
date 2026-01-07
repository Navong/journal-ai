import { auth } from "@/auth"
import { NextResponse } from "next/server"

export default auth((req) => {
  const isLoggedIn = !!req.auth
  const isOnLoginPage = req.nextUrl.pathname.startsWith("/login")

  // Check for demo mode via cookie
  const isDemoMode = req.cookies.get("demo-mode")?.value === "true"

  // If on login page and already logged in, redirect to home
  if (isOnLoginPage && isLoggedIn) {
    return NextResponse.redirect(new URL("/", req.url))
  }

  // If in demo mode, allow access to all pages
  if (isDemoMode) {
    return NextResponse.next()
  }

  // If not logged in and not on login page, redirect to login
  if (!isLoggedIn && !isOnLoginPage) {
    return NextResponse.redirect(new URL("/login", req.url))
  }

  // Allow the request to continue
  return NextResponse.next()
})

// Optionally, don't invoke Middleware on some paths
export const config = {
  matcher: ["/((?!api|_next/static|_next/image|favicon.ico|.*\\..*).*)"],
}
