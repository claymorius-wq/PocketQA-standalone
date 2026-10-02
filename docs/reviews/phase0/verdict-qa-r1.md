# Phase 0 foundation — independent-qa verdict, round 1

Reviewer: Herdr agent `pqa-qa` (pane `wX:p2`, claude-opus-5-5, read-only: Read tool only). Captured verbatim from `herdr agent read pqa-qa --source recent-unwrapped` by the lead on 2026-10-02, except one bracketed lead annotation on line 15 (a check-secrets allow marker on an example the reviewer quoted).

```text
⏺ VERDICT: CHANGES_REQUIRED

  I reviewed every listed file using Read only. Grep and Glob weren't exposed in this pane. I did not open the
  noncanonical implementation plan, and I modified nothing.

  1. [P2] The secret scanner's general credential rule misses the variable names people actually use.
     scripts/check-secrets.mjs:22
     - Problem: The leading \b needs a word boundary right before password, api_key or private_key. _ and letters count
       as word characters, so these all pass the scan:
       - const dbPassword = "realpassword123"   ← [lead annotation: example from the reviewer, not a secret — check-secrets: allow]
       - DB_PASSWORD="…"
       - POCKETQA_AI_API_KEY="…"
       - SOLANA_PRIVATE_KEY="…"
     - Unquoted .env-style values (X_API_KEY=abc…) never match either.
     - There are no rules for base58 Solana secret keys (the 87–88 character export format Phantom and Solflare use),
       npm tokens (npm_… or _authToken=), JWTs, or Bearer … literals.
     - Fix:
       - Drop the leading \b; use a [A-Za-z0-9_]* prefix or (?<![A-Za-z0-9]) on a lowercased line.
       - Accept unquoted values after =.
       - Add the base58-secret, npm and JWT rules.
       - Add a positive test for each in check-secrets.test.mjs.
  2. [P2] The scanner can pass without scanning anything, and its real behaviour is untested.
     scripts/check-secrets.mjs:81, :46, :26, :67
     - import.meta.url === \file://${argv[1]}` fails whenever the path is percent-encoded (spaces, non-ASCII) or
       reached through a symlink (/tmp→/private/tmp, linked worktrees). In those cases main()never runs and the process
       exits 0, sopnpm verify` reports success.
     - At :46, a single check-secrets: allow anywhere in a file switches off pretty-printed keypair detection for the
       whole file.
     - At :26, the forbidden paths don't include *keypair*.json, .envrc, *.sqlite*, *.db* or .data/. Binary files are
       skipped silently (:67), so a force-added SQLite database full of emails and password hashes passes.
     - Tests cover only scanText. Nothing exercises listFiles or main, and the AWS, Slack, Google and sk- rules have no
       positive tests.
     - Fix:
       - Use pathToFileURL(realpathSync(process.argv[1])).href.
       - Make the allow marker apply to its own line only, and do the multi-line keypair check ignoring allowed lines.
       - Extend the forbidden paths as above.
       - Add a CLI test that runs git init in a temporary directory, plants a secret and a .sqlite file, and checks for
         exit code 1.
  3. [P2] .gitignore has gaps around env files and SQLite. .gitignore:22-23, :33-35
     - The plan says the ignore list covers .env*. The file uses .env plus .env.*, so .envrc (direnv, a typical place
       to keep GH_TOKEN), .env-local and .env_prod are not ignored.
     - *.db doesn't match *.db-wal, *.db-shm or *.db-journal, and *.sqlite3 is missing.
     - Also missing: *.p12, *.p8, *.mobileprovision, google-services.json, GoogleService-Info.plist, credentials*.json.
     - Fix: Use .env* with !.env.example, and add *.db-*, *.sqlite3 and the signing and credential files above.
  4. [P2] Devnet transfer verification checks the client's own claim. packages/contracts/src/index.ts:316-322, ADR
     0001-architecture.md:17
     - The client supplies recipient and lamports, so "verify recipient and amount" only confirms that the chain
       matches what the client asserted.
     - A client can submit any self-made devnet transaction, optionally tied to a participationId, and get it marked
       confirmed. That is exactly the "fake payment success" threat in plan §6.
     - Fix:
       - Split this into POST /devnet/transfers, which creates an intent where the server sets the recipient (the
         tester's linked wallet), the amount and the expected sender, then POST /devnet/transfers/:id/signature.
       - Verify against the server-stored expectation.
       - State in the ADR that expected values never come from the request.
  5. [P2] Playback tokens travel in URL paths, which get logged by default. index.ts:372 (GET /media/:token)
     - Fastify logs req.url by default, so every playback token reaches the logs. Plan §2 says logs never contain
       tokens.
     - Fix:
   - Export a `REDACTED_PATH_PREFIXES = ['/media/']` constant (or similar) from contracts and note it in the ADR.
   - Make the Phase 3 test `api/log.redact.test.ts` pin it.
   - Keep tokens single-resource, requester-bound and short-lived.
  6. [P2] Testers have no study-detail contract, and routes aren't bound to their schemas. index.ts:146-154, :342-387
     - StudySummary has no consentText, consentVersion or tasks. A tester therefore can't render the consent text or
       build a ConsentBody without GET /studies/:id returning the full builder Study, which exposes budget and
       builderId.
     - The routes table carries only method and path. Response shapes for export, list or pagination wrappers,
       participation lists and the tester-facing study are undefined, which contradicts plan §5.2 ("all JSON validated
       by Zod").
     - Fix:
       - Add a TesterStudyView schema.
       - Give each route {request, response, auth: 'public'|'tester'|'builder-owner'|'tester-owner'|'admin'}, so the
         Phase 3 authorization matrix can iterate over the table.
  7. [P2] The dependency-version claims overstate what was verified. docs/decisions/dependency-versions.md:1, :30,
     :41-44; docs/progress.md:23
     - The title says "verified", but plan §3 items 3 (MWA maintenance status, @solana/kit API) and 4 (MediaProjection)
       are listed as still open at :52-55.
     - @solana/kit 7.x and the expo-* ~57.0.x entries aren't exact pins.
     - protocol-kit 0.4.0 and @wallet-ui/react-native-kit 4.3.0 have no evidence at all.
     - No row gives a source URL, and verification.md contains none of the npm view or npm pack output these claims
       rest on.
     - Fix:
       - Retitle the doc "partially verified" and give each row an exact version, a URL or command, and a retrieval
         date.
       - Paste the real registry output into verification.md.
       - Mark §3.3 and §3.4 as open blockers for Phase 1.
  8. [P2] The project requires Node 25, which appears to be end-of-life. package.json:6, dependency-versions.md:9, :39,
     ADR :24
     - Odd-numbered Node releases stop receiving updates about 8 months after release. By that schedule Node 25 reached
       EOL around 2026-06-01, before today (2026-10-02); please confirm at nodejs.org/en/about/previous-releases.
     - The doc's own evidence leans the same way: vitest 5 deliberately leaves out Node 25. The "Node 25 forces vitest
       4" workaround is a result of choosing an unsupported runtime.
     - Node 24 LTS is within the RN 0.86.3 engine range (^24.3.0) and vitest 5's (^24.0.0), but engines: >=25.0.0 rules
       it out.
     - Fix: Pin Node 24 LTS (or a supported current release) in engines and add an .nvmrc, then re-check the vitest
       choice. Otherwise, record an explicit, approved decision to run on an EOL runtime.
  9. [P2] The verification log is paraphrased and makes lint look like a real check. docs/verification.md:7-31;
     docs/progress.md:9
     - The file's header says "actual commands and actual output only", but entries are summaries: $ JBR java -version,
       curl getGenesisHash …, → ℹ pass 2.
     - pnpm verify includes lint, yet no package defines a lint script, so pnpm -r --if-present lint does nothing.
       Typecheck covers only contracts. "Local checks green" hides both facts.
     - Fix:
       - Paste verbatim commands and output.
       - Either add ESLint to packages/contracts, or state "lint: no-op, no package defines lint yet" in both files.
  10. [P2] The team-launch record says no role panes are running, but this reviewer pane is one.
      docs/reviews/team-launch.md:58-60
      - The record says "Not launched yet", yet an independent-qa pane is running this Phase 0 review. CLAUDE.md
        requires launch proof from live herdr agent list output, and the reviewer's model and provenance are part of
        what Phase 0 acceptance relies on.
      - Fix: Record the independent-qa pane's launch command (showing --model claude-opus-5-5 and no --fallback-model)
        and a verbatim herdr agent list row before the initial commit.
  11. [P3] The canonical plan's status line is out of date. docs/plans/pocket-qa-execution-plan.md:3 still says "PLAN
      ONLY… No Herdr team launched", which contradicts progress.md. Hamza needs to update it (the lead's edit was
      denied); until then, mark it in the plan header as stale.
  12. [P3] The wallet contract has several loose ends.
      - index.ts:67-68: WalletLink.address uses a plain length check instead of Base58Address.
      - :300 and :309: the nonce has no max.
      - No rule says one address can link to only one account.
      - With signMessages, the wallet doesn't check the domain, so an attacker can ask for a nonce for a victim's
        address on the attacker's own account and phish a signature. Prefer MWA signIn (SIWS), and pin the message
        fields (domain, address, chain, nonce, issued-at, expiry) in a builder function in contracts.
  13. [P3] Some field names and links invite money language. index.ts:124-125: StudyBudget.paid ("Credits paid out")
      clashes with the rule that the UI never says "paid" for anything that isn't a confirmed transfer. Rename it to
      awarded. Linking a devnet SOL transfer to a participationId makes it look like a reward payout; drop the link or
      label it as a demo.
  14. [P3] The contract goes beyond plan §5.2 without a recorded decision.
      - Extra routes: health, putDevice, credits, topUp, resume, studyParticipations, putTaskNote, listEvidence,
        listFindings, adminDisputes, myParticipations.
      - Extra error codes: PAYLOAD_TOO_LARGE, RATE_LIMITED, INTERNAL.
      - Missing pieces:
        - testers can't withdraw consent or abandon, so a slot and its committed budget stay held forever
        - moderation covers studies only, not users
        - there's no per-participation cap on evidence storage
      - Fix: List these in ADR 0001 or contract-changes.md.
  15. [P3] A one-day-old wallet package is pinned with no release-age guard.
      @solana-mobile/mobile-wallet-adapter-protocol@2.3.0 was published 2026-10-01, a day before this pin. Add
      minimumReleaseAge to pnpm-workspace.yaml, or record a deliberate exception.
  16. [P3] Smaller issues:
      - .env.example:2,4: a configurable POCKETQA_API_HOST and DATA_DIR invite non-local or non-ignored values. Note
        that the API refuses non-loopback hosts and data directories that git doesn't ignore.
      - index.ts:42, :14: Zod 4 has deprecated .email() and .datetime() in favour of z.email() and z.iso.datetime().
      - index.ts:226: FindingInput.evidenceId must be checked server-side against the same participation. Add that as a
        comment.

  What checks out:
  - Admin can't self-register: it's excluded from SelfServeRole, and a test covers it.
  - The credits disclaimer is a fixed literal.
  - Rejection requires a reason.
  - The devnet genesis hash constant matches the recorded live evidence.
  - progress.md and the ADR report the real-device blocker honestly.

✻ Crunched for 3m 14s · done 10:32 PM
```
