// A5 (rewritten): zerion-cli is a wallet-analysis CLI, not a JS-policy host.
// The original Sentinel plan assumed `~/.config/zerion/policies/sentinel.mjs`
// would be loaded by zerion-cli — it is not. zerion-cli has its own built-in
// declarative policy system (`zerion agent create-policy --deny-transfers
// --allowlist <addr>`) and a JSON analytics CLI.
//
// The right Sentinel ↔ Zerion integration is **escalation enrichment**: when
// Sentinel escalates a transaction, we run `zerion analyze --json <destination>`
// and surface the result to the operator. They get portfolio + recent activity
// + risk signals while making the approve/reject call.

import { spawn } from "node:child_process";

export interface ZerionAnalysis {
  ok: boolean;
  query: string;
  /** Total portfolio USD on the indexed chains (null when wallet is unindexed, e.g. devnet). */
  portfolioUsd: number | null;
  /** USD-valued chain breakdown when available. */
  chains: Record<string, unknown> | null;
  /** Top N positions by USD value. */
  topPositions: Array<{
    name: string;
    symbol: string;
    valueUsd: number;
    quantity: number;
    chain: string;
  }>;
  /** Sampled recent transactions. */
  recentTxCount: number;
  /** Failures reported by zerion-cli for sub-queries (e.g. devnet returns failures: ["positions"]). */
  failures: string[];
  /** Raw payload for debug / extra fields. */
  raw: unknown;
}

export interface ZerionLookupOptions {
  /** Override the binary location. Defaults to `zerion` on PATH. */
  bin?: string;
  /** Override env passed to the spawn (defaults to inherited process.env). */
  env?: NodeJS.ProcessEnv;
  /** Hard timeout in ms; default 8s. */
  timeoutMs?: number;
}

/**
 * Run `zerion analyze --json <addr> --quiet` and return a structured summary.
 * Returns `{ ok: false, ... }` on CLI error or timeout — callers must check.
 *
 * Requires ZERION_API_KEY in the env (or --x402 flag, but we're not paying
 * per call from the dashboard).
 */
export async function lookupZerionAnalysis(
  address: string,
  opts: ZerionLookupOptions = {},
): Promise<ZerionAnalysis> {
  const bin = opts.bin ?? "zerion";
  const timeoutMs = opts.timeoutMs ?? 8_000;
  const env = opts.env ?? process.env;

  const raw = await runJson(bin, ["analyze", address, "--json", "--quiet"], env, timeoutMs);
  if (!raw || typeof raw !== "object") {
    return errOut(address, "no output", raw);
  }
  const obj = raw as Record<string, unknown>;
  if (obj.error) {
    return errOut(address, formatErr(obj.error), raw);
  }
  return parseAnalysis(address, obj);
}

function parseAnalysis(query: string, obj: Record<string, unknown>): ZerionAnalysis {
  const portfolio = (obj.portfolio ?? {}) as Record<string, unknown>;
  const positions = (obj.positions ?? {}) as Record<string, unknown>;
  const transactions = (obj.transactions ?? {}) as Record<string, unknown>;
  const failures = Array.isArray(obj.failures) ? (obj.failures as unknown[]).map(String) : [];

  const top = Array.isArray(positions.top)
    ? (positions.top as Array<Record<string, unknown>>).map((p) => ({
        name: typeof p.name === "string" ? p.name : "",
        symbol: typeof p.symbol === "string" ? p.symbol : "",
        valueUsd: typeof p.value === "number" ? p.value : 0,
        quantity: typeof p.quantity === "number" ? p.quantity : 0,
        chain: typeof p.chain === "string" ? p.chain : "",
      }))
    : [];

  return {
    ok: true,
    query,
    portfolioUsd: typeof portfolio.total === "number" ? portfolio.total : null,
    chains: typeof portfolio.chains === "object" && portfolio.chains !== null
      ? (portfolio.chains as Record<string, unknown>)
      : null,
    topPositions: top,
    recentTxCount: typeof transactions.sampled === "number" ? transactions.sampled : 0,
    failures,
    raw: obj,
  };
}

function errOut(query: string, reason: string, raw: unknown): ZerionAnalysis {
  return {
    ok: false,
    query,
    portfolioUsd: null,
    chains: null,
    topPositions: [],
    recentTxCount: 0,
    failures: [reason],
    raw,
  };
}

function formatErr(err: unknown): string {
  if (typeof err === "string") return err;
  if (err && typeof err === "object") {
    const e = err as Record<string, unknown>;
    if (typeof e.message === "string") return e.message;
    if (typeof e.code === "string") return e.code;
  }
  return JSON.stringify(err);
}

function runJson(
  bin: string,
  args: string[],
  env: NodeJS.ProcessEnv,
  timeoutMs: number,
): Promise<unknown | null> {
  return new Promise((resolveRun) => {
    const proc = spawn(bin, args, { env });
    let stdout = "";
    let killed = false;
    const t = setTimeout(() => {
      killed = true;
      proc.kill("SIGKILL");
    }, timeoutMs);

    proc.stdout.on("data", (d) => (stdout += d.toString("utf8")));
    proc.stderr.on("data", () => {
      /* discard — JSON-only mode */
    });

    proc.on("error", () => {
      clearTimeout(t);
      resolveRun(null);
    });
    proc.on("close", () => {
      clearTimeout(t);
      if (killed) return resolveRun(null);
      try {
        resolveRun(JSON.parse(stdout));
      } catch {
        resolveRun(null);
      }
    });
  });
}
