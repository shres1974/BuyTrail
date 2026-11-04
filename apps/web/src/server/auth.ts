/**
 * Authentication via Better Auth (S13, S14) with email magic links. BuyTrail does not implement
 * session cryptography. Sign-in tokens are only sent by email and are never logged.
 *
 * Local/test sign-in: in non-live modes the email goes to Mailpit (http://localhost:8025);
 * E2E tests read the link from Mailpit's API.
 */
import { betterAuth } from "better-auth";
import { prismaAdapter } from "better-auth/adapters/prisma";
import { nextCookies } from "better-auth/next-js";
import { magicLink } from "better-auth/plugins/magic-link";
import { loadConfig } from "@buytrail/config";
import { getPrisma } from "@buytrail/db";
import { adminEmailMatch } from "@buytrail/services";
import { services } from "./services";

function build() {
  const config = loadConfig();
  const db = getPrisma();
  return betterAuth({
    appName: "BuyTrail",
    baseURL: config.APP_BASE_URL,
    secret: config.AUTH_SECRET,
    database: prismaAdapter(db, { provider: "postgresql" }),
    trustedOrigins: [config.APP_BASE_URL],
    session: { expiresIn: 60 * 60 * 24 * 14, updateAge: 60 * 60 * 24 },
    advanced: { useSecureCookies: config.APP_BASE_URL.startsWith("https://"), cookiePrefix: "buytrail" },
    rateLimit: {
      enabled: true,
      window: 60,
      max: 60,
      customRules: { "/sign-in/magic-link": { window: 60, max: 5 } },
    },
    user: {
      additionalFields: {
        role: { type: "string", required: false, defaultValue: "user", input: false },
        timezone: { type: "string", required: false, defaultValue: "America/Toronto", input: false },
      },
    },
    databaseHooks: {
      user: {
        create: {
          // Admin is never inferred from a client field. Local/demo setups may grant it to
          // explicitly configured ADMIN_EMAILS; live mode requires `pnpm admin:grant`.
          before: async (user) => ({ data: { ...user, role: adminEmailMatch(config, user.email) ? "admin" : "user" } }),
        },
      },
    },
    plugins: [
      magicLink({
        expiresIn: 60 * 10,
        storeToken: "hashed",
        sendMagicLink: async ({ email, url }) => {
          const s = services();
          if (s.config.APP_MODE === "live" && s.config.emailAllowlist.length && !s.config.emailAllowlist.includes(email.toLowerCase())) {
            s.log.warn("sign-in email suppressed: recipient not in allowlist", {});
            return;
          }
          // Account-access email is separate from optional product alerts.
          await s.mailer.send({
            to: email,
            subject: "Your BuyTrail sign-in link",
            text: `Use this link to sign in to BuyTrail. It expires in 10 minutes and can be used once.\n\n${url}\n\nIf you didn't request it, ignore this email.`,
            idempotencyKey: `signin-${Date.now()}-${Math.random().toString(36).slice(2)}`,
          });
        },
      }),
      nextCookies(),
    ],
  });
}

type Auth = ReturnType<typeof build>;
const g = globalThis as unknown as { __btAuth?: Auth };
export function auth(): Auth {
  if (!g.__btAuth) g.__btAuth = build();
  return g.__btAuth;
}
