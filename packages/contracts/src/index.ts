// Pocket QA API contract (lead-authored foundation; backend owns changes after the
// foundation commit, and every change needs an entry in docs/decisions/contract-changes.md).
// All request and response bodies are validated with these schemas on both sides.
import { z } from 'zod';

export * from './siws';

export const CONTRACT_VERSION = '0.2.0';
export const API_DEFAULT_PORT = 8787;
export const API_DEFAULT_BASE_URL = `http://127.0.0.1:${API_DEFAULT_PORT}`;
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
  rewardCredits: PositiveCredits,
  slots: z.number().int().min(1).max(500),
  consentText: z.string().trim().min(20).max(5000),
});
export const CreateStudyBody = StudyInput;
/** Only drafts are editable. */
export const UpdateStudyBody = StudyInput.partial();

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

export const ModerationState = z.enum(['ok', 'suspended']);
export const Study = StudyInput.omit({ tasks: true }).extend({
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
  rewardCredits: PositiveCredits,
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
  rewardCredits: PositiveCredits,
  taskNotes: z.array(TaskNote),
});
export type Participation = z.infer<typeof Participation>;

export const ConsentBody = z.object({ consentVersion: z.number().int().positive(), accepted: z.literal(true) });
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

/** Bound to one evidence item and the requesting user; single resource, short-lived. */
export const PlaybackToken = z.object({ token: z.string().min(32), expiresAt: IsoDate });

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

export const ApproveBody = z.object({ note: z.string().trim().max(1000).optional() });
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
  targetType: z.enum(['study', 'user', 'dispute']),
  targetId: Id,
  reason: z.string(),
  createdAt: IsoDate,
});

/** Everything the requester owns, and nothing anyone else owns. Media is listed, not inlined. */
export const ExportBundle = z.object({
  exportedAt: IsoDate,
  user: User,
  studies: z.array(Study),
  participations: z.array(Participation),
  evidence: z.array(Evidence),
  findings: z.array(Finding),
  ledger: z.array(LedgerEntry),
  disputes: z.array(Dispute),
});
export const DeleteMeBody = z.object({ confirm: z.literal('DELETE MY ACCOUNT') });

// ---------- wallet (devnet only) ----------
export const SOLANA_DEVNET_CHAIN = 'solana:devnet' as const;
export const SOLANA_DEVNET_GENESIS_HASH = 'EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG';
export const WALLET_NONCE_TTL_SECONDS = 300;

export const WalletNonceBody = z.object({ address: Base58Address });
/**
 * Server-issued SIWS input, bound server-side to (user, address, nonce, domain, chain,
 * issuedAt, expiresAt). The app passes it to MWA `signIn` (preferred: the wallet shows
 * the domain) or renders it with `buildSiwsMessage` for `signMessages`.
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

// ---------- AI ----------
export const AiStatus = z.object({ available: z.boolean(), provider: z.string().nullable() });

// ---------- misc responses ----------
export const Ok = z.object({ ok: z.literal(true) });
export const Health = z.object({ ok: z.literal(true), contractVersion: z.string() });
const list = <T extends z.ZodTypeAny>(item: T) => z.object({ items: z.array(item) });

// ---------- route table ----------
/**
 * `auth`: who may call. `scope` documents the ownership rule the handler enforces
 * (non-owners get 404). The Phase 3 authorization-matrix test iterates this table.
 */
export type RouteAuth = 'public' | 'user' | 'tester' | 'builder' | 'admin';
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
  me: r({ method: 'GET', path: '/me', auth: 'user', scope: 'self', body: null, response: User }),
  putDevice: r({ method: 'PUT', path: '/me/device', auth: 'tester', scope: 'self', body: DeviceProfile, response: User }),
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
  walletNonce: r({ method: 'POST', path: '/wallet/nonce', auth: 'user', scope: 'self', body: WalletNonceBody, response: WalletNonceResponse }),
  walletLink: r({ method: 'POST', path: '/wallet/link', auth: 'user', scope: 'self', body: WalletLinkBody, response: User }),
  walletUnlink: r({ method: 'DELETE', path: '/wallet', auth: 'user', scope: 'self', body: null, response: User }),
  createTransfer: r({ method: 'POST', path: '/devnet/transfers', auth: 'builder', scope: 'study-owner', body: CreateDevnetTransferBody, response: DevnetTransfer }),
  submitTransferSignature: r({ method: 'POST', path: '/devnet/transfers/:id/signature', auth: 'builder', scope: 'study-owner', body: SubmitTransferSignatureBody, response: DevnetTransfer }),
  getTransfer: r({ method: 'GET', path: '/devnet/transfers/:id', auth: 'user', scope: 'participation-party', body: null, response: DevnetTransfer }),
  aiStatus: r({ method: 'GET', path: '/ai/status', auth: 'user', scope: 'none', body: null, response: AiStatus }),
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
