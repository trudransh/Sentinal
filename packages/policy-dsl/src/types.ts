export type Token = "SOL" | "USDC" | { mint: string };

export interface TxSummary {
  agent: string;
  token: Token;
  amount: number;
  destination: string;
  programId: string;
  usdValue: number;
  timestamp: number;
}

export type Verdict =
  | { type: "allow" }
  | { type: "escalate"; reason: string }
  | { type: "deny"; reason: string };

export function tokenKey(t: Token): string {
  if (t === "SOL") return "SOL";
  if (t === "USDC") return "USDC";
  return `mint:${t.mint}`;
}

export function tokenLabel(t: Token): string {
  if (t === "SOL") return "SOL";
  if (t === "USDC") return "USDC";
  return t.mint.slice(0, 6) + "…";
}

export function tokensEqual(a: Token, b: Token): boolean {
  if (typeof a === "string" || typeof b === "string") return a === b;
  return a.mint === b.mint;
}
