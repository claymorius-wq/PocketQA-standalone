> **⚠ NONCANONICAL / INCOMPLETE DRAFT — DO NOT EXECUTE FROM THIS FILE.**
> This ~419 KB draft was cut off when a planning run exceeded its turn budget. It is kept for reference only.
> Authoritative plan: `docs/plans/pocket-qa-execution-plan.md`. Team launch: `docs/plans/herdr-team-handoff.md`.
> The version numbers, APIs, and code templates below were **not verified** and must not be treated as certified (see execution plan §3).
> Its cross-references to handoff section letters (§A, §C) point to an earlier outline and may not match the current handoff.

# Pocket QA Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. In this project every agent, subagent, and teammate runs `claude-opus-5-5` only — see `docs/plans/herdr-team-handoff.md` §C before starting any work.

**Goal:** Build a local-first Pocket QA MVP. Builders fund (with test credits) and publish real-device mobile usability studies. Adult testers discover the studies they are eligible for, give explicit consent, and record task sessions on Android with per-session OS consent. Testers preview and remove segments before upload. Builders review the evidence, record findings, and approve or reject with a reason. Reviewer-approved compensation is tracked in a test ledger. An optional demo payment uses Solana devnet and is confirmed only after on-chain verification.

**Architecture:** pnpm monorepo. An Expo SDK 57 / React Native 0.86 app runs as an Android dev build (Seeker first); iOS uses the same app with capability gating, and the web preview uses Expo web. A Fastify + SQLite API binds to `127.0.0.1` only. Shared Zod contracts and a pure domain package hold every business invariant. A local Kotlin Expo module performs MediaProjection capture. Wallet support uses Solana Mobile's Wallet UI (`@wallet-ui/react-native-kit`) over MWA, devnet only.

**Tech Stack:**
- TypeScript (strict), Zod v4, Vitest.
- Fastify, better-sqlite3 + Drizzle ORM, `@node-rs/argon2`, `@solana/kit`, `@solana/wallet-standard-util`.
- Expo Router, expo-dev-client, expo-secure-store, expo-video, `lucide-react-native` + `react-native-svg`, TanStack Query.
- jest-expo + React Native Testing Library, Playwright (web preview), Maestro (Android).
- Kotlin (Expo Modules API, MediaProjection, MediaRecorder).

**Spec:** Part A of this file (§A0–§A16) is the design spec. Part B (§B) is the task plan, and executors read both. Companion: `docs/plans/herdr-team-handoff.md` (team launch, worktrees, model pinning, review protocol).

**Document status — 2026-10-02:** PLAN ONLY.
- No application code, scaffolding, dependency installs, builds, or tests exist or were run.
- No commits, branches, or worktrees were created, and nothing was written remotely.
- No Herdr command was executed; the team is **not** launched (see handoff §A).
- Every command in this document is an instruction for the future, not a record of something that ran.

**Authorship and model disclosure:**
- Author: Claude Code, session model `claude-opus-5-5`. No subagents were spawned.
- Official web pages were retrieved with Claude Code's WebFetch tool. Its tool description says it "answers `prompt` against [the page] using a small fast model". Prompts asked for verbatim quotes only, and the quoted facts are listed in §A2.3.
- The harness also had a reviewer "advisor" tool configured. It was consulted for review only and authored no content.
- Every decision and every line in this file comes from the `claude-opus-5-5` session.

---

## Global Constraints

Every task implicitly includes these. Values are copied from `CLAUDE.md` or from the official sources in §A2.3.

- Builder agents: Claude Code with exact model `claude-opus-5-5`. Never Codex, Elves provider shortcuts (`/omp`, `/fugu`, `/manus`, `/grok`, `/devin`), `--fallback-model`, or `--advisor` without Hamza's written approval (`CLAUDE.md:3`, handoff §C).
- Node.js `>=22.13` (Expo SDK 57 minimum, S16); pnpm workspaces; TypeScript `strict: true`, `noUncheckedIndexedAccess: true`.
- Expo SDK 57.0.0 / React Native 0.86 / React 19.2.3 (S16); custom dev build via `expo-dev-client` — Expo Go is unsupported because "MWA uses Kotlin native modules" (S2).
- Android compileSdk/targetSdk 36 (S16); in-app screen recording requires Android 10+ (API 29); app screen sharing exists on Android 14+ (S13).
- Solana: devnet only — chain id `solana:devnet`, RPC `https://api.devnet.solana.com` (S19); the API refuses to serve chain features unless the genesis-hash guard passes (§A10.5). No mainnet code path, no SKR, no SGT checks in this pass.
- No real money: budgets and rewards are integer **test credits** with no cash value; devnet SOL is labeled "Devnet · no real value"; no escrow, custody, or smart contracts (`CLAUDE.md:7`).
- Local-first: API binds `127.0.0.1:8787`; devices reach it via `adb reverse tcp:8787 tcp:8787`; no tunnels, cloudflared, deployments, public previews, or store submissions (`CLAUDE.md:11`).
- Secrets live only in gitignored `.env.local` files; `pnpm check:secrets` must pass before every commit; logs never contain authorization headers, session or playback tokens, passwords, raw emails, or media bytes (`CLAUDE.md:13`).
- Copy never promises earnings: use "Reward if approved" + "Not guaranteed"; banned phrases are enforced by `findBannedCopy` (T1.9) for app copy and builder-entered study text (`CLAUDE.md:3`).
- Icons: `lucide-react-native` only (peer `react-native-svg` 12–15, S24); no emoji or letter-chip icons.
- Themes: `system` (default) / `light` / `dark`; text pairs ≥ 4.5:1, non-text UI pairs ≥ 3:1, enforced by `apps/mobile/src/theme/contrast.test.ts` (T3.2).
- Touch targets ≥ 48 dp; every interactive element has a stable `testID` (internal mvp-testing-gate selector contract, IR3).
- Comments document decisions and complex invariants only — not trivial lines (`CLAUDE.md:9`).
- Commits: conventional prefix (`feat:`, `fix:`, `test:`, `docs:`, `chore:`), body ends with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`; commits go to role branches only; `main` changes only through Hamza-approved freeze-candidate merges (§A16, `CLAUDE.md:9`).
- Zod v4 API (`z.email()`, `z.uuid()`, `z.iso.datetime()`); T1.1 Step 0 confirms the installed major version.

## Review Focus

These five input classes and failure modes are implied by the spec but not covered by any single happy-path test. They are the most likely to hurt a real person, most likely first. Each is pinned to tests in the owning task.

1. **A tester removes a segment that captured a private notification, then uploads.** Expected: the removed segment never leaves the device, and the server refuses new evidence after submission. Pinned by T4.5 `never uploads removed segments` and T2.8 `rejects evidence creation after submit`.
2. **A captured Sign-In-With-Solana result is replayed, or a nonce issued to account A is used by account B.** Expected: `NONCE_INVALID` on the second use and on any cross-account use; no wallet gets linked. Pinned by T2.14 `rejects replayed nonce` and `rejects nonce issued to another user`.
3. **Someone guesses another participant's evidence ID, or replays an expired or foreign playback URL.** Expected: `404` for non-owners (no existence leak) and `401` for expired or forged tokens. Pinned by T2.9 `tester B cannot mint playback token for tester A evidence` and `expired playback token is refused`.
4. **A client reports a devnet signature whose transfer goes to a different recipient or amount, or that never lands because its blockhash expired.** Expected: `failed` or `expired`, never `confirmed`, and nothing in the UI says "paid". Pinned by T1.13 `fails on recipient mismatch`, `expires after last valid block height`, and T2.15 `client-claimed signature is verified server-side`.
5. **The app runs where a capability is missing or revoked.** Cases: iOS, web, Android < 10, no MWA wallet installed, microphone denied, or Android 15 status-bar stop or screen lock mid-recording. Expected: an explicit unavailable or stopped state, no crash, no silent capture. Pinned by T3.5 `capability matrix`, T4.3 `system stop shows stopped state and keeps finished segments`, and T5.2 `system stop finalizes current segment`.

---

# Part A — Design Spec

## A0. Cobbler decision summary

**Recommendation.** Build in this order:
1. A throwaway capture-feasibility spike on a real Android 14+ phone (Gate S0).
2. The pure domain, contracts, and API invariants: authorization, consent, ledger, chain verification.
3. The web-preview builder review loop and the tester flow (Gate A).
4. The Android MediaProjection recorder (Gate B1).
5. Devnet wallet linking and the verified devnet demo transfer (Gate B2).
6. Independent security and product QA with native and browser evidence (Gate B final).

Deferred by decision, each needing separate approval: WalletConnect/Reown, real payouts, SGT verification, iOS cross-app capture, AI provider adapters, deployment, and store submission.

**Why this fits.**
- The research makes capture feasibility a prelaunch gate ("Single-app sharing may omit wallet switches, and secure screens may block capture. Test the intended flow on a real Seeker before promising wallet-screen issue reels" — `app-research-codex.md:462`).
- The core value is evidence a builder can act on (`:458`).
- MWA support on Android is now verified from official docs (S2–S7).
- `CLAUDE.md` requires wallet support to be optional, devnet-only, and noncustodial.
- Putting all invariants in pure packages makes the security properties testable without devices.

**Strongest dissent (preserved).** The research's own first test is commercial, not technical: "Sell three prepaid batches to unrelated teams before building the marketplace" (`app-research-codex.md:150`, `:654`). A concierge run would answer the fatal risk (repeat buyer demand) faster than an app: OS screen recorder, shared folder, and spreadsheet. Two mitigations follow:
- This plan keeps out all marketplace automation (matching, bidding, reputation; `:462`).
- It orders the builder review loop early, so the local build can serve as the concierge tool.

Second dissent: a pure Kotlin app would make MediaProjection simpler but lose the web preview and iOS reuse. Expo stays, with the recorder isolated in a local Kotlin module. Gate S0 can force a fallback.

**Risks.**
1. Wallet approval screens may be black (FLAG_SECURE) or excluded by single-app capture. S0 decides what builders may be promised.
2. No physical Android 14+ / Seeker device may be available (open question Q1).
3. The Seed Vault Wallet's devnet support and MWA behavior with a non-resolvable identity URI are unverified (V14).
4. The public devnet RPC is rate-limited ("100 requests per 10 seconds per IP"; "not intended for production applications", S19).
5. Expo SDK 57 compatibility with Wallet UI and the pnpm linker (V5) is unverified.
6. A model fallback in the team: Opus 5.5 re-runs cybersecurity-flagged requests on Opus 4.8 unless disabled (S21). Mitigated in handoff §C.
7. Scope creep in a 50-task plan; review cost.

**Next move.** Hamza:
1. Reviews both documents and answers Q1–Q12 (§A1).
2. Approves the base commit (handoff §B.2).
3. Starts Claude inside a Herdr-managed pane with the pinned settings (handoff §C–§D).

**Confidence.**
- Architecture: medium-high.
- Wallet and devnet facts: high (official docs, retrieved 2026-10-02).
- Capturing wallet screens: low until S0.
- Herdr CLI specifics: low, because they were not executable here. The lead must read `herdr --help` inside Herdr.

## A1. Understanding, assumptions, open questions

**What Hamza said** (`CLAUDE.md`, prompt). The product is buyer-funded real-device usability testing with consented evidence, actionable findings, and reviewer-approved compensation. It must not involve token farming, guaranteed earnings, fake AI, or fake payment completion. Other requirements:
- Local-first build, Expo preferred subject to review, Android/Seeker first with web preview and iOS degrading gracefully.
- Light, dark, and system themes with Lucide icons.
- Strict owner/role authorization; per-session OS consent for recording, with preview/remove before upload.
- AI is optional and shown as unavailable when absent.
- Devnet-only, noncustodial wallet with signed-nonce authentication. WalletConnect only if official Solana support is verified.
- No invented Seeker APIs; worktree-separated roles with freeze-candidate reviews; Herdr only from a real Herdr context.
- No secrets, deployments, or remote writes.

**Assumptions** (each is overridable by Hamza):
- AS1: One builder account equals one organization; there are no teams.
- AS2: The builder is the reviewer who approves or rejects; an admin resolves disputes.
- AS3: Testers self-attest they are 18 or older at sign-up (the research targets "matched adult device owners", `:134`).
- AS4: Builders distribute their app under test through their own link (store, Play internal testing, or APK URL). Pocket QA hosts no builds.
- AS5: The first pass is English only, with every string in one catalog so it can be localized later.
- AS6: Budgets are integer test credits.
- AS7: One active wallet link per user.
- AS8: Sessions last 5–15 minutes with at most 10 tasks (`:134`).

**Open questions for Hamza:**
- **Q1** — Is a physical Android 14+ phone available for S0, T5.4, and T7.4, ideally a Seeker? Which devnet-capable MWA wallet is on it? Emulators cannot answer S0.
- **Q2** — The app identifier defaults to `ai.optijara.pocketqa`, following the internal pipeline's `ai.optijara.<slug>` pattern (IR1). Confirm or replace it.
- **Q3** — English only for now? The internal pipeline mandates en/ar/es/fr/pt with RTL for Optijara apps (IR1); Pocket QA's `CLAUDE.md` does not.
- **Q4** — Is the builder-as-reviewer model (AS2) acceptable, or is a platform QA reviewer role needed (research: "human quality review", `:478`)?
- **Q5** — Should the devnet demo transfer be in the first pass, and is 1,000,000 lamports (0.001 devnet SOL) acceptable?
- **Q6** — WalletConnect/Reown stays deferred. It needs a Reown Dashboard project ID, which is an external account (S11). Approve later or never?
- **Q7** — The AI provider defaults to `none`. Which provider and model, and is paid API use approved (`CLAUDE.md:7`, "paid services without separate approval")?
- **Q8** — Retention defaults: 30 days after decision for evidence media, a 7-day dispute window, and a 48-hour claim expiry. OK?
- **Q9** — Herdr topology: linked worktree workspaces (`herdr worktree`), one tab per role, or splits in one tab (handoff §D)?
- **Q10** — Pinning `ANTHROPIC_DEFAULT_HAIKU_MODEL=claude-opus-5-5` also routes background calls to Opus 5.5, which costs more. Approve?
- **Q11** — Approve the docs-only base commit on `main` (handoff §B.2)? `git worktree add` needs a commit to branch from.
- **Q12** — "Seeker" device criteria stay self-reported and labeled unverified. SGT verification is deferred because the SGT lives on mainnet (S9, `:78`). OK?

## A2. Source traceability

### A2.1 Requirements matrix

Sources: `CLAUDE.md:<line>`; research `app-research-codex.md:<line>` (R-prefixed RR); internal refs IR1–IR7 (§A2.2); official sources S1–S24 (§A2.3).

| ID | Requirement | Source | Spec section | Tasks / tests |
|---|---|---|---|---|
| R1 | Buyer-funded studies | CLAUDE.md:3 | A5, A7 | T1.5, T2.5, T6.1, T6.2 |
| R2 | Consented evidence | CLAUDE.md:3 | A9, A12 | T1.7, T2.7, T4.2 |
| R3 | Actionable findings | CLAUDE.md:3 | A7 | T2.10, T6.3, T6.4 |
| R4 | Reviewer-approved compensation, no auto-pay | CLAUDE.md:3 | A6 | T1.3, T2.10, T6.3 |
| R5 | No token farming | CLAUDE.md:3 | A3, A13 | T1.9, T2.6 (one claim per study), T3.3 |
| R6 | No guaranteed earnings | CLAUDE.md:3 | A14.5 | T1.9, T2.5, T3.3 |
| R7 | No fake AI reports | CLAUDE.md:3 | A11 | T2.13, T6.3 |
| R8 | No fake payment completion | CLAUDE.md:3 | A10.4 | T1.13, T2.15, T7.3 |
| R9 | Local-first | CLAUDE.md:5 | A4 | T0.1, T2.1 |
| R10 | Light/dark/system themes | CLAUDE.md:5 | A14.1 | T3.2, T8.1 |
| R11 | Lucide icons | CLAUDE.md:5 | A14.2 | T3.3 |
| R12 | Wallet optional | CLAUDE.md:5 | A10 | T3.5, T7.1 |
| R13 | Expo/RN subject to architecture review | CLAUDE.md:5 | A4 ADR-01, S0 | S0, T3.1 |
| R14 | Android Seeker first | CLAUDE.md:5 | A4.2 | T4.3, T5.1–T5.4 |
| R15 | Web preview | CLAUDE.md:5 | A4.2 | T3.1, T8.1 |
| R16 | iOS graceful capability distinctions | CLAUDE.md:5 | A4.2 | T3.5, T4.3, T7.1 |
| R17 | Testers discover eligible studies | CLAUDE.md:5 | A7 | T1.6, T2.6, T4.1 |
| R18 | Tester consent | CLAUDE.md:5 | A9, A12 | T1.7, T2.7, T4.2 |
| R19 | Perform tasks | CLAUDE.md:5 | A9 | T4.3, T5.3 |
| R20 | Submit recordings/evidence | CLAUDE.md:5 | A9 | T2.8, T4.4, T4.5 |
| R21 | Review status/rewards | CLAUDE.md:5 | A14.4 | T4.6 |
| R22 | Builders create studies/tasks/device criteria | CLAUDE.md:5 | A7 | T2.5, T6.1 |
| R23 | Review evidence/findings | CLAUDE.md:5 | A7 | T2.9, T2.10, T6.3 |
| R24 | Approve/reject with reason | CLAUDE.md:5 | A6 | T1.3, T2.10, T6.3 |
| R25 | Track budgets | CLAUDE.md:5 | A5 | T1.5, T2.5, T6.2 |
| R26 | Admin disputes | CLAUDE.md:5 | A6 | T2.11, T6.5 |
| R27 | Admin moderation | CLAUDE.md:5 | A7 | T2.11, T6.5 |
| R28 | Export/deletion | CLAUDE.md:5 | A12 | T2.12, T6.5, T6.6 |
| R29 | Explicit per-session OS consent for recording | CLAUDE.md:5 | A9 | S0, T5.3 |
| R30 | Preview/remove before upload | CLAUDE.md:5 | A9 | T4.4, T4.5 |
| R31 | No covert capture | CLAUDE.md:5 | A9, A13 | T5.3, T8.3 |
| R32 | No private key collection | CLAUDE.md:5 | A10, A13 | T1.9, T7.2, T8.3 |
| R33 | Sessions/media strictly owner/role authorized | CLAUDE.md:5 | A8 | T2.4, T2.9, T2.16 |
| R34 | AI provider optional, configurable | CLAUDE.md:5 | A11 | T2.13 |
| R35 | Missing provider clearly unavailable | CLAUDE.md:5 | A11 | T2.13, T6.3 |
| R36 | Web3 first pass devnet only | CLAUDE.md:7 | A10.5 | T1.13, T2.15 |
| R37 | Noncustodial connect/disconnect | CLAUDE.md:7 | A10.1–A10.3 | T7.1, T7.2 |
| R38 | Signed nonce with domain/network/expiry | CLAUDE.md:7 | A10.1 | T1.11, T1.12, T2.14 |
| R39 | Replay prevention | CLAUDE.md:7 | A10.1 | T2.14 |
| R40 | Android MWA verified support | CLAUDE.md:7 | A2.3 (S2–S7) | T7.1, T7.4 |
| R41 | WalletConnect only if official Solana native support verified; do not conflate with MWA | CLAUDE.md:7 | A10.6 | Decision record only (deferred); T8.5 readiness label |
| R42 | Connection is not payment | CLAUDE.md:7 | A10, A14.5 | T3.3, T7.2 |
| R43 | No mainnet escrow/real payouts/custody/paid services | CLAUDE.md:7 | A3 | T1.13, T2.13, T2.15 |
| R44 | Pending/confirmed/failed tx state with chain verification | CLAUDE.md:7 | A10.4 | T1.13, T2.15, T7.3 |
| R45 | No invented Seeker API/attestation | CLAUDE.md:7 | A4.2, A10.7 | T1.6, T3.5 |
| R46 | GitHub: reshareai only, scoped GH_TOKEN verified before each remote write | CLAUDE.md:9 | handoff §G | none in this phase (no remote writes) |
| R47 | Private remote only when authorized | CLAUDE.md:9 | handoff §G | none in this phase |
| R48 | Decisions/invariants documented in comments | CLAUDE.md:9 | Global Constraints | all code tasks |
| R49 | Worktree-separated roles, review checkpoints | CLAUDE.md:9 | A16 | handoff §D–§F |
| R50 | Freeze candidates await all reviewer verdicts; fix P0/P1/P2 first | CLAUDE.md:9 | A16 | handoff §F |
| R51 | Proper commits/merges, no direct unreviewed main changes | CLAUDE.md:9 | A16 | handoff §F |
| R52 | Herdr only from real context; no faking; no claim before proof | CLAUDE.md:11 | — | handoff §A, §E |
| R53 | No other project/service changes; no cloudflared/deploy/store | CLAUDE.md:11 | A3 | Global Constraints |
| R54 | Traceability, all UX states, architecture/API, threat model, TDD tasks, independent QA, native/browser evidence | CLAUDE.md:13 | A2, A14, A4/A7, A13, Part B, A15 | T8.1–T8.5 |
| R55 | No secrets in repo/logs | CLAUDE.md:13 | A12.4 | T0.1, T2.1 |
| R56 | Builder model exactly `claude-opus-5-5` | CLAUDE.md:3 | — | handoff §C |
| RR1 | 5–15 minute sessions; developer supplies test build and task | codex:134, :138 | A9 | T1.4 (≤10 tasks), T6.1 |
| RR2 | Capture → structured draft → correction → explicit action → outcome; code owns totals/payment/permissions | codex:63 | A11 | T2.13, T6.3 |
| RR3 | No assumption of on-device generative inference on Seeker | codex:65 | A11 | T2.13 |
| RR4 | No wallet for first insight; transaction preview shows recipient, network, asset, amount, fee, purpose, expiry; per-transfer approval; private recordings stay off-chain | codex:69 | A10.4 | T7.3 |
| RR5 | Ecosystem constraints (Seed Vault approval per signature, MWA Android, Seeker Connect RN planned, SGT is eligibility not uniqueness, iOS signing differs) | codex:75–86 | A10.7 | T7.1 |
| RR6 | Tester connects only if needed; explicit screen/audio permission; review before upload; human redaction; AI proposes, human verifies; no fake reviews | codex:460 | A9, A11 | T4.2–T4.5, T6.3 |
| RR7 | MVP scope; never build social feed/token/open bidding/autonomous testers/public reputation/custody; capture feasibility gate; never bypass FLAG_SECURE | codex:462 | A3, S0 | S0, T8.3 |
| RR8 | Objective acceptance rules + appeal path; pay good-faith participants for platform failures | codex:478 | A6 (dispute overturn) | T2.11 |
| RR9 | Fatal risk is repeat buyer demand | codex:148, :654 | A0 dissent | — |

### A2.2 Internal mobile workflow references (read-only)

These were read in this session. They are cited by path only, because two of them contain credentials that must never be copied.

| Ref | Path | Adopted | Rejected / adapted (CLAUDE.md wins) |
|---|---|---|---|
| IR1 | `~/.hermes/skills/devops/optijara-mobile-app-pipeline/SKILL.md` | Human gates (A = browser-verified MVP with real integrations, B = native self-tested); "never claim distribution success"; TL;DR status format | "Use Codex for coding" (conflicts with `CLAUDE.md:3`); Next.js + Capacitor stack (CLAUDE.md prefers Expo); public Fleet/Cloudflare preview before Gate A (conflicts with `CLAUDE.md:11`); Gate C (store) is out of scope; 5 locales + RTL becomes open question Q3 |
| IR2 | `~/.hermes/skills/devops/optijara-mobile-app-pipeline/references/mobile-app-production-readiness.md` | Readiness labels: Live/working, Wired but needs config, UI placeholder only, Missing (T8.5) | — |
| IR3 | `~/.hermes/skills/openclaw-imports/mvp-testing-gate/SKILL.md` | `testID` selector contract; smoke/critical suites; server-only test-hook flag with a test proving it is absent in production mode; page-error listeners; light+dark visual QA; per-run artifact isolation (`RUN_ID`); GO/NO-GO reporting | Public-domain gate (no public URL in this project) |
| IR4 | `~/.hermes/skills/openclaw-imports/mvp-testing-gate/references/dark-mode-contrast-token-remediation.md` | Paired semantic tokens (`primary`/`onPrimary`), no hardcoded white/gray, screenshot verification in dark mode | — |
| IR5 | `~/.hermes/skills/openclaw-imports/mvp-testing-gate/references/browser-media-recorder-e2e.md` | A synthetic blob proves wiring, not valid media; never weaken upload validators; use a real media fixture; release capture resources on stop, failure, and unmount | — |
| IR6 | `~/.hermes/skills/software-development/systematic-debugging/references/mobile-i18n-theme-toggle-debugging.md` | A theme toggle must change visible root state; verification matrix | Tailwind/DOM specifics (not used in RN) |
| IR7 | `~/.hermes/skills/devops/mobile-pipeline-autorun/SKILL.md` | Never fabricate gate approvals; evidence reflects only what ran; report a blocker once; stall detection | Telegram/Studio automation (not requested) |

### A2.3 Official sources (retrieved 2026-10-02 via WebFetch with verbatim-quote prompts)

| ID | Source | Facts used |
|---|---|---|
| S1 | https://docs.solanamobile.com/llms.txt | Index of current MWA, React Native, Seeker, and iOS pages |
| S2 | https://docs.solanamobile.com/get-started/react-native/installation.md | `@wallet-ui/react-native-kit` ("use this for new apps. Built on `@solana/kit`") vs `@wallet-ui/react-native-web3js` (web3.js v1); dependencies `@solana/kit`, `@solana-program/memo`, `react-native-quick-crypto`, `react-native-nitro-modules`, `expo-dev-client`; "The polyfill must be imported before any other code that uses a Solana client library"; `polyfill.js`: `import { install } from "react-native-quick-crypto"; install();`; `index.js`: `import "./polyfill"; import "expo-router/entry";` with `"main": "./index.js"`; "MWA uses Kotlin native modules, so you must use a custom Expo development build instead of Expo Go" |
| S3 | https://docs.solanamobile.com/get-started/react-native/setup.md | `createSolanaDevnet({ url: "https://api.devnet.solana.com" })`; `<MobileWalletProvider cluster={cluster} identity={identity}>`; identity `icon: "favicon.png"` (relative to `uri`); `MobileWalletProvider` props (kit): `cluster` ("Build one with a createSolana* helper"), `identity` {`name`,`uri`,`icon`}, `cache` ("Defaults to AsyncStorage"), `createClient`; `useMobileWallet` returns `account, accounts, chain, connect, disconnect, identity, signIn, signMessages` plus `client, sendTransactions` (kit) |
| S4 | https://docs.solanamobile.com/get-started/react-native/quickstart.md | "`signMessages` takes bytes, not a string. Use `TextEncoder`"; "`signIn` works whether or not the user is already connected. Omit `address` to let the wallet pick the account"; kit `sendTransactions` handles compilation |
| S5 | https://docs.solanamobile.com/get-started/react-native/mobile-wallet-adapter.md | `transact()`; `authorize({chain, identity, auth_token, sign_in_payload, features, addresses})` returns `auth_token, accounts, wallet_uri_base, sign_in_result{address, signed_message, signature, signature_type}`; `deauthorize` "will make the provided `auth_token` invalid" |
| S6 | https://docs.solanamobile.com/get-started/react-native/invoke-mwa-sessions-directly.md | `authorize({ chain: "solana:devnet", identity })`; `sign_in_payload`; reuse of a stored `auth_token`; `deauthorize({ auth_token })` |
| S7 | https://docs.solanamobile.com/recipes/mobile-wallet-adapter/caching-wallet-authorization.md | `Cache<T>{clear,get,set}`; "`AsyncStorage` is unencrypted. The default cache holds the `auth_token` and account details in plain text"; use `expo-secure-store` |
| S8 | https://docs.solanamobile.com/recipes/mobile-wallet-adapter/wallet-signing-on-ios.md | "An MWA implementation built on local — or even remote — web sockets is therefore not possible on iOS"; alternatives: wallet-as-a-service, passkeys ("do not support ed25519 signing"), Safari Web Extension (for wallets) |
| S9 | https://docs.solanamobile.com/recipes/general/detecting-seeker-users.md | `Platform.constants.Model === "Seeker"` "can be spoofed and should not be used for use cases where you need a guaranteed Seeker user"; "The nonce must be single-use and short-lived"; server must check that the nonce was issued, is unexpired and unused, and must "load the payload you stored for it rather than trusting a client-supplied copy"; signature valid; `domain` is yours; SGT "transferrable … verify uniqueness by checking the SGT's unique mint address" |
| S10 | https://docs.solanamobile.com/solana-mobile-stack/seeker-connect.md | Web: Available; React Native: Planned; Android (Kotlin): Planned; "built on top of the official Mobile Wallet Adapter libraries" |
| S11 | https://docs.reown.com/appkit/react-native/core/installation | `@reown/appkit-solana-react-native`, `SolanaAdapter`, `PhantomConnector`/`SolflareConnector` (example `cluster: 'mainnet-beta'`); projectId "Obtain from https://dashboard.reown.com/" |
| S12 | https://docs.reown.com/appkit/networks/supported-chains | "AppKit supports Solana on web frameworks, React Native, and Unity" |
| S13 | https://developer.android.com/media/grow/media-projection | Android 14: "request user consent before each media projection session"; a token is used once; `createVirtualDisplay()` once per instance, otherwise `SecurityException`; manifest `FOREGROUND_SERVICE_MEDIA_PROJECTION` + `foregroundServiceType="mediaProjection"`; app screen sharing (Android 14) "excludes the status bar, navigation bar, notifications"; opt-out via `createConfigForDefaultDisplay()`; `onStop()` callback is required (otherwise `IllegalStateException`); Android 15 QPR1 status-bar chip; projection "automatically stops when the device screen is locked" |
| S14 | https://developer.android.com/develop/background-work/services/fg-service-types | mediaProjection: call `createScreenCaptureIntent()` before starting the FGS, then `getMediaProjection()`; microphone: `FOREGROUND_SERVICE_MICROPHONE` + `RECORD_AUDIO`, "cannot create a `microphone` foreground service while your app is in the background" |
| S15 | https://developer.android.com/about/versions/15/features | Apps can detect "that they are being recorded" (`addScreenRecordingCallback`) |
| S16 | https://docs.expo.dev/versions/latest/ | SDK 57.0.0 · RN 0.86 · React 19.2.3 · Android 7+, compile/target 36 · iOS 16.4+ · Xcode 26.4+ · Node 22.13.x minimum |
| S17 | https://docs.expo.dev/versions/latest/sdk/video/ | `VideoSource.headers` "Supported platforms: Android, iOS" (not web) |
| S18 | https://docs.expo.dev/versions/latest/sdk/securestore/ | Web not supported; "some iOS releases refused values above roughly 2048 bytes"; Android Keystore; exclude from Android Auto Backup |
| S19 | https://solana.com/docs/references/clusters | `https://api.devnet.solana.com`; 100 req/10 s/IP, 40 req/10 s/IP per RPC, 40 concurrent, 100 MB/30 s; "not intended for production applications"; devnet faucet |
| S20 | https://github.com/phantom/sign-in-with-solana | SIWS input fields and ABNF; chainId values include `solana:devnet`; `verifySignIn` in `@solana/wallet-standard-util`; nonce "minimum of 8 characters"; expiration checks |
| S21 | https://code.claude.com/docs/en/model-config | `--model`; `ANTHROPIC_DEFAULT_HAIKU_MODEL` also covers "background functionality"; `CLAUDE_CODE_SUBAGENT_MODEL`; no fallback chain by default; automatic content fallback (Opus 5.5 → Opus 4.8 for cybersecurity flags) unless `switchModelsOnFlag: false` |
| S22 | https://code.claude.com/docs/en/sub-agents | `CLAUDE_CODE_SUBAGENT_MODEL_FORCE=1` (v2.1.257+); `/tasks` shows each subagent's model |
| S23 | https://code.claude.com/docs/en/cli-reference | `--model`, `--settings`, `--append-system-prompt-file`, `--name`, `--permission-mode`, `--advisor`, `--fallback-model` |
| S24 | https://lucide.dev/guide/react-native/getting-started | `lucide-react-native`; peer `react-native-svg` 12–15; props `size`, `color`, `strokeWidth` |

Cited from the research but not re-fetched in this session: FLAG_SECURE reference (`app-research-codex.md:462`, "checked 2026-10-02"), SGT documentation (`:78`), Seed Vault (`:75`), dApp Store submission (`:82`).

### A2.4 Task-verified values (not asserted as fact by this plan)

Each value below is resolved by the named task step. That step records the observed value in the task's commit message body, and its test pins the value.

| ID | Value in question | Resolved by |
|---|---|---|
| V1 | `DEVNET_GENESIS_HASH = "EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG"` (from model knowledge, **not** verified this session) | T1.13 Step 0: `getGenesisHash` against `https://api.devnet.solana.com` |
| V2 | Exact `signIn` input/output and `sendTransactions` types in `@wallet-ui/react-native-kit`. Documented usage (S4 quickstart): `signIn({address, chainId, domain, statement, uri})` → `result.account.address`; `sendTransactions(instructions: Instruction[])` → `signature`. Unverified: whether `signIn` passes `nonce`/`issuedAt`/`expirationTime`/`version` through, and the exact `signedMessage`/`signature` field names | T7.1 Step 0: read installed `.d.ts` |
| V3 | `@solana/wallet-standard-util` export names `verifySignIn`, `createSignInMessage`, `parseSignInMessage` | T1.12 Step 0 |
| V4 | JDK version accepted by the RN 0.86 Gradle build (Homebrew `openjdk` may be too new) | T0.2 preflight + T3.1 Step 6 |
| V5 | Whether pnpm `node-linker=hoisted` is needed with SDK 57 | T3.1 Step 5 (`npx expo-doctor`) |
| V6 | An MWA test wallet for the emulator (Solana Mobile "fakewallet" reference app) | T7.4 Step 0 |
| V7 | Android system consent-dialog labels used by Maestro selectors | S0, T5.4 on the target device |
| V8 | `create-expo-app` template flags for SDK 57 | T3.1 Step 0 (`--help`) |
| V9 | Large-file upload API in SDK 57 (`expo-file-system/legacy` `uploadAsync`) | T4.5 Step 0 |
| V10 | Reown connector devnet `cluster` value | Deferred with WalletConnect (A10.6) |
| V11 | Herdr CLI syntax for agent kind name, `tab`, `worktree` | Lead inside Herdr (handoff §D.1) |
| V12 | Full Xcode ≥ 26.4 present (only an `xcodebuild` shim was located) | T0.2 preflight; otherwise iOS builds are "not performed" |
| V13 | Cleartext HTTP to `127.0.0.1` allowed in the Android debug build | T3.1 Step 6, T5.4 |
| V14 | Wallet behavior with `identity.uri = "https://pocketqa.invalid"` | T7.4 |
| V15 | Whether `disconnect()` from `useMobileWallet` deauthorizes and clears the cache | T7.1 Step 0 (read source) |
| V16 | Expo Modules Kotlin `OnActivityResult` API in SDK 57 | T5.1 Step 0 |

## A3. Scope, non-goals, readiness labels

**In scope (first pass, local only).**
- Auth (email + password) with roles tester/builder/admin.
- Device profile; builder study lifecycle with tasks, device criteria, versioned consent, test-credit funding, and a budget ledger.
- Eligibility-filtered discovery; one claim per tester per study with budget reservation.
- Consent; Android per-task screen segments with optional mic narration.
- Preview and removal on device; streaming upload with validation; authorized playback.
- Findings; approve or reject with a reason; compensation in test credits.
- Disputes, moderation, audit log, export/deletion requests, retention jobs.
- AI suggestions endpoint that is honestly unavailable by default.
- Devnet wallet link via SIWS; devnet demo transfer verified on-chain.
- Light/dark/system themes; web preview for every non-native flow.

**Non-goals (each needs separate approval):**
- Real money, fiat rails, or stablecoins.
- Mainnet, SKR, SGT ownership checks (mainnet-only, S9), or Seeker Connect (RN "Planned", S10).
- WalletConnect/Reown (A10.6).
- iOS cross-app capture (ReplayKit broadcast extension).
- Transcription; paid AI adapters.
- Push notifications (FCM is an external service).
- Builder teams.
- Hosting the app under test.
- Social feed, token, open bidding, autonomous testers, public reputation, or custody (`app-research-codex.md:462`).
- Deployment, public previews, cloudflared, dApp Store or Play submission (`CLAUDE.md:11`).

**Readiness labels (IR2).** The final readiness report (T8.5) labels every capability as one of:
- **Live/working** — verified end-to-end with evidence.
- **Wired but needs config** — the code path exists but needs configuration.
- **UI placeholder only** — must be zero for in-scope items.
- **Missing (deferred by decision)**.

## A4. Architecture

### A4.1 Components and boundaries

```
 ┌───────────────────────────── apps/mobile (Expo SDK 57) ─────────────────────────────┐
 │ Android dev build (Seeker first) │ iOS dev build (gated) │ Expo web preview :8081  │
 │  modules/pocketqa-recorder (Kotlin, MediaProjection)   wallet/ (wallet-ui kit, MWA)  │
 └───────────────┬─────────────────────────────────────────────┬────────────────────────┘
                 │ HTTP JSON + streaming PUT (Bearer token)    │ MWA intent/local socket (Android only)
                 ▼                                             ▼
 ┌──────── apps/api (Fastify, 127.0.0.1:8787) ────────┐   MWA wallet app on device (devnet)
 │ routes → domain (pure) → Drizzle/SQLite (var/)     │
 │ MediaStore (var/media, uuid filenames)             │
 │ ChainPort → https://api.devnet.solana.com (guarded)│
 │ AiProvider (none by default)                       │
 └────────────────────────────────────────────────────┘
 packages/contracts (Zod DTOs, error codes) · packages/domain (state machines, ledger, eligibility,
 consent, media sniffing, copy policy) · packages/wallet-auth (SIWS, devnet guard, transfer evaluation)
```

Device-to-API transport: run `adb reverse tcp:8787 tcp:8787` so the app always calls `http://127.0.0.1:8787`, and the API is never exposed on the LAN. The Android debug variant must allow cleartext to localhost (V13).

### A4.2 Capability matrix (iOS and web degrade explicitly)

| Capability | Android dev build | iOS dev build | Web preview |
|---|---|---|---|
| Screen recording | MediaProjection, one OS consent per session, per-task segments (API ≥ 29) | **Import-only**: tester records with iOS screen recording and imports the file; device testing "not performed" unless V12 passes | **Unavailable** with explanation |
| Mic narration | Optional (RECORD_AUDIO + FGS `microphone`) | Only if contained in the imported file | Unavailable |
| Wallet (MWA) | Yes — Wallet UI kit, `solana:devnet` | **Unavailable**: MWA is "not possible on iOS" (S8) | **Unavailable** in preview |
| Devnet transfer signing | Builder on Android | Unavailable | Unavailable (reason shown) |
| Session token storage | SecureStore (Keystore) | SecureStore (Keychain) | In memory only (sign in again after reload) |
| Builder review, admin | Yes | Yes | Yes (primary surface) |
| Seeker hint | `Platform.constants.Model === "Seeker"` → UX hint only, labeled unverified (S9) | — | — |

### A4.3 Architecture decision records

- **ADR-01 Client framework: Expo SDK 57 + Expo Router + dev client.**
  - Alternatives: Kotlin-native (best capture control, but no web preview or iOS reuse); Next.js + Capacitor (internal pipeline default, IR1, but a weaker native-module story for MWA and MediaProjection, and `CLAUDE.md` prefers Expo).
  - Consequences: native capture lives in a local Expo module, and Gate S0 may require changing its internals. If S0 shows Expo-module wiring cannot meet the capture requirements, the fallback is a Kotlin-native recorder service behind the same TypeScript `RecorderPort` (T4.3) — no UI changes.
- **ADR-02 Monorepo: pnpm workspaces.**
  - Packages export TypeScript source (`"main": "src/index.ts"`); Metro, Vitest, and tsx consume source directly, with no build step for local use.
- **ADR-03 API: Fastify + manual Zod parsing + better-sqlite3 + Drizzle.**
  - Tests use `app.inject()` against a temp-file SQLite database.
  - SQLite runs in WAL mode; budget reservation and nonce consumption use single-statement conditional updates inside transactions, so they are atomic (A5).
- **ADR-04 Auth: email + password (argon2id) with opaque bearer tokens.**
  - Tokens are 32 random bytes, base64url; the database stores only the SHA-256 hash; 7-day expiry; revoked on logout.
  - Native apps store the token in SecureStore; the web preview keeps it in memory only.
  - Admin accounts are created only by a CLI that reads the password from stdin.
- **ADR-05 Media: local filesystem under `MEDIA_DIR`.**
  - Filenames are UUIDs. Uploads are streaming `PUT` with a size cap, a MIME allowlist, magic-byte sniffing, and server-side SHA-256 (it must match the client hash when one is provided).
  - Playback uses short-lived HMAC playback tokens (120 s), because `expo-video` headers are unsupported on web (S17). Query strings are stripped from logs.
- **ADR-06 Recording: Android MediaProjection + MediaRecorder in a foreground service.**
  - The FGS type is `mediaProjection`, plus `microphone` only if narration was consented.
  - The app never opts out of app screen sharing, so the user may choose a single app (S13).
  - One consent per test session; per-task segments via `VirtualDisplay.setSurface()` rotation. S0 validates this; the fallback is one consent per task.
- **ADR-07 Wallet: `@wallet-ui/react-native-kit` on Android only.**
  - Devnet cluster; SecureStore-backed authorization cache (S7).
  - SIWS uses a server-issued payload; the server verifies with `verifySignIn` plus nonce, time, domain, and chain checks.
  - WalletConnect deferred (A10.6).
- **ADR-08 Money: none.**
  - Test-credit ledger. The optional devnet demo transfer is signed by the builder's own wallet and verified by the server on-chain. No custody, escrow, or programs.
- **ADR-09 AI: `AiProvider` interface; default `none` → `503 AI_PROVIDER_UNAVAILABLE`.**
  - `fake` exists only when `NODE_ENV=test`. Any other value fails at boot ("requires separate approval").
- **ADR-10 Testing:** Vitest (packages, API), jest-expo + RNTL (mobile), Playwright (web preview), Maestro (Android), JUnit (Kotlin pure logic), plus a manual device protocol with evidence.
- **ADR-11 Logging:** Fastify/pino with `redact` paths and a request serializer that drops query strings. A test asserts that tokens, passwords, and emails never appear in captured logs.

## A5. Data model (SQLite via Drizzle; `apps/api/src/db/schema.ts`)

| Table | Key columns | Invariants |
|---|---|---|
| `users` | id (uuid), email (unique, lowercased), password_hash, role (`tester`/`builder`/`admin`), display_name, status (`active`/`suspended`/`deleted`), adult_attested_at, created_at, deleted_at | Deleted users are pseudonymized, never hard-deleted (ledger/audit integrity) |
| `sessions` | id, user_id, token_hash (unique), created_at, expires_at, revoked_at | Plaintext tokens are never stored |
| `device_profiles` | user_id (pk), platform, os_version, android_api, ios_major, model, manufacturer, self_reported_seeker, model_hint_seeker, updated_at | `model_hint_seeker` is a spoofable hint (S9); never used to grant anything |
| `wallet_links` | id, user_id, address, chain (`solana:devnet`), linked_at, unlinked_at | ≤ 1 active link per user; an address is actively linked to ≤ 1 user |
| `wallet_nonces` | nonce (pk), user_id, purpose (`link`), payload_json, issued_at, expires_at, consumed_at | Payload is stored server-side; consumed atomically exactly once (S9) |
| `studies` | id, builder_id, title, app_name, app_link, goal, status, reward_credits, slots_total, ai_processing_enabled, created_at, published_at, closed_at | Text passes `findBannedCopy`; edits only while `draft` |
| `study_tasks` | id, study_id, position, title, instructions, max_minutes | 1–10 tasks |
| `device_criteria` | study_id (pk), platforms_json, min_android_api, min_ios_major, require_self_reported_seeker | |
| `consent_versions` | id, study_id, version, text_md, scopes_json, text_sha256, created_at | Immutable; the latest version is used at publish |
| `ledger_entries` | id, study_id, participation_id, kind (`fund_test`/`reserve`/`release`/`reward_approved`), amount (>0), created_by, created_at | Append-only; `available ≥ 0` checked inside the claim transaction |
| `participations` | id, study_id, tester_id, status, consent_version_id, scopes_json, claimed_at, consented_at, started_at, submitted_at, decided_at, decision_reason, reviewer_id, reservation_released_at | Unique (study_id, tester_id) — one attempt per study (R5) |
| `evidence_items` | id, participation_id, task_id, kind, status, storage_key, mime, size_bytes, sha256, duration_ms, capture_source, created_at, uploaded_at, removed_at, purged_at | Created/removed only before submit; purge deletes the file |
| `task_results` | participation_id + task_id (pk), outcome, difficulty (1–5), note | |
| `findings` | id, participation_id, created_by, title, severity, evidence_item_id, timestamp_ms, description, source (`human`/`ai_accepted`), created_at | AI text becomes a finding only via explicit human acceptance |
| `ai_suggestions` | id, participation_id, provider, model, status, payload_json, created_at, decided_by, decided_at | Labeled unverified |
| `compensations` | id, participation_id (unique), credits, status, created_at | Created only by approval (direct or dispute overturn) |
| `devnet_transfers` | id, compensation_id, signature (unique), from_address, to_address, lamports (text), memo, last_valid_block_height (text), status, failure_reason, checked_at, created_at | `confirmed` only via `evaluateTransfer` |
| `disputes` | id, participation_id (unique), opened_by, reason, status, resolution_reason, resolved_by, created_at, resolved_at | One dispute per participation |
| `moderation_actions` | id, admin_id, target_type, target_id, action, reason, created_at | |
| `data_requests` | id, user_id, kind, status, created_at, completed_at, export_json | |
| `audit_log` | id, actor_id, action, target_type, target_id, meta_json, at | Append-only (no update/delete function exists; T2.11 test) |

Budget arithmetic (`computeBudget`, T1.5):
- `funded = Σfund_test`
- `approved = Σreward_approved`
- `reservedOpen = Σreserve − Σrelease − approved`
- `available = funded − Σreserve + Σrelease`

## A6. State machines (`packages/domain`)

**Study:** `draft --PUBLISH--> published --PAUSE--> paused --RESUME--> published`; `published|paused --CLOSE--> closed`. PUBLISH requires 1–10 tasks, device criteria, a consent version, and `available ≥ reward_credits`.

**Participation:**

| From | Event | To | Rule |
|---|---|---|---|
| claimed | CONSENT | consented | Grant contains `screen_recording` |
| consented | START | in_progress | |
| in_progress | SUBMIT | submitted | ≥ 1 uploaded evidence item + results for every task |
| claimed, consented, in_progress | WITHDRAW | withdrawn | Releases reservation |
| claimed, consented, in_progress | EXPIRE | expired | Job after 48 h; releases reservation |
| submitted | APPROVE | approved | Creates compensation + `reward_approved` |
| submitted | REJECT(reason ≥ 10 chars) | rejected | Reservation kept until dispute window closes |
| rejected | OPEN_DISPUTE (no prior dispute) | disputed | Within 7 days |
| disputed | RESOLVE(uphold) | rejected | Reservation released |
| disputed | RESOLVE(overturn) | approved | Compensation created (RR8) |

**Compensation:** `approved_unpaid --TRANSFER_SUBMITTED--> transfer_pending --CONFIRMED--> transfer_confirmed`; `transfer_pending --FAILED|EXPIRED--> transfer_failed --TRANSFER_SUBMITTED--> transfer_pending` (retry).

**Devnet transfer:** `submitted → confirmed | failed | expired`, decided only by `evaluateTransfer` (§A10.4).

**Evidence:**
- On device: `captured → kept | removed_local → uploading → uploaded | upload_failed`.
- On the server: `pending_upload → uploaded → removed` (before submit only) `| purged` (retention or deletion).

**Dispute:** `open → resolved_upheld | resolved_overturned`.

## A7. API contract (`http://127.0.0.1:8787/v1`)

Conventions:
- JSON bodies; `Authorization: Bearer <token>`; ids are UUID v4; timestamps are ISO 8601 UTC.
- Credits are integers; lamports and block heights are decimal strings (u64 safety).
- Errors use the envelope `{"error":{"code","message","requestId"}}`, with codes and HTTP statuses defined in `packages/contracts/src/errors.ts` (T1.1).
- Resources the caller may not see return `404 NOT_FOUND` (no existence leak).
- Responses carry `Cache-Control: no-store`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer`.

| Method & path | Role | Body → response | Task |
|---|---|---|---|
| GET `/health` | public | → `{ok, cluster:"devnet", chainGuard:"ok"\|"unverified", aiProvider}` | T2.1 |
| POST `/auth/register` | public | `{email,password,role:"tester"\|"builder",displayName,adultAttested:true}` → 201 `{user,token,expiresAt}` | T2.3 |
| POST `/auth/login` | public | `{email,password}` → `{user,token,expiresAt}` / 401 generic | T2.3 |
| POST `/auth/logout` | any | → 204 | T2.3 |
| GET `/me` | any | → `{user, deviceProfile, wallet}` | T2.3 |
| PUT `/me/device-profile` | tester | DeviceProfileInput → profile | T2.6 |
| POST `/studies` | builder | StudyDraftInput → 201 study | T2.5 |
| PATCH `/studies/:id` | owner builder | partial draft → study (draft only) | T2.5 |
| PUT `/studies/:id/tasks` | owner builder | `{tasks:[…]}` (1–10) | T2.5 |
| PUT `/studies/:id/criteria` | owner builder | DeviceCriteriaInput | T2.5 |
| PUT `/studies/:id/consent` | owner builder | `{textMd,scopes}` → new consent version | T2.5 |
| POST `/studies/:id/fund` | owner builder | `{credits}` → budget summary (test credits) | T2.5 |
| POST `/studies/:id/{publish,pause,resume,close}` | owner builder | → study | T2.5 |
| GET `/builder/studies` | builder | → studies + budget summaries | T2.5 |
| GET `/tester/studies` | tester | → published studies with open slots + `eligibility{eligible,reasons}` | T2.6 |
| GET `/studies/:id` | tester (published) / owner | → study detail (tester view hides drafts) | T2.6 |
| POST `/studies/:id/participations` | tester (eligible) | → 201 participation (reserves budget) | T2.6 |
| POST `/participations/:id/consent` | owner tester | `{consentVersionId,scopes}` | T2.7 |
| POST `/participations/:id/start` | owner tester | → participation | T2.7 |
| PUT `/participations/:id/task-results` | owner tester | `{results:[…]}` | T2.7 |
| POST `/participations/:id/withdraw` | owner tester | → participation | T2.7 |
| POST `/participations/:id/submit` | owner tester | → participation | T2.7 |
| POST `/participations/:id/evidence` | owner tester | CreateEvidenceInput → 201 `{evidenceId,uploadPath}` | T2.8 |
| PUT `/evidence/:id/content` | owner tester | binary (`video/mp4`\|`image/png`\|`image/jpeg`) → `{status:"uploaded",sha256}` | T2.8 |
| DELETE `/evidence/:id` | owner tester (before submit) | → 204 | T2.8 |
| POST `/evidence/:id/playback-token` | owner tester / study builder / admin | → `{url,expiresAt}` | T2.9 |
| GET `/media/:evidenceId?token=` | token holder | → bytes (Range supported) | T2.9 |
| GET `/tester/participations` | tester | → list with status + decision reason | T2.10 |
| GET `/tester/rewards` | tester | → compensations + transfer states | T2.10 |
| GET `/builder/studies/:id/submissions` | owner builder | → submitted+ participations | T2.10 |
| GET `/submissions/:participationId` | owner builder / admin | → evidence, results, findings, suggestions, compensation | T2.10 |
| POST `/submissions/:participationId/findings` | owner builder | FindingInput → 201 | T2.10 |
| POST `/submissions/:participationId/decision` | owner builder | `{decision:"approve"\|"reject",reason}` | T2.10 |
| GET `/builder/studies/:id/report.md` | owner builder | → `text/markdown` findings report | T2.10 |
| POST `/participations/:id/disputes` | owner tester | `{reason}` → 201 | T2.11 |
| GET `/admin/disputes` · POST `/admin/disputes/:id/resolve` | admin | `{outcome:"uphold"\|"overturn",reason}` | T2.11 |
| POST `/admin/moderation` | admin | `{targetType,targetId,action,reason}` | T2.11 |
| GET `/admin/audit` | admin | → last 200 entries | T2.11 |
| POST `/me/data-requests` · GET `/me/data-requests` | any | `{kind:"export"\|"deletion"}` | T2.12 |
| GET `/admin/data-requests` · POST `/admin/data-requests/:id/complete` | admin | → executes export or deletion | T2.12 |
| GET `/me/data-requests/:id/export` | owner | → export JSON | T2.12 |
| POST `/submissions/:participationId/ai-suggestions` | owner builder | → 201 or 503 `AI_PROVIDER_UNAVAILABLE` / 409 `AI_CONSENT_MISSING` | T2.13 |
| POST `/ai-suggestions/:id/{accept,dismiss}` | owner builder | → finding / suggestion | T2.13 |
| POST `/wallet/nonce` | tester/builder | → `{signInInput}` | T2.14 |
| POST `/wallet/verify` | tester/builder | `{nonce,address,signedMessageB64,signatureB64}` → 201 link | T2.14 |
| DELETE `/wallet/link` | tester/builder | → 204 | T2.14 |
| POST `/compensations/:id/devnet-transfer/prepare` | owner builder | → `{from,to,lamports,memo,cluster:"devnet"}` | T2.15 |
| POST `/compensations/:id/devnet-transfer` | owner builder | `{signature}` → 202 transfer (server derives the expiry bound) | T2.15 |
| POST `/devnet-transfers/:id/check` | owner builder / recipient tester | → transfer with re-verified status | T2.15 |
| POST `/__test__/seed` | **only if** `POCKETQA_TEST_HOOKS=1` and `NODE_ENV!=="production"` | scenario → ids/tokens; otherwise the route **does not exist** (404) | T2.4 |

## A8. Authorization matrix

All checks are server-side; client role claims are never trusted. "Own" means the authenticated user owns the resource; "study owner" means the builder of the related study.

| Resource / action | Tester | Builder | Admin |
|---|---|---|---|
| Register as admin | ✗ | ✗ | CLI only |
| Create or edit a study | ✗ | own drafts | ✗ (moderation close only) |
| See published studies | eligible list | own only | all (via audit/moderation) |
| Claim, consent, start, submit, withdraw | own | ✗ | ✗ |
| Create, upload, or delete evidence | own, pre-submit | ✗ | ✗ |
| Mint playback token | own evidence | study owner | any (audited) |
| Findings / decisions | ✗ | study owner, submitted only | ✗ |
| Open dispute | own rejected | ✗ | ✗ |
| Resolve dispute, moderation, data requests, audit | ✗ | ✗ | ✓ (audited) |
| Wallet nonce/verify/unlink | own | own | ✗ |
| Devnet transfer prepare/submit | ✗ | study owner | ✗ |
| Devnet transfer check | recipient | study owner | ✓ |
| Suspended user | 403 on every authenticated route | same | — |

T2.16 enforces this matrix exhaustively: every route is checked against every role plus an anonymous caller.

## A9. Recording and evidence pipeline

1. **Consent (server).** The tester reads the versioned consent text and its scopes: `screen_recording` (required), `microphone` (optional), and `ai_processing` (optional, offered only if the study enables AI).
2. **Preflight checklist (client).** Lists the items below.
   - Install the app under test from the builder's link, and use the builder's test accounts and test wallet.
   - Turn on Do Not Disturb and close private apps.
   - In Android's dialog, choose **"A single app"** (recommended; it excludes notifications and system UI, S13). Choose **entire screen** only if the task requires switching apps, for example a wallet approval. Entire-screen capture can show notifications.
   - Secure screens may record as black (FLAG_SECURE, `:462`). That is expected and is never bypassed.
   - Never type real passwords or seed phrases.
3. **Start (Android).**
   - The app calls `createScreenCaptureIntent()`. The OS consent dialog appears once per session (S13), and the app never opts out of app screen sharing.
   - Only after a grant does the FGS start (`mediaProjection`, plus `microphone` if narration was consented and `RECORD_AUDIO` granted; S14). Then `getMediaProjection()` → `registerCallback(onStop)` → `MediaRecorder` → a single `createVirtualDisplay()`.
   - A persistent notification shows "Recording task N of M: <title>" with **Next task** and **Stop** actions.
   - Android 15 QPR1+ also shows the system chip. Screen lock stops the projection (S13).
4. **Segments.**
   - **Next task** finalizes the current MP4 (`recorder.stop()`), computes SHA-256 natively, starts a new recorder, and calls `virtualDisplay.setSurface(newSurface)`.
   - Files live in app-private storage: `files/recordings/<participationId>/<taskId>-<n>.mp4`.
   - `allowBackup=false` (S18).
5. **System stop** (chip, lock, revoke). `onStop` finalizes the current segment, emits `stopped{reason:"system"}`, and stops the FGS. The UI shows "Recording stopped by Android" with the finished segments intact (Review Focus 5).
6. **Review and redact (client).** Each segment is listed with task, duration, and size. The tester can **Play** (expo-video, local file) or **Remove**, which deletes the local file after a confirmation dialog. Removed segments are excluded from upload by construction (Review Focus 1).
7. **Upload.**
   - Sequential: `POST /participations/:id/evidence` (metadata + sha256), then a streaming `PUT /evidence/:id/content`.
   - The server sniffs magic bytes and enforces `MAX_UPLOAD_BYTES` (300 MiB) and SHA-256 equality.
   - Failures are retryable; offline pauses the queue.
8. **Submit.** Requires ≥ 1 uploaded item and results for every task. After submission, evidence is immutable.
9. **iOS.** The tester imports a recording made with iOS screen recording via the document picker, then follows the same review, upload, and submit steps. The server computes the SHA-256.
10. **Web.** Recording is unavailable, with an explicit explanation. Builders review on web.

Covert-capture guarantees (R31):
- No capture without the OS dialog.
- No auto-start, and no start from background (S14).
- A persistent notification plus the system chip while recording.
- `onStop` is mandatory.
- The recorder never runs outside an `in_progress` participation (T4.3 guards).

## A10. Wallet and devnet flows

### A10.1 Link a wallet (Sign In With Solana; Android only)
1. Settings → Wallet → "Link devnet wallet". The copy says: "Connecting a wallet does not send or receive money" and "Pocket QA will never ask for your seed phrase or private key."
2. `POST /wallet/nonce` → the server creates a `nonce` (32 hex chars), stores the full `signInInput`, and returns it. The input contains:
   - `domain: SIWS_DOMAIN` (default `pocketqa.invalid`, an RFC 2606 reserved TLD that nobody can register or impersonate);
   - `statement: "Link this wallet to your Pocket QA account on Solana devnet. This does not send or receive money."`;
   - `uri: SIWS_URI` (`https://pocketqa.invalid`), `version: "1"`, `chainId: "solana:devnet"`;
   - `nonce`, `issuedAt`, `expirationTime` (+5 min).
3. The client calls `signIn(signInInput)`, omitting `address` so the wallet picks the account (S4). The wallet shows the SIWS prompt.
4. The client posts `{nonce, address, signedMessageB64, signatureB64}` to `/wallet/verify`.
5. The server, in order:
   1. Atomically consumes the nonce (`UPDATE … SET consumed_at=? WHERE nonce=? AND user_id=? AND consumed_at IS NULL AND expires_at>?`). Zero rows means `NONCE_INVALID`. Consuming before verifying means a failed attempt still burns the nonce.
   2. Rebuilds the input from the **stored** payload, never the client copy (S9).
   3. Calls `verifyLinkSignature`: `verifySignIn` field-by-field and ed25519, plus `chainId === "solana:devnet"`, domain equality, and the time window.
   4. Links the address (`WALLET_ALREADY_LINKED` if it is active for another user) and appends an audit entry.
6. Replays fail at step 5.1, and cross-user use fails on `user_id`. Both are tested (Review Focus 2).

### A10.2 Reconnect
Wallet UI persists the MWA `auth_token` through the custom SecureStore cache (S7). Passing the stored token skips the approval dialog (S6). Reconnecting is local only; the server link persists independently.

### A10.3 Disconnect versus remove link
- **Disconnect wallet app** calls `disconnect()` (deauthorize plus cache clear; V15). Local only.
- **Remove linked wallet** calls `DELETE /wallet/link`; server only, audited. The UI explains both.

### A10.4 Devnet demo transfer (builder → tester; Android only; optional, Q5)
- **Prerequisites:** compensation `approved_unpaid` or `transfer_failed`; **both** builder and tester have active links; the builder is in the Android app with an MWA wallet set to devnet. On web and iOS the action is disabled, with the reason "Requires the Android app with a Mobile Wallet Adapter wallet."

Flow:
1. `POST …/devnet-transfer/prepare` → `{from: builderLinked, to: testerLinked, lamports: DEVNET_DEMO_LAMPORTS (default "1000000"), memo: "pocketqa:comp:<compensationId>", cluster:"devnet"}`.
2. **Preview (RR4):** recipient (short + full), network "Solana devnet", asset "SOL (devnet, no real value)", amount, network fee ("about 0.000005 devnet SOL base fee per signature; your wallet shows the exact fee before you approve"), purpose (memo), and validity ("must confirm within about one minute").
3. On confirmation the client calls Wallet UI `sendTransactions([transferInstruction, memoInstruction])`. That call builds the transaction with the connected account as fee payer, asks the wallet to sign and send it, and returns the signature (S4 code sample). The client then posts `{signature}`.
4. The server reads the current devnet block height `H` and stores `lastValidBlockHeight = H + 170`. A blockhash the wallet fetched before submission is valid for at most 150 blocks; the extra 20 is a safety margin. The server records `submitted` and sets the compensation to `transfer_pending`.

Verification is server-side (`evaluateTransfer`, pure, T1.13). Inputs: `getSignatureStatuses`, `getTransaction(jsonParsed)`, and `getBlockHeight`. Rules in order:
- No status and block height > `lastValidBlockHeight` → `expired` (the transaction can never land, so no funds moved).
- No status otherwise → `pending`.
- Status error → `failed`.
- `processed` → `pending`.
- Transaction error → `failed`.
- Otherwise require exactly one top-level `system/transfer` with `source=from`, `destination=to`, `lamports=expected`, and a top-level `spl-memo` whose parsed text equals the memo. Any mismatch → `failed("transfer does not match prepared parameters")`. Then → `confirmed`.

The client polls `POST /devnet-transfers/:id/check` every 3 s for up to 90 s. UI states: **Pending** ("Waiting for devnet confirmation"), **Confirmed** (explorer link `https://explorer.solana.com/tx/<sig>?cluster=devnet`), **Failed** (reason + retry), **Expired** ("Expired before confirmation — no devnet funds moved").

### A10.5 Network guard
At boot the API calls `assertDevnetRpcUrl(SOLANA_RPC_URL)`, which rejects any URL containing `mainnet`, then `getGenesisHash` and `assertDevnetGenesis(hash)` (V1).
- On mismatch, the process refuses to start.
- If the RPC is unreachable, the API starts with `chainGuard:"unverified"`, and every chain route returns `503 CHAIN_UNAVAILABLE` until a re-check passes.
- SIWS `chainId` must equal `solana:devnet`.

### A10.6 WalletConnect / Reown (R41) — verified, deliberately deferred
- Official docs state "AppKit supports Solana on web frameworks, React Native, and Unity" (S12), via `@reown/appkit-solana-react-native` (S11).
- It is **not** in this pass:
  1. It requires a projectId from `https://dashboard.reown.com/` — an external account (`CLAUDE.md:11`).
  2. Its Phantom/Solflare connectors are wallet-specific custom connectors; the documented example uses `cluster: 'mainnet-beta'`, and the devnet value is unverified (V10).
  3. It is a different protocol from MWA, and the code keeps it separate if ever added (a separate `walletconnect/` adapter behind the same `WalletPort`).
- It is the only plausible iOS wallet path later (S8). Status: "Missing (deferred by decision)".

### A10.7 Seeker specifics
- No Seeker API is invented.
- Device criteria offer "Seeker (self-reported, unverified)".
- The client may pre-fill the self-report hint from `Platform.constants.Model === "Seeker"`, labeled spoofable (S9).
- SGT verification (SIWS + Token-2022 group membership + unique mint dedup, S9 / `:78`) is mainnet data and is deferred (Q12).
- Seed Vault requires per-signature user approval (`:75`), so there is no automation or delegated signing.

## A11. AI provider policy
- `AI_PROVIDER` defaults to `none`; the UI shows "AI suggestions unavailable — no AI provider is configured. Review the evidence manually." There is no placeholder output, no sample summaries, and no generated text anywhere (R7, R35).
- `fake` exists only when `NODE_ENV=test` (boot fails otherwise). It is used to test the accept/dismiss UX.
- Any other value fails at boot with "AI provider '<x>' requires separate approval (paid service) and is not implemented in this pass" (`CLAUDE.md:7`).
- When a real adapter is approved later:
  - Input is text only (task results + tester notes) from participants who granted `ai_processing`. No media, no seed phrases (RR4).
  - Output is validated by Zod and stored as `ai_suggestions` labeled "AI suggestion · verify against the recording".
  - It becomes a finding only via explicit builder acceptance (RR2, RR6).
  - The model ID comes from configuration (`AI_MODEL`) with no silent default. On-device generative inference is not assumed (`:65`).

## A12. Privacy, consent, retention, export, deletion

### A12.1 Data inventory

| Data | Purpose | Stored | Access | Retention |
|---|---|---|---|---|
| Email, display name | Account | `users` | Self, admin | Until deletion (then pseudonymized) |
| Password hash | Auth | `users` (argon2id) | Nobody reads it | Until deletion |
| Device profile | Eligibility | `device_profiles` | Self; the builder sees only "eligible" | Until deletion |
| Wallet address | Devnet link and transfer | `wallet_links` | Self; the builder sees the recipient only in the transfer preview | Until unlink or deletion |
| Recordings and screenshots | Evidence | `var/media` (uuid names) | Owner tester, study builder, admin (audited) | 30 days after decision; held while a dispute is open; purged on deletion |
| Task results, notes | Evidence | DB | Same as recordings | Same as recordings |
| Consent records | Proof of consent | `participations`, `consent_versions` | Owner, study builder, admin | Kept (pseudonymized after deletion) |
| Ledger and audit | Integrity | DB | Builder (own studies), admin | Kept (pseudonymized) |

### A12.2 Consent text template (builder-editable but must include these clauses; validated in T2.5)
"Pocket QA records your screen only after you tap Start and Android asks for permission. A notification shows while recording. You can stop at any time. Before uploading you can watch every segment and remove any you do not want to share. Recordings are visible only to you, the study's builder, and Pocket QA admins, and are deleted 30 days after a decision. Rewards are not guaranteed and are paid only after a reviewer approves your submission."

### A12.3 Export and deletion
- **Export:** the user requests it; an admin completes it; the system builds JSON of the user's records (profile, participations, consent records, evidence metadata, findings about them, ledger lines about them, wallet links). Media is downloaded per item via the existing authorized playback.
- **Deletion:** the user requests it; an admin completes it; the system:
  - revokes sessions and unlinks wallets;
  - purges the user's media (and, for a builder, media of their studies' participants, whose owners are notified via status);
  - pseudonymizes the user (`email → deleted+<id>@invalid`, name null, password_hash null, status `deleted`);
  - keeps ledger and audit rows. Tested in T2.12.

### A12.4 Logs and secrets
pino `redact`: `req.headers.authorization`, `req.headers.cookie`, `*.password`, `*.token`, `*.email`, `*.signatureB64`, `*.signedMessageB64`. The request serializer drops query strings. Secrets come from `.env.local` (gitignored); `.env.example` lists names only. `tools/check-secrets.mjs` blocks commits containing key-like material (T0.1).

## A13. Threat model

**Assets:** recordings (may contain PII), account credentials and tokens, wallet links, budgets/ledger, decisions, consent records.
**Actors:** honest tester, honest builder, admin, malicious tester (fraud, farming, IDOR), malicious builder (data harvesting, unfair rejection), network or local attacker, compromised device, malicious app under test (detects recording, S15).
**Trust boundaries:** device ↔ API, API ↔ filesystem, API ↔ devnet RPC, app ↔ MWA wallet, builder-entered text ↔ tester UI.

| STRIDE | Threat | Mitigation | Test |
|---|---|---|---|
| S | Session token theft | SecureStore/in-memory, hashed at rest, 7-day expiry, logout revocation, no tokens in logs | T2.3, T2.1 |
| S | SIWS replay / cross-account | Single-use atomic nonce bound to user, stored payload, domain/chain/time checks | T2.14 |
| S | Spoofed "Seeker" | Self-reported + labeled; never grants privilege | T1.6 |
| T | Evidence altered in transit/at rest | SHA-256 verified at upload; immutable after submit; uuid paths outside any web root | T2.8 |
| T | Client fakes a "paid" state | Server-side chain verification only; client claims never trusted | T1.13, T2.15 |
| R | Builder denies rejecting | Decision + reason + reviewer id + audit row | T2.10, T2.11 |
| I | IDOR on evidence or participations | Ownership checks, 404 for non-owners, exhaustive matrix | T2.9, T2.16 |
| I | Playback URL leakage | 120 s HMAC token bound to user and evidence, re-authorized at stream time, query string redacted, `Referrer-Policy: no-referrer` | T2.9 |
| I | Recording captures notifications or passwords | Single-app recommendation, preflight checklist, preview/remove, test accounts, retention purge | T4.4, T4.5 |
| I | PII in logs | pino redaction + log-capture test | T2.1 |
| I | Secrets in repo | `check:secrets` before every commit; `.env.local` gitignored | T0.1 |
| D | Upload exhaustion | Content-Length precheck, streaming byte cap, per-route rate limits | T2.8 |
| D | Auth/nonce brute force | `@fastify/rate-limit` on auth and wallet routes | T2.3, T2.14 |
| E | Role escalation | Role from DB only; admin via CLI only; suspended users blocked | T2.4, T2.16 |
| E | Test hooks reachable outside tests | Route registered only with `POCKETQA_TEST_HOOKS=1` and non-production; absence test | T2.4 |

**Abuse cases:**
- **Farming:** one claim per study (unique index), rewards only after reviewer approval, no streaks or airdrops, banned copy (R5).
- **Duplicate evidence across accounts:** SHA-256 duplicate flag shown to builders (T2.10).
- **Builder harvesting tester data:** builders see only their own study's evidence, and retention purge applies.
- **Unfair rejection:** a reason is required, plus a dispute path to admin (RR8).
- **Phishing via builder text:** banned-copy and length limits; links are shown as plain text with the host visible.
- **Wallet:**
  - Never request seed phrases or private keys, and warn when one is pasted into notes (T4.4 heuristic: 12/24 lowercase dictionary-like words → blocking warning).
  - Login uses SIWS only, never a transaction.
  - Transfer preview fields per RR4; per-transfer approval in the wallet.
- **Malicious app under test** may detect recording (S15) or block it (FLAG_SECURE) — accept it and never bypass (`:462`).
- **Supply chain:** pnpm lockfile committed, `pnpm audit --prod` recorded in the evidence pack (T8.5), no postinstall scripts added by us.

## A14. UX specification

### A14.1 Design tokens (`apps/mobile/src/theme/tokens.ts`; contrast-tested in T3.2)

| Token | Light | Dark |
|---|---|---|
| bg | #F9FAFB | #0B0F14 |
| surface | #FFFFFF | #121821 |
| surfaceMuted | #F3F4F6 | #1A2230 |
| border (decorative) | #E5E7EB | #263042 |
| controlBorder (≥3:1) | #6B7280 | #7D8796 |
| text | #111827 | #F3F4F6 |
| textMuted | #4B5563 | #A3ACB9 |
| primary / onPrimary | #4F46E5 / #FFFFFF | #A5B4FC / #111827 |
| danger / onDanger | #B42318 / #FFFFFF | #F97066 / #111827 |
| success / onSuccess | #067647 / #FFFFFF | #47CD89 / #111827 |
| warningBg / onWarning | #FEF0C7 / #7A2E0E | #3B2A05 / #FEDF89 |
| devnetBg / onDevnet | #E0F2FE / #075985 | #0C4A6E / #E0F2FE |
| focusRing | #4F46E5 | #A5B4FC |

Typography: system font. Sizes 28/22/17/15/13 with line heights ×1.3; weight 600 for headings. Spacing scale 4/8/12/16/24/32. Radius 12 for cards and 10 for controls. Elevation: light uses a 1 px border plus a subtle shadow; dark uses border only (no gray-on-gray shadows, IR4).

### A14.2 Lucide icon map (`apps/mobile/src/icons.ts`)
- Tabs: tester `Compass` / `ClipboardList` / `Award` / `Settings`; builder `FlaskConical` / `ListChecks` / `Settings`; admin `Scale` / `ShieldAlert` / `Database` / `ScrollText`.
- Actions: `Circle` (record), `Square` (stop), `SkipForward` (next task), `Mic`/`MicOff`, `Play`, `Trash2`, `CloudUpload`, `Link2`/`Unlink`, `ExternalLink`, `Sparkles` (AI panel), `FileDown`, `UserX`, `Sun`/`Moon`/`SunMoon`.
- States: `CircleCheck`, `TriangleAlert`, `WifiOff`, `Lock`, `Ban`.

Unknown names fail `tsc` (T3.3).

### A14.3 Navigation (Expo Router)
- `app/(auth)/{welcome,sign-in,sign-up}`
- `app/(tester)/(tabs)/{discover,sessions,rewards,settings}`
- `app/(tester)/study/[studyId]`
- `app/(tester)/session/[participationId]/{consent,preflight,run,review}`
- `app/(builder)/(tabs)/{studies,settings}`
- `app/(builder)/study/{new,[studyId]}`
- `app/(builder)/submission/[participationId]`
- `app/(admin)/(tabs)/{disputes,moderation,data,audit}`

`app/index.tsx` redirects by role.

### A14.4 Screen inventory with required states

Legend: L = loading, E = empty, Er = error with retry, O = offline banner, U = unavailable (capability, with reason), P = permission denied, F = forbidden/suspended, S = success/confirmation, V = validation errors.

| Screen | States | Notes |
|---|---|---|
| Welcome / sign-in / sign-up | L, Er, V, S | Adult attestation checkbox required; generic login error |
| Discover | L, E ("No studies match your device yet"), Er, O, F | Ineligible studies are listed muted with reasons; on web the reason is "Requires the Android or iOS app" |
| Study detail | L, Er, O, U, S | "Reward if approved: N test credits" + "Not guaranteed…"; data-use summary; device criteria; AI flag |
| Consent | L, Er, V, S | Screen scope required; mic and AI toggles; consent version shown |
| Preflight | S | Checklist with single-app guidance and FLAG_SECURE note |
| Run (recorder) | idle, requesting, recording (task N/M), stopped (user/system/max), consent denied, P (mic), Er, U (iOS → import, web → unavailable) | Recording indicator uses `danger`; never auto-starts |
| Review & redact | E (no segments), list, playing, removed, V (≥1 segment, all task results), seed-phrase warning | Remove requires confirmation |
| Upload / submit | progress, Er (retry), O (paused), S | Never uploads removed segments |
| Sessions list/detail | L, E, Er, O; statuses with decision reason; dispute form (V) | |
| Rewards | L, E, Er, O; test-credit totals; transfer pending/confirmed/failed/expired | "Test credits — no real money in this build" |
| Builder studies | L, E ("Create your first study"), Er, O | |
| Study wizard | V per step, Er, S | Banned-copy errors inline; test-credit funding labeled |
| Study dashboard | L, Er, budget summary, submissions E/list | Pause/close confirmations |
| Submission review | L, Er, player loading/error, findings E/list/V, AI panel U ("unavailable"), decision V (reason ≥10 chars), compensation card states | Duplicate-evidence flag |
| Admin disputes / moderation / data / audit | L, E, Er, V, S | Every action requires a reason |
| Settings | theme (system/light/dark), wallet (Android: connect/link/disconnect/remove; iOS/web: U), privacy (export, delete with confirmation), capabilities page | |

### A14.5 Copy rules (single catalog `apps/mobile/src/copy/en.ts`, policy-tested)
- Required phrases:
  - "Reward if approved"
  - "Not guaranteed. Paid only after a reviewer approves your submission."
  - "Test credits — no real money in this build."
  - "Devnet · no real value"
  - "Connecting a wallet does not send or receive money."
  - "Pocket QA will never ask for your seed phrase or private key."
- Banned (T1.9): guaranteed earnings/income/pay, "earn money/crypto/SOL/tokens", "passive income", "airdrop", "farm/farming", "get paid instantly/automatically", "mainnet". The phrases "seed phrase" and "private key" are allowed only in the never-ask warning.
- No vendor or implementation words in user copy (IR1): no "MWA", "RevenueCat", "devnet RPC", or "placeholder". The single exception is the "Mobile Wallet Adapter" capability explanation.

### A14.6 Accessibility
- Contrast per A14.1; touch targets ≥ 48 dp; `accessibilityLabel` on icon-only buttons.
- Recording state is announced via `accessibilityLiveRegion="polite"` (Android) or `AccessibilityInfo.announceForAccessibility`.
- Support dynamic type up to 200 % without clipping; never encode meaning by color alone (icons + text on status chips).
- Web: axe-core scan with zero serious or critical violations (T8.1).

## A15. Testing strategy and evidence protocol

- **Unit (Vitest):**
  - `packages/*`: every state machine, the ledger, eligibility, consent, media sniffing, copy policy, SIWS, and transfer evaluation.
  - Root: `pnpm test`.
- **API integration (Vitest + `app.inject()`):** a temp SQLite file per test file, a temp media dir, a fake ChainPort, the AI provider `none` (or `fake` in AI tests). Covers authz-matrix, IDOR, replay, redaction, upload validation, and test-hook absence.
- **Mobile component (jest-expo + RNTL + `expo-router/testing-library`):** every screen's states from A14.4; theme toggle; copy policy; recorder state handling with `FakeRecorderPort`; upload exclusion; wallet orchestration with `FakeWalletPort`.
- **Kotlin unit (JUnit):** `SegmentPlanner` transitions.
- **Web E2E (Playwright, Chromium):**
  - Runs against `expo export -p web` served on `:8081` plus an API with `POCKETQA_TEST_HOOKS=1` and a temp DB.
  - Fails on `pageerror` and console errors.
  - Light and dark screenshots of every primary screen; axe scan.
  - Artifacts go to `artifacts/e2e-web/<RUN_ID>/` (IR3).
- **Android E2E (Maestro):** emulator for UI and wallet (with V6); a physical Android 14+ device (Q1) for recording. System-dialog selectors per V7. Artifacts go to `artifacts/maestro/<RUN_ID>/`.
- **Manual device protocol (T5.4, T7.4):** a scripted checklist with screenshots or screen recordings saved under `artifacts/device/<RUN_ID>/`, summarized in `docs/evidence/<fc-id>.md`. Covers:
  - single-app vs entire-screen capture;
  - FLAG_SECURE wallet screens;
  - status-chip stop;
  - lock stop;
  - mic denied;
  - notification "Next task".
- **Evidence rule (IR7):**
  - Every claim in an evidence file quotes the exact command, exit code, and pass/fail counts, and gives artifact paths.
  - "Not performed" is written explicitly; nothing is inferred.
  - `artifacts/` is gitignored; `docs/evidence/` summaries are committed after review.

## A16. Worktrees, review checkpoints, gates (details in the handoff)

**Roles:**
- `lead` — integration and merges.
- `core` — `packages/**`, `tools/**`, root config.
- `api` — `apps/api/**`.
- `mobile` — `apps/mobile/**` except `apps/mobile/modules/**`.
- `native` — `apps/mobile/modules/**`, `spikes/**`.
- `security-reviewer` and `product-qa-reviewer` — read-only checkouts; they write only to the shared reviews and evidence directories outside git.

**Freeze candidates (FC):**

| FC | Scope | Gate |
|---|---|---|
| FC-0 | T0.1–T0.2 + S0 report | **Gate S0** (capture feasibility GO/NO-GO) |
| FC-1 | T1.* | — |
| FC-2 | T2.* | — |
| FC-3 | T3.*, T4.*, T6.* | **Gate A** (web preview + local API, tester and builder flows) |
| FC-4 | T5.* | **Gate B1** (Android capture on a device) |
| FC-5 | T7.* | **Gate B2** (wallet link + devnet transfer) |
| FC-6 | T8.* | **Gate B final** |

**Severity rubric:**
- **P0** — privacy/security breach, covert capture, fake payment or AI claim, mainnet exposure, secret leak, data loss.
- **P1** — broken core flow, authz gap, missing consent step, a11y blocker.
- **P2** — wrong state or edge-case bug, missing UX state, contrast failure, misleading copy.
- **P3** — polish.

P0–P2 block a merge (`CLAUDE.md:9`). A merge to `main` happens only after all reviewers APPROVE the same SHA **and** Hamza approves in writing.

---

# Part B — Task plan

## B0. Conventions for every task

- **Where:** your role worktree, `/Users/hamzadiaz/Projects/pocket-qa-worktrees/<role>` (handoff §D), on your role branch. Never commit to `main`.
- **Ownership:** each task names one owner role. Files outside your ownership globs (handoff §D.3) change only after a note in `/Users/hamzadiaz/Projects/pocket-qa-worktrees/_shared/inbox/<owner-role>.md` and that owner's commit.
- **TDD loop:** failing test → run and see the expected failure → minimal implementation → run and see it pass → `pnpm check:secrets` → commit.
- **Package filters:** `@pocketqa/tools`, `@pocketqa/contracts`, `@pocketqa/domain`, `@pocketqa/wallet-auth`, `@pocketqa/api`, `@pocketqa/mobile`.
- **Commit template** (every task's last step uses it with the listed files):
  ```bash
  git add <files listed in the task>
  git commit -m "<type>(<scope>): <summary>" -m "Task <ID>: <what the tests prove>." -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
  ```
- **"Record"** means: append the exact command, its exit code, and pass/fail counts to `/Users/hamzadiaz/Projects/pocket-qa-worktrees/_shared/status/<role>.md`.
- **Step 0** steps resolve the task-verified values in §A2.4. If the observed value contradicts this plan, stop, write the observation to `_shared/inbox/lead.md`, and wait for the lead. Never improvise around a contradiction.

## B1. Interface registry

Names and signatures every task relies on. A task's **Interfaces** block cites this registry.

- `@pocketqa/contracts` (`packages/contracts/src`)
  - `errors.ts`: `ErrorCode` (const object + type), `ERROR_HTTP_STATUS: Record<ErrorCode, number>`, `ApiErrorBodySchema`, `type ApiErrorBody`.
  - `enums.ts`: `RoleSchema`, `StudyStatusSchema`, `ParticipationStatusSchema`, `ConsentScopeSchema`, `EvidenceKindSchema`, `EvidenceStatusSchema`, `CaptureSourceSchema`, `TaskOutcomeSchema`, `FindingSeveritySchema`, `CompensationStatusSchema`, `DevnetTransferStatusSchema`, `DisputeStatusSchema`, `DataRequestKindSchema`, `DataRequestStatusSchema`, `ClientPlatformSchema`, `LedgerKindSchema`, plus the matching `type X = z.infer<…>`; `SOLANA_DEVNET_CHAIN = "solana:devnet"`.
  - `schemas.ts`: request and response schemas listed in T1.2, each exported with `type X = z.infer<typeof XSchema>`.
- `@pocketqa/domain` (`packages/domain/src`)
  - `DomainError(code: ErrorCode, message: string)`.
  - `transitionParticipation(from, event): ParticipationStatus`, `releasesReservation(to, viaDisputeUphold?): boolean`, `MIN_REASON_LENGTH = 10`.
  - `transitionStudy(from, event): StudyStatus`, `assertPublishable(input): void`, `MAX_TASKS = 10`.
  - `computeBudget(entries): BudgetSummary`, `assertCanReserve(summary, reward): void`.
  - `evaluateEligibility(criteria, profile | null): { eligible: boolean; reasons: string[] }`, `MIN_RECORDING_ANDROID_API = 29`.
  - `validateConsentGrant(input): ConsentScope[]`, `PLATFORM_CONSENT_PREAMBLE`.
  - `sniffMediaType(head): AllowedMime | null`, `assertDeclaredMimeMatches(declared, sniffed): AllowedMime`, `ALLOWED_MIME_TYPES`.
  - `findBannedCopy(text, audience: "app" | "builder"): string[]`, `looksLikeSeedPhrase(text): boolean`.
  - `transitionCompensation(from, event): CompensationStatus`.
- `@pocketqa/wallet-auth` (`packages/wallet-auth/src`)
  - `createNonce(random?)`, `buildSignInInput(cfg, now, nonce): IssuedSignInInput`, `LINK_STATEMENT`.
  - `verifyLinkSignature(issued, wire, expectedDomain, now, clockSkewMs?): VerifyLinkResult`.
  - `DEVNET_GENESIS_HASH`, `assertDevnetGenesis(hash)`, `assertDevnetRpcUrl(url)`, `devnetExplorerTxUrl(sig)`, `buildTransferMemo(compensationId)`, `DEVNET_EXPIRY_MARGIN_BLOCKS = 170n`, `evaluateTransfer(snapshot, expected): TransferVerdict`.
- `@pocketqa/api` (`apps/api/src`)
  - `loadConfig(env): AppConfig`.
  - `openDb(file): Db`.
  - `buildApp(deps: AppDeps): Promise<FastifyInstance>` with `AppDeps = { config; db; media: MediaStore; chain: ChainPort; ai: AiProvider; now?: () => Date; logStream?: NodeJS.WritableStream }`.
  - `createFsMediaStore(dir)`, `createFakeChainPort(script)`, `createKitChainPort(url)`, `verifyChainGuard(app)`, `noneAiProvider`, `resolveAiProvider(config)`, `createFakeAiProvider()`.
  - `requireUser(req)`, `requireRole(req, ...roles)`, `appendAudit(db, entry, now)`.
  - Test helpers: `makeTestApp(opts)`, `registerAs(app, role)`, `bearer(token)`, `createAdminSession(db)`, `seedDeviceProfile(app, token, profile?)`, `seedPublishedStudy(app, builderToken, overrides?)`, `linkWalletDirect(db, userId, address)`.
- `@pocketqa/mobile` (`apps/mobile/src`)
  - `lightTokens`, `darkTokens`, `CONTRAST_REQUIREMENTS`, `contrastRatio(a, b)`.
  - `ThemeProvider`, `useTheme()`, `resolveScheme(pref, system)`, `ThemePreferencePicker`.
  - `copy`, `icons`, `Icon`.
  - UI primitives: `ScreenState`, `Button`, `Card`, `Badge`, `TextField`, `Screen`, `OfflineBanner`.
  - Capabilities: `detectCapabilities(env)`, `currentCapabilityEnv()`, `CapabilityProvider`, `useCapabilities()`.
  - API and auth: `createApiClient(opts)`, `ApiError`, `createSessionStore(kind)`, `AuthProvider`, `useAuth()`.
  - Recorder: `RecorderPort`, `FakeRecorderPort`, `createRecorderPort(capabilities)`.
  - Upload: `uploadSegments(args)`.
  - Wallet: `WalletPort`, `FakeWalletPort`, `linkWallet(api, wallet)`, `runDevnetTransfer(args)`, `createSecureAuthorizationCache()`.

---

## Phase 0 — Foundations and Gate S0

### Task T0.1: Workspace bootstrap and secret scanner

**Owner:** core · **Branch:** `feat/core-foundations`

**Files:**
- Create: `package.json`, `pnpm-workspace.yaml`, `.npmrc`, `.gitignore`, `.editorconfig`, `tsconfig.base.json`, `eslint.config.mjs`
- Create: `tools/package.json`, `tools/vitest.config.mjs`, `tools/secret-patterns.mjs`, `tools/check-secrets.mjs`
- Test: `tools/test/check-secrets.test.mjs`

**Interfaces:**
- Consumes: nothing.
- Produces: `scanText(text: string, fileName: string): Array<{ fileName: string; ruleId: string; line: number }>`, and root scripts `pnpm check:secrets`, `pnpm test`, `pnpm typecheck`, `pnpm lint`.

- [ ] **Step 1: Write workspace configuration**

`package.json`:
```json
{
  "name": "pocket-qa",
  "private": true,
  "type": "module",
  "engines": { "node": ">=22.13.0" },
  "scripts": {
    "check:secrets": "node tools/check-secrets.mjs",
    "preflight": "node tools/preflight.mjs",
    "test": "pnpm -r --if-present test",
    "typecheck": "pnpm -r --if-present typecheck",
    "lint": "eslint ."
  }
}
```

`pnpm-workspace.yaml`:
```yaml
packages:
  - "apps/*"
  - "packages/*"
  - "tools"
```

`.npmrc` (decision: hoisted layout for React Native autolinking; T3.1 Step 5 re-checks it with `expo-doctor`, V5):
```
node-linker=hoisted
```

`.gitignore`:
```
node_modules/
.env.local
.env.*.local
artifacts/
apps/api/var/
apps/mobile/android/
apps/mobile/ios/
apps/mobile/dist-web/
apps/mobile/.expo/
coverage/
*.keystore
*.jks
id.json
.DS_Store
*.log
```

`.editorconfig`:
```
root = true
[*]
charset = utf-8
end_of_line = lf
indent_style = space
indent_size = 2
insert_final_newline = true
trim_trailing_whitespace = true
```

`tsconfig.base.json`:
```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "noImplicitOverride": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "resolveJsonModule": true,
    "isolatedModules": true,
    "types": ["node"]
  }
}
```

`eslint.config.mjs`:
```js
import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: [
      '**/node_modules/**', 'artifacts/**', '**/dist-web/**', 'apps/mobile/android/**',
      'apps/mobile/ios/**', 'apps/mobile/.expo/**', 'apps/api/var/**', 'apps/api/drizzle/**', 'spikes/**',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  { files: ['tools/**/*.mjs', '**/*.config.{js,mjs,cjs}', 'apps/mobile/scripts/**/*.mjs'], languageOptions: { globals: globals.node } },
);
```

`tools/package.json`:
```json
{ "name": "@pocketqa/tools", "version": "0.0.0", "private": true, "type": "module", "scripts": { "test": "vitest run" } }
```

`tools/vitest.config.mjs`:
```js
import { defineConfig } from 'vitest/config';
export default defineConfig({ test: { include: ['test/**/*.test.mjs'] } });
```

- [ ] **Step 2: Install dev dependencies**

Run:
```bash
pnpm add -D -w typescript @types/node eslint @eslint/js typescript-eslint globals
pnpm --filter @pocketqa/tools add -D vitest
```
Expected: `pnpm-lock.yaml` created; exit 0.

- [ ] **Step 3: Write the failing test** — `tools/test/check-secrets.test.mjs`. Secret-looking fixtures are assembled at runtime, so this file never contains a literal match.

```js
import { describe, expect, it } from 'vitest';
import { scanText } from '../secret-patterns.mjs';

const FAKE_ANTHROPIC = ['sk', 'ant', 'api03', 'A'.repeat(40)].join('-');
const FAKE_PEM_HEADER = ['-----BEGIN', 'PRIVATE KEY-----'].join(' ');
const FAKE_CRED_URL = ['http://user', 'hunter2hunter2@localhost:3300'].join(':');
const ids = (text, file = 'f') => scanText(text, file).map((f) => f.ruleId);

describe('scanText', () => {
  it('flags an Anthropic-style key', () => { expect(ids(`KEY=${FAKE_ANTHROPIC}`)).toContain('anthropic-key'); });
  it('flags a PEM private key block', () => { expect(ids(`${FAKE_PEM_HEADER}\nabc`)).toContain('private-key-block'); });
  it('flags credentials embedded in a URL', () => { expect(ids(FAKE_CRED_URL)).toContain('basic-auth-url'); });
  it('flags a 64-byte Solana keypair array', () => {
    expect(ids(`[${Array.from({ length: 64 }, (_, i) => i).join(',')}]`)).toContain('solana-keypair-array');
  });
  it('flags a filled secret assignment', () => {
    expect(ids(['PLAYBACK_TOKEN_SECRET', 'abcdefabcdefabcdefabcdefabcdef12'].join('='))).toContain('env-secret-assignment');
  });
  it('allows empty, documented, and shell-substituted assignments', () => {
    const text = ['PLAYBACK_TOKEN_SECRET=', 'ANTHROPIC_API_KEY=<set in .env.local>', 'GH_TOKEN="$(security find-generic-password -w)"'].join('\n');
    expect(scanText(text, '.env.example')).toEqual([]);
  });
  it('reports 1-based line numbers and never the matched value', () => {
    const [finding] = scanText(`ok\n${FAKE_PEM_HEADER}`, 'k.pem');
    expect(finding).toEqual({ fileName: 'k.pem', ruleId: 'private-key-block', line: 2 });
  });
});
```

- [ ] **Step 4: Run test to verify it fails**

Run: `pnpm --filter @pocketqa/tools test`
Expected: FAIL — `Failed to load url ../secret-patterns.mjs` (module does not exist).

- [ ] **Step 5: Implement** — `tools/secret-patterns.mjs`:

```js
// Material that must never be committed (CLAUDE.md:13). Rules stay specific: a noisy scanner gets bypassed.
export const SECRET_RULES = [
  { id: 'anthropic-key', re: /sk-ant-[A-Za-z0-9_-]{20,}/g },
  { id: 'openai-key', re: /\bsk-(?:proj-)?[A-Za-z0-9_-]{32,}/g },
  { id: 'github-token', re: /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{36,}\b|\bgithub_pat_[A-Za-z0-9_]{50,}/g },
  { id: 'private-key-block', re: /-----BEGIN [A-Z ]*PRIVATE KEY-----/g },
  { id: 'aws-access-key', re: /\bAKIA[0-9A-Z]{16}\b/g },
  { id: 'solana-keypair-array', re: /\[\s*(?:\d{1,3}\s*,\s*){63}\d{1,3}\s*\]/g },
  { id: 'basic-auth-url', re: /\bhttps?:\/\/[^\s/:@'"`]+:[^\s/@'"`]+@/g },
  // Filled assignments only; empty values, <documented placeholders> and $(shell substitution) are allowed.
  { id: 'env-secret-assignment', re: /^[A-Z0-9_]*(?:SECRET|TOKEN|PASSWORD|API_KEY)=(?!\s*$)(?!<)(?!["']?\$).+$/gm },
];

export function scanText(text, fileName) {
  const findings = [];
  for (const rule of SECRET_RULES) {
    for (const match of text.matchAll(rule.re)) {
      findings.push({ fileName, ruleId: rule.id, line: text.slice(0, match.index).split('\n').length });
    }
  }
  return findings.sort((a, b) => a.line - b.line);
}
```

`tools/check-secrets.mjs` (prints file, line and rule — never the matched text, so the check cannot leak what it finds):
```js
#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { readFileSync, statSync } from 'node:fs';
import { scanText } from './secret-patterns.mjs';

const MAX_BYTES = 2 * 1024 * 1024;
const files = execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', '-z'], { encoding: 'utf8' })
  .split('\0')
  .filter(Boolean);
let count = 0;
for (const file of files) {
  let buf;
  try {
    if (statSync(file).size > MAX_BYTES) continue;
    buf = readFileSync(file);
  } catch {
    continue;
  }
  if (buf.includes(0)) continue; // binary file
  for (const f of scanText(buf.toString('utf8'), file)) {
    count += 1;
    console.error(`${f.fileName}:${f.line} ${f.ruleId}`);
  }
}
console.log(`check-secrets: ${count} findings`);
process.exit(count === 0 ? 0 : 1);
```

- [ ] **Step 6: Run tests and the scanner**

Run: `pnpm --filter @pocketqa/tools test && pnpm check:secrets`
Expected: `7 passed`; `check-secrets: 0 findings`; exit 0. Record.

- [ ] **Step 7: Commit** — files: all files listed above + `pnpm-lock.yaml`. Message `chore(core): bootstrap pnpm workspace and secret scanner`.

### Task T0.2: Toolchain preflight

**Owner:** core · **Branch:** `feat/core-foundations`

**Files:**
- Create: `tools/version.mjs`, `tools/preflight.mjs`
- Test: `tools/test/version.test.mjs`

**Interfaces:**
- Produces: `parseSemver(text): [number, number, number] | null`, `satisfiesMin(found, min): boolean`, `parseJavaMajor(text): number | null`, `parseXcodeVersion(text): string | null`; `pnpm preflight` writes `artifacts/preflight/<timestamp>.json`.

- [ ] **Step 1: Write the failing test** — `tools/test/version.test.mjs`:

```js
import { describe, expect, it } from 'vitest';
import { parseJavaMajor, parseSemver, parseXcodeVersion, satisfiesMin } from '../version.mjs';

describe('version parsing', () => {
  it('parses semver from tool output', () => {
    expect(parseSemver('v22.13.1')).toEqual([22, 13, 1]);
    expect(parseSemver('10.4')).toEqual([10, 4, 0]);
    expect(parseSemver('no version')).toBeNull();
  });
  it('compares against minimums', () => {
    expect(satisfiesMin([22, 13, 0], [22, 13, 0])).toBe(true);
    expect(satisfiesMin([22, 12, 9], [22, 13, 0])).toBe(false);
    expect(satisfiesMin([23, 0, 0], [22, 13, 0])).toBe(true);
  });
  it('reads the JDK major version, including legacy 1.x numbering', () => {
    expect(parseJavaMajor('openjdk version "17.0.12" 2024-07-16')).toBe(17);
    expect(parseJavaMajor('java version "1.8.0_402"')).toBe(8);
    expect(parseJavaMajor('openjdk version "25" 2025-09-16')).toBe(25);
  });
  it('reads the Xcode version or null for command-line tools only', () => {
    expect(parseXcodeVersion('Xcode 26.4\nBuild version 17E100')).toBe('26.4');
    expect(parseXcodeVersion('xcode-select: error: tool xcodebuild requires Xcode')).toBeNull();
  });
});
```

- [ ] **Step 2: Run to verify failure** — `pnpm --filter @pocketqa/tools test` → FAIL: cannot load `../version.mjs`.

- [ ] **Step 3: Implement** — `tools/version.mjs`:

```js
export function parseSemver(text) {
  const m = /(\d+)\.(\d+)(?:\.(\d+))?/.exec(text);
  return m ? [Number(m[1]), Number(m[2]), Number(m[3] ?? 0)] : null;
}
export function satisfiesMin(found, min) {
  for (let i = 0; i < 3; i += 1) {
    if (found[i] > min[i]) return true;
    if (found[i] < min[i]) return false;
  }
  return true;
}
export function parseJavaMajor(text) {
  const m = /version "(\d+)(?:\.(\d+))?/.exec(text);
  if (!m) return null;
  const major = Number(m[1]);
  return major === 1 ? Number(m[2]) : major;
}
export function parseXcodeVersion(text) {
  const m = /^Xcode (\d+(?:\.\d+)*)/m.exec(text);
  return m ? m[1] : null;
}
```

`tools/preflight.mjs`:
```js
#!/usr/bin/env node
// Reports the local toolchain. Only Node and pnpm are hard requirements for JS work; everything else is
// reported with its consequence so no later step silently assumes a tool exists (A2.4 V4, V12).
import { spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { parseJavaMajor, parseSemver, parseXcodeVersion, satisfiesMin } from './version.mjs';

const run = (cmd, args) => {
  const r = spawnSync(cmd, args, { encoding: 'utf8' });
  return r.error ? null : `${r.stdout ?? ''}${r.stderr ?? ''}`.trim();
};
const node = parseSemver(process.version);
const report = {
  node: { found: process.version, ok: node !== null && satisfiesMin(node, [22, 13, 0]), required: '>=22.13.0 (Expo SDK 57)' },
  pnpm: { found: run('pnpm', ['--version']), ok: run('pnpm', ['--version']) !== null },
  java: { found: run('java', ['-version']), major: parseJavaMajor(run('java', ['-version']) ?? ''), note: 'Must match the RN 0.86 Android build requirement (V4); confirm in T3.1 Step 6' },
  adb: { found: run('adb', ['version'])?.split('\n')[0] ?? null },
  avds: { found: run('emulator', ['-list-avds']) },
  maestro: { found: run('maestro', ['--version']) },
  ffmpeg: { found: run('ffmpeg', ['-version'])?.split('\n')[0] ?? null },
  xcode: { found: parseXcodeVersion(run('xcodebuild', ['-version']) ?? ''), note: 'iOS builds only if >= 26.4 (S16); otherwise iOS device testing is "not performed"' },
  claude: { found: run('claude', ['--version']), note: 'CLAUDE_CODE_SUBAGENT_MODEL_FORCE needs >= 2.1.257 (S22)' },
};
mkdirSync('artifacts/preflight', { recursive: true });
const file = `artifacts/preflight/${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
writeFileSync(file, JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
console.log(`preflight report: ${file}`);
process.exit(report.node.ok && report.pnpm.ok ? 0 : 1);
```

- [ ] **Step 4: Run tests and the preflight**

Run: `pnpm --filter @pocketqa/tools test && pnpm preflight`
Expected: `11 passed` in total for the tools package; the preflight prints JSON and exits 0 when Node ≥ 22.13 and pnpm are present. Record the JSON path, `java.major`, `xcode.found`, and `claude.found` in your status file. Whoever owns V4 and V12 reads them from there.

- [ ] **Step 5: Commit** — `tools/version.mjs tools/preflight.mjs tools/test/version.test.mjs`, message `chore(core): add toolchain preflight report`.

### Spike S0: Capture feasibility on a real Android 14+ device (THROWAWAY — Gate S0)

**Owner:** native · **Branch:** `spike/capture-probe` (never merged; only the report is merged, by the lead) · **Requires:** a physical Android 14+ phone (Q1), ideally a Seeker, with an MWA wallet set to devnet. **Emulators cannot answer this spike.** Without a device, the S0 report states "BLOCKED — no device", and Gate S0 stays red. Builders may then not be promised any wallet-screen capture.

**Questions the spike must answer** (the report gives one verdict line per question, with evidence):

| ID | Question | GO condition |
|---|---|---|
| S0-Q1 | Does the OS consent dialog appear once per session, and what are its exact labels (single app / entire screen / start)? (V7) | Dialog appears; labels recorded |
| S0-Q2 | With **single app**, is the app under test captured, and are notifications or other apps excluded? | Yes |
| S0-Q3 | With **entire screen**, is an MWA wallet approval screen captured, or black (FLAG_SECURE)? Test the Seed Vault Wallet if present, Phantom (devnet), and fakewallet (V6) | Reported either way; builder copy follows the result |
| S0-Q4 | Do three consecutive `VirtualDisplay.setSurface()` rotations yield three playable MP4s? What is the gap (ms)? | 3 playable files, no crash |
| S0-Q5 | Do status-bar chip stop and screen lock fire `onStop()`, and does the current segment stay playable? | Yes |
| S0-Q6 | Does mic narration work with FGS type `mediaProjection|microphone` when `RECORD_AUDIO` is granted, and does denial fall back to video only? | Yes |
| S0-Q7 | Do notification actions work while the app under test is in the foreground? | Yes |
| S0-Q8 | MB per minute at 720p / 2.5 Mbps | Recorded |

GO = S0-Q1, Q2, Q4, Q5, Q6 pass. If Q4 fails, use the ADR-06 fallback: one consent per task, with explicit UX copy. If Q3 shows black or excluded wallet screens, builders' study wizard copy states: "Wallet approval screens may not appear in recordings."

- [ ] **Step 1: Create the probe app** — Android Studio → New Project → "Empty Views Activity", Kotlin, package `ai.optijara.pocketqa.spike`, minimum SDK 29, location `spikes/capture-probe`. Record the Android Gradle Plugin and JDK versions Android Studio selected (input to V4).

- [ ] **Step 2: Manifest** — in `spikes/capture-probe/app/src/main/AndroidManifest.xml`, add inside `<manifest>`:
```xml
<uses-permission android:name="android.permission.FOREGROUND_SERVICE" />
<uses-permission android:name="android.permission.FOREGROUND_SERVICE_MEDIA_PROJECTION" />
<uses-permission android:name="android.permission.FOREGROUND_SERVICE_MICROPHONE" />
<uses-permission android:name="android.permission.RECORD_AUDIO" />
<uses-permission android:name="android.permission.POST_NOTIFICATIONS" />
```
and inside `<application>`:
```xml
<service android:name=".ProbeService" android:exported="false" android:foregroundServiceType="mediaProjection|microphone" />
```

- [ ] **Step 3: Probe service** — `spikes/capture-probe/app/src/main/java/ai/optijara/pocketqa/spike/ProbeService.kt`:

```kotlin
package ai.optijara.pocketqa.spike

import android.Manifest
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Intent
import android.content.pm.PackageManager
import android.content.pm.ServiceInfo
import android.hardware.display.DisplayManager
import android.hardware.display.VirtualDisplay
import android.media.MediaRecorder
import android.media.projection.MediaProjection
import android.media.projection.MediaProjectionManager
import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import androidx.core.app.NotificationCompat
import androidx.core.app.ServiceCompat
import androidx.core.content.IntentCompat
import java.io.File
import java.security.MessageDigest

class ProbeService : android.app.Service() {
  companion object {
    const val START = "start"; const val NEXT = "next"; const val STOP = "stop"
    var log: (String) -> Unit = {}
  }
  private var projection: MediaProjection? = null
  private var display: VirtualDisplay? = null
  private var recorder: MediaRecorder? = null
  private var file: File? = null
  private var mic = false
  private var segment = 0
  private var startedAt = 0L

  override fun onBind(intent: Intent?) = null

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    when (intent?.action) { START -> start(intent); NEXT -> rotate(); STOP -> stopAll("user") }
    return START_NOT_STICKY
  }

  private fun start(intent: Intent) {
    val nm = getSystemService(NotificationManager::class.java)
    nm.createNotificationChannel(NotificationChannel("spike", "Spike recording", NotificationManager.IMPORTANCE_LOW))
    mic = checkSelfPermission(Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED
    val types = ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PROJECTION or (if (mic) ServiceInfo.FOREGROUND_SERVICE_TYPE_MICROPHONE else 0)
    val next = PendingIntent.getService(this, 1, Intent(this, ProbeService::class.java).setAction(NEXT), PendingIntent.FLAG_IMMUTABLE)
    val stop = PendingIntent.getService(this, 2, Intent(this, ProbeService::class.java).setAction(STOP), PendingIntent.FLAG_IMMUTABLE)
    val n = NotificationCompat.Builder(this, "spike").setSmallIcon(android.R.drawable.presence_video_online)
      .setContentTitle("Spike recording").setOngoing(true)
      .addAction(0, "Next", next).addAction(0, "Stop", stop).build()
    ServiceCompat.startForeground(this, 1, n, types)
    val data = IntentCompat.getParcelableExtra(intent, "data", Intent::class.java) ?: return log("missing consent data")
    val mp = getSystemService(MediaProjectionManager::class.java).getMediaProjection(intent.getIntExtra("code", 0), data)
    mp.registerCallback(object : MediaProjection.Callback() {
      override fun onStop() { log("onStop() fired (chip, lock, or revoke)"); stopAll("system") }
    }, Handler(Looper.getMainLooper()))
    projection = mp
    val r = newRecorder()
    display = mp.createVirtualDisplay("spike", 720, 1280, resources.displayMetrics.densityDpi,
      DisplayManager.VIRTUAL_DISPLAY_FLAG_AUTO_MIRROR, r.surface, null, null)
    r.start(); recorder = r; startedAt = SystemClock.elapsedRealtime(); log("segment $segment started, mic=$mic")
  }

  private fun rotate() {
    val d = display ?: return
    val t0 = SystemClock.elapsedRealtime()
    d.surface = null
    finishCurrent()
    val r = newRecorder()
    d.surface = r.surface
    r.start(); recorder = r; startedAt = SystemClock.elapsedRealtime()
    log("rotated to segment $segment, gap=${SystemClock.elapsedRealtime() - t0}ms")
  }

  private fun finishCurrent() {
    val r = recorder ?: return; val f = file ?: return
    recorder = null
    try { r.stop() } catch (e: RuntimeException) { log("stop() threw: ${e.message}") }
    r.release()
    val digest = MessageDigest.getInstance("SHA-256").digest(f.readBytes()).joinToString("") { "%02x".format(it) }
    log("finished ${f.name} ${f.length()} bytes ${SystemClock.elapsedRealtime() - startedAt}ms sha256=$digest")
  }

  private fun stopAll(reason: String) {
    display?.surface = null
    finishCurrent()
    display?.release(); display = null
    projection?.stop(); projection = null
    ServiceCompat.stopForeground(this, ServiceCompat.STOP_FOREGROUND_REMOVE)
    stopSelf(); log("session ended: $reason")
  }

  private fun newRecorder(): MediaRecorder {
    segment += 1
    val f = File(getExternalFilesDir("segments"), "segment-$segment.mp4"); file = f
    return MediaRecorder(this).apply {
      if (mic) setAudioSource(MediaRecorder.AudioSource.MIC)
      setVideoSource(MediaRecorder.VideoSource.SURFACE)
      setOutputFormat(MediaRecorder.OutputFormat.MPEG_4)
      setVideoEncoder(MediaRecorder.VideoEncoder.H264)
      if (mic) setAudioEncoder(MediaRecorder.AudioEncoder.AAC)
      setVideoSize(720, 1280); setVideoFrameRate(30); setVideoEncodingBitRate(2_500_000)
      setOutputFile(f.absolutePath); prepare()
    }
  }
}
```

- [ ] **Step 4: Probe activity** — replace `MainActivity.kt`:

```kotlin
package ai.optijara.pocketqa.spike

import android.Manifest
import android.content.Intent
import android.media.projection.MediaProjectionManager
import android.os.Bundle
import android.util.Log
import android.widget.Button
import android.widget.LinearLayout
import android.widget.TextView
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AppCompatActivity
import androidx.core.content.ContextCompat

class MainActivity : AppCompatActivity() {
  private lateinit var out: TextView
  private val consent = registerForActivityResult(ActivityResultContracts.StartActivityForResult()) { result ->
    if (result.resultCode == RESULT_OK && result.data != null) {
      ContextCompat.startForegroundService(this, Intent(this, ProbeService::class.java)
        .setAction(ProbeService.START).putExtra("code", result.resultCode).putExtra("data", result.data))
      log("consent granted")
    } else log("consent denied")
  }

  override fun onCreate(savedInstanceState: Bundle?) {
    super.onCreate(savedInstanceState)
    requestPermissions(arrayOf(Manifest.permission.POST_NOTIFICATIONS, Manifest.permission.RECORD_AUDIO), 1)
    out = TextView(this)
    val col = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL; setPadding(48, 120, 48, 48) }
    fun button(label: String, onClick: () -> Unit) = col.addView(Button(this).apply { text = label; setOnClickListener { onClick() } })
    button("Start (Android consent dialog)") {
      consent.launch(getSystemService(MediaProjectionManager::class.java).createScreenCaptureIntent())
    }
    button("Next segment") { startService(Intent(this, ProbeService::class.java).setAction(ProbeService.NEXT)) }
    button("Stop") { startService(Intent(this, ProbeService::class.java).setAction(ProbeService.STOP)) }
    col.addView(out); setContentView(col)
    ProbeService.log = { msg -> runOnUiThread { log(msg) } }
  }

  private fun log(msg: String) { out.append("$msg\n"); Log.i("PocketQASpike", msg) }
}
```

- [ ] **Step 5: Build, install, run the protocol**

Run: `cd spikes/capture-probe && ./gradlew :app:installDebug && adb logcat -s PocketQASpike`
Expected: the app installs on the connected device (`adb devices` lists it).

Protocol, run once with **single app** and once with **entire screen**:
1. Start, and pick the option in the Android dialog.
2. Open the app under test or a wallet.
3. Trigger an MWA sign request from a devnet dApp (e.g. any Wallet UI sample) and approve it.
4. Tap **Next** from the notification twice.
5. Stop from the status-bar chip (Android 15 QPR1+) or lock the screen.
6. Repeat with the microphone permission denied.

Pull the files with `adb pull /sdcard/Android/data/ai.optijara.pocketqa.spike/files/segments artifacts/device/S0-$(date +%Y%m%d%H%M%S)/`. Play each file on the Mac and note what is visible. Save screenshots of the consent dialog.

- [ ] **Step 6: Write the report** — `/Users/hamzadiaz/Projects/pocket-qa-worktrees/_shared/evidence/S0-capture-feasibility.md` containing:
- Device model, Android version, and security patch.
- Wallet apps and versions.
- One verdict line per S0-Q1…Q8 with artifact paths.
- The exact dialog labels (V7).
- GO/NO-GO and the ADR-06 consequence.

The lead commits it as `docs/spikes/S0-capture-feasibility.md` in the FC-0 docs commit. The probe code stays on `spike/capture-probe` and is never merged (throwaway).

---

## Phase 1 — Contracts, domain, wallet-auth (FC-1)

### Task T1.1: Contracts — error codes and enums

**Owner:** core · **Branch:** `feat/core-foundations`

**Files:**
- Create: `packages/contracts/package.json`, `packages/contracts/tsconfig.json`, `packages/contracts/vitest.config.ts`, `packages/contracts/src/errors.ts`, `packages/contracts/src/enums.ts`, `packages/contracts/src/index.ts`
- Test: `packages/contracts/test/errors-enums.test.ts`

**Interfaces:** Produces the `errors.ts` and `enums.ts` names in §B1.

- [ ] **Step 0: Package setup and Zod version check**

`packages/contracts/package.json`:
```json
{
  "name": "@pocketqa/contracts",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "main": "src/index.ts",
  "types": "src/index.ts",
  "scripts": { "test": "vitest run", "typecheck": "tsc --noEmit -p tsconfig.json" }
}
```
`packages/contracts/tsconfig.json`: `{ "extends": "../../tsconfig.base.json", "include": ["src", "test"] }`
`packages/contracts/vitest.config.ts`:
```ts
import { defineConfig } from 'vitest/config';
export default defineConfig({ test: { include: ['test/**/*.test.ts'] } });
```
Run:
```bash
pnpm --filter @pocketqa/contracts add zod
pnpm --filter @pocketqa/contracts add -D vitest typescript
node -p "require('./node_modules/zod/package.json').version"
```
Expected: a `4.x.y` version. If it prints `3.x`, stop and write to `_shared/inbox/lead.md` (Global Constraint: Zod v4 API).

- [ ] **Step 1: Write the failing test** — `packages/contracts/test/errors-enums.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { ApiErrorBodySchema, ERROR_HTTP_STATUS, ErrorCode } from '../src/errors';
import { ConsentScopeSchema, LedgerKindSchema, ParticipationStatusSchema, SOLANA_DEVNET_CHAIN } from '../src/enums';

describe('error codes', () => {
  it('maps every code to an HTTP error status', () => {
    for (const code of Object.values(ErrorCode)) {
      expect(ERROR_HTTP_STATUS[code]).toBeGreaterThanOrEqual(400);
      expect(ERROR_HTTP_STATUS[code]).toBeLessThan(600);
    }
  });
  it('parses a well-formed error body and rejects unknown codes', () => {
    expect(ApiErrorBodySchema.parse({ error: { code: 'NOT_FOUND', message: 'x', requestId: 'r' } }).error.code).toBe('NOT_FOUND');
    expect(ApiErrorBodySchema.safeParse({ error: { code: 'TEAPOT', message: 'x', requestId: 'r' } }).success).toBe(false);
  });
});

describe('enums', () => {
  it('pins the only supported chain', () => { expect(SOLANA_DEVNET_CHAIN).toBe('solana:devnet'); });
  it('lists the participation lifecycle', () => {
    expect(ParticipationStatusSchema.options).toEqual(['claimed', 'consented', 'in_progress', 'submitted', 'approved', 'rejected', 'withdrawn', 'expired', 'disputed']);
  });
  it('lists consent scopes', () => { expect(ConsentScopeSchema.options).toEqual(['screen_recording', 'microphone', 'ai_processing']); });
  it('lists ledger kinds', () => { expect(LedgerKindSchema.options).toEqual(['fund_test', 'reserve', 'release', 'reward_approved']); });
});
```

- [ ] **Step 2: Run to verify failure** — `pnpm --filter @pocketqa/contracts test` → FAIL: cannot resolve `../src/errors`.

- [ ] **Step 3: Implement**

`packages/contracts/src/errors.ts`:
```ts
import { z } from 'zod';

export const ErrorCode = {
  VALIDATION_FAILED: 'VALIDATION_FAILED',
  UNAUTHENTICATED: 'UNAUTHENTICATED',
  FORBIDDEN: 'FORBIDDEN',
  NOT_FOUND: 'NOT_FOUND',
  CONFLICT: 'CONFLICT',
  INVALID_TRANSITION: 'INVALID_TRANSITION',
  BUDGET_EXHAUSTED: 'BUDGET_EXHAUSTED',
  PAYLOAD_TOO_LARGE: 'PAYLOAD_TOO_LARGE',
  UNSUPPORTED_MEDIA_TYPE: 'UNSUPPORTED_MEDIA_TYPE',
  INTEGRITY_MISMATCH: 'INTEGRITY_MISMATCH',
  RATE_LIMITED: 'RATE_LIMITED',
  NONCE_INVALID: 'NONCE_INVALID',
  SIGNATURE_INVALID: 'SIGNATURE_INVALID',
  WRONG_NETWORK: 'WRONG_NETWORK',
  WALLET_ALREADY_LINKED: 'WALLET_ALREADY_LINKED',
  WALLET_NOT_LINKED: 'WALLET_NOT_LINKED',
  AI_PROVIDER_UNAVAILABLE: 'AI_PROVIDER_UNAVAILABLE',
  AI_CONSENT_MISSING: 'AI_CONSENT_MISSING',
  CHAIN_UNAVAILABLE: 'CHAIN_UNAVAILABLE',
  INTERNAL: 'INTERNAL',
} as const;
export type ErrorCode = (typeof ErrorCode)[keyof typeof ErrorCode];

export const ERROR_HTTP_STATUS: Record<ErrorCode, number> = {
  VALIDATION_FAILED: 400, UNAUTHENTICATED: 401, FORBIDDEN: 403, NOT_FOUND: 404, CONFLICT: 409,
  INVALID_TRANSITION: 409, BUDGET_EXHAUSTED: 409, PAYLOAD_TOO_LARGE: 413, UNSUPPORTED_MEDIA_TYPE: 415,
  INTEGRITY_MISMATCH: 422, RATE_LIMITED: 429, NONCE_INVALID: 401, SIGNATURE_INVALID: 401,
  WRONG_NETWORK: 400, WALLET_ALREADY_LINKED: 409, WALLET_NOT_LINKED: 409,
  AI_PROVIDER_UNAVAILABLE: 503, AI_CONSENT_MISSING: 409, CHAIN_UNAVAILABLE: 503, INTERNAL: 500,
};

const CODES = Object.values(ErrorCode) as [ErrorCode, ...ErrorCode[]];
export const ApiErrorBodySchema = z.object({
  error: z.object({ code: z.enum(CODES), message: z.string(), requestId: z.string() }),
});
export type ApiErrorBody = z.infer<typeof ApiErrorBodySchema>;
```

`packages/contracts/src/enums.ts`:
```ts
import { z } from 'zod';

export const SOLANA_DEVNET_CHAIN = 'solana:devnet' as const;

export const RoleSchema = z.enum(['tester', 'builder', 'admin']);
export const StudyStatusSchema = z.enum(['draft', 'published', 'paused', 'closed']);
export const ParticipationStatusSchema = z.enum(['claimed', 'consented', 'in_progress', 'submitted', 'approved', 'rejected', 'withdrawn', 'expired', 'disputed']);
export const ConsentScopeSchema = z.enum(['screen_recording', 'microphone', 'ai_processing']);
export const EvidenceKindSchema = z.enum(['screen_recording', 'screenshot']);
export const EvidenceStatusSchema = z.enum(['pending_upload', 'uploaded', 'removed', 'purged']);
export const CaptureSourceSchema = z.enum(['android_media_projection', 'ios_import', 'web_import']);
export const TaskOutcomeSchema = z.enum(['completed', 'blocked', 'gave_up']);
export const FindingSeveritySchema = z.enum(['critical', 'major', 'minor', 'info']);
export const CompensationStatusSchema = z.enum(['approved_unpaid', 'transfer_pending', 'transfer_confirmed', 'transfer_failed']);
export const DevnetTransferStatusSchema = z.enum(['submitted', 'confirmed', 'failed', 'expired']);
export const DisputeStatusSchema = z.enum(['open', 'resolved_upheld', 'resolved_overturned']);
export const DataRequestKindSchema = z.enum(['export', 'deletion']);
export const DataRequestStatusSchema = z.enum(['requested', 'completed', 'rejected']);
export const ClientPlatformSchema = z.enum(['android', 'ios', 'web']);
export const LedgerKindSchema = z.enum(['fund_test', 'reserve', 'release', 'reward_approved']);

export type Role = z.infer<typeof RoleSchema>;
export type StudyStatus = z.infer<typeof StudyStatusSchema>;
export type ParticipationStatus = z.infer<typeof ParticipationStatusSchema>;
export type ConsentScope = z.infer<typeof ConsentScopeSchema>;
export type EvidenceKind = z.infer<typeof EvidenceKindSchema>;
export type EvidenceStatus = z.infer<typeof EvidenceStatusSchema>;
export type CaptureSource = z.infer<typeof CaptureSourceSchema>;
export type TaskOutcome = z.infer<typeof TaskOutcomeSchema>;
export type FindingSeverity = z.infer<typeof FindingSeveritySchema>;
export type CompensationStatus = z.infer<typeof CompensationStatusSchema>;
export type DevnetTransferStatus = z.infer<typeof DevnetTransferStatusSchema>;
export type DisputeStatus = z.infer<typeof DisputeStatusSchema>;
export type DataRequestKind = z.infer<typeof DataRequestKindSchema>;
export type DataRequestStatus = z.infer<typeof DataRequestStatusSchema>;
export type ClientPlatform = z.infer<typeof ClientPlatformSchema>;
export type LedgerKind = z.infer<typeof LedgerKindSchema>;
```

`packages/contracts/src/index.ts`:
```ts
export * from './errors';
export * from './enums';
```

- [ ] **Step 4: Run** — `pnpm --filter @pocketqa/contracts test && pnpm --filter @pocketqa/contracts typecheck` → `6 passed`, typecheck exit 0.
- [ ] **Step 5: Commit** — `packages/contracts`, `pnpm-lock.yaml`; message `feat(contracts): error codes and enums`.

### Task T1.2: Contracts — request and response schemas

**Owner:** core · **Branch:** `feat/core-foundations`

**Files:**
- Create: `packages/contracts/src/schemas.ts`
- Modify: `packages/contracts/src/index.ts` (add `export * from './schemas';`)
- Test: `packages/contracts/test/schemas.test.ts`

**Interfaces:**
- Consumes: T1.1 enums.
- Produces: every `*Schema` below plus its inferred type.

- [ ] **Step 1: Write the failing test** — `packages/contracts/test/schemas.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import {
  ConsentVersionInputSchema, DecisionInputSchema, DevnetSubmitInputSchema, RegisterRequestSchema,
  StudyDraftInputSchema, StudyTasksInputSchema, WalletVerifyInputSchema,
} from '../src/schemas';

const okRegister = { email: 'a@example.test', password: 'correct horse battery', role: 'tester', displayName: 'A', adultAttested: true };

describe('schemas', () => {
  it('requires adult attestation and a 12+ character password at registration', () => {
    expect(RegisterRequestSchema.safeParse(okRegister).success).toBe(true);
    expect(RegisterRequestSchema.safeParse({ ...okRegister, adultAttested: false }).success).toBe(false);
    expect(RegisterRequestSchema.safeParse({ ...okRegister, password: 'short' }).success).toBe(false);
    expect(RegisterRequestSchema.safeParse({ ...okRegister, role: 'admin' }).success).toBe(false);
  });
  it('accepts only http(s) app links', () => {
    const base = { title: 'Onboarding test', appName: 'App', goal: 'Find onboarding friction', rewardCredits: 100, slotsTotal: 5, aiProcessingEnabled: false };
    expect(StudyDraftInputSchema.safeParse({ ...base, appLink: 'https://play.google.com/x' }).success).toBe(true);
    expect(StudyDraftInputSchema.safeParse({ ...base, appLink: 'javascript:alert(1)' }).success).toBe(false);
  });
  it('allows 1 to 10 tasks', () => {
    const task = { title: 'Sign up', instructions: 'Create an account with the test email', maxMinutes: 5 };
    expect(StudyTasksInputSchema.safeParse({ tasks: [] }).success).toBe(false);
    expect(StudyTasksInputSchema.safeParse({ tasks: Array(10).fill(task) }).success).toBe(true);
    expect(StudyTasksInputSchema.safeParse({ tasks: Array(11).fill(task) }).success).toBe(false);
  });
  it('requires the screen_recording scope in consent', () => {
    const text = 'x'.repeat(60);
    expect(ConsentVersionInputSchema.safeParse({ textMd: text, scopes: ['microphone'] }).success).toBe(false);
    expect(ConsentVersionInputSchema.safeParse({ textMd: text, scopes: ['screen_recording'] }).success).toBe(true);
  });
  it('requires a 10+ character reason to reject, none to approve', () => {
    expect(DecisionInputSchema.safeParse({ decision: 'approve' }).success).toBe(true);
    expect(DecisionInputSchema.safeParse({ decision: 'reject', reason: 'too short' }).success).toBe(false);
    expect(DecisionInputSchema.safeParse({ decision: 'reject', reason: 'Task 2 was not attempted' }).success).toBe(true);
  });
  it('validates wallet and devnet wire formats', () => {
    expect(WalletVerifyInputSchema.safeParse({ nonce: 'abc', address: 'x', signedMessageB64: '!!', signatureB64: '!!' }).success).toBe(false);
    expect(DevnetSubmitInputSchema.safeParse({ signature: '5'.repeat(88) }).success).toBe(true);
    expect(DevnetSubmitInputSchema.safeParse({ signature: '0'.repeat(88) }).success).toBe(false); // '0' is not base58
  });
});
```

- [ ] **Step 2: Run to verify failure** — `pnpm --filter @pocketqa/contracts test` → FAIL: cannot resolve `../src/schemas`.

- [ ] **Step 3: Implement** — `packages/contracts/src/schemas.ts`:

```ts
import { z } from 'zod';
import {
  CaptureSourceSchema, ClientPlatformSchema, CompensationStatusSchema, ConsentScopeSchema, DataRequestKindSchema,
  DataRequestStatusSchema, DevnetTransferStatusSchema, DisputeStatusSchema, EvidenceKindSchema, EvidenceStatusSchema,
  FindingSeveritySchema, ParticipationStatusSchema, RoleSchema, SOLANA_DEVNET_CHAIN, StudyStatusSchema, TaskOutcomeSchema,
} from './enums';

const Id = z.uuid();
const IsoDate = z.iso.datetime();
const DecimalU64 = z.string().regex(/^\d{1,20}$/);
const Base64 = z.string().regex(/^[A-Za-z0-9+/]+={0,2}$/);
const Base58 = (min: number, max: number) => z.string().regex(new RegExp(`^[1-9A-HJ-NP-Za-km-z]{${min},${max}}$`));
const Sha256Hex = z.string().regex(/^[a-f0-9]{64}$/);
const HttpUrl = z.url().refine((u) => /^https?:\/\//i.test(u), 'Must be an http(s) link');

export const RegisterRequestSchema = z.object({
  email: z.email().max(254),
  password: z.string().min(12).max(200),
  role: z.enum(['tester', 'builder']), // admins are created only by the CLI (ADR-04)
  displayName: z.string().trim().min(1).max(60),
  adultAttested: z.literal(true),
});
export const LoginRequestSchema = z.object({ email: z.email(), password: z.string().min(1).max(200) });
export const UserDtoSchema = z.object({ id: Id, email: z.string(), role: RoleSchema, displayName: z.string().nullable(), status: z.enum(['active', 'suspended', 'deleted']) });
export const AuthResponseSchema = z.object({ user: UserDtoSchema, token: z.string(), expiresAt: IsoDate });

export const DeviceProfileInputSchema = z.object({
  platform: ClientPlatformSchema,
  osVersion: z.string().max(40),
  androidApi: z.number().int().min(1).max(100).nullable(),
  iosMajor: z.number().int().min(1).max(100).nullable(),
  model: z.string().max(80).nullable(),
  manufacturer: z.string().max(80).nullable(),
  selfReportedSeeker: z.boolean(),
  modelHintSeeker: z.boolean(), // Platform.constants.Model hint — spoofable, never grants anything (S9)
});

export const StudyDraftInputSchema = z.object({
  title: z.string().trim().min(4).max(80),
  appName: z.string().trim().min(1).max(60),
  appLink: HttpUrl,
  goal: z.string().trim().min(10).max(1000),
  rewardCredits: z.number().int().min(1).max(100_000),
  slotsTotal: z.number().int().min(1).max(100),
  aiProcessingEnabled: z.boolean(),
});
export const StudyTaskInputSchema = z.object({
  title: z.string().trim().min(3).max(80),
  instructions: z.string().trim().min(10).max(2000),
  maxMinutes: z.number().int().min(1).max(15),
});
export const StudyTasksInputSchema = z.object({ tasks: z.array(StudyTaskInputSchema).min(1).max(10) });
export const DeviceCriteriaInputSchema = z.object({
  platforms: z.array(z.enum(['android', 'ios'])).min(1),
  minAndroidApi: z.number().int().min(29).max(100).nullable(),
  minIosMajor: z.number().int().min(16).max(100).nullable(),
  requireSelfReportedSeeker: z.boolean(),
});
// textMd is the builder's study-specific addition; the server prepends PLATFORM_CONSENT_PREAMBLE (T1.7).
export const ConsentVersionInputSchema = z
  .object({ textMd: z.string().trim().min(50).max(5000), scopes: z.array(ConsentScopeSchema).min(1) })
  .refine((v) => v.scopes.includes('screen_recording'), { message: 'screen_recording scope is required', path: ['scopes'] });
export const FundStudyInputSchema = z.object({ credits: z.number().int().min(1).max(1_000_000) });
export const BudgetSummarySchema = z.object({ funded: z.number().int(), reservedOpen: z.number().int(), approved: z.number().int(), available: z.number().int() });
export const StudySummaryDtoSchema = z.object({
  id: Id, title: z.string(), appName: z.string(), status: StudyStatusSchema, rewardCredits: z.number().int(),
  slotsTotal: z.number().int(), slotsTaken: z.number().int(), budget: BudgetSummarySchema,
});
export const EligibilitySchema = z.object({ eligible: z.boolean(), reasons: z.array(z.string()) });
export const StudyTaskDtoSchema = z.object({ id: Id, position: z.number().int(), title: z.string(), instructions: z.string(), maxMinutes: z.number().int() });
export const ConsentVersionDtoSchema = z.object({ id: Id, version: z.number().int(), textMd: z.string(), scopes: z.array(ConsentScopeSchema) });
export const TesterStudyDtoSchema = z.object({
  id: Id, title: z.string(), appName: z.string(), appLink: z.string(), goal: z.string(), status: StudyStatusSchema,
  rewardCredits: z.number().int(), estimatedMinutes: z.number().int(), slotsOpen: z.number().int(),
  aiProcessingEnabled: z.boolean(), criteria: DeviceCriteriaInputSchema, tasks: z.array(StudyTaskDtoSchema),
  consent: ConsentVersionDtoSchema.nullable(), eligibility: EligibilitySchema,
});

export const ParticipationDtoSchema = z.object({
  id: Id, studyId: Id, studyTitle: z.string(), status: ParticipationStatusSchema, scopes: z.array(ConsentScopeSchema),
  decisionReason: z.string().nullable(), claimedAt: IsoDate, submittedAt: IsoDate.nullable(), decidedAt: IsoDate.nullable(),
  disputeOpened: z.boolean(),
});
export const ConsentGrantInputSchema = z.object({ consentVersionId: Id, scopes: z.array(ConsentScopeSchema).min(1) });
export const CreateEvidenceInputSchema = z.object({
  kind: EvidenceKindSchema, taskId: Id.nullable(), mime: z.enum(['video/mp4', 'image/png', 'image/jpeg']),
  sizeBytes: z.number().int().min(1), sha256: Sha256Hex.nullable(), durationMs: z.number().int().min(0).nullable(),
  captureSource: CaptureSourceSchema,
});
export const CreateEvidenceResponseSchema = z.object({ evidenceId: Id, uploadPath: z.string() });
export const EvidenceDtoSchema = z.object({
  id: Id, participationId: Id, taskId: Id.nullable(), kind: EvidenceKindSchema, status: EvidenceStatusSchema, mime: z.string(),
  sizeBytes: z.number().int(), sha256: Sha256Hex.nullable(), durationMs: z.number().int().nullable(),
  captureSource: CaptureSourceSchema, duplicateOfOtherParticipant: z.boolean(),
});
export const TaskResultsInputSchema = z.object({
  results: z.array(z.object({ taskId: Id, outcome: TaskOutcomeSchema, difficulty: z.number().int().min(1).max(5), note: z.string().max(2000) })).min(1).max(10),
});
export const DecisionInputSchema = z.discriminatedUnion('decision', [
  z.object({ decision: z.literal('approve'), reason: z.string().trim().max(1000).optional() }),
  z.object({ decision: z.literal('reject'), reason: z.string().trim().min(10).max(1000) }),
]);
export const FindingInputSchema = z.object({
  title: z.string().trim().min(4).max(120), severity: FindingSeveritySchema, evidenceItemId: Id.nullable(),
  timestampMs: z.number().int().min(0).nullable(), description: z.string().trim().min(10).max(4000),
});
export const FindingDtoSchema = FindingInputSchema.extend({ id: Id, source: z.enum(['human', 'ai_accepted']), createdAt: IsoDate });
export const DisputeInputSchema = z.object({ reason: z.string().trim().min(20).max(2000) });
export const ResolveDisputeInputSchema = z.object({ outcome: z.enum(['uphold', 'overturn']), reason: z.string().trim().min(10).max(2000) });
export const DisputeDtoSchema = z.object({ id: Id, participationId: Id, status: DisputeStatusSchema, reason: z.string(), resolutionReason: z.string().nullable(), createdAt: IsoDate });
export const ModerationInputSchema = z.object({
  targetType: z.enum(['user', 'study']), targetId: Id, action: z.enum(['suspend', 'unsuspend', 'close_study']), reason: z.string().trim().min(10).max(2000),
});
export const DataRequestInputSchema = z.object({ kind: DataRequestKindSchema });
export const DataRequestDtoSchema = z.object({ id: Id, kind: DataRequestKindSchema, status: DataRequestStatusSchema, createdAt: IsoDate, completedAt: IsoDate.nullable() });

export const SignInInputWireSchema = z.object({
  domain: z.string(), statement: z.string(), uri: z.string(), version: z.literal('1'), chainId: z.literal(SOLANA_DEVNET_CHAIN),
  nonce: z.string().regex(/^[a-zA-Z0-9]{8,}$/), issuedAt: IsoDate, expirationTime: IsoDate,
});
export const WalletNonceResponseSchema = z.object({ signInInput: SignInInputWireSchema });
export const WalletVerifyInputSchema = z.object({
  nonce: z.string().regex(/^[a-zA-Z0-9]{8,}$/), address: Base58(32, 44), signedMessageB64: Base64.max(4096), signatureB64: Base64.max(200),
});
export const WalletLinkDtoSchema = z.object({ address: z.string(), chain: z.literal(SOLANA_DEVNET_CHAIN), linkedAt: IsoDate });
export const DevnetPrepareResponseSchema = z.object({ from: z.string(), to: z.string(), lamports: DecimalU64, memo: z.string(), cluster: z.literal('devnet') });
export const DevnetSubmitInputSchema = z.object({ signature: Base58(64, 90) });
export const TransferStatusDtoSchema = z.object({
  id: Id, compensationId: Id, signature: z.string(), status: DevnetTransferStatusSchema, failureReason: z.string().nullable(), explorerUrl: z.string(),
});
export const CompensationDtoSchema = z.object({
  id: Id, participationId: Id, studyTitle: z.string(), credits: z.number().int(), status: CompensationStatusSchema, transfers: z.array(TransferStatusDtoSchema),
});
export const PlaybackTokenResponseSchema = z.object({ url: z.string(), expiresAt: IsoDate });
export const HealthDtoSchema = z.object({ ok: z.literal(true), cluster: z.literal('devnet'), chainGuard: z.enum(['ok', 'unverified']), aiProvider: z.string() });
export const AiFindingSuggestionSchema = z.object({ title: z.string().min(4).max(120), severity: FindingSeveritySchema, rationale: z.string().min(10).max(2000), taskIds: z.array(Id) });
export const AiSuggestionDtoSchema = z.object({
  id: Id, status: z.enum(['suggested', 'accepted', 'dismissed']), provider: z.string(), model: z.string(),
  findings: z.array(AiFindingSuggestionSchema), label: z.literal('AI suggestion · verify against the recording'),
});

export type RegisterRequest = z.infer<typeof RegisterRequestSchema>;
export type LoginRequest = z.infer<typeof LoginRequestSchema>;
export type UserDto = z.infer<typeof UserDtoSchema>;
export type AuthResponse = z.infer<typeof AuthResponseSchema>;
export type DeviceProfileInput = z.infer<typeof DeviceProfileInputSchema>;
export type StudyDraftInput = z.infer<typeof StudyDraftInputSchema>;
export type StudyTaskInput = z.infer<typeof StudyTaskInputSchema>;
export type DeviceCriteriaInput = z.infer<typeof DeviceCriteriaInputSchema>;
export type ConsentVersionInput = z.infer<typeof ConsentVersionInputSchema>;
export type BudgetSummaryDto = z.infer<typeof BudgetSummarySchema>;
export type StudySummaryDto = z.infer<typeof StudySummaryDtoSchema>;
export type TesterStudyDto = z.infer<typeof TesterStudyDtoSchema>;
export type ParticipationDto = z.infer<typeof ParticipationDtoSchema>;
export type CreateEvidenceInput = z.infer<typeof CreateEvidenceInputSchema>;
export type EvidenceDto = z.infer<typeof EvidenceDtoSchema>;
export type TaskResultsInput = z.infer<typeof TaskResultsInputSchema>;
export type DecisionInput = z.infer<typeof DecisionInputSchema>;
export type FindingInput = z.infer<typeof FindingInputSchema>;
export type FindingDto = z.infer<typeof FindingDtoSchema>;
export type DisputeDto = z.infer<typeof DisputeDtoSchema>;
export type DataRequestDto = z.infer<typeof DataRequestDtoSchema>;
export type SignInInputWire = z.infer<typeof SignInInputWireSchema>;
export type WalletVerifyInput = z.infer<typeof WalletVerifyInputSchema>;
export type WalletLinkDto = z.infer<typeof WalletLinkDtoSchema>;
export type DevnetPrepareResponse = z.infer<typeof DevnetPrepareResponseSchema>;
export type TransferStatusDto = z.infer<typeof TransferStatusDtoSchema>;
export type CompensationDto = z.infer<typeof CompensationDtoSchema>;
export type AiSuggestionDto = z.infer<typeof AiSuggestionDtoSchema>;
```

Add to `packages/contracts/src/index.ts`: `export * from './schemas';`

- [ ] **Step 4: Run** — `pnpm --filter @pocketqa/contracts test && pnpm --filter @pocketqa/contracts typecheck` → `12 passed`; typecheck exit 0.
- [ ] **Step 5: Commit** — `packages/contracts/src/schemas.ts packages/contracts/src/index.ts packages/contracts/test/schemas.test.ts`; message `feat(contracts): request and response schemas`.

### Task T1.3: Domain — participation state machine

**Owner:** core

**Files:**
- Create: `packages/domain/package.json`, `packages/domain/tsconfig.json`, `packages/domain/vitest.config.ts`, `packages/domain/src/errors.ts`, `packages/domain/src/participation.ts`, `packages/domain/src/index.ts`
- Test: `packages/domain/test/participation.test.ts`

**Interfaces:**
- Consumes: `ParticipationStatus`, `ErrorCode` (T1.1).
- Produces: `DomainError`, `transitionParticipation`, `releasesReservation`, `MIN_REASON_LENGTH`, `type ParticipationEvent`.

- [ ] **Step 0: Package setup** — `package.json` matches T1.1's but uses `"name": "@pocketqa/domain"`; `tsconfig.json` and `vitest.config.ts` are identical to T1.1's. Run:
```bash
pnpm --filter @pocketqa/domain add @pocketqa/contracts@workspace:*
pnpm --filter @pocketqa/domain add -D vitest typescript
```

- [ ] **Step 1: Write the failing test** — `packages/domain/test/participation.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { DomainError } from '../src/errors';
import { releasesReservation, transitionParticipation } from '../src/participation';

const submit = { type: 'SUBMIT', uploadedEvidenceCount: 1, tasksTotal: 2, taskResultsCount: 2 } as const;
const code = (fn: () => unknown) => { try { fn(); } catch (e) { return (e as DomainError).code; } return 'NO_ERROR'; };

describe('transitionParticipation', () => {
  it('walks the happy path', () => {
    let s = transitionParticipation('claimed', { type: 'CONSENT', scopes: ['screen_recording'] });
    s = transitionParticipation(s, { type: 'START' });
    s = transitionParticipation(s, submit);
    expect(transitionParticipation(s, { type: 'APPROVE' })).toBe('approved');
  });
  it('requires screen recording consent', () => {
    expect(code(() => transitionParticipation('claimed', { type: 'CONSENT', scopes: ['microphone'] }))).toBe('VALIDATION_FAILED');
  });
  it('refuses to submit without uploaded evidence or with missing task results', () => {
    expect(code(() => transitionParticipation('in_progress', { ...submit, uploadedEvidenceCount: 0 }))).toBe('VALIDATION_FAILED');
    expect(code(() => transitionParticipation('in_progress', { ...submit, taskResultsCount: 1 }))).toBe('VALIDATION_FAILED');
  });
  it('requires a rejection reason of at least 10 characters', () => {
    expect(code(() => transitionParticipation('submitted', { type: 'REJECT', reason: 'too short' }))).toBe('VALIDATION_FAILED');
    expect(transitionParticipation('submitted', { type: 'REJECT', reason: 'Task 2 was skipped entirely' })).toBe('rejected');
  });
  it('rejects invalid transitions', () => {
    expect(code(() => transitionParticipation('claimed', { type: 'APPROVE' }))).toBe('INVALID_TRANSITION');
    expect(code(() => transitionParticipation('submitted', { type: 'WITHDRAW' }))).toBe('INVALID_TRANSITION');
    expect(code(() => transitionParticipation('approved', { type: 'REJECT', reason: 'changed my mind!!' }))).toBe('INVALID_TRANSITION');
  });
  it('allows exactly one dispute, inside the window', () => {
    const open = { type: 'OPEN_DISPUTE', priorDisputes: 0, daysSinceDecision: 2, disputeWindowDays: 7 } as const;
    expect(transitionParticipation('rejected', open)).toBe('disputed');
    expect(code(() => transitionParticipation('rejected', { ...open, priorDisputes: 1 }))).toBe('CONFLICT');
    expect(code(() => transitionParticipation('rejected', { ...open, daysSinceDecision: 8 }))).toBe('INVALID_TRANSITION');
  });
  it('resolves disputes to approved (overturn) or rejected (uphold)', () => {
    expect(transitionParticipation('disputed', { type: 'RESOLVE_DISPUTE', outcome: 'overturn' })).toBe('approved');
    expect(transitionParticipation('disputed', { type: 'RESOLVE_DISPUTE', outcome: 'uphold' })).toBe('rejected');
  });
  it('withdraws or expires only active participations', () => {
    for (const from of ['claimed', 'consented', 'in_progress'] as const) {
      expect(transitionParticipation(from, { type: 'WITHDRAW' })).toBe('withdrawn');
      expect(transitionParticipation(from, { type: 'EXPIRE' })).toBe('expired');
    }
  });
  it('knows which outcomes release the budget reservation immediately', () => {
    expect(releasesReservation('withdrawn')).toBe(true);
    expect(releasesReservation('expired')).toBe(true);
    expect(releasesReservation('rejected')).toBe(false); // held through the dispute window
    expect(releasesReservation('rejected', true)).toBe(true); // dispute upheld
    expect(releasesReservation('approved')).toBe(false);
  });
});
```

- [ ] **Step 2: Run to verify failure** — `pnpm --filter @pocketqa/domain test` → FAIL: cannot resolve `../src/errors`.

- [ ] **Step 3: Implement**

`packages/domain/src/errors.ts`:
```ts
import type { ErrorCode } from '@pocketqa/contracts';

export class DomainError extends Error {
  constructor(public readonly code: ErrorCode, message: string) {
    super(message);
    this.name = 'DomainError';
  }
}
```

`packages/domain/src/participation.ts`:
```ts
import type { ParticipationStatus } from '@pocketqa/contracts';
import { DomainError } from './errors';

export const MIN_REASON_LENGTH = 10;

export type ParticipationEvent =
  | { type: 'CONSENT'; scopes: readonly string[] }
  | { type: 'START' }
  | { type: 'SUBMIT'; uploadedEvidenceCount: number; tasksTotal: number; taskResultsCount: number }
  | { type: 'APPROVE' }
  | { type: 'REJECT'; reason: string }
  | { type: 'WITHDRAW' }
  | { type: 'EXPIRE' }
  | { type: 'OPEN_DISPUTE'; priorDisputes: number; daysSinceDecision: number; disputeWindowDays: number }
  | { type: 'RESOLVE_DISPUTE'; outcome: 'uphold' | 'overturn' };

const ACTIVE: ReadonlySet<ParticipationStatus> = new Set(['claimed', 'consented', 'in_progress']);

export function transitionParticipation(from: ParticipationStatus, event: ParticipationEvent): ParticipationStatus {
  const invalid = () => new DomainError('INVALID_TRANSITION', `Cannot ${event.type.toLowerCase()} a ${from} participation`);
  switch (event.type) {
    case 'CONSENT':
      if (from !== 'claimed') throw invalid();
      if (!event.scopes.includes('screen_recording')) throw new DomainError('VALIDATION_FAILED', 'Screen recording consent is required to take part');
      return 'consented';
    case 'START':
      if (from !== 'consented') throw invalid();
      return 'in_progress';
    case 'SUBMIT':
      if (from !== 'in_progress') throw invalid();
      if (event.uploadedEvidenceCount < 1) throw new DomainError('VALIDATION_FAILED', 'Upload at least one recording before submitting');
      if (event.taskResultsCount !== event.tasksTotal) throw new DomainError('VALIDATION_FAILED', 'Add a result for every task before submitting');
      return 'submitted';
    case 'APPROVE':
      if (from !== 'submitted') throw invalid();
      return 'approved';
    case 'REJECT':
      if (from !== 'submitted') throw invalid();
      if (event.reason.trim().length < MIN_REASON_LENGTH) {
        throw new DomainError('VALIDATION_FAILED', `A rejection reason must be at least ${MIN_REASON_LENGTH} characters`);
      }
      return 'rejected';
    case 'WITHDRAW':
      if (!ACTIVE.has(from)) throw invalid();
      return 'withdrawn';
    case 'EXPIRE':
      if (!ACTIVE.has(from)) throw invalid();
      return 'expired';
    case 'OPEN_DISPUTE':
      if (from !== 'rejected') throw invalid();
      if (event.priorDisputes > 0) throw new DomainError('CONFLICT', 'A dispute was already opened for this submission');
      if (event.daysSinceDecision > event.disputeWindowDays) throw new DomainError('INVALID_TRANSITION', 'The dispute window has closed');
      return 'disputed';
    case 'RESOLVE_DISPUTE':
      if (from !== 'disputed') throw invalid();
      return event.outcome === 'overturn' ? 'approved' : 'rejected';
  }
}

/**
 * Budget reservations are released when a slot can no longer turn into an approval.
 * A plain rejection keeps the reservation through the dispute window so an overturn
 * can still pay the tester (research: pay good-faith participants, codex:478).
 */
export function releasesReservation(to: ParticipationStatus, viaDisputeUphold = false): boolean {
  return to === 'withdrawn' || to === 'expired' || (to === 'rejected' && viaDisputeUphold);
}
```

`packages/domain/src/index.ts`:
```ts
export * from './errors';
export * from './participation';
```

- [ ] **Step 4: Run** — `pnpm --filter @pocketqa/domain test` → `9 passed`.
- [ ] **Step 5: Commit** — `packages/domain`, `pnpm-lock.yaml`; message `feat(domain): participation state machine`.

### Task T1.4: Domain — study lifecycle and publish preconditions

**Owner:** core

**Files:**
- Create: `packages/domain/src/study.ts`
- Modify: `packages/domain/src/index.ts` (add `export * from './study';`)
- Test: `packages/domain/test/study.test.ts`

**Interfaces:** Produces `transitionStudy(from: StudyStatus, event: StudyEvent): StudyStatus`, `assertPublishable(i: PublishCheckInput): void`, `MAX_TASKS`, `type StudyEvent`.

- [ ] **Step 1: Write the failing test** — `packages/domain/test/study.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { DomainError } from '../src/errors';
import { assertPublishable, transitionStudy } from '../src/study';

const ready = { taskCount: 3, hasCriteria: true, hasConsentVersion: true, availableCredits: 500, rewardCredits: 100 };

describe('study lifecycle', () => {
  it('publishes, pauses, resumes and closes', () => {
    expect(transitionStudy('draft', 'PUBLISH')).toBe('published');
    expect(transitionStudy('published', 'PAUSE')).toBe('paused');
    expect(transitionStudy('paused', 'RESUME')).toBe('published');
    expect(transitionStudy('paused', 'CLOSE')).toBe('closed');
  });
  it('never reopens a closed study', () => {
    expect(() => transitionStudy('closed', 'PUBLISH')).toThrowError(DomainError);
  });
  it('lists every missing precondition when publishing', () => {
    try {
      assertPublishable({ taskCount: 0, hasCriteria: false, hasConsentVersion: false, availableCredits: 0, rewardCredits: 100 });
      expect.unreachable();
    } catch (e) {
      expect((e as DomainError).code).toBe('VALIDATION_FAILED');
      expect((e as DomainError).message).toBe('Add between 1 and 10 tasks; Set device criteria; Write the consent text; Fund the study with enough test credits for at least one reward');
    }
  });
  it('accepts a ready study and rejects more than 10 tasks', () => {
    expect(() => assertPublishable(ready)).not.toThrow();
    expect(() => assertPublishable({ ...ready, taskCount: 11 })).toThrowError('Add between 1 and 10 tasks');
  });
});
```

- [ ] **Step 2: Run to verify failure** — `pnpm --filter @pocketqa/domain test` → FAIL: cannot resolve `../src/study`.

- [ ] **Step 3: Implement** — `packages/domain/src/study.ts`:

```ts
import type { StudyStatus } from '@pocketqa/contracts';
import { DomainError } from './errors';

export const MAX_TASKS = 10;
export type StudyEvent = 'PUBLISH' | 'PAUSE' | 'RESUME' | 'CLOSE';

const TABLE: Record<StudyStatus, Partial<Record<StudyEvent, StudyStatus>>> = {
  draft: { PUBLISH: 'published', CLOSE: 'closed' },
  published: { PAUSE: 'paused', CLOSE: 'closed' },
  paused: { RESUME: 'published', CLOSE: 'closed' },
  closed: {},
};

export function transitionStudy(from: StudyStatus, event: StudyEvent): StudyStatus {
  const to = TABLE[from][event];
  if (!to) throw new DomainError('INVALID_TRANSITION', `Cannot ${event.toLowerCase()} a ${from} study`);
  return to;
}

export interface PublishCheckInput {
  taskCount: number;
  hasCriteria: boolean;
  hasConsentVersion: boolean;
  availableCredits: number;
  rewardCredits: number;
}

export function assertPublishable(i: PublishCheckInput): void {
  const problems: string[] = [];
  if (i.taskCount < 1 || i.taskCount > MAX_TASKS) problems.push(`Add between 1 and ${MAX_TASKS} tasks`);
  if (!i.hasCriteria) problems.push('Set device criteria');
  if (!i.hasConsentVersion) problems.push('Write the consent text');
  if (i.availableCredits < i.rewardCredits) problems.push('Fund the study with enough test credits for at least one reward');
  if (problems.length > 0) throw new DomainError('VALIDATION_FAILED', problems.join('; '));
}
```

- [ ] **Step 4: Run** — `pnpm --filter @pocketqa/domain test` → `13 passed`.
- [ ] **Step 5: Commit** — `packages/domain/src/study.ts packages/domain/src/index.ts packages/domain/test/study.test.ts`; message `feat(domain): study lifecycle and publish checks`.

### Task T1.5: Domain — test-credit budget ledger

**Owner:** core

**Files:**
- Create: `packages/domain/src/budget.ts`
- Modify: `packages/domain/src/index.ts` (add `export * from './budget';`)
- Test: `packages/domain/test/budget.test.ts`

**Interfaces:** Produces `interface LedgerEntry { kind: LedgerKind; amount: number }`, `interface BudgetSummary { funded; reservedOpen; approved; available }`, `computeBudget(entries)`, `assertCanReserve(summary, reward)`.

- [ ] **Step 1: Write the failing test** — `packages/domain/test/budget.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { assertCanReserve, computeBudget } from '../src/budget';

describe('computeBudget', () => {
  it('tracks funding, reservations, approvals and releases', () => {
    const s = computeBudget([
      { kind: 'fund_test', amount: 1000 },
      { kind: 'reserve', amount: 100 },
      { kind: 'reserve', amount: 100 },
      { kind: 'reward_approved', amount: 100 },
      { kind: 'release', amount: 100 },
    ]);
    expect(s).toEqual({ funded: 1000, approved: 100, reservedOpen: 0, available: 900 });
  });
  it('rejects non-positive or fractional amounts', () => {
    expect(() => computeBudget([{ kind: 'fund_test', amount: 0 }])).toThrowError('Ledger amounts must be positive integers');
    expect(() => computeBudget([{ kind: 'fund_test', amount: 1.5 }])).toThrowError('Ledger amounts must be positive integers');
  });
  it('detects a ledger that would describe negative money', () => {
    expect(() => computeBudget([{ kind: 'reserve', amount: 100 }])).toThrowError('Ledger invariant violated');
  });
});

describe('assertCanReserve', () => {
  it('blocks a claim when the remaining budget is below one reward', () => {
    const s = computeBudget([{ kind: 'fund_test', amount: 150 }, { kind: 'reserve', amount: 100 }]);
    expect(() => assertCanReserve(s, 100)).toThrowError('This study has no budget left for another participant');
    expect(() => assertCanReserve(s, 50)).not.toThrow();
  });
});
```

- [ ] **Step 2: Run to verify failure** — `pnpm --filter @pocketqa/domain test` → FAIL: cannot resolve `../src/budget`.

- [ ] **Step 3: Implement** — `packages/domain/src/budget.ts`:

```ts
import type { LedgerKind } from '@pocketqa/contracts';
import { DomainError } from './errors';

export interface LedgerEntry { kind: LedgerKind; amount: number }
export interface BudgetSummary { funded: number; reservedOpen: number; approved: number; available: number }

/** Test credits only — no cash value (ADR-08). The ledger is append-only; balances are always derived. */
export function computeBudget(entries: readonly LedgerEntry[]): BudgetSummary {
  let funded = 0;
  let reserved = 0;
  let released = 0;
  let approved = 0;
  for (const e of entries) {
    if (!Number.isInteger(e.amount) || e.amount <= 0) throw new DomainError('INTERNAL', 'Ledger amounts must be positive integers');
    if (e.kind === 'fund_test') funded += e.amount;
    else if (e.kind === 'reserve') reserved += e.amount;
    else if (e.kind === 'release') released += e.amount;
    else approved += e.amount;
  }
  const summary = { funded, approved, reservedOpen: reserved - released - approved, available: funded - reserved + released };
  // A negative balance can only come from entries written out of order — fail loudly rather than show it.
  if (summary.reservedOpen < 0 || summary.available < 0) throw new DomainError('INTERNAL', 'Ledger invariant violated');
  return summary;
}

export function assertCanReserve(summary: BudgetSummary, reward: number): void {
  if (summary.available < reward) throw new DomainError('BUDGET_EXHAUSTED', 'This study has no budget left for another participant');
}
```

- [ ] **Step 4: Run** — `pnpm --filter @pocketqa/domain test` → `17 passed`.
- [ ] **Step 5: Commit** — `packages/domain/src/budget.ts packages/domain/src/index.ts packages/domain/test/budget.test.ts`; message `feat(domain): test-credit budget ledger`.

### Task T1.6: Domain — eligibility (self-reported Seeker, no attestation)

**Owner:** core

**Files:**
- Create: `packages/domain/src/eligibility.ts`
- Modify: `packages/domain/src/index.ts` (add `export * from './eligibility';`)
- Test: `packages/domain/test/eligibility.test.ts`

**Interfaces:** Produces `interface DeviceCriteria`, `interface DeviceProfile`, `evaluateEligibility(c, p | null): { eligible: boolean; reasons: string[] }`, `MIN_RECORDING_ANDROID_API = 29`.

- [ ] **Step 1: Write the failing test** — `packages/domain/test/eligibility.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { evaluateEligibility } from '../src/eligibility';

const criteria = { platforms: ['android'] as const, minAndroidApi: 34, minIosMajor: null, requireSelfReportedSeeker: true };
const seeker = { platform: 'android' as const, androidApi: 36, iosMajor: null, selfReportedSeeker: true };

describe('evaluateEligibility', () => {
  it('accepts a matching self-reported Seeker on a new enough Android', () => {
    expect(evaluateEligibility(criteria, seeker)).toEqual({ eligible: true, reasons: [] });
  });
  it('explains every mismatch', () => {
    expect(evaluateEligibility(criteria, { ...seeker, androidApi: 33, selfReportedSeeker: false }).reasons).toEqual([
      'Needs Android API 34 or newer',
      'Only for testers who report using a Seeker',
    ]);
  });
  it('never treats the web preview as a test device', () => {
    expect(evaluateEligibility(criteria, { platform: 'web', androidApi: null, iosMajor: null, selfReportedSeeker: true })).toEqual({
      eligible: false, reasons: ['Requires the Android or iOS app'],
    });
  });
  it('asks for a device profile first', () => {
    expect(evaluateEligibility(criteria, null).reasons).toEqual(['Add your device details in Settings first']);
  });
  it('requires Android 10+ for in-app recording even without a study minimum', () => {
    const open = { ...criteria, minAndroidApi: null, requireSelfReportedSeeker: false };
    expect(evaluateEligibility(open, { ...seeker, androidApi: 28 }).reasons).toEqual(['Recording needs Android 10 or newer']);
  });
  it('filters by platform', () => {
    const iosOnly = { platforms: ['ios'] as const, minAndroidApi: null, minIosMajor: 17, requireSelfReportedSeeker: false };
    expect(evaluateEligibility(iosOnly, seeker).reasons).toEqual(['Only for iOS']);
  });
});
```

- [ ] **Step 2: Run to verify failure** — FAIL: cannot resolve `../src/eligibility`.

- [ ] **Step 3: Implement** — `packages/domain/src/eligibility.ts`:

```ts
export const MIN_RECORDING_ANDROID_API = 29; // foreground service types for MediaProjection need Android 10+

export interface DeviceCriteria {
  platforms: readonly ('android' | 'ios')[];
  minAndroidApi: number | null;
  minIosMajor: number | null;
  requireSelfReportedSeeker: boolean;
}
export interface DeviceProfile {
  platform: 'android' | 'ios' | 'web';
  androidApi: number | null;
  iosMajor: number | null;
  selfReportedSeeker: boolean;
}

const LABEL = { android: 'Android', ios: 'iOS' } as const;

export function evaluateEligibility(c: DeviceCriteria, p: DeviceProfile | null): { eligible: boolean; reasons: string[] } {
  if (!p) return { eligible: false, reasons: ['Add your device details in Settings first'] };
  if (p.platform === 'web') return { eligible: false, reasons: ['Requires the Android or iOS app'] };
  const reasons: string[] = [];
  if (!c.platforms.includes(p.platform)) reasons.push(`Only for ${c.platforms.map((x) => LABEL[x]).join(' or ')}`);
  if (p.platform === 'android') {
    const api = p.androidApi ?? 0;
    if (c.minAndroidApi !== null && api < c.minAndroidApi) reasons.push(`Needs Android API ${c.minAndroidApi} or newer`);
    else if (api < MIN_RECORDING_ANDROID_API) reasons.push('Recording needs Android 10 or newer');
  }
  if (p.platform === 'ios' && c.minIosMajor !== null && (p.iosMajor ?? 0) < c.minIosMajor) reasons.push(`Needs iOS ${c.minIosMajor} or newer`);
  // Seeker ownership is self-reported; Pocket QA has no device attestation (CLAUDE.md:7, S9).
  if (c.requireSelfReportedSeeker && !p.selfReportedSeeker) reasons.push('Only for testers who report using a Seeker');
  return { eligible: reasons.length === 0, reasons };
}
```

- [ ] **Step 4: Run** — `pnpm --filter @pocketqa/domain test` → `23 passed`.
- [ ] **Step 5: Commit** — the three files; message `feat(domain): device eligibility with self-reported Seeker`.

### Task T1.7: Domain — consent validation and platform preamble

**Owner:** core

**Files:**
- Create: `packages/domain/src/consent.ts`
- Modify: `packages/domain/src/index.ts` (add `export * from './consent';`)
- Test: `packages/domain/test/consent.test.ts`

**Interfaces:** Produces `PLATFORM_CONSENT_PREAMBLE: string`, `composeConsentText(builderText): string`, `validateConsentGrant(i: { offered; granted; studyAiEnabled; consentVersionId; currentConsentVersionId }): ConsentScope[]`.

- [ ] **Step 1: Write the failing test** — `packages/domain/test/consent.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { composeConsentText, PLATFORM_CONSENT_PREAMBLE, validateConsentGrant } from '../src/consent';

const base = { offered: ['screen_recording', 'microphone', 'ai_processing'] as const, studyAiEnabled: true, consentVersionId: 'v2', currentConsentVersionId: 'v2' };

describe('consent', () => {
  it('always starts consent text with the non-editable platform preamble', () => {
    expect(composeConsentText('Study-specific details here.')).toBe(`${PLATFORM_CONSENT_PREAMBLE}\n\nStudy-specific details here.`);
    expect(PLATFORM_CONSENT_PREAMBLE).toContain('only after you tap Start');
    expect(PLATFORM_CONSENT_PREAMBLE).toContain('remove any you do not want to share');
    expect(PLATFORM_CONSENT_PREAMBLE).toContain('Rewards are not guaranteed');
  });
  it('requires screen recording and deduplicates scopes', () => {
    expect(validateConsentGrant({ ...base, granted: ['microphone', 'screen_recording', 'microphone'] })).toEqual(['microphone', 'screen_recording']);
    expect(() => validateConsentGrant({ ...base, granted: ['microphone'] })).toThrowError('Screen recording consent is required to take part');
  });
  it('refuses a stale consent version', () => {
    expect(() => validateConsentGrant({ ...base, granted: ['screen_recording'], consentVersionId: 'v1' })).toThrowError('The consent text changed. Please read the current version.');
  });
  it('refuses scopes the study did not offer', () => {
    expect(() => validateConsentGrant({ ...base, offered: ['screen_recording'], granted: ['screen_recording', 'microphone'] })).toThrowError("Scope microphone is not part of this study's consent");
  });
  it('refuses AI processing when the study does not use AI', () => {
    expect(() => validateConsentGrant({ ...base, studyAiEnabled: false, granted: ['screen_recording', 'ai_processing'] })).toThrowError('This study does not use AI processing');
  });
});
```

- [ ] **Step 2: Run to verify failure** — FAIL: cannot resolve `../src/consent`.

- [ ] **Step 3: Implement** — `packages/domain/src/consent.ts`:

```ts
import type { ConsentScope } from '@pocketqa/contracts';
import { DomainError } from './errors';

/** Mandatory clauses (spec A12.2). Builders add study-specific text after it; they cannot edit or remove it. */
export const PLATFORM_CONSENT_PREAMBLE =
  'Pocket QA records your screen only after you tap Start and Android asks for permission. ' +
  'A notification shows while recording. You can stop at any time. Before uploading you can watch every segment ' +
  'and remove any you do not want to share. Recordings are visible only to you, the study\'s builder, and Pocket QA ' +
  'admins, and are deleted 30 days after a decision. Rewards are not guaranteed and are paid only after a reviewer ' +
  'approves your submission.';

export function composeConsentText(builderText: string): string {
  return `${PLATFORM_CONSENT_PREAMBLE}\n\n${builderText.trim()}`;
}

export function validateConsentGrant(i: {
  offered: readonly ConsentScope[];
  granted: readonly ConsentScope[];
  studyAiEnabled: boolean;
  consentVersionId: string;
  currentConsentVersionId: string;
}): ConsentScope[] {
  if (i.consentVersionId !== i.currentConsentVersionId) throw new DomainError('CONFLICT', 'The consent text changed. Please read the current version.');
  const granted = [...new Set(i.granted)].sort();
  if (!granted.includes('screen_recording')) throw new DomainError('VALIDATION_FAILED', 'Screen recording consent is required to take part');
  for (const scope of granted) {
    if (!i.offered.includes(scope)) throw new DomainError('VALIDATION_FAILED', `Scope ${scope} is not part of this study's consent`);
  }
  if (granted.includes('ai_processing') && !i.studyAiEnabled) throw new DomainError('VALIDATION_FAILED', 'This study does not use AI processing');
  return granted;
}
```

- [ ] **Step 4: Run** — `pnpm --filter @pocketqa/domain test` → `28 passed`.
- [ ] **Step 5: Commit** — the three files; message `feat(domain): consent validation with platform preamble`.

### Task T1.8: Domain — media sniffing

**Owner:** core

**Files:**
- Create: `packages/domain/src/media.ts`
- Modify: `packages/domain/src/index.ts` (add `export * from './media';`)
- Test: `packages/domain/test/media.test.ts`

**Interfaces:** Produces `ALLOWED_MIME_TYPES`, `type AllowedMime`, `sniffMediaType(head: Uint8Array): AllowedMime | null`, `assertDeclaredMimeMatches(declared: string, sniffed: AllowedMime | null): AllowedMime`.

- [ ] **Step 1: Write the failing test** — `packages/domain/test/media.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { assertDeclaredMimeMatches, sniffMediaType } from '../src/media';

const bytes = (...b: number[]) => new Uint8Array(b);
const MP4 = bytes(0, 0, 0, 0x20, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d);
const PNG = bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0);
const JPEG = bytes(0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0, 0, 0, 0, 0);

describe('sniffMediaType', () => {
  it('recognizes MP4, PNG and JPEG by magic bytes', () => {
    expect(sniffMediaType(MP4)).toBe('video/mp4');
    expect(sniffMediaType(PNG)).toBe('image/png');
    expect(sniffMediaType(JPEG)).toBe('image/jpeg');
  });
  it('returns null for anything else, including a truncated header', () => {
    expect(sniffMediaType(new TextEncoder().encode('<html><body>'))).toBeNull();
    expect(sniffMediaType(bytes(0x89, 0x50))).toBeNull();
  });
});

describe('assertDeclaredMimeMatches', () => {
  it('refuses unknown content and mismatched declarations', () => {
    expect(() => assertDeclaredMimeMatches('video/mp4', null)).toThrowError('File is not a supported MP4, PNG, or JPEG');
    expect(() => assertDeclaredMimeMatches('video/mp4', 'image/png')).toThrowError('Declared video/mp4 but the file content is image/png');
    expect(assertDeclaredMimeMatches('image/png', 'image/png')).toBe('image/png');
  });
});
```

- [ ] **Step 2: Run to verify failure** — FAIL: cannot resolve `../src/media`.

- [ ] **Step 3: Implement** — `packages/domain/src/media.ts`:

```ts
import { DomainError } from './errors';

export const ALLOWED_MIME_TYPES = ['video/mp4', 'image/png', 'image/jpeg'] as const;
export type AllowedMime = (typeof ALLOWED_MIME_TYPES)[number];

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

/** Content is trusted only from its bytes, never from the client's declared type (A13 "tampering"). */
export function sniffMediaType(head: Uint8Array): AllowedMime | null {
  if (head.length >= 8 && PNG_SIGNATURE.every((b, i) => head[i] === b)) return 'image/png';
  if (head.length >= 3 && head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff) return 'image/jpeg';
  // ISO base media file: bytes 4..7 spell "ftyp".
  if (head.length >= 12 && head[4] === 0x66 && head[5] === 0x74 && head[6] === 0x79 && head[7] === 0x70) return 'video/mp4';
  return null;
}

export function assertDeclaredMimeMatches(declared: string, sniffed: AllowedMime | null): AllowedMime {
  if (!sniffed) throw new DomainError('UNSUPPORTED_MEDIA_TYPE', 'File is not a supported MP4, PNG, or JPEG');
  if (declared !== sniffed) throw new DomainError('UNSUPPORTED_MEDIA_TYPE', `Declared ${declared} but the file content is ${sniffed}`);
  return sniffed;
}
```

- [ ] **Step 4: Run** — `pnpm --filter @pocketqa/domain test` → `31 passed`.
- [ ] **Step 5: Commit** — the three files; message `feat(domain): media magic-byte sniffing`.

### Task T1.9: Domain — copy policy and seed-phrase heuristic

**Owner:** core

**Files:**
- Create: `packages/domain/src/copy-policy.ts`
- Modify: `packages/domain/src/index.ts` (add `export * from './copy-policy';`)
- Test: `packages/domain/test/copy-policy.test.ts`

**Interfaces:** Produces `findBannedCopy(text: string, audience: 'app' | 'builder'): string[]`, `SECRET_WARNING_ALLOWLIST`, `looksLikeSeedPhrase(text: string): boolean`.

- [ ] **Step 1: Write the failing test** — `packages/domain/test/copy-policy.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { findBannedCopy, looksLikeSeedPhrase } from '../src/copy-policy';

describe('findBannedCopy', () => {
  it('flags earnings promises for both audiences', () => {
    expect(findBannedCopy('Guaranteed earnings every week', 'builder')).toEqual(['guaranteed-earnings']);
    expect(findBannedCopy('Earn crypto by testing apps', 'app')).toEqual(['earn-money']);
    expect(findBannedCopy('Passive income from your phone', 'builder')).toEqual(['passive-income']);
    expect(findBannedCopy('Get paid instantly', 'app')).toEqual(['instant-pay']);
  });
  it('allows honest reward copy', () => {
    expect(findBannedCopy('Not guaranteed. Paid only after a reviewer approves your submission.', 'app')).toEqual([]);
    expect(findBannedCopy('Reward if approved: 120 test credits', 'app')).toEqual([]);
  });
  it('applies app-only rules to app copy but not to builder study text', () => {
    expect(findBannedCopy('Join the airdrop and start farming', 'app')).toEqual(['airdrop', 'farming']);
    expect(findBannedCopy('Test our farm management app', 'builder')).toEqual([]);
    expect(findBannedCopy('Switch to mainnet', 'app')).toEqual(['mainnet']);
  });
  it('allows secret-material words only in the never-ask warning', () => {
    expect(findBannedCopy('Pocket QA will never ask for your seed phrase or private key.', 'app')).toEqual([]);
    expect(findBannedCopy('Enter your seed phrase to continue', 'app')).toEqual(['secret-material']);
  });
});

describe('looksLikeSeedPhrase', () => {
  it('detects 12 or 24 lowercase words', () => {
    expect(looksLikeSeedPhrase('apple banana cherry delta eagle fabric garden hotel island jungle kettle lemon')).toBe(true);
    expect(looksLikeSeedPhrase(Array(24).fill('word').join(' '))).toBe(true);
  });
  it('ignores ordinary notes', () => {
    expect(looksLikeSeedPhrase('The sign up button did nothing on the second tap.')).toBe(false);
    expect(looksLikeSeedPhrase('one two three')).toBe(false);
  });
});
```

- [ ] **Step 2: Run to verify failure** — FAIL: cannot resolve `../src/copy-policy`.

- [ ] **Step 3: Implement** — `packages/domain/src/copy-policy.ts`:

```ts
type Audience = 'app' | 'builder';
interface Rule { id: string; pattern: RegExp; audiences: readonly Audience[] }

// R5/R6/R32: no earnings promises, no farming/airdrop framing, no secret-material requests.
// Builder text gets only the earnings rules: builders legitimately test farming apps or mention networks.
const RULES: readonly Rule[] = [
  { id: 'guaranteed-earnings', pattern: /\bguaranteed\s+(earnings|income|pay|payouts?|rewards?|money)\b/i, audiences: ['app', 'builder'] },
  { id: 'earn-money', pattern: /\bearn\s+(money|cash|crypto|sol|tokens?|skr)\b/i, audiences: ['app', 'builder'] },
  { id: 'passive-income', pattern: /\bpassive\s+income\b/i, audiences: ['app', 'builder'] },
  { id: 'instant-pay', pattern: /\b(get|be)\s+paid\s+(instantly|automatically|immediately)\b/i, audiences: ['app', 'builder'] },
  { id: 'airdrop', pattern: /\bairdrops?\b/i, audiences: ['app'] },
  { id: 'farming', pattern: /\bfarm(ing|ed)?\b/i, audiences: ['app'] },
  { id: 'mainnet', pattern: /\bmainnet\b/i, audiences: ['app'] },
  { id: 'secret-material', pattern: /\b(seed\s+phrase|private\s+key|recovery\s+phrase)\b/i, audiences: ['app', 'builder'] },
];

export const SECRET_WARNING_ALLOWLIST: ReadonlySet<string> = new Set([
  'Pocket QA will never ask for your seed phrase or private key.',
]);

export function findBannedCopy(text: string, audience: Audience): string[] {
  if (SECRET_WARNING_ALLOWLIST.has(text)) return [];
  return RULES.filter((r) => r.audiences.includes(audience) && r.pattern.test(text)).map((r) => r.id);
}

/** Heuristic for testers pasting a recovery phrase into notes: exactly 12 or 24 short lowercase words. */
export function looksLikeSeedPhrase(text: string): boolean {
  const words = text.trim().split(/\s+/);
  return (words.length === 12 || words.length === 24) && words.every((w) => /^[a-z]{3,8}$/.test(w));
}
```

- [ ] **Step 4: Run** — `pnpm --filter @pocketqa/domain test` → `37 passed`.
- [ ] **Step 5: Commit** — the three files; message `feat(domain): copy policy and seed phrase heuristic`.

### Task T1.10: Domain — compensation status machine

**Owner:** core

**Files:**
- Create: `packages/domain/src/compensation.ts`
- Modify: `packages/domain/src/index.ts` (add `export * from './compensation';`)
- Test: `packages/domain/test/compensation.test.ts`

**Interfaces:** Produces `type CompensationEvent = 'TRANSFER_SUBMITTED' | 'TRANSFER_CONFIRMED' | 'TRANSFER_FAILED' | 'TRANSFER_EXPIRED'`, `transitionCompensation(from, event)`.

- [ ] **Step 1: Write the failing test** — `packages/domain/test/compensation.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { transitionCompensation } from '../src/compensation';

describe('transitionCompensation', () => {
  it('moves through pending to confirmed', () => {
    expect(transitionCompensation('approved_unpaid', 'TRANSFER_SUBMITTED')).toBe('transfer_pending');
    expect(transitionCompensation('transfer_pending', 'TRANSFER_CONFIRMED')).toBe('transfer_confirmed');
  });
  it('maps failure and expiry to failed, and allows a retry', () => {
    expect(transitionCompensation('transfer_pending', 'TRANSFER_FAILED')).toBe('transfer_failed');
    expect(transitionCompensation('transfer_pending', 'TRANSFER_EXPIRED')).toBe('transfer_failed');
    expect(transitionCompensation('transfer_failed', 'TRANSFER_SUBMITTED')).toBe('transfer_pending');
  });
  it('never confirms without a pending transfer and never leaves confirmed', () => {
    expect(() => transitionCompensation('approved_unpaid', 'TRANSFER_CONFIRMED')).toThrowError('Cannot transfer confirmed from approved_unpaid');
    expect(() => transitionCompensation('transfer_confirmed', 'TRANSFER_SUBMITTED')).toThrowError('Cannot transfer submitted from transfer_confirmed');
  });
});
```

- [ ] **Step 2: Run to verify failure** — FAIL: cannot resolve `../src/compensation`.

- [ ] **Step 3: Implement** — `packages/domain/src/compensation.ts`:

```ts
import type { CompensationStatus } from '@pocketqa/contracts';
import { DomainError } from './errors';

export type CompensationEvent = 'TRANSFER_SUBMITTED' | 'TRANSFER_CONFIRMED' | 'TRANSFER_FAILED' | 'TRANSFER_EXPIRED';

const TABLE: Record<CompensationStatus, Partial<Record<CompensationEvent, CompensationStatus>>> = {
  approved_unpaid: { TRANSFER_SUBMITTED: 'transfer_pending' },
  transfer_pending: { TRANSFER_CONFIRMED: 'transfer_confirmed', TRANSFER_FAILED: 'transfer_failed', TRANSFER_EXPIRED: 'transfer_failed' },
  transfer_failed: { TRANSFER_SUBMITTED: 'transfer_pending' },
  transfer_confirmed: {},
};

export function transitionCompensation(from: CompensationStatus, event: CompensationEvent): CompensationStatus {
  const to = TABLE[from][event];
  if (!to) throw new DomainError('INVALID_TRANSITION', `Cannot ${event.toLowerCase().replace('_', ' ')} from ${from}`);
  return to;
}
```

- [ ] **Step 4: Run** — `pnpm --filter @pocketqa/domain test && pnpm --filter @pocketqa/domain typecheck` → `40 passed`; typecheck exit 0.
- [ ] **Step 5: Commit** — the three files; message `feat(domain): compensation status machine`.

### Task T1.11: Wallet-auth — SIWS input and nonce

**Owner:** core

**Files:**
- Create: `packages/wallet-auth/package.json`, `packages/wallet-auth/tsconfig.json`, `packages/wallet-auth/vitest.config.ts`, `packages/wallet-auth/src/siws.ts`, `packages/wallet-auth/src/index.ts`
- Test: `packages/wallet-auth/test/siws-input.test.ts`

**Interfaces:**
- Consumes: `SOLANA_DEVNET_CHAIN` (T1.1).
- Produces: `interface SiwsConfig { domain: string; uri: string; ttlSeconds: number }`, `interface IssuedSignInInput { domain; statement; uri; version: '1'; chainId: 'solana:devnet'; nonce; issuedAt; expirationTime }`, `LINK_STATEMENT`, `createNonce(random?)`, `buildSignInInput(cfg, now, nonce)`.

- [ ] **Step 0: Package setup** — `package.json` matches T1.1's but uses `"name": "@pocketqa/wallet-auth"`; `tsconfig.json` and `vitest.config.ts` are identical to T1.1's. Run:
```bash
pnpm --filter @pocketqa/wallet-auth add @pocketqa/contracts@workspace:* @pocketqa/domain@workspace:* bs58 @solana/wallet-standard-util @solana/wallet-standard-features
pnpm --filter @pocketqa/wallet-auth add -D vitest typescript @types/node
```

- [ ] **Step 1: Write the failing test** — `packages/wallet-auth/test/siws-input.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { buildSignInInput, createNonce, LINK_STATEMENT } from '../src/siws';

const cfg = { domain: 'pocketqa.invalid', uri: 'https://pocketqa.invalid', ttlSeconds: 300 };

describe('SIWS input', () => {
  it('creates 32-character alphanumeric nonces (SIWS minimum is 8)', () => {
    const nonce = createNonce();
    expect(nonce).toMatch(/^[a-f0-9]{32}$/);
    expect(createNonce()).not.toBe(nonce);
  });
  it('builds a devnet-only payload with second-precision timestamps and a 5-minute expiry', () => {
    const input = buildSignInInput(cfg, new Date('2026-10-02T10:00:00.123Z'), 'a1b2c3d4e5f6a7b8');
    expect(input).toEqual({
      domain: 'pocketqa.invalid', statement: LINK_STATEMENT, uri: 'https://pocketqa.invalid', version: '1',
      chainId: 'solana:devnet', nonce: 'a1b2c3d4e5f6a7b8', issuedAt: '2026-10-02T10:00:00Z', expirationTime: '2026-10-02T10:05:00Z',
    });
    expect(LINK_STATEMENT).toContain('This does not send or receive money.');
  });
  it('rejects nonces that wallets would refuse', () => {
    expect(() => buildSignInInput(cfg, new Date(), 'short')).toThrowError('nonce must be alphanumeric and at least 8 characters');
  });
});
```

- [ ] **Step 2: Run to verify failure** — `pnpm --filter @pocketqa/wallet-auth test` → FAIL: cannot resolve `../src/siws`.

- [ ] **Step 3: Implement** — `packages/wallet-auth/src/siws.ts`:

```ts
import { randomBytes } from 'node:crypto';
import { SOLANA_DEVNET_CHAIN } from '@pocketqa/contracts';

export interface SiwsConfig { domain: string; uri: string; ttlSeconds: number }
export interface IssuedSignInInput {
  domain: string;
  statement: string;
  uri: string;
  version: '1';
  chainId: typeof SOLANA_DEVNET_CHAIN;
  nonce: string;
  issuedAt: string;
  expirationTime: string;
}

export const LINK_STATEMENT = 'Link this wallet to your Pocket QA account on Solana devnet. This does not send or receive money.';

export function createNonce(random: (n: number) => Uint8Array = (n) => new Uint8Array(randomBytes(n))): string {
  return Buffer.from(random(16)).toString('hex');
}

// Wallets copy these strings into the signed message verbatim; whole seconds avoid wallets that drop milliseconds.
const isoSeconds = (d: Date) => d.toISOString().replace(/\.\d{3}Z$/, 'Z');

export function buildSignInInput(cfg: SiwsConfig, now: Date, nonce: string): IssuedSignInInput {
  if (!/^[a-zA-Z0-9]{8,}$/.test(nonce)) throw new Error('nonce must be alphanumeric and at least 8 characters');
  return {
    domain: cfg.domain,
    statement: LINK_STATEMENT,
    uri: cfg.uri,
    version: '1',
    chainId: SOLANA_DEVNET_CHAIN,
    nonce,
    issuedAt: isoSeconds(now),
    expirationTime: isoSeconds(new Date(now.getTime() + cfg.ttlSeconds * 1000)),
  };
}
```

`packages/wallet-auth/src/index.ts`:
```ts
export * from './siws';
```

- [ ] **Step 4: Run** — `pnpm --filter @pocketqa/wallet-auth test` → `3 passed`.
- [ ] **Step 5: Commit** — `packages/wallet-auth`, `pnpm-lock.yaml`; message `feat(wallet-auth): SIWS input and nonce`.

### Task T1.12: Wallet-auth — link signature verification

**Owner:** core

**Files:**
- Create: `packages/wallet-auth/src/verify-link.ts`
- Modify: `packages/wallet-auth/src/index.ts` (add `export * from './verify-link';`)
- Test: `packages/wallet-auth/test/verify-link.test.ts`

**Interfaces:**
- Consumes: `IssuedSignInInput`, `buildSignInInput` (T1.11).
- Produces: `interface SignInOutputWire { address: string; signedMessageB64: string; signatureB64: string }`, `type VerifyLinkResult = { ok: true; address: string } | { ok: false; code: 'SIGNATURE_INVALID' | 'WRONG_NETWORK' | 'NONCE_INVALID'; reason: string }`, `verifyLinkSignature(issued, wire, expectedDomain, now, clockSkewMs = 60_000)`.

- [ ] **Step 0: Confirm library exports (V3)**

Run: `node -e "import('@solana/wallet-standard-util').then(m => console.log(['verifySignIn','createSignInMessage','parseSignInMessage'].map(k => k + ':' + typeof m[k]).join(' ')))"` from `packages/wallet-auth`.
Expected: `verifySignIn:function createSignInMessage:function parseSignInMessage:function`. Any `undefined` → stop and report (V3).

- [ ] **Step 1: Write the failing test** — `packages/wallet-auth/test/verify-link.test.ts`. It uses real ed25519 keys from Node's crypto, and it also checks a wallet-style message built by hand from the SIWS ABNF (S20):

```ts
import { generateKeyPairSync, sign } from 'node:crypto';
import bs58 from 'bs58';
import { createSignInMessage } from '@solana/wallet-standard-util';
import { describe, expect, it } from 'vitest';
import { buildSignInInput } from '../src/siws';
import { verifyLinkSignature } from '../src/verify-link';

const cfg = { domain: 'pocketqa.invalid', uri: 'https://pocketqa.invalid', ttlSeconds: 300 };
const now = new Date('2026-10-02T10:00:00Z');
const issued = buildSignInInput(cfg, now, 'a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6');

function keypair() {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  const raw = Buffer.from(publicKey.export({ format: 'jwk' }).x as string, 'base64url');
  return { address: bs58.encode(raw), privateKey };
}
function wire(message: Uint8Array, kp: ReturnType<typeof keypair>, signer = kp) {
  return {
    address: kp.address,
    signedMessageB64: Buffer.from(message).toString('base64'),
    signatureB64: sign(null, Buffer.from(message), signer.privateKey).toString('base64'),
  };
}

describe('verifyLinkSignature', () => {
  it('accepts a valid sign-in signed by the claimed address', () => {
    const kp = keypair();
    const msg = createSignInMessage({ ...issued, address: kp.address });
    expect(verifyLinkSignature(issued, wire(msg, kp), 'pocketqa.invalid', now)).toEqual({ ok: true, address: kp.address });
  });
  it('accepts a hand-built wallet message that follows the SIWS ABNF', () => {
    const kp = keypair();
    const text = [
      `pocketqa.invalid wants you to sign in with your Solana account:`, kp.address, '', issued.statement, '',
      `URI: ${issued.uri}`, `Version: 1`, `Chain ID: solana:devnet`, `Nonce: ${issued.nonce}`,
      `Issued At: ${issued.issuedAt}`, `Expiration Time: ${issued.expirationTime}`,
    ].join('\n');
    expect(verifyLinkSignature(issued, wire(new TextEncoder().encode(text), kp), 'pocketqa.invalid', now).ok).toBe(true);
  });
  it('rejects a signature from a different key', () => {
    const kp = keypair();
    const msg = createSignInMessage({ ...issued, address: kp.address });
    expect(verifyLinkSignature(issued, wire(msg, kp, keypair()), 'pocketqa.invalid', now)).toMatchObject({ ok: false, code: 'SIGNATURE_INVALID' });
  });
  it('rejects a message whose nonce differs from the stored payload', () => {
    const kp = keypair();
    const msg = createSignInMessage({ ...issued, nonce: 'ffffffffffffffffffffffffffffffff', address: kp.address });
    expect(verifyLinkSignature(issued, wire(msg, kp), 'pocketqa.invalid', now)).toMatchObject({ ok: false, code: 'SIGNATURE_INVALID' });
  });
  it('rejects expired requests and wrong domains', () => {
    const kp = keypair();
    const msg = createSignInMessage({ ...issued, address: kp.address });
    expect(verifyLinkSignature(issued, wire(msg, kp), 'pocketqa.invalid', new Date('2026-10-02T10:05:01Z'))).toMatchObject({ ok: false, code: 'NONCE_INVALID' });
    expect(verifyLinkSignature(issued, wire(msg, kp), 'other.invalid', now)).toMatchObject({ ok: false, code: 'SIGNATURE_INVALID' });
  });
  it('rejects any chain other than devnet', () => {
    const kp = keypair();
    const mainnetIssued = { ...issued, chainId: 'solana:mainnet' } as unknown as typeof issued;
    const msg = createSignInMessage({ ...mainnetIssued, address: kp.address });
    expect(verifyLinkSignature(mainnetIssued, wire(msg, kp), 'pocketqa.invalid', now)).toMatchObject({ ok: false, code: 'WRONG_NETWORK' });
  });
  it('rejects malformed addresses', () => {
    expect(verifyLinkSignature(issued, { address: 'not-base58!', signedMessageB64: 'AA==', signatureB64: 'AA==' }, 'pocketqa.invalid', now)).toMatchObject({ ok: false, code: 'SIGNATURE_INVALID' });
  });
});
```

- [ ] **Step 2: Run to verify failure** — FAIL: cannot resolve `../src/verify-link`.

- [ ] **Step 3: Implement** — `packages/wallet-auth/src/verify-link.ts`:

```ts
import bs58 from 'bs58';
import type { SolanaSignInInput, SolanaSignInOutput } from '@solana/wallet-standard-features';
import { verifySignIn } from '@solana/wallet-standard-util';
import { SOLANA_DEVNET_CHAIN } from '@pocketqa/contracts';
import type { IssuedSignInInput } from './siws';

export interface SignInOutputWire { address: string; signedMessageB64: string; signatureB64: string }
export type VerifyLinkResult =
  | { ok: true; address: string }
  | { ok: false; code: 'SIGNATURE_INVALID' | 'WRONG_NETWORK' | 'NONCE_INVALID'; reason: string };

/**
 * `issued` MUST be the payload the server stored for this nonce — never a client copy (S9).
 * The caller consumes the nonce atomically before calling this, so a failed attempt still burns it.
 */
export function verifyLinkSignature(
  issued: IssuedSignInInput,
  wire: SignInOutputWire,
  expectedDomain: string,
  now: Date,
  clockSkewMs = 60_000,
): VerifyLinkResult {
  if (issued.chainId !== SOLANA_DEVNET_CHAIN) return { ok: false, code: 'WRONG_NETWORK', reason: 'Only Solana devnet is supported' };
  if (issued.domain !== expectedDomain) return { ok: false, code: 'SIGNATURE_INVALID', reason: 'Domain mismatch' };
  const t = now.getTime();
  if (t > Date.parse(issued.expirationTime)) return { ok: false, code: 'NONCE_INVALID', reason: 'This sign-in request expired' };
  if (t + clockSkewMs < Date.parse(issued.issuedAt)) return { ok: false, code: 'NONCE_INVALID', reason: 'This sign-in request is not valid yet' };

  let publicKey: Uint8Array;
  try {
    publicKey = bs58.decode(wire.address);
  } catch {
    return { ok: false, code: 'SIGNATURE_INVALID', reason: 'Invalid address' };
  }
  if (publicKey.length !== 32) return { ok: false, code: 'SIGNATURE_INVALID', reason: 'Invalid address' };

  const input: SolanaSignInInput = { ...issued, address: wire.address };
  const output: SolanaSignInOutput = {
    account: { address: wire.address, publicKey, chains: [SOLANA_DEVNET_CHAIN], features: [] },
    signedMessage: new Uint8Array(Buffer.from(wire.signedMessageB64, 'base64')),
    signature: new Uint8Array(Buffer.from(wire.signatureB64, 'base64')),
  };
  // verifySignIn re-parses the signed text, requires every field to equal `input`, then checks ed25519.
  return verifySignIn(input, output)
    ? { ok: true, address: wire.address }
    : { ok: false, code: 'SIGNATURE_INVALID', reason: 'The signature or message does not match this request' };
}
```

- [ ] **Step 4: Run** — `pnpm --filter @pocketqa/wallet-auth test && pnpm --filter @pocketqa/wallet-auth typecheck` → `10 passed`; typecheck exit 0.
- [ ] **Step 5: Commit** — the three files; message `feat(wallet-auth): verify SIWS link signatures against stored payload`.

### Task T1.13: Wallet-auth — devnet guard and transfer evaluation

**Owner:** core

**Files:**
- Create: `packages/wallet-auth/src/devnet.ts`
- Modify: `packages/wallet-auth/src/index.ts` (add `export * from './devnet';`)
- Test: `packages/wallet-auth/test/devnet.test.ts`

**Interfaces:** Produces `DEVNET_GENESIS_HASH`, `assertDevnetGenesis(hash)`, `assertDevnetRpcUrl(url)`, `devnetExplorerTxUrl(sig)`, `buildTransferMemo(compensationId)`, `DEVNET_EXPIRY_MARGIN_BLOCKS`, `interface ExpectedTransfer { from: string; to: string; lamports: bigint; memo: string }`, `interface ParsedInstruction { program?: string; programId?: string; parsed?: unknown }`, `interface ChainSnapshot { signatureStatus: { confirmationStatus: 'processed' | 'confirmed' | 'finalized' | null; err: unknown } | null; transaction: { err: unknown; instructions: ParsedInstruction[] } | null; currentBlockHeight: bigint; lastValidBlockHeight: bigint }`, `type TransferVerdict`, `evaluateTransfer(snapshot, expected)`.

- [ ] **Step 0: Verify the devnet genesis hash (V1)**

Run:
```bash
curl -s https://api.devnet.solana.com -X POST -H 'content-type: application/json' -d '{"jsonrpc":"2.0","id":1,"method":"getGenesisHash"}'
```
Expected: `{"jsonrpc":"2.0","result":"EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG","id":1}`. Paste the output into the commit body. If the result differs, use the observed value and report the difference to the lead.

- [ ] **Step 1: Write the failing test** — `packages/wallet-auth/test/devnet.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import {
  assertDevnetGenesis, assertDevnetRpcUrl, buildTransferMemo, DEVNET_GENESIS_HASH, devnetExplorerTxUrl, evaluateTransfer,
  type ChainSnapshot, type ParsedInstruction,
} from '../src/devnet';

const expected = { from: 'BuilderAddr1111111111111111111111111111111', to: 'TesterAddr11111111111111111111111111111111', lamports: 1_000_000n, memo: buildTransferMemo('c0ffee00-0000-4000-8000-000000000001') };
const transferIx = (over: Record<string, unknown> = {}): ParsedInstruction => ({ program: 'system', parsed: { type: 'transfer', info: { source: expected.from, destination: expected.to, lamports: 1_000_000, ...over } } });
const memoIx = (memo = expected.memo): ParsedInstruction => ({ program: 'spl-memo', parsed: memo });
const confirmed = (instructions: ParsedInstruction[]): ChainSnapshot => ({
  signatureStatus: { confirmationStatus: 'confirmed', err: null },
  transaction: { err: null, instructions },
  currentBlockHeight: 100n,
  lastValidBlockHeight: 270n,
});

describe('network guard', () => {
  it('accepts only the devnet genesis hash', () => {
    expect(() => assertDevnetGenesis(DEVNET_GENESIS_HASH)).not.toThrow();
    expect(() => assertDevnetGenesis('5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d')).toThrowError('The configured RPC is not Solana devnet');
  });
  it('refuses mainnet RPC URLs outright', () => {
    expect(() => assertDevnetRpcUrl('https://api.mainnet-beta.solana.com')).toThrowError('Mainnet RPC URLs are not allowed in this build');
    expect(() => assertDevnetRpcUrl('https://api.devnet.solana.com')).not.toThrow();
  });
  it('builds devnet explorer links', () => {
    expect(devnetExplorerTxUrl('abc')).toBe('https://explorer.solana.com/tx/abc?cluster=devnet');
  });
});

describe('evaluateTransfer', () => {
  it('is pending while unseen and before expiry', () => {
    expect(evaluateTransfer({ signatureStatus: null, transaction: null, currentBlockHeight: 100n, lastValidBlockHeight: 270n }, expected)).toEqual({ status: 'pending' });
  });
  it('expires after last valid block height', () => {
    expect(evaluateTransfer({ signatureStatus: null, transaction: null, currentBlockHeight: 271n, lastValidBlockHeight: 270n }, expected)).toEqual({ status: 'expired' });
  });
  it('stays pending while only processed', () => {
    expect(evaluateTransfer({ ...confirmed([transferIx(), memoIx()]), signatureStatus: { confirmationStatus: 'processed', err: null } }, expected)).toEqual({ status: 'pending' });
  });
  it('fails on an on-chain error', () => {
    expect(evaluateTransfer({ ...confirmed([]), signatureStatus: { confirmationStatus: 'confirmed', err: { InstructionError: [0, 'Custom'] } } }, expected).status).toBe('failed');
  });
  it('confirms an exact match, ignoring compute-budget instructions', () => {
    expect(evaluateTransfer(confirmed([{ program: 'compute-budget', parsed: { type: 'setComputeUnitPrice' } }, transferIx(), memoIx()]), expected)).toEqual({ status: 'confirmed' });
  });
  it('fails on recipient mismatch', () => {
    expect(evaluateTransfer(confirmed([transferIx({ destination: 'Someone11111111111111111111111111111111111' }), memoIx()]), expected).status).toBe('failed');
  });
  it('fails on amount, sender or memo mismatch, and on extra transfers', () => {
    expect(evaluateTransfer(confirmed([transferIx({ lamports: 999_999 }), memoIx()]), expected).status).toBe('failed');
    expect(evaluateTransfer(confirmed([transferIx({ source: 'Other111111111111111111111111111111111111' }), memoIx()]), expected).status).toBe('failed');
    expect(evaluateTransfer(confirmed([transferIx(), memoIx('pocketqa:comp:other')]), expected).status).toBe('failed');
    expect(evaluateTransfer(confirmed([transferIx(), transferIx(), memoIx()]), expected).status).toBe('failed');
  });
  it('accepts lamports reported as bigint or string', () => {
    expect(evaluateTransfer(confirmed([transferIx({ lamports: 1_000_000n }), memoIx()]), expected).status).toBe('confirmed');
    expect(evaluateTransfer(confirmed([transferIx({ lamports: '1000000' }), memoIx()]), expected).status).toBe('confirmed');
  });
});
```

- [ ] **Step 2: Run to verify failure** — FAIL: cannot resolve `../src/devnet`.

- [ ] **Step 3: Implement** — `packages/wallet-auth/src/devnet.ts`:

```ts
import { DomainError } from '@pocketqa/domain';

/** V1: confirmed against https://api.devnet.solana.com in T1.13 Step 0. */
export const DEVNET_GENESIS_HASH = 'EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG';
/** A blockhash fetched before submission is valid for at most 150 blocks; +20 margin (spec A10.4). */
export const DEVNET_EXPIRY_MARGIN_BLOCKS = 170n;

export function assertDevnetGenesis(hash: string): void {
  if (hash !== DEVNET_GENESIS_HASH) throw new DomainError('WRONG_NETWORK', 'The configured RPC is not Solana devnet');
}

export function assertDevnetRpcUrl(url: string): void {
  if (/mainnet/i.test(url)) throw new DomainError('WRONG_NETWORK', 'Mainnet RPC URLs are not allowed in this build');
  const u = new URL(url);
  if (u.protocol !== 'https:' && u.hostname !== '127.0.0.1' && u.hostname !== 'localhost') {
    throw new DomainError('WRONG_NETWORK', 'The devnet RPC must use https unless it is local');
  }
}

export const devnetExplorerTxUrl = (signature: string) => `https://explorer.solana.com/tx/${encodeURIComponent(signature)}?cluster=devnet`;
export const buildTransferMemo = (compensationId: string) => `pocketqa:comp:${compensationId}`;

export interface ExpectedTransfer { from: string; to: string; lamports: bigint; memo: string }
export interface ParsedInstruction { program?: string; programId?: string; parsed?: unknown }
export interface ChainSnapshot {
  signatureStatus: { confirmationStatus: 'processed' | 'confirmed' | 'finalized' | null; err: unknown } | null;
  transaction: { err: unknown; instructions: ParsedInstruction[] } | null;
  currentBlockHeight: bigint;
  lastValidBlockHeight: bigint;
}
export type TransferVerdict =
  | { status: 'pending' }
  | { status: 'confirmed' }
  | { status: 'expired' }
  | { status: 'failed'; reason: string };

const toBigInt = (v: unknown): bigint | null => {
  try {
    return typeof v === 'bigint' ? v : typeof v === 'number' || typeof v === 'string' ? BigInt(v) : null;
  } catch {
    return null;
  }
};
const isTransfer = (ix: ParsedInstruction) => ix.program === 'system' && (ix.parsed as { type?: unknown } | undefined)?.type === 'transfer';

/** The only path to "confirmed" (R8, R44): the chain must show exactly the transfer the server prepared. */
export function evaluateTransfer(s: ChainSnapshot, expected: ExpectedTransfer): TransferVerdict {
  if (!s.signatureStatus) return s.currentBlockHeight > s.lastValidBlockHeight ? { status: 'expired' } : { status: 'pending' };
  if (s.signatureStatus.err) return { status: 'failed', reason: 'The transaction failed on devnet' };
  const level = s.signatureStatus.confirmationStatus;
  if (level !== 'confirmed' && level !== 'finalized') return { status: 'pending' };
  if (!s.transaction) return { status: 'pending' };
  if (s.transaction.err) return { status: 'failed', reason: 'The transaction failed on devnet' };

  const transfers = s.transaction.instructions.filter(isTransfer);
  const memos = s.transaction.instructions.filter((ix) => ix.program === 'spl-memo');
  const info = (transfers[0]?.parsed as { info?: Record<string, unknown> } | undefined)?.info ?? {};
  const transferOk = transfers.length === 1 && info.source === expected.from && info.destination === expected.to && toBigInt(info.lamports) === expected.lamports;
  const memoOk = memos.length === 1 && memos[0]?.parsed === expected.memo;
  return transferOk && memoOk
    ? { status: 'confirmed' }
    : { status: 'failed', reason: 'The transfer does not match the prepared recipient, amount, sender, or memo' };
}
```

- [ ] **Step 4: Run** — `pnpm --filter @pocketqa/wallet-auth test && pnpm --filter @pocketqa/wallet-auth typecheck && pnpm typecheck` → `21 passed`; all typechecks exit 0.
- [ ] **Step 5: Commit** — the three files; message `feat(wallet-auth): devnet guard and on-chain transfer evaluation`; body includes the Step 0 genesis output. Then signal FC-1 readiness (handoff §F.1).

---

## Phase 2 — API (FC-2)

All API tasks: **Owner:** api · **Branch:** `feat/api-core` · run tests with `pnpm --filter @pocketqa/api test` (single file: `pnpm --filter @pocketqa/api exec vitest run test/<file>.test.ts`).

### Task T2.1: API foundation — config, database, app factory, errors, logging, health

**Files:**
- Create: `apps/api/package.json`, `apps/api/tsconfig.json`, `apps/api/vitest.config.ts`, `apps/api/drizzle.config.ts`, `apps/api/.env.example`
- Create: `apps/api/src/config.ts`, `apps/api/src/db/schema.ts`, `apps/api/src/db/client.ts`, `apps/api/src/app.ts`, `apps/api/src/routes/index.ts`, `apps/api/src/routes/health.ts`, `apps/api/src/lib/http-errors.ts`, `apps/api/src/lib/redact.ts`, `apps/api/src/services/ports.ts`
- Generate: `apps/api/drizzle/0000_*.sql` (+ `meta/`), `apps/api/drizzle/0001_audit_append_only.sql`
- Test: `apps/api/test/config.test.ts`, `apps/api/test/db.test.ts`, `apps/api/test/app.test.ts`

**Interfaces:**
- Consumes: contracts (T1.1–T1.2) and domain `DomainError`.
- Produces:
  - `loadConfig(env): AppConfig` and `openDb(file): Db`.
  - `buildApp(deps: AppDeps)`, which decorates `app.ctx: { config, db, media, chain, ai, now }`, `app.chainGuard: { state }`, and `app.registeredRoutes: {method, url}[]`.
  - Port interfaces `MediaStore`, `ChainPort`, `AiProvider`, plus `noneAiProvider` and `createUnavailableChainPort()`.
  - The schema constants `PARTICIPATION_STATUSES` etc.

- [ ] **Step 0: Package setup**

`apps/api/package.json`:
```json
{
  "name": "@pocketqa/api",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "node --watch --env-file=.env.local --import tsx src/server.ts",
    "start": "node --env-file=.env.local --import tsx src/server.ts",
    "start:e2e": "node --import tsx src/server.ts",
    "test": "vitest run",
    "typecheck": "tsc --noEmit -p tsconfig.json",
    "db:generate": "drizzle-kit generate",
    "admin:create": "node --env-file=.env.local --import tsx src/cli/admin-create.ts",
    "jobs:run": "node --env-file=.env.local --import tsx src/jobs/run-jobs.ts",
    "devnet:airdrop": "node --env-file=.env.local --import tsx src/cli/devnet-airdrop.ts"
  }
}
```
`apps/api/tsconfig.json`: `{ "extends": "../../tsconfig.base.json", "include": ["src", "test"] }`
`apps/api/vitest.config.ts`:
```ts
import { defineConfig } from 'vitest/config';
export default defineConfig({ test: { include: ['test/**/*.test.ts'], pool: 'forks', testTimeout: 20000 } });
```
`apps/api/drizzle.config.ts`:
```ts
import { defineConfig } from 'drizzle-kit';
export default defineConfig({ dialect: 'sqlite', schema: './src/db/schema.ts', out: './drizzle' });
```
`apps/api/.env.example` (names only — real values live in gitignored `.env.local`):
```
NODE_ENV=development
API_HOST=127.0.0.1
API_PORT=8787
DATABASE_FILE=./var/pocketqa.db
MEDIA_DIR=./var/media
MAX_UPLOAD_BYTES=314572800
# Generate: node -e "console.log(require('node:crypto').randomBytes(32).toString('base64url'))"
PLAYBACK_TOKEN_SECRET=
SIWS_DOMAIN=pocketqa.invalid
SIWS_URI=https://pocketqa.invalid
SOLANA_RPC_URL=https://api.devnet.solana.com
DEVNET_DEMO_LAMPORTS=1000000
AI_PROVIDER=none
WEB_ORIGIN=http://localhost:8081
EVIDENCE_RETENTION_DAYS=30
DISPUTE_WINDOW_DAYS=7
CLAIM_TTL_HOURS=48
POCKETQA_TEST_HOOKS=0
```
Run:
```bash
pnpm --filter @pocketqa/api add fastify @fastify/cors @fastify/rate-limit zod drizzle-orm better-sqlite3 @node-rs/argon2 @solana/kit @pocketqa/contracts@workspace:* @pocketqa/domain@workspace:* @pocketqa/wallet-auth@workspace:*
pnpm --filter @pocketqa/api add -D tsx drizzle-kit vitest typescript @types/node @types/better-sqlite3 bs58 @solana/wallet-standard-util
```

- [ ] **Step 1: Write the failing tests**

`apps/api/test/config.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { loadConfig } from '../src/config';

const SECRET = 'x'.repeat(40);

describe('loadConfig', () => {
  it('applies local-first defaults', () => {
    const c = loadConfig({ PLAYBACK_TOKEN_SECRET: SECRET });
    expect(c).toMatchObject({ API_HOST: '127.0.0.1', API_PORT: 8787, SOLANA_RPC_URL: 'https://api.devnet.solana.com', AI_PROVIDER: 'none', POCKETQA_TEST_HOOKS: '0' });
  });
  it('names invalid keys without echoing values', () => {
    expect(() => loadConfig({ PLAYBACK_TOKEN_SECRET: 'short-secret-value' })).toThrowError('Invalid configuration for: PLAYBACK_TOKEN_SECRET'); // check-secrets: allow (fake fixture)
    try { loadConfig({ PLAYBACK_TOKEN_SECRET: 'short-secret-value' }); } catch (e) { expect(String(e)).not.toContain('short-secret-value'); } // check-secrets: allow (fake fixture)
  });
  it('refuses to bind anywhere but 127.0.0.1', () => {
    expect(() => loadConfig({ PLAYBACK_TOKEN_SECRET: SECRET, API_HOST: '0.0.0.0' })).toThrowError('Invalid configuration for: API_HOST');
  });
  it('refuses test hooks in production', () => {
    expect(() => loadConfig({ PLAYBACK_TOKEN_SECRET: SECRET, NODE_ENV: 'production', POCKETQA_TEST_HOOKS: '1' })).toThrowError('POCKETQA_TEST_HOOKS cannot be enabled in production');
  });
});
```

`apps/api/test/db.test.ts`:
```ts
import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { CompensationStatusSchema, LedgerKindSchema, ParticipationStatusSchema, StudyStatusSchema } from '@pocketqa/contracts';
import { openDb } from '../src/db/client';
import { COMPENSATION_STATUSES, LEDGER_KINDS, PARTICIPATION_STATUSES, STUDY_STATUSES, auditLog, sessions, users, walletLinks } from '../src/db/schema';

const now = new Date('2026-10-02T10:00:00Z');
const addUser = (db: ReturnType<typeof openDb>, email = `${randomUUID()}@example.test`) => {
  const id = randomUUID();
  db.insert(users).values({ id, email, passwordHash: 'h', role: 'tester', displayName: 'T', status: 'active', adultAttestedAt: now, createdAt: now }).run();
  return id;
};

describe('database', () => {
  it('creates every table', () => {
    const db = openDb(':memory:');
    const names = (db.$client.prepare("select name from sqlite_master where type = 'table'").all() as { name: string }[]).map((r) => r.name);
    for (const t of ['users', 'sessions', 'device_profiles', 'wallet_links', 'wallet_nonces', 'studies', 'study_tasks', 'device_criteria', 'consent_versions', 'ledger_entries', 'participations', 'evidence_items', 'task_results', 'findings', 'ai_suggestions', 'compensations', 'devnet_transfers', 'disputes', 'moderation_actions', 'data_requests', 'audit_log']) {
      expect(names).toContain(t);
    }
  });
  it('enforces unique emails and foreign keys', () => {
    const db = openDb(':memory:');
    addUser(db, 'same@example.test');
    expect(() => addUser(db, 'same@example.test')).toThrowError(/UNIQUE/);
    expect(() => db.insert(sessions).values({ id: randomUUID(), userId: randomUUID(), tokenHash: 'h', createdAt: now, expiresAt: now }).run()).toThrowError(/FOREIGN KEY/);
  });
  it('keeps the audit log append-only', () => {
    const db = openDb(':memory:');
    db.insert(auditLog).values({ id: 'a1', actorId: null, action: 'x', targetType: 't', targetId: 'i', metaJson: '{}', at: now }).run();
    expect(() => db.$client.prepare("update audit_log set action = 'y'").run()).toThrowError('audit_log is append-only');
    expect(() => db.$client.prepare('delete from audit_log').run()).toThrowError('audit_log is append-only');
  });
  it('allows one active wallet link per user and per address', () => {
    const db = openDb(':memory:');
    const a = addUser(db); const b = addUser(db);
    const link = (userId: string, address: string) => db.insert(walletLinks).values({ id: randomUUID(), userId, address, chain: 'solana:devnet', linkedAt: now }).run();
    link(a, 'Addr1');
    expect(() => link(b, 'Addr1')).toThrowError(/UNIQUE/);
    expect(() => link(a, 'Addr2')).toThrowError(/UNIQUE/);
  });
  it('uses the same enum values as the contracts', () => {
    expect([...PARTICIPATION_STATUSES]).toEqual(ParticipationStatusSchema.options);
    expect([...STUDY_STATUSES]).toEqual(StudyStatusSchema.options);
    expect([...LEDGER_KINDS]).toEqual(LedgerKindSchema.options);
    expect([...COMPENSATION_STATUSES]).toEqual(CompensationStatusSchema.options);
  });
});
```

`apps/api/test/app.test.ts`:
```ts
import { Writable } from 'node:stream';
import { describe, expect, it } from 'vitest';
import { buildApp } from '../src/app';
import { loadConfig } from '../src/config';
import { openDb } from '../src/db/client';
import { createUnavailableChainPort, noneAiProvider, type MediaStore } from '../src/services/ports';

const stubMedia: MediaStore = {
  beginWrite: () => ({ key: 'k', tempPath: '/dev/null' }), commit: async () => {}, abort: async () => {},
  pathFor: () => '/dev/null', remove: async () => {},
};

async function app() {
  const logs: string[] = [];
  const logStream = new Writable({ write(chunk, _e, cb) { logs.push(String(chunk)); cb(); } });
  const config = loadConfig({ NODE_ENV: 'test', PLAYBACK_TOKEN_SECRET: 'x'.repeat(40) });
  const a = await buildApp({ config, db: openDb(':memory:'), media: stubMedia, chain: createUnavailableChainPort(), ai: noneAiProvider, logStream });
  return { a, logs };
}

describe('app', () => {
  it('reports health honestly with security headers', async () => {
    const { a } = await app();
    const res = await a.inject({ method: 'GET', url: '/v1/health' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true, cluster: 'devnet', chainGuard: 'unverified', aiProvider: 'none' });
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['referrer-policy']).toBe('no-referrer');
    expect(res.headers['cache-control']).toBe('no-store');
  });
  it('returns the error envelope for unknown routes', async () => {
    const { a } = await app();
    const res = await a.inject({ method: 'GET', url: '/v1/nope' });
    expect(res.statusCode).toBe(404);
    expect(res.json().error).toMatchObject({ code: 'NOT_FOUND', message: 'Not found' });
    expect(typeof res.json().error.requestId).toBe('string');
  });
  it('never logs query strings', async () => {
    const { a, logs } = await app();
    await a.inject({ method: 'GET', url: '/v1/health?token=SHOULD-NOT-APPEAR' });
    expect(logs.join('')).not.toContain('SHOULD-NOT-APPEAR');
    expect(logs.join('')).toContain('/v1/health');
  });
  it('collects registered routes for the authorization matrix', async () => {
    const { a } = await app();
    expect(a.registeredRoutes).toContainEqual({ method: 'GET', url: '/v1/health' });
  });
});
```

- [ ] **Step 2: Run to verify failure** — `pnpm --filter @pocketqa/api test` → FAIL: cannot resolve `../src/config`.

- [ ] **Step 3: Implement**

`apps/api/src/config.ts`:
```ts
import { z } from 'zod';

const ConfigSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  API_HOST: z.literal('127.0.0.1').default('127.0.0.1'), // local-first: never bind to the LAN (CLAUDE.md:5, :11)
  API_PORT: z.coerce.number().int().min(1024).max(65535).default(8787),
  DATABASE_FILE: z.string().min(1).default('./var/pocketqa.db'),
  MEDIA_DIR: z.string().min(1).default('./var/media'),
  MAX_UPLOAD_BYTES: z.coerce.number().int().min(1024).max(1024 ** 3).default(300 * 1024 * 1024),
  PLAYBACK_TOKEN_SECRET: z.string().min(32),
  SIWS_DOMAIN: z.string().min(3).default('pocketqa.invalid'),
  SIWS_URI: z.url().default('https://pocketqa.invalid'),
  SOLANA_RPC_URL: z.url().default('https://api.devnet.solana.com'),
  DEVNET_DEMO_LAMPORTS: z.string().regex(/^\d+$/).default('1000000'),
  AI_PROVIDER: z.string().min(1).default('none'),
  WEB_ORIGIN: z.url().default('http://localhost:8081'),
  EVIDENCE_RETENTION_DAYS: z.coerce.number().int().min(1).max(365).default(30),
  DISPUTE_WINDOW_DAYS: z.coerce.number().int().min(1).max(60).default(7),
  CLAIM_TTL_HOURS: z.coerce.number().int().min(1).max(720).default(48),
  POCKETQA_TEST_HOOKS: z.enum(['0', '1']).default('0'),
});
export type AppConfig = z.output<typeof ConfigSchema>;

export function loadConfig(env: Record<string, string | undefined>): AppConfig {
  const parsed = ConfigSchema.safeParse(env);
  if (!parsed.success) {
    // Config may hold secrets: report key names only, never values (CLAUDE.md:13).
    const keys = [...new Set(parsed.error.issues.map((i) => i.path.join('.')))].join(', ');
    throw new Error(`Invalid configuration for: ${keys}`);
  }
  if (parsed.data.POCKETQA_TEST_HOOKS === '1' && parsed.data.NODE_ENV === 'production') {
    throw new Error('POCKETQA_TEST_HOOKS cannot be enabled in production');
  }
  return parsed.data;
}
```

`apps/api/src/db/schema.ts`:
```ts
import { sql } from 'drizzle-orm';
import { index, integer, primaryKey, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';

export const ROLES = ['tester', 'builder', 'admin'] as const;
export const USER_STATUSES = ['active', 'suspended', 'deleted'] as const;
export const STUDY_STATUSES = ['draft', 'published', 'paused', 'closed'] as const;
export const PARTICIPATION_STATUSES = ['claimed', 'consented', 'in_progress', 'submitted', 'approved', 'rejected', 'withdrawn', 'expired', 'disputed'] as const;
export const LEDGER_KINDS = ['fund_test', 'reserve', 'release', 'reward_approved'] as const;
export const EVIDENCE_STATUSES = ['pending_upload', 'uploaded', 'removed', 'purged'] as const;
export const CAPTURE_SOURCES = ['android_media_projection', 'ios_import', 'web_import'] as const;
export const COMPENSATION_STATUSES = ['approved_unpaid', 'transfer_pending', 'transfer_confirmed', 'transfer_failed'] as const;
export const TRANSFER_STATUSES = ['submitted', 'confirmed', 'failed', 'expired'] as const;
export const DISPUTE_STATUSES = ['open', 'resolved_upheld', 'resolved_overturned'] as const;

const ts = (name: string) => integer(name, { mode: 'timestamp_ms' });
const bool = (name: string) => integer(name, { mode: 'boolean' });

export const users = sqliteTable('users', {
  id: text('id').primaryKey(),
  email: text('email').notNull(),
  passwordHash: text('password_hash'),
  role: text('role', { enum: ROLES }).notNull(),
  displayName: text('display_name'),
  status: text('status', { enum: USER_STATUSES }).notNull().default('active'),
  adultAttestedAt: ts('adult_attested_at'),
  createdAt: ts('created_at').notNull(),
  deletedAt: ts('deleted_at'),
}, (t) => [uniqueIndex('users_email_uq').on(t.email)]);

export const sessions = sqliteTable('sessions', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull().references(() => users.id),
  tokenHash: text('token_hash').notNull(),
  createdAt: ts('created_at').notNull(),
  expiresAt: ts('expires_at').notNull(),
  revokedAt: ts('revoked_at'),
}, (t) => [uniqueIndex('sessions_token_uq').on(t.tokenHash)]);

export const deviceProfiles = sqliteTable('device_profiles', {
  userId: text('user_id').primaryKey().references(() => users.id),
  platform: text('platform', { enum: ['android', 'ios', 'web'] }).notNull(),
  osVersion: text('os_version').notNull(),
  androidApi: integer('android_api'),
  iosMajor: integer('ios_major'),
  model: text('model'),
  manufacturer: text('manufacturer'),
  selfReportedSeeker: bool('self_reported_seeker').notNull(),
  modelHintSeeker: bool('model_hint_seeker').notNull(),
  updatedAt: ts('updated_at').notNull(),
});

export const walletLinks = sqliteTable('wallet_links', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull().references(() => users.id),
  address: text('address').notNull(),
  chain: text('chain').notNull(),
  linkedAt: ts('linked_at').notNull(),
  unlinkedAt: ts('unlinked_at'),
}, (t) => [
  uniqueIndex('wallet_links_active_address_uq').on(t.address).where(sql`unlinked_at IS NULL`),
  uniqueIndex('wallet_links_active_user_uq').on(t.userId).where(sql`unlinked_at IS NULL`),
]);

export const walletNonces = sqliteTable('wallet_nonces', {
  nonce: text('nonce').primaryKey(),
  userId: text('user_id').notNull().references(() => users.id),
  purpose: text('purpose', { enum: ['link'] }).notNull(),
  payloadJson: text('payload_json').notNull(),
  issuedAt: ts('issued_at').notNull(),
  expiresAt: ts('expires_at').notNull(),
  consumedAt: ts('consumed_at'),
});

export const studies = sqliteTable('studies', {
  id: text('id').primaryKey(),
  builderId: text('builder_id').notNull().references(() => users.id),
  title: text('title').notNull(),
  appName: text('app_name').notNull(),
  appLink: text('app_link').notNull(),
  goal: text('goal').notNull(),
  status: text('status', { enum: STUDY_STATUSES }).notNull(),
  rewardCredits: integer('reward_credits').notNull(),
  slotsTotal: integer('slots_total').notNull(),
  aiProcessingEnabled: bool('ai_processing_enabled').notNull(),
  createdAt: ts('created_at').notNull(),
  publishedAt: ts('published_at'),
  closedAt: ts('closed_at'),
}, (t) => [index('studies_builder_idx').on(t.builderId), index('studies_status_idx').on(t.status)]);

export const studyTasks = sqliteTable('study_tasks', {
  id: text('id').primaryKey(),
  studyId: text('study_id').notNull().references(() => studies.id),
  position: integer('position').notNull(),
  title: text('title').notNull(),
  instructions: text('instructions').notNull(),
  maxMinutes: integer('max_minutes').notNull(),
}, (t) => [uniqueIndex('study_tasks_position_uq').on(t.studyId, t.position)]);

export const deviceCriteria = sqliteTable('device_criteria', {
  studyId: text('study_id').primaryKey().references(() => studies.id),
  platformsJson: text('platforms_json').notNull(),
  minAndroidApi: integer('min_android_api'),
  minIosMajor: integer('min_ios_major'),
  requireSelfReportedSeeker: bool('require_self_reported_seeker').notNull(),
});

export const consentVersions = sqliteTable('consent_versions', {
  id: text('id').primaryKey(),
  studyId: text('study_id').notNull().references(() => studies.id),
  version: integer('version').notNull(),
  textMd: text('text_md').notNull(),
  scopesJson: text('scopes_json').notNull(),
  textSha256: text('text_sha256').notNull(),
  createdAt: ts('created_at').notNull(),
}, (t) => [uniqueIndex('consent_versions_uq').on(t.studyId, t.version)]);

export const ledgerEntries = sqliteTable('ledger_entries', {
  id: text('id').primaryKey(),
  studyId: text('study_id').notNull().references(() => studies.id),
  participationId: text('participation_id'),
  kind: text('kind', { enum: LEDGER_KINDS }).notNull(),
  amount: integer('amount').notNull(),
  createdBy: text('created_by').notNull(),
  createdAt: ts('created_at').notNull(),
}, (t) => [index('ledger_study_idx').on(t.studyId)]);

export const participations = sqliteTable('participations', {
  id: text('id').primaryKey(),
  studyId: text('study_id').notNull().references(() => studies.id),
  testerId: text('tester_id').notNull().references(() => users.id),
  status: text('status', { enum: PARTICIPATION_STATUSES }).notNull(),
  consentVersionId: text('consent_version_id'),
  scopesJson: text('scopes_json').notNull().default('[]'),
  claimedAt: ts('claimed_at').notNull(),
  consentedAt: ts('consented_at'),
  startedAt: ts('started_at'),
  submittedAt: ts('submitted_at'),
  decidedAt: ts('decided_at'),
  decisionReason: text('decision_reason'),
  reviewerId: text('reviewer_id'),
  reservationReleasedAt: ts('reservation_released_at'),
}, (t) => [uniqueIndex('participations_study_tester_uq').on(t.studyId, t.testerId), index('participations_tester_idx').on(t.testerId)]);

export const evidenceItems = sqliteTable('evidence_items', {
  id: text('id').primaryKey(),
  participationId: text('participation_id').notNull().references(() => participations.id),
  taskId: text('task_id'),
  kind: text('kind', { enum: ['screen_recording', 'screenshot'] }).notNull(),
  status: text('status', { enum: EVIDENCE_STATUSES }).notNull(),
  storageKey: text('storage_key'),
  mime: text('mime').notNull(),
  sizeBytes: integer('size_bytes').notNull(),
  sha256: text('sha256'),
  durationMs: integer('duration_ms'),
  captureSource: text('capture_source', { enum: CAPTURE_SOURCES }).notNull(),
  createdAt: ts('created_at').notNull(),
  uploadedAt: ts('uploaded_at'),
  removedAt: ts('removed_at'),
  purgedAt: ts('purged_at'),
}, (t) => [index('evidence_participation_idx').on(t.participationId), index('evidence_sha_idx').on(t.sha256)]);

export const taskResults = sqliteTable('task_results', {
  participationId: text('participation_id').notNull().references(() => participations.id),
  taskId: text('task_id').notNull(),
  outcome: text('outcome', { enum: ['completed', 'blocked', 'gave_up'] }).notNull(),
  difficulty: integer('difficulty').notNull(),
  note: text('note').notNull(),
}, (t) => [primaryKey({ columns: [t.participationId, t.taskId] })]);

export const findings = sqliteTable('findings', {
  id: text('id').primaryKey(),
  participationId: text('participation_id').notNull().references(() => participations.id),
  createdBy: text('created_by').notNull().references(() => users.id),
  title: text('title').notNull(),
  severity: text('severity', { enum: ['critical', 'major', 'minor', 'info'] }).notNull(),
  evidenceItemId: text('evidence_item_id'),
  timestampMs: integer('timestamp_ms'),
  description: text('description').notNull(),
  source: text('source', { enum: ['human', 'ai_accepted'] }).notNull(),
  createdAt: ts('created_at').notNull(),
});

export const aiSuggestions = sqliteTable('ai_suggestions', {
  id: text('id').primaryKey(),
  participationId: text('participation_id').notNull().references(() => participations.id),
  provider: text('provider').notNull(),
  model: text('model').notNull(),
  status: text('status', { enum: ['suggested', 'accepted', 'dismissed'] }).notNull(),
  payloadJson: text('payload_json').notNull(),
  createdAt: ts('created_at').notNull(),
  decidedBy: text('decided_by'),
  decidedAt: ts('decided_at'),
});

export const compensations = sqliteTable('compensations', {
  id: text('id').primaryKey(),
  participationId: text('participation_id').notNull().references(() => participations.id),
  credits: integer('credits').notNull(),
  status: text('status', { enum: COMPENSATION_STATUSES }).notNull(),
  createdAt: ts('created_at').notNull(),
}, (t) => [uniqueIndex('compensations_participation_uq').on(t.participationId)]);

export const devnetTransfers = sqliteTable('devnet_transfers', {
  id: text('id').primaryKey(),
  compensationId: text('compensation_id').notNull().references(() => compensations.id),
  signature: text('signature').notNull(),
  fromAddress: text('from_address').notNull(),
  toAddress: text('to_address').notNull(),
  lamports: text('lamports').notNull(),
  memo: text('memo').notNull(),
  lastValidBlockHeight: text('last_valid_block_height').notNull(),
  status: text('status', { enum: TRANSFER_STATUSES }).notNull(),
  failureReason: text('failure_reason'),
  checkedAt: ts('checked_at'),
  createdAt: ts('created_at').notNull(),
}, (t) => [uniqueIndex('devnet_transfers_signature_uq').on(t.signature)]);

export const disputes = sqliteTable('disputes', {
  id: text('id').primaryKey(),
  participationId: text('participation_id').notNull().references(() => participations.id),
  openedBy: text('opened_by').notNull().references(() => users.id),
  reason: text('reason').notNull(),
  status: text('status', { enum: DISPUTE_STATUSES }).notNull(),
  resolutionReason: text('resolution_reason'),
  resolvedBy: text('resolved_by'),
  createdAt: ts('created_at').notNull(),
  resolvedAt: ts('resolved_at'),
}, (t) => [uniqueIndex('disputes_participation_uq').on(t.participationId)]);

export const moderationActions = sqliteTable('moderation_actions', {
  id: text('id').primaryKey(),
  adminId: text('admin_id').notNull().references(() => users.id),
  targetType: text('target_type', { enum: ['user', 'study'] }).notNull(),
  targetId: text('target_id').notNull(),
  action: text('action', { enum: ['suspend', 'unsuspend', 'close_study'] }).notNull(),
  reason: text('reason').notNull(),
  createdAt: ts('created_at').notNull(),
});

export const dataRequests = sqliteTable('data_requests', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull().references(() => users.id),
  kind: text('kind', { enum: ['export', 'deletion'] }).notNull(),
  status: text('status', { enum: ['requested', 'completed', 'rejected'] }).notNull(),
  createdAt: ts('created_at').notNull(),
  completedAt: ts('completed_at'),
  exportJson: text('export_json'),
});

export const auditLog = sqliteTable('audit_log', {
  id: text('id').primaryKey(),
  actorId: text('actor_id'),
  action: text('action').notNull(),
  targetType: text('target_type').notNull(),
  targetId: text('target_id').notNull(),
  metaJson: text('meta_json').notNull(),
  at: ts('at').notNull(),
});
```

`apps/api/src/db/client.ts`:
```ts
import Database from 'better-sqlite3';
import { drizzle, type BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as schema from './schema';

export type Db = BetterSQLite3Database<typeof schema> & { $client: Database.Database };
const MIGRATIONS = resolve(dirname(fileURLToPath(import.meta.url)), '../../drizzle');

export function openDb(file: string): Db {
  if (file !== ':memory:') mkdirSync(dirname(file), { recursive: true });
  const sqlite = new Database(file);
  sqlite.pragma('journal_mode = WAL');
  sqlite.pragma('foreign_keys = ON');
  sqlite.pragma('busy_timeout = 5000');
  const db = drizzle(sqlite, { schema }) as Db;
  migrate(db, { migrationsFolder: MIGRATIONS });
  return db;
}
```

`apps/api/src/services/ports.ts`:
```ts
import { DomainError } from '@pocketqa/domain';
import type { ChainSnapshot } from '@pocketqa/wallet-auth';

export interface MediaStore {
  beginWrite(): { key: string; tempPath: string };
  commit(key: string, tempPath: string): Promise<void>;
  abort(tempPath: string): Promise<void>;
  pathFor(key: string): string;
  remove(key: string): Promise<void>;
}

export interface ChainPort {
  getGenesisHash(): Promise<string>;
  getSignatureStatus(signature: string): Promise<ChainSnapshot['signatureStatus']>;
  getParsedTransaction(signature: string): Promise<ChainSnapshot['transaction']>;
  getBlockHeight(): Promise<bigint>;
}

export interface AiSuggestInput {
  tasks: { id: string; title: string }[];
  results: { taskId: string; outcome: string; difficulty: number; note: string }[];
}
export interface AiSuggestOutput {
  model: string;
  findings: { title: string; severity: 'critical' | 'major' | 'minor' | 'info'; rationale: string; taskIds: string[] }[];
}
export interface AiProvider { readonly id: string; readonly available: boolean; suggest(input: AiSuggestInput): Promise<AiSuggestOutput> }

/** Default provider: honest unavailability, never placeholder output (R7, R35). */
export const noneAiProvider: AiProvider = {
  id: 'none',
  available: false,
  async suggest() {
    throw new DomainError('AI_PROVIDER_UNAVAILABLE', 'AI suggestions unavailable — no AI provider is configured. Review the evidence manually.');
  },
};

export function createUnavailableChainPort(): ChainPort {
  const fail = async (): Promise<never> => { throw new Error('Chain port not configured'); };
  return { getGenesisHash: fail, getSignatureStatus: fail, getParsedTransaction: fail, getBlockHeight: fail };
}
```

`apps/api/src/lib/http-errors.ts`:
```ts
import { ERROR_HTTP_STATUS, type ErrorCode } from '@pocketqa/contracts';
import { DomainError } from '@pocketqa/domain';
import { ZodError } from 'zod';

export function toHttpError(err: unknown): { status: number; code: ErrorCode; message: string } {
  if (err instanceof DomainError) return { status: ERROR_HTTP_STATUS[err.code], code: err.code, message: err.message };
  if (err instanceof ZodError) {
    return { status: 400, code: 'VALIDATION_FAILED', message: err.issues.map((i) => `${i.path.join('.') || 'body'}: ${i.message}`).join('; ') };
  }
  const e = err as { code?: string; statusCode?: number };
  if (e.code === 'FST_ERR_CTP_INVALID_MEDIA_TYPE') return { status: 415, code: 'UNSUPPORTED_MEDIA_TYPE', message: 'Unsupported content type' };
  if (e.code === 'FST_ERR_CTP_BODY_TOO_LARGE') return { status: 413, code: 'PAYLOAD_TOO_LARGE', message: 'Request body is too large' };
  if (e.code === 'FST_ERR_CTP_INVALID_JSON_BODY' || e.code === 'FST_ERR_CTP_EMPTY_JSON_BODY') return { status: 400, code: 'VALIDATION_FAILED', message: 'Invalid JSON body' };
  if (e.statusCode === 429) return { status: 429, code: 'RATE_LIMITED', message: 'Too many requests. Try again in a minute.' };
  return { status: 500, code: 'INTERNAL', message: 'Something went wrong' };
}
```

`apps/api/src/lib/redact.ts`:
```ts
/** Defense in depth: the request serializer below already omits headers and query strings. */
export const LOG_REDACT_PATHS = ['req.headers.authorization', 'req.headers.cookie', '*.password', '*.token', '*.email', '*.signatureB64', '*.signedMessageB64'];

export function serializeRequest(req: { method: string; url: string; id?: string }) {
  return { method: req.method, url: req.url.split('?')[0], id: req.id };
}
```

`apps/api/src/app.ts`:
```ts
import cors from '@fastify/cors';
import rateLimit from '@fastify/rate-limit';
import Fastify, { type FastifyInstance } from 'fastify';
import { randomUUID } from 'node:crypto';
import type { AppConfig } from './config';
import type { Db } from './db/client';
import { toHttpError } from './lib/http-errors';
import { LOG_REDACT_PATHS, serializeRequest } from './lib/redact';
import { registerRoutes } from './routes';
import type { AiProvider, ChainPort, MediaStore } from './services/ports';

export interface AppDeps {
  config: AppConfig; db: Db; media: MediaStore; chain: ChainPort; ai: AiProvider; now?: () => Date; logStream?: NodeJS.WritableStream;
}
export interface AppContext { config: AppConfig; db: Db; media: MediaStore; chain: ChainPort; ai: AiProvider; now: () => Date }

declare module 'fastify' {
  interface FastifyInstance {
    ctx: AppContext;
    chainGuard: { state: 'ok' | 'unverified' };
    registeredRoutes: Array<{ method: string; url: string }>;
  }
}

export async function buildApp(deps: AppDeps): Promise<FastifyInstance> {
  const app = Fastify({
    logger: {
      level: 'info',
      redact: { paths: LOG_REDACT_PATHS, censor: '[redacted]' },
      serializers: { req: serializeRequest },
      ...(deps.logStream ? { stream: deps.logStream } : {}),
    },
    genReqId: () => randomUUID(),
    bodyLimit: 1024 * 1024, // JSON only; media uploads stream with their own limit (T2.8)
  });
  app.decorate('ctx', { config: deps.config, db: deps.db, media: deps.media, chain: deps.chain, ai: deps.ai, now: deps.now ?? (() => new Date()) });
  app.decorate('chainGuard', { state: 'unverified' as 'ok' | 'unverified' });
  app.decorate('registeredRoutes', [] as Array<{ method: string; url: string }>);
  app.addHook('onRoute', (route) => {
    // HEAD mirrors GET and OPTIONS is the CORS preflight; neither carries its own authorization logic.
    for (const method of [route.method].flat()) if (method !== 'HEAD' && method !== 'OPTIONS') app.registeredRoutes.push({ method, url: route.url });
  });

  await app.register(cors, { origin: [deps.config.WEB_ORIGIN], methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'] });
  await app.register(rateLimit, { global: false });
  app.addHook('onSend', async (_req, reply, payload) => {
    reply.header('X-Content-Type-Options', 'nosniff');
    reply.header('Referrer-Policy', 'no-referrer');
    if (!reply.getHeader('Cache-Control')) reply.header('Cache-Control', 'no-store');
    return payload;
  });
  app.setErrorHandler((err, req, reply) => {
    const e = toHttpError(err);
    if (e.status >= 500) req.log.error({ err }, 'unhandled error');
    void reply.status(e.status).send({ error: { code: e.code, message: e.message, requestId: req.id } });
  });
  app.setNotFoundHandler((req, reply) => {
    void reply.status(404).send({ error: { code: 'NOT_FOUND', message: 'Not found', requestId: req.id } });
  });
  await app.register(registerRoutes, { prefix: '/v1' });
  return app;
}
```

`apps/api/src/routes/index.ts`:
```ts
import type { FastifyInstance } from 'fastify';
import { healthRoutes } from './health';

export async function registerRoutes(v1: FastifyInstance): Promise<void> {
  await healthRoutes(v1);
}
```

`apps/api/src/routes/health.ts`:
```ts
import type { FastifyInstance } from 'fastify';

export async function healthRoutes(app: FastifyInstance): Promise<void> {
  app.get('/health', async () => ({ ok: true as const, cluster: 'devnet' as const, chainGuard: app.chainGuard.state, aiProvider: app.ctx.ai.id }));
}
```

Generate the migrations:
```bash
pnpm --filter @pocketqa/api db:generate
pnpm --filter @pocketqa/api exec drizzle-kit generate --custom --name audit_append_only
```
Then write `apps/api/drizzle/0001_audit_append_only.sql`:
```sql
CREATE TRIGGER audit_log_no_update BEFORE UPDATE ON audit_log BEGIN SELECT RAISE(ABORT, 'audit_log is append-only'); END;
--> statement-breakpoint
CREATE TRIGGER audit_log_no_delete BEFORE DELETE ON audit_log BEGIN SELECT RAISE(ABORT, 'audit_log is append-only'); END;
```

- [ ] **Step 4: Run** — `pnpm --filter @pocketqa/api test && pnpm --filter @pocketqa/api typecheck` → `13 passed`; typecheck exit 0.
- [ ] **Step 5: Commit** — all files above, `apps/api/drizzle/`, `pnpm-lock.yaml`; message `feat(api): foundation with config, schema, app factory and health`.

### Task T2.2: Ports and test harness

**Files:**
- Create: `apps/api/src/services/media-store.ts`, `apps/api/src/services/chain.ts`, `apps/api/src/server.ts`, `apps/api/test/helpers.ts`
- Test: `apps/api/test/media-store.test.ts`, `apps/api/test/harness.test.ts`

**Interfaces:**
- Consumes: the ports from T2.1.
- Produces:
  - `createFsMediaStore(dir): MediaStore`.
  - `createFakeChainPort(script?: FakeChainScript): ChainPort & { script: FakeChainScript }`, where `FakeChainScript = { genesisHash?; unreachable?; statuses?; transactions?; blockHeight? }`.
  - `makeTestApp(opts?: { env?; chain?; ai?; now? }) → { app, db, chain, logs, dir, close() }`.
  - `mutableClock(startIso?) → { get(): Date; advanceMs(ms): void }`.

- [ ] **Step 1: Write the failing tests**

`apps/api/test/media-store.test.ts`:
```ts
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createFsMediaStore } from '../src/services/media-store';

describe('fs media store', () => {
  it('commits written files under uuid keys and removes them', async () => {
    const store = createFsMediaStore(mkdtempSync(join(tmpdir(), 'media-')));
    const { key, tempPath } = store.beginWrite();
    writeFileSync(tempPath, 'bytes');
    await store.commit(key, tempPath);
    expect(readFileSync(store.pathFor(key), 'utf8')).toBe('bytes');
    await store.remove(key);
    expect(existsSync(store.pathFor(key))).toBe(false);
  });
  it('rejects keys that are not uuids (no path traversal)', () => {
    const store = createFsMediaStore(mkdtempSync(join(tmpdir(), 'media-')));
    expect(() => store.pathFor('../../etc/passwd')).toThrowError('Invalid media key');
  });
});
```

`apps/api/test/harness.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { makeTestApp, mutableClock } from './helpers';

describe('test harness', () => {
  it('builds an isolated app with a fake devnet chain', async () => {
    const t = await makeTestApp();
    expect((await t.app.inject({ method: 'GET', url: '/v1/health' })).json().aiProvider).toBe('none');
    expect(await t.chain.getGenesisHash()).toBe('EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG');
    await t.close();
  });
  it('provides a controllable clock', () => {
    const clock = mutableClock('2026-10-02T10:00:00Z');
    clock.advanceMs(1000);
    expect(clock.get().toISOString()).toBe('2026-10-02T10:00:01.000Z');
  });
});
```

- [ ] **Step 2: Run to verify failure** — FAIL: cannot resolve `../src/services/media-store`.

- [ ] **Step 3: Implement**

`apps/api/src/services/media-store.ts`:
```ts
import { randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { rename, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import type { MediaStore } from './ports';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** Files are named by random UUID only; nothing user-supplied ever reaches a path (A13 tampering/disclosure). */
export function createFsMediaStore(dir: string): MediaStore {
  const root = resolve(dir);
  mkdirSync(root, { recursive: true, mode: 0o700 });
  const pathFor = (key: string) => {
    if (!UUID.test(key)) throw new Error('Invalid media key');
    return join(root, `${key}.bin`);
  };
  return {
    beginWrite() {
      const key = randomUUID();
      return { key, tempPath: join(root, `${key}.part`) };
    },
    async commit(key, tempPath) { await rename(tempPath, pathFor(key)); },
    async abort(tempPath) { await rm(tempPath, { force: true }); },
    pathFor,
    async remove(key) { await rm(pathFor(key), { force: true }); },
  };
}
```

`apps/api/src/services/chain.ts`:
```ts
import { DEVNET_GENESIS_HASH, type ChainSnapshot } from '@pocketqa/wallet-auth';
import type { ChainPort } from './ports';

export interface FakeChainScript {
  genesisHash?: string;
  unreachable?: boolean;
  statuses?: Record<string, ChainSnapshot['signatureStatus']>;
  transactions?: Record<string, ChainSnapshot['transaction']>;
  blockHeight?: bigint;
}

/** Test double: tests mutate `script` between calls to simulate the chain advancing. */
export function createFakeChainPort(script: FakeChainScript = {}): ChainPort & { script: FakeChainScript } {
  const reachable = () => { if (script.unreachable) throw new Error('fake RPC unreachable'); };
  return {
    script,
    async getGenesisHash() { reachable(); return script.genesisHash ?? DEVNET_GENESIS_HASH; },
    async getSignatureStatus(sig) { reachable(); return script.statuses?.[sig] ?? null; },
    async getParsedTransaction(sig) { reachable(); return script.transactions?.[sig] ?? null; },
    async getBlockHeight() { reachable(); return script.blockHeight ?? 1000n; },
  };
}
```

`apps/api/src/server.ts` (T2.13 swaps in `resolveAiProvider`; T2.15 swaps in the kit chain port and the guard):
```ts
import { buildApp } from './app';
import { loadConfig } from './config';
import { openDb } from './db/client';
import { createFsMediaStore } from './services/media-store';
import { createUnavailableChainPort, noneAiProvider } from './services/ports';

const config = loadConfig(process.env);
const app = await buildApp({
  config,
  db: openDb(config.DATABASE_FILE),
  media: createFsMediaStore(config.MEDIA_DIR),
  chain: createUnavailableChainPort(),
  ai: noneAiProvider,
});
await app.listen({ host: config.API_HOST, port: config.API_PORT });
```

`apps/api/test/helpers.ts`:
```ts
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Writable } from 'node:stream';
import { buildApp } from '../src/app';
import { loadConfig } from '../src/config';
import { openDb } from '../src/db/client';
import { createFakeChainPort, type FakeChainScript } from '../src/services/chain';
import { createFsMediaStore } from '../src/services/media-store';
import { noneAiProvider, type AiProvider } from '../src/services/ports';

export interface TestAppOptions { env?: Record<string, string>; chain?: FakeChainScript; ai?: AiProvider; now?: () => Date }

export async function makeTestApp(opts: TestAppOptions = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'pocketqa-api-'));
  const logs: string[] = [];
  const logStream = new Writable({ write(chunk, _e, cb) { logs.push(String(chunk)); cb(); } });
  const config = loadConfig({
    NODE_ENV: 'test',
    PLAYBACK_TOKEN_SECRET: 'test-only-playback-secret-0123456789abcdef', // check-secrets: allow (fake fixture)
    DATABASE_FILE: join(dir, 'db.sqlite'),
    MEDIA_DIR: join(dir, 'media'),
    ...opts.env,
  });
  const db = openDb(config.DATABASE_FILE);
  const chain = createFakeChainPort(opts.chain);
  const app = await buildApp({ config, db, media: createFsMediaStore(config.MEDIA_DIR), chain, ai: opts.ai ?? noneAiProvider, now: opts.now, logStream });
  await app.ready();
  return {
    app, db, chain, logs, dir,
    async close() { await app.close(); db.$client.close(); rmSync(dir, { recursive: true, force: true }); },
  };
}

export function mutableClock(startIso = '2026-10-02T10:00:00Z') {
  let now = new Date(startIso);
  return { get: () => now, advanceMs: (ms: number) => { now = new Date(now.getTime() + ms); } };
}
```

- [ ] **Step 4: Run** — `pnpm --filter @pocketqa/api test` → `17 passed`.
- [ ] **Step 5: Commit** — the files above; message `feat(api): media store, fake chain port, test harness`.

### Task T2.3: Auth — register, login, logout, me, sessions, rate limits

**Files:**
- Create: `apps/api/src/lib/passwords.ts`, `apps/api/src/lib/tokens.ts`, `apps/api/src/lib/sessions.ts`, `apps/api/src/lib/audit.ts`, `apps/api/src/plugins/auth.ts`, `apps/api/src/routes/auth.ts`, `apps/api/test/fixtures.ts`
- Modify: `apps/api/src/app.ts` — after `await app.register(rateLimit, { global: false });` add `installAuth(app);` with `import { installAuth } from './plugins/auth';`
- Modify: `apps/api/src/routes/index.ts` — add `await authRoutes(v1);` with its import
- Test: `apps/api/test/auth.test.ts`

**Interfaces:**
- Produces:
  - `hashPassword`, `verifyPassword`.
  - `newSessionToken()`, `hashToken(t)`, `signPlaybackToken(secret, evidenceId, userId, expMs)`, `verifyPlaybackToken(secret, evidenceId, token, nowMs) → { userId } | null`, `PLAYBACK_TTL_MS`.
  - `createSession(db, userId, now) → { token, expiresAt }`.
  - `appendAudit(db, entry, now)`.
  - `installAuth(app)`, `requireUser(req)`, `requireRole(req, ...roles)`, `type AuthUser`.
  - `toUserDto(row)`.
  - Fixtures `registerAs`, `bearer`, `createAdminSession`.

- [ ] **Step 1: Write the failing test** — `apps/api/test/auth.test.ts`:

```ts
import { eq } from 'drizzle-orm';
import { afterEach, describe, expect, it } from 'vitest';
import { users } from '../src/db/schema';
import { bearer, registerAs } from './fixtures';
import { makeTestApp, mutableClock } from './helpers';

let t: Awaited<ReturnType<typeof makeTestApp>>;
afterEach(async () => t?.close());
const login = (email: string, password: string) => t.app.inject({ method: 'POST', url: '/v1/auth/login', payload: { email, password } });

describe('auth', () => {
  it('registers a tester whose token works', async () => {
    t = await makeTestApp();
    const { token } = await registerAs(t.app, 'tester');
    const me = await t.app.inject({ method: 'GET', url: '/v1/me', headers: bearer(token) });
    expect(me.statusCode).toBe(200);
    expect(me.json().user.role).toBe('tester');
  });
  it('rejects duplicates, weak passwords, missing adult attestation and self-made admins', async () => {
    t = await makeTestApp();
    const { email } = await registerAs(t.app, 'tester');
    const reg = (payload: object) => t.app.inject({ method: 'POST', url: '/v1/auth/register', payload });
    const base = { email: 'new@example.test', password: 'correct horse battery', role: 'tester', displayName: 'N', adultAttested: true };
    expect((await reg({ ...base, email })).json().error.code).toBe('CONFLICT');
    expect((await reg({ ...base, password: 'short' })).statusCode).toBe(400);
    expect((await reg({ ...base, adultAttested: false })).statusCode).toBe(400);
    expect((await reg({ ...base, role: 'admin' })).statusCode).toBe(400);
  });
  it('returns the same error for a wrong password and an unknown email', async () => {
    t = await makeTestApp();
    const { email } = await registerAs(t.app, 'builder');
    const a = await login(email, 'wrong password!!');
    const b = await login('nobody@example.test', 'wrong password!!');
    expect(a.statusCode).toBe(401);
    expect(a.json().error.message).toBe(b.json().error.message);
    expect((await login(email, 'correct horse battery')).statusCode).toBe(200);
  });
  it('revokes the token on logout', async () => {
    t = await makeTestApp();
    const { token } = await registerAs(t.app, 'tester');
    expect((await t.app.inject({ method: 'POST', url: '/v1/auth/logout', headers: bearer(token) })).statusCode).toBe(204);
    expect((await t.app.inject({ method: 'GET', url: '/v1/me', headers: bearer(token) })).statusCode).toBe(401);
  });
  it('blocks suspended accounts', async () => {
    t = await makeTestApp();
    const { token, userId, email } = await registerAs(t.app, 'tester');
    t.db.update(users).set({ status: 'suspended' }).where(eq(users.id, userId)).run();
    expect((await t.app.inject({ method: 'GET', url: '/v1/me', headers: bearer(token) })).statusCode).toBe(403);
    expect((await login(email, 'correct horse battery')).statusCode).toBe(403);
  });
  it('expires sessions after 7 days', async () => {
    const clock = mutableClock();
    t = await makeTestApp({ now: clock.get });
    const { token } = await registerAs(t.app, 'tester');
    clock.advanceMs(7 * 24 * 3600 * 1000 + 1);
    expect((await t.app.inject({ method: 'GET', url: '/v1/me', headers: bearer(token) })).statusCode).toBe(401);
  });
  it('rate limits login attempts', async () => {
    t = await makeTestApp();
    const codes: number[] = [];
    for (let i = 0; i < 11; i += 1) codes.push((await login('x@example.test', 'wrong password!!')).statusCode);
    expect(codes.at(-1)).toBe(429);
  });
  it('never logs passwords, emails or tokens', async () => {
    t = await makeTestApp();
    const { token, email } = await registerAs(t.app, 'tester');
    await t.app.inject({ method: 'GET', url: '/v1/me', headers: bearer(token) });
    const all = t.logs.join('');
    for (const secret of ['correct horse battery', email, token]) expect(all).not.toContain(secret);
  });
});
```

`apps/api/test/fixtures.ts`:
```ts
import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import type { Db } from '../src/db/client';
import { users } from '../src/db/schema';
import { createSession } from '../src/lib/sessions';

export const PASSWORD = 'correct horse battery';
export const bearer = (token: string) => ({ authorization: `Bearer ${token}` });

export async function registerAs(app: FastifyInstance, role: 'tester' | 'builder', email = `${role}-${randomUUID()}@example.test`) {
  const res = await app.inject({ method: 'POST', url: '/v1/auth/register', payload: { email, password: PASSWORD, role, displayName: role, adultAttested: true } });
  if (res.statusCode !== 201) throw new Error(`register failed: ${res.body}`);
  return { token: res.json().token as string, userId: res.json().user.id as string, email };
}

export function createAdminSession(db: Db, now: Date) {
  const id = randomUUID();
  db.insert(users).values({ id, email: `admin-${id}@example.test`, passwordHash: null, role: 'admin', displayName: 'Admin', status: 'active', adultAttestedAt: now, createdAt: now }).run();
  return { token: createSession(db, id, now).token, userId: id };
}
```

- [ ] **Step 2: Run to verify failure** — FAIL: cannot resolve `../src/lib/sessions`.

- [ ] **Step 3: Implement**

`apps/api/src/lib/passwords.ts`:
```ts
import { hash, verify } from '@node-rs/argon2';

// argon2id (library default) with the OWASP baseline: 19 MiB memory, 2 iterations, 1 lane.
const OPTIONS = { memoryCost: 19456, timeCost: 2, parallelism: 1 };
export const hashPassword = (password: string) => hash(password, OPTIONS);
export const verifyPassword = (stored: string, password: string) => verify(stored, password);
```

`apps/api/src/lib/tokens.ts`:
```ts
import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

export const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;
export const PLAYBACK_TTL_MS = 120_000;

export function newSessionToken() {
  const token = randomBytes(32).toString('base64url');
  return { token, hash: hashToken(token) };
}
export const hashToken = (token: string) => createHash('sha256').update(token).digest('hex');

/** Playback tokens bind evidence id + user id + expiry; the stream route re-checks authorization (A13). */
export function signPlaybackToken(secret: string, evidenceId: string, userId: string, expiresAtMs: number): string {
  const body = Buffer.from(`${userId}.${expiresAtMs}`).toString('base64url');
  const mac = createHmac('sha256', secret).update(`${evidenceId}.${body}`).digest('base64url');
  return `${body}.${mac}`;
}
export function verifyPlaybackToken(secret: string, evidenceId: string, token: string, nowMs: number): { userId: string } | null {
  const [body, mac] = token.split('.');
  if (!body || !mac) return null;
  const expected = Buffer.from(createHmac('sha256', secret).update(`${evidenceId}.${body}`).digest('base64url'));
  const given = Buffer.from(mac);
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
  const [userId, exp] = Buffer.from(body, 'base64url').toString().split('.');
  if (!userId || !exp || Number(exp) < nowMs) return null;
  return { userId };
}
```

`apps/api/src/lib/sessions.ts`:
```ts
import { randomUUID } from 'node:crypto';
import type { Db } from '../db/client';
import { sessions } from '../db/schema';
import { newSessionToken, SESSION_TTL_MS } from './tokens';

/** Only the SHA-256 of the token is stored; the plaintext exists once, in this response (ADR-04). */
export function createSession(db: Db, userId: string, now: Date) {
  const { token, hash } = newSessionToken();
  const expiresAt = new Date(now.getTime() + SESSION_TTL_MS);
  db.insert(sessions).values({ id: randomUUID(), userId, tokenHash: hash, createdAt: now, expiresAt }).run();
  return { token, expiresAt };
}
```

`apps/api/src/lib/audit.ts`:
```ts
import { randomUUID } from 'node:crypto';
import type { Db } from '../db/client';
import { auditLog } from '../db/schema';

export interface AuditEntry {
  actorId: string | null;
  action: string;
  targetType: string;
  targetId: string;
  meta?: Record<string, string | number | boolean | null>;
}

/** Append-only by construction: no update/delete exists here and DB triggers abort them (T2.1). Never put PII in meta. */
export function appendAudit(db: Db, e: AuditEntry, now: Date): void {
  db.insert(auditLog).values({ id: randomUUID(), actorId: e.actorId, action: e.action, targetType: e.targetType, targetId: e.targetId, metaJson: JSON.stringify(e.meta ?? {}), at: now }).run();
}
```

`apps/api/src/plugins/auth.ts`:
```ts
import { and, eq, gt, isNull } from 'drizzle-orm';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { DomainError } from '@pocketqa/domain';
import { sessions, users } from '../db/schema';
import { hashToken } from '../lib/tokens';

export interface AuthUser { id: string; role: 'tester' | 'builder' | 'admin'; status: 'active' | 'suspended' | 'deleted'; sessionId: string }

declare module 'fastify' {
  interface FastifyRequest { user: AuthUser | null }
}

/** Roles always come from the database row, never from the client (A13 elevation). */
export function installAuth(app: FastifyInstance): void {
  app.decorateRequest('user', null);
  app.addHook('onRequest', async (req) => {
    const header = req.headers.authorization;
    if (!header?.startsWith('Bearer ')) return;
    const row = app.ctx.db
      .select({ sessionId: sessions.id, id: users.id, role: users.role, status: users.status })
      .from(sessions)
      .innerJoin(users, eq(users.id, sessions.userId))
      .where(and(eq(sessions.tokenHash, hashToken(header.slice(7))), isNull(sessions.revokedAt), gt(sessions.expiresAt, app.ctx.now())))
      .get();
    if (row) req.user = { id: row.id, role: row.role, status: row.status, sessionId: row.sessionId };
  });
}

export function requireUser(req: FastifyRequest): AuthUser {
  if (!req.user) throw new DomainError('UNAUTHENTICATED', 'Sign in required');
  if (req.user.status !== 'active') throw new DomainError('FORBIDDEN', 'This account is suspended');
  return req.user;
}

export function requireRole(req: FastifyRequest, ...roles: AuthUser['role'][]): AuthUser {
  const user = requireUser(req);
  if (!roles.includes(user.role)) throw new DomainError('FORBIDDEN', 'This action is not available for your role');
  return user;
}
```

`apps/api/src/routes/auth.ts`:
```ts
import { randomUUID } from 'node:crypto';
import { and, eq, isNull } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { LoginRequestSchema, RegisterRequestSchema } from '@pocketqa/contracts';
import { DomainError } from '@pocketqa/domain';
import { deviceProfiles, sessions, users, walletLinks } from '../db/schema';
import { appendAudit } from '../lib/audit';
import { hashPassword, verifyPassword } from '../lib/passwords';
import { createSession } from '../lib/sessions';
import { requireUser } from '../plugins/auth';

type UserRow = typeof users.$inferSelect;
export const toUserDto = (u: UserRow) => ({ id: u.id, email: u.email, role: u.role, displayName: u.displayName, status: u.status });

let dummyHash: Promise<string> | null = null; // equalizes timing for unknown emails
const LIMITED = { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } };

export async function authRoutes(app: FastifyInstance): Promise<void> {
  app.post('/auth/register', LIMITED, async (req, reply) => {
    const body = RegisterRequestSchema.parse(req.body);
    const { db } = app.ctx;
    const now = app.ctx.now();
    const email = body.email.toLowerCase();
    if (db.select({ id: users.id }).from(users).where(eq(users.email, email)).get()) {
      throw new DomainError('CONFLICT', 'An account with this email already exists');
    }
    const id = randomUUID();
    db.insert(users).values({ id, email, passwordHash: await hashPassword(body.password), role: body.role, displayName: body.displayName, status: 'active', adultAttestedAt: now, createdAt: now }).run();
    const session = createSession(db, id, now);
    appendAudit(db, { actorId: id, action: 'user.register', targetType: 'user', targetId: id, meta: { role: body.role } }, now);
    return reply.status(201).send({ user: toUserDto(db.select().from(users).where(eq(users.id, id)).get()!), token: session.token, expiresAt: session.expiresAt.toISOString() });
  });

  app.post('/auth/login', LIMITED, async (req) => {
    const body = LoginRequestSchema.parse(req.body);
    const user = app.ctx.db.select().from(users).where(eq(users.email, body.email.toLowerCase())).get();
    dummyHash ??= hashPassword('pocketqa-timing-equalizer');
    const ok = await verifyPassword(user?.passwordHash ?? (await dummyHash), body.password);
    if (!user || !ok || user.status === 'deleted') throw new DomainError('UNAUTHENTICATED', 'Email or password is incorrect');
    if (user.status === 'suspended') throw new DomainError('FORBIDDEN', 'This account is suspended');
    const session = createSession(app.ctx.db, user.id, app.ctx.now());
    return { user: toUserDto(user), token: session.token, expiresAt: session.expiresAt.toISOString() };
  });

  app.post('/auth/logout', async (req, reply) => {
    const user = requireUser(req);
    app.ctx.db.update(sessions).set({ revokedAt: app.ctx.now() }).where(eq(sessions.id, user.sessionId)).run();
    return reply.status(204).send();
  });

  app.get('/me', async (req) => {
    const user = requireUser(req);
    const { db } = app.ctx;
    const row = db.select().from(users).where(eq(users.id, user.id)).get()!;
    const profile = db.select().from(deviceProfiles).where(eq(deviceProfiles.userId, user.id)).get() ?? null;
    const link = db.select().from(walletLinks).where(and(eq(walletLinks.userId, user.id), isNull(walletLinks.unlinkedAt))).get();
    return {
      user: toUserDto(row),
      deviceProfile: profile,
      wallet: link ? { address: link.address, chain: link.chain, linkedAt: link.linkedAt.toISOString() } : null,
    };
  });
}
```

- [ ] **Step 4: Run** — `pnpm --filter @pocketqa/api test` → `25 passed`.
- [ ] **Step 5: Commit** — the files above; message `feat(api): auth with hashed sessions, rate limits and log hygiene`.

### Task T2.4: Access helpers and test-only hooks

**Files:**
- Create: `apps/api/src/lib/access.ts`, `apps/api/src/plugins/test-hooks.ts`, `apps/api/src/dev/seed.ts`
- Modify: `apps/api/src/routes/index.ts` — append:
  ```ts
  // Registered only behind a server-only flag outside production; otherwise the route does not exist (IR3).
  if (v1.ctx.config.POCKETQA_TEST_HOOKS === '1' && v1.ctx.config.NODE_ENV !== 'production') await testHookRoutes(v1);
  ```
- Test: `apps/api/test/access.test.ts`, `apps/api/test/test-hooks.test.ts`

**Interfaces:**
- Produces:
  - `loadOwnedStudy(app, studyId, builderId)`, `loadOwnParticipation(app, participationId, testerId)`, `loadSubmissionForViewer(app, participationId, user)`, `loadEvidenceForViewer(app, evidenceId, user)`. Each throws `NOT_FOUND` for non-owners.
  - `seedScenario(app, scenario)` returning `{ users: Record<'builder' | 'builder2' | 'tester' | 'tester2' | 'admin', { id; email; password; token }> }`. T2.10 adds the `submitted-session` scenario.

- [ ] **Step 1: Write the failing tests**

`apps/api/test/access.test.ts`:
```ts
import { randomUUID } from 'node:crypto';
import { afterEach, describe, expect, it } from 'vitest';
import { participations, studies } from '../src/db/schema';
import { loadOwnParticipation, loadOwnedStudy } from '../src/lib/access';
import { registerAs } from './fixtures';
import { makeTestApp } from './helpers';

let t: Awaited<ReturnType<typeof makeTestApp>>;
afterEach(async () => t?.close());

describe('access helpers', () => {
  it('return 404-style errors to non-owners instead of revealing existence', async () => {
    t = await makeTestApp();
    const owner = await registerAs(t.app, 'builder');
    const other = await registerAs(t.app, 'builder');
    const tester = await registerAs(t.app, 'tester');
    const now = new Date();
    const studyId = randomUUID();
    t.db.insert(studies).values({ id: studyId, builderId: owner.userId, title: 'Study', appName: 'App', appLink: 'https://x.test', goal: 'Find friction', status: 'draft', rewardCredits: 10, slotsTotal: 1, aiProcessingEnabled: false, createdAt: now }).run();
    const pid = randomUUID();
    t.db.insert(participations).values({ id: pid, studyId, testerId: tester.userId, status: 'claimed', claimedAt: now }).run();
    expect(loadOwnedStudy(t.app, studyId, owner.userId).id).toBe(studyId);
    expect(() => loadOwnedStudy(t.app, studyId, other.userId)).toThrowError('Study not found');
    expect(loadOwnParticipation(t.app, pid, tester.userId).id).toBe(pid);
    expect(() => loadOwnParticipation(t.app, pid, owner.userId)).toThrowError('Participation not found');
  });
});
```

`apps/api/test/test-hooks.test.ts`:
```ts
import { afterEach, describe, expect, it } from 'vitest';
import { makeTestApp } from './helpers';

let t: Awaited<ReturnType<typeof makeTestApp>>;
afterEach(async () => t?.close());
const seed = () => t.app.inject({ method: 'POST', url: '/v1/__test__/seed', payload: { scenario: 'users' } });

describe('test hooks', () => {
  it('do not exist without the server-only flag', async () => {
    t = await makeTestApp({ env: { POCKETQA_TEST_HOOKS: '0' } });
    expect((await seed()).statusCode).toBe(404);
    expect(t.app.registeredRoutes.some((r) => r.url.includes('__test__'))).toBe(false);
  });
  it('seed labeled demo users when enabled in a non-production run', async () => {
    t = await makeTestApp({ env: { POCKETQA_TEST_HOOKS: '1' } });
    const res = await seed();
    expect(res.statusCode).toBe(200);
    expect(Object.keys(res.json().users).sort()).toEqual(['admin', 'builder', 'builder2', 'tester', 'tester2']);
    const me = await t.app.inject({ method: 'GET', url: '/v1/me', headers: { authorization: `Bearer ${res.json().users.builder.token}` } });
    expect(me.json().user.displayName).toBe('Demo builder (seed)');
  });
});
```

- [ ] **Step 2: Run to verify failure** — FAIL: cannot resolve `../src/lib/access`.

- [ ] **Step 3: Implement**

`apps/api/src/lib/access.ts`:
```ts
import { eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { DomainError } from '@pocketqa/domain';
import { evidenceItems, participations, studies } from '../db/schema';
import type { AuthUser } from '../plugins/auth';

// Non-owners always get NOT_FOUND, so IDs cannot be probed for existence (A7 conventions, A13 IDOR).
export function loadOwnedStudy(app: FastifyInstance, studyId: string, builderId: string) {
  const study = app.ctx.db.select().from(studies).where(eq(studies.id, studyId)).get();
  if (!study || study.builderId !== builderId) throw new DomainError('NOT_FOUND', 'Study not found');
  return study;
}

export function loadOwnParticipation(app: FastifyInstance, participationId: string, testerId: string) {
  const p = app.ctx.db.select().from(participations).where(eq(participations.id, participationId)).get();
  if (!p || p.testerId !== testerId) throw new DomainError('NOT_FOUND', 'Participation not found');
  return p;
}

export function loadSubmissionForViewer(app: FastifyInstance, participationId: string, user: Pick<AuthUser, 'id' | 'role'>) {
  const row = app.ctx.db.select({ p: participations, s: studies }).from(participations)
    .innerJoin(studies, eq(studies.id, participations.studyId)).where(eq(participations.id, participationId)).get();
  const allowed = row && (user.role === 'admin' || (user.role === 'builder' && row.s.builderId === user.id));
  if (!row || !allowed) throw new DomainError('NOT_FOUND', 'Submission not found');
  return { participation: row.p, study: row.s };
}

export function loadEvidenceForViewer(app: FastifyInstance, evidenceId: string, user: Pick<AuthUser, 'id' | 'role'>) {
  const row = app.ctx.db.select({ e: evidenceItems, p: participations, s: studies }).from(evidenceItems)
    .innerJoin(participations, eq(participations.id, evidenceItems.participationId))
    .innerJoin(studies, eq(studies.id, participations.studyId))
    .where(eq(evidenceItems.id, evidenceId)).get();
  const allowed = row && (
    user.role === 'admin' ||
    (user.role === 'tester' && row.p.testerId === user.id) ||
    (user.role === 'builder' && row.s.builderId === user.id)
  );
  if (!row || !allowed) throw new DomainError('NOT_FOUND', 'Evidence not found');
  return { evidence: row.e, participation: row.p, study: row.s };
}
```

`apps/api/src/dev/seed.ts`:
```ts
import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { users } from '../db/schema';
import { hashPassword } from '../lib/passwords';
import { createSession } from '../lib/sessions';

// Test-only fixture password for throwaway E2E databases; it never protects real data.
export const SEED_PASSWORD = 'pocketqa e2e fixture pw';
type SeedUserKey = 'builder' | 'builder2' | 'tester' | 'tester2' | 'admin';
export interface SeedUser { id: string; email: string; password: string; token: string }

async function seedUser(app: FastifyInstance, key: SeedUserKey): Promise<SeedUser> {
  const role = key.startsWith('builder') ? 'builder' : key.startsWith('tester') ? 'tester' : 'admin';
  const id = randomUUID();
  const email = `${key}-${id.slice(0, 8)}@seed.pocketqa.invalid`;
  const now = app.ctx.now();
  app.ctx.db.insert(users).values({
    id, email, passwordHash: await hashPassword(SEED_PASSWORD), role,
    displayName: `Demo ${role} (seed)`, status: 'active', adultAttestedAt: now, createdAt: now,
  }).run();
  return { id, email, password: SEED_PASSWORD, token: createSession(app.ctx.db, id, now).token };
}

export async function seedScenario(app: FastifyInstance, scenario: 'users') {
  const keys: SeedUserKey[] = ['builder', 'builder2', 'tester', 'tester2', 'admin'];
  const seeded = {} as Record<SeedUserKey, SeedUser>;
  for (const key of keys) seeded[key] = await seedUser(app, key);
  return { scenario, users: seeded };
}
```

`apps/api/src/plugins/test-hooks.ts`:
```ts
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { seedScenario } from '../dev/seed';

const SeedBody = z.object({ scenario: z.enum(['users']) });

export async function testHookRoutes(app: FastifyInstance): Promise<void> {
  app.post('/__test__/seed', async (req) => seedScenario(app, SeedBody.parse(req.body).scenario));
}
```
Add the import to `routes/index.ts`: `import { testHookRoutes } from '../plugins/test-hooks';`

- [ ] **Step 4: Run** — `pnpm --filter @pocketqa/api test` → `28 passed`.
- [ ] **Step 5: Commit** — files above; message `feat(api): owner-scoped access helpers and gated test hooks`.

### Task T2.5: Builder studies — draft, tasks, criteria, consent, funding, lifecycle

**Files:**
- Create: `apps/api/src/routes/studies.ts`, `apps/api/src/lib/study-queries.ts`, `apps/api/src/lib/participation-ops.ts`
- Modify: `apps/api/src/routes/index.ts` (add `await studyRoutes(v1);`)
- Modify: `apps/api/test/fixtures.ts` (add `seedPublishedStudy`)
- Test: `apps/api/test/studies.test.ts`

**Interfaces:**
- Consumes: domain `assertPublishable`, `transitionStudy`, `computeBudget`, `composeConsentText`, `findBannedCopy`.
- Produces:
  - `studyBudget(db, studyId): BudgetSummary` and `slotsTaken(db, studyId): number`.
  - `toStudySummary(db, studyId): StudySummaryDto`.
  - `releaseReservation(db, participation, rewardCredits, actorId, now)`.
  - `expireActiveParticipations(db, studyId, rewardCredits, actorId, now)`.
  - Fixture `seedPublishedStudy(app, builderToken, overrides?) → { studyId, taskIds, consentVersionId }`.

- [ ] **Step 1: Write the failing test** — `apps/api/test/studies.test.ts`:

```ts
import { afterEach, describe, expect, it } from 'vitest';
import { bearer, registerAs, seedPublishedStudy } from './fixtures';
import { makeTestApp } from './helpers';

let t: Awaited<ReturnType<typeof makeTestApp>>;
afterEach(async () => t?.close());
const draft = { title: 'Wallet onboarding', appName: 'DemoApp', appLink: 'https://example.test/app', goal: 'Find where new users get stuck', rewardCredits: 100, slotsTotal: 3, aiProcessingEnabled: false };

describe('builder studies', () => {
  it('creates a draft and reports a test-credit budget', async () => {
    t = await makeTestApp();
    const b = await registerAs(t.app, 'builder');
    const res = await t.app.inject({ method: 'POST', url: '/v1/studies', headers: bearer(b.token), payload: draft });
    expect(res.statusCode).toBe(201);
    expect(res.json()).toMatchObject({ status: 'draft', slotsTaken: 0, budget: { funded: 0, available: 0 } });
  });
  it('rejects misleading earnings copy in builder text', async () => {
    t = await makeTestApp();
    const b = await registerAs(t.app, 'builder');
    const res = await t.app.inject({ method: 'POST', url: '/v1/studies', headers: bearer(b.token), payload: { ...draft, goal: 'Guaranteed earnings for every tester who joins' } });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.message).toContain('guaranteed-earnings');
  });
  it('refuses to publish an unfunded study and lists what is missing', async () => {
    t = await makeTestApp();
    const b = await registerAs(t.app, 'builder');
    const id = (await t.app.inject({ method: 'POST', url: '/v1/studies', headers: bearer(b.token), payload: draft })).json().id;
    const res = await t.app.inject({ method: 'POST', url: `/v1/studies/${id}/publish`, headers: bearer(b.token) });
    expect(res.json().error).toMatchObject({ code: 'VALIDATION_FAILED' });
    expect(res.json().error.message).toContain('Fund the study');
  });
  it('publishes a complete study, prepends the platform consent preamble, and locks edits', async () => {
    t = await makeTestApp();
    const b = await registerAs(t.app, 'builder');
    const { studyId } = await seedPublishedStudy(t.app, b.token);
    const list = await t.app.inject({ method: 'GET', url: '/v1/builder/studies', headers: bearer(b.token) });
    expect(list.json()[0]).toMatchObject({ status: 'published', budget: { funded: 1000, available: 1000 } });
    const tester = await registerAs(t.app, 'tester');
    const detail = await t.app.inject({ method: 'GET', url: `/v1/studies/${studyId}`, headers: bearer(tester.token) });
    expect(detail.json().consent.textMd.startsWith('Pocket QA records your screen only after you tap Start')).toBe(true);
    const edit = await t.app.inject({ method: 'PATCH', url: `/v1/studies/${studyId}`, headers: bearer(b.token), payload: { title: 'New title here' } });
    expect(edit.json().error.code).toBe('INVALID_TRANSITION');
  });
  it('keeps builders out of each other\'s studies and testers out of builder routes', async () => {
    t = await makeTestApp();
    const owner = await registerAs(t.app, 'builder');
    const other = await registerAs(t.app, 'builder');
    const tester = await registerAs(t.app, 'tester');
    const id = (await t.app.inject({ method: 'POST', url: '/v1/studies', headers: bearer(owner.token), payload: draft })).json().id;
    expect((await t.app.inject({ method: 'POST', url: `/v1/studies/${id}/fund`, headers: bearer(other.token), payload: { credits: 10 } })).statusCode).toBe(404);
    expect((await t.app.inject({ method: 'POST', url: '/v1/studies', headers: bearer(tester.token), payload: draft })).statusCode).toBe(403);
  });
  it('rejects more than 10 tasks', async () => {
    t = await makeTestApp();
    const b = await registerAs(t.app, 'builder');
    const id = (await t.app.inject({ method: 'POST', url: '/v1/studies', headers: bearer(b.token), payload: draft })).json().id;
    const task = { title: 'Do it', instructions: 'Follow the onboarding steps', maxMinutes: 3 };
    const res = await t.app.inject({ method: 'PUT', url: `/v1/studies/${id}/tasks`, headers: bearer(b.token), payload: { tasks: Array(11).fill(task) } });
    expect(res.statusCode).toBe(400);
  });
});
```

Add to `apps/api/test/fixtures.ts`:
```ts
export async function seedPublishedStudy(
  app: FastifyInstance,
  builderToken: string,
  overrides: { rewardCredits?: number; slotsTotal?: number; aiProcessingEnabled?: boolean; fund?: number; criteria?: object; tasks?: number } = {},
) {
  const h = bearer(builderToken);
  const draft = {
    title: 'Wallet onboarding', appName: 'DemoApp', appLink: 'https://example.test/app', goal: 'Find where new users get stuck',
    rewardCredits: overrides.rewardCredits ?? 100, slotsTotal: overrides.slotsTotal ?? 3, aiProcessingEnabled: overrides.aiProcessingEnabled ?? false,
  };
  const studyId = (await app.inject({ method: 'POST', url: '/v1/studies', headers: h, payload: draft })).json().id as string;
  const tasks = Array.from({ length: overrides.tasks ?? 2 }, (_, i) => ({ title: `Task ${i + 1}`, instructions: `Complete onboarding step ${i + 1}`, maxMinutes: 5 }));
  await app.inject({ method: 'PUT', url: `/v1/studies/${studyId}/tasks`, headers: h, payload: { tasks } });
  await app.inject({ method: 'PUT', url: `/v1/studies/${studyId}/criteria`, headers: h, payload: overrides.criteria ?? { platforms: ['android'], minAndroidApi: 29, minIosMajor: null, requireSelfReportedSeeker: false } });
  const scopes = draft.aiProcessingEnabled ? ['screen_recording', 'microphone', 'ai_processing'] : ['screen_recording', 'microphone'];
  await app.inject({ method: 'PUT', url: `/v1/studies/${studyId}/consent`, headers: h, payload: { textMd: 'This study tests the wallet onboarding of DemoApp using the provided test wallet only.', scopes } });
  await app.inject({ method: 'POST', url: `/v1/studies/${studyId}/fund`, headers: h, payload: { credits: overrides.fund ?? 1000 } });
  const pub = await app.inject({ method: 'POST', url: `/v1/studies/${studyId}/publish`, headers: h });
  if (pub.statusCode !== 200) throw new Error(`publish failed: ${pub.body}`);
  const detail = (await app.inject({ method: 'GET', url: `/v1/studies/${studyId}`, headers: h })).json();
  return { studyId, taskIds: detail.tasks.map((x: { id: string }) => x.id) as string[], consentVersionId: detail.consent.id as string };
}
```

- [ ] **Step 2: Run to verify failure** — FAIL: `seedPublishedStudy` calls routes that return 404.

- [ ] **Step 3: Implement**

`apps/api/src/lib/study-queries.ts`:
```ts
import { and, asc, desc, eq, notInArray, sql } from 'drizzle-orm';
import { computeBudget } from '@pocketqa/domain';
import type { Db } from '../db/client';
import { consentVersions, deviceCriteria, ledgerEntries, participations, studies, studyTasks } from '../db/schema';

export const studyBudget = (db: Db, studyId: string) =>
  computeBudget(db.select({ kind: ledgerEntries.kind, amount: ledgerEntries.amount }).from(ledgerEntries).where(eq(ledgerEntries.studyId, studyId)).all());

export const slotsTaken = (db: Db, studyId: string): number =>
  db.select({ n: sql<number>`count(*)` }).from(participations)
    .where(and(eq(participations.studyId, studyId), notInArray(participations.status, ['withdrawn', 'expired']))).get()!.n;

export const latestConsent = (db: Db, studyId: string) =>
  db.select().from(consentVersions).where(eq(consentVersions.studyId, studyId)).orderBy(desc(consentVersions.version)).limit(1).get() ?? null;

export const tasksOf = (db: Db, studyId: string) =>
  db.select().from(studyTasks).where(eq(studyTasks.studyId, studyId)).orderBy(asc(studyTasks.position)).all();

export const criteriaOf = (db: Db, studyId: string) => {
  const c = db.select().from(deviceCriteria).where(eq(deviceCriteria.studyId, studyId)).get();
  return c ? { platforms: JSON.parse(c.platformsJson) as ('android' | 'ios')[], minAndroidApi: c.minAndroidApi, minIosMajor: c.minIosMajor, requireSelfReportedSeeker: c.requireSelfReportedSeeker } : null;
};

export function toStudySummary(db: Db, studyId: string) {
  const s = db.select().from(studies).where(eq(studies.id, studyId)).get()!;
  return { id: s.id, title: s.title, appName: s.appName, status: s.status, rewardCredits: s.rewardCredits, slotsTotal: s.slotsTotal, slotsTaken: slotsTaken(db, s.id), budget: studyBudget(db, s.id) };
}
```

`apps/api/src/lib/participation-ops.ts`:
```ts
import { randomUUID } from 'node:crypto';
import { and, eq, inArray } from 'drizzle-orm';
import type { Db } from '../db/client';
import { ledgerEntries, participations } from '../db/schema';

type Participation = typeof participations.$inferSelect;

/** Returns a reserved slot's credits to the study budget exactly once. */
export function releaseReservation(db: Db, p: Participation, rewardCredits: number, actorId: string, now: Date): void {
  if (p.reservationReleasedAt) return;
  db.insert(ledgerEntries).values({ id: randomUUID(), studyId: p.studyId, participationId: p.id, kind: 'release', amount: rewardCredits, createdBy: actorId, createdAt: now }).run();
  db.update(participations).set({ reservationReleasedAt: now }).where(eq(participations.id, p.id)).run();
}

/** Used when a study closes: active attempts expire and their reservations return to the budget. */
export function expireActiveParticipations(db: Db, studyId: string, rewardCredits: number, actorId: string, now: Date): number {
  const active = db.select().from(participations)
    .where(and(eq(participations.studyId, studyId), inArray(participations.status, ['claimed', 'consented', 'in_progress']))).all();
  for (const p of active) {
    db.update(participations).set({ status: 'expired' }).where(eq(participations.id, p.id)).run();
    releaseReservation(db, p, rewardCredits, actorId, now);
  }
  return active.length;
}
```

`apps/api/src/routes/studies.ts`:
```ts
import { createHash, randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { ConsentVersionInputSchema, DeviceCriteriaInputSchema, FundStudyInputSchema, StudyDraftInputSchema, StudyTasksInputSchema } from '@pocketqa/contracts';
import { assertPublishable, composeConsentText, DomainError, findBannedCopy, transitionStudy, type StudyEvent } from '@pocketqa/domain';
import { consentVersions, deviceCriteria, ledgerEntries, studies, studyTasks } from '../db/schema';
import { loadOwnedStudy } from '../lib/access';
import { appendAudit } from '../lib/audit';
import { expireActiveParticipations } from '../lib/participation-ops';
import { criteriaOf, latestConsent, studyBudget, tasksOf, toStudySummary } from '../lib/study-queries';
import { requireRole } from '../plugins/auth';

const IdParam = z.object({ id: z.uuid() });

function assertHonestCopy(...texts: string[]): void {
  for (const text of texts) {
    const hits = findBannedCopy(text, 'builder');
    if (hits.length > 0) throw new DomainError('VALIDATION_FAILED', `Remove misleading reward or secret-material language (${hits.join(', ')})`);
  }
}
const requireDraft = (status: string) => { if (status !== 'draft') throw new DomainError('INVALID_TRANSITION', 'Only draft studies can be edited'); };

export async function studyRoutes(app: FastifyInstance): Promise<void> {
  const { db } = app.ctx;

  app.post('/studies', async (req, reply) => {
    const user = requireRole(req, 'builder');
    const body = StudyDraftInputSchema.parse(req.body);
    assertHonestCopy(body.title, body.appName, body.goal);
    const id = randomUUID();
    const now = app.ctx.now();
    db.insert(studies).values({ id, builderId: user.id, ...body, status: 'draft', createdAt: now }).run();
    appendAudit(db, { actorId: user.id, action: 'study.create', targetType: 'study', targetId: id }, now);
    return reply.status(201).send(toStudySummary(db, id));
  });

  app.patch('/studies/:id', async (req) => {
    const user = requireRole(req, 'builder');
    const study = loadOwnedStudy(app, IdParam.parse(req.params).id, user.id);
    requireDraft(study.status);
    const body = StudyDraftInputSchema.partial().parse(req.body);
    assertHonestCopy(body.title ?? '', body.appName ?? '', body.goal ?? '');
    db.update(studies).set(body).where(eq(studies.id, study.id)).run();
    return toStudySummary(db, study.id);
  });

  app.put('/studies/:id/tasks', async (req) => {
    const user = requireRole(req, 'builder');
    const study = loadOwnedStudy(app, IdParam.parse(req.params).id, user.id);
    requireDraft(study.status);
    const { tasks } = StudyTasksInputSchema.parse(req.body);
    assertHonestCopy(...tasks.flatMap((x) => [x.title, x.instructions]));
    db.transaction((tx) => {
      tx.delete(studyTasks).where(eq(studyTasks.studyId, study.id)).run();
      tasks.forEach((task, position) => tx.insert(studyTasks).values({ id: randomUUID(), studyId: study.id, position, ...task }).run());
    });
    return { tasks: tasksOf(db, study.id) };
  });

  app.put('/studies/:id/criteria', async (req) => {
    const user = requireRole(req, 'builder');
    const study = loadOwnedStudy(app, IdParam.parse(req.params).id, user.id);
    requireDraft(study.status);
    const c = DeviceCriteriaInputSchema.parse(req.body);
    const values = { studyId: study.id, platformsJson: JSON.stringify(c.platforms), minAndroidApi: c.minAndroidApi, minIosMajor: c.minIosMajor, requireSelfReportedSeeker: c.requireSelfReportedSeeker };
    db.insert(deviceCriteria).values(values).onConflictDoUpdate({ target: deviceCriteria.studyId, set: values }).run();
    return criteriaOf(db, study.id);
  });

  app.put('/studies/:id/consent', async (req) => {
    const user = requireRole(req, 'builder');
    const study = loadOwnedStudy(app, IdParam.parse(req.params).id, user.id);
    requireDraft(study.status);
    const body = ConsentVersionInputSchema.parse(req.body);
    assertHonestCopy(body.textMd);
    if (body.scopes.includes('ai_processing') && !study.aiProcessingEnabled) throw new DomainError('VALIDATION_FAILED', 'Enable AI processing on the study before offering that scope');
    const textMd = composeConsentText(body.textMd);
    const version = (latestConsent(db, study.id)?.version ?? 0) + 1;
    const id = randomUUID();
    db.insert(consentVersions).values({ id, studyId: study.id, version, textMd, scopesJson: JSON.stringify(body.scopes), textSha256: createHash('sha256').update(textMd).digest('hex'), createdAt: app.ctx.now() }).run();
    return { id, version, textMd, scopes: body.scopes };
  });

  app.post('/studies/:id/fund', async (req) => {
    const user = requireRole(req, 'builder');
    const study = loadOwnedStudy(app, IdParam.parse(req.params).id, user.id);
    if (study.status === 'closed') throw new DomainError('INVALID_TRANSITION', 'Closed studies cannot be funded');
    const { credits } = FundStudyInputSchema.parse(req.body);
    const now = app.ctx.now();
    // Test credits only: no real payment happens anywhere in this build (ADR-08).
    db.insert(ledgerEntries).values({ id: randomUUID(), studyId: study.id, participationId: null, kind: 'fund_test', amount: credits, createdBy: user.id, createdAt: now }).run();
    appendAudit(db, { actorId: user.id, action: 'study.fund_test', targetType: 'study', targetId: study.id, meta: { credits } }, now);
    return studyBudget(db, study.id);
  });

  const lifecycle: [string, StudyEvent][] = [['publish', 'PUBLISH'], ['pause', 'PAUSE'], ['resume', 'RESUME'], ['close', 'CLOSE']];
  for (const [path, event] of lifecycle) {
    app.post(`/studies/:id/${path}`, async (req) => {
      const user = requireRole(req, 'builder');
      const study = loadOwnedStudy(app, IdParam.parse(req.params).id, user.id);
      const next = transitionStudy(study.status, event);
      const now = app.ctx.now();
      if (event === 'PUBLISH') {
        assertPublishable({
          taskCount: tasksOf(db, study.id).length, hasCriteria: criteriaOf(db, study.id) !== null,
          hasConsentVersion: latestConsent(db, study.id) !== null, availableCredits: studyBudget(db, study.id).available, rewardCredits: study.rewardCredits,
        });
      }
      db.transaction((tx) => {
        tx.update(studies).set({ status: next, ...(event === 'PUBLISH' ? { publishedAt: now } : {}), ...(event === 'CLOSE' ? { closedAt: now } : {}) }).where(eq(studies.id, study.id)).run();
        if (event === 'CLOSE') expireActiveParticipations(tx as never, study.id, study.rewardCredits, user.id, now);
      });
      appendAudit(db, { actorId: user.id, action: `study.${path}`, targetType: 'study', targetId: study.id }, now);
      return toStudySummary(db, study.id);
    });
  }

  app.get('/builder/studies', async (req) => {
    const user = requireRole(req, 'builder');
    return db.select({ id: studies.id }).from(studies).where(eq(studies.builderId, user.id)).all().map((s) => toStudySummary(db, s.id));
  });
}
```
Implementation note: Drizzle's better-sqlite3 transaction object (`tx`) exposes the same query builder as `db`. The `as never` cast passes it to helpers typed with `Db`. If the type checker objects, widen the helper parameter to `Db | Parameters<Parameters<Db['transaction']>[0]>[0]`.

- [ ] **Step 4: Run** — `pnpm --filter @pocketqa/api test` → `34 passed`. (The `GET /studies/:id` used by the fixture arrives in T2.6. Until then, comment out the fixture's `detail` lines, or implement T2.6 Step 3's `GET /studies/:id` first. Choose the second option: implement T2.6's route before running.)

> Ordering note: run T2.5 Step 4 **after** finishing T2.6 Step 3. Commit T2.5 and T2.6 separately, with T2.5's commit first containing only T2.5's files. The `GET /studies/:id` route lives in T2.6's file.

- [ ] **Step 5: Commit** — T2.5 files; message `feat(api): builder study lifecycle with test-credit funding`.

### Task T2.6: Tester discovery, device profile, and claim with reservation

**Files:**
- Create: `apps/api/src/routes/tester.ts`
- Modify: `apps/api/src/routes/index.ts` (add `await testerRoutes(v1);`)
- Modify: `apps/api/test/fixtures.ts` (add `seedDeviceProfile`)
- Test: `apps/api/test/tester.test.ts`

**Interfaces:**
- Consumes: `evaluateEligibility`, `assertCanReserve`, `studyBudget`, `slotsTaken`, `latestConsent`, `tasksOf`, `criteriaOf`.
- Produces:
  - `toTesterStudyDto(db, studyId, profile)` and `toParticipationDto(db, participationId)`.
  - Fixture `seedDeviceProfile(app, token, over?)`.

- [ ] **Step 1: Write the failing test** — `apps/api/test/tester.test.ts`:

```ts
import { afterEach, describe, expect, it } from 'vitest';
import { bearer, registerAs, seedDeviceProfile, seedPublishedStudy } from './fixtures';
import { makeTestApp } from './helpers';

let t: Awaited<ReturnType<typeof makeTestApp>>;
afterEach(async () => t?.close());
const claim = (studyId: string, token: string) => t.app.inject({ method: 'POST', url: `/v1/studies/${studyId}/participations`, headers: bearer(token) });

describe('tester discovery and claims', () => {
  it('lists published studies with eligibility reasons', async () => {
    t = await makeTestApp();
    const b = await registerAs(t.app, 'builder');
    await seedPublishedStudy(t.app, b.token, { criteria: { platforms: ['android'], minAndroidApi: 34, minIosMajor: null, requireSelfReportedSeeker: true } });
    const tester = await registerAs(t.app, 'tester');
    await seedDeviceProfile(t.app, tester.token, { androidApi: 33, selfReportedSeeker: false });
    const [study] = (await t.app.inject({ method: 'GET', url: '/v1/tester/studies', headers: bearer(tester.token) })).json();
    expect(study.eligibility).toEqual({ eligible: false, reasons: ['Needs Android API 34 or newer', 'Only for testers who report using a Seeker'] });
  });
  it('reserves budget on claim and allows one attempt per study', async () => {
    t = await makeTestApp();
    const b = await registerAs(t.app, 'builder');
    const { studyId } = await seedPublishedStudy(t.app, b.token, { rewardCredits: 100, fund: 1000 });
    const tester = await registerAs(t.app, 'tester');
    await seedDeviceProfile(t.app, tester.token);
    const res = await claim(studyId, tester.token);
    expect(res.statusCode).toBe(201);
    expect(res.json().status).toBe('claimed');
    expect((await claim(studyId, tester.token)).json().error.message).toBe('You already took part in this study');
    const [summary] = (await t.app.inject({ method: 'GET', url: '/v1/builder/studies', headers: bearer(b.token) })).json();
    expect(summary.budget).toEqual({ funded: 1000, reservedOpen: 100, approved: 0, available: 900 });
  });
  it('refuses ineligible testers with reasons', async () => {
    t = await makeTestApp();
    const b = await registerAs(t.app, 'builder');
    const { studyId } = await seedPublishedStudy(t.app, b.token);
    const tester = await registerAs(t.app, 'tester');
    await seedDeviceProfile(t.app, tester.token, { platform: 'web', androidApi: null });
    const res = await claim(studyId, tester.token);
    expect(res.statusCode).toBe(403);
    expect(res.json().error.message).toBe('Not eligible: Requires the Android or iOS app');
  });
  it('gives the last slot to exactly one of two concurrent testers', async () => {
    t = await makeTestApp();
    const b = await registerAs(t.app, 'builder');
    const { studyId } = await seedPublishedStudy(t.app, b.token, { slotsTotal: 1 });
    const [x, y] = [await registerAs(t.app, 'tester'), await registerAs(t.app, 'tester')];
    await seedDeviceProfile(t.app, x.token); await seedDeviceProfile(t.app, y.token);
    const codes = (await Promise.all([claim(studyId, x.token), claim(studyId, y.token)])).map((r) => r.statusCode).sort();
    expect(codes).toEqual([201, 409]);
  });
  it('blocks claims when the budget cannot cover another reward', async () => {
    t = await makeTestApp();
    const b = await registerAs(t.app, 'builder');
    const { studyId } = await seedPublishedStudy(t.app, b.token, { rewardCredits: 100, fund: 100, slotsTotal: 5 });
    const [x, y] = [await registerAs(t.app, 'tester'), await registerAs(t.app, 'tester')];
    await seedDeviceProfile(t.app, x.token); await seedDeviceProfile(t.app, y.token);
    expect((await claim(studyId, x.token)).statusCode).toBe(201);
    expect((await claim(studyId, y.token)).json().error.code).toBe('BUDGET_EXHAUSTED');
  });
  it('hides draft studies from testers', async () => {
    t = await makeTestApp();
    const b = await registerAs(t.app, 'builder');
    const id = (await t.app.inject({ method: 'POST', url: '/v1/studies', headers: bearer(b.token), payload: { title: 'Draft study', appName: 'A', appLink: 'https://x.test', goal: 'Not visible yet', rewardCredits: 10, slotsTotal: 1, aiProcessingEnabled: false } })).json().id;
    const tester = await registerAs(t.app, 'tester');
    expect((await t.app.inject({ method: 'GET', url: `/v1/studies/${id}`, headers: bearer(tester.token) })).statusCode).toBe(404);
  });
});
```

Add to `apps/api/test/fixtures.ts`:
```ts
export async function seedDeviceProfile(app: FastifyInstance, token: string, over: Partial<{ platform: 'android' | 'ios' | 'web'; androidApi: number | null; iosMajor: number | null; selfReportedSeeker: boolean }> = {}) {
  const payload = { platform: 'android', osVersion: '16', androidApi: 36, iosMajor: null, model: 'Pixel', manufacturer: 'Google', selfReportedSeeker: false, modelHintSeeker: false, ...over };
  const res = await app.inject({ method: 'PUT', url: '/v1/me/device-profile', headers: bearer(token), payload });
  if (res.statusCode !== 200) throw new Error(`profile failed: ${res.body}`);
}
```

- [ ] **Step 2: Run to verify failure** — FAIL: `/v1/me/device-profile` → 404.

- [ ] **Step 3: Implement** — `apps/api/src/routes/tester.ts`:

```ts
import { randomUUID } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { DeviceProfileInputSchema } from '@pocketqa/contracts';
import { assertCanReserve, DomainError, evaluateEligibility, type DeviceProfile } from '@pocketqa/domain';
import type { Db } from '../db/client';
import { deviceProfiles, disputes, ledgerEntries, participations, studies } from '../db/schema';
import { appendAudit } from '../lib/audit';
import { criteriaOf, latestConsent, slotsTaken, studyBudget, tasksOf } from '../lib/study-queries';
import { requireRole, requireUser } from '../plugins/auth';

const IdParam = z.object({ id: z.uuid() });

const profileOf = (db: Db, userId: string): DeviceProfile | null => {
  const p = db.select().from(deviceProfiles).where(eq(deviceProfiles.userId, userId)).get();
  return p ? { platform: p.platform, androidApi: p.androidApi, iosMajor: p.iosMajor, selfReportedSeeker: p.selfReportedSeeker } : null;
};

export function toTesterStudyDto(db: Db, studyId: string, profile: DeviceProfile | null) {
  const s = db.select().from(studies).where(eq(studies.id, studyId)).get()!;
  const tasks = tasksOf(db, studyId);
  const criteria = criteriaOf(db, studyId) ?? { platforms: ['android' as const], minAndroidApi: null, minIosMajor: null, requireSelfReportedSeeker: false };
  const consent = latestConsent(db, studyId);
  return {
    id: s.id, title: s.title, appName: s.appName, appLink: s.appLink, goal: s.goal, status: s.status, rewardCredits: s.rewardCredits,
    estimatedMinutes: tasks.reduce((n, x) => n + x.maxMinutes, 0), slotsOpen: Math.max(0, s.slotsTotal - slotsTaken(db, s.id)),
    aiProcessingEnabled: s.aiProcessingEnabled, criteria,
    tasks: tasks.map((x) => ({ id: x.id, position: x.position, title: x.title, instructions: x.instructions, maxMinutes: x.maxMinutes })),
    consent: consent ? { id: consent.id, version: consent.version, textMd: consent.textMd, scopes: JSON.parse(consent.scopesJson) } : null,
    eligibility: evaluateEligibility(criteria, profile),
  };
}

export function toParticipationDto(db: Db, participationId: string) {
  const p = db.select().from(participations).where(eq(participations.id, participationId)).get()!;
  const s = db.select({ title: studies.title }).from(studies).where(eq(studies.id, p.studyId)).get()!;
  const dispute = db.select({ id: disputes.id }).from(disputes).where(eq(disputes.participationId, p.id)).get();
  return {
    id: p.id, studyId: p.studyId, studyTitle: s.title, status: p.status, scopes: JSON.parse(p.scopesJson), decisionReason: p.decisionReason,
    claimedAt: p.claimedAt.toISOString(), submittedAt: p.submittedAt?.toISOString() ?? null, decidedAt: p.decidedAt?.toISOString() ?? null,
    disputeOpened: Boolean(dispute),
  };
}

export async function testerRoutes(app: FastifyInstance): Promise<void> {
  const { db } = app.ctx;

  app.put('/me/device-profile', async (req) => {
    const user = requireRole(req, 'tester');
    const body = DeviceProfileInputSchema.parse(req.body);
    const values = { userId: user.id, ...body, updatedAt: app.ctx.now() };
    db.insert(deviceProfiles).values(values).onConflictDoUpdate({ target: deviceProfiles.userId, set: values }).run();
    return values;
  });

  app.get('/tester/studies', async (req) => {
    const user = requireRole(req, 'tester');
    const profile = profileOf(db, user.id);
    const mine = new Set(db.select({ studyId: participations.studyId }).from(participations).where(eq(participations.testerId, user.id)).all().map((r) => r.studyId));
    return db.select().from(studies).where(eq(studies.status, 'published')).all()
      .filter((s) => !mine.has(s.id) && s.slotsTotal > slotsTaken(db, s.id) && studyBudget(db, s.id).available >= s.rewardCredits)
      .map((s) => toTesterStudyDto(db, s.id, profile))
      .sort((a, b) => Number(b.eligibility.eligible) - Number(a.eligibility.eligible));
  });

  app.get('/studies/:id', async (req) => {
    const user = requireUser(req);
    const { id } = IdParam.parse(req.params);
    const s = db.select().from(studies).where(eq(studies.id, id)).get();
    const visible = s && (user.role === 'admin' || (user.role === 'builder' && s.builderId === user.id) || (user.role === 'tester' && s.status === 'published'));
    if (!s || !visible) throw new DomainError('NOT_FOUND', 'Study not found');
    return toTesterStudyDto(db, s.id, user.role === 'tester' ? profileOf(db, user.id) : null);
  });

  app.post('/studies/:id/participations', async (req, reply) => {
    const user = requireRole(req, 'tester');
    const { id } = IdParam.parse(req.params);
    const now = app.ctx.now();
    // better-sqlite3 transactions are synchronous and serialized, so the slot/budget checks and the insert are atomic.
    const participationId = db.transaction((tx) => {
      const s = tx.select().from(studies).where(eq(studies.id, id)).get();
      if (!s || s.status !== 'published') throw new DomainError('NOT_FOUND', 'Study not found');
      const eligibility = evaluateEligibility(criteriaOf(tx as never, s.id)!, profileOf(tx as never, user.id));
      if (!eligibility.eligible) throw new DomainError('FORBIDDEN', `Not eligible: ${eligibility.reasons.join('; ')}`);
      if (tx.select({ id: participations.id }).from(participations).where(and(eq(participations.studyId, s.id), eq(participations.testerId, user.id))).get()) {
        throw new DomainError('CONFLICT', 'You already took part in this study');
      }
      if (slotsTaken(tx as never, s.id) >= s.slotsTotal) throw new DomainError('CONFLICT', 'No slots left in this study');
      assertCanReserve(studyBudget(tx as never, s.id), s.rewardCredits);
      const pid = randomUUID();
      tx.insert(participations).values({ id: pid, studyId: s.id, testerId: user.id, status: 'claimed', consentVersionId: latestConsent(tx as never, s.id)?.id ?? null, claimedAt: now }).run();
      tx.insert(ledgerEntries).values({ id: randomUUID(), studyId: s.id, participationId: pid, kind: 'reserve', amount: s.rewardCredits, createdBy: user.id, createdAt: now }).run();
      return pid;
    });
    appendAudit(db, { actorId: user.id, action: 'participation.claim', targetType: 'participation', targetId: participationId }, now);
    return reply.status(201).send(toParticipationDto(db, participationId));
  });
}
```

- [ ] **Step 4: Run** — `pnpm --filter @pocketqa/api test` → `40 passed` (includes T2.5's 6).
- [ ] **Step 5: Commit** — commit T2.5's files first, then: `apps/api/src/routes/tester.ts apps/api/src/routes/index.ts apps/api/test/tester.test.ts apps/api/test/fixtures.ts`; message `feat(api): eligibility-aware discovery and atomic claims`.

### Task T2.7: Consent, start, task results, withdraw, submit

**Files:**
- Create: `apps/api/src/routes/participations.ts`
- Modify: `apps/api/src/routes/index.ts` (add `await participationRoutes(v1);`), `apps/api/test/fixtures.ts` (add `startParticipation`)
- Test: `apps/api/test/participations.test.ts`

**Interfaces:**
- Consumes: `transitionParticipation`, `validateConsentGrant`, `looksLikeSeedPhrase`, `releaseReservation`.
- Produces: fixture `startParticipation(app, testerToken, studyId, scopes?) → { participationId }`.

- [ ] **Step 1: Write the failing test** — `apps/api/test/participations.test.ts`:

```ts
import { afterEach, describe, expect, it } from 'vitest';
import { bearer, registerAs, seedDeviceProfile, seedPublishedStudy, startParticipation } from './fixtures';
import { makeTestApp } from './helpers';

let t: Awaited<ReturnType<typeof makeTestApp>>;
afterEach(async () => t?.close());

async function setup() {
  t = await makeTestApp();
  const b = await registerAs(t.app, 'builder');
  const study = await seedPublishedStudy(t.app, b.token);
  const tester = await registerAs(t.app, 'tester');
  await seedDeviceProfile(t.app, tester.token);
  return { b, study, tester };
}

describe('participation flow', () => {
  it('requires screen recording consent against the current version', async () => {
    const { study, tester } = await setup();
    const pid = (await t.app.inject({ method: 'POST', url: `/v1/studies/${study.studyId}/participations`, headers: bearer(tester.token) })).json().id;
    const consent = (payload: object) => t.app.inject({ method: 'POST', url: `/v1/participations/${pid}/consent`, headers: bearer(tester.token), payload });
    expect((await consent({ consentVersionId: study.consentVersionId, scopes: ['microphone'] })).json().error.code).toBe('VALIDATION_FAILED');
    const ok = await consent({ consentVersionId: study.consentVersionId, scopes: ['screen_recording', 'microphone'] });
    expect(ok.json()).toMatchObject({ status: 'consented', scopes: ['microphone', 'screen_recording'] });
  });
  it('refuses task notes that look like a recovery phrase', async () => {
    const { study, tester } = await setup();
    const { participationId } = await startParticipation(t.app, tester.token, study.studyId);
    const res = await t.app.inject({
      method: 'PUT', url: `/v1/participations/${participationId}/task-results`, headers: bearer(tester.token),
      payload: { results: [{ taskId: study.taskIds[0], outcome: 'completed', difficulty: 2, note: 'apple banana cherry delta eagle fabric garden hotel island jungle kettle lemon' }] },
    });
    expect(res.json().error.message).toBe('This note looks like a wallet recovery phrase. Remove it — Pocket QA never needs it.');
  });
  it('refuses to submit without uploaded evidence', async () => {
    const { study, tester } = await setup();
    const { participationId } = await startParticipation(t.app, tester.token, study.studyId);
    const res = await t.app.inject({ method: 'POST', url: `/v1/participations/${participationId}/submit`, headers: bearer(tester.token) });
    expect(res.json().error.message).toBe('Upload at least one recording before submitting');
  });
  it('releases the reservation on withdraw', async () => {
    const { b, study, tester } = await setup();
    const { participationId } = await startParticipation(t.app, tester.token, study.studyId);
    expect((await t.app.inject({ method: 'POST', url: `/v1/participations/${participationId}/withdraw`, headers: bearer(tester.token) })).json().status).toBe('withdrawn');
    const [summary] = (await t.app.inject({ method: 'GET', url: '/v1/builder/studies', headers: bearer(b.token) })).json();
    expect(summary.budget.available).toBe(1000);
  });
  it('keeps other testers out', async () => {
    const { study, tester } = await setup();
    const { participationId } = await startParticipation(t.app, tester.token, study.studyId);
    const intruder = await registerAs(t.app, 'tester');
    expect((await t.app.inject({ method: 'POST', url: `/v1/participations/${participationId}/withdraw`, headers: bearer(intruder.token) })).statusCode).toBe(404);
  });
});
```

Add to `apps/api/test/fixtures.ts`:
```ts
export async function startParticipation(app: FastifyInstance, testerToken: string, studyId: string, scopes: string[] = ['screen_recording', 'microphone']) {
  const h = bearer(testerToken);
  const participationId = (await app.inject({ method: 'POST', url: `/v1/studies/${studyId}/participations`, headers: h })).json().id as string;
  const consentVersionId = (await app.inject({ method: 'GET', url: `/v1/studies/${studyId}`, headers: h })).json().consent.id;
  await app.inject({ method: 'POST', url: `/v1/participations/${participationId}/consent`, headers: h, payload: { consentVersionId, scopes } });
  const started = await app.inject({ method: 'POST', url: `/v1/participations/${participationId}/start`, headers: h });
  if (started.json().status !== 'in_progress') throw new Error(`start failed: ${started.body}`);
  return { participationId };
}
```

- [ ] **Step 2: Run to verify failure** — FAIL: consent route → 404.

- [ ] **Step 3: Implement** — `apps/api/src/routes/participations.ts`:

```ts
import { and, eq, inArray, sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { ConsentGrantInputSchema, TaskResultsInputSchema } from '@pocketqa/contracts';
import { DomainError, looksLikeSeedPhrase, transitionParticipation, validateConsentGrant } from '@pocketqa/domain';
import { evidenceItems, participations, studies, taskResults } from '../db/schema';
import { loadOwnParticipation } from '../lib/access';
import { appendAudit } from '../lib/audit';
import { releaseReservation } from '../lib/participation-ops';
import { latestConsent, tasksOf } from '../lib/study-queries';
import { requireRole } from '../plugins/auth';
import { toParticipationDto } from './tester';

const IdParam = z.object({ id: z.uuid() });

export async function participationRoutes(app: FastifyInstance): Promise<void> {
  const { db } = app.ctx;
  const own = (req: Parameters<typeof requireRole>[0]) => {
    const user = requireRole(req, 'tester');
    return { user, p: loadOwnParticipation(app, IdParam.parse(req.params).id, user.id) };
  };

  app.post('/participations/:id/consent', async (req) => {
    const { user, p } = own(req);
    const body = ConsentGrantInputSchema.parse(req.body);
    const study = db.select().from(studies).where(eq(studies.id, p.studyId)).get()!;
    const current = latestConsent(db, p.studyId)!;
    const scopes = validateConsentGrant({
      offered: JSON.parse(current.scopesJson), granted: body.scopes, studyAiEnabled: study.aiProcessingEnabled,
      consentVersionId: body.consentVersionId, currentConsentVersionId: current.id,
    });
    const next = transitionParticipation(p.status, { type: 'CONSENT', scopes });
    const now = app.ctx.now();
    db.update(participations).set({ status: next, scopesJson: JSON.stringify(scopes), consentVersionId: current.id, consentedAt: now }).where(eq(participations.id, p.id)).run();
    appendAudit(db, { actorId: user.id, action: 'participation.consent', targetType: 'participation', targetId: p.id, meta: { consentVersion: current.version, scopes: scopes.join(',') } }, now);
    return toParticipationDto(db, p.id);
  });

  app.post('/participations/:id/start', async (req) => {
    const { p } = own(req);
    db.update(participations).set({ status: transitionParticipation(p.status, { type: 'START' }), startedAt: app.ctx.now() }).where(eq(participations.id, p.id)).run();
    return toParticipationDto(db, p.id);
  });

  app.put('/participations/:id/task-results', async (req) => {
    const { p } = own(req);
    if (p.status !== 'in_progress') throw new DomainError('INVALID_TRANSITION', 'Task results can only change while the session is in progress');
    const { results } = TaskResultsInputSchema.parse(req.body);
    const valid = new Set(tasksOf(db, p.studyId).map((x) => x.id));
    for (const r of results) {
      if (!valid.has(r.taskId)) throw new DomainError('VALIDATION_FAILED', 'Unknown task for this study');
      // R32: Pocket QA never collects secret material, even by accident.
      if (looksLikeSeedPhrase(r.note)) throw new DomainError('VALIDATION_FAILED', 'This note looks like a wallet recovery phrase. Remove it — Pocket QA never needs it.');
    }
    db.transaction((tx) => {
      tx.delete(taskResults).where(and(eq(taskResults.participationId, p.id), inArray(taskResults.taskId, results.map((r) => r.taskId)))).run();
      for (const r of results) tx.insert(taskResults).values({ participationId: p.id, ...r }).run();
    });
    return { results };
  });

  app.post('/participations/:id/withdraw', async (req) => {
    const { user, p } = own(req);
    const next = transitionParticipation(p.status, { type: 'WITHDRAW' });
    const study = db.select().from(studies).where(eq(studies.id, p.studyId)).get()!;
    const now = app.ctx.now();
    db.transaction((tx) => {
      tx.update(participations).set({ status: next }).where(eq(participations.id, p.id)).run();
      releaseReservation(tx as never, p, study.rewardCredits, user.id, now);
    });
    appendAudit(db, { actorId: user.id, action: 'participation.withdraw', targetType: 'participation', targetId: p.id }, now);
    return toParticipationDto(db, p.id);
  });

  app.post('/participations/:id/submit', async (req) => {
    const { user, p } = own(req);
    const count = (q: ReturnType<typeof sql<number>>) => q;
    void count;
    const uploaded = db.select({ n: sql<number>`count(*)` }).from(evidenceItems).where(and(eq(evidenceItems.participationId, p.id), eq(evidenceItems.status, 'uploaded'))).get()!.n;
    const resultsCount = db.select({ n: sql<number>`count(*)` }).from(taskResults).where(eq(taskResults.participationId, p.id)).get()!.n;
    const next = transitionParticipation(p.status, { type: 'SUBMIT', uploadedEvidenceCount: uploaded, tasksTotal: tasksOf(db, p.studyId).length, taskResultsCount: resultsCount });
    const now = app.ctx.now();
    db.update(participations).set({ status: next, submittedAt: now }).where(eq(participations.id, p.id)).run();
    appendAudit(db, { actorId: user.id, action: 'participation.submit', targetType: 'participation', targetId: p.id }, now);
    return toParticipationDto(db, p.id);
  });
}
```
(Delete the two no-op `count` lines if lint flags them. They are not part of the behavior.)

- [ ] **Step 4: Run** — `pnpm --filter @pocketqa/api test` → `45 passed`.
- [ ] **Step 5: Commit** — files above; message `feat(api): consent, start, task results, withdraw and submit`.

### Task T2.8: Evidence creation, streaming upload validation, removal

**Files:**
- Create: `apps/api/src/routes/evidence.ts`, `apps/api/src/lib/upload.ts`, `apps/api/test/fixtures/sample.mp4`, `apps/api/test/fixtures/sample.png`
- Modify: `apps/api/src/routes/index.ts` (add `await evidenceRoutes(v1);`), `apps/api/test/fixtures.ts` (add `fixtureBytes`, `uploadFixture`)
- Test: `apps/api/test/evidence.test.ts`

**Interfaces:**
- Consumes: `sniffMediaType`, `assertDeclaredMimeMatches`, `ALLOWED_MIME_TYPES`, `MediaStore`.
- Produces:
  - `receiveUpload(stream, tempPath, limit) → { size, sha256, head }`.
  - Fixtures `fixtureBytes(name)` and `uploadFixture(app, token, participationId, taskId, name?) → { evidenceId, sha256 }`.

- [ ] **Step 0: Create real media fixtures** (IR5: never test acceptance with fake bytes)
```bash
mkdir -p apps/api/test/fixtures
ffmpeg -f lavfi -i testsrc=duration=1:size=160x120:rate=10 -pix_fmt yuv420p -movflags +faststart -y apps/api/test/fixtures/sample.mp4
ffmpeg -f lavfi -i color=c=blue:s=8x8 -frames:v 1 -y apps/api/test/fixtures/sample.png
ls -l apps/api/test/fixtures
```
Expected: both files exist and `sample.mp4` is under 50 KB.

- [ ] **Step 1: Write the failing test** — `apps/api/test/evidence.test.ts`:

```ts
import { createHash } from 'node:crypto';
import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { bearer, fixtureBytes, registerAs, seedDeviceProfile, seedPublishedStudy, startParticipation, uploadFixture } from './fixtures';
import { makeTestApp } from './helpers';

let t: Awaited<ReturnType<typeof makeTestApp>>;
afterEach(async () => t?.close());

async function inProgress(env: Record<string, string> = {}) {
  t = await makeTestApp({ env });
  const b = await registerAs(t.app, 'builder');
  const study = await seedPublishedStudy(t.app, b.token);
  const tester = await registerAs(t.app, 'tester');
  await seedDeviceProfile(t.app, tester.token);
  const { participationId } = await startParticipation(t.app, tester.token, study.studyId);
  return { study, tester, participationId };
}
const create = (pid: string, token: string, over: object = {}) => t.app.inject({
  method: 'POST', url: `/v1/participations/${pid}/evidence`, headers: bearer(token),
  payload: { kind: 'screen_recording', taskId: null, mime: 'video/mp4', sizeBytes: fixtureBytes('sample.mp4').length, sha256: null, durationMs: 1000, captureSource: 'android_media_projection', ...over },
});
const put = (id: string, token: string, body: Buffer, type = 'video/mp4') => t.app.inject({
  method: 'PUT', url: `/v1/evidence/${id}/content`, headers: { ...bearer(token), 'content-type': type, 'content-length': String(body.length) }, payload: body,
});

describe('evidence upload', () => {
  it('stores a real MP4 and its server-computed hash', async () => {
    const { tester, participationId, study } = await inProgress();
    const { sha256 } = await uploadFixture(t.app, tester.token, participationId, study.taskIds[0]!);
    expect(sha256).toBe(createHash('sha256').update(fixtureBytes('sample.mp4')).digest('hex'));
  });
  it('rejects content that does not match the declared type', async () => {
    const { tester, participationId } = await inProgress();
    const png = fixtureBytes('sample.png');
    const id = (await create(participationId, tester.token, { mime: 'video/mp4', sizeBytes: png.length })).json().evidenceId;
    expect((await put(id, tester.token, png, 'video/mp4')).statusCode).toBe(415);
  });
  it('rejects unsupported content types', async () => {
    const { tester, participationId } = await inProgress();
    const mp4 = fixtureBytes('sample.mp4');
    const id = (await create(participationId, tester.token)).json().evidenceId;
    expect((await put(id, tester.token, mp4, 'application/octet-stream')).statusCode).toBe(415);
  });
  it('rejects checksum and size mismatches', async () => {
    const { tester, participationId } = await inProgress();
    const mp4 = fixtureBytes('sample.mp4');
    const wrongHash = (await create(participationId, tester.token, { sha256: 'a'.repeat(64) })).json().evidenceId;
    expect((await put(wrongHash, tester.token, mp4)).json().error.code).toBe('INTEGRITY_MISMATCH');
    const wrongSize = (await create(participationId, tester.token, { sizeBytes: mp4.length + 5 })).json().evidenceId;
    expect((await put(wrongSize, tester.token, mp4)).json().error.code).toBe('INTEGRITY_MISMATCH');
  });
  it('rejects files above the upload limit at creation', async () => {
    const { tester, participationId } = await inProgress({ MAX_UPLOAD_BYTES: '1048576' });
    expect((await create(participationId, tester.token, { sizeBytes: 2_000_000 })).statusCode).toBe(413);
  });
  it('keeps other testers out', async () => {
    const { tester, participationId } = await inProgress();
    const id = (await create(participationId, tester.token)).json().evidenceId;
    const other = await registerAs(t.app, 'tester');
    expect((await put(id, other.token, fixtureBytes('sample.mp4'))).statusCode).toBe(404);
    expect((await t.app.inject({ method: 'DELETE', url: `/v1/evidence/${id}`, headers: bearer(other.token) })).statusCode).toBe(404);
  });
  it('removes evidence and its file before submit', async () => {
    const { tester, participationId, study } = await inProgress();
    const { evidenceId } = await uploadFixture(t.app, tester.token, participationId, study.taskIds[0]!);
    expect((await t.app.inject({ method: 'DELETE', url: `/v1/evidence/${evidenceId}`, headers: bearer(tester.token) })).statusCode).toBe(204);
    expect(readdirSync(join(t.dir, 'media')).filter((f) => f.endsWith('.bin'))).toHaveLength(0);
    expect(existsSync(join(t.dir, 'media'))).toBe(true);
  });
  it('rejects evidence creation after submit', async () => {
    const { tester, participationId, study } = await inProgress();
    await uploadFixture(t.app, tester.token, participationId, study.taskIds[0]!);
    await t.app.inject({ method: 'PUT', url: `/v1/participations/${participationId}/task-results`, headers: bearer(tester.token), payload: { results: study.taskIds.map((taskId) => ({ taskId, outcome: 'completed', difficulty: 2, note: 'ok' })) } });
    expect((await t.app.inject({ method: 'POST', url: `/v1/participations/${participationId}/submit`, headers: bearer(tester.token) })).json().status).toBe('submitted');
    expect((await create(participationId, tester.token)).json().error.code).toBe('INVALID_TRANSITION');
  });
});
```

Add to `apps/api/test/fixtures.ts`:
```ts
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export const fixtureBytes = (name: string) => readFileSync(fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url)));

export async function uploadFixture(app: FastifyInstance, token: string, participationId: string, taskId: string, name = 'sample.mp4') {
  const body = fixtureBytes(name);
  const mime = name.endsWith('.png') ? 'image/png' : 'video/mp4';
  const sha256 = createHash('sha256').update(body).digest('hex');
  const created = await app.inject({ method: 'POST', url: `/v1/participations/${participationId}/evidence`, headers: bearer(token), payload: { kind: mime === 'video/mp4' ? 'screen_recording' : 'screenshot', taskId, mime, sizeBytes: body.length, sha256, durationMs: mime === 'video/mp4' ? 1000 : null, captureSource: 'android_media_projection' } });
  const evidenceId = created.json().evidenceId as string;
  const put = await app.inject({ method: 'PUT', url: `/v1/evidence/${evidenceId}/content`, headers: { ...bearer(token), 'content-type': mime, 'content-length': String(body.length) }, payload: body });
  if (put.statusCode !== 200) throw new Error(`upload failed: ${put.body}`);
  return { evidenceId, sha256: put.json().sha256 as string };
}
```

- [ ] **Step 2: Run to verify failure** — FAIL: evidence route → 404.

- [ ] **Step 3: Implement**

`apps/api/src/lib/upload.ts`:
```ts
import { createHash } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { once } from 'node:events';
import { finished } from 'node:stream/promises';
import { DomainError } from '@pocketqa/domain';

/** Streams to disk while hashing and counting; aborts as soon as the declared size is exceeded. */
export async function receiveUpload(stream: AsyncIterable<Buffer>, tempPath: string, limit: number) {
  const hash = createHash('sha256');
  const out = createWriteStream(tempPath, { flags: 'wx', mode: 0o600 });
  const head: Buffer[] = [];
  let headLength = 0;
  let size = 0;
  try {
    for await (const chunk of stream) {
      size += chunk.length;
      if (size > limit) throw new DomainError('INTEGRITY_MISMATCH', 'Upload is larger than the declared size');
      if (headLength < 16) {
        const part = chunk.subarray(0, 16 - headLength);
        head.push(part);
        headLength += part.length;
      }
      hash.update(chunk);
      if (!out.write(chunk)) await once(out, 'drain');
    }
    out.end();
    await finished(out);
  } catch (e) {
    out.destroy();
    throw e;
  }
  return { size, sha256: hash.digest('hex'), head: new Uint8Array(Buffer.concat(head)) };
}
```

`apps/api/src/routes/evidence.ts`:
```ts
import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { CreateEvidenceInputSchema } from '@pocketqa/contracts';
import { ALLOWED_MIME_TYPES, assertDeclaredMimeMatches, DomainError, sniffMediaType } from '@pocketqa/domain';
import { evidenceItems, participations } from '../db/schema';
import { loadOwnParticipation } from '../lib/access';
import { appendAudit } from '../lib/audit';
import { tasksOf } from '../lib/study-queries';
import { receiveUpload } from '../lib/upload';
import { requireRole } from '../plugins/auth';

const IdParam = z.object({ id: z.uuid() });

export async function evidenceRoutes(app: FastifyInstance): Promise<void> {
  const { db, media, config } = app.ctx;
  // Media bodies are passed through as streams; only these three types are parsed at all (others → 415).
  for (const mime of ALLOWED_MIME_TYPES) app.addContentTypeParser(mime, (_req, payload, done) => done(null, payload));

  const loadOwnEvidence = (evidenceId: string, testerId: string) => {
    const e = db.select().from(evidenceItems).where(eq(evidenceItems.id, evidenceId)).get();
    if (!e) throw new DomainError('NOT_FOUND', 'Evidence not found');
    const p = db.select().from(participations).where(eq(participations.id, e.participationId)).get();
    if (!p || p.testerId !== testerId) throw new DomainError('NOT_FOUND', 'Evidence not found');
    return { e, p };
  };
  const requireInProgress = (status: string) => {
    if (status !== 'in_progress') throw new DomainError('INVALID_TRANSITION', 'Evidence can only change before you submit');
  };

  app.post('/participations/:id/evidence', async (req, reply) => {
    const user = requireRole(req, 'tester');
    const p = loadOwnParticipation(app, IdParam.parse(req.params).id, user.id);
    requireInProgress(p.status);
    const body = CreateEvidenceInputSchema.parse(req.body);
    if (body.sizeBytes > config.MAX_UPLOAD_BYTES) throw new DomainError('PAYLOAD_TOO_LARGE', 'This file is larger than the upload limit');
    if (body.taskId && !tasksOf(db, p.studyId).some((x) => x.id === body.taskId)) throw new DomainError('VALIDATION_FAILED', 'Unknown task for this study');
    const id = randomUUID();
    db.insert(evidenceItems).values({ id, participationId: p.id, ...body, status: 'pending_upload', createdAt: app.ctx.now() }).run();
    return reply.status(201).send({ evidenceId: id, uploadPath: `/v1/evidence/${id}/content` });
  });

  app.put('/evidence/:id/content', async (req) => {
    const user = requireRole(req, 'tester');
    const { e, p } = loadOwnEvidence(IdParam.parse(req.params).id, user.id);
    requireInProgress(p.status);
    if (e.status !== 'pending_upload') throw new DomainError('CONFLICT', 'This evidence was already uploaded');
    if (req.headers['content-type'] !== e.mime) throw new DomainError('UNSUPPORTED_MEDIA_TYPE', 'Content type does not match the declared type');
    const length = Number(req.headers['content-length']);
    if (!Number.isInteger(length) || length !== e.sizeBytes) throw new DomainError('INTEGRITY_MISMATCH', 'Upload size does not match the declared size');
    const { key, tempPath } = media.beginWrite();
    try {
      const got = await receiveUpload(req.body as AsyncIterable<Buffer>, tempPath, e.sizeBytes);
      if (got.size !== e.sizeBytes) throw new DomainError('INTEGRITY_MISMATCH', 'Upload ended before the declared size');
      assertDeclaredMimeMatches(e.mime, sniffMediaType(got.head));
      if (e.sha256 && e.sha256 !== got.sha256) throw new DomainError('INTEGRITY_MISMATCH', 'File checksum does not match');
      await media.commit(key, tempPath);
      db.update(evidenceItems).set({ status: 'uploaded', storageKey: key, sha256: got.sha256, uploadedAt: app.ctx.now() }).where(eq(evidenceItems.id, e.id)).run();
      return { status: 'uploaded' as const, sha256: got.sha256 };
    } catch (err) {
      await media.abort(tempPath);
      throw err;
    }
  });

  app.delete('/evidence/:id', async (req, reply) => {
    const user = requireRole(req, 'tester');
    const { e, p } = loadOwnEvidence(IdParam.parse(req.params).id, user.id);
    requireInProgress(p.status);
    if (e.status === 'removed' || e.status === 'purged') throw new DomainError('CONFLICT', 'This evidence was already removed');
    const now = app.ctx.now();
    db.update(evidenceItems).set({ status: 'removed', removedAt: now }).where(eq(evidenceItems.id, e.id)).run();
    if (e.storageKey) await media.remove(e.storageKey);
    appendAudit(db, { actorId: user.id, action: 'evidence.remove', targetType: 'evidence', targetId: e.id }, now);
    return reply.status(204).send();
  });
}
```

- [ ] **Step 4: Run** — `pnpm --filter @pocketqa/api test` → `53 passed`.
- [ ] **Step 5: Commit** — files above, including both fixtures; message `feat(api): streaming evidence upload with type, size and checksum validation`.

### Task T2.9: Playback tokens and authorized media streaming

**Files:**
- Create: `apps/api/src/routes/media.ts`
- Modify: `apps/api/src/routes/index.ts` (add `await mediaRoutes(v1);`)
- Test: `apps/api/test/media.test.ts`

**Interfaces:**
- Consumes: `signPlaybackToken`, `verifyPlaybackToken`, `PLAYBACK_TTL_MS`, `loadEvidenceForViewer`.
- Produces: `POST /evidence/:id/playback-token` and `GET /media/:evidenceId?token=`.

- [ ] **Step 1: Write the failing test** — `apps/api/test/media.test.ts`:

```ts
import { afterEach, describe, expect, it } from 'vitest';
import { bearer, fixtureBytes, registerAs, seedDeviceProfile, seedPublishedStudy, startParticipation, uploadFixture } from './fixtures';
import { makeTestApp, mutableClock } from './helpers';

let t: Awaited<ReturnType<typeof makeTestApp>>;
afterEach(async () => t?.close());
const clock = mutableClock();

async function uploaded() {
  t = await makeTestApp({ now: clock.get });
  const builder = await registerAs(t.app, 'builder');
  const study = await seedPublishedStudy(t.app, builder.token);
  const tester = await registerAs(t.app, 'tester');
  await seedDeviceProfile(t.app, tester.token);
  const { participationId } = await startParticipation(t.app, tester.token, study.studyId);
  const { evidenceId } = await uploadFixture(t.app, tester.token, participationId, study.taskIds[0]!);
  return { builder, tester, evidenceId, study };
}
const mint = (id: string, token: string) => t.app.inject({ method: 'POST', url: `/v1/evidence/${id}/playback-token`, headers: bearer(token) });

describe('playback', () => {
  it('streams the exact bytes to the study builder', async () => {
    const { builder, evidenceId } = await uploaded();
    const { url } = (await mint(evidenceId, builder.token)).json();
    const res = await t.app.inject({ method: 'GET', url });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toBe('video/mp4');
    expect(Buffer.compare(res.rawPayload, fixtureBytes('sample.mp4'))).toBe(0);
  });
  it('serves byte ranges', async () => {
    const { tester, evidenceId } = await uploaded();
    const { url } = (await mint(evidenceId, tester.token)).json();
    const res = await t.app.inject({ method: 'GET', url, headers: { range: 'bytes=0-9' } });
    expect(res.statusCode).toBe(206);
    expect(res.rawPayload.length).toBe(10);
    expect(res.headers['content-range']).toBe(`bytes 0-9/${fixtureBytes('sample.mp4').length}`);
  });
  it('tester B cannot mint playback token for tester A evidence', async () => {
    const { evidenceId } = await uploaded();
    const other = await registerAs(t.app, 'tester');
    expect((await mint(evidenceId, other.token)).statusCode).toBe(404);
  });
  it('another builder cannot mint a playback token', async () => {
    const { evidenceId } = await uploaded();
    const other = await registerAs(t.app, 'builder');
    expect((await mint(evidenceId, other.token)).statusCode).toBe(404);
  });
  it('expired playback token is refused', async () => {
    const { tester, evidenceId } = await uploaded();
    const { url } = (await mint(evidenceId, tester.token)).json();
    clock.advanceMs(121_000);
    expect((await t.app.inject({ method: 'GET', url })).statusCode).toBe(401);
  });
  it('a token for one evidence item cannot read another', async () => {
    const { tester, evidenceId, study } = await uploaded();
    const pid = (await t.app.inject({ method: 'GET', url: '/v1/tester/participations', headers: bearer(tester.token) })).json()[0]?.id;
    const second = await uploadFixture(t.app, tester.token, pid, study.taskIds[1]!);
    const { url } = (await mint(evidenceId, tester.token)).json();
    expect((await t.app.inject({ method: 'GET', url: url.replace(evidenceId, second.evidenceId) })).statusCode).toBe(401);
  });
  it('never logs playback tokens', async () => {
    const { tester, evidenceId } = await uploaded();
    const { url } = (await mint(evidenceId, tester.token)).json();
    await t.app.inject({ method: 'GET', url });
    expect(t.logs.join('')).not.toContain(new URL(url, 'http://x').searchParams.get('token')!);
  });
});
```
(`GET /tester/participations` arrives in T2.10. Order this file's sixth test after T2.10, or mark it `it.todo` until T2.10 lands and then re-enable it. Choose the re-enable path, and record it in the T2.10 commit.)

- [ ] **Step 2: Run to verify failure** — FAIL: playback-token route → 404.

- [ ] **Step 3: Implement** — `apps/api/src/routes/media.ts`:

```ts
import { createReadStream, statSync } from 'node:fs';
import { eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { DomainError } from '@pocketqa/domain';
import { users } from '../db/schema';
import { loadEvidenceForViewer } from '../lib/access';
import { appendAudit } from '../lib/audit';
import { PLAYBACK_TTL_MS, signPlaybackToken, verifyPlaybackToken } from '../lib/tokens';
import { requireUser } from '../plugins/auth';

const IdParam = z.object({ id: z.uuid() });
const MediaParams = z.object({ evidenceId: z.uuid() });
const MediaQuery = z.object({ token: z.string().min(10).max(500) });

function parseRange(header: string | undefined, size: number): { start: number; end: number } | null | 'invalid' {
  if (!header) return null;
  const m = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!m || (m[1] === '' && m[2] === '')) return 'invalid';
  const start = m[1] === '' ? Math.max(0, size - Number(m[2])) : Number(m[1]);
  const end = m[1] === '' || m[2] === '' ? size - 1 : Math.min(Number(m[2]), size - 1);
  return start > end || start >= size ? 'invalid' : { start, end };
}

export async function mediaRoutes(app: FastifyInstance): Promise<void> {
  const { db, media, config } = app.ctx;

  app.post('/evidence/:id/playback-token', async (req) => {
    const user = requireUser(req);
    const { evidence } = loadEvidenceForViewer(app, IdParam.parse(req.params).id, user);
    if (evidence.status !== 'uploaded') throw new DomainError('NOT_FOUND', 'Evidence not found');
    const now = app.ctx.now();
    const expiresAt = now.getTime() + PLAYBACK_TTL_MS;
    if (user.role === 'admin') appendAudit(db, { actorId: user.id, action: 'evidence.view', targetType: 'evidence', targetId: evidence.id }, now);
    const token = signPlaybackToken(config.PLAYBACK_TOKEN_SECRET, evidence.id, user.id, expiresAt);
    return { url: `/v1/media/${evidence.id}?token=${encodeURIComponent(token)}`, expiresAt: new Date(expiresAt).toISOString() };
  });

  app.get('/media/:evidenceId', async (req, reply) => {
    const { evidenceId } = MediaParams.parse(req.params);
    const { token } = MediaQuery.parse(req.query);
    const claim = verifyPlaybackToken(config.PLAYBACK_TOKEN_SECRET, evidenceId, token, app.ctx.now().getTime());
    if (!claim) throw new DomainError('UNAUTHENTICATED', 'This playback link expired. Open the recording again.');
    // Re-authorize at stream time: access may have changed since the token was minted.
    const viewer = db.select().from(users).where(eq(users.id, claim.userId)).get();
    if (!viewer || viewer.status !== 'active') throw new DomainError('UNAUTHENTICATED', 'This playback link expired. Open the recording again.');
    const { evidence } = loadEvidenceForViewer(app, evidenceId, viewer);
    if (evidence.status !== 'uploaded' || !evidence.storageKey) throw new DomainError('NOT_FOUND', 'Evidence not found');
    const path = media.pathFor(evidence.storageKey);
    const size = statSync(path).size;
    const range = parseRange(req.headers.range, size);
    reply.header('Content-Type', evidence.mime).header('Accept-Ranges', 'bytes').header('Content-Disposition', 'inline').header('Cache-Control', 'private, no-store');
    if (range === 'invalid') return reply.status(416).header('Content-Range', `bytes */${size}`).send();
    if (range) {
      return reply.status(206).header('Content-Range', `bytes ${range.start}-${range.end}/${size}`).header('Content-Length', range.end - range.start + 1)
        .send(createReadStream(path, { start: range.start, end: range.end }));
    }
    return reply.header('Content-Length', size).send(createReadStream(path));
  });
}
```

- [ ] **Step 4: Run** — `pnpm --filter @pocketqa/api test` → `59 passed` (+1 todo until T2.10).
- [ ] **Step 5: Commit** — files above; message `feat(api): short-lived playback tokens with re-authorized range streaming`.

### Task T2.10: Review — submissions, findings, decisions, compensation, report

**Files:**
- Create: `apps/api/src/routes/review.ts`
- Modify: `apps/api/src/routes/index.ts` (add `await reviewRoutes(v1);`), `apps/api/src/dev/seed.ts` (add the `submitted-session` scenario), `apps/api/src/plugins/test-hooks.ts` (accept it), `apps/api/test/media.test.ts` (re-enable the sixth test)
- Test: `apps/api/test/review.test.ts`

**Interfaces:**
- Consumes: `loadSubmissionForViewer`, `transitionParticipation`, `toParticipationDto`.
- Produces: the endpoints in A7 for review, plus `toCompensationDto(db, compensationId)` (reused by T2.15).

- [ ] **Step 1: Write the failing test** — `apps/api/test/review.test.ts`:

```ts
import { afterEach, describe, expect, it } from 'vitest';
import { bearer, registerAs, seedDeviceProfile, seedPublishedStudy, startParticipation, uploadFixture } from './fixtures';
import { makeTestApp } from './helpers';

let t: Awaited<ReturnType<typeof makeTestApp>>;
afterEach(async () => t?.close());

async function submitted() {
  t = await makeTestApp();
  const builder = await registerAs(t.app, 'builder');
  const study = await seedPublishedStudy(t.app, builder.token, { rewardCredits: 120 });
  const tester = await registerAs(t.app, 'tester');
  await seedDeviceProfile(t.app, tester.token);
  const { participationId } = await startParticipation(t.app, tester.token, study.studyId);
  const { evidenceId } = await uploadFixture(t.app, tester.token, participationId, study.taskIds[0]!);
  await t.app.inject({ method: 'PUT', url: `/v1/participations/${participationId}/task-results`, headers: bearer(tester.token), payload: { results: study.taskIds.map((taskId) => ({ taskId, outcome: 'blocked', difficulty: 4, note: 'Could not find the continue button' })) } });
  await t.app.inject({ method: 'POST', url: `/v1/participations/${participationId}/submit`, headers: bearer(tester.token) });
  return { builder, tester, study, participationId, evidenceId };
}
const decide = (pid: string, token: string, payload: object) => t.app.inject({ method: 'POST', url: `/v1/submissions/${pid}/decision`, headers: bearer(token), payload });

describe('review', () => {
  it('approves into an unpaid test-credit compensation and moves budget to approved', async () => {
    const { builder, tester, participationId, study } = await submitted();
    expect((await decide(participationId, builder.token, { decision: 'approve' })).json().status).toBe('approved');
    const [summary] = (await t.app.inject({ method: 'GET', url: '/v1/builder/studies', headers: bearer(builder.token) })).json();
    expect(summary.budget).toMatchObject({ approved: 120, reservedOpen: 0 });
    const rewards = (await t.app.inject({ method: 'GET', url: '/v1/tester/rewards', headers: bearer(tester.token) })).json();
    expect(rewards).toEqual([expect.objectContaining({ credits: 120, status: 'approved_unpaid', studyTitle: 'Wallet onboarding', transfers: [] })]);
    void study;
  });
  it('requires a real reason to reject and shows it to the tester', async () => {
    const { builder, tester, participationId } = await submitted();
    expect((await decide(participationId, builder.token, { decision: 'reject', reason: 'too short' })).statusCode).toBe(400);
    await decide(participationId, builder.token, { decision: 'reject', reason: 'Task 2 was not attempted at all' });
    const [p] = (await t.app.inject({ method: 'GET', url: '/v1/tester/participations', headers: bearer(tester.token) })).json();
    expect(p).toMatchObject({ status: 'rejected', decisionReason: 'Task 2 was not attempted at all' });
  });
  it('decides only once, only by the study owner', async () => {
    const { builder, tester, participationId } = await submitted();
    const other = await registerAs(t.app, 'builder');
    expect((await decide(participationId, other.token, { decision: 'approve' })).statusCode).toBe(404);
    expect((await decide(participationId, tester.token, { decision: 'approve' })).statusCode).toBe(403);
    await decide(participationId, builder.token, { decision: 'approve' });
    expect((await decide(participationId, builder.token, { decision: 'approve' })).json().error.code).toBe('INVALID_TRANSITION');
  });
  it('records findings anchored to evidence and flags duplicate uploads across testers', async () => {
    const { builder, participationId, evidenceId } = await submitted();
    const f = await t.app.inject({ method: 'POST', url: `/v1/submissions/${participationId}/findings`, headers: bearer(builder.token), payload: { title: 'Continue button hidden', severity: 'major', evidenceItemId: evidenceId, timestampMs: 500, description: 'The CTA is below the fold on small screens.' } });
    expect(f.statusCode).toBe(201);
    const detail = (await t.app.inject({ method: 'GET', url: `/v1/submissions/${participationId}`, headers: bearer(builder.token) })).json();
    expect(detail.findings[0]).toMatchObject({ title: 'Continue button hidden', source: 'human' });
    expect(detail.evidence[0].duplicateOfOtherParticipant).toBe(false);
  });
  it('exports a markdown findings report without tester emails', async () => {
    const { builder, tester, participationId, study, evidenceId } = await submitted();
    await t.app.inject({ method: 'POST', url: `/v1/submissions/${participationId}/findings`, headers: bearer(builder.token), payload: { title: 'Continue button hidden', severity: 'critical', evidenceItemId: evidenceId, timestampMs: 65000, description: 'The CTA is below the fold on small screens.' } });
    const res = await t.app.inject({ method: 'GET', url: `/v1/builder/studies/${study.studyId}/report.md`, headers: bearer(builder.token) });
    expect(res.headers['content-type']).toContain('text/markdown');
    expect(res.body).toContain('## Critical (1)');
    expect(res.body).toContain('at 01:05');
    expect(res.body).not.toContain(tester.email);
  });
});
```

- [ ] **Step 2: Run to verify failure** — FAIL: decision route → 404.

- [ ] **Step 3: Implement** — `apps/api/src/routes/review.ts`:

```ts
import { randomUUID } from 'node:crypto';
import { and, desc, eq, inArray, ne } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { DecisionInputSchema, FindingInputSchema } from '@pocketqa/contracts';
import { DomainError, transitionParticipation } from '@pocketqa/domain';
import { devnetTransferUrl } from '../lib/explorer';
import type { Db } from '../db/client';
import { aiSuggestions, compensations, devnetTransfers, evidenceItems, findings, ledgerEntries, participations, studies, taskResults } from '../db/schema';
import { loadOwnedStudy, loadSubmissionForViewer } from '../lib/access';
import { appendAudit } from '../lib/audit';
import { tasksOf } from '../lib/study-queries';
import { requireRole, requireUser } from '../plugins/auth';
import { toParticipationDto } from './tester';

const PidParam = z.object({ participationId: z.uuid() });
const IdParam = z.object({ id: z.uuid() });
const SEVERITY_ORDER = ['critical', 'major', 'minor', 'info'] as const;
const mmss = (ms: number) => `${String(Math.floor(ms / 60000)).padStart(2, '0')}:${String(Math.floor((ms % 60000) / 1000)).padStart(2, '0')}`;

export function toCompensationDto(db: Db, compensationId: string) {
  const c = db.select().from(compensations).where(eq(compensations.id, compensationId)).get()!;
  const p = db.select().from(participations).where(eq(participations.id, c.participationId)).get()!;
  const s = db.select({ title: studies.title }).from(studies).where(eq(studies.id, p.studyId)).get()!;
  const transfers = db.select().from(devnetTransfers).where(eq(devnetTransfers.compensationId, c.id)).orderBy(desc(devnetTransfers.createdAt)).all();
  return {
    id: c.id, participationId: c.participationId, studyTitle: s.title, credits: c.credits, status: c.status,
    transfers: transfers.map((x) => ({ id: x.id, compensationId: c.id, signature: x.signature, status: x.status, failureReason: x.failureReason, explorerUrl: devnetTransferUrl(x.signature) })),
  };
}

function evidenceDtos(db: Db, participationId: string, testerId: string) {
  return db.select().from(evidenceItems).where(and(eq(evidenceItems.participationId, participationId), eq(evidenceItems.status, 'uploaded'))).all().map((e) => {
    const dup = e.sha256 ? db.select({ id: evidenceItems.id }).from(evidenceItems)
      .innerJoin(participations, eq(participations.id, evidenceItems.participationId))
      .where(and(eq(evidenceItems.sha256, e.sha256), eq(evidenceItems.status, 'uploaded'), ne(participations.testerId, testerId))).get() : undefined;
    return { id: e.id, participationId: e.participationId, taskId: e.taskId, kind: e.kind, status: e.status, mime: e.mime, sizeBytes: e.sizeBytes, sha256: e.sha256, durationMs: e.durationMs, captureSource: e.captureSource, duplicateOfOtherParticipant: Boolean(dup) };
  });
}

const findingDto = (f: typeof findings.$inferSelect) => ({ id: f.id, title: f.title, severity: f.severity, evidenceItemId: f.evidenceItemId, timestampMs: f.timestampMs, description: f.description, source: f.source, createdAt: f.createdAt.toISOString() });

export async function reviewRoutes(app: FastifyInstance): Promise<void> {
  const { db } = app.ctx;

  app.get('/tester/participations', async (req) => {
    const user = requireRole(req, 'tester');
    return db.select({ id: participations.id }).from(participations).where(eq(participations.testerId, user.id)).orderBy(desc(participations.claimedAt)).all().map((p) => toParticipationDto(db, p.id));
  });

  app.get('/tester/rewards', async (req) => {
    const user = requireRole(req, 'tester');
    return db.select({ id: compensations.id }).from(compensations).innerJoin(participations, eq(participations.id, compensations.participationId))
      .where(eq(participations.testerId, user.id)).all().map((c) => toCompensationDto(db, c.id));
  });

  app.get('/builder/studies/:id/submissions', async (req) => {
    const user = requireRole(req, 'builder');
    const study = loadOwnedStudy(app, IdParam.parse(req.params).id, user.id);
    return db.select({ id: participations.id }).from(participations)
      .where(and(eq(participations.studyId, study.id), inArray(participations.status, ['submitted', 'approved', 'rejected', 'disputed']))).all()
      .map((p) => toParticipationDto(db, p.id));
  });

  app.get('/submissions/:participationId', async (req) => {
    const user = requireUser(req);
    const { participation: p, study } = loadSubmissionForViewer(app, PidParam.parse(req.params).participationId, user);
    if (!['submitted', 'approved', 'rejected', 'disputed'].includes(p.status)) throw new DomainError('NOT_FOUND', 'Submission not found');
    const comp = db.select().from(compensations).where(eq(compensations.participationId, p.id)).get();
    return {
      participation: toParticipationDto(db, p.id),
      study: { id: study.id, title: study.title, rewardCredits: study.rewardCredits, aiProcessingEnabled: study.aiProcessingEnabled },
      tasks: tasksOf(db, study.id).map((x) => ({ id: x.id, position: x.position, title: x.title, instructions: x.instructions, maxMinutes: x.maxMinutes })),
      results: db.select().from(taskResults).where(eq(taskResults.participationId, p.id)).all(),
      evidence: evidenceDtos(db, p.id, p.testerId),
      findings: db.select().from(findings).where(eq(findings.participationId, p.id)).all().map(findingDto),
      aiSuggestions: db.select().from(aiSuggestions).where(eq(aiSuggestions.participationId, p.id)).all().map((s) => ({ id: s.id, status: s.status, provider: s.provider, model: s.model, findings: JSON.parse(s.payloadJson).findings, label: 'AI suggestion · verify against the recording' as const })),
      compensation: comp ? toCompensationDto(db, comp.id) : null,
    };
  });

  app.post('/submissions/:participationId/findings', async (req, reply) => {
    const user = requireRole(req, 'builder');
    const { participation: p } = loadSubmissionForViewer(app, PidParam.parse(req.params).participationId, user);
    if (!['submitted', 'approved', 'rejected', 'disputed'].includes(p.status)) throw new DomainError('INVALID_TRANSITION', 'Findings can be added once the session is submitted');
    const body = FindingInputSchema.parse(req.body);
    if (body.evidenceItemId) {
      const e = db.select().from(evidenceItems).where(eq(evidenceItems.id, body.evidenceItemId)).get();
      if (!e || e.participationId !== p.id) throw new DomainError('VALIDATION_FAILED', 'That recording is not part of this submission');
      if (body.timestampMs !== null && e.durationMs !== null && body.timestampMs > e.durationMs) throw new DomainError('VALIDATION_FAILED', 'Timestamp is past the end of the recording');
    }
    const id = randomUUID();
    db.insert(findings).values({ id, participationId: p.id, createdBy: user.id, ...body, source: 'human', createdAt: app.ctx.now() }).run();
    return reply.status(201).send(findingDto(db.select().from(findings).where(eq(findings.id, id)).get()!));
  });

  app.post('/submissions/:participationId/decision', async (req) => {
    const user = requireRole(req, 'builder');
    const { participation: p, study } = loadSubmissionForViewer(app, PidParam.parse(req.params).participationId, user);
    const body = DecisionInputSchema.parse(req.body);
    const next = transitionParticipation(p.status, body.decision === 'approve' ? { type: 'APPROVE' } : { type: 'REJECT', reason: body.reason });
    const now = app.ctx.now();
    db.transaction((tx) => {
      tx.update(participations).set({ status: next, decidedAt: now, reviewerId: user.id, decisionReason: body.reason ?? null }).where(eq(participations.id, p.id)).run();
      if (next === 'approved') {
        // R4: compensation exists only because a reviewer approved; it starts unpaid (test credits).
        tx.insert(compensations).values({ id: randomUUID(), participationId: p.id, credits: study.rewardCredits, status: 'approved_unpaid', createdAt: now }).run();
        tx.insert(ledgerEntries).values({ id: randomUUID(), studyId: study.id, participationId: p.id, kind: 'reward_approved', amount: study.rewardCredits, createdBy: user.id, createdAt: now }).run();
      }
    });
    appendAudit(db, { actorId: user.id, action: `submission.${body.decision}`, targetType: 'participation', targetId: p.id }, now);
    return toParticipationDto(db, p.id);
  });

  app.get('/builder/studies/:id/report.md', async (req, reply) => {
    const user = requireRole(req, 'builder');
    const study = loadOwnedStudy(app, IdParam.parse(req.params).id, user.id);
    const rows = db.select({ f: findings }).from(findings).innerJoin(participations, eq(participations.id, findings.participationId))
      .where(eq(participations.studyId, study.id)).all().map((r) => r.f);
    const lines = [`# Findings report — ${study.title}`, '', `Generated ${app.ctx.now().toISOString()} · App: ${study.appName} · Link: ${study.appLink}`, ''];
    for (const sev of SEVERITY_ORDER) {
      const group = rows.filter((f) => f.severity === sev);
      if (group.length === 0) continue;
      lines.push(`## ${sev[0]!.toUpperCase()}${sev.slice(1)} (${group.length})`, '');
      for (const f of group) {
        const where = [`session ${f.participationId.slice(0, 8)}`, f.evidenceItemId ? `recording ${f.evidenceItemId.slice(0, 8)}` : null, f.timestampMs !== null ? `at ${mmss(f.timestampMs)}` : null].filter(Boolean).join(', ');
        lines.push(`- **${f.title}** — ${where}${f.source === 'ai_accepted' ? ' (from an accepted AI suggestion)' : ''}`, `  ${f.description}`, '');
      }
    }
    return reply.header('Content-Type', 'text/markdown; charset=utf-8').send(lines.join('\n'));
  });
}
```

Create `apps/api/src/lib/explorer.ts`:
```ts
export { devnetExplorerTxUrl as devnetTransferUrl } from '@pocketqa/wallet-auth';
```

Extend `apps/api/src/dev/seed.ts` with a `submitted-session` scenario (used by Playwright, T8.1):
```ts
// Append below seedScenario; route accepts scenario: z.enum(['users', 'submitted-session']).
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export async function seedSubmittedSession(app: FastifyInstance) {
  const base = await seedScenario(app, 'users');
  const call = (method: 'GET' | 'POST' | 'PUT', url: string, token: string, payload?: unknown, headers: Record<string, string> = {}) =>
    app.inject({ method, url, headers: { authorization: `Bearer ${token}`, ...headers }, payload: payload as never });
  const b = base.users.builder.token;
  const tester = base.users.tester.token;
  const studyId = (await call('POST', '/v1/studies', b, { title: 'Wallet onboarding (seed)', appName: 'DemoApp', appLink: 'https://example.invalid/app', goal: 'Find where new users get stuck', rewardCredits: 120, slotsTotal: 3, aiProcessingEnabled: true })).json().id;
  await call('PUT', `/v1/studies/${studyId}/tasks`, b, { tasks: [{ title: 'Create account', instructions: 'Sign up with the provided test email', maxMinutes: 5 }, { title: 'Connect test wallet', instructions: 'Connect the provided devnet test wallet', maxMinutes: 5 }] });
  await call('PUT', `/v1/studies/${studyId}/criteria`, b, { platforms: ['android'], minAndroidApi: 29, minIosMajor: null, requireSelfReportedSeeker: false });
  await call('PUT', `/v1/studies/${studyId}/consent`, b, { textMd: 'This seeded study tests DemoApp onboarding with a devnet test wallet only.', scopes: ['screen_recording', 'microphone', 'ai_processing'] });
  await call('POST', `/v1/studies/${studyId}/fund`, b, { credits: 1000 });
  await call('POST', `/v1/studies/${studyId}/publish`, b);
  await call('PUT', '/v1/me/device-profile', tester, { platform: 'android', osVersion: '16', androidApi: 36, iosMajor: null, model: 'Seeker', manufacturer: 'Solana Mobile', selfReportedSeeker: true, modelHintSeeker: true });
  const pid = (await call('POST', `/v1/studies/${studyId}/participations`, tester)).json().id;
  const study = (await call('GET', `/v1/studies/${studyId}`, tester)).json();
  await call('POST', `/v1/participations/${pid}/consent`, tester, { consentVersionId: study.consent.id, scopes: ['screen_recording', 'microphone'] });
  await call('POST', `/v1/participations/${pid}/start`, tester);
  const mp4 = readFileSync(fileURLToPath(new URL('../../test/fixtures/sample.mp4', import.meta.url)));
  const evidenceId = (await call('POST', `/v1/participations/${pid}/evidence`, tester, { kind: 'screen_recording', taskId: study.tasks[0].id, mime: 'video/mp4', sizeBytes: mp4.length, sha256: null, durationMs: 1000, captureSource: 'android_media_projection' })).json().evidenceId;
  await call('PUT', `/v1/evidence/${evidenceId}/content`, tester, mp4, { 'content-type': 'video/mp4', 'content-length': String(mp4.length) });
  await call('PUT', `/v1/participations/${pid}/task-results`, tester, { results: study.tasks.map((x: { id: string }) => ({ taskId: x.id, outcome: 'blocked', difficulty: 4, note: 'Could not find the continue button' })) });
  await call('POST', `/v1/participations/${pid}/submit`, tester);
  return { ...base, scenario: 'submitted-session' as const, studyId, participationId: pid, evidenceId };
}
```
In `plugins/test-hooks.ts`, set `SeedBody = z.object({ scenario: z.enum(['users', 'submitted-session']) })` and dispatch: `scenario === 'users' ? seedScenario(app, 'users') : seedSubmittedSession(app)`.

- [ ] **Step 4: Run** — `pnpm --filter @pocketqa/api test` → `65 passed` (T2.9's sixth test is re-enabled).
- [ ] **Step 5: Commit** — files above; message `feat(api): review decisions, findings, compensation and markdown report`.

### Task T2.11: Disputes, moderation, audit log, admin CLI

**Files:**
- Create: `apps/api/src/routes/disputes.ts`, `apps/api/src/routes/admin.ts`, `apps/api/src/cli/admin-create.ts`
- Modify: `apps/api/src/routes/index.ts` (add `await disputeRoutes(v1); await adminRoutes(v1);`)
- Test: `apps/api/test/disputes.test.ts`, `apps/api/test/admin.test.ts`

**Interfaces:**
- Consumes: `releaseReservation`, `expireActiveParticipations`, `transitionStudy`, `createAdminSession` fixture.
- Produces: `createAdminUser(db, email, password, now) → { id }`.

- [ ] **Step 1: Write the failing tests**

`apps/api/test/disputes.test.ts`:
```ts
import { afterEach, describe, expect, it } from 'vitest';
import { bearer, createAdminSession, registerAs, seedDeviceProfile, seedPublishedStudy, startParticipation, uploadFixture } from './fixtures';
import { makeTestApp, mutableClock } from './helpers';

let t: Awaited<ReturnType<typeof makeTestApp>>;
afterEach(async () => t?.close());

async function rejected(clock = mutableClock()) {
  t = await makeTestApp({ now: clock.get });
  const builder = await registerAs(t.app, 'builder');
  const study = await seedPublishedStudy(t.app, builder.token, { rewardCredits: 100 });
  const tester = await registerAs(t.app, 'tester');
  await seedDeviceProfile(t.app, tester.token);
  const { participationId } = await startParticipation(t.app, tester.token, study.studyId);
  await uploadFixture(t.app, tester.token, participationId, study.taskIds[0]!);
  await t.app.inject({ method: 'PUT', url: `/v1/participations/${participationId}/task-results`, headers: bearer(tester.token), payload: { results: study.taskIds.map((taskId) => ({ taskId, outcome: 'completed', difficulty: 2, note: 'ok' })) } });
  await t.app.inject({ method: 'POST', url: `/v1/participations/${participationId}/submit`, headers: bearer(tester.token) });
  await t.app.inject({ method: 'POST', url: `/v1/submissions/${participationId}/decision`, headers: bearer(builder.token), payload: { decision: 'reject', reason: 'Recording does not show task 2' } });
  const admin = createAdminSession(t.db, clock.get());
  return { builder, tester, admin, participationId, clock };
}
const open = (pid: string, token: string) => t.app.inject({ method: 'POST', url: `/v1/participations/${pid}/disputes`, headers: bearer(token), payload: { reason: 'Task 2 is visible at the end of the second recording.' } });
const resolve = async (adminToken: string, outcome: 'uphold' | 'overturn') => {
  const [d] = (await t.app.inject({ method: 'GET', url: '/v1/admin/disputes', headers: bearer(adminToken) })).json();
  return t.app.inject({ method: 'POST', url: `/v1/admin/disputes/${d.id}/resolve`, headers: bearer(adminToken), payload: { outcome, reason: 'Reviewed both recordings carefully.' } });
};

describe('disputes', () => {
  it('lets a tester dispute once within the window', async () => {
    const { tester, participationId } = await rejected();
    expect((await open(participationId, tester.token)).statusCode).toBe(201);
    expect((await open(participationId, tester.token)).json().error.code).toBe('INVALID_TRANSITION');
  });
  it('closes the window after 7 days', async () => {
    const clock = mutableClock();
    const { tester, participationId } = await rejected(clock);
    clock.advanceMs(8 * 24 * 3600 * 1000);
    expect((await open(participationId, tester.token)).json().error.message).toBe('The dispute window has closed');
  });
  it('overturn approves and creates compensation; uphold releases the reservation', async () => {
    const a = await rejected();
    await open(a.participationId, a.tester.token);
    await resolve(a.admin.token, 'overturn');
    const rewards = (await t.app.inject({ method: 'GET', url: '/v1/tester/rewards', headers: bearer(a.tester.token) })).json();
    expect(rewards[0]).toMatchObject({ credits: 100, status: 'approved_unpaid' });
    await t.close();
    const b = await rejected();
    await open(b.participationId, b.tester.token);
    await resolve(b.admin.token, 'uphold');
    const [summary] = (await t.app.inject({ method: 'GET', url: '/v1/builder/studies', headers: bearer(b.builder.token) })).json();
    expect(summary.budget.available).toBe(1000);
  });
  it('only admins resolve', async () => {
    const { tester, builder, participationId } = await rejected();
    await open(participationId, tester.token);
    expect((await t.app.inject({ method: 'GET', url: '/v1/admin/disputes', headers: bearer(builder.token) })).statusCode).toBe(403);
  });
});
```

`apps/api/test/admin.test.ts`:
```ts
import { afterEach, describe, expect, it } from 'vitest';
import { createAdminUser } from '../src/cli/admin-create';
import { bearer, createAdminSession, PASSWORD, registerAs } from './fixtures';
import { makeTestApp } from './helpers';

let t: Awaited<ReturnType<typeof makeTestApp>>;
afterEach(async () => t?.close());

describe('admin', () => {
  it('suspends a user, which immediately blocks their session', async () => {
    t = await makeTestApp();
    const admin = createAdminSession(t.db, new Date());
    const tester = await registerAs(t.app, 'tester');
    const res = await t.app.inject({ method: 'POST', url: '/v1/admin/moderation', headers: bearer(admin.token), payload: { targetType: 'user', targetId: tester.userId, action: 'suspend', reason: 'Repeated duplicate submissions' } });
    expect(res.statusCode).toBe(200);
    expect((await t.app.inject({ method: 'GET', url: '/v1/me', headers: bearer(tester.token) })).statusCode).toBe(401);
  });
  it('shows audit entries without personal data', async () => {
    t = await makeTestApp();
    const admin = createAdminSession(t.db, new Date());
    const tester = await registerAs(t.app, 'tester');
    const log = (await t.app.inject({ method: 'GET', url: '/v1/admin/audit', headers: bearer(admin.token) })).json();
    expect(log.some((e: { action: string }) => e.action === 'user.register')).toBe(true);
    expect(JSON.stringify(log)).not.toContain(tester.email);
  });
  it('creates admins only through the CLI function, never the API', async () => {
    t = await makeTestApp();
    const { id } = await createAdminUser(t.db, 'ops@example.test', PASSWORD, new Date());
    const login = await t.app.inject({ method: 'POST', url: '/v1/auth/login', payload: { email: 'ops@example.test', password: PASSWORD } });
    expect(login.json().user).toMatchObject({ id, role: 'admin' });
  });
});
```

- [ ] **Step 2: Run to verify failure** — FAIL: cannot resolve `../src/cli/admin-create`.

- [ ] **Step 3: Implement**

`apps/api/src/routes/disputes.ts`:
```ts
import { randomUUID } from 'node:crypto';
import { asc, eq, sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { DisputeInputSchema, ResolveDisputeInputSchema } from '@pocketqa/contracts';
import { DomainError, transitionParticipation } from '@pocketqa/domain';
import { compensations, disputes, ledgerEntries, participations, studies } from '../db/schema';
import { loadOwnParticipation } from '../lib/access';
import { appendAudit } from '../lib/audit';
import { releaseReservation } from '../lib/participation-ops';
import { requireRole } from '../plugins/auth';

const IdParam = z.object({ id: z.uuid() });
const DAY_MS = 24 * 3600 * 1000;
const dto = (d: typeof disputes.$inferSelect) => ({ id: d.id, participationId: d.participationId, status: d.status, reason: d.reason, resolutionReason: d.resolutionReason, createdAt: d.createdAt.toISOString() });

export async function disputeRoutes(app: FastifyInstance): Promise<void> {
  const { db, config } = app.ctx;

  app.post('/participations/:id/disputes', async (req, reply) => {
    const user = requireRole(req, 'tester');
    const p = loadOwnParticipation(app, IdParam.parse(req.params).id, user.id);
    const { reason } = DisputeInputSchema.parse(req.body);
    const now = app.ctx.now();
    const priorDisputes = db.select({ n: sql<number>`count(*)` }).from(disputes).where(eq(disputes.participationId, p.id)).get()!.n;
    const daysSinceDecision = p.decidedAt ? (now.getTime() - p.decidedAt.getTime()) / DAY_MS : 0;
    const next = transitionParticipation(p.status, { type: 'OPEN_DISPUTE', priorDisputes, daysSinceDecision, disputeWindowDays: config.DISPUTE_WINDOW_DAYS });
    const id = randomUUID();
    db.transaction((tx) => {
      tx.update(participations).set({ status: next }).where(eq(participations.id, p.id)).run();
      tx.insert(disputes).values({ id, participationId: p.id, openedBy: user.id, reason, status: 'open', createdAt: now }).run();
    });
    appendAudit(db, { actorId: user.id, action: 'dispute.open', targetType: 'dispute', targetId: id }, now);
    return reply.status(201).send(dto(db.select().from(disputes).where(eq(disputes.id, id)).get()!));
  });

  app.get('/admin/disputes', async (req) => {
    requireRole(req, 'admin');
    return db.select().from(disputes).orderBy(asc(disputes.status), asc(disputes.createdAt)).all().map(dto);
  });

  app.post('/admin/disputes/:id/resolve', async (req) => {
    const admin = requireRole(req, 'admin');
    const d = db.select().from(disputes).where(eq(disputes.id, IdParam.parse(req.params).id)).get();
    if (!d) throw new DomainError('NOT_FOUND', 'Dispute not found');
    if (d.status !== 'open') throw new DomainError('INVALID_TRANSITION', 'This dispute is already resolved');
    const body = ResolveDisputeInputSchema.parse(req.body);
    const p = db.select().from(participations).where(eq(participations.id, d.participationId)).get()!;
    const study = db.select().from(studies).where(eq(studies.id, p.studyId)).get()!;
    const next = transitionParticipation(p.status, { type: 'RESOLVE_DISPUTE', outcome: body.outcome });
    const now = app.ctx.now();
    db.transaction((tx) => {
      tx.update(participations).set({ status: next, decidedAt: now, decisionReason: body.reason }).where(eq(participations.id, p.id)).run();
      tx.update(disputes).set({ status: body.outcome === 'overturn' ? 'resolved_overturned' : 'resolved_upheld', resolutionReason: body.reason, resolvedBy: admin.id, resolvedAt: now }).where(eq(disputes.id, d.id)).run();
      if (body.outcome === 'overturn') {
        tx.insert(compensations).values({ id: randomUUID(), participationId: p.id, credits: study.rewardCredits, status: 'approved_unpaid', createdAt: now }).run();
        tx.insert(ledgerEntries).values({ id: randomUUID(), studyId: study.id, participationId: p.id, kind: 'reward_approved', amount: study.rewardCredits, createdBy: admin.id, createdAt: now }).run();
      } else {
        releaseReservation(tx as never, p, study.rewardCredits, admin.id, now);
      }
    });
    appendAudit(db, { actorId: admin.id, action: `dispute.${body.outcome}`, targetType: 'dispute', targetId: d.id }, now);
    return dto(db.select().from(disputes).where(eq(disputes.id, d.id)).get()!);
  });
}
```

`apps/api/src/routes/admin.ts`:
```ts
import { randomUUID } from 'node:crypto';
import { desc, eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { ModerationInputSchema } from '@pocketqa/contracts';
import { DomainError, transitionStudy } from '@pocketqa/domain';
import { auditLog, moderationActions, sessions, studies, users } from '../db/schema';
import { appendAudit } from '../lib/audit';
import { expireActiveParticipations } from '../lib/participation-ops';
import { requireRole } from '../plugins/auth';

export async function adminRoutes(app: FastifyInstance): Promise<void> {
  const { db } = app.ctx;

  app.post('/admin/moderation', async (req) => {
    const admin = requireRole(req, 'admin');
    const body = ModerationInputSchema.parse(req.body);
    const now = app.ctx.now();
    if (body.targetType === 'user') {
      const target = db.select().from(users).where(eq(users.id, body.targetId)).get();
      if (!target || target.role === 'admin' || body.action === 'close_study') throw new DomainError('NOT_FOUND', 'User not found');
      db.transaction((tx) => {
        tx.update(users).set({ status: body.action === 'suspend' ? 'suspended' : 'active' }).where(eq(users.id, target.id)).run();
        if (body.action === 'suspend') tx.update(sessions).set({ revokedAt: now }).where(eq(sessions.userId, target.id)).run();
      });
    } else {
      const study = db.select().from(studies).where(eq(studies.id, body.targetId)).get();
      if (!study || body.action !== 'close_study') throw new DomainError('NOT_FOUND', 'Study not found');
      const next = transitionStudy(study.status, 'CLOSE');
      db.transaction((tx) => {
        tx.update(studies).set({ status: next, closedAt: now }).where(eq(studies.id, study.id)).run();
        expireActiveParticipations(tx as never, study.id, study.rewardCredits, admin.id, now);
      });
    }
    db.insert(moderationActions).values({ id: randomUUID(), adminId: admin.id, ...body, createdAt: now }).run();
    appendAudit(db, { actorId: admin.id, action: `moderation.${body.action}`, targetType: body.targetType, targetId: body.targetId }, now);
    return { ok: true };
  });

  app.get('/admin/audit', async (req) => {
    requireRole(req, 'admin');
    return db.select().from(auditLog).orderBy(desc(auditLog.at)).limit(200).all()
      .map((e) => ({ id: e.id, actorId: e.actorId, action: e.action, targetType: e.targetType, targetId: e.targetId, meta: JSON.parse(e.metaJson), at: e.at.toISOString() }));
  });
}
```

`apps/api/src/cli/admin-create.ts`:
```ts
import { randomUUID } from 'node:crypto';
import { createInterface } from 'node:readline/promises';
import { stdin, stdout } from 'node:process';
import { loadConfig } from '../config';
import type { Db } from '../db/client';
import { openDb } from '../db/client';
import { users } from '../db/schema';
import { hashPassword } from '../lib/passwords';

/** Admins exist only through this CLI (ADR-04); the password is read from stdin, never argv or logs. */
export async function createAdminUser(db: Db, email: string, password: string, now: Date) {
  if (password.length < 12) throw new Error('Admin password must be at least 12 characters');
  const id = randomUUID();
  db.insert(users).values({ id, email: email.toLowerCase(), passwordHash: await hashPassword(password), role: 'admin', displayName: 'Admin', status: 'active', adultAttestedAt: now, createdAt: now }).run();
  return { id };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const emailIndex = process.argv.indexOf('--email');
  const email = emailIndex > -1 ? process.argv[emailIndex + 1] : undefined;
  if (!email) throw new Error('Usage: pnpm --filter @pocketqa/api admin:create --email you@example.com (password is read from stdin)');
  const rl = createInterface({ input: stdin, output: stdout, terminal: false });
  const password = (await rl.question('')).trim();
  rl.close();
  const config = loadConfig(process.env);
  const { id } = await createAdminUser(openDb(config.DATABASE_FILE), email, password, new Date());
  console.log(`admin created: ${id}`);
}
```

- [ ] **Step 4: Run** — `pnpm --filter @pocketqa/api test` → `72 passed`.
- [ ] **Step 5: Commit** — files above; message `feat(api): disputes, moderation, audit log and admin CLI`.

### Task T2.12: Data requests (export and deletion) and maintenance jobs

**Files:**
- Create: `apps/api/src/routes/data-requests.ts`, `apps/api/src/services/data-export.ts`, `apps/api/src/services/data-deletion.ts`, `apps/api/src/jobs/jobs.ts`, `apps/api/src/jobs/run-jobs.ts`
- Modify: `apps/api/src/routes/index.ts` (add `await dataRequestRoutes(v1);`)
- Test: `apps/api/test/data-requests.test.ts`, `apps/api/test/jobs.test.ts`

**Interfaces:**
- Produces:
  - `buildUserExport(db, userId)`.
  - `deleteUserData(ctx, userId, now) → { purgedFiles }`.
  - `expireStaleClaims(ctx, now) → number`.
  - `releaseLapsedRejections(ctx, now) → number`.
  - `purgeExpiredEvidence(ctx, now) → number`.

- [ ] **Step 1: Write the failing tests**

`apps/api/test/data-requests.test.ts`:
```ts
import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { bearer, createAdminSession, registerAs, seedDeviceProfile, seedPublishedStudy, startParticipation, uploadFixture } from './fixtures';
import { makeTestApp } from './helpers';

let t: Awaited<ReturnType<typeof makeTestApp>>;
afterEach(async () => t?.close());

async function testerWithEvidence() {
  t = await makeTestApp();
  const builder = await registerAs(t.app, 'builder');
  const study = await seedPublishedStudy(t.app, builder.token);
  const tester = await registerAs(t.app, 'tester');
  const bystander = await registerAs(t.app, 'tester');
  await seedDeviceProfile(t.app, tester.token);
  const { participationId } = await startParticipation(t.app, tester.token, study.studyId);
  await uploadFixture(t.app, tester.token, participationId, study.taskIds[0]!);
  return { builder, tester, bystander, admin: createAdminSession(t.db, new Date()) };
}
const request = (token: string, kind: 'export' | 'deletion') => t.app.inject({ method: 'POST', url: '/v1/me/data-requests', headers: bearer(token), payload: { kind } });
const complete = (adminToken: string, id: string) => t.app.inject({ method: 'POST', url: `/v1/admin/data-requests/${id}/complete`, headers: bearer(adminToken) });

describe('data requests', () => {
  it('exports only the requester\'s own data', async () => {
    const { tester, bystander, admin } = await testerWithEvidence();
    const id = (await request(tester.token, 'export')).json().id;
    await complete(admin.token, id);
    const res = await t.app.inject({ method: 'GET', url: `/v1/me/data-requests/${id}/export`, headers: bearer(tester.token) });
    expect(res.json().user.email).toBe(tester.email);
    expect(res.json().participations).toHaveLength(1);
    expect(res.json().evidence[0]).toHaveProperty('sha256');
    expect(res.body).not.toContain(bystander.email);
  });
  it('deletes: revokes sessions, purges media, pseudonymizes, keeps the ledger', async () => {
    const { tester, admin, builder } = await testerWithEvidence();
    const id = (await request(tester.token, 'deletion')).json().id;
    await complete(admin.token, id);
    expect((await t.app.inject({ method: 'GET', url: '/v1/me', headers: bearer(tester.token) })).statusCode).toBe(401);
    expect(readdirSync(join(t.dir, 'media')).filter((f) => f.endsWith('.bin'))).toHaveLength(0);
    const audit = (await t.app.inject({ method: 'GET', url: '/v1/admin/audit', headers: bearer(admin.token) })).json();
    expect(audit.some((e: { action: string }) => e.action === 'data.deletion')).toBe(true);
    const [summary] = (await t.app.inject({ method: 'GET', url: '/v1/builder/studies', headers: bearer(builder.token) })).json();
    expect(summary.budget.funded).toBe(1000);
  });
  it('is admin-completed only', async () => {
    const { tester } = await testerWithEvidence();
    const id = (await request(tester.token, 'export')).json().id;
    expect((await complete(tester.token, id)).statusCode).toBe(403);
  });
});
```

`apps/api/test/jobs.test.ts`:
```ts
import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { expireStaleClaims, purgeExpiredEvidence, releaseLapsedRejections } from '../src/jobs/jobs';
import { bearer, registerAs, seedDeviceProfile, seedPublishedStudy, startParticipation, uploadFixture } from './fixtures';
import { makeTestApp, mutableClock } from './helpers';

let t: Awaited<ReturnType<typeof makeTestApp>>;
afterEach(async () => t?.close());
const H = 3600 * 1000;

async function base(clock: ReturnType<typeof mutableClock>) {
  t = await makeTestApp({ now: clock.get });
  const builder = await registerAs(t.app, 'builder');
  const study = await seedPublishedStudy(t.app, builder.token);
  const tester = await registerAs(t.app, 'tester');
  await seedDeviceProfile(t.app, tester.token);
  const { participationId } = await startParticipation(t.app, tester.token, study.studyId);
  return { builder, tester, study, participationId };
}
async function rejectAfterUpload(s: Awaited<ReturnType<typeof base>>) {
  await uploadFixture(t.app, s.tester.token, s.participationId, s.study.taskIds[0]!);
  await t.app.inject({ method: 'PUT', url: `/v1/participations/${s.participationId}/task-results`, headers: bearer(s.tester.token), payload: { results: s.study.taskIds.map((taskId) => ({ taskId, outcome: 'completed', difficulty: 2, note: 'ok' })) } });
  await t.app.inject({ method: 'POST', url: `/v1/participations/${s.participationId}/submit`, headers: bearer(s.tester.token) });
  await t.app.inject({ method: 'POST', url: `/v1/submissions/${s.participationId}/decision`, headers: bearer(s.builder.token), payload: { decision: 'reject', reason: 'Recording does not show task 2' } });
}

describe('jobs', () => {
  it('expires claims older than 48 hours and releases their reservation', async () => {
    const clock = mutableClock();
    await base(clock);
    expect(expireStaleClaims(t.app.ctx, clock.get())).toBe(0);
    clock.advanceMs(49 * H);
    expect(expireStaleClaims(t.app.ctx, clock.get())).toBe(1);
  });
  it('releases rejected reservations after the dispute window', async () => {
    const clock = mutableClock();
    const s = await base(clock);
    await rejectAfterUpload(s);
    expect(releaseLapsedRejections(t.app.ctx, clock.get())).toBe(0);
    clock.advanceMs(8 * 24 * H);
    expect(releaseLapsedRejections(t.app.ctx, clock.get())).toBe(1);
  });
  it('purges evidence 30 days after a decision', async () => {
    const clock = mutableClock();
    const s = await base(clock);
    await rejectAfterUpload(s);
    clock.advanceMs(31 * 24 * H);
    expect(await purgeExpiredEvidence(t.app.ctx, clock.get())).toBe(1);
    expect(readdirSync(join(t.dir, 'media')).filter((f) => f.endsWith('.bin'))).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run to verify failure** — FAIL: cannot resolve `../src/jobs/jobs`.

- [ ] **Step 3: Implement**

`apps/api/src/services/data-export.ts`:
```ts
import { eq, inArray } from 'drizzle-orm';
import type { Db } from '../db/client';
import { compensations, deviceProfiles, evidenceItems, findings, participations, studies, users, walletLinks } from '../db/schema';

/** Everything Pocket QA holds about one user — and nothing about anyone else (A12.3). */
export function buildUserExport(db: Db, userId: string) {
  const user = db.select({ id: users.id, email: users.email, role: users.role, displayName: users.displayName, createdAt: users.createdAt }).from(users).where(eq(users.id, userId)).get();
  const mine = db.select().from(participations).where(eq(participations.testerId, userId)).all();
  const ids = mine.map((p) => p.id);
  const none = ['00000000-0000-4000-8000-000000000000'];
  return {
    exportedAt: new Date().toISOString(),
    user,
    deviceProfile: db.select().from(deviceProfiles).where(eq(deviceProfiles.userId, userId)).get() ?? null,
    walletLinks: db.select().from(walletLinks).where(eq(walletLinks.userId, userId)).all(),
    participations: mine.map((p) => ({ id: p.id, studyId: p.studyId, status: p.status, scopes: JSON.parse(p.scopesJson), consentVersionId: p.consentVersionId, claimedAt: p.claimedAt, decidedAt: p.decidedAt, decisionReason: p.decisionReason })),
    evidence: db.select({ id: evidenceItems.id, participationId: evidenceItems.participationId, kind: evidenceItems.kind, status: evidenceItems.status, mime: evidenceItems.mime, sizeBytes: evidenceItems.sizeBytes, sha256: evidenceItems.sha256, createdAt: evidenceItems.createdAt }).from(evidenceItems).where(inArray(evidenceItems.participationId, ids.length ? ids : none)).all(),
    findingsAboutMySessions: db.select({ title: findings.title, severity: findings.severity, description: findings.description }).from(findings).where(inArray(findings.participationId, ids.length ? ids : none)).all(),
    compensations: db.select().from(compensations).where(inArray(compensations.participationId, ids.length ? ids : none)).all(),
    studiesIBuilt: db.select({ id: studies.id, title: studies.title, status: studies.status }).from(studies).where(eq(studies.builderId, userId)).all(),
  };
}
```

`apps/api/src/services/data-deletion.ts`:
```ts
import { and, eq, inArray, isNull } from 'drizzle-orm';
import type { AppContext } from '../app';
import { evidenceItems, participations, sessions, studies, users, walletLinks } from '../db/schema';
import { appendAudit } from '../lib/audit';
import { expireActiveParticipations } from '../lib/participation-ops';

/** Pseudonymize, never hard-delete: ledger and audit rows must stay intact for integrity (A12.3). */
export async function deleteUserData(ctx: AppContext, userId: string, now: Date) {
  const { db, media } = ctx;
  const owned = db.select().from(studies).where(eq(studies.builderId, userId)).all();
  const participationIds = [
    ...db.select({ id: participations.id }).from(participations).where(eq(participations.testerId, userId)).all().map((r) => r.id),
    ...(owned.length ? db.select({ id: participations.id }).from(participations).where(inArray(participations.studyId, owned.map((s) => s.id))).all().map((r) => r.id) : []),
  ];
  const files = participationIds.length
    ? db.select().from(evidenceItems).where(and(inArray(evidenceItems.participationId, participationIds), inArray(evidenceItems.status, ['pending_upload', 'uploaded']))).all()
    : [];
  db.transaction((tx) => {
    tx.update(sessions).set({ revokedAt: now }).where(and(eq(sessions.userId, userId), isNull(sessions.revokedAt))).run();
    tx.update(walletLinks).set({ unlinkedAt: now }).where(and(eq(walletLinks.userId, userId), isNull(walletLinks.unlinkedAt))).run();
    for (const s of owned) {
      if (s.status !== 'closed') tx.update(studies).set({ status: 'closed', closedAt: now }).where(eq(studies.id, s.id)).run();
      expireActiveParticipations(tx as never, s.id, s.rewardCredits, userId, now);
    }
    for (const e of files) tx.update(evidenceItems).set({ status: 'purged', purgedAt: now }).where(eq(evidenceItems.id, e.id)).run();
    tx.update(users).set({ email: `deleted+${userId}@invalid`, displayName: null, passwordHash: null, status: 'deleted', deletedAt: now }).where(eq(users.id, userId)).run();
  });
  for (const e of files) if (e.storageKey) await media.remove(e.storageKey);
  appendAudit(db, { actorId: null, action: 'data.deletion', targetType: 'user', targetId: userId, meta: { purgedFiles: files.length } }, now);
  return { purgedFiles: files.length };
}
```

`apps/api/src/routes/data-requests.ts`:
```ts
import { randomUUID } from 'node:crypto';
import { desc, eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { DataRequestInputSchema } from '@pocketqa/contracts';
import { DomainError } from '@pocketqa/domain';
import { dataRequests } from '../db/schema';
import { appendAudit } from '../lib/audit';
import { requireRole, requireUser } from '../plugins/auth';
import { buildUserExport } from '../services/data-export';
import { deleteUserData } from '../services/data-deletion';

const IdParam = z.object({ id: z.uuid() });
const dto = (r: typeof dataRequests.$inferSelect) => ({ id: r.id, kind: r.kind, status: r.status, createdAt: r.createdAt.toISOString(), completedAt: r.completedAt?.toISOString() ?? null });

export async function dataRequestRoutes(app: FastifyInstance): Promise<void> {
  const { db } = app.ctx;

  app.post('/me/data-requests', async (req, reply) => {
    const user = requireUser(req);
    const { kind } = DataRequestInputSchema.parse(req.body);
    const id = randomUUID();
    db.insert(dataRequests).values({ id, userId: user.id, kind, status: 'requested', createdAt: app.ctx.now() }).run();
    return reply.status(201).send(dto(db.select().from(dataRequests).where(eq(dataRequests.id, id)).get()!));
  });

  app.get('/me/data-requests', async (req) => {
    const user = requireUser(req);
    return db.select().from(dataRequests).where(eq(dataRequests.userId, user.id)).orderBy(desc(dataRequests.createdAt)).all().map(dto);
  });

  app.get('/me/data-requests/:id/export', async (req, reply) => {
    const user = requireUser(req);
    const r = db.select().from(dataRequests).where(eq(dataRequests.id, IdParam.parse(req.params).id)).get();
    if (!r || r.userId !== user.id || r.kind !== 'export' || r.status !== 'completed' || !r.exportJson) throw new DomainError('NOT_FOUND', 'Export not found');
    return reply.header('Content-Disposition', 'attachment; filename="pocketqa-export.json"').type('application/json').send(r.exportJson);
  });

  app.get('/admin/data-requests', async (req) => {
    requireRole(req, 'admin');
    return db.select().from(dataRequests).orderBy(desc(dataRequests.createdAt)).all().map(dto);
  });

  app.post('/admin/data-requests/:id/complete', async (req) => {
    const admin = requireRole(req, 'admin');
    const r = db.select().from(dataRequests).where(eq(dataRequests.id, IdParam.parse(req.params).id)).get();
    if (!r) throw new DomainError('NOT_FOUND', 'Request not found');
    if (r.status !== 'requested') throw new DomainError('INVALID_TRANSITION', 'This request is already handled');
    const now = app.ctx.now();
    const exportJson = r.kind === 'export' ? JSON.stringify(buildUserExport(db, r.userId)) : null;
    if (r.kind === 'deletion') await deleteUserData(app.ctx, r.userId, now);
    db.update(dataRequests).set({ status: 'completed', completedAt: now, exportJson }).where(eq(dataRequests.id, r.id)).run();
    appendAudit(db, { actorId: admin.id, action: `data_request.${r.kind}`, targetType: 'data_request', targetId: r.id }, now);
    return dto(db.select().from(dataRequests).where(eq(dataRequests.id, r.id)).get()!);
  });
}
```

`apps/api/src/jobs/jobs.ts`:
```ts
import { and, eq, inArray, isNull, lt } from 'drizzle-orm';
import type { AppContext } from '../app';
import { disputes, evidenceItems, participations, studies } from '../db/schema';
import { releaseReservation } from '../lib/participation-ops';

const H = 3600 * 1000;
const D = 24 * H;

export function expireStaleClaims(ctx: AppContext, now: Date): number {
  const cutoff = new Date(now.getTime() - ctx.config.CLAIM_TTL_HOURS * H);
  const stale = ctx.db.select({ p: participations, reward: studies.rewardCredits }).from(participations).innerJoin(studies, eq(studies.id, participations.studyId))
    .where(and(inArray(participations.status, ['claimed', 'consented', 'in_progress']), lt(participations.claimedAt, cutoff))).all();
  for (const { p, reward } of stale) {
    ctx.db.update(participations).set({ status: 'expired' }).where(eq(participations.id, p.id)).run();
    releaseReservation(ctx.db, p, reward, 'system', now);
  }
  return stale.length;
}

export function releaseLapsedRejections(ctx: AppContext, now: Date): number {
  const cutoff = new Date(now.getTime() - ctx.config.DISPUTE_WINDOW_DAYS * D);
  const rows = ctx.db.select({ p: participations, reward: studies.rewardCredits }).from(participations).innerJoin(studies, eq(studies.id, participations.studyId))
    .leftJoin(disputes, eq(disputes.participationId, participations.id))
    .where(and(eq(participations.status, 'rejected'), lt(participations.decidedAt, cutoff), isNull(participations.reservationReleasedAt), isNull(disputes.id))).all();
  for (const { p, reward } of rows) releaseReservation(ctx.db, p, reward, 'system', now);
  return rows.length;
}

export async function purgeExpiredEvidence(ctx: AppContext, now: Date): Promise<number> {
  const cutoff = new Date(now.getTime() - ctx.config.EVIDENCE_RETENTION_DAYS * D);
  const rows = ctx.db.select({ e: evidenceItems }).from(evidenceItems).innerJoin(participations, eq(participations.id, evidenceItems.participationId))
    .where(and(eq(evidenceItems.status, 'uploaded'), inArray(participations.status, ['approved', 'rejected']), lt(participations.decidedAt, cutoff))).all();
  for (const { e } of rows) {
    ctx.db.update(evidenceItems).set({ status: 'purged', purgedAt: now }).where(eq(evidenceItems.id, e.id)).run();
    if (e.storageKey) await ctx.media.remove(e.storageKey);
  }
  return rows.length;
}
```
(Evidence of `disputed` participations is never selected: only `approved`/`rejected` qualify, so an open dispute holds the media, per A12.1.)

`apps/api/src/jobs/run-jobs.ts`:
```ts
import { loadConfig } from '../config';
import { openDb } from '../db/client';
import { createFsMediaStore } from '../services/media-store';
import { createUnavailableChainPort, noneAiProvider } from '../services/ports';
import { expireStaleClaims, purgeExpiredEvidence, releaseLapsedRejections } from './jobs';

const config = loadConfig(process.env);
const ctx = { config, db: openDb(config.DATABASE_FILE), media: createFsMediaStore(config.MEDIA_DIR), chain: createUnavailableChainPort(), ai: noneAiProvider, now: () => new Date() };
const now = new Date();
console.log(JSON.stringify({ expired: expireStaleClaims(ctx, now), released: releaseLapsedRejections(ctx, now), purged: await purgeExpiredEvidence(ctx, now) }));
```

- [ ] **Step 4: Run** — `pnpm --filter @pocketqa/api test` → `78 passed`.
- [ ] **Step 5: Commit** — files above; message `feat(api): export, deletion and retention jobs`.

### Task T2.13: AI provider registry and suggestion endpoints

**Files:**
- Create: `apps/api/src/services/ai.ts`, `apps/api/src/routes/ai.ts`
- Modify: `apps/api/src/routes/index.ts` (add `await aiRoutes(v1);`), `apps/api/src/server.ts` (replace `ai: noneAiProvider` with `ai: resolveAiProvider(config)`)
- Test: `apps/api/test/ai.test.ts`

**Interfaces:**
- Consumes: `AiProvider`, `noneAiProvider` (T2.1), `AiFindingSuggestionSchema` (T1.2).
- Produces: `resolveAiProvider(config): AiProvider` and `createFakeAiProvider(): AiProvider` (test-only).

- [ ] **Step 1: Write the failing test** — `apps/api/test/ai.test.ts`:

```ts
import { afterEach, describe, expect, it } from 'vitest';
import { loadConfig } from '../src/config';
import { createFakeAiProvider, resolveAiProvider } from '../src/services/ai';
import { bearer, registerAs, seedDeviceProfile, seedPublishedStudy, startParticipation, uploadFixture } from './fixtures';
import { makeTestApp } from './helpers';

let t: Awaited<ReturnType<typeof makeTestApp>>;
afterEach(async () => t?.close());
const cfg = (env: Record<string, string>) => loadConfig({ PLAYBACK_TOKEN_SECRET: 'x'.repeat(40), ...env });

async function submission(opts: { ai: 'none' | 'fake'; aiConsent: boolean }) {
  t = await makeTestApp(opts.ai === 'fake' ? { ai: createFakeAiProvider() } : {});
  const builder = await registerAs(t.app, 'builder');
  const study = await seedPublishedStudy(t.app, builder.token, { aiProcessingEnabled: true });
  const tester = await registerAs(t.app, 'tester');
  await seedDeviceProfile(t.app, tester.token);
  const { participationId } = await startParticipation(t.app, tester.token, study.studyId, opts.aiConsent ? ['screen_recording', 'ai_processing'] : ['screen_recording']);
  await uploadFixture(t.app, tester.token, participationId, study.taskIds[0]!);
  await t.app.inject({ method: 'PUT', url: `/v1/participations/${participationId}/task-results`, headers: bearer(tester.token), payload: { results: study.taskIds.map((taskId) => ({ taskId, outcome: 'blocked', difficulty: 5, note: 'The continue button never appeared' })) } });
  await t.app.inject({ method: 'POST', url: `/v1/participations/${participationId}/submit`, headers: bearer(tester.token) });
  return { builder, participationId };
}
const suggest = (pid: string, token: string) => t.app.inject({ method: 'POST', url: `/v1/submissions/${pid}/ai-suggestions`, headers: bearer(token) });

describe('AI suggestions', () => {
  it('is honestly unavailable without a provider — no placeholder output', async () => {
    const { builder, participationId } = await submission({ ai: 'none', aiConsent: true });
    const res = await suggest(participationId, builder.token);
    expect(res.statusCode).toBe(503);
    expect(res.json().error).toMatchObject({ code: 'AI_PROVIDER_UNAVAILABLE', message: 'AI suggestions unavailable — no AI provider is configured. Review the evidence manually.' });
  });
  it('requires the tester\'s AI processing consent', async () => {
    const { builder, participationId } = await submission({ ai: 'fake', aiConsent: false });
    expect((await suggest(participationId, builder.token)).json().error.code).toBe('AI_CONSENT_MISSING');
  });
  it('labels suggestions and turns them into findings only on explicit acceptance', async () => {
    const { builder, participationId } = await submission({ ai: 'fake', aiConsent: true });
    const s = await suggest(participationId, builder.token);
    expect(s.statusCode).toBe(201);
    expect(s.json().label).toBe('AI suggestion · verify against the recording');
    const before = (await t.app.inject({ method: 'GET', url: `/v1/submissions/${participationId}`, headers: bearer(builder.token) })).json();
    expect(before.findings).toHaveLength(0);
    await t.app.inject({ method: 'POST', url: `/v1/ai-suggestions/${s.json().id}/accept`, headers: bearer(builder.token), payload: { index: 0 } });
    const after = (await t.app.inject({ method: 'GET', url: `/v1/submissions/${participationId}`, headers: bearer(builder.token) })).json();
    expect(after.findings[0].source).toBe('ai_accepted');
  });
  it('refuses unapproved real providers and fake providers outside tests', () => {
    expect(resolveAiProvider(cfg({ AI_PROVIDER: 'none' })).id).toBe('none');
    expect(() => resolveAiProvider(cfg({ AI_PROVIDER: 'anthropic' }))).toThrowError("AI provider 'anthropic' requires separate approval (paid service) and is not implemented in this pass");
    expect(() => resolveAiProvider(cfg({ AI_PROVIDER: 'fake', NODE_ENV: 'development' }))).toThrowError('The fake AI provider exists only for automated tests');
  });
});
```

- [ ] **Step 2: Run to verify failure** — FAIL: cannot resolve `../src/services/ai`.

- [ ] **Step 3: Implement**

`apps/api/src/services/ai.ts`:
```ts
import type { AppConfig } from '../config';
import { noneAiProvider, type AiProvider } from './ports';

/** Deterministic test double for the accept/dismiss UX. Never constructible outside NODE_ENV=test (R7). */
export function createFakeAiProvider(): AiProvider {
  if (process.env.NODE_ENV !== 'test' && process.env.VITEST !== 'true') throw new Error('The fake AI provider exists only for automated tests');
  return {
    id: 'fake',
    available: true,
    async suggest(input) {
      const titles = new Map(input.tasks.map((x) => [x.id, x.title]));
      const hard = input.results.filter((r) => r.outcome !== 'completed' || r.difficulty >= 4);
      return {
        model: 'fake-model',
        findings: hard.map((r) => ({
          title: `Task "${titles.get(r.taskId) ?? 'unknown'}" was hard`,
          severity: 'major' as const,
          rationale: `Tester marked ${r.outcome} with difficulty ${r.difficulty}: ${r.note.slice(0, 100)}`,
          taskIds: [r.taskId],
        })),
      };
    },
  };
}

export function resolveAiProvider(config: AppConfig): AiProvider {
  if (config.AI_PROVIDER === 'none') return noneAiProvider;
  if (config.AI_PROVIDER === 'fake') {
    if (config.NODE_ENV !== 'test') throw new Error('The fake AI provider exists only for automated tests');
    return createFakeAiProvider();
  }
  // Real adapters (Anthropic, others) are a paid service: separate approval required (CLAUDE.md:7, spec A11).
  throw new Error(`AI provider '${config.AI_PROVIDER}' requires separate approval (paid service) and is not implemented in this pass`);
}
```

`apps/api/src/routes/ai.ts`:
```ts
import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { AiFindingSuggestionSchema } from '@pocketqa/contracts';
import { DomainError } from '@pocketqa/domain';
import { aiSuggestions, findings, participations, taskResults } from '../db/schema';
import { loadSubmissionForViewer } from '../lib/access';
import { appendAudit } from '../lib/audit';
import { tasksOf } from '../lib/study-queries';
import { requireRole } from '../plugins/auth';

const PidParam = z.object({ participationId: z.uuid() });
const IdParam = z.object({ id: z.uuid() });
const LABEL = 'AI suggestion · verify against the recording' as const;
const dto = (s: typeof aiSuggestions.$inferSelect) => ({ id: s.id, status: s.status, provider: s.provider, model: s.model, findings: JSON.parse(s.payloadJson).findings, label: LABEL });

export async function aiRoutes(app: FastifyInstance): Promise<void> {
  const { db, ai } = app.ctx;

  app.post('/submissions/:participationId/ai-suggestions', async (req, reply) => {
    const user = requireRole(req, 'builder');
    const { participation: p, study } = loadSubmissionForViewer(app, PidParam.parse(req.params).participationId, user);
    if (!ai.available) throw new DomainError('AI_PROVIDER_UNAVAILABLE', 'AI suggestions unavailable — no AI provider is configured. Review the evidence manually.');
    if (!study.aiProcessingEnabled || !JSON.parse(p.scopesJson).includes('ai_processing')) {
      throw new DomainError('AI_CONSENT_MISSING', 'The tester did not agree to AI processing for this session');
    }
    // Text only: task titles and the tester's own results. Media never leaves Pocket QA for AI (RR4, A11).
    const out = await ai.suggest({
      tasks: tasksOf(db, study.id).map((x) => ({ id: x.id, title: x.title })),
      results: db.select().from(taskResults).where(eq(taskResults.participationId, p.id)).all(),
    });
    const findingsOut = z.array(AiFindingSuggestionSchema).parse(out.findings);
    const id = randomUUID();
    db.insert(aiSuggestions).values({ id, participationId: p.id, provider: ai.id, model: out.model, status: 'suggested', payloadJson: JSON.stringify({ findings: findingsOut }), createdAt: app.ctx.now() }).run();
    return reply.status(201).send(dto(db.select().from(aiSuggestions).where(eq(aiSuggestions.id, id)).get()!));
  });

  const load = (req: Parameters<typeof requireRole>[0]) => {
    const user = requireRole(req, 'builder');
    const s = db.select().from(aiSuggestions).where(eq(aiSuggestions.id, IdParam.parse(req.params).id)).get();
    if (!s) throw new DomainError('NOT_FOUND', 'Suggestion not found');
    loadSubmissionForViewer(app, s.participationId, user);
    if (s.status !== 'suggested') throw new DomainError('INVALID_TRANSITION', 'This suggestion was already handled');
    return { user, s };
  };

  app.post('/ai-suggestions/:id/accept', async (req) => {
    const { user, s } = load(req);
    const { index } = z.object({ index: z.number().int().min(0) }).parse(req.body);
    const item = JSON.parse(s.payloadJson).findings[index];
    if (!item) throw new DomainError('VALIDATION_FAILED', 'No suggestion at that position');
    const now = app.ctx.now();
    db.transaction((tx) => {
      tx.insert(findings).values({ id: randomUUID(), participationId: s.participationId, createdBy: user.id, title: item.title, severity: item.severity, evidenceItemId: null, timestampMs: null, description: item.rationale, source: 'ai_accepted', createdAt: now }).run();
      tx.update(aiSuggestions).set({ status: 'accepted', decidedBy: user.id, decidedAt: now }).where(eq(aiSuggestions.id, s.id)).run();
    });
    appendAudit(db, { actorId: user.id, action: 'ai_suggestion.accept', targetType: 'ai_suggestion', targetId: s.id }, now);
    return dto(db.select().from(aiSuggestions).where(eq(aiSuggestions.id, s.id)).get()!);
  });

  app.post('/ai-suggestions/:id/dismiss', async (req) => {
    const { user, s } = load(req);
    db.update(aiSuggestions).set({ status: 'dismissed', decidedBy: user.id, decidedAt: app.ctx.now() }).where(eq(aiSuggestions.id, s.id)).run();
    void participations;
    return dto(db.select().from(aiSuggestions).where(eq(aiSuggestions.id, s.id)).get()!);
  });
}
```

- [ ] **Step 4: Run** — `pnpm --filter @pocketqa/api test` → `82 passed`.
- [ ] **Step 5: Commit** — files above; message `feat(api): optional AI provider that is honestly unavailable by default`.

### Task T2.14: Wallet link endpoints (SIWS, devnet)

**Files:**
- Create: `apps/api/src/routes/wallet.ts`
- Modify: `apps/api/src/routes/index.ts` (add `await walletRoutes(v1);`), `apps/api/test/fixtures.ts` (add `linkWalletDirect`, `newWalletKey`, `signLink`)
- Test: `apps/api/test/wallet.test.ts`

**Interfaces:**
- Consumes: `createNonce`, `buildSignInInput`, `verifyLinkSignature` (T1.11–T1.12).
- Produces:
  - Fixture `newWalletKey() → { address, privateKey }`.
  - Fixture `signLink(signInInput, key) → WalletVerifyInput`.
  - Fixture `linkWalletDirect(db, userId, address, now)`.

- [ ] **Step 1: Write the failing test** — `apps/api/test/wallet.test.ts`:

```ts
import { afterEach, describe, expect, it } from 'vitest';
import { bearer, newWalletKey, registerAs, signLink } from './fixtures';
import { makeTestApp, mutableClock } from './helpers';

let t: Awaited<ReturnType<typeof makeTestApp>>;
afterEach(async () => t?.close());
const nonce = (token: string) => t.app.inject({ method: 'POST', url: '/v1/wallet/nonce', headers: bearer(token) });
const verify = (token: string, payload: object) => t.app.inject({ method: 'POST', url: '/v1/wallet/verify', headers: bearer(token), payload });

describe('wallet link', () => {
  it('links a devnet wallet with a valid SIWS signature', async () => {
    t = await makeTestApp();
    const u = await registerAs(t.app, 'tester');
    const key = newWalletKey();
    const { signInInput } = (await nonce(u.token)).json();
    expect(signInInput).toMatchObject({ chainId: 'solana:devnet', domain: 'pocketqa.invalid', version: '1' });
    expect((await verify(u.token, signLink(signInInput, key))).statusCode).toBe(201);
    expect((await t.app.inject({ method: 'GET', url: '/v1/me', headers: bearer(u.token) })).json().wallet.address).toBe(key.address);
  });
  it('rejects replayed nonce', async () => {
    t = await makeTestApp();
    const u = await registerAs(t.app, 'tester');
    const { signInInput } = (await nonce(u.token)).json();
    const body = signLink(signInInput, newWalletKey());
    await verify(u.token, body);
    expect((await verify(u.token, body)).json().error.code).toBe('NONCE_INVALID');
  });
  it('rejects nonce issued to another user', async () => {
    t = await makeTestApp();
    const a = await registerAs(t.app, 'tester');
    const b = await registerAs(t.app, 'tester');
    const { signInInput } = (await nonce(a.token)).json();
    expect((await verify(b.token, signLink(signInInput, newWalletKey()))).json().error.code).toBe('NONCE_INVALID');
  });
  it('rejects expired requests', async () => {
    const clock = mutableClock();
    t = await makeTestApp({ now: clock.get });
    const u = await registerAs(t.app, 'tester');
    const { signInInput } = (await nonce(u.token)).json();
    clock.advanceMs(301_000);
    expect((await verify(u.token, signLink(signInInput, newWalletKey()))).json().error.code).toBe('NONCE_INVALID');
  });
  it('burns the nonce even when the signature is wrong', async () => {
    t = await makeTestApp();
    const u = await registerAs(t.app, 'tester');
    const { signInInput } = (await nonce(u.token)).json();
    const good = signLink(signInInput, newWalletKey());
    const forged = { ...good, signatureB64: signLink(signInInput, newWalletKey()).signatureB64 };
    expect((await verify(u.token, forged)).json().error.code).toBe('SIGNATURE_INVALID');
    expect((await verify(u.token, good)).json().error.code).toBe('NONCE_INVALID');
  });
  it('refuses to link one address to two accounts and supports unlinking', async () => {
    t = await makeTestApp();
    const a = await registerAs(t.app, 'tester');
    const b = await registerAs(t.app, 'builder');
    const key = newWalletKey();
    await verify(a.token, signLink((await nonce(a.token)).json().signInInput, key));
    expect((await verify(b.token, signLink((await nonce(b.token)).json().signInInput, key))).json().error.code).toBe('WALLET_ALREADY_LINKED');
    expect((await t.app.inject({ method: 'DELETE', url: '/v1/wallet/link', headers: bearer(a.token) })).statusCode).toBe(204);
    expect((await verify(b.token, signLink((await nonce(b.token)).json().signInInput, key))).statusCode).toBe(201);
  });
  it('does not let admins or anonymous callers request nonces', async () => {
    t = await makeTestApp();
    expect((await t.app.inject({ method: 'POST', url: '/v1/wallet/nonce' })).statusCode).toBe(401);
  });
});
```

Add to `apps/api/test/fixtures.ts`:
```ts
import { generateKeyPairSync, sign, type KeyObject } from 'node:crypto';
import bs58 from 'bs58';
import { createSignInMessage } from '@solana/wallet-standard-util';
import { walletLinks } from '../src/db/schema';

export function newWalletKey() {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  return { address: bs58.encode(Buffer.from(publicKey.export({ format: 'jwk' }).x as string, 'base64url')), privateKey };
}
export function signLink(signInInput: Record<string, string>, key: { address: string; privateKey: KeyObject }) {
  const message = createSignInMessage({ ...(signInInput as never), address: key.address });
  return {
    nonce: signInInput.nonce, address: key.address,
    signedMessageB64: Buffer.from(message).toString('base64'),
    signatureB64: sign(null, Buffer.from(message), key.privateKey).toString('base64'),
  };
}
export function linkWalletDirect(db: Db, userId: string, address: string, now = new Date()) {
  db.insert(walletLinks).values({ id: randomUUID(), userId, address, chain: 'solana:devnet', linkedAt: now }).run();
}
```

- [ ] **Step 2: Run to verify failure** — FAIL: `/v1/wallet/nonce` → 404.

- [ ] **Step 3: Implement** — `apps/api/src/routes/wallet.ts`:

```ts
import { randomUUID } from 'node:crypto';
import { and, eq, gt, isNull } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { WalletVerifyInputSchema } from '@pocketqa/contracts';
import { DomainError } from '@pocketqa/domain';
import { buildSignInInput, createNonce, verifyLinkSignature, type IssuedSignInInput } from '@pocketqa/wallet-auth';
import { walletLinks, walletNonces } from '../db/schema';
import { appendAudit } from '../lib/audit';
import { requireRole } from '../plugins/auth';

const LIMITED = { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } };
const NONCE_TTL_SECONDS = 300;

export async function walletRoutes(app: FastifyInstance): Promise<void> {
  const { db, config } = app.ctx;

  app.post('/wallet/nonce', LIMITED, async (req) => {
    const user = requireRole(req, 'tester', 'builder');
    const now = app.ctx.now();
    const signInInput = buildSignInInput({ domain: config.SIWS_DOMAIN, uri: config.SIWS_URI, ttlSeconds: NONCE_TTL_SECONDS }, now, createNonce());
    // The full payload is stored server-side and later verified against — never the client's copy (S9).
    db.insert(walletNonces).values({ nonce: signInInput.nonce, userId: user.id, purpose: 'link', payloadJson: JSON.stringify(signInInput), issuedAt: now, expiresAt: new Date(Date.parse(signInInput.expirationTime)) }).run();
    return { signInInput };
  });

  app.post('/wallet/verify', LIMITED, async (req, reply) => {
    const user = requireRole(req, 'tester', 'builder');
    const body = WalletVerifyInputSchema.parse(req.body);
    const now = app.ctx.now();
    // Single-use: consume atomically BEFORE verifying, so failures and replays both burn the nonce (R39).
    const consumed = db.update(walletNonces).set({ consumedAt: now })
      .where(and(eq(walletNonces.nonce, body.nonce), eq(walletNonces.userId, user.id), isNull(walletNonces.consumedAt), gt(walletNonces.expiresAt, now))).run();
    if (consumed.changes !== 1) throw new DomainError('NONCE_INVALID', 'This sign-in request is invalid, expired or already used. Start again.');
    const issued = JSON.parse(db.select().from(walletNonces).where(eq(walletNonces.nonce, body.nonce)).get()!.payloadJson) as IssuedSignInInput;
    const result = verifyLinkSignature(issued, body, config.SIWS_DOMAIN, now);
    if (!result.ok) throw new DomainError(result.code, result.reason);
    db.transaction((tx) => {
      const active = tx.select().from(walletLinks).where(and(eq(walletLinks.address, result.address), isNull(walletLinks.unlinkedAt))).get();
      if (active && active.userId !== user.id) throw new DomainError('WALLET_ALREADY_LINKED', 'This wallet is already linked to another Pocket QA account');
      if (active) return;
      tx.update(walletLinks).set({ unlinkedAt: now }).where(and(eq(walletLinks.userId, user.id), isNull(walletLinks.unlinkedAt))).run();
      tx.insert(walletLinks).values({ id: randomUUID(), userId: user.id, address: result.address, chain: 'solana:devnet', linkedAt: now }).run();
    });
    appendAudit(db, { actorId: user.id, action: 'wallet.link', targetType: 'user', targetId: user.id }, now);
    return reply.status(201).send({ address: result.address, chain: 'solana:devnet', linkedAt: now.toISOString() });
  });

  app.delete('/wallet/link', async (req, reply) => {
    const user = requireRole(req, 'tester', 'builder');
    const now = app.ctx.now();
    db.update(walletLinks).set({ unlinkedAt: now }).where(and(eq(walletLinks.userId, user.id), isNull(walletLinks.unlinkedAt))).run();
    appendAudit(db, { actorId: user.id, action: 'wallet.unlink', targetType: 'user', targetId: user.id }, now);
    return reply.status(204).send();
  });
}
```

- [ ] **Step 4: Run** — `pnpm --filter @pocketqa/api test` → `89 passed`.
- [ ] **Step 5: Commit** — files above; message `feat(api): single-use SIWS wallet linking on devnet`.

### Task T2.15: Chain port, devnet transfer endpoints, boot guard

**Files:**
- Modify: `apps/api/src/services/chain.ts` (add `createKitChainPort`)
- Create: `apps/api/src/lib/chain-guard.ts`, `apps/api/src/routes/devnet.ts`, `apps/api/src/cli/devnet-airdrop.ts`
- Modify: `apps/api/src/routes/index.ts` (add `await devnetRoutes(v1);`); `apps/api/src/server.ts` (use `createKitChainPort(config.SOLANA_RPC_URL)` and `await verifyChainGuard(app)` before `listen`)
- Test: `apps/api/test/devnet.test.ts`

**Interfaces:**
- Consumes: `evaluateTransfer`, `assertDevnetGenesis`, `assertDevnetRpcUrl`, `buildTransferMemo`, `DEVNET_EXPIRY_MARGIN_BLOCKS`, `transitionCompensation`, `toCompensationDto`.
- Produces: `createKitChainPort(url)`, `verifyChainGuard(app)`, `requireChainReady(app)`.

- [ ] **Step 1: Write the failing test** — `apps/api/test/devnet.test.ts`:

```ts
import { afterEach, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app';
import { loadConfig } from '../src/config';
import { openDb } from '../src/db/client';
import { verifyChainGuard } from '../src/lib/chain-guard';
import { createFakeChainPort } from '../src/services/chain';
import { createFsMediaStore } from '../src/services/media-store';
import { noneAiProvider } from '../src/services/ports';
import { bearer, linkWalletDirect, registerAs, seedDeviceProfile, seedPublishedStudy, startParticipation, uploadFixture } from './fixtures';
import { makeTestApp } from './helpers';

let t: Awaited<ReturnType<typeof makeTestApp>>;
afterEach(async () => t?.close());
const BUILDER = 'Bui1derAddr1111111111111111111111111111111';
const TESTER = 'TesterAddr11111111111111111111111111111111';
const SIG = '5'.repeat(88);

async function approved(link = { builder: true, tester: true }) {
  t = await makeTestApp();
  await verifyChainGuard(t.app);
  const builder = await registerAs(t.app, 'builder');
  const study = await seedPublishedStudy(t.app, builder.token);
  const tester = await registerAs(t.app, 'tester');
  await seedDeviceProfile(t.app, tester.token);
  const { participationId } = await startParticipation(t.app, tester.token, study.studyId);
  await uploadFixture(t.app, tester.token, participationId, study.taskIds[0]!);
  await t.app.inject({ method: 'PUT', url: `/v1/participations/${participationId}/task-results`, headers: bearer(tester.token), payload: { results: study.taskIds.map((taskId) => ({ taskId, outcome: 'completed', difficulty: 1, note: 'ok' })) } });
  await t.app.inject({ method: 'POST', url: `/v1/participations/${participationId}/submit`, headers: bearer(tester.token) });
  await t.app.inject({ method: 'POST', url: `/v1/submissions/${participationId}/decision`, headers: bearer(builder.token), payload: { decision: 'approve' } });
  if (link.builder) linkWalletDirect(t.db, builder.userId, BUILDER);
  if (link.tester) linkWalletDirect(t.db, tester.userId, TESTER);
  const [comp] = (await t.app.inject({ method: 'GET', url: '/v1/tester/rewards', headers: bearer(tester.token) })).json();
  return { builder, tester, compensationId: comp.id as string };
}
const prepare = (id: string, token: string) => t.app.inject({ method: 'POST', url: `/v1/compensations/${id}/devnet-transfer/prepare`, headers: bearer(token) });
const submit = (id: string, token: string) => t.app.inject({ method: 'POST', url: `/v1/compensations/${id}/devnet-transfer`, headers: bearer(token), payload: { signature: SIG } });
const check = (id: string, token: string) => t.app.inject({ method: 'POST', url: `/v1/devnet-transfers/${id}/check`, headers: bearer(token) });
const ix = (to = TESTER, memo?: string) => [
  { program: 'system', parsed: { type: 'transfer', info: { source: BUILDER, destination: to, lamports: 1_000_000 } } },
  { program: 'spl-memo', parsed: memo },
];

describe('devnet transfers', () => {
  it('requires both parties to have linked wallets', async () => {
    const { builder, compensationId } = await approved({ builder: true, tester: false });
    expect((await prepare(compensationId, builder.token)).json().error).toMatchObject({ code: 'WALLET_NOT_LINKED', message: 'The tester has not linked a devnet wallet' });
  });
  it('prepares exactly the parameters the chain must later show', async () => {
    const { builder, compensationId } = await approved();
    expect((await prepare(compensationId, builder.token)).json()).toEqual({ from: BUILDER, to: TESTER, lamports: '1000000', memo: `pocketqa:comp:${compensationId}`, cluster: 'devnet' });
  });
  it('client-claimed signature is verified server-side', async () => {
    const { builder, tester, compensationId } = await approved();
    const transfer = (await submit(compensationId, builder.token)).json();
    expect(transfer.status).toBe('submitted');
    expect((await check(transfer.id, tester.token)).json().status).toBe('submitted'); // nothing on chain yet → still pending
    t.chain.script.statuses = { [SIG]: { confirmationStatus: 'confirmed', err: null } };
    t.chain.script.transactions = { [SIG]: { err: null, instructions: ix(TESTER, 'pocketqa:comp:someone-else') } };
    expect((await check(transfer.id, builder.token)).json()).toMatchObject({ status: 'failed', failureReason: 'The transfer does not match the prepared recipient, amount, sender, or memo' });
  });
  it('confirms a matching on-chain transfer and marks the compensation confirmed', async () => {
    const { builder, tester, compensationId } = await approved();
    const transfer = (await submit(compensationId, builder.token)).json();
    t.chain.script.statuses = { [SIG]: { confirmationStatus: 'finalized', err: null } };
    t.chain.script.transactions = { [SIG]: { err: null, instructions: ix(TESTER, `pocketqa:comp:${compensationId}`) } };
    expect((await check(transfer.id, builder.token)).json()).toMatchObject({ status: 'confirmed', explorerUrl: `https://explorer.solana.com/tx/${SIG}?cluster=devnet` });
    const [comp] = (await t.app.inject({ method: 'GET', url: '/v1/tester/rewards', headers: bearer(tester.token) })).json();
    expect(comp.status).toBe('transfer_confirmed');
  });
  it('expires a transfer that never lands and allows a retry', async () => {
    const { builder, compensationId } = await approved();
    t.chain.script.blockHeight = 1000n;
    const transfer = (await submit(compensationId, builder.token)).json();
    t.chain.script.blockHeight = 1171n;
    expect((await check(transfer.id, builder.token)).json().status).toBe('expired');
    expect((await prepare(compensationId, builder.token)).statusCode).toBe(200);
  });
  it('refuses to start against a non-devnet RPC and degrades when the RPC is down', async () => {
    const config = loadConfig({ NODE_ENV: 'test', PLAYBACK_TOKEN_SECRET: 'x'.repeat(40) });
    const wrong = await buildApp({ config, db: openDb(':memory:'), media: createFsMediaStore('/tmp/pocketqa-guard-media'), chain: createFakeChainPort({ genesisHash: '5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d' }), ai: noneAiProvider });
    await expect(verifyChainGuard(wrong)).rejects.toThrowError('The configured RPC is not Solana devnet');
    t = await makeTestApp({ chain: { unreachable: true } });
    await verifyChainGuard(t.app);
    expect((await t.app.inject({ method: 'GET', url: '/v1/health' })).json().chainGuard).toBe('unverified');
  });
});
```

- [ ] **Step 2: Run to verify failure** — FAIL: cannot resolve `../src/lib/chain-guard`.

- [ ] **Step 3: Implement**

Append to `apps/api/src/services/chain.ts`:
```ts
import { createSolanaRpc, signature as toSignature } from '@solana/kit';
import { assertDevnetRpcUrl, type ParsedInstruction } from '@pocketqa/wallet-auth';

export function createKitChainPort(rpcUrl: string): ChainPort {
  assertDevnetRpcUrl(rpcUrl);
  const rpc = createSolanaRpc(rpcUrl);
  return {
    async getGenesisHash() { return String(await rpc.getGenesisHash().send()); },
    async getSignatureStatus(sig) {
      const { value } = await rpc.getSignatureStatuses([toSignature(sig)]).send();
      const s = value[0];
      return s ? { confirmationStatus: s.confirmationStatus ?? null, err: s.err } : null;
    },
    async getParsedTransaction(sig) {
      const tx = await rpc.getTransaction(toSignature(sig), { encoding: 'jsonParsed', maxSupportedTransactionVersion: 0, commitment: 'confirmed' }).send();
      return tx ? { err: tx.meta?.err ?? null, instructions: tx.transaction.message.instructions as unknown as ParsedInstruction[] } : null;
    },
    async getBlockHeight() { return await rpc.getBlockHeight({ commitment: 'confirmed' }).send(); },
  };
}
```
(Put these imports at the top of the file.)

`apps/api/src/lib/chain-guard.ts`:
```ts
import type { FastifyInstance } from 'fastify';
import { DomainError } from '@pocketqa/domain';
import { assertDevnetGenesis } from '@pocketqa/wallet-auth';

/**
 * Boot guard (spec A10.5): a non-devnet genesis hash aborts startup; an unreachable RPC only
 * disables chain features until a later check succeeds.
 */
export async function verifyChainGuard(app: FastifyInstance): Promise<void> {
  let hash: string;
  try {
    hash = await app.ctx.chain.getGenesisHash();
  } catch {
    app.chainGuard.state = 'unverified';
    app.log.warn('devnet RPC unreachable; chain features disabled until it responds');
    return;
  }
  assertDevnetGenesis(hash);
  app.chainGuard.state = 'ok';
}

export async function requireChainReady(app: FastifyInstance): Promise<void> {
  if (app.chainGuard.state !== 'ok') await verifyChainGuard(app);
  if (app.chainGuard.state !== 'ok') throw new DomainError('CHAIN_UNAVAILABLE', 'Solana devnet is unreachable right now. Try again shortly.');
}
```

`apps/api/src/routes/devnet.ts`:
```ts
import { randomUUID } from 'node:crypto';
import { and, eq, isNull } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { DevnetSubmitInputSchema } from '@pocketqa/contracts';
import { DomainError, transitionCompensation } from '@pocketqa/domain';
import { buildTransferMemo, DEVNET_EXPIRY_MARGIN_BLOCKS, devnetExplorerTxUrl, evaluateTransfer } from '@pocketqa/wallet-auth';
import { compensations, devnetTransfers, participations, studies, walletLinks } from '../db/schema';
import { appendAudit } from '../lib/audit';
import { requireChainReady } from '../lib/chain-guard';
import { requireUser, requireRole } from '../plugins/auth';

const IdParam = z.object({ id: z.uuid() });

export async function devnetRoutes(app: FastifyInstance): Promise<void> {
  const { db, chain, config } = app.ctx;
  const activeAddress = (userId: string) => db.select().from(walletLinks).where(and(eq(walletLinks.userId, userId), isNull(walletLinks.unlinkedAt))).get()?.address;

  const loadForBuilder = (compensationId: string, builderId: string) => {
    const row = db.select({ c: compensations, p: participations, s: studies }).from(compensations)
      .innerJoin(participations, eq(participations.id, compensations.participationId)).innerJoin(studies, eq(studies.id, participations.studyId))
      .where(eq(compensations.id, compensationId)).get();
    if (!row || row.s.builderId !== builderId) throw new DomainError('NOT_FOUND', 'Compensation not found');
    return row;
  };
  const prepared = (row: ReturnType<typeof loadForBuilder>) => {
    if (row.c.status !== 'approved_unpaid' && row.c.status !== 'transfer_failed') throw new DomainError('INVALID_TRANSITION', 'This compensation already has a transfer in progress or confirmed');
    const from = activeAddress(row.s.builderId);
    const to = activeAddress(row.p.testerId);
    if (!from) throw new DomainError('WALLET_NOT_LINKED', 'Link your devnet wallet first');
    if (!to) throw new DomainError('WALLET_NOT_LINKED', 'The tester has not linked a devnet wallet');
    return { from, to, lamports: config.DEVNET_DEMO_LAMPORTS, memo: buildTransferMemo(row.c.id), cluster: 'devnet' as const };
  };
  const transferDto = (x: typeof devnetTransfers.$inferSelect) => ({ id: x.id, compensationId: x.compensationId, signature: x.signature, status: x.status, failureReason: x.failureReason, explorerUrl: devnetExplorerTxUrl(x.signature) });

  app.post('/compensations/:id/devnet-transfer/prepare', async (req) => {
    const user = requireRole(req, 'builder');
    await requireChainReady(app);
    return prepared(loadForBuilder(IdParam.parse(req.params).id, user.id));
  });

  app.post('/compensations/:id/devnet-transfer', async (req, reply) => {
    const user = requireRole(req, 'builder');
    await requireChainReady(app);
    const row = loadForBuilder(IdParam.parse(req.params).id, user.id);
    const params = prepared(row);
    const { signature } = DevnetSubmitInputSchema.parse(req.body);
    const now = app.ctx.now();
    const height = await chain.getBlockHeight();
    const id = randomUUID();
    db.transaction((tx) => {
      tx.insert(devnetTransfers).values({ id, compensationId: row.c.id, signature, fromAddress: params.from, toAddress: params.to, lamports: params.lamports, memo: params.memo, lastValidBlockHeight: String(height + DEVNET_EXPIRY_MARGIN_BLOCKS), status: 'submitted', createdAt: now }).run();
      tx.update(compensations).set({ status: transitionCompensation(row.c.status, 'TRANSFER_SUBMITTED') }).where(eq(compensations.id, row.c.id)).run();
    });
    appendAudit(db, { actorId: user.id, action: 'devnet_transfer.submit', targetType: 'compensation', targetId: row.c.id }, now);
    return reply.status(202).send(transferDto(db.select().from(devnetTransfers).where(eq(devnetTransfers.id, id)).get()!));
  });

  app.post('/devnet-transfers/:id/check', { config: { rateLimit: { max: 20, timeWindow: '1 minute' } } }, async (req) => {
    const user = requireUser(req);
    await requireChainReady(app);
    const x = db.select().from(devnetTransfers).where(eq(devnetTransfers.id, IdParam.parse(req.params).id)).get();
    const row = x && db.select({ c: compensations, p: participations, s: studies }).from(compensations)
      .innerJoin(participations, eq(participations.id, compensations.participationId)).innerJoin(studies, eq(studies.id, participations.studyId))
      .where(eq(compensations.id, x.compensationId)).get();
    const allowed = row && (user.role === 'admin' || row.s.builderId === user.id || row.p.testerId === user.id);
    if (!x || !row || !allowed) throw new DomainError('NOT_FOUND', 'Transfer not found');
    if (x.status !== 'submitted') return transferDto(x);
    const verdict = evaluateTransfer({
      signatureStatus: await chain.getSignatureStatus(x.signature),
      transaction: await chain.getParsedTransaction(x.signature),
      currentBlockHeight: await chain.getBlockHeight(),
      lastValidBlockHeight: BigInt(x.lastValidBlockHeight),
    }, { from: x.fromAddress, to: x.toAddress, lamports: BigInt(x.lamports), memo: x.memo });
    const now = app.ctx.now();
    if (verdict.status !== 'pending') {
      const event = verdict.status === 'confirmed' ? 'TRANSFER_CONFIRMED' : verdict.status === 'expired' ? 'TRANSFER_EXPIRED' : 'TRANSFER_FAILED';
      db.transaction((tx) => {
        tx.update(devnetTransfers).set({ status: verdict.status, failureReason: verdict.status === 'failed' ? verdict.reason : null, checkedAt: now }).where(eq(devnetTransfers.id, x.id)).run();
        tx.update(compensations).set({ status: transitionCompensation(row.c.status, event) }).where(eq(compensations.id, row.c.id)).run();
      });
      appendAudit(db, { actorId: user.id, action: `devnet_transfer.${verdict.status}`, targetType: 'devnet_transfer', targetId: x.id }, now);
    } else {
      db.update(devnetTransfers).set({ checkedAt: now }).where(eq(devnetTransfers.id, x.id)).run();
    }
    return transferDto(db.select().from(devnetTransfers).where(eq(devnetTransfers.id, x.id)).get()!);
  });
}
```

`apps/api/src/cli/devnet-airdrop.ts` (devnet only; funds a test wallet for T7.4):
```ts
import { address, createSolanaRpc, lamports } from '@solana/kit';
import { assertDevnetGenesis, assertDevnetRpcUrl } from '@pocketqa/wallet-auth';
import { loadConfig } from '../config';

const config = loadConfig(process.env);
const i = process.argv.indexOf('--address');
const target = i > -1 ? process.argv[i + 1] : undefined;
if (!target) throw new Error('Usage: pnpm --filter @pocketqa/api devnet:airdrop --address <devnet address>');
assertDevnetRpcUrl(config.SOLANA_RPC_URL);
const rpc = createSolanaRpc(config.SOLANA_RPC_URL);
assertDevnetGenesis(String(await rpc.getGenesisHash().send()));
const sig = await rpc.requestAirdrop(address(target), lamports(1_000_000_000n)).send();
console.log(`devnet airdrop requested (no real value): ${sig}`);
```

Replace `apps/api/src/server.ts`:
```ts
import { buildApp } from './app';
import { loadConfig } from './config';
import { openDb } from './db/client';
import { verifyChainGuard } from './lib/chain-guard';
import { resolveAiProvider } from './services/ai';
import { createKitChainPort } from './services/chain';
import { createFsMediaStore } from './services/media-store';

const config = loadConfig(process.env);
const app = await buildApp({
  config,
  db: openDb(config.DATABASE_FILE),
  media: createFsMediaStore(config.MEDIA_DIR),
  chain: createKitChainPort(config.SOLANA_RPC_URL),
  ai: resolveAiProvider(config),
});
await verifyChainGuard(app); // throws on a non-devnet genesis hash: refuse to start
await app.listen({ host: config.API_HOST, port: config.API_PORT });
```

- [ ] **Step 4: Run** — `pnpm --filter @pocketqa/api test && pnpm --filter @pocketqa/api typecheck` → `95 passed`; typecheck exit 0.
- [ ] **Step 5: Live check (record):**
  1. `cp apps/api/.env.example apps/api/.env.local`, then set `PLAYBACK_TOKEN_SECRET` with the generator command in that file.
  2. Run `pnpm --filter @pocketqa/api start`, then `curl -s http://127.0.0.1:8787/v1/health`.

  Expected: `{"ok":true,"cluster":"devnet","chainGuard":"ok","aiProvider":"none"}`. If the network is unavailable, `chainGuard` is `"unverified"` — record that verbatim.
- [ ] **Step 6: Commit** — files above; message `feat(api): devnet transfer verification and boot-time network guard`.

### Task T2.16: Exhaustive authorization matrix

**Files:**
- Create: `apps/api/test/authz-matrix.test.ts`

**Interfaces:**
- Consumes: `seedSubmittedSession` (T2.10), every route.
- Produces: a failing build whenever a route is added without a matrix row.

- [ ] **Step 1: Write the test** (this task's deliverable is the test itself; it must pass against T2.1–T2.15):

```ts
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { seedSubmittedSession } from '../src/dev/seed';
import { makeTestApp } from './helpers';

type Actor = 'anon' | 'tester' | 'tester2' | 'builder' | 'builder2' | 'admin';
interface Row { method: string; url: string; path: (ids: Ids) => string; allowed: Actor[]; body?: object }
interface Ids { studyId: string; participationId: string; evidenceId: string; dummy: string }

// `allowed` = actors who must NOT get 401/403/404. Everyone else MUST get 401/403/404 — never 2xx.
const ROWS: Row[] = [
  { method: 'GET', url: '/v1/health', path: () => '/v1/health', allowed: ['anon', 'tester', 'tester2', 'builder', 'builder2', 'admin'] },
  { method: 'GET', url: '/v1/me', path: () => '/v1/me', allowed: ['tester', 'tester2', 'builder', 'builder2', 'admin'] },
  { method: 'PUT', url: '/v1/me/device-profile', path: () => '/v1/me/device-profile', allowed: ['tester', 'tester2'], body: {} },
  { method: 'POST', url: '/v1/studies', path: () => '/v1/studies', allowed: ['builder', 'builder2'], body: {} },
  { method: 'PATCH', url: '/v1/studies/:id', path: (i) => `/v1/studies/${i.studyId}`, allowed: ['builder'], body: {} },
  { method: 'POST', url: '/v1/studies/:id/fund', path: (i) => `/v1/studies/${i.studyId}/fund`, allowed: ['builder'], body: {} },
  { method: 'GET', url: '/v1/builder/studies/:id/submissions', path: (i) => `/v1/builder/studies/${i.studyId}/submissions`, allowed: ['builder'] },
  { method: 'GET', url: '/v1/submissions/:participationId', path: (i) => `/v1/submissions/${i.participationId}`, allowed: ['builder', 'admin'] },
  { method: 'POST', url: '/v1/submissions/:participationId/findings', path: (i) => `/v1/submissions/${i.participationId}/findings`, allowed: ['builder'], body: {} },
  { method: 'POST', url: '/v1/submissions/:participationId/decision', path: (i) => `/v1/submissions/${i.participationId}/decision`, allowed: ['builder'], body: {} },
  { method: 'POST', url: '/v1/participations/:id/withdraw', path: (i) => `/v1/participations/${i.participationId}/withdraw`, allowed: ['tester'] },
  { method: 'POST', url: '/v1/participations/:id/evidence', path: (i) => `/v1/participations/${i.participationId}/evidence`, allowed: ['tester'], body: {} },
  { method: 'DELETE', url: '/v1/evidence/:id', path: (i) => `/v1/evidence/${i.evidenceId}`, allowed: ['tester'] },
  { method: 'POST', url: '/v1/evidence/:id/playback-token', path: (i) => `/v1/evidence/${i.evidenceId}/playback-token`, allowed: ['tester', 'builder', 'admin'] },
  { method: 'GET', url: '/v1/admin/disputes', path: () => '/v1/admin/disputes', allowed: ['admin'] },
  { method: 'POST', url: '/v1/admin/moderation', path: () => '/v1/admin/moderation', allowed: ['admin'], body: {} },
  { method: 'GET', url: '/v1/admin/audit', path: () => '/v1/admin/audit', allowed: ['admin'] },
  { method: 'GET', url: '/v1/admin/data-requests', path: () => '/v1/admin/data-requests', allowed: ['admin'] },
  { method: 'POST', url: '/v1/wallet/nonce', path: () => '/v1/wallet/nonce', allowed: ['tester', 'tester2', 'builder', 'builder2'] },
  { method: 'DELETE', url: '/v1/wallet/link', path: () => '/v1/wallet/link', allowed: ['tester', 'tester2', 'builder', 'builder2'] },
  { method: 'POST', url: '/v1/submissions/:participationId/ai-suggestions', path: (i) => `/v1/submissions/${i.participationId}/ai-suggestions`, allowed: ['builder'] },
];
// Routes whose access is fully exercised in their own task tests (dynamic ids, tokens, or state preconditions):
const COVERED_ELSEWHERE = new Set([
  'POST /v1/auth/register', 'POST /v1/auth/login', 'POST /v1/auth/logout', 'PUT /v1/studies/:id/tasks', 'PUT /v1/studies/:id/criteria',
  'PUT /v1/studies/:id/consent', 'POST /v1/studies/:id/publish', 'POST /v1/studies/:id/pause', 'POST /v1/studies/:id/resume', 'POST /v1/studies/:id/close',
  'GET /v1/builder/studies', 'GET /v1/tester/studies', 'GET /v1/studies/:id', 'POST /v1/studies/:id/participations', 'POST /v1/participations/:id/consent',
  'POST /v1/participations/:id/start', 'PUT /v1/participations/:id/task-results', 'POST /v1/participations/:id/submit', 'PUT /v1/evidence/:id/content',
  'GET /v1/media/:evidenceId', 'GET /v1/tester/participations', 'GET /v1/tester/rewards', 'GET /v1/builder/studies/:id/report.md',
  'POST /v1/participations/:id/disputes', 'POST /v1/admin/disputes/:id/resolve', 'POST /v1/me/data-requests', 'GET /v1/me/data-requests',
  'GET /v1/me/data-requests/:id/export', 'POST /v1/admin/data-requests/:id/complete', 'POST /v1/ai-suggestions/:id/accept', 'POST /v1/ai-suggestions/:id/dismiss',
  'POST /v1/wallet/verify', 'POST /v1/compensations/:id/devnet-transfer/prepare', 'POST /v1/compensations/:id/devnet-transfer', 'POST /v1/devnet-transfers/:id/check',
]);

let t: Awaited<ReturnType<typeof makeTestApp>>;
let seeded: Awaited<ReturnType<typeof seedSubmittedSession>>;
beforeAll(async () => { t = await makeTestApp(); seeded = await seedSubmittedSession(t.app); });
afterAll(async () => t.close());

describe('authorization matrix', () => {
  it('has a row (or an explicit owner test) for every registered route', () => {
    const listed = new Set([...ROWS.map((r) => `${r.method} ${r.url}`), ...COVERED_ELSEWHERE]);
    const missing = t.app.registeredRoutes.map((r) => `${r.method} ${r.url}`).filter((k) => !listed.has(k) && !k.includes('__test__'));
    expect(missing).toEqual([]);
  });
  for (const row of ROWS) {
    it(`${row.method} ${row.url}`, async () => {
      const ids: Ids = { studyId: seeded.studyId, participationId: seeded.participationId, evidenceId: seeded.evidenceId, dummy: '00000000-0000-4000-8000-000000000000' };
      for (const actor of ['anon', 'tester', 'tester2', 'builder', 'builder2', 'admin'] as Actor[]) {
        const headers = actor === 'anon' ? {} : { authorization: `Bearer ${seeded.users[actor].token}` };
        const res = await t.app.inject({ method: row.method as never, url: row.path(ids), headers, ...(row.body ? { payload: row.body } : {}) });
        const denied = [401, 403, 404].includes(res.statusCode);
        expect({ actor, status: res.statusCode, denied }).toEqual({ actor, status: res.statusCode, denied: !row.allowed.includes(actor) });
      }
    });
  }
});
```

- [ ] **Step 2: Run** — `pnpm --filter @pocketqa/api exec vitest run test/authz-matrix.test.ts` → `22 passed`. A failure here is a P0/P1 authorization defect: fix the route, never the expectation.
- [ ] **Step 3: Run the whole API suite and typecheck** — `pnpm --filter @pocketqa/api test && pnpm --filter @pocketqa/api typecheck` → `117 passed`; exit 0. Record.
- [ ] **Step 4: Commit** — `apps/api/test/authz-matrix.test.ts`; message `test(api): exhaustive route-by-role authorization matrix`. Then signal FC-2 readiness.

<!-- PART-B-PHASE-3 -->
