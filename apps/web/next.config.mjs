/** @type {import('next').NextConfig} */
const nextConfig = {
  transpilePackages: ["@axis/types"],
  async rewrites() {
    const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000/api";
    const ohifUrl = process.env.OHIF_URL ?? "http://localhost:3001";
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
        destination: `${ohifUrl}/ohif/index.html`,
      },
      {
        source: "/ohif/:path*",
        destination: `${ohifUrl}/ohif/:path*`,
      },
      {
        source: "/api/:path*",
        destination: `${apiUrl}/:path*`,
      },
    ];
  },
};

export default nextConfig;