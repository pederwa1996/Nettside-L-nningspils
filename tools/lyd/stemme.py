import json, subprocess, os
OUT = os.path.dirname(os.path.abspath(__file__)) + '/raw'
os.makedirs(OUT, exist_ok=True)
import os
KEY = os.environ.get('ELEVENLABS_API_KEY')
AUTH = ['-H', f'xi-api-key: {KEY}'] if KEY else []  # ellers legges nøkkelen på av en «network secret»

VOICE = 'IKne3meq5aSn9XLyUdCD'  # Charlie: dyp, energisk, «hyped»
LINES = {
  'v_jackpot':   'JACKPOT!!',
  'v_blackjack': 'Blackjack!',
  'v_pils':      'Gratulerer! Du vant en ekte pils!',
  'v_storgevinst': 'Storgevinst!',
  'v_potten':    'Potten er din!',
  'v_nomore':    'Ingen flere innsatser, takk.',
  'v_skaal':     'Skål!',
  'v_kjipt':     'Å nei … tomt glass.',
}
for name, text in LINES.items():
    body = json.dumps({'text': text, 'model_id': 'eleven_turbo_v2_5', 'language_code': 'no', 'voice_settings': {'stability': 0.35, 'similarity_boost': 0.8, 'style': 0.6, 'use_speaker_boost': True}})
    r = subprocess.run(['curl', '-s', '-X', 'POST', f'https://api.elevenlabs.io/v1/text-to-speech/{VOICE}?output_format=mp3_44100_128', '-H', 'Content-Type: application/json', *AUTH, '-d', body, '-o', f'{OUT}/{name}.mp3', '-w', '%{http_code}'], capture_output=True, text=True)
    print(name, r.stdout, os.path.getsize(f'{OUT}/{name}.mp3'), flush=True)
