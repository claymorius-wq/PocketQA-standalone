# pqa-qa security verdict, cloud increment 2, round 1 (verbatim pane output; frozen tree 8acb4fc6)

⏺ I used only Read; Grep and Glob weren't available. I modified nothing, used no subagents, and opened no .preview*,
  preview-data, .env* or credential files. The replay, burn and hijack controls are correct, but one P2 blocks: a
  single signature on a phishing page can take over a wallet-login account.

  What holds up
  - Separate challenges: wallet-login challenges live in their own table with their own statement ("Sign in to Pocket
    QA … not a payment and sends nothing"). The server rebuilds the exact signed message from its own record
    (domain/wallet.ts:25-43, :52-65).
  - Cross-purpose replay: a link nonce used for login is refused, and so is the reverse (test
    wallet-login.test.ts:91-99).
  - Single use and expiry: the challenge is burnt inside the transaction whatever the outcome (walletLogin.ts:80-94).
    Replayed, tampered, wrong-key, wrong-address and expired attempts all fail, and the challenge stays burnt (:62-89).
  - No hijack: a linked wallet resolves only to its own account, and newAccount is ignored for it
    (walletLogin.ts:96-100, test :101-110). New accounts are created only on explicit request, with a tester or builder
    role.
  - Custom tokens:
    - The custom token is minted for the account's existing Firebase UID, or a fresh identities(firebase, userId) row
      with has_recovery=0.
    - It is never accepted as a bearer token; only the exchanged ID token works (:141-154).
    - The suspension and role rules are unchanged.
  - Last sign-in method: a wallet-only account can't unlink its wallet; an account with a password or a verified
    recovery identity still can (wallet.ts:159-169).
  - Shared demo: the preview pins POCKETQA_WALLET_LOGIN=0 (start.sh:29), the config refuses wallet login together with
    the shared demo (config.ts:97-99), and the gate blocks both wallet-login routes (gate-server.mjs:66).
  - Account enumeration: a 404 for an unlinked wallet is returned only after a valid signature by that key, so third
    parties learn nothing they couldn't already find out. That's acceptable.
  - Evidence: pnpm verify EXIT=0, and mutations W1–W5 are each caught.

  Findings

  1. [P2] One signature on a phishing page gives full account takeover, because no wallet can check the sign-in domain.
     walletLogin.ts:50-61, config.ts:106-107 (siwsDomain: DEFAULT_SIWS_DOMAIN = pocketqa.local); ADR 0005 §2 and §4
     (web uses solana:signMessage)
     - The challenge binds the domain pocketqa.local, which matches no real origin, and the planned clients sign with
       plain signMessage / MWA signMessages, where the wallet doesn't compare domain to origin.
     - Scenario:
       i. A malicious site asks the public API for a login challenge for the victim's address. /auth/wallet/challenge
          is public and needs no proof.
       ii. It shows the victim the challenge text, which honestly reads "Sign in to Pocket QA …".
       iii. The victim signs it there, and the site submits it to /auth/wallet/login.
       iv. The attacker gets the victim's session, or in firebase mode a custom token for the victim's UID: their
           studies, private evidence playback, credits and admin powers if any.
     - For linking, the same weakness only attached a devnet wallet. For login it's a full takeover, and the ADR's
       "domain bound" control isn't verifiable by any wallet.
     - Fix (pick one, before wallet login is enabled anywhere):
       - Domain-checked sign-in: make the SIWS domain and uri per deployment, set to the real public origin (validated
         config, the same value used for the MWA identity URI). Clients must use solana:signIn (Wallet Standard) or MWA
         sign_in_payload, so the wallet itself refuses a mismatched origin. Have the server parse and check the SIWS
         fields it receives, and test a wrong-domain signature.
       - Or a documented accepted risk: record the phishing risk in ADR 0005 as accepted by Hamza, with mitigations: no
         wallet login for admin accounts, a short challenge lifetime, a "sign only on <origin>" statement, and wallet
         login kept off in production until the domain-checked flow exists.
  2. [P3] The per-address challenge limit lets anyone lock a victim out of wallet login. walletLogin.ts:10, :18-22:
     challenges are limited to 5 per minute per address, counted when issued, and anyone can request challenges for any
     address. An attacker taking 5 a minute keeps the victim's wallet sign-in at 429 indefinitely.
     - Fix: Key the address limit by address plus client, or count only failed /auth/wallet/login verifications per
       address. Keep the per-client cap on issuing challenges.
  3. [P3] The new Firebase identity row is written outside the login transaction. walletLogin.ts:34-38: in firebase
     mode the identities insert for a wallet-only account happens after the transaction.
     - Two concurrent first logins can produce a 409 for one of them.
     - A failed createCustomToken leaves the row behind. That's harmless, but the response is a 500.
     - Fix: Insert or select the identity inside the login transaction, and map a constraint race to "retry".
  4. [P3] Admin accounts can sign in with just a wallet signature. Wallet login lets any account with a linked wallet
     sign in, including admins, which makes a single wallet key, or the phishing path above, enough to get admin
     access.
     - Fix: Refuse wallet login for role = admin (they sign in with email or Google), or require re-authentication for
       admin actions.

  VERDICT: CHANGES_REQUIRED
