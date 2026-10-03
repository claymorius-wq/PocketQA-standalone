# pqa-qa whole-branch verdict (verbatim pane output; HEAD 879add00)

⏺ I used only Read; Grep and Glob weren't available. I modified nothing, used no subagents, and opened no .preview*,
  preview-data, .env.local or credential files. The branch is safe to merge, and the PR body is accurate apart from one
  overclaim. Three P3s, none blocking.

  1. Cross-increment interactions
  - All three modes together (firebase + wallet login + r2):
    - Wallet login issues a custom token for the account's existing Firebase UID, or creates identities(firebase,
      userId) with has_recovery=0 inside the login transaction. The exchanged ID token then goes through the same
      revocation and valid_after checks as any other.
    - Upload intents and completion use the tester's ordinary bearer; the storage PUT carries none.
    - No path lets a custom token act as a bearer.
  - Account deletion: in one transaction it removes identity mappings, wallet links and nonces, closes open upload
    intents, and collects evidence and quarantine keys. Objects then go through deleteOrQueue (retried outbox), and
    only after commit does it revoke and delete the Firebase user(s). A completion running at the same moment fails its
    state re-check (the participation is withdrawn), and the conditional status updates never reopen the intent.
  - Suspension: every new authenticated route (upload-intents, complete, walletNonce/link/unlink) goes through the
    dispatcher's suspension check. Wallet login and identitySession can hand a suspended user a session or their own
    profile, but every other route then refuses, as with password login.
  - Shared-demo pinning:
    - start.sh:29 sets SHARED_DEMO=1, auth local, storage local and WALLET_LOGIN=0, and the process environment
      overrides .env.local.
    - The config refuses firebase mode, r2 and wallet login together with the shared demo (config.ts:107-111,
      :130-131).
    - The gate blocks identity, wallet login, linking, transfers, uploads, registration, deletion and moderation
      (gate-server.mjs:61-72). The upload-intent routes are the exception; see finding 1.

  2. PR body accuracy
  - Test counts match inc4-pnpm-verify.txt: contracts 15, domain 170, API 337 plus 2 skipped, mobile 709, root 37,
    EXIT=0.
  - Off-by-default claims are true: config.ts:87 defaults auth to local, :109 turns wallet login on only for '1', and
    :128 defaults storage to local.
  - Nothing overstated about providers: "Nothing provisioned", the five unpassed gates, the fake S3 not checking
    signatures, Hamza's unrecorded risk acceptance, and native firebase mode not being ready are all stated honestly.
  - One overclaim: "its gate blocks every new route" isn't quite true; see finding 1.

  3. Merge safety for the local MVP and the live preview
  - Local mode is the default and the old guarantees hold.
  - The database migrations (1–3) only add tables, and the existing evidence keys keep working.
  - The preview is protected by both the pinning and the gate. The one operational risk is restarting it after merge;
    see finding 2.

  Findings (all P3, non-blocking)

  1. [P3] Two new upload routes aren't blocked at the preview gate, despite the PR's claim. pr-body.md:5 vs
     gate-server.mjs:61-72: POST /participations/:id/evidence/upload-intents and POST
     /evidence/upload-intents/:id/complete aren't in PREVIEW_BLOCKED_API. They're harmless in the preview today,
     because pinned local storage makes both return 409 or 404. But the claim is broader than the code.
     - Fix: Add { method: 'POST', path: /^\/participations\/[^/]+\/evidence\/upload-intents$/ } and
       /^\/evidence\/upload-intents\/[^/]+\/complete$/ to the block list, with a gate test. Or change the PR wording to
       "blocks every new route that could publish or link".
  2. [P3] The live preview needs a specific post-merge sequence, which the PR doesn't give.
     - apps/api/src/server.ts imports firebase-admin and the AWS S3 SDK unconditionally, so restarting the preview from
       main without pnpm install --frozen-lockfile crashes the API. start.sh then exits and the supervisor loops,
       leaving the public URL down.
     - The restart also applies migrations 1–3 to the live preview-data database.
     - The new gate blocks and preview UI only take effect after a gate restart and a build-web.sh rebuild.
     - Fix: Add a "post-merge preview cutover" checklist to the PR body for the parent:
       i. pnpm install --frozen-lockfile;
       ii. back up preview-data/pocketqa.sqlite;
       iii. scripts/preview/build-web.sh;
       iv. a coordinated restart;
       v. the HTTP and browser smoke tests.

       That keeps the live preview's availability under control.
  3. [P3] Local and preview startup depend on the cloud SDKs being installed. server.ts loads both provider SDKs even
     when neither mode is enabled.
     - Fix (optional): Use await import('./identity/firebase') and await import('./storage/r2') only when
       config.firebase or config.r2 is set, so local and preview startup don't depend on those SDKs.

  VERDICT: APPROVE
