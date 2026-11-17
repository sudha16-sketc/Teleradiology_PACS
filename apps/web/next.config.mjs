import { readFileSync } from "node:fs";

const rootPackage = JSON.parse(
  readFileSync(new URL("../../package.json", import.meta.url), "utf8"),
);

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

const axisEnvironment = process.env.AXIS_ENV ?? process.env.NODE_ENV ?? "development";

/**
 * Resolve a proxied upstream from the environment.
 *
 * Next.js serializes these rewrite destinations into its build output, so build
 * a separate artifact for development, staging, and production. The upstream
 * URLs are server configuration, never credentials, and are not read by browser
 * API calls.
 *
 * Loopback defaults are available only in development. A staging or production
 * build without both upstreams fails immediately instead of proxying to its own
 * localhost.
 */
function resolveUpstream(name, fallback) {
  const raw = process.env[name]?.trim();
  if (raw) {
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
    return {
      url: parsed.toString().replace(/\/+$/, ""),
      source: name,
    };
  }
  if (axisEnvironment !== "development") {
    throw new Error(
      `[axis/web] ${name} is required for the ${axisEnvironment} environment.`,
    );
  }
  return { url: fallback.replace(/\/+$/, ""), source: "development-default" };
}

/** @type {import('next').NextConfig} */
const nextConfig = {
  env: {
    NEXT_PUBLIC_APP_VERSION: rootPackage.version,
    NEXT_PUBLIC_APP_ENV: axisEnvironment,
  },
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
