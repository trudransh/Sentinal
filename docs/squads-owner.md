# Squads Smart Account as Sentinel policy owner

Phase 7 wires Sentinel's `PolicyRecord.owner` to a Squads v4 multisig vault PDA. Sentinel itself doesn't change — `owner: Signer<'info>` and `has_one = owner` already accept any Solana signer, including Squads vault PDAs that sign through `vaultTransactionExecute`. The result: every `update_policy` and `revoke_policy` requires threshold-many member approvals, with native Squads UI for proposal review and audit.

## Why this matters

The closest competitive precedent (Mercantill, Cypherpunk 2025 4th-place Stablecoins) treats spend control + multi-sig + audit log as one product. Sentinel composes with Squads instead of duplicating it: Sentinel provides the **policy primitive** (off-chain pluggable rules, on-chain root binding, signer refusal), Squads provides the **governance primitive** (members, threshold, audit). One change of `owner`, no new on-chain code.

## Trust-model implications

| Property | Personal-keypair owner | Squads-vault owner |
|---|---|---|
| Who can rotate policy | Single keypair | Threshold-many members |
| Audit trail | Helius event stream only | Squads UI + on-chain Proposal accounts |
| Hardware-wallet support | Phantom Ledger pass-through | Each member can use any wallet |
| Compromise blast-radius | Whole policy authority | One member, until threshold reached |

The on-chain registry's `update_policy` authority is still the most critical key — but it's now the multisig's threshold rather than a single signature.

## Flow

The Squads v4 SDK splits `update_policy` into four steps:

```
1. vaultTransactionCreate(creator, transactionMessage=[update_policy_ix])
2. proposalCreate(creator)
3. proposalApprove(member)  ×  threshold
4. vaultTransactionExecute(member)
```

`@sentinel/signer-shim` exposes:

- `getSentinelVaultPda(multisigPda)` — wraps `multisig.getVaultPda({index: 0})`. Use the result as `policy.owner`.
- `fetchMultisigSnapshot(connection, multisigPda)` — returns `{vaultPda, threshold, members[], currentTransactionIndex, nextTransactionIndex}`.
- `buildUpdatePolicyIx`, `buildRegisterPolicyIx` — raw Sentinel instruction builders that don't depend on `@coral-xyz/anchor` (so the dashboard can use them without bundling Anchor).
- `buildSquadsBundle` — produces `{createTx, proposeTx, approveTxs[], transactionIndex}`. All offline (with a precomputed blockhash) or fetches one via `connection`.
- `buildSquadsExecuteTx` — produces the execute transaction. Online-only (Squads resolves the inner-ix accounts from the on-chain VaultTransaction record).
- `buildUpdatePolicyViaSquads`, `buildRegisterPolicyViaSquads` — convenience wrappers that run `fetchMultisigSnapshot` + `buildSquadsBundle` for the two Sentinel ix shapes.

## Demo path

1. Create a Squads multisig at https://devnet.squads.so with two members and threshold = 2.
2. Note the multisig PDA. The vault PDA is `getSentinelVaultPda(multisigPda)`.
3. Register a Sentinel policy where `owner = vault_pda`. This must itself happen via Squads (the vault PDA can only sign through `vaultTransactionExecute`). Use `buildRegisterPolicyViaSquads` from a member wallet.
4. In the dashboard, paste the multisig PDA into the "Squads multisig owner" card. Members appear; current `transactionIndex` shown.
5. Edit YAML, click `validate` (server hashes), then `propose update via Squads`. The connected wallet signs three transactions (`vaultTransactionCreate`, `proposalCreate`, first `proposalApprove`).
6. Other members approve in the Squads web UI (or via the dashboard once polished).
7. Once threshold is met, click `execute`. Sentinel's `update_policy` runs with the vault PDA as signer; on-chain `version` increments.
8. Sentinel's signer-shim refuses to sign agent transactions until the local YAML hash matches the new on-chain root — exactly as in personal-owner mode.

## What's offline-tested

`packages/signer-shim/src/squads-owner.test.ts` covers:

- Policy PDA derivation matches the Anchor seeds.
- `update_policy` and `register_policy` ix encoding (discriminator + arg bytes).
- `getSentinelVaultPda` parity with the Squads SDK's `getVaultPda({index: 0})`.
- `buildSquadsBundle` produces three `VersionedTransaction`s in step order with `transactionIndex = currentTransactionIndex + 1`.
- `buildSquadsBundle` requires `connection` when `blockhash` is omitted.

`scripts/probes/squads-probe.ts` is the offline decision-gate: it confirms the SDK shape against our adapter without any RPC. Output goes to `/tmp/sentinel-squads-probe.json`.

## What's exercised on devnet

The execute path (`buildSquadsExecuteTx` + Sentinel `update_policy`) runs against real RPC. It's covered by the dashboard end-to-end during the demo recording. Ledger / hardware-wallet members work transparently through the wallet adapter.

## Limitations

- Sentinel's `revoke_policy` instruction is symmetric — also signed by `owner`. Revocation through Squads works the same way; not exercised in the demo because revocation is a one-shot.
- Squads has time-locks (`timeLock` on the multisig); we don't surface them in the dashboard. The on-chain proposal record reflects them either way.
- The dashboard's `propose update via Squads` currently signs with the *connected* member only. Other members approve in the Squads web UI. A future iteration can subscribe to the proposal account and prompt remaining members on the dashboard.
