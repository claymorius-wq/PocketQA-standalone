#!/usr/bin/env python3
"""Evidence gate for a native screen + voice recording (pqa-qa r1 P2-B). Emulator evidence only.

PASS needs ALL of:
  - exactly one video stream (h264) and one audio stream (aac), read per stream with ffprobe;
  - |audio duration - video duration| <= 1.0 s;
  - every 5 s window of the decoded audio, across the WHOLE clip, above -40 dBFS RMS. On the
    emulator the microphone carries the HAL's synthetic 220 Hz tone (see android-cross-app/probe.txt),
    so a quiet window means the voice was lost there. Windows are listed, so a gap shows where.
A clip a scenario ends on purpose by taking the microphone away (call, appops) may end with a few
silent seconds before the app stops it; --allow-silent-tail N accepts up to N seconds of that at the end.

Usage: check-voice.py <clip.mp4> [--allow-silent-tail 4]
"""
import json, math, struct, subprocess, sys

WINDOW_S = 5.0
FLOOR_DB = -40.0
MAX_AV_GAP_S = 1.0


def probe(path):
    out = subprocess.run(['ffprobe', '-v', 'error', '-show_entries', 'stream=index,codec_type,codec_name,duration:format=duration', '-of', 'json', path], capture_output=True, text=True, check=True).stdout
    return json.loads(out)


def windows(path):
    raw = subprocess.run(['ffmpeg', '-v', 'error', '-i', path, '-map', '0:a:0', '-ac', '1', '-ar', '8000', '-f', 's16le', '-'], capture_output=True, check=True).stdout
    n = len(raw) // 2
    samples = struct.unpack('<%dh' % n, raw[: n * 2])
    per = int(8000 * WINDOW_S)
    out = []
    for i in range(0, n, per):
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
        ws = windows(path)
        quiet = [w for w in ws if w[2] < FLOOR_DB]
        ok_tail = [w for w in quiet if w[0] >= ad - tail - WINDOW_S]
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
