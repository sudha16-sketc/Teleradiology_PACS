/**
 * Next.js configuration for @axis/web.
 *
 * This single Next.js build serves BOTH Axis clients:
 *
 *   - the **web client** (http(s)://<host>/), and
 *   - the **desktop client** (apps/desktop), a Tauri window that loads this
 *     very same frontend from an Axis deployment.
 *
 * Both therefore share one origin, one session cookie and one set of rewrites.
 * The rewrites below are what keep the `axis_session` httpOnly cookie
 * first-party: the browser only ever issues same-origin requests, and this
 * server forwards `/api/*` to the NestJS API and `/ohif/*` to the OHIF viewer.
 * Nothing here needs to know which client is running.
 */

/** Last-resort defaults for local development only. */
const DEV_API_FALLBACK = "http://localhost:4000/api";
const DEV_OHIF_FALLBACK = "http://localhost:3001";

/**
 * Resolve a proxied upstream from the environment.
 *
 * The value is read here, on the server, at request time — not inlined into the
 * client bundle — so a single build can be pointed at a different API or viewer
 * by changing the environment of the running Next.js process.
 *
 * A loopback fallback in a non-development environment is reported loudly: the
 * client bundle itself never contains a host (it asks for the root-relative
 * "/api"), so a missing value here is the only way a production deployment can
 * end up proxying to the server's own localhost. We deliberately keep serving
 * rather than refusing to boot, so an under-configured deployment fails the same
 * way it always has, just with a visible cause.
 */
function resolveUpstream(name, fallback) {
  const raw = process.env[name]?.trim();
  if (raw) {
    return { url: raw.replace(/\/+$/, ""), source: name };
  }
  if (process.env.NODE_ENV !== "development") {
    console.warn(
      `[axis/web] ${name} is not set; falling back to the development default ${fallback}. ` +
        `Set ${name} on the Next.js server before serving a real deployment.`,
    );
  }
  return { url: fallback.replace(/\/+$/, ""), source: "development-default" };
}

/** @type {import('next').NextConfig} */
const nextConfig = {
  transpilePackages: ["@axis/types"],
  async rewrites() {
    const apiUrl = resolveUpstream("NEXT_PUBLIC_API_URL", DEV_API_FALLBACK);
    const ohifUrl = resolveUpstream("OHIF_URL", DEV_OHIF_FALLBACK);
    return [
      {
        // The viewer is proxied under /ohif so it stays same-origin with the
        // Axis API and inherits the session cookie: OHIF calls the DICOMweb
        // proxy with credentials: "same-origin", so a cross-origin viewer
        // would be sent no cookie and every study request would 401.
        // The /ohif segment is repeated in the destination because the OHIF
        // container installs the app into that subdirectory (see
        // infra/ohif/Dockerfile and ENV PUBLIC_URL).
        //
        // The bare path resolves to index.html explicitly. Without it, /ohif
        // maps to a directory in the container, which 301-redirects to /ohif/,
        // while Next's own trailing-slash normalisation 308-redirects /ohif/
        // back to /ohif — an endless loop on the viewer entry point. This
        // rewrite must stay before the wildcard below, which also matches /ohif.
        source: "/ohif",
        destination: `${ohifUrl.url}/ohif/index.html`,
      },
      {
        source: "/ohif/:path*",
        destination: `${ohifUrl.url}/ohif/:path*`,
      },
      {
        source: "/api/:path*",
        destination: `${apiUrl.url}/:path*`,
      },
    ];
  },
};

export default nextConfig;
