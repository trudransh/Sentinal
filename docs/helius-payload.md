# Helius webhook payload (probed)

> **Status: PLACEHOLDER.** Replace with the actual JSON received at `app/api/webhook/route.ts` after registering the webhook in Phase 5.

Helius's enhanced webhook posts an array of enriched transactions. Capture one of each kind we care about:

1. `register_policy` event → expect `events.compressed` or raw program logs containing the Anchor event discriminator.
2. `update_policy` event.
3. `revoke_policy` event.

Helius decodes Anchor events when the IDL is published on-chain (`anchor idl init` after deploy). Confirm the decoded shape lives in `events.<programName>` or in raw `logs[]`.

## Auth

We set `HELIUS_WEBHOOK_SECRET` to an arbitrary string when registering the webhook. Helius echoes it back as the `Authorization` header on every POST. The route rejects with 401 if it doesn't match.
