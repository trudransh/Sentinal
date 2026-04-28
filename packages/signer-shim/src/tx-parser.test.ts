import { describe, expect, it } from "vitest";
import {
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
  TransactionInstruction,
  VersionedTransaction,
  VersionedMessage,
  TransactionMessage,
} from "@solana/web3.js";
import {
  createTransferCheckedInstruction,
  createTransferInstruction,
  TOKEN_PROGRAM_ID,
} from "@solana/spl-token";

const TOKEN_2022_PROGRAM_ID = new PublicKey("TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb");

import { parseTx } from "./tx-parser.js";
import { stubOracle } from "./price-oracle.js";
import { SentinelError } from "./errors.js";

const AGENT_KP = Keypair.generate();
const AGENT = AGENT_KP.publicKey.toBase58();
const USDC_DEV = new PublicKey("4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU");

function envForTest() {
  return {
    splDecimalsCache: new Map<string, number>([[USDC_DEV.toBase58(), 6]]),
    oracle: stubOracle,
    agent: AGENT,
    now: 1_700_000_000_000,
  };
}

describe("tx-parser", () => {
  it("parses a SOL system transfer into one TxSummary", async () => {
    const tx = new Transaction();
    const recipient = Keypair.generate().publicKey;
    tx.add(
      SystemProgram.transfer({
        fromPubkey: AGENT_KP.publicKey,
        toPubkey: recipient,
        lamports: 250_000_000,
      }),
    );
    const summaries = await parseTx(tx, envForTest());
    expect(summaries).toHaveLength(1);
    expect(summaries[0]?.token).toBe("SOL");
    expect(summaries[0]?.amount).toBeCloseTo(0.25);
    expect(summaries[0]?.destination).toBe(recipient.toBase58());
    expect(summaries[0]?.programId).toBe(SystemProgram.programId.toBase58());
  });

  it("parses a USDC TransferChecked into a USDC TxSummary", async () => {
    const tx = new Transaction();
    const source = Keypair.generate().publicKey;
    const dest = Keypair.generate().publicKey;
    tx.add(
      createTransferCheckedInstruction(
        source,
        USDC_DEV,
        dest,
        AGENT_KP.publicKey,
        2_500_000n,
        6,
      ),
    );
    const summaries = await parseTx(tx, envForTest());
    expect(summaries).toHaveLength(1);
    expect(summaries[0]?.token).toBe("USDC");
    expect(summaries[0]?.amount).toBeCloseTo(2.5);
    expect(summaries[0]?.programId).toBe(TOKEN_PROGRAM_ID.toBase58());
  });

  it("legacy SPL Transfer uses cached decimals", async () => {
    const tx = new Transaction();
    const source = Keypair.generate().publicKey;
    const dest = Keypair.generate().publicKey;
    tx.add(
      createTransferInstruction(source, dest, AGENT_KP.publicKey, 1_000_000n),
    );
    const env = envForTest();
    env.splDecimalsCache.set(source.toBase58(), 6);
    const summaries = await parseTx(tx, env);
    expect(summaries).toHaveLength(1);
    expect(summaries[0]?.amount).toBeCloseTo(1);
  });

  it("rejects an empty Transaction", async () => {
    const tx = new Transaction();
    await expect(parseTx(tx, envForTest())).rejects.toBeInstanceOf(SentinelError);
  });

  it("rejects a VersionedTransaction", async () => {
    const message = new TransactionMessage({
      payerKey: AGENT_KP.publicKey,
      recentBlockhash: "11111111111111111111111111111111",
      instructions: [
        SystemProgram.transfer({
          fromPubkey: AGENT_KP.publicKey,
          toPubkey: Keypair.generate().publicKey,
          lamports: 1,
        }),
      ],
    }).compileToV0Message();
    const vtx = new VersionedTransaction(message as VersionedMessage);
    await expect(
      parseTx(vtx as unknown as Transaction, envForTest()),
    ).rejects.toMatchObject({ code: "UNSUPPORTED_TX" });
  });

  it("rejects Token-2022 instructions with TOKEN_2022_NOT_SUPPORTED", async () => {
    const tx = new Transaction();
    tx.add(
      new TransactionInstruction({
        programId: TOKEN_2022_PROGRAM_ID,
        keys: [
          { pubkey: Keypair.generate().publicKey, isSigner: false, isWritable: true },
          { pubkey: Keypair.generate().publicKey, isSigner: false, isWritable: true },
          { pubkey: AGENT_KP.publicKey, isSigner: true, isWritable: false },
        ],
        data: Buffer.from([3, 0, 0, 0, 0, 0, 0, 0, 0]),
      }),
    );
    await expect(parseTx(tx, envForTest())).rejects.toMatchObject({
      code: "TOKEN_2022_NOT_SUPPORTED",
    });
  });

  it("multi-instruction tx returns one summary per instruction", async () => {
    const tx = new Transaction();
    const a = Keypair.generate().publicKey;
    const b = Keypair.generate().publicKey;
    tx.add(
      SystemProgram.transfer({
        fromPubkey: AGENT_KP.publicKey,
        toPubkey: a,
        lamports: 100_000_000,
      }),
    );
    tx.add(
      createTransferCheckedInstruction(
        Keypair.generate().publicKey,
        USDC_DEV,
        b,
        AGENT_KP.publicKey,
        500_000n,
        6,
      ),
    );
    const summaries = await parseTx(tx, envForTest());
    expect(summaries).toHaveLength(2);
    expect(summaries[0]?.token).toBe("SOL");
    expect(summaries[1]?.token).toBe("USDC");
  });
});
