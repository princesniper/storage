/**
 * Root Next.js middleware.
 *
 * Responsibilities:
 * 1. Protect /dashboard, /files, /upload, /channels, /settings pages — require valid session.
 * 2. Protect /api/files, /api/channels, /api/telegram APIs.
 * 3. Leave /api/auth, /api/health, /api/status, /i/, /images/, /login, /, /_next completely public.
 * 4. Add basic security headers on all responses.
 */
import { withAuth } from "next-auth/middleware";
import { NextResponse } from "next/server";

export default withAuth(
  function middleware(req) {
    // Add security headers
    const res = NextResponse.next();
    res.headers.set("X-Content-Type-Options", "nosniff");
    res.headers.set("X-Frame-Options", "DENY");
    res.headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
    res.headers.set("Permissions-Policy", "geolocation=(), microphone=(), camera=()");
    if (process.env.NODE_ENV === "production") {
      res.headers.set("Strict-Transport-Security", "max-age=63072000; includeSubDomains; preload");
    }
    return res;
  },
  {
    callbacks: {
      authorized: ({ token, req }) => {
        const path = req.nextUrl.pathname;
        // Public paths (minimum required — everything else needs a session).
        const isPublic =
          path === "/" ||
          path === "/login" ||
          path.startsWith("/api/auth") ||
          path === "/api/health" ||
          path === "/api/status" ||
          path.startsWith("/i/") ||
          path.startsWith("/images/") ||
          path.startsWith("/shared/folders/") ||
          path.startsWith("/api/shared/folders/") ||
          path.startsWith("/_next") ||
          path.startsWith("/favicon");
        if (isPublic) return true;
        return !!token;
      },
    },
  }
);

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
