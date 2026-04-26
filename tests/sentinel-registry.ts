import * as anchor from "@coral-xyz/anchor";
import type { Program } from "@coral-xyz/anchor";
import {
  Keypair,
  LAMPORTS_PER_SOL,
  PublicKey,
  SystemProgram,
} from "@solana/web3.js";
import { expect } from "chai";

// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore — generated after `anchor build`
import type { SentinelRegistry } from "../target/types/sentinel_registry";

describe("sentinel-registry", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = anchor.workspace.SentinelRegistry as Program<SentinelRegistry>;
  const owner = (provider.wallet as anchor.Wallet).payer;
  const stranger = Keypair.generate();
  const agent = Keypair.generate();
  const root1 = Array.from(new Uint8Array(32).fill(0xaa));
  const root2 = Array.from(new Uint8Array(32).fill(0xbb));

  const [pda] = PublicKey.findProgramAddressSync(
    [Buffer.from("policy"), agent.publicKey.toBuffer()],
    program.programId,
  );

  before(async () => {
    const sig = await provider.connection.requestAirdrop(
      stranger.publicKey,
      1 * LAMPORTS_PER_SOL,
    );
    await provider.connection.confirmTransaction(sig, "confirmed");
  });

  it("registers a policy", async () => {
    await program.methods
      .registerPolicy(agent.publicKey, root1 as unknown as number[])
      .accounts({
        owner: owner.publicKey,
        policy: pda,
        systemProgram: SystemProgram.programId,
      })
      .rpc();

    const rec = await program.account.policyRecord.fetch(pda);
    expect(rec.owner.equals(owner.publicKey)).to.equal(true);
    expect(rec.agent.equals(agent.publicKey)).to.equal(true);
    expect(rec.version).to.equal(1);
    expect(rec.revoked).to.equal(false);
    expect(Buffer.from(rec.root).equals(Buffer.from(root1))).to.equal(true);
  });

  it("updates the policy and bumps version", async () => {
    await program.methods
      .updatePolicy(root2 as unknown as number[])
      .accounts({ owner: owner.publicKey, policy: pda })
      .rpc();
    const rec = await program.account.policyRecord.fetch(pda);
    expect(rec.version).to.equal(2);
    expect(Buffer.from(rec.root).equals(Buffer.from(root2))).to.equal(true);
  });

  it("rejects update from a non-owner signer", async () => {
    let threw = false;
    try {
      await program.methods
        .updatePolicy(root1 as unknown as number[])
        .accounts({ owner: stranger.publicKey, policy: pda })
        .signers([stranger])
        .rpc();
    } catch (err) {
      threw = true;
      expect(String(err)).to.match(/Unauthorized|ConstraintHasOne/);
    }
    expect(threw).to.equal(true);
  });

  it("revokes the policy", async () => {
    await program.methods
      .revokePolicy()
      .accounts({ owner: owner.publicKey, policy: pda })
      .rpc();
    const rec = await program.account.policyRecord.fetch(pda);
    expect(rec.revoked).to.equal(true);
  });

  it("rejects update after revoke", async () => {
    let threw = false;
    try {
      await program.methods
        .updatePolicy(root1 as unknown as number[])
        .accounts({ owner: owner.publicKey, policy: pda })
        .rpc();
    } catch (err) {
      threw = true;
      expect(String(err)).to.match(/PolicyRevoked/);
    }
    expect(threw).to.equal(true);
  });

  it("emits events on each instruction", async () => {
    const newAgent = Keypair.generate();
    const [newPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("policy"), newAgent.publicKey.toBuffer()],
      program.programId,
    );

    const seenEvents: string[] = [];
    const listener = program.addEventListener("policyRegistered", (event) => {
      if (event.agent.equals(newAgent.publicKey)) seenEvents.push("policyRegistered");
    });

    try {
      await program.methods
        .registerPolicy(newAgent.publicKey, root1 as unknown as number[])
        .accounts({
          owner: owner.publicKey,
          policy: newPda,
          systemProgram: SystemProgram.programId,
        })
        .rpc();
      await new Promise((r) => setTimeout(r, 1500));
      expect(seenEvents).to.include("policyRegistered");
    } finally {
      await program.removeEventListener(listener);
    }
  });
});
