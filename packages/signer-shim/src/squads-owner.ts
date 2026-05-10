// Phase 7 — Squads Smart Account as Sentinel policy owner.
//
// The on-chain registry uses `owner: Signer<'info>` with `has_one = owner` —
// any Solana signer can be a policy owner, including a Squads v4 vault PDA.
// Setting the vault PDA as owner means policy changes require multisig
// approval *natively* without any on-chain change to Sentinel itself: Sentinel
// composes with Squads instead of competing with it.
//
// This module provides:
//   - update_policy / register_policy instruction builders that don't depend
//     on the Anchor TS client (so the dashboard can use them without
//     bundling @coral-xyz/anchor);
//   - helpers that wrap an instruction in the four-step Squads v4 flow:
//     vaultTransactionCreate → proposalCreate → proposalApprove ×N → vaultTransactionExecute.
//
// All builders return *unsigned* VersionedTransaction objects. Callers are
// responsible for signing with the appropriate keypair / wallet adapter and
// broadcasting.

import {
  PublicKey,
  Connection,
  TransactionInstruction,
  TransactionMessage,
  type VersionedTransaction,
} from "@solana/web3.js";
import * as multisig from "@sqds/multisig";

const REGISTER_POLICY_DISCRIMINATOR = new Uint8Array([
  62, 66, 167, 36, 252, 227, 38, 132,
]);
const UPDATE_POLICY_DISCRIMINATOR = new Uint8Array([
  212, 245, 246, 7, 163, 151, 18, 57,
]);
const POLICY_SEED = new TextEncoder().encode("policy");
const SYSTEM_PROGRAM_ID = new PublicKey("11111111111111111111111111111111");

/** Compute the Sentinel policy PDA `["policy", agent]` for a given program id. */
export function findPolicyPda(programId: PublicKey, agent: PublicKey): PublicKey {
  const [pda] = PublicKey.findProgramAddressSync(
    [POLICY_SEED, agent.toBuffer()],
    programId,
  );
  return pda;
}

/** Build the raw `update_policy` instruction. Owner must sign. */
export function buildUpdatePolicyIx(opts: {
  programId: PublicKey;
  owner: PublicKey;
  agent: PublicKey;
  newRoot: Uint8Array;
}): TransactionInstruction {
  if (opts.newRoot.byteLength !== 32) {
    throw new Error(
      `newRoot must be exactly 32 bytes, got ${opts.newRoot.byteLength}`,
    );
  }
  const policyPda = findPolicyPda(opts.programId, opts.agent);
  const data = new Uint8Array(8 + 32);
  data.set(UPDATE_POLICY_DISCRIMINATOR, 0);
  data.set(opts.newRoot, 8);
  return new TransactionInstruction({
    programId: opts.programId,
    keys: [
      { pubkey: opts.owner, isSigner: true, isWritable: false },
      { pubkey: policyPda, isSigner: false, isWritable: true },
    ],
    data: Buffer.from(data),
  });
}

/** Build the raw `register_policy` instruction. Owner pays rent + signs. */
export function buildRegisterPolicyIx(opts: {
  programId: PublicKey;
  owner: PublicKey;
  agent: PublicKey;
  root: Uint8Array;
}): TransactionInstruction {
  if (opts.root.byteLength !== 32) {
    throw new Error(`root must be exactly 32 bytes, got ${opts.root.byteLength}`);
  }
  const policyPda = findPolicyPda(opts.programId, opts.agent);
  const data = new Uint8Array(8 + 32 + 32);
  data.set(REGISTER_POLICY_DISCRIMINATOR, 0);
  data.set(opts.agent.toBuffer(), 8);
  data.set(opts.root, 8 + 32);
  return new TransactionInstruction({
    programId: opts.programId,
    keys: [
      { pubkey: opts.owner, isSigner: true, isWritable: true },
      { pubkey: policyPda, isSigner: false, isWritable: true },
      { pubkey: SYSTEM_PROGRAM_ID, isSigner: false, isWritable: false },
    ],
    data: Buffer.from(data),
  });
}

/**
 * Compute the Squads vault PDA used as `owner` on PolicyRecord.
 * Default vault index 0 — Sentinel only ever uses one vault per multisig.
 */
export function getSentinelVaultPda(multisigPda: PublicKey): PublicKey {
  const [vaultPda] = multisig.getVaultPda({ multisigPda, index: 0 });
  return vaultPda;
}

/** Snapshot of multisig state needed to sequence the next transaction. */
export interface MultisigSnapshot {
  multisigPda: PublicKey;
  vaultPda: PublicKey;
  threshold: number;
  members: PublicKey[];
  /** Latest transaction index used. Next tx must use `transactionIndex + 1n`. */
  currentTransactionIndex: bigint;
  /** `currentTransactionIndex + 1n`, ready to pass to vaultTransactionCreate. */
  nextTransactionIndex: bigint;
}

/** Fetch a multisig and project the fields Sentinel needs. */
export async function fetchMultisigSnapshot(
  connection: Connection,
  multisigPda: PublicKey,
): Promise<MultisigSnapshot> {
  const account = await multisig.accounts.Multisig.fromAccountAddress(
    connection,
    multisigPda,
  );
  const current = BigInt(account.transactionIndex.toString());
  return {
    multisigPda,
    vaultPda: getSentinelVaultPda(multisigPda),
    threshold: account.threshold,
    members: account.members.map((m) => m.key),
    currentTransactionIndex: current,
    nextTransactionIndex: current + 1n,
  };
}

/**
 * Offline-buildable steps of the Squads flow: create the vault transaction,
 * create the proposal, and one approveTx per approver. These can be assembled
 * without any RPC round-trip beyond getting a recent blockhash.
 *
 * `executeTx` is built separately by `buildSquadsExecuteTx` because Squads'
 * `vaultTransactionExecute` reads the VaultTransaction account off-chain to
 * resolve the message accounts — so it's only buildable once the proposal
 * has been broadcast (and, in practice, approved to threshold).
 */
export interface SquadsTransactionBundle {
  /** Step 1 — `vaultTransactionCreate`: signed by `creator` (+ feePayer if different). */
  createTx: VersionedTransaction;
  /** Step 2 — `proposalCreate`: signed by `creator` (+ feePayer if different). */
  proposeTx: VersionedTransaction;
  /**
   * Step 3 — `proposalApprove` × N: each signed by the corresponding member
   * (+ feePayer if different). Order matches `approvers`.
   */
  approveTxs: VersionedTransaction[];
  /** Index of the multisig transaction these txs operate on. */
  transactionIndex: bigint;
}

export interface BuildSquadsBundleOptions {
  /** Optional Connection — used only to fetch a blockhash if `blockhash` is unset. */
  connection?: Connection;
  /** Vault PDA (== Sentinel policy owner) — `getSentinelVaultPda(multisigPda)`. */
  vaultPda: PublicKey;
  /** Inner instruction the vault should execute (e.g. `update_policy`). */
  innerInstruction: TransactionInstruction;
  /** Squads multisig snapshot (use `fetchMultisigSnapshot`). */
  snapshot: MultisigSnapshot;
  /** Member submitting the proposal (creates + first approval). */
  creator: PublicKey;
  /** Members whose signature will be included in the bundle's `approveTxs`. */
  approvers: PublicKey[];
  /** Optional fee payer — defaults to `creator`. */
  feePayer?: PublicKey;
  /**
   * Latest blockhash. If omitted, one is fetched via `connection` (which is
   * then required). Tests pass a precomputed blockhash to keep the builder
   * fully offline.
   */
  blockhash?: string;
  /** Optional Squads program id override (for testnets / forks). */
  programId?: PublicKey;
}

/**
 * Build the offline steps of the Squads flow (create / propose / approve)
 * that wrap an arbitrary inner instruction.
 *
 * No transaction is signed here — callers are responsible for signing with
 * the matching keypair / wallet adapter and broadcasting *in order*. Once
 * the proposal has hit threshold approvals, call `buildSquadsExecuteTx` to
 * produce the final execute transaction.
 */
export async function buildSquadsBundle(
  opts: BuildSquadsBundleOptions,
): Promise<SquadsTransactionBundle> {
  const feePayer = opts.feePayer ?? opts.creator;
  let blockhash = opts.blockhash;
  if (!blockhash) {
    if (!opts.connection) {
      throw new Error(
        "buildSquadsBundle: pass either `blockhash` or `connection` (to fetch one)",
      );
    }
    blockhash = (await opts.connection.getLatestBlockhash("confirmed")).blockhash;
  }
  const transactionIndex = opts.snapshot.nextTransactionIndex;

  const transactionMessage = new TransactionMessage({
    payerKey: opts.vaultPda,
    recentBlockhash: blockhash,
    instructions: [opts.innerInstruction],
  });

  const createTx = multisig.transactions.vaultTransactionCreate({
    blockhash,
    feePayer,
    multisigPda: opts.snapshot.multisigPda,
    transactionIndex,
    creator: opts.creator,
    vaultIndex: 0,
    ephemeralSigners: 0,
    transactionMessage,
    ...(opts.programId ? { programId: opts.programId } : {}),
  });

  const proposeTx = multisig.transactions.proposalCreate({
    blockhash,
    feePayer,
    multisigPda: opts.snapshot.multisigPda,
    transactionIndex,
    creator: opts.creator,
    ...(opts.programId ? { programId: opts.programId } : {}),
  });

  const approveTxs = opts.approvers.map((member) =>
    multisig.transactions.proposalApprove({
      blockhash,
      feePayer,
      multisigPda: opts.snapshot.multisigPda,
      transactionIndex,
      member,
      ...(opts.programId ? { programId: opts.programId } : {}),
    }),
  );

  return { createTx, proposeTx, approveTxs, transactionIndex };
}

/**
 * Build the final execute transaction. Must be called *after* the proposal
 * has been broadcast (and, in production, hit threshold approvals) — Squads
 * resolves the inner instruction's message accounts by reading the
 * VaultTransaction account on-chain, so this requires a working RPC.
 */
export async function buildSquadsExecuteTx(opts: {
  connection: Connection;
  multisigPda: PublicKey;
  transactionIndex: bigint;
  /** Member that will sign + broadcast the execute. */
  executor: PublicKey;
  feePayer?: PublicKey;
  blockhash?: string;
  programId?: PublicKey;
}): Promise<VersionedTransaction> {
  const blockhash =
    opts.blockhash ??
    (await opts.connection.getLatestBlockhash("confirmed")).blockhash;
  return multisig.transactions.vaultTransactionExecute({
    connection: opts.connection,
    blockhash,
    feePayer: opts.feePayer ?? opts.executor,
    multisigPda: opts.multisigPda,
    transactionIndex: opts.transactionIndex,
    member: opts.executor,
    ...(opts.programId ? { programId: opts.programId } : {}),
  });
}

/** Convenience: build the Squads bundle wrapping `update_policy(newRoot)`. */
export async function buildUpdatePolicyViaSquads(opts: {
  connection: Connection;
  registryProgramId: PublicKey;
  multisigPda: PublicKey;
  agent: PublicKey;
  newRoot: Uint8Array;
  creator: PublicKey;
  approvers: PublicKey[];
  feePayer?: PublicKey;
  blockhash?: string;
  squadsProgramId?: PublicKey;
}): Promise<SquadsTransactionBundle & { snapshot: MultisigSnapshot }> {
  const snapshot = await fetchMultisigSnapshot(opts.connection, opts.multisigPda);
  const innerInstruction = buildUpdatePolicyIx({
    programId: opts.registryProgramId,
    owner: snapshot.vaultPda,
    agent: opts.agent,
    newRoot: opts.newRoot,
  });
  const bundle = await buildSquadsBundle({
    connection: opts.connection,
    vaultPda: snapshot.vaultPda,
    innerInstruction,
    snapshot,
    creator: opts.creator,
    approvers: opts.approvers,
    ...(opts.feePayer !== undefined ? { feePayer: opts.feePayer } : {}),
    ...(opts.blockhash !== undefined ? { blockhash: opts.blockhash } : {}),
    ...(opts.squadsProgramId !== undefined
      ? { programId: opts.squadsProgramId }
      : {}),
  });
  return { ...bundle, snapshot };
}

/** Convenience: build the Squads bundle wrapping `register_policy(agent, root)`. */
export async function buildRegisterPolicyViaSquads(opts: {
  connection: Connection;
  registryProgramId: PublicKey;
  multisigPda: PublicKey;
  agent: PublicKey;
  root: Uint8Array;
  creator: PublicKey;
  approvers: PublicKey[];
  feePayer?: PublicKey;
  blockhash?: string;
  squadsProgramId?: PublicKey;
}): Promise<SquadsTransactionBundle & { snapshot: MultisigSnapshot }> {
  const snapshot = await fetchMultisigSnapshot(opts.connection, opts.multisigPda);
  const innerInstruction = buildRegisterPolicyIx({
    programId: opts.registryProgramId,
    owner: snapshot.vaultPda,
    agent: opts.agent,
    root: opts.root,
  });
  const bundle = await buildSquadsBundle({
    connection: opts.connection,
    vaultPda: snapshot.vaultPda,
    innerInstruction,
    snapshot,
    creator: opts.creator,
    approvers: opts.approvers,
    ...(opts.feePayer !== undefined ? { feePayer: opts.feePayer } : {}),
    ...(opts.blockhash !== undefined ? { blockhash: opts.blockhash } : {}),
    ...(opts.squadsProgramId !== undefined
      ? { programId: opts.squadsProgramId }
      : {}),
  });
  return { ...bundle, snapshot };
}
