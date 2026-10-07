// Dual-backend regression (plan §10): the SQLite suite test/reputation.test.ts, run unchanged on Firestore.
process.env.PQA_TEST_BACKEND = 'firestore';
await import('../reputation.test');
export {};
