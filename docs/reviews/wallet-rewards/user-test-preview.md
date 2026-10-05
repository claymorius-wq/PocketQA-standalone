# User testing on the protected preview: wallet escrow and reputation (simulation)

**For:** Hamza. **Steps for:** the parent, who merges and deploys, after pqa-qa approves the exact combined candidate.

**No real money anywhere.** The preview runs the **labelled simulation** of wallet escrow. It moves no funds, has no keys, and makes no network transfers. Every money line says "simulated USDC" or "simulation".

**The Squads devnet pilot can't run on the preview,** and two layers enforce it:
- The API refuses `squads_devnet` whenever the shared demo is on: `apps/api/src/config.ts`, test A1c.
- `scripts/preview/start.sh` pins `POCKETQA_SETTLEMENT` to `simulated` (the default) or `off`. It refuses anything else before starting, and strips `POCKETQA_SETTLEMENT_PILOT_KEYS_DIR` from the environment (`scripts/preview-scripts.test.mjs`).

So the pilot's server-held test keys are never on the preview host's process. Public visitors can never trigger a devnet transfer or spend pilot assets.

## What Hamza can test (at https://pocketqa.optijara.ai, behind the gate)
Use the shared-demo sign-ins on the gate page: tester, builder and admin. All data is synthetic.

**Builder:**
1. Choose New study, then Wallet escrow. Check the simulation notice and the reward in "simulated USDC".
2. Open the study, review the quote (reward, fee, total) and the trust-model text, then choose "Fund … from wallet (simulated)". The study must be funded before Publish works.
3. Publish. After a tester submits, approve the work (the confirm text says it's simulated). The payment state then moves from pending to settled, labelled "simulation, no funds moved".
4. Close the study. The unused rewards and fees show as refunded, labelled as simulated.

**Tester:**
1. Discover the escrow study and join it. The payout wallet is frozen at consent, with an explicit confirmation.
2. Record and submit.
3. Check the rewards list under Credits, plus Reputation (points with no cash value, badges) and the opt-in leaderboard (pseudonymous alias).

**Admin:** resolve a dispute (an overturned dispute releases the reward as simulated), and review the payouts and stuck-work views.

**Every account:** Settings, then Export, which includes the payments and reputation sections.

**About wallets on the preview:**
- Linking a wallet signs a message; it never pays.
- Wallet sign-in stays off on the shared demo (`POCKETQA_WALLET_LOGIN=0`).
- The existing devnet demo-transfer card is unchanged: the tester's own wallet signs its own devnet SOL transfer. It is separate from escrow.

## Not on the preview (stated, not hidden)
**The Squads devnet pilot** (ADR 0007 §10) passed its live gate (pqa-qa live r2) as a mechanics proof only:
- test keys simulate every role;
- it ran from the lead's machine with a private key directory.

**An actual user-held-wallet pilot is not built.** In it, Hamza's own wallet would fund, and the builder or arbiter would sign approvals in their own wallets. That would need wallet-signed funding plus member approvals through MWA or the wallet adapter, run in a separate local, private flow. It is not a fake "connect", and not the shared preview. It needs its own design, review and approval.

## Preview rebuild steps (parent, after the combined candidate is approved and merged to main)
Run these in the root checkout `/Users/hamzadiaz/Projects/pocket-qa`, on the merged main.
- **Keep:** the root's local screenshots and untracked plan duplicates. Don't overwrite or delete them.
- **No storage changes:** no R2 action at all.

1. **Stop the running preview** the way your supervisor runs it, by its own PID or service. Never use a broad `pkill`.
2. **Back up the preview database** to a folder outside the repo. The online backup is safe even while the API is running:
   ```
   POCKETQA_DATA_DIR="$PWD/preview-data" POCKETQA_SHARED_DEMO=1 POCKETQA_AUTH_MODE=local POCKETQA_STORAGE=local POCKETQA_SETTLEMENT=off \
     pnpm --filter @pocket-qa/api db:backup -- --out <a backup folder outside the repo>
   ```
   - The data path is absolute, and the same local settings `start.sh` pins are set, so the root `.env.local` cloud settings don't apply.
   - The lead ran this exact form against the isolated rehearsal database, and it printed the backup file and its sha256.
   On start, migrations 5–7 upgrade it in place. The lead checked a main-schema (v4) database upgrading to v7 with rows intact, integrity `ok`, and no foreign-key violations.
3. **Install and build:**
   ```
   pnpm install --frozen-lockfile
   bash scripts/preview/build-web.sh
   ```
   The build refuses loopback API origins and any generated secret value in the bundle.
4. **Start** with the existing environment:
   ```
   PREVIEW_PORT=… PREVIEW_API_PORT=… PREVIEW_PUBLIC_HOST=pocketqa.optijara.ai bash scripts/preview/start.sh
   ```
   - `PREVIEW_SETTLEMENT` defaults to `simulated`. Set `PREVIEW_SETTLEMENT=off` to hide wallet escrow; nothing else is accepted.
   - The shared-demo convenience file and gate secret in `.preview/` are reused as they are.
5. **Smoke test:**
   ```
   PREVIEW_URL=https://pocketqa.optijara.ai node scripts/preview/smoke.mjs
   ```
   Then check `GET /api/config` behind the gate: it should show `features.settlement: "simulated"`.

**Local rehearsal of steps 3–5** (lead, 2026-10-05; isolated `.preview-test/merge-smoke*` state, loopback ports 3591/3592, stopped by PID afterwards):
- `init-preview`: OK.
- `build-web.sh`: secret check over 8 values and 29 files, 0 occurrences.
- `start.sh`: the API reported `settlement: 'simulated'`.
- `seed-demo`: OK.
- `smoke.mjs`: **all 20 checks passed.** They cover the gate, the cookie flags, unknown Host → 421, the proxy and demo sign-in, and the refusals of self-registration, evidence upload and demo-account deletion.
