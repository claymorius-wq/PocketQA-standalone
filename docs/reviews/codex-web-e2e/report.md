# Codex Web Devnet E2E

Date: 2026-10-07

Target: devnet artifact `4ee4603` served through `https://pocketqa-devnet.vercel.app` via `test-only hostname mapping, TLS errors ignored, NOT the hosted deployment`.

Wallet class: `Pocket QA Test Wallet (devnet): injected by Playwright, not an extension`; `NOT extension compatibility`.

## Completed Resume Run

- Evidence directory: `docs/reviews/codex-web-e2e/evidence/codex-2026-10-07T06-04-11-045Z`
- Run data: `docs/reviews/codex-web-e2e/evidence/codex-2026-10-07T06-04-11-045Z/run.json`
- Study: `i6e0cf44ec9c8297d06d282afc553946`
- Participation: `3609e04c-2922-4ee0-b7c5-604ed101818d`
- Vault ATA: `GJNTrTktAMSMhCzPa6YP3hrDVTukJs2qMvueUpQAQzsz`
- Final vault units: `0`

Screenshots captured:

- `00-first-navigation.png`
- `01-builder-signed-in.png`
- `02-tester3-signed-in.png`
- `03-tester3-wallet-linked.png`
- `04-tester3-device-profile.png`
- `05-resume-builder-study-published.png`
- `10-tester-uploaded.png`
- `11-tester-submitted.png`
- `12-reward-vote-card.png`
- `13-reward-vote-cancelled.png`
- `14-reward-settled.png`
- `15-refund-vote-card.png`
- `15-fee-vote-card.png`
- `17-closed-refund-fee.png`

Signatures recorded from the in-page wallet:

- Reward vote: `7NEZFVwB8U`, sha256 `106d11742c931da690e68be3c6229d42e81eb86190cd45c2ddb5ca6e83168d96`, settlement `7e521d33-07e7-4a38-b8ce-f42369b16cd3`
- Refund vote: `4XqoL9utcT`, sha256 `073a398e2e5577a9bdca89715560b0df7f3e363b56139d6ed9cb2677eb1a744d`, settlement `d99239ec-94fc-419a-8ed8-ef4a1deae4cb`
- Fee-sweep vote: `4kvkSSMRjh`, sha256 `686ed714a5a8bcc157c6e3b18d05d4659b3d2283766f846860f1fb8a53809016`, settlement `844f3f8e-9bae-4256-b95d-422913398169`

## Funding Checkpoint

The funded/published checkpoint before resume is documented in `docs/reviews/codex-web-e2e/evidence/codex-2026-10-07T05-48-24-904Z/run.json`.

- Funding id: `65503611-1e64-45d8-9798-5674e6019e6c`
- Funding signature: `4TyVGsoCE6`, sha256 `96f59695d403dd1b88ff27d38b80af93d4588c5657bf5a6dd9e8b82a711b15f1`
- Amount: `1100000` units
- Reference: `BtytnEsmD4wzpjUQ5XZ9zDaeppzuPHEjMjLDd2NuU3FE`

## Notes

- No native recording was used.
- No deletion/reset was performed.
- No real funds or mainnet transactions were used.
- Local TLS private keys from early attempts are covered by `docs/reviews/codex-web-e2e/evidence/.gitignore` and must not be committed.
