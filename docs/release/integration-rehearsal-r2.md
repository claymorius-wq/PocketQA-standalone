# Release integration rehearsal r2 (LOCAL ONLY)

pqa-be2, 2026-10-07. New branch `release/integration-r2` from `main` daf0c85, in `.worktrees/release-integration-r2`.
r1 (`release/integration-r1`, docs at efdd240) is kept as it was.
**No push, no PR, no remote write, no change to `main` or any other branch, no deletions, no deploy.**
This is what the parent replays with the scoped reshareai token after Hamza's go.

## What changed since r1

r1's only failing gate was `pnpm lint` on the integrated tree:
`docs/reviews/codex-web-e2e/capture-demo-showcase.mjs:88:34 no-undef ('localStorage')`, a docs harness that PR-A brings (c9a9828).
- **Fix at the source, on `feat/firebase-vercel`:** `fb3f3bf9fca8fc42d6c87fa89a5234f5a17a2a0c` "chore(lint): browser globals header for the Codex demo capture harness". It adds one line, `/* global localStorage -- evidence copy: this runs inside the page (Playwright addInitScript) */`. Docs harness only; no code changed.
- **r2 is pinned to the SHA `fb3f3bf`, NOT the branch name.** pqa-codex-web shares the fv worktree and may commit smoke evidence there, which would move the fv head. Replay with the SHA.

**Known docs-only debt (lead decision (a)):** `pnpm lint` on `feat/firebase-vercel` ALONE (fb3f3bf) still fails, with 30 committed errors. They are in evidence scripts whose lint-only headers live on `feat/demo-showcase` (a364b08 and its earlier header commits), not on fv:
- `browser-devnet-run.mjs` 6;
- pqa-be1 harness `devnet-test-wallet.mjs` 6, `self-test.mjs` 6;
- pqa-ios `d08/pqa-ios-d08.live.test.ts` 1;
- pqa-ios web `findcheck.mjs` 3, `finish.mjs` 3, `regression.mjs` 5.

The fv worktree also shows 1 error in an untracked file that isn't part of any commit (`docs/reviews/codex-web-e2e/final-deployed-smoke/run-smoke.mjs`, another agent's work in progress).
The gate that matters is lint on the **integrated** tree, where PR-B brings those headers: **exit 0** (below).

**Process note (reported to the lead):** fb3f3bf was committed through a broken gate, `pnpm lint 2>&1 | tail -4 && git commit`. The pipe took `tail`'s exit status, so the commit went through despite the fv-alone lint failure above. The lead kept the commit (decision (a)). Every gate below takes its exit code directly from the command (no pipes; `set -o pipefail` where a pipe is used).

## Inputs

| PR | Branch | Pinned SHA |
|---|---|---|
| base | `main` | **daf0c85** |
| PR-A | `feat/firebase-vercel` | **fb3f3bf** (= 2124b70 + the lint header) |
| PR-B (one-PR variant, QA-approved candidate) | `feat/demo-showcase` | **a364b08** |
| PR-C | `fix/e2e-p13-single-app-fgs` | **27608e9** (NOT VERIFIED ON DEVICE) |
| excluded | `fix/android-icon` | not merged (on-device check pending) |

## Read-only pre-check

```
$ git merge-base --is-ancestor daf0c85 fb3f3bf && echo "main ⊂ fv fb3f3bf"
main ⊂ fv fb3f3bf
$ git merge-tree --write-tree --name-only fb3f3bf a364b08     # B onto A
5a9142c65ea39eb43a58c0d10337a57c727796d7
B-on-A exit 0
$ git merge-tree --write-tree --name-only fb3f3bf 27608e9     # C onto A
8eb3a759e202465b3de889c59a5f6f5e913891c7
C-on-A exit 0
$ AB=$(git merge-tree --write-tree fb3f3bf a364b08 | head -1); C1=$(git commit-tree $AB -p fb3f3bf -p a364b08 -m sim)
$ git merge-tree --write-tree $C1 27608e9 | head -1           # C onto A+B
5e878a1b70525f23cdf17013a5ee806c9f101a5f
$ git diff --stat 77a173244057666de57e92762bce580946d1993e 5e878a1b70525f23cdf17013a5ee806c9f101a5f   # vs r1's tree
 docs/reviews/codex-web-e2e/capture-demo-showcase.mjs | 1 +
 1 file changed, 1 insertion(+)
```

## Merges (exact commands)

```
$ git worktree add -b release/integration-r2 .worktrees/release-integration-r2 daf0c85
$ git merge --no-ff --no-edit fb3f3bf -m "Merge PR-A feat/firebase-vercel fb3f3bf into release/integration-r2 (rehearsal r2; --no-ff marker, a fast-forward was possible: main daf0c85 is an ancestor)"
$ git merge --no-ff --no-edit a364b08 -m "Merge PR-B feat/demo-showcase a364b08 into release/integration-r2 (...; see the merge body)"
$ git merge --no-ff --no-edit 27608e9 -m "Merge PR-C fix/e2e-p13-single-app-fgs 27608e9 into release/integration-r2 (rehearsal r2; ... NOT VERIFIED ON DEVICE)"
```

| Step | Merge commit | Parents |
|---|---|---|
| PR-A | `5f7d600391d7c16e657c4d65635411f30e93e15a` | daf0c85 + fb3f3bf (`--no-ff` marker; a fast-forward was possible, same tree) |
| PR-B | `e0b38557176109851a9a2255c108e1cb996d89b2` | 5f7d600 + a364b08 |
| PR-C | `c7dfbddd75f4373834c3b4d492d680d51140fef3` | e0b3855 + 27608e9 |

**Final integration commit `c7dfbddd75f4373834c3b4d492d680d51140fef3`, tree `5e878a1b70525f23cdf17013a5ee806c9f101a5f`** (= the simulated tree; = r1's tree + the one docs header line). This document is a separate docs-only commit on top.

## The known conflict `apps/mobile/__tests__/review-screen.test.tsx`: none (same as r1)

As in r1, it was already resolved inside `feat/demo-showcase` by its merge **8a84c00** (fv d870403 into demo-showcase), keeping **both** behaviours:
- the three devnet pilot vote cases;
- the four H-33 decided-elsewhere cases.

fv's commits d870403..fb3f3bf don't touch the file. The resolution as recorded in 8a84c00 (`git show --cc --format= 8a84c00 -- apps/mobile/__tests__/review-screen.test.tsx`):

```diff
diff --cc apps/mobile/__tests__/review-screen.test.tsx
index 56e109c,224c1ac..bd499fd
--- a/apps/mobile/__tests__/review-screen.test.tsx
+++ b/apps/mobile/__tests__/review-screen.test.tsx
@@@ -376,55 -370,93 +376,142 @@@ describe('review screen', () => 
      expect(error).toHaveTextContent(/budget cannot cover/);
    });
  
 +  // Devnet pilot: an approved payout waits for the builder's vote (2 of 3) in their wallet.
 +  const devnetPayout = (status: string, settlement = 'squads_devnet') => ({
 +    id: 'set-1', participationId: 'p1', studyId: 's1', studyTitle: 'S', amountUnits: 1_000_000, asset: 'USDC', decimals: 6,
 +    destination: '9xQeWvG816bUx9EPjHmaT23yvVM2ZWbrrpZb9PusVFin', settlement, status, signature: null, failureReason: null, attempts: 0,
 +    authorizedAt: '2026-10-03T14:30:00.000Z', settledAt: null,
 +  });
 +  it('devnet pilot: a payout awaiting approval → review the vote → sign in the wallet → submitted with its index and op id', async () => {
 +    mockPart = participation({ status: 'approved', decidedAt: '2026-10-03T14:30:00.000Z', reward: { kind: 'token', asset: 'USDC', decimals: 6, units: 1_000_000, settlement: 'squads_devnet' }, payout: devnetPayout('awaiting_approval') });
 +    const plan = approvalPlan({ amountUnits: 1_000_000 });
 +    mockApi.mockImplementation(async (name: string) => (name === 'settlementApproval' ? plan : { settlementId: 'set-1', kind: 'payout', status: 'submitted', signature: '5igVote', network: 'devnet' }));
 +    mockSign.mockImplementation(async (_p: unknown, _c: unknown, send: (s: string) => Promise<unknown>) => {
 +      await send('5igVote');
 +      return { signature: '5igVote' };
 +    });
 +    await renderIn(<Review />);
 +    expect(screen.queryByTestId('reward-approval-sign')).toBeNull();
 +    await fireEvent.press(screen.getByTestId('reward-approval-review'));
 +    await settle();
 +    await settle();
 +    expect(mockApi).toHaveBeenCalledWith('settlementApproval', { params: { id: 'set-1' } });
 +    // The vote (multisig, proposal #4) is checked in the bytes; the payment's amount, recipient and op id are described.
 +    expect(screen.getByTestId('reward-approval-plan')).toHaveTextContent(/#4 \(/);
 +    expect(screen.getByTestId('reward-approval-described')).toHaveTextContent(new RegExp(OP));
 +    expect(screen.getByTestId('reward-approval-described')).toHaveTextContent(new RegExp(ATTACKER));
 +    await fireEvent.press(screen.getByTestId('reward-approval-sign'));
 +    await settle();
 +    await settle();
 +    expect(mockApi).toHaveBeenCalledWith('submitSettlementApproval', { params: { id: 'set-1' }, body: { signature: '5igVote', txIndex: 4, opId: plan.opId } });
 +  });
 +
 +  it('devnet pilot: a vote for another payment than this tester’s is refused before the wallet opens', async () => {
 +    mockPart = participation({ status: 'approved', decidedAt: '2026-10-03T14:30:00.000Z', reward: { kind: 'token', asset: 'USDC', decimals: 6, units: 1_000_000, settlement: 'squads_devnet' }, payout: devnetPayout('awaiting_approval') });
 +    mockSign.mockClear();
 +    mockApi.mockImplementation(async () => approvalPlan({ amountUnits: 1_000_000, settlementId: 'set-other' }));
 +    await renderIn(<Review />);
 +    await fireEvent.press(screen.getByTestId('reward-approval-review'));
 +    await settle();
 +    await settle();
 +    expect(screen.getByTestId('reward-approval-error')).toHaveTextContent(/not the payment you are approving.*Nothing was signed/);
 +    expect(screen.queryByTestId('reward-approval-sign')).toBeNull();
 +    expect(mockSign).not.toHaveBeenCalled();
 +  });
 +
 +  it('the wallet vote is offered only for a devnet payout awaiting approval', async () => {
 +    mockPart = participation({ status: 'approved', decidedAt: '2026-10-03T14:30:00.000Z', payout: devnetPayout('submitted') });
 +    await renderIn(<Review />);
 +    expect(screen.queryByTestId('reward-approval-review')).toBeNull();
 +  });
 +
+   // H-33 (full E2E): a decision already committed elsewhere (another tab, another device) comes back
+   // as CONFLICT_STATE. The screen refetches and shows that decision instead of an error to retry.
+   const conflict = (message: string) => {
+     const { ApiError } = jest.requireMock<{ ApiError: new (code: string, message: string) => Error }>('../src/api/client');
+     return new ApiError('CONFLICT_STATE', message);
+   };
+ 
+   it('H-33 / E-05: an approve whose retry finds it approved (its own earlier commit) says so neutrally, with no error', async () => {
+     mockApi.mockImplementation(async () => {
+       // The same decision is already in: e.g. this builder's own approve committed and the response
+       // was lost (crash after commit), so the retry hears 409.
+       mockPart = participation({ status: 'approved', decidedAt: '2026-10-03T14:30:00.000Z' });
+       throw conflict('Cannot approve a participation that is approved.');
+     });
+     await renderIn(<Review />);
+     await fireEvent.press(screen.getByTestId('review-approve'));
+     await fireEvent.press(screen.getByTestId('confirm-ok'));
+     await settle();
+     await settle();
+     await advance(400);
+     expect(mockApi).toHaveBeenCalledTimes(1); // money path: one request, never retried
+     expect(screen.queryByTestId('confirm-sheet')).toBeNull();
+     expect(screen.queryByTestId('decision-error', { includeHiddenElements: true })).toBeNull();
+     const notice = screen.getByTestId('review-already-decided', { includeHiddenElements: true });
+     expect(notice).toHaveTextContent(/Already approved/);
+     expect(notice).toHaveTextContent(/Nothing more to do/);
+     expect(notice).not.toHaveTextContent(/elsewhere|wasn’t applied/);
+     expect(screen.getByTestId('review-decided')).toHaveTextContent(/Decision: Approved/);
+     await advance(600);
+     expect(screen.queryByTestId('review-approve')).toBeNull();
+   });
+ 
+   it('H-33: a rejection that finds the submission already approved shows the approval, with no error', async () => {
+     mockApi.mockImplementation(async () => {
+       mockPart = participation({ status: 'approved', decidedAt: '2026-10-03T14:30:00.000Z' });
+       throw conflict('Cannot reject a participation that is approved.');
+     });
+     await renderIn(<Review />);
+     await fireEvent.press(screen.getByTestId('review-reject'));
+     await fireEvent.changeText(screen.getByTestId('reject-reason'), 'No evidence attached for the wallet step.');
+     await fireEvent.press(screen.getByTestId('confirm-ok'));
+     await settle();
+     await settle();
+     await advance(400);
+     expect(screen.queryByTestId('confirm-sheet')).toBeNull();
+     expect(screen.queryByTestId('decision-error', { includeHiddenElements: true })).toBeNull();
+     const notice = screen.getByTestId('review-already-decided', { includeHiddenElements: true });
+     expect(notice).toHaveTextContent(/Already decided/);
+     expect(notice).toHaveTextContent(/decided elsewhere/);
+     expect(notice).toHaveTextContent(/wasn’t applied/);
+     expect(screen.getByTestId('review-decided')).toHaveTextContent(/Decision: Approved/);
+   });
+ 
+   it('H-33: a conflict that lands on a decided state without a Decision notice still says where it stands', async () => {
+     mockApi.mockImplementation(async () => {
+       // The tester withdrew meanwhile: decided, but no decision notice exists for it.
+       mockPart = participation({ status: 'withdrawn', decidedAt: null });
+       throw conflict('Cannot approve a participation that is withdrawn.');
+     });
+     await renderIn(<Review />);
+     await fireEvent.press(screen.getByTestId('review-approve'));
+     await fireEvent.press(screen.getByTestId('confirm-ok'));
+     await settle();
+     await settle();
+     await advance(400);
+     expect(screen.queryByTestId('confirm-sheet')).toBeNull();
+     expect(screen.queryByTestId('review-decided')).toBeNull();
+     const notice = screen.getByTestId('review-already-decided', { includeHiddenElements: true });
+     expect(notice).toHaveTextContent(/no longer awaiting review/);
+     expect(notice).toHaveTextContent(/Withdrawn/i);
+   });
+ 
+   it('H-33: a conflict that leaves the submission undecided keeps the sheet and its message', async () => {
+     mockApi.mockImplementation(async () => {
+       throw conflict('This study is not accepting decisions right now.');
+     });
+     await renderIn(<Review />);
+     await fireEvent.press(screen.getByTestId('review-approve'));
+     await fireEvent.press(screen.getByTestId('confirm-ok'));
+     await settle();
+     await settle();
+     await advance(100);
+     expect(screen.getByTestId('confirm-sheet')).toBeTruthy();
+     expect(screen.getByTestId('decision-error', { includeHiddenElements: true })).toHaveTextContent(/not accepting decisions/);
+     expect(screen.queryByTestId('review-already-decided', { includeHiddenElements: true })).toBeNull();
+   });
+ 
    it('a disputed rejection shows the tester’s dispute; an overturned one shows the transfer card', async () => {
      mockPart = participation({ status: 'disputed', decidedAt: '2026-10-03T14:30:00.000Z', decisionReason: 'The receipt screen was never reached.' });
      mockDisputes = [{ id: 'd1', participationId: 'p1', status: 'open', reason: 'My note explains the checkout button problem.', outcome: null, resolutionNote: null }];
```

## Gates on the final integrated tree

Clean worktree (porcelain 0 before and after); `pnpm install --offline --frozen-lockfile` → "Done in 7.6s"; node v24.21.0; at most 2 workers. Nothing was started on 8787 or 8697; PID 28574 was not touched.
Each exit code below is the command's own (`bash -c "$step" >> log 2>&1; echo "=== EXIT $?"`):

| Command | Exit | Result |
|---|---|---|
| `pnpm check:secrets` | 0 | "check:secrets passed: 1673 committable files scanned, no findings." |
| **`pnpm lint`** | **0** | no problems (r1: 1 error; fixed by fb3f3bf) |
| `pnpm typecheck` | 0 | |
| `pnpm --filter @pocket-qa/api exec vitest run --maxWorkers=2` | 0 | Test Files 52 passed, 1 skipped (53); Tests 831 passed, 2 skipped (833) |
| `pnpm --filter @pocket-qa/mobile exec jest --ci --maxWorkers=2` | 0 | Test Suites 72 passed (72); Tests 1477 passed (1477) |

**Emulator: not re-run.** The tree differs from r1's tree only in one docs file (`git diff --stat 77a1732 5e878a1` above), so r1's emulator result stands: 34 files passed + 1 skipped, 694 tests passed + 7 skipped, exit 0. The same goes for r1's scripts 93/93, contracts 17/17, domain 301/301 and review-screen + devnet-sign-ui 45/45 (no code differs).

## Replay for the parent (with the token, after Hamza's go)
1. Re-read the heads. Use the pinned SHAs: **fb3f3bf**, a364b08, 27608e9.
2. Re-run the `merge-tree` checks above. Expect exit 0 and tree `5e878a1…`.
3. Merge PR-A → PR-B → PR-C.
4. Re-run the gates. Lint must be exit 0 on the integrated tree.

If the fv branch has moved past fb3f3bf (e.g. pqa-codex-web evidence), either merge fb3f3bf exactly or redo this rehearsal on the new head.
Logs (local, not committed): `~/.local/share/pocketqa/runs/release-integration-r2-gates.log`.
