# Squads v4 devnet pilot: receipt

> Devnet test USDC, no value. Pilot: test keys simulate all roles (builder, Pocket QA, arbiter, tester); not independent custody; no physical wallet; two of three signers.

Outcome: **failed** (BLOCKED: needs ≥ 0.2 devnet SOL on Pocket QA DoUXiXfn7dU5sL6NAWX4aiy9mJU9Nqy5edzCzoFFijwS (has 0 lamports) and ≥ 3.4 devnet test USDC on builder 6XoDNcAjSscq5bGhZoEX7q8kUfjkJHJb1YuDeEFgdudn (has no token account). Nothing was sent.). Commit `5d5d4310df361f8946f23423e6bdf85cc51d71f2`. 2026-10-05T05:19:58.880Z to 2026-10-05T05:19:59.773Z. RPC https://api.devnet.solana.com, genesis `EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG`.

## Roles and accounts (public keys only)

- builder: [`6XoDNcAjSscq5bGhZoEX7q8kUfjkJHJb1YuDeEFgdudn`](https://explorer.solana.com/address/6XoDNcAjSscq5bGhZoEX7q8kUfjkJHJb1YuDeEFgdudn?cluster=devnet)
- pocketqa: [`DoUXiXfn7dU5sL6NAWX4aiy9mJU9Nqy5edzCzoFFijwS`](https://explorer.solana.com/address/DoUXiXfn7dU5sL6NAWX4aiy9mJU9Nqy5edzCzoFFijwS?cluster=devnet)
- arbiter: [`5ZFcx5EBbbLWYL4GEQhzQQaLVzVxSq6JBoHU2nUgDwEm`](https://explorer.solana.com/address/5ZFcx5EBbbLWYL4GEQhzQQaLVzVxSq6JBoHU2nUgDwEm?cluster=devnet)
- testerA: [`6xofkwscPCYuKszrmNrx7EGvQ1xhTKu7CgTohfuRmPBs`](https://explorer.solana.com/address/6xofkwscPCYuKszrmNrx7EGvQ1xhTKu7CgTohfuRmPBs?cluster=devnet)

## Steps (finalized status read back at the end)

| # | step | by | slot | fee (lamports) | finalized | error | signature |
|---|------|----|------|----------------|-----------|-------|-----------|

## Checks

- PASS R0: the RPC is Solana devnet (genesis pinned). Observed: `EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG`

## Refusals


## Alerts raised by the worker

- none

## Balances (base units; SOL in lamports)

```json
{
  "before": {
    "pocketqaLamports": "0",
    "builderLamports": "0",
    "builderUsdcUnits": "no token account"
  },
  "after": {}
}
```

## Program before and after

```json
{
  "id": "SQDS4ep65T869zMMBKyuUq6aD6EgTu8psMjkvj52pCf",
  "programData": "Fy3YMJCvwbAXUgUM5b91ucUVA3jYzwWLHL3MwBqKsh8n",
  "before": {
    "lastDeploySlot": 446638068,
    "upgradeAuthority": "HM5y4mz3Bt9JY9mr1hkyhnvqxSH4H2u2451j7Hc2dtvK",
    "accountDataLength": 1774845,
    "accountSha256": "5c866bde37d21edfcc92b630aa593a438f0d824be9d176e5904684996a4c0d37",
    "programBytesTrimmedSha256": "57a8d2d7ef5409df250415135f29f83da876e5adf5a2e5b5752e323cfb4f2f74"
  },
  "after": null
}
```

## Costs

```json
null
```

## Command

`cd apps/api && POCKETQA_LIVE_SQUADS_DEVNET=1 POCKETQA_LIVE_SQUADS_KEYS_DIR=<pilot key dir> npx vitest run --config vitest.live.config.ts test-live/squads-devnet.pilot.live.test.ts`
