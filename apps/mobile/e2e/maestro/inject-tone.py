#!/usr/bin/env python3
"""Injects a SYNTHETIC sine tone into the Android EMULATOR's microphone through the emulator's
own gRPC API (EmulatorController.injectAudio). The source is the emulated microphone itself: the
app records whatever arrives there, exactly as on a phone. No host microphone is involved. Turn it
off first with `adb -s <serial> emu avd hostmicoff`. Nothing is mixed into a file afterwards.

KNOWN BLOCKER (observed 2026-10-05, emulator 36.3.10, AVD with android-36.1 arm64 image, macOS):
the HEADLESS emulator (`-no-window`) crashes on injectAudio. The macOS crash report shows SIGSEGV in
audio_forwarder_enable <- QemuAudioInputEngine::start <- EmulatorControllerImpl::injectAudio. A
windowed emulator didn't start from a non-GUI session. So non-silent synthetic narration couldn't be
produced on this host's emulator. Try it only on a windowed emulator run from a desktop session, on
an emulator instance that is yours alone.

Requires: python3 -m venv <dir> && <dir>/bin/pip install grpcio grpcio-tools
Usage:    <dir>/bin/python inject-tone.py --port 8556 --seconds 30 --freq 440
(the emulator started with `-grpc 8556`; the proto is compiled from the installed SDK at run time).
"""
import argparse, math, os, struct, sys, tempfile, time

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--port', type=int, default=8556)
    ap.add_argument('--seconds', type=float, default=30)
    ap.add_argument('--freq', type=float, default=440.0)
    ap.add_argument('--amplitude', type=float, default=0.4)
    ap.add_argument('--sdk', default=os.environ.get('ANDROID_HOME', os.path.expanduser('~/Library/Android/sdk')))
    a = ap.parse_args()

    import grpc
    from grpc_tools import protoc
    lib = os.path.join(a.sdk, 'emulator', 'lib')
    out = tempfile.mkdtemp(prefix='emu-proto-')
    import grpc_tools
    std = os.path.join(os.path.dirname(grpc_tools.__file__), '_proto')
    rc = protoc.main(['protoc', f'-I{lib}', f'-I{std}', f'--python_out={out}', f'--grpc_python_out={out}', os.path.join(lib, 'emulator_controller.proto')])
    if rc != 0:
        sys.exit(f'protoc failed ({rc})')
    sys.path.insert(0, out)
    import emulator_controller_pb2 as pb, emulator_controller_pb2_grpc as rpc

    rate, chunk_ms = 44100, 20
    n = rate * chunk_ms // 1000
    fmt = pb.AudioFormat(samplingRate=rate, channels=pb.AudioFormat.Mono, format=pb.AudioFormat.AUD_FMT_S16, mode=pb.AudioFormat.MODE_UNSPECIFIED)

    def packets():
        t0, i, total = time.time(), 0, int(a.seconds * 1000 / chunk_ms)
        for k in range(total):
            samples = [int(32767 * a.amplitude * math.sin(2 * math.pi * a.freq * (i + j) / rate)) for j in range(n)]
            i += n
            yield pb.AudioPacket(format=fmt, timestamp=int(time.time() * 1e6), audio=struct.pack(f'<{n}h', *samples))
            # Pace roughly in real time so the emulator's 300 ms buffer is fed steadily.
            ahead = t0 + (k + 1) * chunk_ms / 1000 - time.time()
            if ahead > 0:
                time.sleep(ahead)

    stub = rpc.EmulatorControllerStub(grpc.insecure_channel(f'localhost:{a.port}'))
    stub.injectAudio(packets())
    print(f'injected {a.seconds:.0f} s of a {a.freq:.0f} Hz synthetic tone into the emulator microphone (port {a.port})')

if __name__ == '__main__':
    main()
