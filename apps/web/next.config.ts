import path from "node:path";
import { config as loadEnv } from "dotenv";
import type { NextConfig } from "next";

// The monorepo keeps one .env at the repository root (never overrides real env vars).
loadEnv({ path: path.resolve(import.meta.dirname, "../../.env"), quiet: true });

const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
  {
    key: "Content-Security-Policy",
    value: [
      "default-src 'self'",
      // Next.js inline bootstrap scripts; no third-party scripts are loaded.
      "script-src 'self' 'unsafe-inline'" + (process.env.NODE_ENV === "development" ? " 'unsafe-eval'" : ""),
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data: blob:",
      "connect-src 'self'",
      "frame-ancestors 'none'",
      "form-action 'self'",
      "base-uri 'self'",
      "object-src 'none'",
    ].join("; "),
  },
];

const config: NextConfig = {
  // Workspace packages ship TypeScript sources.
  transpilePackages: ["@buytrail/config", "@buytrail/domain", "@buytrail/providers", "@buytrail/services", "@buytrail/db"],
  // Native / Node-only dependencies stay external to the server bundle.
  serverExternalPackages: ["sharp", "@prisma/client", "@prisma/adapter-pg", "pg", "bullmq", "ioredis", "nodemailer", "@aws-sdk/client-s3"],
  poweredByHeader: false,
  typedRoutes: false,
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default config;
