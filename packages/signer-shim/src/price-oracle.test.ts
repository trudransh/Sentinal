import { describe, expect, it, vi } from "vitest";
import {
  createHermesOracle,
  FEED_IDS,
  type HermesLike,
} from "./price-oracle.js";
import { SentinelError } from "./errors.js";

const SOL_FEED = FEED_IDS.SOL_USD;
const USDC_FEED = FEED_IDS.USDC_USD;

const fixedNow = (n: number) => () => n;

function buildClient(
  prices: Record<string, { price: string; expo: number; publish_time: number }>,
): HermesLike {
  return {
    async getLatestPriceUpdates(ids: string[]) {
      return {
        parsed: ids
          .map((id) => {
            const idNoPrefix = id.startsWith("0x") ? id.slice(2) : id;
            const data = prices[id] ?? prices[idNoPrefix] ?? prices[`0x${idNoPrefix}`];
            if (!data) return null;
            return { id: idNoPrefix, price: data };
          })
          .filter((x): x is NonNullable<typeof x> => x !== null),
      };
    },
  };
}

describe("price-oracle: HermesOracle", () => {
  const NOW_MS = 1_700_000_000_000;

  it("computes USD for SOL using price * 10^expo", async () => {
    const client = buildClient({
      [SOL_FEED]: {
        price: "150_00000000".replace(/_/g, ""),
        expo: -8,
        publish_time: NOW_MS / 1000 - 5,
      },
    });
    const oracle = createHermesOracle({
      hermesUrl: "https://stub",
      client,
      now: fixedNow(NOW_MS),
    });
    const usd = await oracle.usd("SOL", 2);
    expect(usd).toBeCloseTo(300);
  });

  it("returns POSITIVE_INFINITY when SOL price is older than 60s", async () => {
    const client = buildClient({
      [SOL_FEED]: {
        price: "10000000000",
        expo: -8,
        publish_time: NOW_MS / 1000 - 70,
      },
    });
    const oracle = createHermesOracle({
      hermesUrl: "https://stub",
      client,
      now: fixedNow(NOW_MS),
    });
    const usd = await oracle.usd("SOL", 1);
    expect(usd).toBe(Number.POSITIVE_INFINITY);
  });

  it("USDC sanity-check fails when price differs from peg by > 5%", async () => {
    const client = buildClient({
      [USDC_FEED]: {
        price: "80000000",
        expo: -8,
        publish_time: NOW_MS / 1000,
      },
    });
    const oracle = createHermesOracle({
      hermesUrl: "https://stub",
      client,
      now: fixedNow(NOW_MS),
    });
    await expect(oracle.usd("USDC", 5)).rejects.toBeInstanceOf(SentinelError);
  });

  it("USDC returns amount directly after passing peg sanity-check", async () => {
    const client = buildClient({
      [USDC_FEED]: {
        price: "100000000",
        expo: -8,
        publish_time: NOW_MS / 1000,
      },
    });
    const oracle = createHermesOracle({
      hermesUrl: "https://stub",
      client,
      now: fixedNow(NOW_MS),
    });
    expect(await oracle.usd("USDC", 7.5)).toBeCloseTo(7.5);
  });

  it("caches: second call within TTL does not refetch", async () => {
    const spy = vi.fn(async (ids: string[]) => ({
      parsed: ids.map((id) => ({
        id: id.startsWith("0x") ? id.slice(2) : id,
        price: { price: "100_00000000".replace(/_/g, ""), expo: -8, publish_time: NOW_MS / 1000 },
      })),
    }));
    const client: HermesLike = { getLatestPriceUpdates: spy };
    const oracle = createHermesOracle({
      hermesUrl: "https://stub",
      client,
      now: fixedNow(NOW_MS),
      ttlMs: 10_000,
    });
    await oracle.usd("SOL", 1);
    await oracle.usd("SOL", 1);
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it("mint-token USD throws ORACLE_UNAVAILABLE", async () => {
    const client = buildClient({});
    const oracle = createHermesOracle({
      hermesUrl: "https://stub",
      client,
      now: fixedNow(NOW_MS),
    });
    await expect(
      oracle.usd({ mint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v" }, 1),
    ).rejects.toMatchObject({ code: "ORACLE_UNAVAILABLE" });
  });
});
