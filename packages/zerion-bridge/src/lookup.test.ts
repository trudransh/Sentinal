import { describe, expect, it, vi } from "vitest";
import { EventEmitter } from "node:events";

// Stub child_process.spawn so tests don't need zerion-cli installed.
const fakeProcs: Array<EventEmitter & { stdout: EventEmitter; stderr: EventEmitter; kill: () => void }> = [];

vi.mock("node:child_process", () => ({
  spawn: vi.fn(() => {
    const proc = new EventEmitter() as EventEmitter & {
      stdout: EventEmitter;
      stderr: EventEmitter;
      kill: () => void;
    };
    proc.stdout = new EventEmitter();
    proc.stderr = new EventEmitter();
    proc.kill = () => {};
    fakeProcs.push(proc);
    return proc;
  }),
}));

import { lookupZerionAnalysis } from "./lookup.js";

function lastProc() {
  return fakeProcs[fakeProcs.length - 1]!;
}

function emitJson(json: unknown): void {
  const p = lastProc();
  setImmediate(() => {
    p.stdout.emit("data", Buffer.from(JSON.stringify(json)));
    p.emit("close", 0);
  });
}

function emitMissingApiKey(): void {
  emitJson({
    error: { code: "missing_api_key", message: "ZERION_API_KEY is required..." },
  });
}

describe("lookupZerionAnalysis", () => {
  it("parses a real-shape analyze response (mainnet wallet)", async () => {
    const fixture = {
      wallet: { query: "0xd8da6bf26964af9d7eed9e03e53415d37aa96045" },
      portfolio: {
        total: 12345.67,
        currency: "usd",
        change_1d: { absolute_1d: 100, percent_1d: 0.8 },
        chains: { ethereum: { value: 12000 }, solana: { value: 345.67 } },
      },
      positions: {
        count: 6771,
        top: [
          { name: "WhiteRock", symbol: "WHITE", value: 1287214.81, quantity: 1e10, chain: "ethereum" },
          { name: "MOO DENG", symbol: "MOODENG", value: 171820.39, quantity: 3e10, chain: "ethereum" },
        ],
      },
      transactions: { sampled: 25, recent: [] },
      pnl: { available: true, summary: {} },
      failures: [],
    };
    const promise = lookupZerionAnalysis("0xd8da6bf26964af9d7eed9e03e53415d37aa96045", {
      bin: "zerion",
    });
    emitJson(fixture);
    const r = await promise;
    expect(r.ok).toBe(true);
    expect(r.portfolioUsd).toBe(12345.67);
    expect(r.topPositions).toHaveLength(2);
    expect(r.topPositions[0]?.symbol).toBe("WHITE");
    expect(r.recentTxCount).toBe(25);
    expect(r.failures).toEqual([]);
  });

  it("handles a devnet/unindexed wallet (failures present, empty positions)", async () => {
    const fixture = {
      wallet: { query: "7BQ1jaQhFHxvsueak4n2ZygneHWkdVgVLovDS3U76QSA" },
      portfolio: {
        total: 0,
        currency: "usd",
        change_1d: { absolute_1d: 0, percent_1d: null },
        chains: {},
      },
      positions: { count: 0, top: [] },
      transactions: { sampled: 0, recent: [] },
      pnl: { available: false, summary: null },
      failures: ["positions", "transactions", "pnl"],
    };
    const promise = lookupZerionAnalysis("7BQ1jaQhFHxvsueak4n2ZygneHWkdVgVLovDS3U76QSA");
    emitJson(fixture);
    const r = await promise;
    expect(r.ok).toBe(true);
    expect(r.portfolioUsd).toBe(0);
    expect(r.topPositions).toEqual([]);
    expect(r.failures).toContain("positions");
  });

  it("flags missing API key as error", async () => {
    const promise = lookupZerionAnalysis("0xanyaddress");
    emitMissingApiKey();
    const r = await promise;
    expect(r.ok).toBe(false);
    expect(r.failures[0]).toMatch(/API_KEY|ZERION_API_KEY/);
  });

  it("returns ok=false when zerion emits non-JSON", async () => {
    const promise = lookupZerionAnalysis("0xanyaddress");
    setImmediate(() => {
      lastProc().stdout.emit("data", Buffer.from("not json"));
      lastProc().emit("close", 0);
    });
    const r = await promise;
    expect(r.ok).toBe(false);
    expect(r.failures[0]).toMatch(/no output/i);
  });
});
