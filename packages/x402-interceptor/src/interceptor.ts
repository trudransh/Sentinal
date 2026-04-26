import type { SentinelSigner } from "@sentinel/signer-shim";
import { isSentinelError } from "@sentinel/signer-shim";

import type {
  EscalationHandler,
  EscalationTicket,
  PaymentBuilder,
  PaymentRequirements,
} from "./types.js";

const PAYMENT_REQUIREMENTS_HEADER = "x-payment-requirements";
const PAYMENT_HEADER = "x-payment";

export interface SentinelFetchOptions {
  signer: SentinelSigner;
  paymentBuilder: PaymentBuilder;
  baseFetch?: typeof fetch;
  onEscalate?: EscalationHandler;
  now?: () => number;
}

export class PaymentDeniedError extends Error {
  readonly code = "PAYMENT_DENIED";
  constructor(reason: string) {
    super(`Sentinel denied payment: ${reason}`);
    this.name = "PaymentDeniedError";
  }
}

export class PaymentEscalationRejectedError extends Error {
  readonly code = "ESCALATION_REJECTED";
  constructor(reason: string) {
    super(`Sentinel escalation rejected: ${reason}`);
    this.name = "PaymentEscalationRejectedError";
  }
}

export function createSentinelFetch(opts: SentinelFetchOptions): typeof fetch {
  const baseFetch = opts.baseFetch ?? globalThis.fetch.bind(globalThis);
  const now = opts.now ?? (() => Date.now());

  const wrapped: typeof fetch = async (input, init) => {
    const first = await baseFetch(input as RequestInfo, init);
    if (first.status !== 402) return first;

    const reqsHeader = first.headers.get(PAYMENT_REQUIREMENTS_HEADER);
    if (!reqsHeader) return first;

    const requirements = parseRequirements(reqsHeader);

    let signedTx;
    try {
      const built = await opts.paymentBuilder.buildPaymentTx(requirements);
      signedTx = await opts.signer.signTransaction(built.tx);
    } catch (err) {
      if (isSentinelError(err)) {
        if (err.code === "POLICY_VIOLATION") {
          throw new PaymentDeniedError(err.message);
        }
        if (err.code === "ESCALATION_REQUIRED") {
          if (!opts.onEscalate) {
            throw new PaymentDeniedError(`escalation required but no handler: ${err.message}`);
          }
          const ticket: EscalationTicket = {
            id: `${now()}-${Math.random().toString(36).slice(2, 8)}`,
            reason: err.message,
            requirements,
            createdAt: now(),
          };
          const decision = await opts.onEscalate(ticket);
          if (decision !== "approve") {
            throw new PaymentEscalationRejectedError(err.message);
          }
          // Re-build & sign after approval; the dashboard is expected to have
          // updated the on-chain policy or the rate-limit window.
          const rebuilt = await opts.paymentBuilder.buildPaymentTx(requirements);
          signedTx = await opts.signer.signTransaction(rebuilt.tx);
        } else {
          throw err;
        }
      } else {
        throw err;
      }
    }

    const receipt = await opts.paymentBuilder.submitPaymentTx(signedTx);
    const retryHeaders = new Headers(init?.headers ?? undefined);
    retryHeaders.set(PAYMENT_HEADER, encodePaymentHeader(receipt));
    return baseFetch(input as RequestInfo, { ...init, headers: retryHeaders });
  };

  return wrapped;
}

export function parseRequirements(headerValue: string): PaymentRequirements {
  const parsed = JSON.parse(headerValue) as Partial<PaymentRequirements> & {
    token?: unknown;
    amount?: unknown;
  };
  if (
    typeof parsed.amount !== "number" ||
    typeof parsed.payTo !== "string" ||
    typeof parsed.resourceUrl !== "string" ||
    typeof parsed.network !== "string" ||
    typeof parsed.scheme !== "string"
  ) {
    throw new Error("x402: malformed X-PAYMENT-REQUIREMENTS header");
  }
  return parsed as PaymentRequirements;
}

export function encodePaymentHeader(receipt: { signature: string; txBase64: string }): string {
  return JSON.stringify({ signature: receipt.signature, tx: receipt.txBase64 });
}
