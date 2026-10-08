# Klipper stillhet i starten, jevner ut lydstyrken og lagrer små mp3-filer i public/sfx/
import subprocess, re, os, glob
HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, '..', '..', 'public', 'sfx')
os.makedirs(OUT, exist_ok=True)
# maks lengde (s) og topp-nivå (dB): små, hyppige lyder litt svakere, stemmen tydelig
MAXLEN = {'tick': 0.065, 'card': 0.4, 'cardflip': 0.17, 'chips': 0.6, 'door': 0.45, 'back': 0.45, 'pop': 0.3, 'send': 0.35, 'like': 0.45, 'reelstop': 0.35, 'coin': 0.7, 'notify': 0.9, 'lever': 0.9, 'balldrop': 1.2, 'cheers': 1.0, 'lose': 0.8, 'skull': 0.9, 'dicestop': 0.45, 'drum': 0.6, 'clash': 0.8, 'go': 0.4, 'buzzer': 0.7}
# Myke lyder: klipp ut én bit (start, lengde i sekunder) og fjern de skarpeste diskanttonene
CUT = {'tick': (0.0, 0.065), 'cardflip': (0.17, 0.17)}
LOWPASS = {'tick': 3200, 'card': 6000, 'cardflip': 6000, 'chips': 5000}
PEAK = {'tick': -13, 'cardflip': -10, 'reels': -10, 'ballroll': -8, 'pour': -10, 'card': -10, 'chips': -9, 'door': -10, 'back': -10, 'send': -9, 'pop': -8, 'like': -8, 'diceshake': -5, 'diceroll': -5}
for src in sorted(glob.glob(os.path.join(HERE, 'raw', '*.mp3'))):
    name = os.path.basename(src)[:-4]
    tmp = f'/tmp/{name}.wav'
    cut = CUT.get(name)
    pre = 'silenceremove=start_periods=1:start_threshold=-48dB'
    if name in LOWPASS:
        pre += f',lowpass=f={LOWPASS[name]},afade=t=in:d=0.003'
    subprocess.run(['ffmpeg', '-y', '-v', 'error', *(['-ss', str(cut[0]), '-t', str(cut[1])] if cut else []), '-i', src, '-ac', '1', '-af', pre, tmp])
    m = re.search(r'max_volume: (-?[\d.]+) dB', subprocess.run(['ffmpeg', '-i', tmp, '-af', 'volumedetect', '-f', 'null', '-'], capture_output=True, text=True).stderr)
    gain = PEAK.get(name, -1 if name.startswith('v_') else -3) - (float(m.group(1)) if m else 0)
    af = f'volume={gain}dB'
    ml = MAXLEN.get(name)
    if ml:
        fd = min(0.08, ml * 0.5)
        af += f',afade=t=out:st={ml - fd}:d={fd}'
    args = ['ffmpeg', '-y', '-v', 'error', '-i', tmp, '-af', af] + (['-t', str(ml)] if ml else []) + ['-ar', '44100', '-b:a', '80k', os.path.join(OUT, f'{name}.mp3')]
    subprocess.run(args)
    print(name)
