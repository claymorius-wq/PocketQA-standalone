// Dual-backend regression (plan §10): the SQLite suite test/authz.matrix.test.ts, run unchanged on Firestore.
process.env.PQA_TEST_BACKEND = 'firestore';
await import('../authz.matrix.test');
export {};
