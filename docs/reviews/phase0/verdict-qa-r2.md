# Phase 0 foundation — independent-qa verdict, round 2

Reviewer: Herdr agent `pqa-qa` (pane `wX:p2`, claude-opus-5-5, read-only by instruction). Captured verbatim from `herdr agent read pqa-qa --source recent-unwrapped` by the lead on 2026-10-02, with no edits.

```text
⏺ VERDICT: APPROVE

  All ten round-1 P2s are fixed with evidence I checked in the files. Nothing at P0, P1 or P2 is open. I used Read only
  and modified nothing. Of the noncanonical plan I opened only lines 3130, 3131 and 3913: all three are obvious fake
  fixtures, so the allow markers there are fine.

  Round-1 findings

  1. [P2] Credential rule — FIXED. CRED_WORD is now matched anywhere inside an identifier (check-secrets.mjs:15, :33).
     There is a rule for unquoted env-style values (:36-39) and new rules for npm, JWT, bearer and base58 secrets (:20,
     :25-29). Positive tests cover all of them, including dbPassword, DB_PASSWORD, POCKETQA_AI_API_KEY and
     SOLANA_PRIVATE_KEY (test.mjs:30-58).
  2. [P2] Scanner could pass without scanning — FIXED.
     - Entry point uses realpath plus pathToFileURL (:121).
     - The allow marker now covers only its own line, and the keypair check runs over the remaining lines (:61-67).
     - Forbidden paths now include .data/, *.db*, *.sqlite*, keypair, credential and signing files (:45-55).
     - Files too large to scan are now reported as findings instead of skipped (:98-100).
     - Real git-repo CLI tests cover a planted secret, a force-added SQLite file, a clean repo and a symlinked
       invocation (test.mjs:90-119).
  3. [P2] .gitignore gaps — FIXED. It now has .env* with !.env.example, the SQLite WAL and journal variants, and the
     signing and credential files (.gitignore:20-42).
  4. [P2] Transfer verification checked the client's claim — FIXED. The create body is now {participationId} only, and
     recipient and lamports are stripped (index.ts:396, test :72-75). The server now owns sender, recipient and amount
     in the intent (:387-412). ADR 0001 decision 9 states the four verification checks and single use of each
     signature.
  5. [P2] Tokens in logged URLs — FIXED at the contract level. REDACTED_PATH_PREFIXES and redactPath exist
     (index.ts:17, :510), and ADR 0001 decision 4 pins api/log.redact.test.ts. The server-side enforcement is Phase 3
     work; see new item 3.
  6. [P2] No tester study view; routes not bound to schemas — FIXED. TesterStudyView is at :179 and is served at
     /tester/studies/:id. Every route now carries auth, scope, body and response (:437-499), and a test pins the set of
     public routes (index.test.ts:62-70).
  7. [P2] Dependency claims overstated — FIXED, apart from two residual P3s (new items 1 and 2). The doc is retitled
     PARTIALLY VERIFIED and lists §3.3 and §3.4 as open blockers (dependency-versions.md:1-7). Raw registry output is
     in evidence-registry.txt. Unverified wallet packages sit in a separate "candidates only" table.
  8. [P2] Node 25 EOL — FIXED. .nvmrc is 24.21.0 and engines is >=24.3.0 <25. The Node release schedule output shows
     v24 supported until 2028-04-30 and v25 ended 2026-06-01 (evidence-registry.txt:240). vitest moved to 5.0.3, whose
     engines include ^24.0.0.
  9. [P2] Paraphrased log; lint did nothing — FIXED. verification.md:24-62 holds the verbatim pnpm verify output with
     EXIT=0. lint now runs real ESLint (package.json:11, eslint.config.mjs). The note that typecheck covers only
     contracts is stated honestly at :67.
  10. [P2] Team-launch record stale — FIXED. team-launch.md:58-79 records the topology decision, the verbatim herdr
      agent list rows and the launch command with --model claude-opus-5-5 and no fallback model. The pqa-qa session id
      at line 70, e1acf907…, matches this reviewer session.
  11. [P3] Plan status line out of date — NOT FIXED. It is outside the lead's control (the edit was denied), and
      progress.md:33 records that it's left for Hamza. Still open for Hamza.
  12. [P3] Wallet loose ends — FIXED.
      - WalletLink now uses Base58Address (:82).
      - Nonces are capped at 16–64 alphanumeric characters (:372, :380).
      - One address can link to only one account (:80, ADR 8).
      - The app prefers MWA signIn, and buildSiwsMessage is tested byte-identical to createSignInMessageText from
        @solana/wallet-standard-util (siws.test.ts:18-24).
  13. [P3] Money wording — FIXED. paid is now awarded, with a committed field added (:137-146). The transfer is
      labelled as a demo, not a payout (:387-393).
  14. [P3] Additions beyond plan §5.2 — FIXED. They are listed in ADR 0001 (:73-82). Withdrawal, user moderation and
      evidence caps are added.
  15. [P3] Release-age guard — PARTIAL. It is deferred as an accepted risk (ADR :87). However, my round-1 premise was
      wrong; see new item 1.
  16. [P3] Smaller issues — FIXED.
      - .env.example comments now say the API refuses non-loopback hosts and data directories git doesn't ignore.
      - The schemas use Zod 4's z.email() and z.iso.datetime().
      - There is an evidenceId ownership comment at :267.

  New findings (all P3, none block the commit)

  1. [P3] The dependency doc contradicts its own evidence on a release date. docs/decisions/dependency-versions.md:47
     says mobile-wallet-adapter-protocol 2.3.0 was "published 2026-10-01". evidence-registry.txt:201 shows 2.3.0 was
     published 2026-08-17. The 2026-10-01 date belongs to the package's modified timestamp and the 3.0.0-canary builds.
     I repeated the wrong date in round 1.
     - Fix: Correct the date. Restate the ADR :87 risk as "never pick a canary or a release newer than 7 days".
  2. [P3] Some evidence is still paraphrased or missing.
     - evidence-registry.txt:239 ("v24, v25 keys extracted with node") and :246 (node -e "require(\"better-sqlite3\")
       smoke", "from repo root after a temporary add in scratch dir") are descriptions, not the commands that ran. Line
       246 also contradicts itself about where it ran.
     - The eslint 10.11.0, @eslint/js 10.0.1 and typescript 6.0.3 rows are marked E, but the registry file has no npm
       view output for them.
     - Fix: Paste the exact commands. Either add the three npm view captures or cite pnpm-lock.yaml for those rows.
  3. [P3] redactPath matches the raw URL string. It uses indexOf on the raw URL (index.ts:510-516). If the Fastify
     router decodes paths before matching, /%6Dedia/<token> or similar variants would reach the media handler without
     being redacted.
     - Fix: In Phase 3, redact by the matched route (request.routeOptions.url === routes.media.path), not by raw
       string, and add an encoded-path case to api/log.redact.test.ts.
  4. [P3] Two scanner rules will collide with evidence the plan requires.
     - The base58 rule (check-secrets.mjs:29) will flag every devnet transaction signature, including the explorer link
       Gate B2 must commit.
     - The 8 MB limit (:98) will flag device videos, screenshots and GIFs for Gate B1 and Gate A.
     - Left as is, this pushes people toward adding allow markers everywhere.
     - Fix: Decide the policy now. Exempt explorer.solana.com/tx/<sig>?cluster=devnet from the base58 rule, and either
       keep large media out of git or allowlist binary image types under docs/reviews/** by path.
  5. [P3] The reviewer's read-only limits are enforced only by the prompt. team-launch.md:61-64 records that pqa-qa
     runs in auto mode. Separately, the "verbatim" round-1 capture contains an inserted lead annotation
     (verdict-qa-r1.md:15). It is disclosed, but line 3 still says "verbatim".
     - Fix: Have Hamza explicitly acknowledge the prompt-only enforcement in progress.md, and change line 3 to
       "verbatim except one bracketed lead annotation".
  6. [P3] The email schema may reject addresses with surrounding spaces. Email = z.email().trim().toLowerCase()
     (index.ts:55): if the format check runs before the trim, " a@b.com " is rejected instead of normalized, and no
     test covers it.
     - Fix: Add a whitespace test. If it fails, use z.string().trim().toLowerCase().pipe(z.email()).
  7. [P3] Builders can't see disputes on their own studies. myDisputes is tester-only (index.ts:484-486).
     - Fix: In Phase 7, add a builder dispute view scoped to the study owner, or record that builders learn about
       disputes only from the participation status.
  8. [P3] The SIWS domain may not match the wallet's app identity. POCKETQA_SIWS_DOMAIN=pocketqa.local
     (.env.example:10). With MWA signIn, wallets compare the domain against the app identity URI and may warn or refuse
     if they differ.
     - Fix: In Phase 6, verify against the Solana Mobile docs and a real wallet, and derive both values from one
       constant.

  The foundation tree is ready for Hamza's approval of the initial commit, with the P3 items above carried as
  follow-ups.

✻ Worked for 2m 11s · done 10:42 PM
```
