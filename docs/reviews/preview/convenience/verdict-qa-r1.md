# pqa-qa security verdict, preview convenience, round 1 (verbatim pane output; frozen tree ffbcc9a7)

  findings ranked P0-P3 with file:line, the scenario and a fix. End with exactly one line: VERDICT: APPROVE (no open
  P0/P1/P2) or VERDICT: CHANGES_REQUIRED.

  Read 15 files (ctrl+o to expand)

⏺ I used only Read; Grep and Glob weren't available. I modified nothing, used no subagents, and did not open .preview/,
  .preview-test/ or preview-data/. Most of the convenience is scoped as authorized, but it misses two of your stated
  criteria, so there are two blocking P2s.

  What holds up
  - Bootstrap only behind the gate: /__preview/bootstrap.json is reached only after the cookie check
    (gate-server.mjs:349-368). It's GET-only, no-store, and sandboxed by CSP.
  - Prefill is escaped: the gate prefill is HTML-escaped (:128, :141), and nothing submits automatically.
  - Only synthetic accounts:
    - loadConvenience requires mode 0600 and accepts only demo-{tester,builder,admin}@pocketqa.example (:374-390).
    - The app filters the same way again (demoAccounts.ts:16-29).
    - The gate CLI refuses to start if the prefill doesn't match the scrypt hash (:412-416).
  - Rotation: with --password-stdin the chosen password goes through the same scrypt scheme, with a new salt and a new
    cookie key, so old sessions die (init-preview.mjs:30-40).
  - No credential in the bundle: build-web.sh builds beside the target and runs assert-no-secrets before swapping it
    in. The .next and .old build folders and .preview-test/ are git-ignored, and the scanner forbids .preview-test/.
  - Native and local builds unaffected: they never fetch the bootstrap (PREVIEW_BUILD && Platform.OS === 'web').
  - Gate controls unchanged: rate limits, Origin, Host, the path checks, the block list and revocation are all as
    before.
  - Evidence: HTTP smoke 21/21 and browser smoke 18/18, now with real per-run start and finish times.

  Findings

  1. [P2] The chosen gate password is in a committed file. docs/reviews/preview/convenience/candidate.md:6
     - The doc states the new gate password in plain text. I'm deliberately not repeating it here, because this verdict
       will be captured into the repo too.
     - That breaks the scope you set ("no credential in any … committed file") and the CLAUDE.md "no secrets in repo"
       rule. The candidate's "0 occurrences in 393 repo files" check (:44) ran before the rotation, so it didn't count
       this value. The scanner can't catch a plain word.
     - The value is meant to be public on the gate page, but it looks like a pattern-style password that may be reused
       on other optijara.ai previews. Committing it, and later pushing it to GitHub, spreads it beyond this one page,
       and it would outlive a later rotation in git history.
     - Fix:
       - Remove the value from candidate.md and from any other doc, using wording like "the requested simple password".
       - After the live rotation, run assert-no-secrets.mjs against the whole repo, not just the bundle, and record the
         result.
       - Hamza should confirm the value isn't used anywhere else.
  2. [P2] The gate page still says "Private preview" when the password is prefilled. gate-server.mjs:137
     - With convenience on, the page reads "Private preview." directly above "this page is not access protection".
       That's a privacy claim on a page your criteria require to make none.
     - The error pages are worse: the 401 wrong-password and 429 pages call loginPage(error) without the prefill (:253,
       :215). They show only "Private preview", with no public-demo notice and an empty password field.
     - Fix:
       - Pass the convenience state into every loginPage call.
       - When it's on, replace "Private preview." with "Public demo preview".
       - Keep the prefill on the error pages too.
       - Add a test that the gate page never contains "Private" while convenience is on.
  3. [P3] Two docs disagree about whether the live rotation happened.
     - docs/handoff/preview-activation.md:87-91 says the build session already rotated the gate password to the
       requested value and wrote .preview/convenience.json.
     - candidate.md:49 says the live rotation and the convenience file are "Not yet done (after review)".
     - Fix: Make the two agree. If the live state was already changed, say so in the candidate, noting that it takes
       effect only after the parent's restart.
  4. [P3] The preview is now an open place for anyone to publish text on the optijara.ai domain. With the gate
     effectively public, anyone can:
     - register accounts;
     - sign in as the shared builder;
     - publish studies, task text and notes, or resolve disputes as the shared admin.

     That text then appears to every visitor. The copy rules don't block links or offensive text.

     ADR 0004's addendum accepts that "everything is public" but doesn't name this abuse risk.
     - Fix: In the preview, either block POST /auth/register and POST /studies at the gate, or record the risk in the
       ADR with a reset plan (re-seed preview-data/ on a schedule) and a clear takedown step.
  5. [P3] The state-folder override can put secrets in a committable folder. start.sh:15, init-preview.mjs:17,
     enable-convenience.mjs:12: PREVIEW_STATE_DIR accepts any path relative to the repo, and that folder receives
     gate-secret.json, access.txt and convenience.json. The API refuses a data folder that git doesn't ignore, but the
     state folder has no such check.
     - Fix: Refuse any PREVIEW_STATE_DIR that isn't .preview or under .preview-test/, or check it with git check-ignore
       as the API does.

  VERDICT: CHANGES_REQUIRED
