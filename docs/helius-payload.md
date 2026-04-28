# Helius webhook payload — captured

> **Status: REAL.** Captured 2026-04-28T16:54:49Z from a live `register_policy` devnet tx (sig `kVBhPzzSyaE2v1kV69uAvrJGCKFWGzX33Nn9jdhJZYGKLvJY3yHirhmj8KBfn3UNuJ8AjSuZGPmB5MSpgnT8rqg`, slot 458704548). This row was delivered to `app/.data/sentinel.db.policy_events` (id=5, plen=1540).

## Top-level fields used by the dashboard

| Field | Type | Notes |
|---|---|---|
| `signature` | string | base58, the tx sig — primary key in `policy_events.signature` |
| `slot` | number | for ordering |
| `timestamp` | number | unix seconds (not ms) |
| `feePayer` | string (base58) | the **owner** of the policy in our flow |
| `accountData[]` | array | per-account native + token deltas |
| `instructions[]` | array | top-level instructions, each with `programId`, `accounts[]`, `data` (base58) |
| `instructions[].innerInstructions[]` | array | inner CPIs |
| `events` | object | **empty when no IDL is published on-chain** — Helius cannot decode Anchor events without `anchor idl init`. C3 (decoded events) decodes the ix data manually instead. |
| `description` | string | empty for unknown program types |
| `source` | string | `"UNKNOWN"` for our program; e.g. `"JUPITER"` for known programs |
| `type` | string | `"UNKNOWN"` for our program |
| `transactionError` | null \| object | non-null on revert |

## Identifying the agent

Because `events: {}` is empty, `agent` is **not** a top-level field. Two options:

1. **Decode the instruction data** (preferred — works without `anchor idl init`).
   - `instructions[0].programId` matches `SENTINEL_PROGRAM_ID`
   - base58-decode `instructions[0].data`
   - First 8 bytes = Anchor discriminator (compare against IDL):
     - `register_policy`: `[62, 66, 167, 36, 252, 227, 38, 132]`
     - `update_policy`:   `[212, 245, 246, 7, 163, 151, 18, 57]`
     - `revoke_policy`:   `[49, 221, 179, 43, 154, 148, 35, 4]`
   - For `register_policy`: bytes 8..40 = agent pubkey, 40..72 = root
   - For `update_policy`:   bytes 8..40 = new root (agent comes from has_one PDA)
   - For `revoke_policy`:   no extra args (agent comes from has_one PDA)

2. **Invert the policy PDA** — the writable account in `accountData[]` (other than the fee-payer) is the policy PDA at seeds `[b"policy", agent]`. Inverting requires brute-forcing the agent or relying on signers — not deterministic from the payload alone.

Option 1 is what `app/lib/helius.ts` should do for C3.

## Sample raw payload (real)

```json
{
  "accountData": [
    { "account": "UBKRkqqohyRWhifKFFmm65RcWBNb17gfga1c7N2F7DQ", "nativeBalanceChange": -2468840, "tokenBalanceChanges": [] },
    { "account": "3qezYWDRvVzu8g75EgFT5nqL5nou5BfQiWpiuQdgTdcS", "nativeBalanceChange":  2463840, "tokenBalanceChanges": [] },
    { "account": "11111111111111111111111111111111",           "nativeBalanceChange":        0, "tokenBalanceChanges": [] },
    { "account": "2fQyCvg9MgiribMmXbXwn4oq587Kqo3cNGCh4x7BRVCk", "nativeBalanceChange":      0, "tokenBalanceChanges": [] }
  ],
  "description": "",
  "events": {},
  "fee": 5000,
  "feePayer": "UBKRkqqohyRWhifKFFmm65RcWBNb17gfga1c7N2F7DQ",
  "instructions": [
    {
      "accounts": [
        "UBKRkqqohyRWhifKFFmm65RcWBNb17gfga1c7N2F7DQ",
        "3qezYWDRvVzu8g75EgFT5nqL5nou5BfQiWpiuQdgTdcS",
        "11111111111111111111111111111111"
      ],
      "data": "vJSveqwuJNztqp4F2wnMAckx62dEwkvL8rPeNi7ZpcY2jPTRhu9T1ALCYpPCyKyhLZDV6PMDibozh5o5xGUcyAvY96xnjzxXye",
      "innerInstructions": [
        {
          "accounts": [
            "UBKRkqqohyRWhifKFFmm65RcWBNb17gfga1c7N2F7DQ",
            "3qezYWDRvVzu8g75EgFT5nqL5nou5BfQiWpiuQdgTdcS"
          ],
          "data": "11114YWjDYGXu2RxurXut24B9xK3Sv7ECPTuPCfMJdVVAr4F2fenNDXLFufP2CSDNBrEdN",
          "programId": "11111111111111111111111111111111"
        }
      ],
      "programId": "2fQyCvg9MgiribMmXbXwn4oq587Kqo3cNGCh4x7BRVCk"
    }
  ],
  "nativeTransfers": [
    { "amount": 2463840, "fromUserAccount": "UBKRkqqohyRWhifKFFmm65RcWBNb17gfga1c7N2F7DQ", "toUserAccount": "3qezYWDRvVzu8g75EgFT5nqL5nou5BfQiWpiuQdgTdcS" }
  ],
  "signature": "kVBhPzzSyaE2v1kV69uAvrJGCKFWGzX33Nn9jdhJZYGKLvJY3yHirhmj8KBfn3UNuJ8AjSuZGPmB5MSpgnT8rqg",
  "slot": 458704548,
  "source": "UNKNOWN",
  "timestamp": 1777395288,
  "tokenTransfers": [],
  "transactionError": null,
  "type": "UNKNOWN"
}
```

## Auth

`HELIUS_WEBHOOK_SECRET` is echoed back as the `Authorization` header on every POST.
The route rejects with 401 on mismatch. With the secret unset and not in
production, the route returns 503 (D4 fix).

## Implication for app/lib/helius.ts

Current `classifyTx` returns `kind=registered/updated/revoked` but `agent="unknown"`
because it's looking at `events.<programName>` which Helius leaves empty. C3 fix:
decode the instruction data via the discriminator table above.
