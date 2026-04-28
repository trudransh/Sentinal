import { z } from "zod";

// D6: validate env at boot. Crash early on missing keys in production —
// the dashboard cannot be partially-configured because every API route
// depends on a different subset.

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),

  // Solana RPC + program
  SOLANA_RPC_URL: z.string().url().default("https://api.devnet.solana.com"),
  SENTINEL_PROGRAM_ID: z.string().min(32).optional(),

  // Helius webhook auth — required in production, optional in dev (gated by SENTINEL_ALLOW_UNAUTH_WEBHOOK)
  HELIUS_WEBHOOK_SECRET: z.string().min(8).optional(),
  HELIUS_API_KEY: z.string().min(8).optional(),
  SENTINEL_ALLOW_UNAUTH_WEBHOOK: z.enum(["0", "1"]).optional(),

  // Dune SIM — optional; routes return stub if absent
  SIM_API_KEY: z.string().min(8).optional(),

  // SQLite path
  DATABASE_PATH: z.string().default("./.data/sentinel.db"),
});

const _env = envSchema.safeParse(process.env);
if (!_env.success) {
  // eslint-disable-next-line no-console
  console.error("[env] invalid environment:", _env.error.flatten().fieldErrors);
  throw new Error("Invalid environment — see [env] above");
}

if (
  _env.data.NODE_ENV === "production" &&
  !_env.data.HELIUS_WEBHOOK_SECRET &&
  _env.data.SENTINEL_ALLOW_UNAUTH_WEBHOOK !== "1"
) {
  throw new Error(
    "[env] HELIUS_WEBHOOK_SECRET is required in production. Set it or explicitly opt-in via SENTINEL_ALLOW_UNAUTH_WEBHOOK=1",
  );
}

export const env = _env.data;
export type Env = z.infer<typeof envSchema>;
