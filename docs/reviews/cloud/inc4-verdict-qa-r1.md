# pqa-qa verdict, cloud increment 4, round 1 (verbatim pane output; frozen tree 0005e125)

⏺ I used only Read; Grep and Glob weren't available. I modified nothing, used no subagents, and opened no .preview*,
  preview-data, .env.local or credential files. Most of the client work is correct, but two P2s block: web wallet
  linking now reaches the public shared demo, and the sign-in footer makes a false privacy claim on cloud deployments.

  What holds up
  - Increment-2 wallet conditions — met:
    - Login uses solana:signIn with exactly the server's challenge (standard.ts:39-46).
    - A wallet without signIn gets an honest WalletUnsupported, with no signMessage fallback.
    - A signature from a different account than the one connected is refused.
    - The challenge is bound to the deployment's origin (localhost:8090 in the end-to-end test).
    - signMessage is used only for linking (link.web.ts). The Jest and Playwright tests assert signMessage is never
      called during login.
  - Tokens:
    - The custom token is exchanged with signInWithCustomToken and never sent as a bearer; wallet-login calls use
      token: null (walletLogin.web.ts:21-26, SessionProvider.tsx:112-120).
    - The bearer is always the latest ID token from onIdTokenChanged.
    - The storage PUT carries no bearer (increment 3).
    - The Firebase client is configured only from the public /config, with no bundled secrets, and .env.example has
      empty values.
  - Server: the reordered identitySession checks custom, unverified and unsupported sign-ins before saying "no account"
    (account.ts:93-100). There's a dedicated PROVIDER_UNSUPPORTED code, and the change only affects which error
    message is returned.
  - Transfers: devnet transfer signing stays Android-only on every platform (capability.ts:37-39, TransferCard.tsx:49,
    :73-79).
  - Deploy doc: it truthfully says nothing is provisioned, lists the gates, and keeps wallet login off pending Hamza's
    acceptance.
  - Theme test: the baseline file shows the same failure on clean origin/main, so it's fair to call it pre-existing.
  - Evidence: pnpm verify EXIT=0, Playwright 9/10 (the only failure is the pre-existing theme test), and the Firebase
    end-to-end run 2/2.

  Findings

  1. [P2] Web wallet linking now reaches the public shared demo. apps/mobile/src/lib/capability.ts:28-32,
     src/wallet/WalletSection.tsx:35-36, scripts/preview/gate-server.mjs:61-68
     - walletCapability('web') now reports available whenever a Wallet Standard extension is installed. The preview
       build doesn't hide it, and the gate doesn't block POST /wallet/nonce, POST /wallet/link or DELETE /wallet.
     - Scenario: after this merges and the preview is rebuilt, a public visitor with Phantom installed signs in as the
       shared demo tester and links their real wallet address. That address is a cross-chain identifier tied to their
       real history, and it becomes visible to every viewer of that demo account and to the shared builder, for example
       as a transfer recipient. Other viewers can also unlink or replace it.
     - This is the same class of problem as the convenience-round P2 about uploads on shared accounts. Before this
       increment, wallet linking simply wasn't available on the web.
     - Fix:
       - In the gate's PREVIEW_BLOCKED_API, block POST /wallet/nonce, POST /wallet/link, DELETE /wallet, and preferably
         POST /devnet/transfers.
       - In PREVIEW_BUILD, show the wallet section as "Not available in the shared preview".
       - Add a gate test and a browser-smoke check.
  2. [P2] The sign-in footer claims "data stays on this machine" on cloud deployments.
     apps/mobile/app/(auth)/sign-in.tsx:155-157: outside the preview, the footer always reads "Local build · data stays
     on this machine", including firebase/r2 deployments where accounts live in Firebase and evidence in R2.
     - That's a false privacy claim, which is exactly what this project has refused before.
     - Fix: Derive the footer from /config. For local auth plus local storage, keep today's text. Otherwise say
       something accurate, such as "Accounts are managed by Firebase; evidence is stored privately in cloud storage".
       Add a test for each mode.
  3. [P3] A network error at startup signs the user out. SessionProvider.tsx:80: resolveManaged().catch(() => clear())
     signs Firebase out on any error, including OFFLINE, so a user opening the app offline loses their saved session.
     - Fix: Call clear() only for UNAUTHENTICATED. On other errors, keep the Firebase session and show the offline
       state.
  4. [P3] An expired ID token logs the user out instead of refreshing. client.ts calls onUnauthenticated, which runs
     clear(), on any 401. If an ID token expires while the tab sleeps, the first request after waking signs the user
     out of Firebase entirely.
     - Fix: In firebase mode, on a 401 call getIdToken(true) and retry once. Sign out only if the retry also gets 401.
  5. [P3] The web Firebase session is stored more persistently than the old one. The Firebase SDK's default web
     persistence is long-lived IndexedDB, holding the refresh token and readable by any script on the origin. The
     previous local mode used sessionStorage, which is cleared when the tab closes.
     - Fix: Choose and document the persistence on purpose, for example browserSessionPersistence for shared computers,
       or note the trade-off in ADR 0005.
  6. [P3] Linking on the web will trigger domain warnings. link.web.ts:21-23: the link message is SIWS-formatted with
     the domain pocketqa.local, signed through signMessage on the real web origin. Wallets that detect SIWS-looking
     text (Phantom does) will warn about a domain mismatch, which teaches users to click through exactly the warning
     that protects wallet login.
     - Fix: Bind the link message's domain and URI to POCKETQA_PUBLIC_ORIGIN on web as well, or use a non-SIWS link
       statement. Verify with a real wallet at the gate.
  7. [P3] Smaller items:
     - Firebase errors shown raw: sign-in.tsx:62 displays raw Firebase error text, which can reveal account existence
       (for example user-not-found). Map Firebase error codes to a generic "Email or password is incorrect".
     - Wallet choice: walletLoginFlow and linkWalletWithMwa silently use the first installed wallet. Add a chooser when
       more than one is installed.
     - API CORS: the deploy doc doesn't mention that the API's CORS allows only localhost origins (app.ts:49, :56). A
       hosted web app must either reach the API same-origin through the proxy or have CORS configured for its origin.
     - Sign-up details discarded: firebase sign-up drops the role and display name the user typed, then asks for them
       again in "Finish your account". Either carry them over or don't ask for them at sign-up.

  VERDICT: CHANGES_REQUIRED
