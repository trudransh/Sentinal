# ADR 0004 — Helius webhooks for events, Dune SIM for analytics

| | |
|---|---|
| Status | Accepted |
| Date | 2026-04-28 |
| Driver | Phase 5 (dashboard) |

## Context

The dashboard needs two distinct streams of data:

1. **Real-time**: when a `register_policy` / `update_policy` / `revoke_policy`
   tx confirms, surface it within a few seconds.
2. **Analytics**: agent balances and 7-day spend graphs.

Both Helius and Dune SIM can technically deliver either. The question is
which fits which.

## Decision

- **Helius enhanced webhooks** for real-time events. Push-based: Helius posts
  to `/api/webhook` within ~5s of confirmation. Verified live 2026-04-28
  (`docs/helius-payload.md`).
- **Dune SIM** for analytics. Pull-based: dashboard hits
  `/v1/svm/balances/<address>` and `/svm/transactions` on demand and caches.

## Consequences

**Positive**
- No long-poll or RPC subscription bookkeeping — Helius handles delivery,
  including retries on 5xx
- Webhook auth is a single header (`HELIUS_WEBHOOK_SECRET`), trivial to verify
- Two SIM endpoints (balances + transactions) satisfies the Dune SIM track's
  "use multiple endpoints" judging signal
- The two streams are decoupled — analytics outage doesn't affect signing,
  webhook outage doesn't affect spend graphs

**Negative**
- Adds **two** external API dependencies. Both have rate limits we haven't
  quantified for the hackathon load profile (one operator + judges)
- Helius's enhanced decoder leaves `events: {}` empty for unpublished IDLs,
  so we have to decode the instruction data ourselves via discriminator
  table (see `docs/helius-payload.md` "Identifying the agent")
- Tunnel requirement for local dev (cloudflared/ngrok) — operationally
  fiddly; documented in README

## Alternatives rejected

- **Helius for both**: SIM's spend graph endpoints are richer; rebuilding
  that aggregation on top of webhook firehose is a lot of work for no win.
- **Dune SIM webhooks**: SIM's webhook product is newer than Helius's and
  the docs were less clear at the time of decision. Helius enhanced webhooks
  are well-known and battle-tested.
- **Roll our own RPC subscription**: doable with `Connection.onProgramAccountChange`
  but requires a long-lived process the dashboard doesn't have. Rejected for
  hackathon scope.

## Verification

`app/app/api/webhook/route.ts` accepts Helius enhanced payloads and inserts
into `policy_events`. Verified live 2026-04-28T16:54Z (signature
`kVBhPzzSyaE2v1kV…`, plen=1540 bytes). `app/lib/sim.ts` proxies SIM with a
30s in-memory cache + zod schema. Live SIM probe is A6, blocked on
`SIM_API_KEY`.
