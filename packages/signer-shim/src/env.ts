import { z } from "zod";

// D6: validate env once at module load. The signer is a critical-path
// component — silent fallbacks (e.g. stub oracle when Hermes URL missing)
// hide misconfiguration. Be explicit at boot.

const envSchema = z.object({
  SOLANA_RPC_URL: z.string().url().optional(),
  HERMES_URL: z.string().url().default("https://hermes.pyth.network"),
  SENTINEL_PROGRAM_ID: z.string().min(32).optional(),
  SENTINEL_POLICY_PATH: z.string().optional(),
  SENTINEL_RATE_LIMIT_DB: z.string().optional(),
});

export type SignerEnv = z.infer<typeof envSchema>;

export function readSignerEnv(env: NodeJS.ProcessEnv = process.env): SignerEnv {
  const parsed = envSchema.safeParse(env);
  if (!parsed.success) {
    throw new Error(
      `[signer-shim env] invalid: ${JSON.stringify(parsed.error.flatten().fieldErrors)}`,
    );
  }
  return parsed.data;
}
