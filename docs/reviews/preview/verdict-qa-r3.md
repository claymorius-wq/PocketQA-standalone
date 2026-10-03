# pqa-qa security verdict, protected preview, round 3 (verbatim pane output; frozen tree 66515712)

  Read 5 files (ctrl+o to expand)

⏺ I used only Read; Grep and Glob weren't available. I modified nothing, used no subagents, and did not open .preview/
  or preview-data/. All three r2 P3 fixes are in place, and I found no counter leak, double release or regression. One
  new P3 remains, not blocking.

  r2 findings

  1. [P3] Slow logins tying up slots — FIXED.
     - Slot taken only after the body: a login now takes its in-flight slot only once the body has fully arrived and
       the limit re-check has passed (gate-server.mjs:243-246).
     - released starts true: if the connection closes, the body is too large or times out, or the request gets 429
       before taking the slot, the close handler does nothing. No slot is taken, so none can leak.
     - One decrement only: once the slot is taken, release() runs after scrypt (:249), or from close if the client
       disconnects during scrypt (:228). The released flag ensures exactly one decrement.
     - scrypt never throws: verifyPassword always resolves (:73-80), so there's no path where the slot stays held after
       an error.
     - 429 paths: both the early (:216) and the post-body (:243) 429s fire before any increment.
     - Test: preview-gate.test.mjs:281-297 holds 8 slow logins open from 4 IPs and checks that a real viewer still
       gets 303.
  2. [P3] ; and \ in proxy paths — FIXED. They now get 400 before the block-list check (:272). Tested with /api/me;x
     and a backslash path at :244, and the check that nothing reaches the upstream still holds.
  3. [P3] Stale ADR lines — FIXED. ADR 0004 :28 now gives the UNAUTHENTICATED / gate: true body, :39 lists ; and \, and
     :46 replaces the old upload note with the slow-login note.

  Regression check
  - Allowed routes still go through (:251-258).
  - The bearer token still passes and the gate cookie is still dropped.
  - Pages are still gated, with a 303 to the login page.
  - http-smoke.txt 18/18 and browser-smoke.txt 12/12 (0 foreign requests, 0 CSP violations).

  New finding (P3, non-blocking)

  1. [P3] The 10-second login timeout lingers on the connection and can kill unrelated requests. gate-server.mjs:218:
     req.setTimeout(10_000, () => req.destroy()) sets an idle timeout on the underlying socket, and it isn't cleared
     after the login response.
     - Unrelated requests: cloudflared reuses its connections to the gate, so later requests on the same socket can
       come from any viewer. If one of them is idle for more than 10 seconds, the leftover timer destroys the socket.
       That could be a proxied devnet re-verify that takes several seconds for each RPC call, or a paused video stream.
       The request fails intermittently.
     - Not a total limit: it resets on every byte, so a body trickled at one byte every 9 seconds keeps the socket open
       for hours. It no longer holds a slot, so the impact is small.
     - The ADR line "a login body has 10 s to arrive" overstates what the code does.
     - Fix: Use a per-request timer instead of a socket timeout: const t = setTimeout(() => req.destroy(), 10_000);
       req.on('end', () => clearTimeout(t)); res.on('close', () => clearTimeout(t));. Add a test where, on a keep-alive
       connection, a login is followed by a proxied request that takes longer than 10 seconds and still succeeds.

  VERDICT: APPROVE
