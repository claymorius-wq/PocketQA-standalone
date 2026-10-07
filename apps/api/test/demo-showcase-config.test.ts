import { describe, expect, it } from 'vitest';
import { ClientConfig } from '@pocket-qa/contracts';
import { accountHandlers } from '../src/handlers/account';

// The demo showcase flag the app reads from /config (features.demoShowcase): on only where the
// server serves GET /demo/showcase (POCKETQA_ENV=devnet with POCKETQA_DEMO_SHOWCASE=1); off
// everywhere else, and off by omission from a server that predates it.
const base = { authMode: 'local', storage: 'local', walletLogin: false, features: { testCredits: false, devnetTransfers: false, settlement: 'off' }, firebase: null };
const configOf = (devnet: unknown) => ClientConfig.parse(accountHandlers.clientConfig({ deps: { config: { ...base, devnet } } } as never));

describe('/config features.demoShowcase', () => {
  it('on only with the devnet demo showcase on', () => {
    expect(configOf({ demoShowcase: true }).features.demoShowcase).toBe(true);
    expect(configOf({ demoShowcase: false }).features.demoShowcase).toBe(false);
    expect(configOf(null).features.demoShowcase).toBe(false);
    expect(configOf(undefined).features.demoShowcase).toBe(false);
  });
  it('a server that predates the flag reads as off', () => {
    expect(ClientConfig.parse({ ...base }).features.demoShowcase).toBe(false);
  });
});
