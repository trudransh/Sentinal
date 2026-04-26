import { Keypair, PublicKey, SystemProgram, Transaction } from "@solana/web3.js";
import { TOKEN_PROGRAM_ID, createTransferCheckedInstruction } from "@solana/spl-token";
import type { PaymentBuilder, PaymentReceipt, PaymentRequirements } from "./types.js";
import type { TxSummary } from "@sentinel/policy-dsl";

const USDC_DEV = new PublicKey("4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU");

/**
 * Local-only PaymentBuilder for demos and tests. Builds a syntactically valid
 * Solana transfer transaction; submitPaymentTx returns a fake signature so
 * the demo flow runs end-to-end without devnet round-trips.
 *
 * For real submissions, wire @quicknode/x402-solana or @faremeter/payment-solana
 * via the same PaymentBuilder interface and replace this stub.
 */
export function createStubPaymentBuilder(opts: {
  agent: Keypair;
  blockhash?: string;
}): PaymentBuilder {
  const blockhash = opts.blockhash ?? "11111111111111111111111111111111";

  return {
    async buildPaymentTx(
      req: PaymentRequirements,
    ): Promise<{ tx: Transaction; summary: TxSummary }> {
      const tx = new Transaction();
      tx.recentBlockhash = blockhash;
      tx.feePayer = opts.agent.publicKey;
      const payTo = new PublicKey(req.payTo);

      let summary: TxSummary;
      if (req.token === "SOL") {
        const lamports = Math.round(req.amount * 1_000_000_000);
        tx.add(
          SystemProgram.transfer({
            fromPubkey: opts.agent.publicKey,
            toPubkey: payTo,
            lamports,
          }),
        );
        summary = {
          agent: opts.agent.publicKey.toBase58(),
          token: "SOL",
          amount: req.amount,
          destination: req.payTo,
          programId: SystemProgram.programId.toBase58(),
          usdValue: req.amount * 100,
          timestamp: Date.now(),
        };
      } else {
        const decimals = 6;
        const raw = BigInt(Math.round(req.amount * 10 ** decimals));
        const sourceAta = Keypair.generate().publicKey;
        const destAta = payTo;
        tx.add(
          createTransferCheckedInstruction(
            sourceAta,
            USDC_DEV,
            destAta,
            opts.agent.publicKey,
            raw,
            decimals,
          ),
        );
        summary = {
          agent: opts.agent.publicKey.toBase58(),
          token: "USDC",
          amount: req.amount,
          destination: req.payTo,
          programId: TOKEN_PROGRAM_ID.toBase58(),
          usdValue: req.amount,
          timestamp: Date.now(),
        };
      }
      return { tx, summary };
    },
    async submitPaymentTx(signedTx: Transaction): Promise<PaymentReceipt> {
      const sig = signedTx.signatures[0]?.signature;
      const sigStr = sig ? Buffer.from(sig).toString("base64") : "stub-signature";
      return {
        signature: sigStr,
        payTo: signedTx.instructions[0]?.keys[1]?.pubkey.toBase58() ?? "unknown",
        token: "USDC",
        amount: 0,
        txBase64: signedTx.serialize({ requireAllSignatures: false }).toString("base64"),
      };
    },
  };
}
