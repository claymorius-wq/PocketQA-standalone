import { reportSignature, SentNotRecordedError } from '../src/wallet/reportSignature';

// Review r1 P3: once the wallet has sent the transaction, a failed report must not read as
// "nothing happened". It is retried, then the error names the sent signature.
const SIG = '5'.repeat(40) + 'abcd';
const noWait = () => 0;

describe('reportSignature', () => {
  it('retries a failed report and succeeds', async () => {
    let calls = 0;
    await reportSignature(async () => { calls += 1; if (calls < 3) throw new Error('network'); }, SIG, 3, noWait);
    expect(calls).toBe(3);
  });

  it('after the last try, says the wallet did send it and to check the explorer', async () => {
    let calls = 0;
    const err = await reportSignature(async () => { calls += 1; throw new Error('network'); }, SIG, 3, noWait).catch((e: Error) => e);
    expect(calls).toBe(3);
    expect(err).toBeInstanceOf(SentNotRecordedError);
    expect((err as Error).message).toMatch(/wallet sent the transaction/);
    expect((err as Error).message).toMatch(/5555…abcd/);
    expect((err as Error).message).toMatch(/explorer before starting another/);
    expect((err as Error).message).not.toMatch(/Nothing was sent/);
  });
});
