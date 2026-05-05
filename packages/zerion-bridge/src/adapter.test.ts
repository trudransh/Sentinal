import { describe, expect, it } from "vitest";
import { Keypair, SystemProgram, Transaction } from "@solana/web3.js";
import { adaptCtx, defaultIsSolanaChain, type ZerionCtx } from "./adapter.js";

const AGENT = "AGENTPubKEy11111111111111111111111111111111";

function buildSolanaCtxWithHexTx(): {
  ctx: ZerionCtx;
  from: string;
  to: string;
} {
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
    ctx: {
      chain_id: "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp",
      transaction: { data: serialized, value: "0", to: to.toBase58() },
      policy_config: { scripts: ["deny-transfers.mjs"] },
    },
    from: from.publicKey.toBase58(),
    to: to.toBase58(),
  };
}

describe("adaptCtx (against real captured Zerion ctx shapes)", () => {
  it("returns null for EVM ctx (eip155:1)", () => {
    // Captured 2026-05-02T22:05:05Z from `zerion sign-message ... --chain ethereum`
    const realEvmCtx: ZerionCtx = {
      api_key_id: "fbd6a603-b1e0-455f-9ad7-806ff8a8a9ee",
      chain_id: "eip155:1",
      policy_config: {
        scripts: [
          "/home/dracian/.nvm/versions/node/v24.11.0/lib/node_modules/zerion-cli/cli/policies/deny-transfers.mjs",
        ],
      },
      spending: { daily_total: "0", date: "2026-05-02" },
      timestamp: "2026-05-02T22:05:05.888061251+00:00",
      transaction: { raw_hex: "73656e74696e656c2d70726f62652d74657374" },
      wallet_id: "b8831b51-4135-4de2-b4f6-3ad0ee902638",
    };
    expect(adaptCtx(realEvmCtx, { agent: AGENT })).toBeNull();
  });

  it("returns [] for Solana sign-message ctx (raw_hex, no data field)", () => {
    // Same shape as the EVM capture but with chain_id moved to solana.
    // raw_hex is the hex of a signed message — not a serialized tx, so
    // we return [] which the bridge's check(ctx) treats as deny.
    const solSignCtx: ZerionCtx = {
      chain_id: "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp",
      transaction: { raw_hex: "73656e74696e656c2d70726f62652d74657374" },
      policy_config: { scripts: ["deny-transfers.mjs"] },
    };
    const result = adaptCtx(solSignCtx, { agent: AGENT });
    expect(result).toEqual([]);
  });

  it("returns [] for swap stub ctx (real captured: data='0x', to=null)", () => {
    // Captured 2026-05-03T05:15:12Z from `zerion swap USDC ETH 2 --chain base`.
    // Zerion calls policy BEFORE assembling the route — calldata is empty.
    // Adapt the chain_id to solana so the EVM short-circuit doesn't fire,
    // since the real capture was on Base; we test the stub-handling logic.
    const swapStub: ZerionCtx = {
      chain_id: "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp",
      transaction: { to: null, value: "0", data: "0x" },
      policy_config: {
        scripts: [
          "/home/dracian/.nvm/versions/node/v24.11.0/lib/node_modules/zerion-cli/cli/policies/deny-transfers.mjs",
        ],
      },
    };
    const result = adaptCtx(swapStub, { agent: AGENT });
    expect(result).toEqual([]);
  });

  it("returns [] when transaction is missing entirely", () => {
    expect(
      adaptCtx(
        { chain_id: "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp" },
        { agent: AGENT },
      ),
    ).toEqual([]);
  });

  it("returns [] when data is empty string", () => {
    expect(
      adaptCtx(
        {
          chain_id: "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp",
          transaction: { data: "" },
        },
        { agent: AGENT },
      ),
    ).toEqual([]);
  });

  it("decodes a hex-encoded Solana tx and yields one summary per instruction", () => {
    const { ctx } = buildSolanaCtxWithHexTx();
    const summaries = adaptCtx(ctx, { agent: AGENT });
    expect(summaries).not.toBeNull();
    expect(summaries).toHaveLength(1);
    expect(summaries?.[0]?.programId).toBe(SystemProgram.programId.toBase58());
  });

  it("returns [] when data is malformed (neither hex nor base64 decodes to a tx)", () => {
    expect(
      adaptCtx(
        {
          chain_id: "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp",
          transaction: { data: "0xZZZZ" },
        },
        { agent: AGENT },
      ),
    ).toEqual([]);
  });

  describe("defaultIsSolanaChain (CAIP-2 first, fallback substring)", () => {
    it("matches `solana:<genesis>` (CAIP-2)", () => {
      expect(defaultIsSolanaChain("solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp")).toBe(true);
    });

    it("rejects EVM CAIP-2", () => {
      expect(defaultIsSolanaChain("eip155:1")).toBe(false);
      expect(defaultIsSolanaChain("eip155:8453")).toBe(false);
    });

    it("falls back on substring match for loose emitters", () => {
      expect(defaultIsSolanaChain("Solana Mainnet")).toBe(true);
      expect(defaultIsSolanaChain("sol")).toBe(true);
    });

    it("rejects undefined", () => {
      expect(defaultIsSolanaChain(undefined)).toBe(false);
    });
  });
});
