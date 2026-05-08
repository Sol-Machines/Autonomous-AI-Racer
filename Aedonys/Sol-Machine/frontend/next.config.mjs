/** @type {import('next').NextConfig} */

const raceBackend = process.env.RACE_BACKEND_URL || "http://localhost:3000";
const aedonysBackend = process.env.AEDONYS_BACKEND_URL || "http://localhost:3001";

const nextConfig = {
  async rewrites() {
    return [
      {
        source: "/api/car/:path*",
        destination: `${raceBackend}/car/:path*`,
      },
      {
        source: "/api/cars/:path*",
        destination: `${raceBackend}/cars/:path*`,
      },
      {
        source: "/api/camera/:path*",
        destination: `${raceBackend}/camera/:path*`,
      },
      {
        source: "/api/training/:path*",
        destination: `${raceBackend}/training/:path*`,
      },
      {
        source: "/api/boost/:path*",
        destination: `${raceBackend}/boost/:path*`,
      },
      {
        source: "/api/health",
        destination: `${raceBackend}/health`,
      },
      {
        source: "/api/:path*",
        destination: `${aedonysBackend}/api/:path*`,
      },
    ];
  },
  images: {
    unoptimized: true,
  },
};

export default nextConfig;
