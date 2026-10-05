/**
 * The decode gate for recordings checked with `ffmpeg -v error -i <file> -f null -`.
 *
 * One message is known and harmless: the NULL muxer (the output side of the check, which writes
 * nothing) sometimes reports MediaRecorder WebM timestamps as "non monotonically increasing dts".
 * pqa-qa saw it intermittently (r1), with the file decoding fully, and its own 12 s recording had
 * A/V end pts of 11.999 s and 12.101 s. It concerns muxing timestamps into the discarded output, not
 * decoding. Only that exact line, from the null muxer, is ignored. Any other stderr line, any
 * decoder or demuxer error, and any nonzero exit is a problem.
 */
export const KNOWN_NULL_MUXER_DTS = /^\[null @ 0x[0-9a-f]+\] Application provided invalid, non monotonically increasing dts to muxer in stream \d+: \d+ >= \d+$/;

export function decodeProblems(status: number | null, stderr: string): string[] {
  const problems: string[] = [];
  if (status !== 0) problems.push(`ffmpeg exited with ${status}`);
  for (const line of stderr.split('\n').map((l) => l.trim()).filter(Boolean)) {
    if (!KNOWN_NULL_MUXER_DTS.test(line)) problems.push(line);
  }
  return problems;
}

export const knownWarnings = (stderr: string) => stderr.split('\n').filter((l) => KNOWN_NULL_MUXER_DTS.test(l.trim())).length;
