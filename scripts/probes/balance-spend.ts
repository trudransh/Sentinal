// Probe: hit the new cluster-aware fetchBalances + fetchSpend against a
// devnet pubkey. Verifies the Helius RPC fallback works around the public
// devnet RPC rate limit. Writes nothing — just prints.
//
// Run: pnpm tsx scripts/probes/balance-spend.ts <pubkey>

import { loadDotEnv } from "./load-env";

loadDotEnv();
// resolveRpcUrl prefers any non-public-devnet override; if SOLANA_RPC_URL was
// set to the public devnet it would suppress the Helius RPC. Strip it so the
// helper picks Helius when HELIUS_API_KEY is configured.
if (process.env.SOLANA_RPC_URL?.includes("api.devnet.solana.com")) {
  delete process.env.SOLANA_RPC_URL;
}

const address =
  process.argv[2] ?? process.env.AGENT_ADDRESS ?? "7BQ1jaQhFHxvsueak4n2ZygneHWkdVgVLovDS3U76QSA";

async function main() {
  const { fetchBalances } = await import("../../app/lib/balance");
  const { fetchSpend } = await import("../../app/lib/spend");

  console.log(`probe address: ${address}\n`);

  console.log("[balance]");
  const b = await fetchBalances(address);
  console.log(`  source: ${b._source} · cluster: ${b._cluster} · count: ${b.balances?.length ?? 0}`);
  for (const x of b.balances ?? []) {
    console.log(`    ${x.symbol ?? x.name ?? x.address}: ${x.amount} (${x.decimals}dp)`);
  }
  if (b._stub) console.log(`  stub: ${b._stub}`);

  console.log("\n[spend]");
  const s = await fetchSpend(address, 7);
  console.log(`  source: ${s._source} · cluster: ${s._cluster} · totalTx: ${s.totalTx}`);
  for (const d of s.days ?? []) {
    console.log(
      `    ${d.date}  txs=${d.txCount}  netSol=${d.netSol >= 0 ? "+" : ""}${d.netSol.toFixed(6)}`,
    );
  }
  if (s._stub) console.log(`  stub: ${s._stub}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
