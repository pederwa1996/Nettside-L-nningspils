'use strict';

// Små, rolige lydeffekter i kasinoet, laget med Web Audio (ingen lydfiler).
//   sfx.play('chip' | 'card' | 'tick' | 'lever' | 'reelTick' | 'reelStop' | 'coin' | 'ballDrop' | 'skull' | 'tap')
//   sfx.follow(element, stepDeg, ms, sound)  – lyd hver gang et roterende element passerer et felt
//   sfx.ballRoll(ms)                          – kula som ruller i rouletten
// Kan skrus av med 🔊-knappen (huskes i nettleseren). Gevinstlydene ligger i celebrate.js.
(function () {
  let ac = null;
  let muted = false;
  try {
    muted = localStorage.getItem('sfx-muted') === '1';
  } catch { /* ignorer */ }

  function ctx() {
    if (!ac && window.AudioContext) ac = new AudioContext();
    if (ac && ac.state === 'suspended') ac.resume();
    return ac;
  }

  // En kort tone med myk start og rask utklinging
  function tone(freq, { t = 0, dur = 0.08, type = 'sine', vol = 0.05, to = null } = {}) {
    const a = ctx();
    if (!a || muted) return;
    const o = a.createOscillator();
    const g = a.createGain();
    const at = a.currentTime + t;
    o.type = type;
    o.frequency.setValueAtTime(freq, at);
    if (to) o.frequency.exponentialRampToValueAtTime(to, at + dur);
    g.gain.setValueAtTime(0.0001, at);
    g.gain.exponentialRampToValueAtTime(vol, at + 0.005);
    g.gain.exponentialRampToValueAtTime(0.0001, at + dur);
    o.connect(g).connect(a.destination);
    o.start(at);
    o.stop(at + dur + 0.02);
  }

  // Kort støy gjennom et filter (klikk, sjetonger, kort som skyves)
  let noiseBuf = null;
  function noise(dur, { t = 0, vol = 0.05, freq = 2000, q = 1, to = null } = {}) {
    const a = ctx();
    if (!a || muted) return;
    if (!noiseBuf) {
      noiseBuf = a.createBuffer(1, a.sampleRate, a.sampleRate);
      const d = noiseBuf.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    }
    const src = a.createBufferSource();
    src.buffer = noiseBuf;
    const f = a.createBiquadFilter();
    f.type = 'bandpass';
    const at = a.currentTime + t;
    f.frequency.setValueAtTime(freq, at);
    if (to) f.frequency.exponentialRampToValueAtTime(to, at + dur);
    f.Q.value = q;
    const g = a.createGain();
    g.gain.setValueAtTime(0.0001, at);
    g.gain.exponentialRampToValueAtTime(vol, at + 0.004);
    g.gain.exponentialRampToValueAtTime(0.0001, at + dur);
    src.connect(f).connect(g).connect(a.destination);
    src.start(at, Math.random() * 0.5);
    src.stop(at + dur + 0.02);
  }

  const SOUNDS = {
    // Pila på lykkehjulet som slår mot en pinne
    tick: () => tone(1500, { dur: 0.025, type: 'triangle', vol: 0.035 }),
    // Sjetonger som legges på bordet: to små klikk
    chip: () => {
      noise(0.03, { freq: 5200, q: 4, vol: 0.09 });
      noise(0.03, { t: 0.045, freq: 4600, q: 4, vol: 0.06 });
    },
    // Et kort som skyves over filten
    card: () => noise(0.11, { freq: 2600, to: 1200, q: 0.8, vol: 0.07 }),
    // Spaken på automaten
    lever: () => {
      tone(160, { dur: 0.16, type: 'triangle', vol: 0.07, to: 80 });
      noise(0.05, { t: 0.12, freq: 900, q: 2, vol: 0.06 });
    },
    // Hjulene i automaten som går rundt, og som stopper
    reelTick: () => tone(950, { dur: 0.012, type: 'triangle', vol: 0.012 }),
    reelStop: () => {
      tone(190, { dur: 0.1, vol: 0.08, to: 120 });
      noise(0.04, { freq: 700, q: 2, vol: 0.05 });
    },
    // Kjøp av spinn
    coin: () => {
      tone(1320, { dur: 0.07, type: 'triangle', vol: 0.04 });
      tone(1760, { t: 0.06, dur: 0.14, type: 'triangle', vol: 0.04 });
    },
    // Kula som faller ned i et felt i rouletten
    ballDrop: () => [0, 0.11, 0.19, 0.24, 0.27].forEach((t, i) => tone(2400 - i * 150, { t, dur: 0.02, type: 'triangle', vol: 0.05 - i * 0.008 })),
    // 💀 −1 SPINN på lykkehjulet
    skull: () => tone(220, { dur: 0.3, type: 'sine', vol: 0.06, to: 140 }),
    // Vanlig knappetrykk
    tap: () => tone(700, { dur: 0.03, type: 'triangle', vol: 0.025 }),
  };

  let lastTick = 0;
  function play(name) {
    if (window.__sfxLog) window.__sfxLog.push(name); // brukes av testene
    if (muted || !SOUNDS[name]) return;
    // Ikke spill tikk tettere enn hvert 28. ms (blir bare sus)
    if (name === 'tick' || name === 'reelTick') {
      const now = performance.now();
      if (now - lastTick < 28) return;
      lastTick = now;
    }
    try {
      SOUNDS[name]();
    } catch { /* ignorer */ }
  }

  // Les av hvor mye et element er rotert (fra CSS-animasjonen), i grader
  function angleOf(el) {
    const m = getComputedStyle(el).transform;
    if (!m || m === 'none') return 0;
    const v = m.match(/matrix\(([^)]+)\)/);
    if (!v) return 0;
    const [a, b] = v[1].split(',').map(Number);
    return (Math.atan2(b, a) * 180) / Math.PI;
  }

  // Spill en lyd hver gang et roterende element passerer en ny «pinne»
  function follow(el, stepDeg, ms, sound = 'tick') {
    let prev = angleOf(el);
    let travelled = 0;
    let lastStep = 0;
    const end = performance.now() + ms;
    (function frame() {
      const a = angleOf(el);
      let d = a - prev;
      if (d < -180) d += 360;
      if (d > 180) d -= 360;
      travelled += Math.abs(d);
      prev = a;
      const step = Math.floor(travelled / stepDeg);
      if (step !== lastStep) {
        lastStep = step;
        play(sound);
      }
      if (performance.now() < end) requestAnimationFrame(frame);
    })();
  }

  // Kula i rouletten: et lavt sus som roer seg, så den faller ned
  function ballRoll(ms) {
    if (window.__sfxLog) window.__sfxLog.push('ballRoll');
    const a = ctx();
    if (!a || muted) return;
    const dur = Math.max(1.2, ms / 1000);
    const steps = Math.floor(dur * 9);
    for (let i = 0; i < steps; i++) {
      // Tikkene kommer tettere i starten og glisner mot slutten
      const t = dur * 0.85 * Math.pow(i / steps, 1.6);
      noise(0.05, { t, freq: 1800, q: 3, vol: 0.025 * (1 - (i / steps) * 0.6) });
    }
    setTimeout(() => play('ballDrop'), dur * 1000 - 300);
  }

  function setMuted(m) {
    muted = m;
    try {
      localStorage.setItem('sfx-muted', m ? '1' : '0');
    } catch { /* ignorer */ }
    btn.textContent = m ? '🔇' : '🔊';
    btn.title = m ? 'Skru på lyd' : 'Skru av lyd';
    if (!m) play('tap');
  }

  // 🔊/🔇 øverst til venstre i kasinoet
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'sfx-toggle';
  btn.addEventListener('click', () => setMuted(!muted));
  document.body.appendChild(btn);
  btn.textContent = muted ? '🔇' : '🔊';
  btn.title = muted ? 'Skru på lyd' : 'Skru av lyd';

  // Nettlesere tillater bare lyd etter at man har trykket på siden
  document.addEventListener('pointerdown', ctx, { once: true });

  // Spill en lyd når et antall øker (nye kort på bordet, flere sjetonger i potten)
  const counts = {};
  function watch(key, n, sound) {
    if (counts[key] !== undefined && n > counts[key]) {
      // Flere kort på en gang: ett «swish» per kort, litt etter hverandre
      const times = sound === 'card' ? Math.min(4, n - counts[key]) : 1;
      for (let i = 0; i < times; i++) setTimeout(() => play(sound), i * 130);
    }
    counts[key] = n;
  }

  window.sfx = {
    play,
    watch,
    follow,
    ballRoll,
    get muted() {
      return muted;
    },
  };
})();
