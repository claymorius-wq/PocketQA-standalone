# pqa-qa security verdict, cloud increment 2, round 2 (verbatim pane output; frozen tree 59b0669f)


  regressions. The remaining phishing risk is documented and wallet login is off by default, which is adequate here,
  provided increment 4 meets the conditions below.

  Round-1 findings

  1. [P2] Phishing to account takeover — FIXED for this increment.
     - Origin binding: the challenge's SIWS domain and uri are now the deployment's real public origin
       (walletLogin.ts:48-62), and the statement names it ("Only sign this on <host>").
     - Origin validation: POCKETQA_PUBLIC_ORIGIN is required when wallet login is on and must be an exact origin: https
       only (http only for localhost), no credentials, no wildcard, no path (config.ts:105-118).
     - Exact match: the server still requires the signed text to match its own record, so a signature over any other
       domain fails.
     - What this enables: a wallet using solana:signIn can now compare the domain with the page asking for the
       signature, which wasn't possible with pocketqa.local.
     - What the server can't control: whether the client uses signIn or raw signMessage. ADR 0005 §2 (:40-47) states
       this as a residual risk, keeps wallet login off by default, requires a verified production origin and
       real-wallet testing before public use, and leaves Android on linking only until a verified MWA sign_in_payload
       flow exists. For an API-only increment with the feature off, that's adequate. Carry-forward conditions are in
       finding 3.
  2. [P3] Address limit lockout — FIXED. The address limit is now keyed by address plus client (walletLogin.ts:12,
     :22), so a third party can't exhaust the owner's quota, and the per-client cap of 30 per minute stays.
  3. [P3] Identity row outside the transaction — FIXED. firebaseSubject now runs inside the login transaction (:32-38,
     :106, :130). Only createCustomToken runs after commit; if it fails, the result is a harmless leftover row and
     a 500.
  4. [P3] Admin wallet login — FIXED. A wallet linked to an admin is refused with 403 after the challenge is burnt
     (:100-104).

  Regression check
  - Single-use burn, expiry, the separate link and login stores, exact-message checks, "no hijack" and "create only on
    request" are unchanged.
  - The last-method rule, the custom-token-is-not-a-bearer rule, the shared-demo pinning and the gate blocks are
    unchanged.
  - inc2-pnpm-verify.txt shows EXIT=0.

  New findings (P3, non-blocking)

  1. [P3] ADR 0005 contradicts itself about how the web client signs. §2 (:43) requires the web client to use
     solana:signIn and never raw signMessage for login, but §4 (:63) still says the web connector uses
     "standard:connect and solana:signMessage only".
     - Fix: Change §4: solana:signIn for login, and signMessage only for account linking, if at all.
  2. [P3] The ADR doesn't say who accepted the residual risk. "Accepted for devnet testing" (:45) doesn't name the
     person.
     - Fix: Record Hamza's explicit acceptance, as ADR 0004 did for the preview convenience, before
       POCKETQA_WALLET_LOGIN=1 is set anywhere other than localhost.
  3. [P3] Conditions to verify in increment 4. Wallet login must not be enabled publicly until all of these hold:
     - The web client's tests assert that login calls solana:signIn with the server's challenge fields, and never
       signMessage.
     - A wallet that doesn't support signIn gets an honest "wallet login not supported", not a fallback to signMessage.
     - A real-wallet test signs on the configured origin, and the same wallet refuses or warns when signing on a
       different origin.
     - Fix: Put these in the increment 4 candidate as acceptance items.

  VERDICT: APPROVE
