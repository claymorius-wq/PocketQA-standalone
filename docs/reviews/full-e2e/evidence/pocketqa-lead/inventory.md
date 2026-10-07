# Inventory at a9d0e7e (code = 7beaad5 + auth UI), read 2026-10-06
## App screens (expo-router, 23)
/
/admin-settings
/audit
/budget
/builder-settings
/builder/new-study
/builder/review/[id]
/builder/study/[id]
/credits
/discover
/disputes
/leaderboard
/moderation
/participation/[id]
/reputation
/settings
/sign-in
/sign-up
/stuck
/studies
/study/[id]
/welcome
/work
## API routes (packages/contracts routes, 72)
GET /health
POST /auth/register
POST /auth/login
POST /auth/logout
GET /config
POST /auth/identity/session
GET /me
PUT /me/device
GET /me/credits
POST /me/credits/test-topup
POST /me/export
DELETE /me
GET /studies
POST /studies
GET /studies/eligible
GET /studies/:id
GET /tester/studies/:id
PATCH /studies/:id
POST /studies/:id/publish
POST /studies/:id/pause
POST /studies/:id/resume
POST /studies/:id/close
GET /studies/:id/participations
GET /studies/:id/disputes
POST /studies/:id/consent
GET /participations
GET /participations/:id
POST /participations/:id/start
POST /participations/:id/withdraw
PUT /participations/:id/tasks/:taskId/note
POST /participations/:id/submit
POST /participations/:id/evidence
GET /participations/:id/evidence
POST /evidence/:id/playback-token
GET /media/:token
POST /participations/:id/evidence/upload-intents
POST /evidence/upload-intents/:id/complete
GET /participations/:id/findings
POST /participations/:id/findings
POST /participations/:id/approve
POST /participations/:id/reject
POST /disputes
GET /disputes
GET /admin/disputes
POST /admin/disputes/:id/resolve
GET /admin/studies
POST /admin/moderation/studies/:id
POST /admin/moderation/users/:id
GET /admin/audit
GET /admin/stuck
POST /admin/participations/:id/decide
POST /wallet/nonce
POST /wallet/link
DELETE /wallet
POST /auth/wallet/challenge
POST /auth/wallet/login
POST /devnet/transfers
POST /devnet/transfers/:id/signature
GET /devnet/transfers/:id
GET /devnet/transfers/:id/blockhash
GET /participations/:id/devnet-transfers
GET /ai/status
POST /studies/:id/escrow/fundings
GET /escrow/fundings/:id
POST /escrow/fundings/:id/simulated-wallet-payment
POST /escrow/fundings/:id/signature
GET /me/payouts
GET /admin/payouts
GET /me/reputation
PUT /me/leaderboard
GET /leaderboard
POST /admin/participations/:id/fraud
## Live /api/config
{"authMode": "firebase", "storage": "r2", "walletLogin": false, "features": {"testCredits": true, "devnetTransfers": false, "settlement": "simulated"}, "firebase": {"authDomain": "pocketqa-optijara.firebaseapp.com", "projectId": "pocketqa-optijara", "authEmulatorUrl": null, "googleSignIn": true}}
