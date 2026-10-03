# pqa-qa security verdict, protected preview, round 4 (verbatim pane output; frozen tree f7f3efd3)

  Read 7 files (ctrl+o to expand)

⏺ I used only Read; Grep and Glob weren't available. I modified nothing, used no subagents, and did not open .preview/
  or preview-data/. The r3 P3 is fixed and I found no regressions. One minor evidence-format P3 remains, not blocking.

  r3 finding: the login timeout lingered on the connection — FIXED

  - The new timer (gate-server.mjs:217-223):
    - The login is now limited by a per-request timer, setTimeout(() => req.destroy(), loginTimeoutMs), instead of a
      socket idle timeout.
    - The timer is cleared when the body ends (:222) or the response closes (:223).
    - Because the clearing end listener is registered before the async end handler, the deadline is gone before scrypt
      starts. A slow verification is never cut off.
    - The early 429 (:217) returns before any timer exists. The post-body 429 (:248) happens after the timer is
      cleared.
  - Interaction with the in-flight slot:
    - A deadline destroy or an oversized body happens before the slot is taken. released is still true, so the close
      handler does nothing.
    - A client that disconnects during scrypt releases the slot exactly once, through close. The later release() call
      does nothing.
    - No path leaks a slot or decrements twice.
  - loginTimeoutMs (:145, :158) defaults to 10 s. It is set only by the tests and isn't exposed through the
    environment.
  - Tests:
    - preview-gate.test.mjs:299-327 checks a slow proxied call on the same keep-alive socket after a login.
    - :329-348 checks that a body trickled one byte every 80 ms is cut off at the 300 ms deadline.
    - The candidate (candidate.md:65-69) says honestly that the leftover-timer scenario didn't reproduce, because Node
      replaces the socket timeout after a response, while the trickle case did reproduce: red before the change, green
      after.
  - ADR 0004 :46 now accurately describes a total, per-request deadline.
  - Evidence: pnpm verify passes with secrets 378 files clean. http-smoke.txt and browser-smoke.txt show all checks
    passing, with 0 foreign requests and 0 CSP violations.

  Finding

  1. [P3] The two smoke files carry identical timestamps. docs/reviews/preview/http-smoke.txt:1 and browser-smoke.txt:1
     both say 11:32:25, as did the previous rounds (11:30:00). That suggests one shared stamp, not two independent run
     times, so the files can't show the two runs happened separately.
     - Fix: Have each smoke script write its own start time, and the APK or bundle hash where relevant, in its header.

  VERDICT: APPROVE
