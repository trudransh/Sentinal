interface CacheEntry {
  fetchedAt: number;
  payload: unknown;
}

const CACHE_TTL_MS = 30_000;
const cache = new Map<string, CacheEntry>();

export interface BalancesResponse {
  balances?: Array<{
    chain?: string;
    address?: string;
    amount?: string;
    symbol?: string;
    name?: string;
    decimals?: number;
    valueUsd?: number;
    [k: string]: unknown;
  }>;
  [k: string]: unknown;
}

export async function fetchBalances(address: string): Promise<BalancesResponse> {
  const now = Date.now();
  const cached = cache.get(address);
  if (cached && now - cached.fetchedAt < CACHE_TTL_MS) {
    return cached.payload as BalancesResponse;
  }
  const apiKey = process.env.SIM_API_KEY;
  if (!apiKey) {
    return { balances: [], _stub: "SIM_API_KEY not set" };
  }
  const r = await fetch(`https://api.sim.dune.com/beta/svm/balances/${address}`, {
    headers: { "X-Sim-Api-Key": apiKey },
  });
  if (!r.ok) {
    throw new Error(`Dune SIM ${r.status}: ${await r.text()}`);
  }
  const json = (await r.json()) as BalancesResponse;
  cache.set(address, { fetchedAt: now, payload: json });
  return json;
}
