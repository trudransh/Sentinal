// A3: live x402 PaymentBuilder. Native web3.js v1 (no third-party SDK):
// `@quicknode/x402-solana` requires `@solana/kit` (incompatible with our
// locked v1) and `@faremeter/payment-solana` is LGPL-3.0 (clashes with the
// MIT-as-open-primitive framing). For the hackathon demo we keep it small:
//
//   - real blockhash from the connection
//   - SOL via SystemProgram.transfer (fastest path; demo agent already funded)
//   - SPL via TransferChecked with derived ATAs + auto-create destination ATA
//   - submitPaymentTx broadcasts via sendRawTransaction + confirms

import {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
} from "@solana/web3.js";
import {
  TOKEN_PROGRAM_ID,
  createAssociatedTokenAccountInstruction,
  createTransferCheckedInstruction,
  getAssociatedTokenAddressSync,
} from "@solana/spl-token";
import type { PaymentBuilder, PaymentReceipt, PaymentRequirements } from "./types.js";
import type { TxSummary } from "@sentinel/policy-dsl";

const USDC_DEV = new PublicKey("4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU");
const USDC_MAINNET = new PublicKey("EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v");

export interface LivePaymentBuilderOptions {
  agent: Keypair;
  connection: Connection;
  /** Override the USDC mint when paying USDC (defaults to devnet mint). */
  usdcMint?: PublicKey;
  /** Commitment for confirmation. Defaults to "confirmed". */
  confirmCommitment?: "processed" | "confirmed" | "finalized";
  /** Logger hook for visibility during the live demo. */
  logger?: (msg: string) => void;
}

export function createLivePaymentBuilder(
  opts: LivePaymentBuilderOptions,
): PaymentBuilder {
  const log = opts.logger ?? (() => {});
  const usdcMint = opts.usdcMint ?? USDC_DEV;
  const commitment = opts.confirmCommitment ?? "confirmed";

  return {
    async buildPaymentTx(req: PaymentRequirements) {
      const payTo = new PublicKey(req.payTo);
      const tx = new Transaction();
      tx.feePayer = opts.agent.publicKey;
      const { blockhash } = await opts.connection.getLatestBlockhash(commitment);
      tx.recentBlockhash = blockhash;

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
        log(
          `[builder] SOL transfer ${req.amount} SOL → ${req.payTo} (lamports=${lamports})`,
        );
        summary = {
          agent: opts.agent.publicKey.toBase58(),
          token: "SOL",
          amount: req.amount,
          destination: req.payTo,
          programId: SystemProgram.programId.toBase58(),
          // The interceptor flow re-parses the tx via tx-parser which calls
          // the oracle; usdValue here is informational only.
          usdValue: req.amount * 100,
          timestamp: Date.now(),
        };
      } else {
        // SPL TransferChecked. usdcMint defaults to devnet mint; pass an override
        // when paying USDC on mainnet or a different SPL token.
        const decimals = 6;
        const raw = BigInt(Math.round(req.amount * 10 ** decimals));
        const sourceAta = getAssociatedTokenAddressSync(
          usdcMint,
          opts.agent.publicKey,
        );
        const destAta = getAssociatedTokenAddressSync(usdcMint, payTo);

        // If the destination ATA doesn't exist yet, create it as part of the same
        // tx so the transfer doesn't fail. Idempotent — getAccountInfo returns
        // null for non-existent accounts.
        const destInfo = await opts.connection.getAccountInfo(destAta, commitment);
        if (!destInfo) {
          log(`[builder] dest ATA ${destAta.toBase58()} missing, adding create ix`);
          tx.add(
            createAssociatedTokenAccountInstruction(
              opts.agent.publicKey, // payer
              destAta,
              payTo,
              usdcMint,
            ),
          );
        }

        tx.add(
          createTransferCheckedInstruction(
            sourceAta,
            usdcMint,
            destAta,
            opts.agent.publicKey,
            raw,
            decimals,
          ),
        );
        log(
          `[builder] SPL TransferChecked ${req.amount} via ATAs ${sourceAta
            .toBase58()
            .slice(0, 8)}… → ${destAta.toBase58().slice(0, 8)}…`,
        );

        summary = {
          agent: opts.agent.publicKey.toBase58(),
          token: usdcMint.equals(USDC_DEV) || usdcMint.equals(USDC_MAINNET) ? "USDC" : { mint: usdcMint.toBase58() },
          amount: req.amount,
          // For policy allowlists, surface the wallet pubkey (not the ATA).
          // tx-parser will see the ATA in the instruction and (when configured
          // with a connection) reverse-lookup the owner; if reverse-lookup is
          // not configured, the policy author should allowlist the ATA directly.
          destination: req.payTo,
          programId: TOKEN_PROGRAM_ID.toBase58(),
          usdValue: req.amount,
          timestamp: Date.now(),
        };
      }

      return { tx, summary };
    },

    async submitPaymentTx(signedTx: Transaction): Promise<PaymentReceipt> {
      log("[builder] broadcasting…");
      const raw = signedTx.serialize();
      const signature = await opts.connection.sendRawTransaction(raw, {
        skipPreflight: false,
        preflightCommitment: commitment,
        maxRetries: 3,
      });
      log(`[builder] sent ${signature}, waiting for ${commitment}…`);
      await opts.connection.confirmTransaction(signature, commitment);
      log(`[builder] ${commitment}: ${signature}`);

      const ix0 = signedTx.instructions[0];
      const isSplTransferIx = ix0?.programId.equals(TOKEN_PROGRAM_ID);
      const isCreateAtaIx = isSplTransferIx && ix0?.keys.length === 7; // associated-token program ix
      const transferIx = isCreateAtaIx ? signedTx.instructions[1] : ix0;

      // For SOL transfer: keys[1] = recipient. For SPL TransferChecked:
      // keys[2] = destination ATA. The receipt is informational; the wire
      // record of truth is the on-chain signature.
      const payTo =
        transferIx?.programId.equals(SystemProgram.programId)
          ? transferIx.keys[1]?.pubkey.toBase58()
          : transferIx?.keys[2]?.pubkey.toBase58();

      return {
        signature,
        payTo: payTo ?? "unknown",
        token: transferIx?.programId.equals(SystemProgram.programId) ? "SOL" : "USDC",
        amount: 0,
        txBase64: Buffer.from(raw).toString("base64"),
      };
    },
  };
}
