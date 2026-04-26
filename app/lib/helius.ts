export interface HeliusEnhancedTx {
  signature: string;
  type?: string;
  source?: string;
  description?: string;
  events?: Record<string, unknown>;
  accountData?: Array<{ account: string; nativeBalanceChange?: number }>;
  instructions?: Array<{ programId: string; data?: string; accounts?: string[] }>;
}

export interface DecodedEvent {
  kind: "registered" | "updated" | "revoked" | "unknown";
  agent: string;
}

const REGEX_AGENT = /agent[:\s]+([1-9A-HJ-NP-Za-km-z]{32,44})/i;

export function classifyTx(tx: HeliusEnhancedTx): DecodedEvent {
  const all = JSON.stringify(tx).toLowerCase();
  let kind: DecodedEvent["kind"] = "unknown";
  if (all.includes("policyregistered") || all.includes("register_policy")) kind = "registered";
  else if (all.includes("policyrevoked") || all.includes("revoke_policy")) kind = "revoked";
  else if (all.includes("policyupdated") || all.includes("update_policy")) kind = "updated";

  const m = JSON.stringify(tx).match(REGEX_AGENT);
  return { kind, agent: m?.[1] ?? "unknown" };
}
