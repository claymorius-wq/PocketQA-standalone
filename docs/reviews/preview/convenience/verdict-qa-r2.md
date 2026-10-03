# pqa-qa security verdict, preview convenience, round 2 (verbatim pane output; frozen tree 739fc30d)

  VERDICT: CHANGES_REQUIRED.

  Read 12 files (ctrl+o to expand)

⏺ I used only Read; Grep and Glob weren't available. I modified nothing, used no subagents, and did not open .preview/,
  .preview-test/ or preview-data/. Both r1 P2s and all three P3s are fixed, and the earlier gate guarantees still
  hold. Three new P3s remain, none blocking.

  Round-1 findings

  1. [P2] Password in a committed doc — FIXED.
     - candidate.md:6 and :49 now say "the simple value Hamza requested", and the ADR addendum :52 says "a simple,
       known value". I found the value in none of the files I read.
     - pnpm verify now also runs assert-no-secrets.mjs --repo (package.json:13, assert-no-secrets.mjs:29-33). It scans
       every committable file for every generated value in .preview/ and .preview-test/*/ and prints counts only.
     - Hamza still needs to confirm the value isn't used elsewhere (candidate.md:54).
  2. [P2] "Private preview" with the prefill on — FIXED.
     - When the convenience is on, loginPage shows "Public demo preview … not access protection: treat everything here
       as public" (gate-server.mjs:139-141).
     - "Private preview" now appears only when the convenience is off.
     - The 429 and 401 pages now keep the prefill and the public label (:223, :266).
  3. [P3] The two docs disagreed — FIXED. preview-activation.md:87-92 now says the live steps happen only after
     approval, which matches candidate.md:49.
  4. [P3] Open publishing — FIXED.
     - POST /auth/register is refused at the gate (gate-server.mjs:64) and goes through the same path checks.
     - The preview build hides "Create an account" (sign-in.tsx:87-95).
     - ADR 0004 :79-89 records the shared builder/admin publishing risk, with a takedown and reset procedure.
  5. [P3] State-folder override — FIXED.
     - paths.mjs stateDir() allows only .preview or a folder under .preview-test/, after resolving the path.
     - init-preview validates the password before creating anything (:29-38).
     - start.sh:15-19 makes the same check in shell and also refuses ...
     - The candidate discloses the test-safety gap the mutation run exposed (:64), and says it is closed.

  Regression check
  - Every path still needs the gate cookie, and the bootstrap is still served only behind it.
  - The login deadline and slot logic are unchanged.
  - The Origin, Host and path checks and the earlier block-list entries are unchanged.
  - The app's bearer token still passes through.
  - http-smoke-local.txt 21/21 (including self-registration getting 403) and browser-smoke-local.txt 18/18, each with
    its own run times.

  New findings (P3, non-blocking)

  1. [P3] The live-preview outage needs Hamza's acknowledgement. candidate.md:73-77 and progress.md:49: a broad pkill
     -f scripts/preview/start.sh killed the parent-managed live preview, and the public URL returned 502 until the
     parent restored it.
     - It is disclosed, and the new rule (exact PIDs only) is sensible. But it was an unplanned action on a shared
       service outside the branch's scope.
     - Fix: Add it to the "Needs Hamza" list in progress.md alongside the earlier process incidents, so his merge
       approval covers it.
  2. [P3] The preview smoke no longer checks the API's own refusal of admin self-registration. Smoke line 19 now gets
     the gate's 403 first, so in the preview setup nothing confirms the API itself still refuses role: admin. The API's
     unit tests still cover it.
     - Fix: Add one loopback check in the smoke straight to 127.0.0.1:$PREVIEW_API_PORT/auth/register with role: admin,
       expecting 400.
  3. [P3] ADR 0004 doesn't list the register block among the preview blocks. ADR 0004:69 lists only uploads, DELETE /me
     and moderation. The registration block is mentioned only in the abuse section (:81).
     - Fix: Add POST /auth/register to the :69 list.

  VERDICT: APPROVE
