import { readFileSync } from "node:fs";
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
  type Verdict,
} from "@sentinel/policy-dsl";

import { SentinelError } from "./errors.js";
import { parseTx } from "./tx-parser.js";
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
  readonly #policy: Policy;
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

    const yaml = readFileSync(cfg.policyPath, "utf8");
    this.#policy = parsePolicy(parseYaml(yaml));
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

    await this.#fetcher.ensureMatch(this.#policy);

    const summaries = await parseTx(tx, {
      splDecimalsCache: this.#splDecimalsCache,
      oracle: this.#oracle,
      ...(this.#connection ? { connection: this.#connection } : {}),
      agent: this.#policy.agent,
      now: this.#now(),
    });

    const verdicts = summaries.map((s): Verdict =>
      evaluate({
        policy: this.#policy,
        tx: s,
        history: this.#rateLimiter,
        now: this.#now(),
      }),
    );

    const denied = verdicts.find((v) => v.type === "deny");
    if (denied && denied.type === "deny") {
      throw new SentinelError("POLICY_VIOLATION", denied.reason);
    }

    const escalated = verdicts.filter((v) => v.type === "escalate");
    if (escalated.length > 0) {
      const reasons = escalated
        .filter((v): v is Extract<Verdict, { type: "escalate" }> => v.type === "escalate")
        .map((v) => v.reason);
      const ticket: EscalationTicket = {
        id: `${this.publicKey.toBase58()}-${this.#now()}`,
        agent: this.publicKey.toBase58(),
        reasons,
        createdAt: this.#now(),
      };
      throw new SentinelError("ESCALATION_REQUIRED", reasons.join("; "), { ticket });
    }

    for (const s of summaries) this.#rateLimiter.record(s);

    tx.partialSign(this.#cfg.agentKeypair);
    return tx;
  }

  async signAllTransactions(txs: Transaction[]): Promise<Transaction[]> {
    const out: Transaction[] = [];
    for (const tx of txs) out.push(await this.signTransaction(tx));
    return out;
  }

  async close(): Promise<void> {
    await this.#fetcher.close();
    if (!this.#cfg.rateLimiter) this.#rateLimiter.close();
  }
}
