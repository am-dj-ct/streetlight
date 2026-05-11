import type { NextConfig } from "next";

const deployAssetVersion = process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 12);
const deployAssetPrefix =
  process.env.NODE_ENV === "production" && deployAssetVersion
    ? `/_streetlight-assets/${deployAssetVersion}`
    : undefined;

const nextConfig: NextConfig = {
  assetPrefix: deployAssetPrefix,
  devIndicators: false,
  async rewrites() {
    if (!deployAssetPrefix) {
      return [];
    }

    return [
      {
        source: `${deployAssetPrefix}/_next/:path*`,
        destination: "/_next/:path*",
      },
    ];
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          {
            key: "Content-Security-Policy",
            value: [
              "default-src 'self'",
              "script-src 'self' 'unsafe-inline' https://challenges.cloudflare.com",
              "style-src 'self' 'unsafe-inline'",
              "img-src 'self' data: blob:",
              "font-src 'self' data:",
              "connect-src 'self' https://challenges.cloudflare.com",
              "media-src 'self' data: blob:",
              "frame-src https://challenges.cloudflare.com",
              "object-src 'none'",
              "base-uri 'self'",
              "form-action 'self'",
              "frame-ancestors 'none'",
            ].join("; "),
          },
          {
            key: "Referrer-Policy",
            value: "strict-origin-when-cross-origin",
          },
          {
            key: "Permissions-Policy",
            value: "camera=(), geolocation=(), payment=(), usb=()",
          },
          {
            key: "X-Content-Type-Options",
            value: "nosniff",
          },
          {
            key: "X-Frame-Options",
            value: "DENY",
          },
        ],
      },
    ];
  },
};

export default nextConfig;
