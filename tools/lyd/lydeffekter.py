import json, subprocess, sys, os
OUT = os.path.dirname(os.path.abspath(__file__)) + '/raw'
os.makedirs(OUT, exist_ok=True)
import os
KEY = os.environ.get('ELEVENLABS_API_KEY')
AUTH = ['-H', f'xi-api-key: {KEY}'] if KEY else []  # ellers legges nøkkelen på av en «network secret»

SFX = {
  # Kasino
  'tick':      ('single short sharp plastic click of a carnival prize wheel flapper hitting a peg, dry, close up', 0.5),
  'lever':     ('slot machine lever pulled down, heavy mechanical clunk and spring, close up', 1.0),
  'reels':     ('slot machine reels spinning, steady mechanical whirring and clicking', 3.0),
  'reelstop':  ('slot machine reel stopping with a short solid mechanical thunk', 0.5),
  'ballroll':  ('roulette ball rolling fast around a wooden roulette wheel, slowing down', 5.0),
  'balldrop':  ('roulette ball bouncing a few times and dropping into the number pocket, clack clack click', 1.2),
  'card':      ('a single playing card dealt and sliding across a felt casino table, quick swish', 0.5),
  'chips':     ('a small stack of clay poker chips placed on a felt table, chips clicking together', 0.7),
  'coin':      ('a few coins dropping into a pile, short purchase confirmation', 0.8),
  'win':       ('short bright cheerful casino slot machine win jingle, coins, 8-bit free, modern', 1.6),
  'bigwin':    ('big casino jackpot win, bells ringing and coins pouring out of a slot machine, celebratory', 3.0),
  'lose':      ('soft short descending two-note womp, subtle and friendly, game lose', 0.8),
  'skull':     ('short ominous low boom with a creepy whoosh, spooky game penalty', 0.9),
  # PvP
  'diceshake': ('two dice rattling inside a leather dice cup being shaken, close up', 1.6),
  'diceroll':  ('two dice tumbling and rolling across a wooden table', 1.8),
  'dicestop':  ('two dice landing on a wooden table, short click clack', 0.5),
  'drum':      ('single deep taiko drum hit, short, dramatic', 0.6),
  'clash':     ('two swords clashing, metallic impact, short', 0.8),
  'go':        ('short bright electronic go beep, game start', 0.5),
  'buzzer':    ('short game show wrong answer buzzer', 0.7),
  # Baren
  'cheers':    ('two full beer glasses clinking together, cheers, in a lively bar', 1.0),
  'pour':      ('cold beer pouring from a bar tap into a glass, foamy fizz', 3.0),
  'sad':       ('sad trombone wah wah wah, short comedic fail', 2.0),
  # Resten av siden
  'door':      ('soft airy whoosh swoosh transition, short, rising', 0.5),
  'back':      ('soft airy reverse whoosh swoosh transition, short, falling', 0.5),
  'notify':    ('gentle pleasant two-tone notification chime, soft marimba', 0.8),
  'pop':       ('soft bubble pop, message received, light', 0.5),
  'send':      ('short soft swish, message sent', 0.5),
  'like':      ('small bright sparkle pling, like button', 0.5),
}
only = sys.argv[1:] or list(SFX)
for name in only:
    text, dur = SFX[name]
    body = json.dumps({'text': text, 'duration_seconds': dur, 'prompt_influence': 0.6})
    r = subprocess.run(['curl', '-s', '-X', 'POST', 'https://api.elevenlabs.io/v1/sound-generation', '-H', 'Content-Type: application/json', *AUTH, '-d', body, '-o', f'{OUT}/{name}.mp3', '-w', '%{http_code}'], capture_output=True, text=True)
    print(name, r.stdout, os.path.getsize(f'{OUT}/{name}.mp3') if os.path.exists(f'{OUT}/{name}.mp3') else 0, flush=True)
