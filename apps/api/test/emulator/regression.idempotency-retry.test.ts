// Dual-backend regression (plan §10): the SQLite suite test/idempotency-retry.test.ts, run unchanged on Firestore.
process.env.PQA_TEST_BACKEND = 'firestore';
await import('../idempotency-retry.test');
export {};
