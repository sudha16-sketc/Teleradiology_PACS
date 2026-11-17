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
 * The values are read by Next.js while building its rewrites; build a separate
 * artifact for each deployment target. They are server-side upstreams, not
 * browser API URLs or secrets.
 *
 * Hosted and production deployments must provide real upstreams. Localhost
 * fallbacks are only for local development and explicitly development builds.
 */
const requiresConfiguredUpstreams =
  process.env.VERCEL === "1" ||
  process.env.AXIS_ENV === "production" ||
  (process.env.NODE_ENV === "production" &&
    process.env.AXIS_ENV !== "development");

function isLoopbackHost(hostname) {
  const host = hostname.replace(/^\[|\]$/g, "").toLowerCase();
  return (
    host === "localhost" ||
    host.endsWith(".localhost") ||
    host === "::1" ||
    host === "0.0.0.0" ||
    /^127(?:\.\d{1,3}){3}$/.test(host)
  );
}

function resolveUpstream(name, fallback) {
  const raw = process.env[name]?.trim();
  if (!raw) {
    if (requiresConfiguredUpstreams) {
      throw new Error(
        `[axis/web] ${name} is required for hosted/production builds; configure its deployed service URL.`,
      );
    }
    if (process.env.NODE_ENV !== "development") {
      console.warn(
        `[axis/web] ${name} is not set; using the local development fallback ${fallback}.`,
      );
    }
    return { url: fallback.replace(/\/+$/, ""), source: "development-default" };
  }

  let parsed;
  try {
    parsed = new URL(raw);
  } catch {
    throw new Error(`[axis/web] ${name} must be an absolute HTTP(S) URL.`);
  }
  if (
    !["http:", "https:"].includes(parsed.protocol) ||
    parsed.username ||
    parsed.password ||
    parsed.search ||
    parsed.hash
  ) {
    throw new Error(
      `[axis/web] ${name} must be an HTTP(S) URL without credentials, query, or fragment.`,
    );
  }
  if (requiresConfiguredUpstreams && isLoopbackHost(parsed.hostname)) {
    throw new Error(
      `[axis/web] ${name} must not point to localhost or another loopback address in a hosted/production build.`,
    );
  }
  if (process.env.VERCEL === "1" && parsed.protocol !== "https:") {
    throw new Error(`[axis/web] ${name} must use HTTPS on Vercel.`);
  }

  return { url: parsed.toString().replace(/\/+$/, ""), source: name };
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
