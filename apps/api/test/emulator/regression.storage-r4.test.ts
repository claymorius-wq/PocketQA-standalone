// Dual-backend regression (plan §10): the SQLite suite test/storage-r4.test.ts, run unchanged on Firestore.
process.env.PQA_TEST_BACKEND = 'firestore';
await import('../storage-r4.test');
export {};
