import { NextResponse, type NextRequest } from "next/server";

/** Paths forwarded to the Go backend (see proxy() below). */
function shouldProxyToBackend(pathname: string): boolean {
  if (pathname === "/ws") return true;
  if (pathname === "/api" || pathname.startsWith("/api/")) return true;
  if (pathname === "/auth" || pathname.startsWith("/auth/")) return true;
  if (pathname === "/uploads" || pathname.startsWith("/uploads/")) return true;
  return false;
}

/**
 * Runtime reverse-proxy to the API server. Reads REMOTE_API_URL from the
 * environment on each deploy (Zeabur Variables, docker-compose, etc.) — no
 * rebuild required when only the backend URL changes, as long as the process
 * restarts with the new env.
 */
function rewriteToBackend(req: NextRequest): NextResponse | null {
  if (!shouldProxyToBackend(req.nextUrl.pathname)) return null;
  // Bracket access so the bundler does not inline a build-time value; URL must
  // come from the container env at runtime (Zeabur Variables, docker-compose).
  const raw = process.env["REMOTE_API_URL"] ?? "http://localhost:8080";
  const base = raw.replace(/\/$/, "");
  const dest = new URL(req.nextUrl.pathname + req.nextUrl.search, base);
  return NextResponse.rewrite(dest);
}

// Old workspace-scoped route segments that existed before the URL refactor
// (pre-#1131). Any URL with these as the FIRST segment is a legacy URL that
// needs to be rewritten to /{slug}/{route}/... so old bookmarks, deep links,
// and post-revert-and-reapply users don't hit 404.
const LEGACY_ROUTE_SEGMENTS = new Set([
  "issues",
  "projects",
  "agents",
  "inbox",
  "my-issues",
  "autopilots",
  "runtimes",
  "skills",
  "settings",
]);

// Next.js 16 renamed `middleware` → `proxy`. The runtime API is identical.
export function proxy(req: NextRequest) {
  const backend = rewriteToBackend(req);
  if (backend) return backend;

  const { pathname } = req.nextUrl;
  const hasSession = req.cookies.has("multica_logged_in");
  const lastSlug = req.cookies.get("last_workspace_slug")?.value;

  // --- Legacy URL redirect: /issues/... → /{slug}/issues/... ---
  // Old bookmarks and clients that hit us before the slug migration would
  // otherwise 404 since the route moved under [workspaceSlug].
  const firstSegment = pathname.split("/")[1] ?? "";
  if (LEGACY_ROUTE_SEGMENTS.has(firstSegment)) {
    const url = req.nextUrl.clone();

    if (!hasSession) {
      url.pathname = "/login";
      return NextResponse.redirect(url);
    }

    if (lastSlug) {
      // Preserve deep-link path + query: /issues/abc → /{lastSlug}/issues/abc
      url.pathname = `/${lastSlug}${pathname}`;
      return NextResponse.redirect(url);
    }

    // Logged-in but no cookie yet (first login since slug migration, or
    // cookie cleared). Bounce to root; the root-path logic below picks a
    // workspace and writes the cookie, then future hits short-circuit here.
    url.pathname = "/";
    return NextResponse.redirect(url);
  }

  // --- Root path: redirect logged-in users to their last workspace ---
  if (pathname === "/") {
    if (!hasSession) return NextResponse.next();

    if (lastSlug) {
      const url = req.nextUrl.clone();
      url.pathname = `/${lastSlug}/issues`;
      return NextResponse.redirect(url);
    }

    // No last_workspace_slug cookie → let landing page pick the first workspace
    // client-side (features/landing/components/redirect-if-authenticated.tsx).
    return NextResponse.next();
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    "/api/:path*",
    "/auth/:path*",
    "/uploads/:path*",
    "/ws",
    "/",
    "/issues/:path*",
    "/projects/:path*",
    "/agents/:path*",
    "/inbox/:path*",
    "/my-issues/:path*",
    "/autopilots/:path*",
    "/runtimes/:path*",
    "/skills/:path*",
    "/settings/:path*",
  ],
};
