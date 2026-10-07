// Pocket QA API contract (lead-authored foundation; backend owns changes after the
// foundation commit, and every change needs an entry in docs/decisions/contract-changes.md).
// All request and response bodies are validated with these schemas on both sides.
// Must stay the first import: see zodConfig.ts.
import './zodConfig';
import { z } from 'zod';

export * from './siws';

export const CONTRACT_VERSION = '0.6.1';
export const API_DEFAULT_PORT = 8787;
export const API_DEFAULT_BASE_URL = `http://127.0.0.1:${API_DEFAULT_PORT}`;

/**
 * True when a URL hostname (as `new URL(...).hostname` returns it, which normalises forms
 * like `127.1`) is a public host. Production refuses loopback, unspecified, private,
 * link-local, emulator-host and IPv4-mapped IPv6 addresses (docs/production, O5).
 */
export function isPublicHost(hostname: string): boolean {
  const h = hostname.toLowerCase().replace(/\.$/, '');
  if (h === '' || h === 'localhost' || h.endsWith('.localhost')) return false;
  const v4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(h);
  if (v4) {
    const [a, b] = [Number(v4[1]), Number(v4[2])];
    return !(a === 0 || a === 10 || a === 127 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127));
  }
  if (h.startsWith('[')) {
    const v6 = h.slice(1, -1);
    // Loopback, unspecified, IPv4-mapped/compatible, unique-local (fc00::/7) and link-local (fe80::/10).
    return !(v6 === '::1' || v6 === '::' || v6.startsWith('::ffff:') || /^::[0-9a-f.]*$/.test(v6) || /^f[cd]/.test(v6) || /^fe[89ab]/.test(v6));
  }
  return true;
}
/** Bearer session token travels in this header; never in URLs, never logged. */
export const AUTH_HEADER = 'authorization';
/**
 * Request paths whose trailing segment is a credential. The API's request logger must
 * replace everything after these prefixes with `[redacted]` (pinned by api/log.redact.test.ts).
 */
export const REDACTED_PATH_PREFIXES = ['/media/'] as const;

// ---------- primitives ----------
export const Id = z.string().min(1).max(64);
export const IsoDate = z.iso.datetime({ offset: true });
/** Test credits are integers with no cash value. */
export const Credits = z.number().int().nonnegative().max(1_000_000_000);
export const PositiveCredits = z.number().int().positive().max(1_000_000);
export const CREDITS_DISCLAIMER = 'Test credits · no cash value' as const;
export const REWARD_DISCLAIMER = 'Reward if approved · Not guaranteed' as const;

export const Role = z.enum(['tester', 'builder', 'admin']);
export type Role = z.infer<typeof Role>;
/** Admin accounts are created only by the local CLI script, never via the API. */
export const SelfServeRole = z.enum(['tester', 'builder']);

export const ErrorCode = z.enum([
  'VALIDATION',
  'UNAUTHENTICATED',
  'NOT_FOUND',
  'FORBIDDEN_ROLE',
  'CONFLICT_STATE',
  'NONCE_INVALID',
  'BUDGET_INSUFFICIENT',
  'CHAIN_UNAVAILABLE',
  'PAYLOAD_TOO_LARGE',
  'RATE_LIMITED',
  'EMAIL_UNVERIFIED',
  'PROVIDER_UNSUPPORTED',
  /** Not offered on this deployment (e.g. test credits in production); never a fake success. */
  'FEATURE_UNAVAILABLE',
  /** The same Idempotency-Key was sent with a different request (plan R10). */
  'IDEMPOTENCY_KEY_REUSED',
  /** Devnet (POCKETQA_ENV=devnet): the operation would exceed a spend cap; nothing was signed (CH-D1). */
  'DEVNET_SPEND_CAP',
  /** Devnet: an approval names a different Squads index or op id than the payment's receipt (CH-D3). */
  'APPROVAL_MISMATCH',
  /** Devnet: the cosigner's vote is not on chain (yet); the server signs nothing until it is. */
  'COSIGNER_NOT_SEEN',
  /** Devnet: the study's escrow vault is still being created on chain; try again shortly. */
  'VAULT_NOT_READY',
  /** Devnet: the member's vote on this payment is already on chain; no second vote transaction is offered. */
  'ALREADY_APPROVED',
  'INTERNAL',
]);
export type ErrorCode = z.infer<typeof ErrorCode>;
/** Non-owners get 404 NOT_FOUND, never 403, so resource existence does not leak. */
export const ErrorBody = z.object({ code: ErrorCode, message: z.string() });
export type ErrorBody = z.infer<typeof ErrorBody>;

export const Base58Address = z.string().regex(/^[1-9A-HJ-NP-Za-km-z]{32,44}$/);
export const Base58Signature = z.string().regex(/^[1-9A-HJ-NP-Za-km-z]{64,90}$/);

// ---------- auth / users ----------
// Normalize before validating so " A@B.com " is accepted as "a@b.com" (Zod checks format before .trim()).
export const Email = z.string().trim().toLowerCase().pipe(z.email().max(254));
export const Password = z.string().min(12).max(200);
export const DisplayName = z.string().trim().min(1).max(60);

export const RegisterBody = z.object({
  email: Email,
  password: Password,
  displayName: DisplayName,
  role: SelfServeRole,
});
export const LoginBody = z.object({ email: Email, password: z.string().min(1).max(200) });

export const Platform = z.enum(['android', 'ios', 'web']);
export type Platform = z.infer<typeof Platform>;

/** Self-reported by the tester; the UI must label it "self-reported, not verified". */
export const DeviceProfile = z.object({
  platform: Platform,
  osVersion: z.string().trim().min(1).max(40),
  androidApiLevel: z.number().int().min(1).max(100).nullable(),
  model: z.string().trim().min(1).max(80),
  languages: z.array(z.string().min(2).max(12)).min(1).max(10),
});
export type DeviceProfile = z.infer<typeof DeviceProfile>;
/** Android's API level as the profile form accepts it: a whole number 1–99. */
export const isAndroidApiLevel = (v: unknown): v is number => Number.isInteger(v) && (v as number) >= 1 && (v as number) <= 99;
/**
 * PUT /me/device: an Android profile must carry its API level (a profile saved from the web as
 * Android with null hid every study with a minimum API, study ia2ed9db). Other platforms keep null.
 * Only what is SAVED is stricter: stored profiles and User.device keep the DeviceProfile shape.
 */
export const DeviceProfileInput = DeviceProfile.superRefine((d, ctx) => {
  if (d.platform === 'android' && !isAndroidApiLevel(d.androidApiLevel)) {
    ctx.addIssue({ code: 'custom', path: ['androidApiLevel'], message: 'Android needs its API level (a whole number 1–99).' });
  }
});

/** One address links to at most one account; linking an address owned elsewhere is CONFLICT_STATE. */
export const WalletLink = z.object({
  address: Base58Address,
  cluster: z.literal('devnet'),
  linkedAt: IsoDate,
});
export type WalletLink = z.infer<typeof WalletLink>;

export const AccountStatus = z.enum(['active', 'suspended']);
export const User = z.object({
  id: Id,
  email: Email,
  displayName: DisplayName,
  role: Role,
  status: AccountStatus,
  device: DeviceProfile.nullable(),
  wallet: WalletLink.nullable(),
  createdAt: IsoDate,
});
export type User = z.infer<typeof User>;

export const AuthResponse = z.object({ token: z.string().min(32), user: User });
export type AuthResponse = z.infer<typeof AuthResponse>;

// ---------- studies ----------
export const StudyStatus = z.enum(['draft', 'published', 'paused', 'closed']);
export type StudyStatus = z.infer<typeof StudyStatus>;

export const TaskInput = z.object({
  instruction: z.string().trim().min(5).max(500),
  successCriteria: z.string().trim().max(300).optional(),
});
export const Task = TaskInput.extend({ id: Id, order: z.number().int().nonnegative() });
export type Task = z.infer<typeof Task>;

export const DeviceCriteria = z.object({
  platforms: z.array(Platform).min(1),
  minAndroidApi: z.number().int().min(1).max(100).nullable(),
  languages: z.array(z.string().min(2).max(12)).max(10),
});
export type DeviceCriteria = z.infer<typeof DeviceCriteria>;

export const StudyInput = z.object({
  title: z.string().trim().min(3).max(120),
  objective: z.string().trim().min(10).max(2000),
  /** Link or identifier for the build under test; free text, never fetched by the server. */
  buildUnderTest: z.string().trim().max(500).optional(),
  tasks: z.array(TaskInput).min(1).max(20),
  deviceCriteria: DeviceCriteria,
  /** Test-credit studies only; escrow studies set `payment` instead. */
  rewardCredits: PositiveCredits.optional(),
  slots: z.number().int().min(1).max(500),
  consentText: z.string().trim().min(20).max(5000),
});

// ---------- wallet-funded escrow (ADR 0007): SIMULATED settlement only in this phase ----------
/**
 * `off` everywhere by default; production refuses anything else. `squads_devnet` is the bounded
 * devnet feasibility pilot (ADR 0007 §10): devnet test USDC only, test keys simulate every role.
 */
export const SettlementMode = z.enum(['off', 'simulated', 'squads_devnet']);
/** How a given study settles: a local simulation, or the Squads devnet pilot (no value either way). */
export const SettlementKind = z.enum(['simulated', 'squads_devnet']);
export type SettlementKind = z.infer<typeof SettlementKind>;
export type SettlementMode = z.infer<typeof SettlementMode>;
/** Whole token base units (USDC: 6 decimals, 1 USDC = 1,000,000). Never fractional. */
export const TokenUnits = z.number().int().nonnegative().max(1_000_000_000_000);
export const PositiveTokenUnits = TokenUnits.min(1);
export const SIMULATED_SETTLEMENT_NOTICE = 'Simulation · no funds move' as const;
export const StudyPaymentInput = z.discriminatedUnion('mode', [
  z.object({ mode: z.literal('test_credits') }),
  z.object({ mode: z.literal('escrow'), rewardUnits: PositiveTokenUnits }),
]);
export type StudyPaymentInput = z.infer<typeof StudyPaymentInput>;
const onePaymentMode = (b: { rewardCredits?: number; payment?: StudyPaymentInput }, ctx: z.RefinementCtx) => {
  const escrow = b.payment?.mode === 'escrow';
  if (escrow && b.rewardCredits !== undefined) ctx.addIssue({ code: 'custom', path: ['rewardCredits'], message: 'Escrow studies pay in tokens: leave rewardCredits out.' });
  if (!escrow && b.rewardCredits === undefined) ctx.addIssue({ code: 'custom', path: ['rewardCredits'], message: 'rewardCredits is required for test-credit studies.' });
};
export const CreateStudyBody = StudyInput.extend({ payment: StudyPaymentInput.optional() }).superRefine(onePaymentMode);
/** Only drafts are editable; an escrow study's terms lock once funding has started. */
export const UpdateStudyBody = StudyInput.partial().extend({ rewardUnits: PositiveTokenUnits.optional() });

export const StudyBudget = z.object({
  /** reward × slots, reserved from the builder's test-credit balance at publish. */
  reserved: Credits,
  /** Test credits awarded to approved testers (never "paid": no money moves). */
  awarded: Credits,
  /** Credits held for consented/in-progress/submitted/disputed participations. */
  committed: Credits,
  /** reserved − awarded − committed. */
  available: Credits,
});

export const EscrowQuote = z.object({
  rewardUnits: PositiveTokenUnits,
  slots: z.number().int().positive(),
  feeBps: z.number().int().min(0).max(10_000),
  perTestFeeUnits: TokenUnits,
  perTestTotalUnits: PositiveTokenUnits,
  rewardPoolUnits: PositiveTokenUnits,
  platformFeeUnits: TokenUnits,
  totalUnits: PositiveTokenUnits,
});
/** funded = available + held + payable + settled + fees + pendingRefund + refunded (ADR 0007 §5). */
export const EscrowBalances = z.object({
  fundedUnits: TokenUnits,
  availableUnits: TokenUnits,
  heldUnits: TokenUnits,
  payableUnits: TokenUnits,
  settledUnits: TokenUnits,
  feesUnits: TokenUnits,
  pendingRefundUnits: TokenUnits,
  refundedUnits: TokenUnits,
  /** Devnet: earned fees swept on close to the platform fee wallet (decision (a)). */
  sweptFeesUnits: TokenUnits.optional(),
});
/**
 * `awaiting_approval` (POCKETQA_ENV=devnet only): the payment's Squads proposal exists and waits for
 * its cosigner's vote (the builder's wallet, or the arbiter's operator CLI) before the platform
 * signer completes the 2-of-3. Never shown as paid.
 */
export const SettlementStatus = z.enum(['pending', 'submitted', 'awaiting_approval', 'confirmed', 'failed']);
export const StudyPayment = z.discriminatedUnion('mode', [
  z.object({ mode: z.literal('test_credits') }),
  z.object({
    mode: z.literal('escrow'),
    settlement: SettlementKind,
    asset: z.literal('USDC'),
    decimals: z.literal(6),
    network: z.string(),
    mint: z.string(),
    quote: EscrowQuote,
    funded: z.boolean(),
    /** Builder-only books; null in tester views. */
    balances: EscrowBalances.nullable(),
    fundingWallet: z.string().nullable(),
    /** `settlementId`: the refund's settlement (devnet: GET /settlements/:id/approval for the builder's vote). */
    refund: z.object({ settlementId: Id, status: SettlementStatus, amountUnits: PositiveTokenUnits }).nullable(),
    /** Devnet: the fee sweep on close, approved by the builder like the refund (GET /settlements/:id/approval). */
    feeSweep: z.object({ settlementId: Id, status: SettlementStatus, amountUnits: PositiveTokenUnits }).nullable().optional(),
  }),
]);
export type StudyPayment = z.infer<typeof StudyPayment>;
/** What a tester is offered for an approved test. */
export const StudyReward = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('test_credits'), credits: PositiveCredits }),
  z.object({ kind: z.literal('token'), asset: z.literal('USDC'), decimals: z.literal(6), units: PositiveTokenUnits, settlement: SettlementKind }),
]);
export type StudyReward = z.infer<typeof StudyReward>;

export const ModerationState = z.enum(['ok', 'suspended']);
export const Study = StudyInput.omit({ tasks: true, rewardCredits: true }).extend({
  /** Test credits per approved test; 0 for escrow studies (see `payment`/`reward`). */
  rewardCredits: Credits,
  payment: StudyPayment,
  reward: StudyReward,
  id: Id,
  builderId: Id,
  status: StudyStatus,
  tasks: z.array(Task),
  consentVersion: z.number().int().positive(),
  moderation: ModerationState,
  budget: StudyBudget,
  slotsFilled: z.number().int().nonnegative(),
  createdAt: IsoDate,
  publishedAt: IsoDate.nullable(),
  closedAt: IsoDate.nullable(),
});
export type Study = z.infer<typeof Study>;

/** Tester list item. No builder id, no budget internals. */
export const StudySummary = z.object({
  id: Id,
  title: z.string(),
  objective: z.string(),
  rewardCredits: Credits,
  reward: StudyReward,
  deviceCriteria: DeviceCriteria,
  status: StudyStatus,
  publishedAt: IsoDate.nullable(),
  taskCount: z.number().int(),
  slotsRemaining: z.number().int().nonnegative(),
});
export type StudySummary = z.infer<typeof StudySummary>;

/** Tester detail: everything needed to read consent and do the tasks, nothing about budget or builder. */
export const TesterStudyView = StudySummary.extend({
  buildUnderTest: z.string().nullable(),
  tasks: z.array(Task),
  consentText: z.string(),
  consentVersion: z.number().int().positive(),
  /** Present when the requester already has a participation in this study. */
  myParticipationId: Id.nullable(),
});
export type TesterStudyView = z.infer<typeof TesterStudyView>;

// ---------- participations ----------
// `eligible` is computed, never stored. Stored states start at `consented`.
export const ParticipationStatus = z.enum([
  'consented',
  'in_progress',
  'submitted',
  'approved',
  'rejected',
  'disputed',
  'resolved',
  'withdrawn',
]);
export type ParticipationStatus = z.infer<typeof ParticipationStatus>;

export const Payout = z.object({
  id: Id,
  participationId: Id,
  studyId: Id,
  studyTitle: z.string(),
  amountUnits: PositiveTokenUnits,
  asset: z.literal('USDC'),
  decimals: z.literal(6),
  destination: z.string(),
  settlement: SettlementKind,
  /** `confirmed` is the only settled state; with simulation it means "settled (simulated)", never "paid". */
  status: SettlementStatus,
  signature: z.string().nullable(),
  failureReason: z.string().nullable(),
  attempts: z.number().int().nonnegative(),
  authorizedAt: IsoDate,
  settledAt: IsoDate.nullable(),
});
export type Payout = z.infer<typeof Payout>;

export const TaskNote = z.object({ taskId: Id, note: z.string().trim().max(2000) });

export const Participation = z.object({
  id: Id,
  studyId: Id,
  testerId: Id,
  /** Present only in the builder's view of their own study; testers see null. */
  testerDisplayName: z.string().nullable(),
  status: ParticipationStatus,
  consentVersion: z.number().int().positive(),
  consentedAt: IsoDate,
  startedAt: IsoDate.nullable(),
  submittedAt: IsoDate.nullable(),
  decidedAt: IsoDate.nullable(),
  decidedBy: Id.nullable(),
  decisionReason: z.string().nullable(),
  rewardCredits: Credits,
  reward: StudyReward,
  /** Escrow studies: the wallet frozen at consent; every payout for this participation goes here. */
  payoutAddress: z.string().nullable(),
  payout: Payout.nullable(),
  taskNotes: z.array(TaskNote),
});
export type Participation = z.infer<typeof Participation>;

/** Escrow studies require `payoutAddress`: it must equal the tester's linked wallet (explicit confirmation). */
export const ConsentBody = z.object({ consentVersion: z.number().int().positive(), accepted: z.literal(true), payoutAddress: Base58Address.optional() });


export const EscrowFundingStatus = z.enum(['awaiting_payment', 'pending', 'confirmed', 'failed', 'expired']);
export const EscrowFunding = z.object({
  id: Id,
  studyId: Id,
  amountUnits: PositiveTokenUnits,
  asset: z.literal('USDC'),
  decimals: z.literal(6),
  network: z.string(),
  mint: z.string(),
  vault: z.string(),
  reference: z.string(),
  settlement: SettlementKind,
  status: EscrowFundingStatus,
  signature: z.string().nullable(),
  source: z.string().nullable(),
  failureReason: z.string().nullable(),
  createdAt: IsoDate,
  expiresAt: IsoDate,
  confirmedAt: IsoDate.nullable(),
});
export type EscrowFunding = z.infer<typeof EscrowFunding>;
export const SimulatedSignature = z.string().regex(/^sim[A-Za-z0-9]{16,80}$/);
export const SubmitFundingSignatureBody = z.object({ signature: z.union([SimulatedSignature, Base58Signature]) });

// ---------- devnet (POCKETQA_ENV=devnet; docs/reviews/devnet/pqa-be3-interfaces.md) ----------
/** The copy every devnet money line carries (devnet-phase-contract.md §6, CH-D6). */
export const DEVNET_COPY = 'Devnet test USDC, no value · test keys · not independent custody';
/** A v0 transaction carries no chain id: every server-built transaction names its network, and the client refuses anything else. */
const DevnetNetwork = z.literal('devnet');
/**
 * The builder-signed funding transfer, built by the server from its own state (CH-D3): the pinned
 * mint, from the builder's token account to THIS study's vault, the quoted amount, the request's
 * reference. Unsigned; the funding wallet is the fee payer. After the wallet broadcasts it, the
 * client calls POST /escrow/fundings/:id/signature.
 */
export const DevnetFundingTransaction = z.object({
  transactionB64: z.string().min(1),
  fundingId: Id,
  studyId: Id,
  /** The Solana Pay reference the transfer carries (a funding has no Squads operation id). */
  reference: Base58Address,
  amountUnits: PositiveTokenUnits,
  /** The study vault's token account. */
  destination: Base58Address,
  mint: Base58Address,
  network: DevnetNetwork,
  copy: z.literal(DEVNET_COPY),
});
export type DevnetFundingTransaction = z.infer<typeof DevnetFundingTransaction>;
/**
 * The cosigner's vote on ONE payment, bound to its Squads transaction index and operation id
 * (CH-D3): an unsigned proposal_approve, the builder's wallet as member and fee payer.
 */
export const SettlementApproval = z.object({
  settlementId: Id,
  kind: z.enum(['payout', 'refund', 'fee']),
  transactionB64: z.string().min(1),
  multisig: Base58Address,
  txIndex: z.number().int().positive(),
  opId: z.string().regex(/^pqa-op1:[0-9a-f]{64}$/),
  amountUnits: PositiveTokenUnits,
  /** The receiving wallet (tester, funding wallet for a refund, platform fee wallet). */
  destination: Base58Address,
  mint: Base58Address,
  network: DevnetNetwork,
  copy: z.literal(DEVNET_COPY),
});
export type SettlementApproval = z.infer<typeof SettlementApproval>;
/** After the wallet broadcast the vote: its signature, and the index and op id it was for (refused if they differ from the receipt). */
/**
 * The operator's view of one devnet payment (admin only, read-only): exactly the inputs of the
 * arbiter CLI (apps/api/scripts/devnet-arbiter.ts), which re-checks all of them on devnet itself.
 */
export const DevnetSettlementPlan = z.object({
  settlementId: Id,
  kind: z.enum(['payout', 'refund', 'fee']),
  cosigner: z.enum(['builder', 'arbiter']),
  state: z.string(),
  multisig: Base58Address,
  txIndex: z.number().int().positive(),
  opId: z.string().regex(/^pqa-op1:[0-9a-f]{64}$/),
  recipient: Base58Address,
  amountUnits: PositiveTokenUnits,
  mint: Base58Address,
  network: DevnetNetwork,
});
export type DevnetSettlementPlan = z.infer<typeof DevnetSettlementPlan>;
/** Where the payment stands after the vote was checked on chain (the platform signer completes it only then). */
export const SettlementApprovalResult = z.object({ settlementId: Id, kind: z.enum(['payout', 'refund', 'fee']), status: SettlementStatus, signature: Base58Signature.nullable(), network: DevnetNetwork });
export type SettlementApprovalResult = z.infer<typeof SettlementApprovalResult>;
export const SubmitSettlementApprovalBody = z.object({ signature: Base58Signature, txIndex: z.number().int().positive(), opId: z.string().regex(/^pqa-op1:[0-9a-f]{64}$/) });
export const SimulatedWalletPayment = z.object({ signature: SimulatedSignature, settlement: z.literal('simulated') });
export const PutTaskNoteBody = z.object({ note: z.string().trim().max(2000) });
export const WithdrawBody = z.object({ reason: z.string().trim().max(500).optional() });

// ---------- evidence ----------
export const EvidenceKind = z.enum(['screen_recording', 'screenshot']);
export const EvidenceMime = z.enum(['video/mp4', 'video/webm', 'image/png', 'image/jpeg', 'image/webp']);
export const MAX_EVIDENCE_BYTES = 100 * 1024 * 1024;
export const MAX_EVIDENCE_ITEMS_PER_PARTICIPATION = 20;
export const MAX_EVIDENCE_BYTES_PER_PARTICIPATION = 500 * 1024 * 1024;
export const PLAYBACK_TOKEN_TTL_SECONDS = 300;

/** Sent as the `meta` multipart field (JSON string) next to the `file` field. */
export const EvidenceUploadMeta = z.object({
  kind: EvidenceKind,
  taskId: Id.optional(),
  durationMs: z.number().int().nonnegative().max(60 * 60 * 1000).optional(),
  capturedOn: Platform,
  /** Client-side id of the kept local segment; the server rejects duplicate uploads. */
  clientSegmentId: z.string().min(1).max(64),
});
export const Evidence = z.object({
  id: Id,
  participationId: Id,
  kind: EvidenceKind,
  mimeType: EvidenceMime,
  sizeBytes: z.number().int().positive(),
  durationMs: z.number().int().nullable(),
  taskId: Id.nullable(),
  capturedOn: Platform,
  createdAt: IsoDate,
});
export type Evidence = z.infer<typeof Evidence>;

/**
 * Direct-to-storage upload (ADR 0005 §3, `storage: 'r2'`). The server picks an opaque
 * quarantine key and returns a short-lived presigned PUT bound to the declared type and
 * exact size; nothing is evidence until the server completes (verifies) the upload.
 */
export const CreateUploadIntentBody = EvidenceUploadMeta.extend({
  mimeType: EvidenceMime,
  sizeBytes: z.number().int().positive().max(MAX_EVIDENCE_BYTES),
});
export const UPLOAD_INTENT_TTL_SECONDS = 15 * 60;
export const UploadIntent = z.object({
  id: Id,
  method: z.literal('PUT'),
  uploadUrl: z.string().url(),
  /** Send exactly these headers with the PUT (they are part of the signature). */
  headers: z.record(z.string(), z.string()),
  expiresAt: IsoDate,
});
export type UploadIntent = z.infer<typeof UploadIntent>;

/** Bound to one evidence item and the requesting user; single resource, short-lived. */
/**
 * Bound to one evidence item and the requesting user; short-lived. Local storage: a token for
 * GET /media/:token (the API streams the bytes). Private R2: a presigned GET on the bucket's S3
 * endpoint (<= 5 min, no custom domain), issued after the same authorisation, so the bytes never
 * pass through the API (Vercel body limit). Exactly one of the two.
 */
export const PlaybackToken = z
  .object({ token: z.string().min(32).optional(), url: z.string().url().optional(), expiresAt: IsoDate })
  .refine((v) => (v.token === undefined) !== (v.url === undefined), { message: 'exactly one of token or url' });
export type PlaybackToken = z.infer<typeof PlaybackToken>;

// ---------- findings / review ----------
export const FindingSeverity = z.enum(['blocker', 'major', 'minor', 'info']);
export const FindingInput = z.object({
  title: z.string().trim().min(3).max(140),
  severity: FindingSeverity,
  description: z.string().trim().min(5).max(4000),
  /** Server must check the evidence belongs to the same participation, else VALIDATION. */
  evidenceId: Id.optional(),
  timestampMs: z.number().int().nonnegative().optional(),
});
export const Finding = FindingInput.extend({
  id: Id,
  participationId: Id,
  createdBy: Id,
  /** Findings are human-authored; there is no AI source in the MVP. */
  source: z.literal('human'),
  createdAt: IsoDate,
});
export type Finding = z.infer<typeof Finding>;

/** `helpful`: the builder marks the tester's feedback helpful (reputation only; no money). */
export const ApproveBody = z.object({ note: z.string().trim().max(1000).optional(), helpful: z.boolean().optional() });
export const RejectBody = z.object({ reason: z.string().trim().min(10).max(1000) });

// ---------- credits ledger ----------
export const LedgerKind = z.enum([
  'test_topup',
  'study_reserve',
  'reward_credit',
  'study_release',
  'dispute_credit',
]);
/** Append-only. Balances are derived by summing entries, never stored. */
export const LedgerEntry = z.object({
  id: Id,
  kind: LedgerKind,
  /** Signed delta for the account owning this view. */
  amount: z.number().int(),
  studyId: Id.nullable(),
  participationId: Id.nullable(),
  createdAt: IsoDate,
});
export const CreditsView = z.object({
  balance: Credits,
  entries: z.array(LedgerEntry),
  /** Always rendered next to balances. */
  disclaimer: z.literal(CREDITS_DISCLAIMER),
});
export const TopUpBody = z.object({ amount: z.number().int().positive().max(10_000) });

// ---------- disputes / moderation / account ----------
export const DisputeStatus = z.enum(['open', 'resolved']);
export const DisputeOutcome = z.enum(['upheld', 'overturned']);
export const OpenDisputeBody = z.object({ participationId: Id, reason: z.string().trim().min(10).max(2000) });
export const ResolveDisputeBody = z.object({ outcome: DisputeOutcome, note: z.string().trim().min(5).max(2000) });
export const Dispute = z.object({
  id: Id,
  participationId: Id,
  openedBy: Id,
  reason: z.string(),
  status: DisputeStatus,
  outcome: DisputeOutcome.nullable(),
  resolutionNote: z.string().nullable(),
  resolvedBy: Id.nullable(),
  createdAt: IsoDate,
  resolvedAt: IsoDate.nullable(),
});
export const ModerationBody = z.object({
  action: z.enum(['suspend', 'reinstate']),
  reason: z.string().trim().min(5).max(1000),
});
export const AuditEntry = z.object({
  id: Id,
  actorId: Id,
  action: z.string(),
  // storage_object: a refused deletion outside the app's own keys (targetId = sha256 of the key, never the key).
  targetType: z.enum(['study', 'user', 'dispute', 'participation', 'storage_object']),
  targetId: Id,
  reason: z.string(),
  createdAt: IsoDate,
});

/** Everything the requester owns, and nothing anyone else owns. Media is listed, not inlined. */
/** Token amounts in exports: exact decimal strings of base units (USDC: 6 decimals), never floats. */
export const TokenUnitsString = z.string().regex(/^(0|[1-9]\d*)$/);
const ExportAsset = { asset: z.literal('USDC'), decimals: z.literal(6), settlement: SettlementKind };
/**
 * The money of wallet-funded studies, least data (ADR 0007). Rows are strict: no provider-internal
 * fields (attempt keys, idempotency keys), and a builder's rows never carry a tester's identity,
 * wallet or participation.
 */
export const ExportPayments = z.object({
  /** Tester: rewards for their own approved work, to the wallet they froze at consent. */
  received: z.array(
    z.strictObject({ participationId: Id, studyId: Id, studyTitle: z.string(), amountUnits: TokenUnitsString, ...ExportAsset, destination: z.string(), status: SettlementStatus, signature: z.string().nullable(), authorizedAt: IsoDate, settledAt: IsoDate.nullable() }),
  ),
  /** Builder: funding transfers of their own studies, from their own wallet. */
  fundings: z.array(
    z.strictObject({ id: Id, studyId: Id, amountUnits: TokenUnitsString, ...ExportAsset, source: z.string().nullable(), status: EscrowFundingStatus, signature: z.string().nullable(), createdAt: IsoDate, confirmedAt: IsoDate.nullable() }),
  ),
  /** Builder: refunds of their own studies, to the wallet that funded them. */
  refunds: z.array(z.strictObject({ studyId: Id, amountUnits: TokenUnitsString, ...ExportAsset, destination: z.string(), status: SettlementStatus, signature: z.string().nullable(), settledAt: IsoDate.nullable() })),
  /** Builder: each approved test's reward and fee in their studies, with no tester identity or wallet. */
  studyPayments: z.array(z.strictObject({ studyId: Id, amountUnits: TokenUnitsString, feeUnits: TokenUnitsString, status: SettlementStatus, authorizedAt: IsoDate, settledAt: IsoDate.nullable() })),
});
export const BadgeId = z.enum(['first_accepted', 'reliable_tester', 'helpful_feedback', 'device_specialist']);
export const Badge = z.object({ id: BadgeId, label: z.string(), description: z.string() });
export const ExportReputation = z.object({
  points: z.number().int(),
  noCashValue: z.literal(true),
  events: z.array(z.strictObject({ participationId: Id, kind: z.enum(['accepted', 'helpful', 'reversal']), points: z.number().int(), createdAt: IsoDate })),
  badges: z.array(Badge),
  leaderboard: z.strictObject({ optedIn: z.boolean(), alias: z.string().nullable() }),
  /** Upheld fraud findings on the user's own work (the deciding admin isn't named). */
  fraudFindings: z.array(z.strictObject({ participationId: Id, reason: z.string(), createdAt: IsoDate })),
  /** Own accepted work that earned no points because it looked like self-dealing. */
  withheldPoints: z.array(z.strictObject({ participationId: Id, reason: z.string(), createdAt: IsoDate })),
});
export const ExportBundle = z.object({
  exportedAt: IsoDate,
  user: User,
  studies: z.array(Study),
  participations: z.array(Participation),
  evidence: z.array(Evidence),
  findings: z.array(Finding),
  ledger: z.array(LedgerEntry),
  disputes: z.array(Dispute),
  payments: ExportPayments,
  reputation: ExportReputation,
});
export const DeleteMeBody = z.object({ confirm: z.literal('DELETE MY ACCOUNT') });

/**
 * A submission no builder can review: the builder's account is suspended or deleted, or
 * the work has waited longer than STUCK_AFTER_DAYS. Only then may an admin decide it,
 * with a mandatory reason that is written to the audit log.
 */
export const STUCK_AFTER_DAYS = 7;
export const StuckReason = z.enum(['builder_inactive', 'overdue']);
export const StuckSubmission = z.object({
  participation: Participation,
  studyId: Id,
  studyTitle: z.string(),
  builderStatus: z.enum(['active', 'suspended', 'deleted']),
  reason: StuckReason,
  /** The study's tasks, so an admin deciding instead of the owner can read what was asked. */
  tasks: z.array(Task),
});
export type StuckSubmission = z.infer<typeof StuckSubmission>;
export const AdminDecisionBody = z.object({
  decision: z.enum(['approve', 'reject']),
  reason: z.string().trim().min(10).max(1000),
});

// ---------- wallet (devnet only) ----------
export const SOLANA_DEVNET_CHAIN = 'solana:devnet' as const;
export const SOLANA_DEVNET_GENESIS_HASH = 'EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG';
export const WALLET_NONCE_TTL_SECONDS = 300;
/**
 * The one SIWS domain: the server puts it in every sign-in message and the app derives
 * its MWA identity URI from it (not configurable, so the two can never diverge).
 */
export const DEFAULT_SIWS_DOMAIN = 'pocketqa.local';
export const appIdentityUri = (domain: string) => `https://${domain}`;

/**
 * `surface`: where the link is signed. `mwa` (default, Android) uses the fixed app identity
 * domain; `web` uses the deployment's real origin so wallets that check SIWS domains see
 * the page they are on (ADR 0005 §4).
 */
export const WalletNonceBody = z.object({ address: Base58Address, surface: z.enum(['mwa', 'web']).optional() });
/**
 * Server-issued SIWS input, bound server-side to (user, address, nonce, domain, chain,
 * issuedAt, expiresAt). The app renders it with `buildSiwsMessage` and has the wallet sign
 * that exact text via MWA `signMessages` (the wallet displays it; it performs no domain
 * check of its own). Follow-up: MWA `sign_in_payload` would need the nonce issued before
 * the address is known (ADR 0003).
 */
export const SiwsInput = z.object({
  domain: z.string().min(1).max(253),
  address: Base58Address,
  statement: z.string().max(500),
  uri: z.string().max(500),
  version: z.literal('1'),
  chainId: z.literal(SOLANA_DEVNET_CHAIN),
  nonce: z.string().regex(/^[A-Za-z0-9]{16,64}$/),
  issuedAt: IsoDate,
  expirationTime: IsoDate,
});
export type SiwsInput = z.infer<typeof SiwsInput>;
export const WalletNonceResponse = z.object({ input: SiwsInput });
export const WalletLinkBody = z.object({
  address: Base58Address,
  nonce: z.string().regex(/^[A-Za-z0-9]{16,64}$/),
  /** base64 of the exact bytes the wallet signed (SIWS message text, UTF-8). */
  signedMessage: z.string().min(1).max(4000),
  /** base64 ed25519 signature (64 bytes → 88 chars). */
  signature: z.string().length(88),
});

/**
 * Wallet-first login (ADR 0005 §2). A separate challenge from account linking: its own
 * statement ("Sign in … not a payment") and store, single use, rate limited. The wallet
 * resolves only to the account it is linked to; `newAccount` creates one only if none is.
 */
/**
 * `surface`: where the sign-in is signed. `web` (default) binds the deployment's public
 * origin, which a `solana:signIn` wallet compares with the page; `mwa` (Android) binds the
 * fixed app identity domain and URI the app declares to Mobile Wallet Adapter.
 */
export const WalletLoginChallengeBody = z.object({ address: Base58Address, surface: z.enum(['web', 'mwa']).optional() });
export const WalletLoginBody = WalletLinkBody.extend({
  newAccount: z.object({ role: SelfServeRole, displayName: DisplayName }).optional(),
});
/** `local`: an API session token. `firebase_custom_token`: exchange with the Firebase client SDK for an ID token; it is never an API bearer. */
export const WalletLoginSession = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('local'), token: z.string().min(32) }),
  z.object({ kind: z.literal('firebase_custom_token'), customToken: z.string().min(16) }),
]);
export const WalletLoginResponse = z.object({ user: User, session: WalletLoginSession });
export type WalletLoginResponse = z.infer<typeof WalletLoginResponse>;

/**
 * Devnet demo transfer: a builder may send a small devnet SOL amount to an approved
 * tester's linked wallet. It is NOT a reward payout (rewards are test credits), and the
 * UI labels it "Devnet demo · no real value". The server fixes sender, recipient and
 * amount when it creates the intent; the client only supplies the signature it claims
 * to have submitted, which stays a claim until the server verifies it on devnet.
 */
export const DEVNET_DEMO_LAMPORTS = 1_000_000;
export const TransferStatus = z.enum(['awaiting_signature', 'pending', 'confirmed', 'failed', 'expired']);
export const CreateDevnetTransferBody = z.object({ participationId: Id });
export const SubmitTransferSignatureBody = z.object({ signature: Base58Signature });
export const DevnetTransfer = z.object({
  id: Id,
  participationId: Id,
  sender: Base58Address,
  recipient: Base58Address,
  lamports: z.number().int().positive(),
  signature: Base58Signature.nullable(),
  status: TransferStatus,
  failureReason: z.string().nullable(),
  cluster: z.literal('devnet'),
  explorerUrl: z.string().url().nullable(),
  createdAt: IsoDate,
  expiresAt: IsoDate,
  verifiedAt: IsoDate.nullable(),
});
export type DevnetTransfer = z.infer<typeof DevnetTransfer>;
/** Fetched from devnet by the server (genesis-checked) right before the wallet signs. */
export const TransferBlockhash = z.object({ blockhash: Base58Address, lastValidBlockHeight: z.number().int().nonnegative() });

// ---------- reputation: points, badges, leaderboard (no cash value, not tradeable) ----------
export const PointsEventView = z.object({ kind: z.enum(['accepted', 'helpful', 'reversal']), points: z.number().int(), createdAt: IsoDate, studyTitle: z.string() });
export const LEADERBOARD_WINDOW_DAYS = 90;
/** How far the tester is toward one badge (counts only; domain `badgeProgress`). `current` never exceeds `target`. */
export const BadgeProgress = z.object({ id: BadgeId, earned: z.boolean(), current: z.number().int().min(0), target: z.number().int().positive() });
export type BadgeProgress = z.infer<typeof BadgeProgress>;
export const Reputation = z.object({
  points: z.number().int(),
  /** Points are a reputation signal only: no cash value, not tradeable, not a token. */
  noCashValue: z.literal(true),
  events: z.array(PointsEventView),
  badges: z.array(Badge),
  /**
   * Every badge, earned or not, in display order, with the count toward it. Defaults to none, so
   * an app newer than its API (before 0.6.1) still opens the screen, without the counts.
   */
  progress: z.array(BadgeProgress).default([]),
  stats: z.object({ accepted: z.number().int(), rejected: z.number().int(), decided: z.number().int(), qualityScore: z.number().int().min(0).max(100), windowDays: z.number().int() }),
  leaderboard: z.object({ optedIn: z.boolean(), alias: z.string().nullable(), rank: z.number().int().positive().nullable(), minDecided: z.number().int() }),
});
export type Reputation = z.infer<typeof Reputation>;
/** A pseudonym: letters, digits, spaces, - and _ only (so never an email or a wallet address). */
export const LeaderboardAlias = z.string().trim().min(3).max(24).regex(/^[A-Za-z0-9][A-Za-z0-9 _-]*$/);
export const LeaderboardSettingsBody = z.object({ optIn: z.boolean(), alias: LeaderboardAlias.optional() });
/** Strict: a row carries no user id, wallet, email or evidence reference. */
export const LeaderboardRow = z.strictObject({ rank: z.number().int().positive(), alias: z.string(), qualityScore: z.number().int().min(0).max(100), decided: z.number().int(), badges: z.array(BadgeId) });
/** `items` is the whole ranking, not a page: the app reads "Rank N of M" from its length. Add a `total` before paging it. */
export const Leaderboard = z.object({ items: z.array(LeaderboardRow), windowDays: z.number().int(), minDecided: z.number().int() });
export type Leaderboard = z.infer<typeof Leaderboard>;
export const FraudFindingBody = z.object({ reason: z.string().trim().min(10).max(1000) });

// ---------- demo showcase (POCKETQA_ENV=devnet with POCKETQA_DEMO_SHOWCASE=1 only) ----------
/**
 * Clearly labelled SYNTHETIC sample profiles for demos: fixtures, never accounts. No sign-in,
 * participation, ledger, earned rating or payout stands behind them, and the real GET /leaderboard
 * (and /me/reputation) never include them. Every row carries `demo: true`; no field is an earning,
 * credit or USDC amount. Off (ClientConfig.features.demoShowcase false): 404 FEATURE_UNAVAILABLE.
 */
export const DEMO_SHOWCASE_LABEL = 'Demo examples (not real users)';
/** A fixture id (demo-1 … demo-12), never a user id. */
const DemoId = z.string().regex(/^demo-[1-9]\d*$/);
/** Always starts with "Demo " (so it can't be mistaken for a real pseudonym). */
const DemoAlias = z.string().regex(/^Demo [A-Za-z0-9][A-Za-z0-9 _-]{0,23}$/);
/** Strict: a demo row carries no user id, email, wallet or evidence reference. */
export const DemoTester = z.strictObject({ id: DemoId, alias: DemoAlias, qualityScore: z.number().int().min(0).max(100), decided: z.number().int().min(0), badges: z.array(BadgeId), demo: z.literal(true) });
export type DemoTester = z.infer<typeof DemoTester>;
export const DemoBuilder = z.strictObject({ id: DemoId, alias: DemoAlias, studiesPublished: z.number().int().min(0), demo: z.literal(true) });
export type DemoBuilder = z.infer<typeof DemoBuilder>;
/** In fixture-id order: not a ranking (no rank). */
export const DemoShowcase = z.strictObject({ label: z.literal(DEMO_SHOWCASE_LABEL), testers: z.array(DemoTester), builders: z.array(DemoBuilder) });
export type DemoShowcase = z.infer<typeof DemoShowcase>;

// ---------- AI ----------
export const AiStatus = z.object({ available: z.boolean(), provider: z.string().nullable() });

// ---------- misc responses ----------
export const Ok = z.object({ ok: z.literal(true) });
export const Health = z.object({ ok: z.literal(true), contractVersion: z.string() });
const list = <T extends z.ZodTypeAny>(item: T) => z.object({ items: z.array(item) });

// ---------- cloud identity and client config (ADR 0005, v0.4.0) ----------
export const AuthMode = z.enum(['local', 'firebase']);
export type AuthMode = z.infer<typeof AuthMode>;
export const StorageMode = z.enum(['local', 'r2']);
export type StorageMode = z.infer<typeof StorageMode>;
/**
 * Public client configuration. Firebase *web* config values are public identifiers, not
 * secrets; server credentials never appear here.
 */
export const ClientConfig = z.object({
  authMode: AuthMode,
  storage: StorageMode,
  walletLogin: z.boolean(),
  /** Production turns both off: no test-credit top-up, no devnet demo transfers. */
  // `settlement` defaults to off: a server that predates escrow never enables it by omission.
  // `demoShowcase`: GET /demo/showcase is served (devnet with POCKETQA_DEMO_SHOWCASE=1 only); off by omission.
  features: z.object({ testCredits: z.boolean(), devnetTransfers: z.boolean(), settlement: SettlementMode.default('off'), demoShowcase: z.boolean().default(false) }),
  firebase: z
    .object({
      apiKey: z.string().min(1),
      authDomain: z.string().min(1),
      projectId: z.string().min(1),
      /** Set only for local emulator testing, e.g. http://127.0.0.1:9099 */
      authEmulatorUrl: z.string().url().nullable(),
      /** Google sign-in is offered (the provider is enabled for this project). Off unless the server says so. */
      googleSignIn: z.boolean().default(false),
    })
    .nullable(),
});
export type ClientConfig = z.infer<typeof ClientConfig>;
/** First sign-in with a managed identity: map it, or explicitly create the account. */
export const IdentitySessionBody = z.object({
  newAccount: z.object({ role: SelfServeRole, displayName: DisplayName }).optional(),
});
export const IdentitySessionResponse = z.object({ user: User });

// ---------- route table ----------
/**
 * `auth`: who may call. `scope` documents the ownership rule the handler enforces
 * (non-owners get 404). The Phase 3 authorization-matrix test iterates this table.
 */
/** `identity`: a verified managed identity (Firebase ID token) that may not have an account yet. */
export type RouteAuth = 'public' | 'identity' | 'user' | 'tester' | 'builder' | 'admin';
export type RouteScope =
  | 'none'
  | 'self'
  | 'study-owner'
  | 'tester-owner'
  | 'participation-party'
  | 'token-holder'
  | 'any-published';
type RouteDef = {
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  path: string;
  auth: RouteAuth;
  scope: RouteScope;
  body: z.ZodTypeAny | 'multipart' | null;
  response: z.ZodTypeAny | 'binary';
};
const r = <T extends RouteDef>(def: T) => def;

export const routes = {
  health: r({ method: 'GET', path: '/health', auth: 'public', scope: 'none', body: null, response: Health }),
  register: r({ method: 'POST', path: '/auth/register', auth: 'public', scope: 'none', body: RegisterBody, response: AuthResponse }),
  login: r({ method: 'POST', path: '/auth/login', auth: 'public', scope: 'none', body: LoginBody, response: AuthResponse }),
  logout: r({ method: 'POST', path: '/auth/logout', auth: 'user', scope: 'self', body: null, response: Ok }),
  clientConfig: r({ method: 'GET', path: '/config', auth: 'public', scope: 'none', body: null, response: ClientConfig }),
  identitySession: r({ method: 'POST', path: '/auth/identity/session', auth: 'identity', scope: 'self', body: IdentitySessionBody, response: IdentitySessionResponse }),
  me: r({ method: 'GET', path: '/me', auth: 'user', scope: 'self', body: null, response: User }),
  putDevice: r({ method: 'PUT', path: '/me/device', auth: 'tester', scope: 'self', body: DeviceProfileInput, response: User }),
  credits: r({ method: 'GET', path: '/me/credits', auth: 'user', scope: 'self', body: null, response: CreditsView }),
  topUp: r({ method: 'POST', path: '/me/credits/test-topup', auth: 'builder', scope: 'self', body: TopUpBody, response: CreditsView }),
  exportMe: r({ method: 'POST', path: '/me/export', auth: 'user', scope: 'self', body: null, response: ExportBundle }),
  deleteMe: r({ method: 'DELETE', path: '/me', auth: 'user', scope: 'self', body: DeleteMeBody, response: Ok }),
  listStudies: r({ method: 'GET', path: '/studies', auth: 'builder', scope: 'study-owner', body: null, response: list(Study) }),
  createStudy: r({ method: 'POST', path: '/studies', auth: 'builder', scope: 'self', body: CreateStudyBody, response: Study }),
  eligibleStudies: r({ method: 'GET', path: '/studies/eligible', auth: 'tester', scope: 'any-published', body: null, response: list(StudySummary) }),
  getStudy: r({ method: 'GET', path: '/studies/:id', auth: 'builder', scope: 'study-owner', body: null, response: Study }),
  getTesterStudy: r({ method: 'GET', path: '/tester/studies/:id', auth: 'tester', scope: 'any-published', body: null, response: TesterStudyView }),
  updateStudy: r({ method: 'PATCH', path: '/studies/:id', auth: 'builder', scope: 'study-owner', body: UpdateStudyBody, response: Study }),
  publishStudy: r({ method: 'POST', path: '/studies/:id/publish', auth: 'builder', scope: 'study-owner', body: null, response: Study }),
  pauseStudy: r({ method: 'POST', path: '/studies/:id/pause', auth: 'builder', scope: 'study-owner', body: null, response: Study }),
  resumeStudy: r({ method: 'POST', path: '/studies/:id/resume', auth: 'builder', scope: 'study-owner', body: null, response: Study }),
  closeStudy: r({ method: 'POST', path: '/studies/:id/close', auth: 'builder', scope: 'study-owner', body: null, response: Study }),
  studyParticipations: r({ method: 'GET', path: '/studies/:id/participations', auth: 'builder', scope: 'study-owner', body: null, response: list(Participation) }),
  studyDisputes: r({ method: 'GET', path: '/studies/:id/disputes', auth: 'builder', scope: 'study-owner', body: null, response: list(Dispute) }),
  consent: r({ method: 'POST', path: '/studies/:id/consent', auth: 'tester', scope: 'any-published', body: ConsentBody, response: Participation }),
  myParticipations: r({ method: 'GET', path: '/participations', auth: 'tester', scope: 'tester-owner', body: null, response: list(Participation) }),
  getParticipation: r({ method: 'GET', path: '/participations/:id', auth: 'user', scope: 'participation-party', body: null, response: Participation }),
  startParticipation: r({ method: 'POST', path: '/participations/:id/start', auth: 'tester', scope: 'tester-owner', body: null, response: Participation }),
  withdrawParticipation: r({ method: 'POST', path: '/participations/:id/withdraw', auth: 'tester', scope: 'tester-owner', body: WithdrawBody, response: Participation }),
  putTaskNote: r({ method: 'PUT', path: '/participations/:id/tasks/:taskId/note', auth: 'tester', scope: 'tester-owner', body: PutTaskNoteBody, response: Participation }),
  submitParticipation: r({ method: 'POST', path: '/participations/:id/submit', auth: 'tester', scope: 'tester-owner', body: null, response: Participation }),
  uploadEvidence: r({ method: 'POST', path: '/participations/:id/evidence', auth: 'tester', scope: 'tester-owner', body: 'multipart', response: Evidence }),
  listEvidence: r({ method: 'GET', path: '/participations/:id/evidence', auth: 'user', scope: 'participation-party', body: null, response: list(Evidence) }),
  playbackToken: r({ method: 'POST', path: '/evidence/:id/playback-token', auth: 'user', scope: 'participation-party', body: null, response: PlaybackToken }),
  media: r({ method: 'GET', path: '/media/:token', auth: 'public', scope: 'token-holder', body: null, response: 'binary' }),
  createUploadIntent: r({ method: 'POST', path: '/participations/:id/evidence/upload-intents', auth: 'tester', scope: 'tester-owner', body: CreateUploadIntentBody, response: UploadIntent }),
  completeUploadIntent: r({ method: 'POST', path: '/evidence/upload-intents/:id/complete', auth: 'tester', scope: 'tester-owner', body: null, response: Evidence }),
  listFindings: r({ method: 'GET', path: '/participations/:id/findings', auth: 'user', scope: 'participation-party', body: null, response: list(Finding) }),
  createFinding: r({ method: 'POST', path: '/participations/:id/findings', auth: 'builder', scope: 'study-owner', body: FindingInput, response: Finding }),
  approve: r({ method: 'POST', path: '/participations/:id/approve', auth: 'builder', scope: 'study-owner', body: ApproveBody, response: Participation }),
  reject: r({ method: 'POST', path: '/participations/:id/reject', auth: 'builder', scope: 'study-owner', body: RejectBody, response: Participation }),
  openDispute: r({ method: 'POST', path: '/disputes', auth: 'tester', scope: 'tester-owner', body: OpenDisputeBody, response: Dispute }),
  myDisputes: r({ method: 'GET', path: '/disputes', auth: 'tester', scope: 'tester-owner', body: null, response: list(Dispute) }),
  adminDisputes: r({ method: 'GET', path: '/admin/disputes', auth: 'admin', scope: 'none', body: null, response: list(Dispute) }),
  resolveDispute: r({ method: 'POST', path: '/admin/disputes/:id/resolve', auth: 'admin', scope: 'none', body: ResolveDisputeBody, response: Dispute }),
  adminStudies: r({ method: 'GET', path: '/admin/studies', auth: 'admin', scope: 'none', body: null, response: list(Study) }),
  moderateStudy: r({ method: 'POST', path: '/admin/moderation/studies/:id', auth: 'admin', scope: 'none', body: ModerationBody, response: Study }),
  moderateUser: r({ method: 'POST', path: '/admin/moderation/users/:id', auth: 'admin', scope: 'none', body: ModerationBody, response: Ok }),
  adminAudit: r({ method: 'GET', path: '/admin/audit', auth: 'admin', scope: 'none', body: null, response: list(AuditEntry) }),
  adminStuck: r({ method: 'GET', path: '/admin/stuck', auth: 'admin', scope: 'none', body: null, response: list(StuckSubmission) }),
  adminDecide: r({ method: 'POST', path: '/admin/participations/:id/decide', auth: 'admin', scope: 'none', body: AdminDecisionBody, response: Participation }),
  walletNonce: r({ method: 'POST', path: '/wallet/nonce', auth: 'user', scope: 'self', body: WalletNonceBody, response: WalletNonceResponse }),
  walletLink: r({ method: 'POST', path: '/wallet/link', auth: 'user', scope: 'self', body: WalletLinkBody, response: User }),
  walletUnlink: r({ method: 'DELETE', path: '/wallet', auth: 'user', scope: 'self', body: null, response: User }),
  walletLoginChallenge: r({ method: 'POST', path: '/auth/wallet/challenge', auth: 'public', scope: 'none', body: WalletLoginChallengeBody, response: WalletNonceResponse }),
  walletLogin: r({ method: 'POST', path: '/auth/wallet/login', auth: 'public', scope: 'none', body: WalletLoginBody, response: WalletLoginResponse }),
  createTransfer: r({ method: 'POST', path: '/devnet/transfers', auth: 'builder', scope: 'study-owner', body: CreateDevnetTransferBody, response: DevnetTransfer }),
  submitTransferSignature: r({ method: 'POST', path: '/devnet/transfers/:id/signature', auth: 'builder', scope: 'study-owner', body: SubmitTransferSignatureBody, response: DevnetTransfer }),
  getTransfer: r({ method: 'GET', path: '/devnet/transfers/:id', auth: 'user', scope: 'participation-party', body: null, response: DevnetTransfer }),
  transferBlockhash: r({ method: 'GET', path: '/devnet/transfers/:id/blockhash', auth: 'builder', scope: 'study-owner', body: null, response: TransferBlockhash }),
  participationTransfers: r({ method: 'GET', path: '/participations/:id/devnet-transfers', auth: 'user', scope: 'participation-party', body: null, response: list(DevnetTransfer) }),
  aiStatus: r({ method: 'GET', path: '/ai/status', auth: 'user', scope: 'none', body: null, response: AiStatus }),
  createEscrowFunding: r({ method: 'POST', path: '/studies/:id/escrow/fundings', auth: 'builder', scope: 'study-owner', body: null, response: EscrowFunding }),
  getEscrowFunding: r({ method: 'GET', path: '/escrow/fundings/:id', auth: 'builder', scope: 'study-owner', body: null, response: EscrowFunding }),
  simulatedWalletPayment: r({ method: 'POST', path: '/escrow/fundings/:id/simulated-wallet-payment', auth: 'builder', scope: 'study-owner', body: null, response: SimulatedWalletPayment }),
  submitFundingSignature: r({ method: 'POST', path: '/escrow/fundings/:id/signature', auth: 'builder', scope: 'study-owner', body: SubmitFundingSignatureBody, response: EscrowFunding }),
  escrowFundingTransaction: r({ method: 'GET', path: '/escrow/fundings/:id/transaction', auth: 'builder', scope: 'study-owner', body: null, response: DevnetFundingTransaction }),
  settlementApproval: r({ method: 'GET', path: '/settlements/:id/approval', auth: 'builder', scope: 'study-owner', body: null, response: SettlementApproval }),
  adminDevnetSettlement: r({ method: 'GET', path: '/admin/settlements/:id/devnet', auth: 'admin', scope: 'none', body: null, response: DevnetSettlementPlan }),
  submitSettlementApproval: r({ method: 'POST', path: '/settlements/:id/approval', auth: 'builder', scope: 'study-owner', body: SubmitSettlementApprovalBody, response: SettlementApprovalResult }),
  myPayouts: r({ method: 'GET', path: '/me/payouts', auth: 'tester', scope: 'self', body: null, response: list(Payout) }),
  adminPayouts: r({ method: 'GET', path: '/admin/payouts', auth: 'admin', scope: 'none', body: null, response: list(Payout) }),
  myReputation: r({ method: 'GET', path: '/me/reputation', auth: 'tester', scope: 'self', body: null, response: Reputation }),
  putLeaderboard: r({ method: 'PUT', path: '/me/leaderboard', auth: 'tester', scope: 'self', body: LeaderboardSettingsBody, response: Reputation }),
  leaderboard: r({ method: 'GET', path: '/leaderboard', auth: 'user', scope: 'none', body: null, response: Leaderboard }),
  /** 404 FEATURE_UNAVAILABLE unless POCKETQA_ENV=devnet with POCKETQA_DEMO_SHOWCASE=1. Public: fixtures only. */
  demoShowcase: r({ method: 'GET', path: '/demo/showcase', auth: 'public', scope: 'none', body: null, response: DemoShowcase }),
  adminFraud: r({ method: 'POST', path: '/admin/participations/:id/fraud', auth: 'admin', scope: 'none', body: FraudFindingBody, response: Ok }),
} as const;
export type RouteName = keyof typeof routes;

export function buildPath(path: string, params: Record<string, string> = {}): string {
  return path.replace(/:([A-Za-z]+)/g, (_, key: string) => {
    const value = params[key];
    if (value === undefined) throw new Error(`missing path param ${key}`);
    return encodeURIComponent(value);
  });
}

export function redactPath(url: string): string {
  for (const prefix of REDACTED_PATH_PREFIXES) {
    const at = url.indexOf(prefix);
    if (at !== -1) return url.slice(0, at + prefix.length) + '[redacted]';
  }
  return url;
}
