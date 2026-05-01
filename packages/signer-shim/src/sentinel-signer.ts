import { readFileSync, statSync } from "node:fs";
import { parse as parseYaml } from "yaml";
import {
  Connection,
  type Keypair,
  type PublicKey,
  type Signer,
  Transaction,
  VersionedTransaction,
} from "@solana/web3.js";
import {
  evaluate,
  parsePolicy,
  type Policy,
  type TxSummary,
  type Verdict,
} from "@sentinel/policy-dsl";

import { SentinelError } from "./errors.js";
import { parseTx } from "./tx-parser.js";

// HARDEN: hard caps for YAML parsing to defend against alias-bomb /
// billion-laughs amplification.
const MAX_POLICY_BYTES = 64 * 1024;
const YAML_PARSE_OPTS = { maxAliasCount: 100, prettyErrors: true } as const;
import {
  createHermesOracle,
  type PriceOracle,
  stubOracle,
} from "./price-oracle.js";
import {
  createPolicyFetcher,
  type OnChainPolicyRecord,
  type PolicyFetcher,
} from "./policy-fetch.js";
import {
  createRateLimiter,
  createInMemoryRateLimiter,
  type RateLimiter,
} from "./rate-limiter.js";

export interface SentinelSignerConfig {
  policyPath: string;
  agentKeypair: Keypair;
  registryProgramId: PublicKey;
  rpcUrl?: string;
  connection?: Connection;
  hermesUrl?: string;
  oracle?: PriceOracle;
  rateLimitDb?: string;
  rateLimiter?: RateLimiter;
  cacheTtlMs?: number;
  fetchAccount?: (pda: PublicKey) => Promise<OnChainPolicyRecord | null>;
  policyFetcher?: PolicyFetcher;
  now?: () => number;
}

export interface EscalationTicket {
  id: string;
  agent: string;
  reasons: string[];
  createdAt: number;
}

export class SentinelSigner implements Signer {
  readonly publicKey: PublicKey;
  readonly secretKey: Uint8Array;
  readonly #cfg: SentinelSignerConfig;
  #policy: Policy;
  #policyMtimeMs: number;
  readonly #oracle: PriceOracle;
  readonly #rateLimiter: RateLimiter;
  readonly #fetcher: PolicyFetcher;
  readonly #now: () => number;
  readonly #connection: Connection | undefined;
  readonly #splDecimalsCache = new Map<string, number>();

  constructor(cfg: SentinelSignerConfig) {
    this.#cfg = cfg;
    this.publicKey = cfg.agentKeypair.publicKey;
    this.secretKey = cfg.agentKeypair.secretKey;
    this.#now = cfg.now ?? (() => Date.now());
    this.#connection = cfg.connection ?? (cfg.rpcUrl ? new Connection(cfg.rpcUrl) : undefined);

    const { policy, mtimeMs } = this.#readPolicyFromDisk();
    this.#policy = policy;
    this.#policyMtimeMs = mtimeMs;
    if (this.#policy.agent !== this.publicKey.toBase58()) {
      throw new SentinelError(
        "INVALID_POLICY",
        `Policy agent ${this.#policy.agent} does not match signer ${this.publicKey.toBase58()}`,
      );
    }

    this.#oracle =
      cfg.oracle ??
      (cfg.hermesUrl
        ? createHermesOracle({ hermesUrl: cfg.hermesUrl })
        : stubOracle);

    this.#rateLimiter =
      cfg.rateLimiter ??
      (cfg.rateLimitDb
        ? createRateLimiter({ agent: this.#policy.agent, dbPath: cfg.rateLimitDb })
        : createInMemoryRateLimiter(this.#policy.agent));

    // D3: prune anything older than 7d on startup so spend_log doesn't bloat.
    // Owner-supplied limiters may have their own retention policy, so skip.
    if (!cfg.rateLimiter) {
      const sevenDaysMs = 7 * 24 * 60 * 60 * 1000;
      this.#rateLimiter.prune(this.#now() - sevenDaysMs);
    }

    if (cfg.policyFetcher) {
      this.#fetcher = cfg.policyFetcher;
    } else {
      if (!this.#connection || !cfg.fetchAccount) {
        throw new SentinelError(
          "INVALID_POLICY",
          "SentinelSigner requires either policyFetcher or (connection + fetchAccount)",
        );
      }
      this.#fetcher = createPolicyFetcher({
        connection: this.#connection,
        programId: cfg.registryProgramId,
        agent: this.publicKey,
        fetchAccount: cfg.fetchAccount,
        ...(cfg.cacheTtlMs !== undefined ? { cacheTtlMs: cfg.cacheTtlMs } : {}),
        now: this.#now,
      });
    }
  }

  async signTransaction(tx: Transaction): Promise<Transaction> {
    if (tx instanceof VersionedTransaction) {
      throw new SentinelError(
        "UNSUPPORTED_TX",
        "Versioned (v0) transactions are rejected in MVP",
      );
    }

    // HARDEN-TOCTOU: re-read the local YAML if its mtime changed since last
    // load. Without this, a local attacker swapping the file after the signer
    // boots is invisible to `ensureMatch` (which only compares the in-memory
    // policy to the on-chain root). mtime is cheap; full re-read happens
    // only on actual change.
    this.#refreshLocalPolicyIfStale();
    await this.#fetcher.ensureMatch(this.#policy);

    const summaries = await this.#parseAndEvaluate(tx);
    for (const s of summaries) this.#rateLimiter.record(s);

    tx.partialSign(this.#cfg.agentKeypair);
    return tx;
  }

  async signAllTransactions(txs: Transaction[]): Promise<Transaction[]> {
    // HARDEN-ATOMIC: evaluate every tx (and refresh policy state) BEFORE we
    // record a single one. Previous behaviour mutated `spend_log` for tx
    // 1..N-1 even when tx N was denied, causing double-counting on caller
    // retry. Now: parse-and-evaluate all (which throws on first deny/escalate
    // without recording), then record-and-sign in a second pass.
    this.#refreshLocalPolicyIfStale();
    await this.#fetcher.ensureMatch(this.#policy);

    const allSummaries: TxSummary[][] = [];
    for (const tx of txs) {
      if (tx instanceof VersionedTransaction) {
        throw new SentinelError(
          "UNSUPPORTED_TX",
          "Versioned (v0) transactions are rejected in MVP",
        );
      }
      const summaries = await this.#parseAndEvaluate(tx);
      allSummaries.push(summaries);
    }

    const out: Transaction[] = [];
    for (let i = 0; i < txs.length; i++) {
      for (const s of allSummaries[i]!) this.#rateLimiter.record(s);
      const tx = txs[i]!;
      tx.partialSign(this.#cfg.agentKeypair);
      out.push(tx);
    }
    return out;
  }

  async close(): Promise<void> {
    await this.#fetcher.close();
    if (!this.#cfg.rateLimiter) this.#rateLimiter.close();
  }

  #readPolicyFromDisk(): { policy: Policy; mtimeMs: number } {
    const stat = statSync(this.#cfg.policyPath);
    if (stat.size > MAX_POLICY_BYTES) {
      throw new SentinelError(
        "INVALID_POLICY",
        `policy file exceeds ${MAX_POLICY_BYTES} byte cap`,
      );
    }
    const yaml = readFileSync(this.#cfg.policyPath, "utf8");
    const policy = parsePolicy(parseYaml(yaml, YAML_PARSE_OPTS));
    return { policy, mtimeMs: stat.mtimeMs };
  }

  #refreshLocalPolicyIfStale(): void {
    let stat;
    try {
      stat = statSync(this.#cfg.policyPath);
    } catch (err) {
      throw new SentinelError(
        "INVALID_POLICY",
        `policy file disappeared or unreadable: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
    if (stat.mtimeMs === this.#policyMtimeMs) return;

    const next = this.#readPolicyFromDisk();
    if (next.policy.agent !== this.publicKey.toBase58()) {
      throw new SentinelError(
        "INVALID_POLICY",
        `policy agent ${next.policy.agent} does not match signer ${this.publicKey.toBase58()}`,
      );
    }
    this.#policy = next.policy;
    this.#policyMtimeMs = next.mtimeMs;
  }

  async #parseAndEvaluate(tx: Transaction): Promise<TxSummary[]> {
    const programsAllow = this.#policy.programs?.allow;
    const summaries = await parseTx(tx, {
      splDecimalsCache: this.#splDecimalsCache,
      oracle: this.#oracle,
      ...(this.#connection ? { connection: this.#connection } : {}),
      agent: this.#policy.agent,
      now: this.#now(),
      ...(programsAllow !== undefined ? { programsAllow } : {}),
    });

    const verdicts = summaries.map((s): Verdict =>
      evaluate({
        policy: this.#policy,
        tx: s,
        history: this.#rateLimiter,
        now: this.#now(),
      }),
    );

    const denied = verdicts.find((v): v is Extract<Verdict, { type: "deny" }> => v.type === "deny");
    if (denied) {
      throw new SentinelError("POLICY_VIOLATION", denied.reason);
    }

    const escalated = verdicts.filter(
      (v): v is Extract<Verdict, { type: "escalate" }> => v.type === "escalate",
    );
    if (escalated.length > 0) {
      const reasons = escalated.map((v) => v.reason);
      const ticket: EscalationTicket = {
        id: `${this.publicKey.toBase58()}-${this.#now()}`,
        agent: this.publicKey.toBase58(),
        reasons,
        createdAt: this.#now(),
      };
      throw new SentinelError("ESCALATION_REQUIRED", reasons.join("; "), { ticket });
    }

    return summaries;
  }
}
