import { betterAuth } from "better-auth";
import type { Env } from "./types";

export function auth(env: Env, origin: string) {
  return betterAuth({
    database: env.DB,
    secret: env.AUTH_SECRET,
    baseURL: env.APP_ORIGIN || origin,
    trustedOrigins: [env.APP_ORIGIN || origin],
    emailAndPassword: {
      enabled: true,
      minPasswordLength: 12,
      maxPasswordLength: 128,
      revokeSessionsOnPasswordReset: true,
    },
    session: { expiresIn: 60 * 60 * 24 * 7, updateAge: 60 * 60 * 24 },
    rateLimit: {
      enabled: true,
      storage: "database",
      window: 60,
      max: 60,
      customRules: {
        "/sign-up/email": { window: 3600, max: 5 },
        "/sign-in/email": { window: 300, max: 10 },
      },
    },
    advanced: {
      useSecureCookies: origin.startsWith("https:"),
      ipAddress: { ipAddressHeaders: ["cf-connecting-ip"] },
    },
  });
}
