import { z } from "zod";

const Pubkey = z.string().min(32).max(44);

export const TokenSchema = z.union([
  z.literal("SOL"),
  z.literal("USDC"),
  z.object({ mint: Pubkey }).strict(),
]);

export const CapSchema = z
  .object({
    token: TokenSchema,
    max_per_tx: z.number().positive().optional(),
    max_per_day: z.number().nonnegative().optional(),
    max_per_hour: z.number().nonnegative().optional(),
  })
  .strict();

export const PolicyV1 = z
  .object({
    version: z.literal(1),
    agent: Pubkey,
    caps: z.array(CapSchema).default([]),
    allowlist: z
      .object({
        destinations: z.array(Pubkey).default([]),
      })
      .strict()
      .optional(),
    denylist: z
      .object({
        destinations: z.array(Pubkey).default([]),
      })
      .strict()
      .optional(),
    programs: z
      .object({
        allow: z.array(Pubkey).optional(),
      })
      .strict()
      .optional(),
    escalate_above: z
      .object({
        usd_value: z.number().positive().optional(),
      })
      .strict()
      .optional(),
    rate_limit: z
      .object({
        max_tx_per_minute: z.number().int().positive().optional(),
      })
      .strict()
      .optional(),
  })
  .strict();

export type Policy = z.infer<typeof PolicyV1>;
export type Cap = z.infer<typeof CapSchema>;

export class InvalidPolicyError extends Error {
  readonly code = "INVALID_POLICY";
  constructor(
    message: string,
    readonly issues: z.ZodIssue[],
  ) {
    super(message);
    this.name = "InvalidPolicyError";
  }
}

export function parsePolicy(raw: unknown): Policy {
  const result = PolicyV1.safeParse(raw);
  if (!result.success) {
    throw new InvalidPolicyError(
      `Invalid policy: ${result.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}`,
      result.error.issues,
    );
  }
  return result.data;
}
