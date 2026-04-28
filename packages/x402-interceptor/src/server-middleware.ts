import type { RequestHandler } from "express";
import { Connection } from "@solana/web3.js";
import type { Token } from "@sentinel/policy-dsl";
import type { PaymentRequirements } from "./types.js";

export interface X402ProtectOptions {
  receivingAddress: string;
  pricePerCall: { token: Token; amount: number };
  network?: string;
  scheme?: "exact" | "stream";
  resourceUrl?: string;
  description?: string;
  facilitatorUrl?: string;
  verifyPayment?: (header: string) => Promise<boolean>;
  /**
   * On-chain verification: when set, the middleware extracts the signature
   * from the X-PAYMENT header and queries the RPC for confirmation status
   * before serving. Use this for live demos where you want to prove a real
   * settlement happened, not just that the client claims one did.
   */
  verifyOnChain?: {
    connection: Connection;
    commitment?: "processed" | "confirmed" | "finalized";
  };
}

export function x402Protect(opts: X402ProtectOptions): RequestHandler {
  const network = opts.network ?? "solana:devnet";
  const scheme = opts.scheme ?? "exact";

  return async (req, res, next) => {
    const paymentHeader = req.header("x-payment");
    if (paymentHeader) {
      let onChainOk = true;
      if (opts.verifyOnChain) {
        try {
          const parsed = JSON.parse(paymentHeader) as { signature?: string };
          const sig = parsed.signature;
          if (!sig || sig === "stub-signature") {
            onChainOk = false;
            console.warn(`[x402Protect] reject: missing/stub signature in X-PAYMENT`);
          } else {
            const wantCommitment = opts.verifyOnChain.commitment ?? "confirmed";
            const status = await opts.verifyOnChain.connection.getSignatureStatus(
              sig,
              { searchTransactionHistory: true },
            );
            const conf = status.value?.confirmationStatus;
            const okStates =
              wantCommitment === "finalized"
                ? ["finalized"]
                : wantCommitment === "confirmed"
                  ? ["confirmed", "finalized"]
                  : ["processed", "confirmed", "finalized"];
            onChainOk = !!conf && okStates.includes(conf) && !status.value?.err;
            if (onChainOk) {
              console.log(`[x402Protect] verified on-chain: ${sig.slice(0, 12)}… (${conf})`);
            } else {
              console.warn(
                `[x402Protect] reject: sig=${sig.slice(0, 12)}… status=${conf ?? "null"} err=${JSON.stringify(status.value?.err)}`,
              );
            }
          }
        } catch (err) {
          onChainOk = false;
          console.warn(`[x402Protect] verifyOnChain error: ${(err as Error).message}`);
        }
      }

      const verified =
        onChainOk && (opts.verifyPayment ? await opts.verifyPayment(paymentHeader) : true);
      if (verified) {
        next();
        return;
      }
    }

    const requirements: PaymentRequirements = {
      scheme,
      network,
      amount: opts.pricePerCall.amount,
      token: opts.pricePerCall.token,
      payTo: opts.receivingAddress,
      resourceUrl: opts.resourceUrl ?? `${req.protocol}://${req.get("host")}${req.originalUrl}`,
      ...(opts.description ? { description: opts.description } : {}),
      ...(opts.facilitatorUrl ? { facilitator: opts.facilitatorUrl } : {}),
      nonce: Math.random().toString(36).slice(2),
    };

    res.status(402);
    // HTTP headers must be latin1-safe in Node. Strip non-latin1 chars (for
    // example em-dash copied into descriptions) to avoid ERR_INVALID_CHAR.
    const headerValue = JSON.stringify(requirements).replace(/[^\u0009\u0020-\u00ff]/g, "");
    res.setHeader("X-PAYMENT-REQUIREMENTS", headerValue);
    res.setHeader("Content-Type", "application/json");
    res.json({ error: "payment required", requirements });
  };
}
