#!/usr/bin/env python3
"""Evidence gate for a native screen + voice recording (pqa-qa r1 P2-B). Emulator evidence only.

PASS needs ALL of:
  - exactly one video stream (h264) and one audio stream (aac), read per stream with ffprobe;
  - |audio duration - video duration| <= 1.0 s;
  - no audio timestamp gaps: the samples actually in the track must account for its duration
    within 0.5 s (an overrun gap is spanned by the track's duration but holds no samples);
  - every 5 s window of the decoded audio, with gaps filled as silence (aresample=async=1), across
    the WHOLE clip, above -40 dBFS RMS. On the
    emulator the microphone carries the HAL's synthetic 220 Hz tone (see android-cross-app/probe.txt),
    so a quiet window means the voice was lost there. Windows are listed, so a gap shows where.
A clip a scenario ends on purpose by taking the microphone away (call, appops) may end with a few
silent seconds before the app stops it; --allow-silent-tail N accepts quiet windows that start within
the last N s. Without the flag, no quiet window is accepted anywhere.

--structure-only skips the signal (RMS) check, for inputs known to be near-silence (codec noise floor) (emulator
-no-audio): it proves the audio track is continuous and covers the video, NOT that a voice or any
signal was captured. Its verdict line says so.

Usage: check-voice.py <clip.mp4> [--allow-silent-tail 4] [--structure-only]
"""
import json, math, struct, subprocess, sys

WINDOW_S = 5.0
FLOOR_DB = -40.0
MAX_AV_GAP_S = 1.0
MAX_TS_GAP_S = 0.5


def probe(path):
    out = subprocess.run(['ffprobe', '-v', 'error', '-show_entries', 'stream=index,codec_type,codec_name,duration:format=duration', '-of', 'json', path], capture_output=True, text=True, check=True).stdout
    return json.loads(out)


def pcm(path, gaps_as_silence):
    af = ['-af', 'aresample=async=1:first_pts=0'] if gaps_as_silence else []
    raw = subprocess.run(['ffmpeg', '-v', 'error', '-i', path, '-map', '0:a:0', *af, '-ac', '1', '-ar', '8000', '-f', 's16le', '-'], capture_output=True, check=True).stdout
    n = len(raw) // 2
    return struct.unpack('<%dh' % n, raw[: n * 2])


def windows(samples):
    per = int(8000 * WINDOW_S)
    out = []
    for i in range(0, len(samples), per):
        w = samples[i : i + per]
        if not w:
            break
        rms = math.sqrt(sum(x * x for x in w) / len(w))
        out.append((i / 8000, len(w) / 8000, -120.0 if rms == 0 else 20 * math.log10(rms / 32768)))
    return out


def main():
    args = sys.argv[1:]
    if not args:
        print(__doc__)
        return 2
    path = args[0]
    tail = float(args[args.index('--allow-silent-tail') + 1]) if '--allow-silent-tail' in args else 0.0
    structure_only = '--structure-only' in args
    info = probe(path)
    v = [s for s in info['streams'] if s['codec_type'] == 'video']
    a = [s for s in info['streams'] if s['codec_type'] == 'audio']
    problems = []
    if len(v) != 1 or v[0]['codec_name'] != 'h264':
        problems.append(f'video streams: {[(s["codec_name"]) for s in v]}')
    if len(a) != 1 or a[0]['codec_name'] != 'aac':
        problems.append(f'audio streams: {[(s["codec_name"]) for s in a]}')
    vd = float(v[0]['duration']) if v else 0.0
    ad = float(a[0]['duration']) if a else 0.0
    print(f'video {vd:.3f} s, audio {ad:.3f} s, |a-v| {abs(ad - vd):.3f} s (limit {MAX_AV_GAP_S} s)')
    if abs(ad - vd) > MAX_AV_GAP_S:
        problems.append(f'audio/video duration gap {abs(ad - vd):.3f} s')
    if a:
        held = len(pcm(path, gaps_as_silence=False)) / 8000
        print(f'audio samples held {held:.3f} s of {ad:.3f} s; timestamp gaps {max(0.0, ad - held):.3f} s (limit {MAX_TS_GAP_S} s)')
        if ad - held > MAX_TS_GAP_S:
            problems.append(f'audio timestamp gaps {ad - held:.3f} s')
        if structure_only:
            print('signal check SKIPPED (--structure-only): this verdict does not show that any signal or voice was captured')
            verdict = 'PASS (structure only: continuous audio track; NO signal check)'
            print(verdict if not problems else 'FAIL: ' + '; '.join(problems))
            return 0 if not problems else 1
        ws = windows(pcm(path, gaps_as_silence=True))
        quiet = [w for w in ws if w[2] < FLOOR_DB]
        ok_tail = [w for w in quiet if tail > 0 and w[0] >= ad - tail]
        bad = [w for w in quiet if w not in ok_tail]
        print(f'{len(ws)} windows of {WINDOW_S:.0f} s; min {min(w[2] for w in ws):.1f} dBFS, max {max(w[2] for w in ws):.1f} dBFS; below {FLOOR_DB:.0f} dBFS: {len(quiet)} ({len(ok_tail)} in the allowed tail)')
        for w in quiet:
            print(f'  quiet window at {w[0]:.0f}-{w[0] + w[1]:.0f} s: {w[2]:.1f} dBFS' + (' (allowed tail)' if w in ok_tail else ''))
        if bad:
            problems.append(f'{len(bad)} silent window(s) inside the clip')
    print('PASS' if not problems else 'FAIL: ' + '; '.join(problems))
    return 0 if not problems else 1


if __name__ == '__main__':
    sys.exit(main())
