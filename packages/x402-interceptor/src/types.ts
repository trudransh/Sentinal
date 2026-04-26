import type { Token, TxSummary } from "@sentinel/policy-dsl";

export interface PaymentRequirements {
  scheme: "exact" | "stream";
  network: string;
  amount: number;
  token: Token;
  payTo: string;
  resourceUrl: string;
  description?: string;
  facilitator?: string;
  nonce?: string;
}

export interface PaymentReceipt {
  signature: string;
  payTo: string;
  token: Token;
  amount: number;
  txBase64: string;
}

export interface PaymentBuilder {
  buildPaymentTx(req: PaymentRequirements): Promise<{
    tx: import("@solana/web3.js").Transaction;
    summary: TxSummary;
  }>;
  submitPaymentTx(
    signedTx: import("@solana/web3.js").Transaction,
  ): Promise<PaymentReceipt>;
}

export interface EscalationTicket {
  id: string;
  reason: string;
  requirements: PaymentRequirements;
  createdAt: number;
}

export type EscalationDecision = "approve" | "reject";

export type EscalationHandler = (
  ticket: EscalationTicket,
) => Promise<EscalationDecision>;
