# ADR 0001: Architecture for the local MVP

Status: accepted for the foundation commit (2026-10-02). Owner: the build lead, acting as planner. Revised after the independent-qa round-1 review (`docs/reviews/phase0/verdict-qa-r1.md`).

## Context

Pocket QA is a buyer-funded, real-device mobile usability testing product. Its source is `/Users/hamzadiaz/Projects/app-research/app-research-codex.md`, sections 1 and 5.1. The MVP runs locally only: money is test credits, and wallet features use devnet only. The execution plan is `docs/plans/pocket-qa-execution-plan.md`.

## Decisions

1. **Monorepo:** pnpm monorepo with strict TypeScript and source-consumed packages. `packages/contracts` and `packages/domain` export `.ts` source directly. Metro, vitest and `tsx` all consume TypeScript, so there's no build step to drift. The node linker is hoisted, for Metro.

2. **Runtime:** Node 24 LTS (24.21.0). Node 25 is past EOL (2026-06-01). See `dependency-versions.md`.

3. **Contracts come first and the lead writes them.** The foundation includes `packages/contracts`, which holds the Zod schemas and a `routes` table. Each route is bound to an `auth` level, an ownership `scope`, a request schema and a response schema. That lets backend, mobile and wallet build against one contract, and lets the authorization-matrix test iterate the table. After the foundation, backend owns the contracts, and every change is logged in `docs/decisions/contract-changes.md`.

4. **API:** Fastify 5 on `127.0.0.1:8787`.
   - At startup it refuses any non-loopback host, and any data directory that isn't git-ignored or outside the repo.
   - Storage is better-sqlite3 with SQL migrations. The data directory is `apps/api/.data/`, which is git-ignored.
   - Media lives on local disk and is served only through playback tokens. Each token is bound to one evidence item and the requesting user, and expires in 300 seconds.
   - Tokens travel in the `/media/:token` path, so the request logger must redact everything after each prefix in `REDACTED_PATH_PREFIXES`. Test `api/log.redact.test.ts` pins this.

5. **Auth:**
   - Email and password, hashed with argon2id via `@node-rs/argon2`.
   - Sessions use opaque random bearer tokens. The server stores them as SHA-256 hashes, and clients send them in `Authorization: Bearer`.
   - Bearer tokens instead of cookies means native and the web preview share one flow.
   - CORS allows only `http://localhost:*` and `http://127.0.0.1:*` origins.
   - Self-registration offers only `tester` and `builder`. `admin` is created only by a local CLI script.
   - Suspended accounts get `FORBIDDEN_ROLE` on every authenticated route.

6. **Money model:**
   - Money is integer test credits in an append-only ledger. Balances are derived from the ledger.
   - Builders top up with explicitly labeled local test credits, capped per call.
   - Publishing a study reserves `reward × slots`.
   - A slot's credits are committed while a participation is consented, in progress, submitted or disputed.
   - Approval credits the tester exactly once. A dispute overturned after rejection credits once via `dispute_credit`.
   - Withdrawal and closing release the credits.
   - Nothing is ever labeled "paid".

7. **Mobile:**
   - Expo SDK 57 and Expo Router.
   - Themes are system (the default), light and dark, all from tokens. Icons are Lucide only.
   - **Capability matrix:**
     - Screen recording works on Android 10+ dev builds, through the local `modules/screen-capture` Kotlin module.
     - On every other platform the UI says "unavailable on this device".
     - All platforms can attach existing screenshots or clips through the document picker. The tester previews them and can remove them before upload.

8. **Wallet (devnet only), using Sign-In With Solana:**
   - The server issues the full SIWS input and stores it: domain, address, statement, uri, version `1`, `chainId: solana:devnet`, nonce, issuedAt and expirationTime. The nonce is single-use, expires in 300 seconds, and is bound to one user and one address.
   - The app prefers MWA `signIn`, because the wallet then shows the domain to the user. `signMessages` over the same `buildSiwsMessage` text is the fallback.
   - The server verifies by rebuilding the message from its stored record and requiring byte equality with the signed bytes. It then checks the ed25519 signature using `@noble/curves`, and consumes the nonce atomically.
   - An address can be linked to only one account at a time.
   - The server refuses chain features unless the RPC genesis hash is devnet's.

9. **Devnet demo transfer (not a reward payout):**
   - A builder may send `DEVNET_DEMO_LAMPORTS` to the linked wallet of an approved tester.
   - When the server creates the transfer intent, it fixes the sender (the builder's linked wallet), the recipient (the tester's linked wallet) and the amount. Expected values never come from the request.
   - The client submits only the signature it claims to have sent.
   - The server marks the transfer `confirmed` only after it fetches the transaction from devnet and verifies four things: the genesis hash, that the transaction succeeded, a system transfer of exactly that sender, recipient and amount, and a block time after the intent was created.
   - A signature can be used only once across all transfers.
   - The UI labels the whole feature "Devnet demo · no real value".

10. **AI:** no provider in the MVP. `GET /ai/status` returns `{available:false}`. The UI shows "Analysis unavailable" and never invents findings.

11. **Participation states:** `eligible` is computed, never stored. Stored states start at `consented`. A tester can withdraw before submitting (`withdrawn`), which frees the slot and its committed credits.

12. **Limits:**
    - 20 evidence items per participation.
    - 500 MB in total per participation.
    - 100 MB per item.
    - Duplicate `clientSegmentId` uploads are rejected.

## Additions beyond plan §5.2 (recorded per review finding 14)

- **Routes:**
  - `health`, `putDevice`, `credits`, `topUp`
  - `getTesterStudy` (a tester-safe study view)
  - `resumeStudy`, `studyParticipations`, `myParticipations`, `withdrawParticipation`, `putTaskNote`
  - `listEvidence`, `listFindings`
  - `myDisputes`, `adminDisputes`, `adminStudies`, `moderateUser`, `adminAudit`
  - `submitTransferSignature`
- **Error codes:** `PAYLOAD_TOO_LARGE`, `RATE_LIMITED`, `INTERNAL`.

## Consequences

- No physical Android device is attached. Native recording, MWA and Seeker-specific behavior can be exercised only on the emulator, or not at all. Those gates are reported as blocked, never as passed.
- Accepted risk (P3): there is no automated release-age guard. The MWA version rule (never a canary, never a release under 7 days old without a recorded reason) is in `dependency-versions.md`, in the "Candidates only" table.
