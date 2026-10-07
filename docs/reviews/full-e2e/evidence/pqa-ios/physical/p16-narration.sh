#!/bin/bash
# Narration analysis (pqa-ios): actual speech energy over time, not mere audio-track presence.
# Usage: narration.sh <clip.mp4> <outdir>
set -e
F="$1"; O="$2"; mkdir -p "$O"
echo "## ffprobe streams"; ffprobe -v error -show_entries stream=index,codec_type,codec_name,sample_rate,channels,duration,width,height -of compact "$F"
echo "## ffmpeg decode check"; ffmpeg -v error -i "$F" -f null - 2>&1 | head -5; echo "decode exit $?"
# Per-0.5 s RMS (dB) of the full band and of the 300-3400 Hz voice band.
for band in full voice; do
  if [ $band = full ]; then af="asetnsamples=n=24000:p=0,astats=metadata=1:reset=1,ametadata=print:key=lavfi.astats.Overall.RMS_level:file=$O/rms-full.txt"; else af="highpass=f=300,lowpass=f=3400,asetnsamples=n=24000:p=0,astats=metadata=1:reset=1,ametadata=print:key=lavfi.astats.Overall.RMS_level:file=$O/rms-voice.txt"; fi
  ffmpeg -v error -i "$F" -vn -af "$af" -f null - 
done
ffmpeg -v error -y -i "$F" -vn -lavfi "showspectrumpic=s=1600x600:legend=1:scale=log:stop=8000" "$O/spectrogram.png"
ffmpeg -hide_banner -i "$F" -vn -af volumedetect -f null - 2>&1 | grep -E "mean_volume|max_volume"
python3 - "$O" <<'PY'
import re,sys,statistics
O=sys.argv[1]
def load(p):
    t=[];v=[]
    for line in open(p):
        m=re.search(r'pts_time:([\d.]+)',line)
        if m: t.append(float(m.group(1)))
        m=re.search(r'RMS_level=(-?[\d.]+|-inf)',line)
        if m: v.append(-120.0 if m.group(1)=='-inf' else float(m.group(1)))
    return list(zip(t,v))
full=load(O+'/rms-full.txt'); voice=load(O+'/rms-voice.txt')
print('## RMS timeline (0.5 s windows): t  full_dB  voice_dB')
for (t,a),(_,b) in zip(full,voice): print(f'{t:7.1f} {a:8.1f} {b:8.1f} ' + '#'*max(0,int((b+80)/3)))
vs=[b for _,b in voice]
if vs:
    floor=sorted(vs)[len(vs)//10]; top=sorted(vs)[-max(1,len(vs)//10):]
    print(f'voice-band floor (10th pct) {floor:.1f} dB; top-10% mean {statistics.mean(top):.1f} dB; dynamic range {statistics.mean(top)-floor:.1f} dB')
    loud=[t for t,b in voice if b>floor+15]
    print('windows >15 dB above floor:', [round(x,1) for x in loud])
PY
