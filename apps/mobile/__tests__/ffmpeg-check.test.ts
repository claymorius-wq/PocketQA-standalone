import { decodeProblems, knownWarnings } from '../e2e/ffmpegCheck';

// The browser test's decode gate (pqa-qa screen-recording r1 P2-2): only the exact null-muxer DTS
// warning is tolerated; everything else still fails.
const KNOWN = '[null @ 0x7f8a1c004c80] Application provided invalid, non monotonically increasing dts to muxer in stream 0: 2 >= 2';

describe('decodeProblems', () => {
  it('a clean decode passes', () => {
    expect(decodeProblems(0, '')).toEqual([]);
  });
  it('the known null-muxer DTS line alone (any stream, any count) passes', () => {
    expect(decodeProblems(0, `${KNOWN}\n${KNOWN.replace('stream 0: 2 >= 2', 'stream 1: 960 >= 940')}\n`)).toEqual([]);
    expect(knownWarnings(`${KNOWN}\n${KNOWN}`)).toBe(2);
  });
  it.each([
    ['a decoder error', '[vp9 @ 0x7f8a1c004c80] Failed to decode frame'],
    ['a demuxer error', '[matroska,webm @ 0x7f8a1c004c80] Read error at pos. 1234'],
    ['an invalid data error', 'Error while decoding stream #0:1: Invalid data found when processing input'],
    ['the same text from another muxer', KNOWN.replace('[null @', '[webm @')],
    ['the known line with anything appended', `${KNOWN} (and more)`],
    ['a near-miss wording', KNOWN.replace('non monotonically', 'non-monotonically')],
  ])('%s fails, even next to the known line', (_, line) => {
    expect(decodeProblems(0, `${KNOWN}\n${line}`)).toEqual([line]);
  });
  it('a nonzero exit fails even with only the known line', () => {
    expect(decodeProblems(1, KNOWN)).toEqual(['ffmpeg exited with 1']);
    expect(decodeProblems(null, '')).toEqual(['ffmpeg exited with null']);
  });
});
