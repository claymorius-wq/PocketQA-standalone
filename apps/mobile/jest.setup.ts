import { setUpTests } from 'react-native-reanimated';

// Reanimated's documented Jest setup: animated-style matchers and a fake frame timer.
setUpTests();

// expo-crypto's native module is absent under jest (randomUUID returns undefined): back it with
// Node's, so idempotency keys (src/api/client.ts) are real random UUIDs in tests too.
jest.mock('expo-crypto', () => ({ ...jest.requireActual('expo-crypto'), randomUUID: () => jest.requireActual('node:crypto').randomUUID() }));
