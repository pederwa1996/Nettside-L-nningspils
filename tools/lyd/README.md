# Lydene fra ElevenLabs

Lydfilene i `public/sfx/` er laget med ElevenLabs (lydeffekter og en norsk kasinovert).
Nettsiden trenger ingen nøkkel: den spiller bare de ferdige mp3-filene.

Lage dem på nytt / lage flere:

```bash
export ELEVENLABS_API_KEY=...        # eller via en «network secret» (xi-api-key) i Claude Code
python3 tools/lyd/lydeffekter.py     # alle lydeffektene, eller f.eks.: python3 tools/lyd/lydeffekter.py cheers pour
python3 tools/lyd/stemme.py          # replikkene til kasinoverten
python3 tools/lyd/ferdig.py          # klipp stillhet, jevn ut lydstyrken og lagre i public/sfx/
```

Råfilene havner i `tools/lyd/raw/` (ignoreres av git). Krever `curl` og `ffmpeg`.
