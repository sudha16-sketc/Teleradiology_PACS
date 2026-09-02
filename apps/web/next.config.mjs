/** @type {import('next').NextConfig} */
const nextConfig = {
  transpilePackages: ["@axis/types"],
  async rewrites() {
    const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000/api";
    const ohifUrl = process.env.OHIF_URL ?? "http://localhost:3001";
    return [
      {
        source: "/ohif/:path*",
        destination: `${ohifUrl}/:path*`,
      },
      {
        source: "/api/:path*",
        destination: `${apiUrl}/:path*`,
      },
    ];
  },
};

export default nextConfig;