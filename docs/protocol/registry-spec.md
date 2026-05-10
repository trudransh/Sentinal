# On-Chain Registry Specification

> **The Sentinel Registry is an Anchor 0.32.1 program deployed on Solana devnet.**

Program ID: `2fQyCvg9MgiribMmXbXwn4oq587Kqo3cNGCh4x7BRVCk`

---

## Account Layout

### PolicyRecord (PDA)

**Seeds:** `["policy", agent_pubkey]`

| Field | Type | Size | Description |
|---|---|---|---|
| `owner` | `Pubkey` | 32 bytes | The authority that can update or revoke this policy. Can be a personal keypair or a Squads vault PDA. |
| `agent` | `Pubkey` | 32 bytes | The agent this policy governs. Immutable after creation. |
| `policy_root` | `[u8; 32]` | 32 bytes | SHA-256 hash of the canonical policy YAML. The signer-shim compares this against its local hash. |
| `version` | `u64` | 8 bytes | Monotonically increasing. Starts at 1, increments on each `update_policy`. |
| `revoked` | `bool` | 1 byte | If `true`, the signer-shim refuses ALL signing for this agent. Irreversible. |
| `created_at` | `i64` | 8 bytes | Unix timestamp of creation (`Clock::get().unix_timestamp`). |

**Total account size:** 8 (discriminator) + 32 + 32 + 32 + 8 + 1 + 8 = **121 bytes**

### PDA Derivation

```typescript
const [policyPda] = PublicKey.findProgramAddressSync(
  [Buffer.from("policy"), agentPubkey.toBuffer()],
  registryProgramId,
);
```

Each agent has exactly **one** PolicyRecord PDA. There is no multi-policy support in v1 — one agent, one active policy.

---

## Instructions

### `register_policy`

Creates a new PolicyRecord for an agent.

**Accounts:**

| Account | Signer? | Writable? | Description |
|---|---|---|---|
| `owner` | ✅ | ❌ | The initial policy owner. Signs the transaction. |
| `policy_record` | ❌ | ✅ | The PDA to initialize (derived from agent pubkey). |
| `payer` | ✅ | ✅ | Pays for account rent. Usually same as `owner`. |
| `system_program` | ❌ | ❌ | The Solana System Program. |

**Arguments:**

| Arg | Type | Description |
|---|---|---|
| `agent` | `Pubkey` | The agent's public key |
| `policy_root` | `[u8; 32]` | SHA-256 hash of the canonical policy |

**Events emitted:** `PolicyRegistered { agent, owner, root, version: 1 }`

**Errors:**
- Fails if the PDA already exists (agent already has a policy)

---

### `update_policy`

Changes the policy root for an existing agent.

**Accounts:**

| Account | Signer? | Writable? | Description |
|---|---|---|---|
| `owner` | ✅ | ❌ | Must match `policy_record.owner`. |
| `policy_record` | ❌ | ✅ | The existing PDA to update. |

**Constraints:** `has_one = owner` — only the current owner can update.

**Arguments:**

| Arg | Type | Description |
|---|---|---|
| `new_root` | `[u8; 32]` | The new policy root hash |

**Effects:**
- Sets `policy_record.policy_root = new_root`
- Increments `policy_record.version`

**Events emitted:** `PolicyUpdated { agent, new_root, version }`

---

### `revoke_policy`

Permanently revokes a policy. The signer-shim will refuse all signing for this agent.

**Accounts:**

| Account | Signer? | Writable? | Description |
|---|---|---|---|
| `owner` | ✅ | ❌ | Must match `policy_record.owner`. |
| `policy_record` | ❌ | ✅ | The PDA to revoke. |

**Constraints:** `has_one = owner`

**Effects:**
- Sets `policy_record.revoked = true`
- This is **irreversible**. To re-enable the agent, register a new policy.

**Events emitted:** `PolicyRevoked { agent, version }`

---

## Events

All state changes emit Anchor events. The dashboard's Helius webhook subscription captures these and streams them via SSE.

```rust
#[event]
pub struct PolicyRegistered {
    pub agent: Pubkey,
    pub owner: Pubkey,
    pub root: [u8; 32],
    pub version: u64,
}

#[event]
pub struct PolicyUpdated {
    pub agent: Pubkey,
    pub new_root: [u8; 32],
    pub version: u64,
}

#[event]
pub struct PolicyRevoked {
    pub agent: Pubkey,
    pub version: u64,
}
```

---

## Squads Vault as Owner

When `policy_record.owner` is a Squads v4 vault PDA, the `has_one = owner` constraint still works — the vault signs through `vaultTransactionExecute`. This means every `update_policy` and `revoke_policy` requires threshold-many member approvals with zero changes to the on-chain program.

```
Personal keypair owner:
  owner signs update_policy directly → immediate

Squads vault owner:
  member1: vaultTransactionCreate(update_policy_ix)
  member1: proposalCreate()
  member1: proposalApprove()
  member2: proposalApprove()   ← threshold met
  any member: vaultTransactionExecute() → vault PDA signs update_policy
```

See [`docs/squads-owner.md`](../squads-owner.md) for the full implementation.

---

## IDL

The Anchor IDL is generated at `target/idl/sentinel_registry.json` after `anchor build`. It contains the full type-safe specification for all instructions, accounts, and events.

To use in TypeScript:
```typescript
import { Program, AnchorProvider } from "@coral-xyz/anchor";
import idl from "../target/idl/sentinel_registry.json";

const program = new Program(idl, registryProgramId, provider);
await program.methods
  .registerPolicy(agentPubkey, rootBytes)
  .accounts({ owner: wallet.publicKey, policyRecord: pda, payer: wallet.publicKey })
  .rpc();
```

---

## Devnet Deployment

The program is currently deployed on Solana devnet:
- **Program ID:** `2fQyCvg9MgiribMmXbXwn4oq587Kqo3cNGCh4x7BRVCk`
- **Anchor version:** 0.32.1
- **Solana CLI:** Agave 3.0+

To redeploy after modifications:
```bash
solana config set --url devnet
solana airdrop 4
anchor build
anchor deploy --provider.cluster devnet
```
