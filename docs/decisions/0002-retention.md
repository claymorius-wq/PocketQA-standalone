# ADR 0002: Account deletion and data retention

Status: accepted for the local MVP (2026-10-02). The consent and retention wording still needs Hamza's review; this is plan §11, an open item.

When an account is deleted with `DELETE /me` and the body `{"confirm":"DELETE MY ACCOUNT"}`, the API:

- **Deletes:**
  - every evidence file the user recorded, and every evidence file inside studies the user owns, along with their rows;
  - task notes;
  - sessions and the user's playback tokens;
  - devnet demo transfers where the user is the builder or the tester. These rows hold wallet addresses, which are on-chain pseudonyms, and carry no ledger value;
  - the wallet link and any wallet nonces;
  - the device profile;
  - the password hash.
- **Anonymizes the user row:**
  - the email becomes `deleted-<id>@deleted.invalid`;
  - the name becomes "Deleted user";
  - the status becomes `deleted`.
- **Scrubs free text the user wrote or that is about them:**
  - the reason on disputes they opened becomes `[deleted]`;
  - admin audit reasons whose target is the user become `[redacted on account deletion]`. The audit action, actor and timestamp stay.
- **Withdraws** the user's in-flight participations (consented or in progress).
- **Kept as the builder's work product:** findings a builder wrote about a deleted tester's participation stay, so the builder's study history remains intact. Any evidence link on them is cleared.
- **Keeps, as the retention exception,** the test-credit ledger postings. They stay keyed by the opaque user id. Deleting them would corrupt other parties' balances and study budgets. They contain no personal data. Approved and rejected participation rows are kept for the builder's study history, but with the decision reason cleared.
- **Refuses deletion** while any of the following is true, until the user settles them:
  - the user has `submitted` or `disputed` work;
  - the user is a builder with `published` or `paused` studies.

Export (`POST /me/export`) contains only the requester's own data:

- their user record;
- studies they own;
- their own participations, and the evidence metadata for those participations;
- findings they wrote or that concern their participations;
- their ledger entries;
- disputes they opened.

Media bytes aren't inlined in the export; the evidence items are listed by metadata only.

## Known limitation (MVP)

If a builder is suspended or stops responding, testers with `submitted` work can't delete their accounts until that work is reviewed. Admins can suspend the builder, which hides the builder's studies from new testers, but they have no tool to force a decision. This limitation is recorded for Phase 7 follow-up.
