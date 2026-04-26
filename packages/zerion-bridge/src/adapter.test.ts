import { describe, expect, it } from "vitest";
import { Keypair, SystemProgram, Transaction } from "@solana/web3.js";
import { adaptCtx, defaultIsSolanaChain } from "./adapter.js";

const AGENT = "AGENTPubKEy11111111111111111111111111111111";

function buildSolanaCtxWithHexTx(): { ctx: { transaction: { chain: string; data: string } }; from: string; to: string } {
  const from = Keypair.generate();
  const to = Keypair.generate().publicKey;
  const tx = new Transaction();
  tx.recentBlockhash = "11111111111111111111111111111111";
  tx.feePayer = from.publicKey;
  tx.add(
    SystemProgram.transfer({
      fromPubkey: from.publicKey,
      toPubkey: to,
      lamports: 1_000,
    }),
  );
  const serialized = tx.serialize({ requireAllSignatures: false }).toString("hex");
  return {
    ctx: { transaction: { chain: "solana:devnet", data: serialized } },
    from: from.publicKey.toBase58(),
    to: to.toBase58(),
  };
}

describe("adaptCtx", () => {
  it("returns null for non-Solana chains", () => {
    const result = adaptCtx(
      { transaction: { chain: "eip155:1", data: "0xdead" } },
      { agent: AGENT },
    );
    expect(result).toBeNull();
  });

  it("returns null when no transaction.data is present", () => {
    expect(
      adaptCtx({ transaction: { chain: "solana:devnet" } }, { agent: AGENT }),
    ).toBeNull();
  });

  it("decodes a hex-encoded Solana tx and yields one summary per ix", () => {
    const { ctx } = buildSolanaCtxWithHexTx();
    const summaries = adaptCtx(ctx, { agent: AGENT });
    expect(summaries).not.toBeNull();
    expect(summaries?.length).toBe(1);
    expect(summaries?.[0]?.programId).toBe(SystemProgram.programId.toBase58());
  });

  it("defaultIsSolanaChain matches common chain identifiers", () => {
    expect(defaultIsSolanaChain("solana:5eykt4Us")).toBe(true);
    expect(defaultIsSolanaChain("Solana Mainnet")).toBe(true);
    expect(defaultIsSolanaChain("eip155:1")).toBe(false);
    expect(defaultIsSolanaChain(undefined)).toBe(false);
  });
});
