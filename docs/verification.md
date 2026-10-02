# Verification log

This log records actual commands and their actual output only. Predicted results never go here. Each entry says who ran it, where (pane or worktree), and when. Long raw outputs live in `docs/reviews/<phase>/` files, and each entry links its file.

## 2026-10-02: Foundation round 2 (lead, `wX:p1`, main checkout, uncommitted tree)

Runtime: Node v24.21.0 (nvm), pnpm 10.32.1. For registry, schedule and genesis evidence, see `docs/reviews/phase0/evidence-registry.txt`.

### Toolchain probes (verbatim)
```
$ adb devices -l
List of devices attached

$ ~/Library/Android/sdk/emulator/emulator -list-avds
Medium_Phone_API_36.1

$ "/Applications/Android Studio.app/Contents/jbr/Contents/Home/bin/java" -version 2>&1 | head -1
openjdk version "21.0.8" 2025-07-15

$ curl -s -m 15 https://api.mainnet-beta.solana.com -H 'content-type: application/json' -d '{"jsonrpc":"2.0","id":1,"method":"getGenesisHash"}'
{"jsonrpc":"2.0","result":"5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d","id":1}
```

### Email normalization: red, then green (post-approval P3 fix #6)
```
$ pnpm --filter @pocket-qa/contracts test   # new test added, schema not yet changed
     × normalizes emails with surrounding whitespace and case 2ms
 FAIL  src/index.test.ts > contracts > normalizes emails with surrounding whitespace and case
AssertionError: expected false to be true // Object.is equality
      Tests  1 failed | 13 passed (14)
```
After switching `Email` to `z.string().trim().toLowerCase().pipe(z.email().max(254))`, the final run below shows `Tests 14 passed (14)`.

### `pnpm verify` on the tree being committed (verbatim, blank lines and ANSI codes stripped)
```
$ pnpm verify; echo EXIT=$?
> pocket-qa@ verify /Users/hamzadiaz/Projects/pocket-qa
> pnpm check:secrets && pnpm typecheck && pnpm lint && pnpm test
> pocket-qa@ check:secrets /Users/hamzadiaz/Projects/pocket-qa
> node scripts/check-secrets.mjs
check:secrets passed: 31 committable files scanned, no findings.
> pocket-qa@ typecheck /Users/hamzadiaz/Projects/pocket-qa
> pnpm -r --if-present typecheck
> @pocket-qa/contracts@0.2.0 typecheck /Users/hamzadiaz/Projects/pocket-qa/packages/contracts
> tsc -p tsconfig.json
> pocket-qa@ lint /Users/hamzadiaz/Projects/pocket-qa
> eslint .
> pocket-qa@ test /Users/hamzadiaz/Projects/pocket-qa
> node --test "scripts/*.test.mjs" && pnpm -r --if-present test
✔ flags known token shapes (1.066792ms)
✔ flags credential-named identifiers regardless of prefix or case (0.065875ms)
✔ ignores ordinary code, empty env values and spaced passphrases (0.243042ms)
✔ allow marker covers only its own line (0.093875ms)
✔ forbidden paths (0.263292ms)
✔ CLI exits 1 on a planted secret and on a force-added sqlite file, 0 on a clean repo (146.744833ms)
✔ CLI still runs when invoked through a symlink (49.236042ms)
ℹ tests 7
ℹ suites 0
ℹ pass 7
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 229.986584
> @pocket-qa/contracts@0.2.0 test /Users/hamzadiaz/Projects/pocket-qa/packages/contracts
> vitest run
 RUN  v5.0.3 /Users/hamzadiaz/Projects/pocket-qa/packages/contracts
 Test Files  2 passed (2)
      Tests  14 passed (14)
   Start at  22:43:15
   Duration  114ms (import 47%, transform 43%, tests 7%, worker 3%)
EXIT=0
```

Notes:
- `lint` runs real ESLint (`eslint .` at the root, typescript-eslint recommended) over `scripts/` and `packages/`.
- So far, `typecheck` covers only `packages/contracts`. Each new package adds its own `typecheck` script.
- Superseded: the round-1 entry (Node 25.4.0, 2 scanner tests and 7 contract tests) was replaced after independent review. Node 25 is EOL.
