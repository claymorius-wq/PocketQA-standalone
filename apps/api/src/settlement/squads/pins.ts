import { CLASSIC_TOKEN_PROGRAM, DEVNET_USDC_MINT } from '@pocket-qa/domain';

/**
 * Everything the Squads devnet pilot (ADR 0007 §10) pins. Each value is checked against the
 * network before anything is signed; a mismatch refuses, it never adapts.
 */
/** `getGenesisHash` of Solana devnet. Mainnet's is MAINNET_GENESIS (refused). */
export const DEVNET_GENESIS = 'EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG';
export const MAINNET_GENESIS = '5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d';
export const PILOT_NETWORK = 'solana:devnet';
/** Circle's devnet test USDC (no value), classic Token program, 6 decimals. */
export const PILOT_MINT = DEVNET_USDC_MINT;
export const PILOT_TOKEN_PROGRAM = CLASSIC_TOKEN_PROGRAM;
export const PILOT_DECIMALS = 6;
/** The existing Squads v4 program (same id on every cluster). Nothing is deployed by the pilot. */
export const SQUADS_PROGRAM = 'SQDS4ep65T869zMMBKyuUq6aD6EgTu8psMjkvj52pCf';
export const SQUADS_PROGRAM_DATA = 'Fy3YMJCvwbAXUgUM5b91ucUVA3jYzwWLHL3MwBqKsh8n';
/** On devnet the program is upgradeable by this key (mainnet is immutable); the runner records it before and after. */
export const SQUADS_DEVNET_UPGRADE_AUTHORITY = 'HM5y4mz3Bt9JY9mr1hkyhnvqxSH4H2u2451j7Hc2dtvK';
export const BPF_UPGRADEABLE_LOADER = 'BPFLoaderUpgradeab1e11111111111111111111111';
/**
 * SPL Memo v2. Verified 2026-10-05: executable on devnet under the non-upgradeable BPF loader 2
 * (so it can't change); with no accounts it only validates UTF-8 and logs (solana-program/memo
 * entrypoint.rs). It carries the operation id inside the vault message, because Squads doesn't
 * store its own `memo` argument (vault_transaction_create.rs never assigns args.memo).
 */
export const MEMO_PROGRAM = 'MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr';
export const BPF_LOADER_2 = 'BPFLoader2111111111111111111111111111111111';
/** Operation id format: `pqa-op1:` + sha256 hex of `kind|studyId|participationId` (`-` for a refund). */
export const OPERATION_PREFIX = 'pqa-op1:';
/** SPL Token instruction tag of TransferChecked (Transfer is 3 and is refused: it doesn't check mint or decimals). */
export const TRANSFER_CHECKED = 12;
/** The Squads "no config authority" value: an autonomous multisig changes only by its own vote. */
export const AUTONOMOUS = '11111111111111111111111111111111';
/** Squads permission bits. */
export const PERM = { initiate: 1, vote: 2, execute: 4 } as const;
export const THRESHOLD = 2;
