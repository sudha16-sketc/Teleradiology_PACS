import { NextResponse, type NextRequest } from "next/server";

/**
 * Lightweight edge routing only. It does NOT try to verify the session JWT:
 * the Next.js process and the API are separate processes and do not share a
 * signing secret in every environment (dev servers even sign with an ephemeral
 * secret the web process can never know), so any signature check here would
 * misjudge genuinely valid sessions — and worse, redirecting "public" pages
 * (like /login) based on mere cookie presence silently bounced users away from
 * the sign-in page when the cookie outlived its token.
 *
 * The security boundary lives in the API auth guard; this middleware only:
 *   - sends cookie-less requests for protected pages to /login, and
 *   - leaves everything else alone (public pages are never redirected, valid
 *     or stale cookies are never deleted here). SessionGuard + /auth/me are the
 *     authoritative gate once a protected page actually renders.
 */
const SESSION_COOKIE = "axis_session";
const PUBLIC_PATHS = ["/login", "/register"];

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (
    pathname === "/" ||
    pathname.startsWith("/_next") ||
    pathname.startsWith("/api")
  ) {
    return NextResponse.next();
  }

  const isPublicPath = PUBLIC_PATHS.some(
    (p) => pathname === p || pathname.startsWith(`${p}/`),
  );
  if (isPublicPath) {
    return NextResponse.next();
  }

  const token = request.cookies.get(SESSION_COOKIE)?.value;
  if (!token) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    return NextResponse.redirect(url);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)"],
};