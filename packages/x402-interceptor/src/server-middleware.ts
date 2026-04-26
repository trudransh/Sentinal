import type { RequestHandler } from "express";
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
}

export function x402Protect(opts: X402ProtectOptions): RequestHandler {
  const network = opts.network ?? "solana:devnet";
  const scheme = opts.scheme ?? "exact";

  return async (req, res, next) => {
    const paymentHeader = req.header("x-payment");
    if (paymentHeader) {
      const verified = opts.verifyPayment
        ? await opts.verifyPayment(paymentHeader)
        : true;
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
    res.setHeader("X-PAYMENT-REQUIREMENTS", JSON.stringify(requirements));
    res.setHeader("Content-Type", "application/json");
    res.json({ error: "payment required", requirements });
  };
}
