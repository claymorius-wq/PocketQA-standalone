# Squads v4 devnet pilot: receipt

> Devnet test USDC, no value. Pilot: test keys simulate all roles (builder, Pocket QA, arbiter, tester); not independent custody; no physical wallet; two of three signers.

Outcome: **failed**. Commit `18962e344e4281e9542953c6c778535f54099820`. 2026-10-05T10:39:44.584Z to 2026-10-05T10:41:31.539Z. RPC https://api.devnet.solana.com, genesis `EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG`.

## Roles and accounts (public keys only)

- builder: [`6XoDNcAjSscq5bGhZoEX7q8kUfjkJHJb1YuDeEFgdudn`](https://explorer.solana.com/address/6XoDNcAjSscq5bGhZoEX7q8kUfjkJHJb1YuDeEFgdudn?cluster=devnet)
- pocketqa: [`DoUXiXfn7dU5sL6NAWX4aiy9mJU9Nqy5edzCzoFFijwS`](https://explorer.solana.com/address/DoUXiXfn7dU5sL6NAWX4aiy9mJU9Nqy5edzCzoFFijwS?cluster=devnet)
- arbiter: [`5ZFcx5EBbbLWYL4GEQhzQQaLVzVxSq6JBoHU2nUgDwEm`](https://explorer.solana.com/address/5ZFcx5EBbbLWYL4GEQhzQQaLVzVxSq6JBoHU2nUgDwEm?cluster=devnet)
- testerA: [`6xofkwscPCYuKszrmNrx7EGvQ1xhTKu7CgTohfuRmPBs`](https://explorer.solana.com/address/6xofkwscPCYuKszrmNrx7EGvQ1xhTKu7CgTohfuRmPBs?cluster=devnet)
- testerB: [`8nXQhLjv2s9fiYaShK49aQcVZAX5YLQKesXGSiCMwjAH`](https://explorer.solana.com/address/8nXQhLjv2s9fiYaShK49aQcVZAX5YLQKesXGSiCMwjAH?cluster=devnet)
- multisig: [`AHj8EXYGdzEvzCugchaUprdsjGaxs951weZLvd8g5KNE`](https://explorer.solana.com/address/AHj8EXYGdzEvzCugchaUprdsjGaxs951weZLvd8g5KNE?cluster=devnet)
- vaultAuthority: [`BoYeczYjiQMoC7XW7rkjQj27iyS2RADqWuSo9FLD9g7c`](https://explorer.solana.com/address/BoYeczYjiQMoC7XW7rkjQj27iyS2RADqWuSo9FLD9g7c?cluster=devnet)
- vaultUsdcAta: [`FoCyeMeazy7oy8riDkNKZqx5uHtAAVSDKSfFhRKQDpaz`](https://explorer.solana.com/address/FoCyeMeazy7oy8riDkNKZqx5uHtAAVSDKSfFhRKQDpaz?cluster=devnet)
- builderUsdcAta: [`3pnsfDdyaUF6DKAcRp1QtzcJ2hFHiPkj3BqjfgK5Pzux`](https://explorer.solana.com/address/3pnsfDdyaUF6DKAcRp1QtzcJ2hFHiPkj3BqjfgK5Pzux?cluster=devnet)
- testerAUsdcAta: [`3zQEpQEmTnPUS6anchYEqoticQN52uZYjsoaXEbdVejg`](https://explorer.solana.com/address/3zQEpQEmTnPUS6anchYEqoticQN52uZYjsoaXEbdVejg?cluster=devnet)
- createKey: [`6yDjZSLE2eTzyyyYhuaF4tEipPNVBBE7xxCAeTfRG1ZY`](https://explorer.solana.com/address/6yDjZSLE2eTzyyyYhuaF4tEipPNVBBE7xxCAeTfRG1ZY?cluster=devnet)
- testerBUsdcAta: [`FTKn1SeYNgA6MXuAfr3PApRdZEPpJZwPTW9HvXGsAmsT`](https://explorer.solana.com/address/FTKn1SeYNgA6MXuAfr3PApRdZEPpJZwPTW9HvXGsAmsT?cluster=devnet)

## Steps (finalized status read back at the end)

| # | step | by | slot | fee (lamports) | finalized | error | signature |
|---|------|----|------|----------------|-----------|-------|-----------|
| 1 | multisig_create | adapter | 507704308 | 10000 | finalized |  | [keNQ7unZzB…](https://explorer.solana.com/tx/keNQ7unZzBDWXtVAvK8sqGCwTHQNmjJh8Q9utqJdmm5CAbsCSBNoE1E9UVr1fS6F59VYoCxWrCGqJPaa5JAQUzE?cluster=devnet) |
| 2 | token_account_create:BoYeczYjiQMoC7XW7rkjQj27iyS2RADqWuSo9FLD9g7c | adapter | 507704312 | 5000 | finalized |  | [2KTmxVVEsm…](https://explorer.solana.com/tx/2KTmxVVEsmgE6z5CjqBmw7cfFC8AJczVzZUSmmvmPBffP5M27zia7wEQDhKESP6cMjV95MEwy1yNGr8hSb8TtCRS?cluster=devnet) |
| 3 | runner:wrong_mint_setup (wrap 0.01 devnet SOL; vault-owned wSOL account) | runner | 507704317 | 5000 | finalized |  | [3jRS6yqCk8…](https://explorer.solana.com/tx/3jRS6yqCk8DBgnfo4jqnXS1KgGFY7vtrnfUJg5Mgh74PfCwudmgkShb53K12UxEiQ7guBAoS6jsRobEM3LXRWNGd?cluster=devnet) |
| 4 | runner:wrong_mint_funding (wSOL with the funding reference) | runner | 507704321 | 10000 | finalized |  | [4CCcmmDeND…](https://explorer.solana.com/tx/4CCcmmDeNDWB3isrs4fiXQEvz6nrQqa8UNNgWRc9S4YGujZ577kmjJjW6rU3trv9Ug7R35L8bBcg3Vj9BVckXqgj?cluster=devnet) |
| 5 | runner:funding (builder wallet → study vault, 3.30 devnet test USDC) | runner | 507704351 | 10000 | finalized |  | [5dp18gzHJo…](https://explorer.solana.com/tx/5dp18gzHJoXyrqfZ7e5o7Go91DjrUXt8uBo45J1AsQrtSQaTPTJmAuqWjB48G9TFBBj4zLqzy93SF1eFJVrtbpkA?cluster=devnet) |
| 6 | token_account_create:6xofkwscPCYuKszrmNrx7EGvQ1xhTKu7CgTohfuRmPBs | adapter | 507704379 | 5000 | finalized |  | [5KETSMvcuE…](https://explorer.solana.com/tx/5KETSMvcuEAiWCrhhkZp98NJCsnrRjvEx73anmpUgoFV8sNBK4cTi6HJ4cm2E41B47HkiQCrToDS8vAPRgRGUTBy?cluster=devnet) |
| 7 | vault_transaction_create:1 | adapter | 507704392 | 5000 | finalized |  | [xrxNCqfEMk…](https://explorer.solana.com/tx/xrxNCqfEMkVvNTT7TDnrUZJtwyFS4aYg8ABbE3cCM6MixdnPyFKyViZYKKmxADSkqK3G7KRX34N4AqaNUdra1AD?cluster=devnet) |
| 8 | proposal_create:1 | adapter | 507704407 | 5000 | finalized |  | [5rXjYz8iiZ…](https://explorer.solana.com/tx/5rXjYz8iiZehbuUhDqgZzcbqdidRnfStTHBEQq3LvD67iSt72oyEdoJbFhyDtAQBRJTZSSwcWSBz4iS6ArmvGAba?cluster=devnet) |
| 9 | proposal_approve:1:pocketqa | adapter | 507704419 | 5000 | finalized |  | [532Hif9URJ…](https://explorer.solana.com/tx/532Hif9URJXXJrR5TXAgzVL32CSw5bhboxep6YztAgt7HY5X3PGzt2UxGsmMuXRd5qJ92nR3RNRZnbV2S58Y6cC2?cluster=devnet) |
| 10 | proposal_approve:1:builder | adapter | 507704432 | 10000 | finalized |  | [2QDnHdb7PG…](https://explorer.solana.com/tx/2QDnHdb7PGEuwhGB4LVCbTvBkbBdSg2TNGL7XspaSzQm5gZfP7V8zqjHum4LDp9xvLCBcGGqLvGE7VjJC3VxbN93?cluster=devnet) |
| 11 | vault_transaction_execute:1 | adapter | 507704452 | 5000 | finalized |  | [5nquBJWmx3…](https://explorer.solana.com/tx/5nquBJWmx3rh2uDKoaqHNPZZ9chGHs4pAgKYDU6wPTqvJmR2QJVfbZZNsXY2og7YyC2oN61pamPnd8d6aRTv4PZa?cluster=devnet) |
| 12 | token_account_create:8nXQhLjv2s9fiYaShK49aQcVZAX5YLQKesXGSiCMwjAH | adapter | 507704492 | 5000 | finalized |  | [5X9YnHu3dF…](https://explorer.solana.com/tx/5X9YnHu3dFEG2fDic4wc9MERG4Bcrrw1PfbMFaXrTjN5PdjbGKedTPyFdWLGUZvKbXkfvSpPWZaL1t5baTvSEW1z?cluster=devnet) |
| 13 | vault_transaction_create:2 | adapter | 507704501 | 5000 | finalized |  | [3dEzJ9dSQF…](https://explorer.solana.com/tx/3dEzJ9dSQFrpwMDntGwiBusHQfjNXqgLxRuGXwzFCzG4jc6RkK49Zmkaymz2BLKzXUxKFSEeZ6PoP4KGP6jea9kx?cluster=devnet) |
| 14 | proposal_create:2 | adapter | 507704509 | 5000 | finalized |  | [3pZDmXht3A…](https://explorer.solana.com/tx/3pZDmXht3AoFP7uC8rk8ojFwyezMrMrV1Rb7xEMZEi4mNpoAeTvXbh49dvQ8mbauTH2ifjGDQAopR7QxSfKG4Dti?cluster=devnet) |
| 15 | proposal_approve:2:pocketqa | adapter | 507704540 | 5000 | finalized |  | [4t67Q224Wb…](https://explorer.solana.com/tx/4t67Q224Wbdi6s8oMDppFeAe1CyDZhoSrjYJhpa4CLdkJ63TCG8JoXgqQw86iekMZHtJsgFWjDpFcpWWYEDCMHtj?cluster=devnet) |
| 16 | proposal_approve:2:arbiter | adapter | 507704545 | 10000 | finalized |  | [4hGFdyemnk…](https://explorer.solana.com/tx/4hGFdyemnk78xh25qucwt6JgoALgRnWdHhhrvDdg1unERKycHMJV8QrSRB1ZTqZ8P8in16XRfA63us5WKoR52vMg?cluster=devnet) |
| 17 | vault_transaction_execute:2 | adapter | 507704560 | 5000 | finalized |  | [4V7HR6dezR…](https://explorer.solana.com/tx/4V7HR6dezRgFXU5kR6SJT7J4HN5mHjHJAtzXSwVXC9jKTaSPQbBgKEJVnLscbAH87UZwQsPQUoXoMMqYKG7tchUg?cluster=devnet) |
| 18 | vault_transaction_create:3 | adapter | 507704609 | 5000 | finalized |  | [35WeTt4T5j…](https://explorer.solana.com/tx/35WeTt4T5jhdRWLMxXa1eV3DU7vGVULkb55Cpz1FKQqtAgXTEZas9vnMGDScTzFL9zZGppgRRLnAHqRttfMG5o7a?cluster=devnet) |
| 19 | proposal_create:3 | adapter | 507704619 | 5000 | finalized |  | [2rUPTmha5L…](https://explorer.solana.com/tx/2rUPTmha5L65heoPtPYtzb5wA6g71QTRqq9Ju21atwP4dRGKDVnAw2DdmC8G4vFExwtFCo2nSaoUcCUiXQXYpGrB?cluster=devnet) |
| 20 | proposal_approve:3:pocketqa | adapter | 507704632 | 5000 | finalized |  | [2XnjUnVLau…](https://explorer.solana.com/tx/2XnjUnVLauvkUnaoFSEQoqpLkYPoZWsRXpLAuRsZekYL6JCnpLeRK43FNJQ76ywyaWMfkkno1MjjMh4uaDW2nmr7?cluster=devnet) |
| 21 | proposal_approve:3:builder | adapter | 507704641 | 10000 | finalized |  | [2WsdWrENAZ…](https://explorer.solana.com/tx/2WsdWrENAZipQkAF9NeVxYYP3M9g8mmfj8Vq7E1ceF2roUjocvJxMdL15ENKucKFW2h6atjQMvk3WvdEpNRWCSAs?cluster=devnet) |
| 22 | vault_transaction_execute:3 | adapter | 507704660 | 5000 | finalized |  | [5D1cJ9TVcE…](https://explorer.solana.com/tx/5D1cJ9TVcEpphP1BWgGGqRsDQj5CirBMfEMBD8RmCev3Moixf1KgUDx5KxAHtZKjJV2L63qhTDVaWyRYuTMPFurH?cluster=devnet) |
| 23 | runner:unmatched_deposit (builder → vault, 0.01 devnet test USDC, no reference) | runner | 507704683 | 10000 | finalized |  | [3njTpvNH46…](https://explorer.solana.com/tx/3njTpvNH46p12F3424WdcySgGtzVcuTYuftUSfQj9JcGnK87nvyXLhBdvBVw3pUasRuHn6xs4udrmSjLPiSxnZKa?cluster=devnet) |
| 24 | vault_transaction_create:4 | adapter | 507704720 | 5000 | finalized |  | [4F79PrVWT5…](https://explorer.solana.com/tx/4F79PrVWT5LNrqni1xEF4rg5vKzKyQwZJHacR411EXqd5KqF3C5zYdyr6j6anUyg7baYaoK5LLgYXgZykmtQXH6c?cluster=devnet) |
| 25 | proposal_create:4 | adapter | 507704724 | 5000 | finalized |  | [4MxQkyEERz…](https://explorer.solana.com/tx/4MxQkyEERz3Esv2JwPurJtNyVqKJ1E3q86hQ1xXMtDTQWwB4FZKYrH2BXE7SGHqUmE16j2NGTcyFzrSh82DUqVCf?cluster=devnet) |
| 26 | proposal_approve:4:pocketqa | adapter | 507704732 | 5000 | finalized |  | [22KeoQaoEg…](https://explorer.solana.com/tx/22KeoQaoEgYhN5iTJGNaAifXVzWT4ArjcidPrK9BTtPitXKKqTGXT1V6S1dADsm9aYgGs7hQSRqH7FwP448MPXsm?cluster=devnet) |

## Checks

- PASS R0: the RPC is Solana devnet (genesis pinned). Observed: `EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG`
- PASS R1: autonomous (no config authority), threshold 2, time lock 0, no rent collector (finished transactions can’t be closed, so operation ids stay on chain). Observed: `{"createKey":"6yDjZSLE2eTzyyyYhuaF4tEipPNVBBE7xxCAeTfRG1ZY","configAuthority":"11111111111111111111111111111111","threshold":2,"timeLock":0,"transactionIndex":"0","rentCollector":null,"members":[{"key":"5ZFcx5EBbbLWYL4GEQhzQQaLVzVxSq6JBoHU2nUgDwEm","mask":2},{"key":"6XoDNcAjSscq5bGhZoEX7q8kUfjkJHJb1YuDeEFgdudn","mask":2},{"key":"DoUXiXfn7dU5sL6NAWX4aiy9mJU9Nqy5edzCzoFFijwS","mask":7}]}`
- PASS R1: members: builder Vote, Pocket QA Initiate+Vote+Execute, arbiter Vote. Observed: `{"5ZFcx5EBbbLWYL4GEQhzQQaLVzVxSq6JBoHU2nUgDwEm":2,"6XoDNcAjSscq5bGhZoEX7q8kUfjkJHJb1YuDeEFgdudn":2,"DoUXiXfn7dU5sL6NAWX4aiy9mJU9Nqy5edzCzoFFijwS":7}`
- PASS R1: no SpendingLimit account for this multisig. Observed: `0`
- PASS R8: a wrong-mint transfer is not credited. Observed: `failed`
- PASS R2: funding confirmed from the builder wallet, credited exactly once. Observed: `{"id":"4cce63c3-bf76-4bcf-8873-17af2de20697","studyId":"188d6b60-cf42-4b5a-9fd1-51524f25a7b3","amountUnits":3300000,"asset":"USDC","decimals":6,"network":"solana:devnet","mint":"4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU","vault":"FoCyeMeazy7oy8riDkNKZqx5uHtAAVSDKSfFhRKQDpaz","reference":"DNQHCtBG2F7GBd6vWyAJWkc56ja6wfJVC1F3GjYXGmQb","settlement":"squads_devnet","status":"confirmed","signature":"5dp18gzHJoXyrqfZ7e5o7Go91DjrUXt8uBo45J1AsQrtSQaTPTJmAuqWjB48G9TFBBj4zLqzy93SF1eFJVrtbpkA","source":"6XoDNcAjSscq5bGhZoEX7q8kUfjkJHJb1YuDeEFgdudn","failureReason":null,"createdAt":"2026-10-05T10:39:45.739Z","expiresAt":"2026-10-05T11:09:45.739Z","confirmedAt":"2026-10-05T10:39:45.739Z"}`
- PASS R2: vault balance delta equals the quote. Observed: `3300000`
- PASS R3: both payouts confirmed; the overturned dispute co-signed by the arbiter. Observed: `["1:builder:confirmed","2:arbiter:confirmed"]`
- PASS P1-1: index 1: the stored vault message is [TransferChecked, Memo(operation id)] created by Pocket QA. Observed: `{"creator":"DoUXiXfn7dU5sL6NAWX4aiy9mJU9Nqy5edzCzoFFijwS","operation":"pqa-op1:681e6d5a42716b21b3519af8cb7370f93ca77a570c1aa550b50e2b85e03b8c05","instructions":2,"program":"TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA","opcode":12,"source":"FoCyeMeazy7oy8riDkNKZqx5uHtAAVSDKSfFhRKQDpaz","mint":"4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU","destination":"3zQEpQEmTnPUS6anchYEqoticQN52uZYjsoaXEbdVejg","authority":"BoYeczYjiQMoC7XW7rkjQj27iyS2RADqWuSo9FLD9g7c","amount":"1000000","decimals":6}`
- PASS R3: index 1: executed with two distinct approvals (Pocket QA and the builder). Observed: `{"status":"Executed","approved":["6XoDNcAjSscq5bGhZoEX7q8kUfjkJHJb1YuDeEFgdudn","DoUXiXfn7dU5sL6NAWX4aiy9mJU9Nqy5edzCzoFFijwS"]}`
- PASS R6: index 1: exactly one execute despite the crash and repeated runs. Observed: `1`
- PASS P1-1: index 2: the stored vault message is [TransferChecked, Memo(operation id)] created by Pocket QA. Observed: `{"creator":"DoUXiXfn7dU5sL6NAWX4aiy9mJU9Nqy5edzCzoFFijwS","operation":"pqa-op1:e237275b97521723091d85881585855047a41044f37f4e068af45cb58b7d6554","instructions":2,"program":"TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA","opcode":12,"source":"FoCyeMeazy7oy8riDkNKZqx5uHtAAVSDKSfFhRKQDpaz","mint":"4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU","destination":"FTKn1SeYNgA6MXuAfr3PApRdZEPpJZwPTW9HvXGsAmsT","authority":"BoYeczYjiQMoC7XW7rkjQj27iyS2RADqWuSo9FLD9g7c","amount":"1000000","decimals":6}`
- PASS R3: index 2: executed with two distinct approvals (Pocket QA and the arbiter). Observed: `{"status":"Executed","approved":["5ZFcx5EBbbLWYL4GEQhzQQaLVzVxSq6JBoHU2nUgDwEm","DoUXiXfn7dU5sL6NAWX4aiy9mJU9Nqy5edzCzoFFijwS"]}`
- PASS R6: index 2: exactly one execute despite the crash and repeated runs. Observed: `1`
- PASS R6: tester A received exactly 1.00 devnet test USDC. Observed: `1000000`
- PASS R4: tester B (overturned dispute) received exactly 1.00 devnet test USDC. Observed: `1000000`
- PASS R5: refund of 1.10 devnet test USDC to the funding wallet. Observed: `1100000`
- PASS R7: the unmatched deposit is alerted. Observed: `["unmatched deposit in the vault of study 188d6b60-cf42-4b5a-9fd1-51524f25a7b3: 10000 units on chain that no confirmed funding credited (not credited, not spendable; return it by hand)"]`
- PASS C8: books: funded 3.30, settled 2.00, fees 0.20, refunded 1.10, balanced; the deposit not credited. Observed: `{"fundedUnits":3300000,"availableUnits":0,"heldUnits":0,"payableUnits":0,"settledUnits":2000000,"feesUnits":200000,"pendingRefundUnits":0,"refundedUnits":1100000,"ok":true}`
- PASS C8: the vault on chain holds the fees plus the unmatched deposit. Observed: `210000`
- PASS C2: policy-destination: refused before signing. Observed: `Refused before signing: the transfer does not match its recorded settlement.`
- PASS C2: policy-amount: refused before signing. Observed: `Refused before signing: the transfer does not match its recorded settlement.`
- PASS C2: no transaction was signed for the policy refusals. Observed: `3njTpvNH46p12F3424WdcySgGtzVcuTYuftUSfQj9JcGnK87nvyXLhBdvBVw3pUasRuHn6xs4udrmSjLPiSxnZKa`

## Refusals

- R8: funding with the right reference and amount but wrapped SOL instead of devnet test USDC: API status failed: The transfer is a different token. ([tx](https://explorer.solana.com/tx/4CCcmmDeNDWB3isrs4fiXQEvz6nrQqa8UNNgWRc9S4YGujZ577kmjJjW6rU3trv9Ug7R35L8bBcg3Vj9BVckXqgj?cluster=devnet))
- policy-destination: a transfer request that differs from its recorded settlement (destination): Refused before signing: the transfer does not match its recorded settlement. (nothing signed or sent)
- policy-amount: a transfer request that differs from its recorded settlement (amountUnits): Refused before signing: the transfer does not match its recorded settlement. (nothing signed or sent)

## Alerts raised by the worker

- unmatched deposit in the vault of study 188d6b60-cf42-4b5a-9fd1-51524f25a7b3: 10000 units on chain that no confirmed funding credited (not credited, not spendable; return it by hand)

## Balances (base units; SOL in lamports)

```json
{
  "before": {
    "pocketqaLamports": "5000000000",
    "builderLamports": "0",
    "builderUsdcUnits": "20000000"
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
