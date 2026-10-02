# Pocket QA

Buyer-funded, real-device mobile usability tests with consented evidence. Builders create studies and review evidence. Testers consent, do tasks, and record or attach evidence they've previewed. Approved work earns **test credits, which have no cash value**.

## Local-only rules

- The API binds to `127.0.0.1` only. No tunnels, no deploys, no public previews, no store submissions.
- Money: integer test credits only. No payouts, escrow, custody, or paid services.
- Web3: Solana **devnet** only, and noncustodial. Connecting a wallet is not a payment. The API refuses any RPC whose genesis hash isn't devnet's.
- AI: no provider is configured, so the UI says "Analysis unavailable" and never invents findings.
- Secrets live only in gitignored `.env.local`. Run `pnpm check:secrets` before every commit.

## Layout

| Path | What |
|---|---|
| `packages/contracts` | Zod request/response schemas and the route table, shared by the API and the app |
| `packages/domain` | Pure business rules: state machines, ledger, copy linter, eligibility, transfer verification |
| `apps/api` | Fastify + SQLite local API |
| `apps/mobile` | Expo Router app (Android dev build + web preview) |
| `modules/screen-capture` | Local Kotlin Expo module that uses MediaProjection (Android 10+) |
| `docs/` | Plans, decisions, reviews, progress (`docs/progress.md`), and verification evidence (`docs/verification.md`) |

## Commands

```sh
pnpm install
pnpm verify                 # check:secrets + typecheck + lint + test
pnpm --filter @pocket-qa/api dev     # http://127.0.0.1:8787
pnpm --filter @pocket-qa/mobile web  # web preview
```

Android builds need `JAVA_HOME="/Applications/Android Studio.app/Contents/jbr/Contents/Home"` (JDK 21). A device reaches the local API through `adb reverse tcp:8787 tcp:8787`.

Toolchain and pinned versions: `docs/decisions/dependency-versions.md`. Architecture: `docs/decisions/0001-architecture.md`.
