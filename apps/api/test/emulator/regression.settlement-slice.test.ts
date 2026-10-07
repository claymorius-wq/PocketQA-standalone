// Dual-backend regression (plan §10): the SQLite suite test/settlement-slice.test.ts, run unchanged on Firestore.
process.env.PQA_TEST_BACKEND = 'firestore';
await import('../settlement-slice.test');
export {};
