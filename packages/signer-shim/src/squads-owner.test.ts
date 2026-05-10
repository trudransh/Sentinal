import { describe, expect, it } from "vitest";
import {
  Keypair,
  PublicKey,
  type TransactionInstruction,
  VersionedTransaction,
} from "@solana/web3.js";
import * as multisig from "@sqds/multisig";

import {
  buildRegisterPolicyIx,
  buildSquadsBundle,
  buildUpdatePolicyIx,
  findPolicyPda,
  getSentinelVaultPda,
  type MultisigSnapshot,
} from "./squads-owner.js";

const REGISTRY_PROGRAM = new PublicKey(
  "2fQyCvg9MgiribMmXbXwn4oq587Kqo3cNGCh4x7BRVCk",
);
const ZERO_BLOCKHASH = "11111111111111111111111111111111";

function fakeSnapshot(multisigPda: PublicKey, members: PublicKey[]): MultisigSnapshot {
  const vaultPda = getSentinelVaultPda(multisigPda);
  return {
    multisigPda,
    vaultPda,
    threshold: 2,
    members,
    currentTransactionIndex: 5n,
    nextTransactionIndex: 6n,
  };
}

describe("findPolicyPda", () => {
  it("derives the same PDA as the on-chain seeds [policy, agent]", () => {
    const agent = Keypair.generate().publicKey;
    const pda = findPolicyPda(REGISTRY_PROGRAM, agent);
    const [expected] = PublicKey.findProgramAddressSync(
      [Buffer.from("policy"), agent.toBuffer()],
      REGISTRY_PROGRAM,
    );
    expect(pda.equals(expected)).toBe(true);
  });
});

describe("buildUpdatePolicyIx", () => {
  it("packs the discriminator + 32 bytes of root and uses the policy PDA", () => {
    const owner = Keypair.generate().publicKey;
    const agent = Keypair.generate().publicKey;
    const newRoot = new Uint8Array(32).fill(0xab);
    const ix = buildUpdatePolicyIx({
      programId: REGISTRY_PROGRAM,
      owner,
      agent,
      newRoot,
    });
    expect(ix.programId.equals(REGISTRY_PROGRAM)).toBe(true);
    expect(ix.data.byteLength).toBe(8 + 32);
    // First 8 bytes = update_policy discriminator from the IDL.
    expect(Array.from(ix.data.subarray(0, 8))).toEqual([
      212, 245, 246, 7, 163, 151, 18, 57,
    ]);
    // Last 32 bytes = newRoot.
    expect(Array.from(ix.data.subarray(8))).toEqual(Array.from(newRoot));
    // Account ordering: owner (signer, ro), policy PDA (writable).
    expect(ix.keys[0]?.pubkey.equals(owner)).toBe(true);
    expect(ix.keys[0]?.isSigner).toBe(true);
    expect(ix.keys[0]?.isWritable).toBe(false);
    expect(ix.keys[1]?.pubkey.equals(findPolicyPda(REGISTRY_PROGRAM, agent))).toBe(
      true,
    );
    expect(ix.keys[1]?.isWritable).toBe(true);
  });

  it("rejects a root that isn't exactly 32 bytes", () => {
    const owner = Keypair.generate().publicKey;
    const agent = Keypair.generate().publicKey;
    expect(() =>
      buildUpdatePolicyIx({
        programId: REGISTRY_PROGRAM,
        owner,
        agent,
        newRoot: new Uint8Array(31),
      }),
    ).toThrow(/32 bytes/);
  });
});

describe("buildRegisterPolicyIx", () => {
  it("encodes agent + root and lists owner/policy/system_program", () => {
    const owner = Keypair.generate().publicKey;
    const agent = Keypair.generate().publicKey;
    const root = new Uint8Array(32).fill(0xcd);
    const ix = buildRegisterPolicyIx({
      programId: REGISTRY_PROGRAM,
      owner,
      agent,
      root,
    });
    expect(ix.data.byteLength).toBe(8 + 32 + 32);
    expect(Array.from(ix.data.subarray(0, 8))).toEqual([
      62, 66, 167, 36, 252, 227, 38, 132,
    ]);
    expect(Array.from(ix.data.subarray(8, 8 + 32))).toEqual(
      Array.from(agent.toBuffer()),
    );
    expect(Array.from(ix.data.subarray(8 + 32))).toEqual(Array.from(root));
    expect(ix.keys).toHaveLength(3);
    expect(ix.keys[0]?.isSigner).toBe(true);
    expect(ix.keys[0]?.isWritable).toBe(true);
    expect(ix.keys[2]?.pubkey.toBase58()).toBe("11111111111111111111111111111111");
  });
});

describe("getSentinelVaultPda", () => {
  it("derives the same vault PDA as the Squads SDK helper", () => {
    const multisigPda = Keypair.generate().publicKey;
    const ours = getSentinelVaultPda(multisigPda);
    const [theirs] = multisig.getVaultPda({ multisigPda, index: 0 });
    expect(ours.equals(theirs)).toBe(true);
  });
});

describe("buildSquadsBundle", () => {
  const innerIx = (owner: PublicKey, agent: PublicKey): TransactionInstruction =>
    buildUpdatePolicyIx({
      programId: REGISTRY_PROGRAM,
      owner,
      agent,
      newRoot: new Uint8Array(32).fill(1),
    });

  it("returns three unsigned VersionedTransactions (create / propose / approve[])", async () => {
    const multisigPda = Keypair.generate().publicKey;
    const member1 = Keypair.generate().publicKey;
    const member2 = Keypair.generate().publicKey;
    const snapshot = fakeSnapshot(multisigPda, [member1, member2]);
    const agent = Keypair.generate().publicKey;

    const bundle = await buildSquadsBundle({
      vaultPda: snapshot.vaultPda,
      innerInstruction: innerIx(snapshot.vaultPda, agent),
      snapshot,
      creator: member1,
      approvers: [member1, member2],
      feePayer: member1,
      blockhash: ZERO_BLOCKHASH,
    });

    expect(bundle.transactionIndex).toBe(6n);
    expect(bundle.createTx).toBeInstanceOf(VersionedTransaction);
    expect(bundle.proposeTx).toBeInstanceOf(VersionedTransaction);
    expect(bundle.approveTxs).toHaveLength(2);
    bundle.approveTxs.forEach((tx) => expect(tx).toBeInstanceOf(VersionedTransaction));
  });

  it("uses transactionIndex = currentTransactionIndex + 1", async () => {
    const multisigPda = Keypair.generate().publicKey;
    const member1 = Keypair.generate().publicKey;
    const snapshot: MultisigSnapshot = {
      ...fakeSnapshot(multisigPda, [member1]),
      currentTransactionIndex: 99n,
      nextTransactionIndex: 100n,
      threshold: 1,
    };
    const agent = Keypair.generate().publicKey;

    const bundle = await buildSquadsBundle({
      vaultPda: snapshot.vaultPda,
      innerInstruction: innerIx(snapshot.vaultPda, agent),
      snapshot,
      creator: member1,
      approvers: [member1],
      blockhash: ZERO_BLOCKHASH,
    });

    expect(bundle.transactionIndex).toBe(100n);
  });

  it("emits one approveTx per approver, in input order", async () => {
    const multisigPda = Keypair.generate().publicKey;
    const m1 = Keypair.generate().publicKey;
    const m2 = Keypair.generate().publicKey;
    const m3 = Keypair.generate().publicKey;
    const snapshot = fakeSnapshot(multisigPda, [m1, m2, m3]);
    const agent = Keypair.generate().publicKey;

    const bundle = await buildSquadsBundle({
      vaultPda: snapshot.vaultPda,
      innerInstruction: innerIx(snapshot.vaultPda, agent),
      snapshot,
      creator: m1,
      approvers: [m1, m2, m3],
      blockhash: ZERO_BLOCKHASH,
    });

    expect(bundle.approveTxs).toHaveLength(3);
  });

  it("requires `connection` when no `blockhash` is provided", async () => {
    const multisigPda = Keypair.generate().publicKey;
    const m1 = Keypair.generate().publicKey;
    const snapshot = fakeSnapshot(multisigPda, [m1]);
    await expect(
      buildSquadsBundle({
        vaultPda: snapshot.vaultPda,
        innerInstruction: innerIx(snapshot.vaultPda, Keypair.generate().publicKey),
        snapshot,
        creator: m1,
        approvers: [m1],
      }),
    ).rejects.toThrow(/blockhash/);
  });
});
