// Pick the best devnet RPC available. Public api.devnet.solana.com is heavily
// throttled (429 within a few requests) — if a HELIUS_API_KEY is configured we
// route through Helius's RPC instead. Operators with QuickNode/Alchemy/etc.
// can set SOLANA_RPC_URL explicitly to override.

export function resolveRpcUrl(): string {
  const explicit = process.env.SOLANA_RPC_URL;
  if (explicit && !explicit.includes("api.devnet.solana.com")) return explicit;

  const heliusKey = process.env.HELIUS_API_KEY;
  if (heliusKey) {
    return `https://devnet.helius-rpc.com/?api-key=${heliusKey}`;
  }

  return explicit ?? "https://api.devnet.solana.com";
}

export function detectClusterFromUrl(
  url: string | undefined,
): "devnet" | "mainnet" | "unknown" {
  if (!url) return "unknown";
  if (url.includes("devnet")) return "devnet";
  if (url.includes("mainnet") || url.includes("api.mainnet-beta")) return "mainnet";
  return "unknown";
}
