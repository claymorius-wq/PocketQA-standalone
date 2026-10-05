# Squads devnet pilot: run 1 completion

> Devnet test USDC, no value. Pilot: test keys simulate all roles; not independent custody; no physical wallet.

Outcome: **refused-as-expected**. Run 1 completion: a second execute of the already-executed Squads index 1 on run 1’s multisig (expected on-chain refusal). Commit `0b66267ac631671008d8cc66736cab6d79e80646` (clean tree: true), 2026-10-05T10:58:34.743Z.

Send landed: [3zNWsdDxaSwM…](https://explorer.solana.com/tx/3zNWsdDxaSwMxx9Y3HnNJPp4uPuMstJcNvMQy6R86MUWM6RSamJVyYrF3B82rcFyYUp2B7PJuyYT7uhRW3G8gPES?cluster=devnet), slot 507709054, finalized, err `{"InstructionError":[0,{"Custom":6008}]}`, fee 5000 lamports.

```json
{
  "preChecks": {
    "genesis": "EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG",
    "program": {
      "lastDeploySlot": 446638068,
      "accountSha256": "5c866bde37d21edfcc92b630aa593a438f0d824be9d176e5904684996a4c0d37"
    },
    "multisig": {
      "threshold": 2,
      "timeLock": 0,
      "configAuthority": "11111111111111111111111111111111",
      "rentCollector": null
    },
    "proposal1": "Executed",
    "balances": {
      "testerA": "1000000",
      "vault": "210000"
    }
  },
  "postChecks": {
    "balances": {
      "testerA": "1000000",
      "vault": "210000"
    },
    "program": {
      "lastDeploySlot": 446638068,
      "accountSha256": "5c866bde37d21edfcc92b630aa593a438f0d824be9d176e5904684996a4c0d37"
    }
  }
}
```
