# Hackathon eligibility check (operator action required)

Sentinel is built from India. Most Solana hackathon sponsor tracks have **no geographic restrictions** beyond standard OFAC compliance (Iran, North Korea, Cuba, Syria, Crimea — none of which are India). Common myths — "Zerion is US-only", "x402 needs a US bank account" — are usually wrong; verify per track.

## What needs verifying

Before submitting, open each track's page on https://www.colosseum.com/hackathon (or arena.colosseum.org) and `Ctrl-F` for the words `eligib`, `restrict`, `country`, `region`. If silent or only mentioning OFAC, you're eligible.

Automated `WebFetch` against the public hackathon pages returned only landing-page boilerplate (no track-level eligibility text) — manual verification is required.

| Track | Likely eligible? | What to look for | Action |
|---|---|---|---|
| Zerion #1 (scoped agents) | Yes (global SDK) | "geographic restrictions" / "OFAC" | Confirm + screenshot |
| Zerion #2 (real txs) | Yes (global SDK) | same | same |
| Helius / RPC Fast | Yes (global infra) | usually only requires Helius API key in product | Confirm + screenshot |
| Dune SIM | Yes (global) | usually only requires SIM endpoint use | Confirm + screenshot |
| Pyth | Yes (global) | usually only requires a Pyth feed in product | Confirm + screenshot |
| Phantom (if exists) | Yes (global wallet) | usually only requires Phantom adapter integration | Confirm + screenshot |
| 100xDevs | **Yes, India-favored** | solo / student team, public GitHub, video | Confirm + Harkirat-aligned framing |
| Superteam India | Yes, regional | India residence/citizenship, TG handle, dual-submission to Superteam DAO portal | **Required: TG handle** |
| Dodo × Superteam India | Yes, regional | same as Superteam India + Dodo Payments SDK in product | Confirm + Dodo flow on demo |
| KIRAPAY | Yes, India-favored | usually demo cross-chain payment intent | Confirm + reach out on X |
| Adevar / Eitherway | Yes (global infra) | open-source, MIT license, public repo | Already MIT — confirm |
| Squads | Yes (ecosystem program) | usually requires Squads in product surface | Phase 7 satisfies — confirm |
| **La Familia (Spain)** | **No — Spanish-speaker requirement** | language requirement | **Drop** |
| Encrypt × Ika | Not for Sentinel | confidential compute / dWallet | Skip |
| Cloak / Umbra (Arcium) | Not for Sentinel | privacy primitive | Skip |
| MagicBlock | Not for Sentinel | ER ephemeral rollup | Skip |
| LI.FI | Not for Sentinel | cross-chain UX | Skip |

## KYC / tax form

Indian residents may need to file **W-8BEN** for US-funded prizes. This is post-win, doesn't block submission. Standard.

## Submission fields likely to ask for nationality

- Some sponsor tracks ask for nationality / city — fill in honestly. Indian residence does not exclude any of the tracks above except La Familia.

## Action checklist before final submit

- [ ] Open each "Likely eligible" track page above; screenshot the eligibility section into this folder as `screenshots/eligibility-<track>.png` (or note "no eligibility text shown" verbatim).
- [ ] If any track unexpectedly excludes India, mark this file with the verbatim clause and pick a replacement track from the same tier.
- [ ] Send Telegram handle to Superteam India regional channel before submission deadline.
- [ ] Confirm KIRAPAY / Harkirat (100xDevs) reach-out on X — soft signal, often unlocks honorable-mention.
