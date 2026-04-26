import { HermesClient } from "@pythnetwork/hermes-client";
import type { Token } from "@sentinel/policy-dsl";

import { SentinelError } from "./errors.js";

export interface PriceOracle {
  usd(token: Token, amount: number): Promise<number>;
}

export const FEED_IDS = {
  SOL_USD: "0xef0d8b6fda2ceba41da15d4095d1da392a0d2f8ed0c6c7bc0f4cfac8c280b56d",
  USDC_USD: "0xeaa020c61cc479712813461ce153894a96a6c00b21ed0cfc2798d1f9a9e9c94a",
} as const;

const STALE_MS = 60_000;
const DEFAULT_TTL_MS = 10_000;

interface CacheEntry {
  price: number;
  publishTimeMs: number;
  fetchedAt: number;
}

interface FetchResult {
  price: number;
  publishTimeMs: number;
}

export interface HermesOracleOptions {
  hermesUrl: string;
  ttlMs?: number;
  client?: HermesLike;
  now?: () => number;
}

export interface HermesLike {
  getLatestPriceUpdates(ids: string[]): Promise<{
    parsed?: Array<{
      id: string;
      price: { price: string; expo: number; publish_time: number };
    }>;
  }>;
}

export function createHermesOracle(opts: HermesOracleOptions): PriceOracle {
  const ttlMs = opts.ttlMs ?? DEFAULT_TTL_MS;
  const now = opts.now ?? (() => Date.now());
  const client: HermesLike = opts.client ?? new HermesClient(opts.hermesUrl, {});
  const cache = new Map<string, CacheEntry>();
  let usdcSanityChecked = false;

  async function priceFor(feedId: string): Promise<FetchResult> {
    const cached = cache.get(feedId);
    if (cached && now() - cached.fetchedAt < ttlMs) {
      return { price: cached.price, publishTimeMs: cached.publishTimeMs };
    }
    let resp;
    try {
      resp = await client.getLatestPriceUpdates([feedId]);
    } catch (err) {
      throw new SentinelError(
        "ORACLE_UNAVAILABLE",
        `Hermes fetch failed for ${feedId}`,
        { feedId },
        { cause: err },
      );
    }
    const idNoPrefix = feedId.startsWith("0x") ? feedId.slice(2) : feedId;
    const parsed = resp.parsed?.find(
      (p) => p.id === feedId || p.id === idNoPrefix || `0x${p.id}` === feedId,
    );
    if (!parsed) {
      throw new SentinelError("ORACLE_UNAVAILABLE", `Hermes returned no entry for ${feedId}`);
    }
    const price = Number(parsed.price.price) * 10 ** parsed.price.expo;
    const publishTimeMs = parsed.price.publish_time * 1000;
    if (!Number.isFinite(price) || price <= 0) {
      throw new SentinelError("ORACLE_UNAVAILABLE", `Hermes returned non-positive price`);
    }
    cache.set(feedId, { price, publishTimeMs, fetchedAt: now() });
    return { price, publishTimeMs };
  }

  function staleCheck(result: FetchResult): number {
    if (now() - result.publishTimeMs >= STALE_MS) {
      return Number.POSITIVE_INFINITY;
    }
    return result.price;
  }

  return {
    async usd(token: Token, amount: number): Promise<number> {
      if (token === "SOL") {
        const r = await priceFor(FEED_IDS.SOL_USD);
        const px = staleCheck(r);
        return px * amount;
      }
      if (token === "USDC") {
        if (!usdcSanityChecked) {
          const r = await priceFor(FEED_IDS.USDC_USD);
          if (Math.abs(r.price - 1) > 0.05) {
            throw new SentinelError(
              "ORACLE_UNAVAILABLE",
              `USDC peg sanity-check failed: $${r.price}`,
            );
          }
          usdcSanityChecked = true;
        }
        return amount;
      }
      throw new SentinelError(
        "ORACLE_UNAVAILABLE",
        `Mint-based USD pricing not supported in MVP`,
        { mint: token.mint },
      );
    },
  };
}

export const stubOracle: PriceOracle = {
  async usd(_token, amount) {
    return amount;
  },
};
