'use strict';

// Små lydeffekter på hele siden. Ekte lyder fra ElevenLabs ligger i /sfx/*.mp3 (lages med
// et skript, nøkkelen er aldri i koden). Mangler en fil, brukes en enkel syntetisk lyd i stedet.
//   sfx.say('v_pils')                         – kasinoverten sier noe (norsk stemme)
//   sfx.loop('pour') -> stop()                 – lyd som går til man stopper den
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

  // ---------- Ekte lyder (ElevenLabs) ----------
  // lyd -> [fil, volum]
  const FILES = {
    tick: ['tick', 0.6], chip: ['chips', 0.7], card: ['card', 0.8], lever: ['lever', 0.8], reelStop: ['reelstop', 0.8],
    coin: ['coin', 0.7], ballDrop: ['balldrop', 0.9], skull: ['skull', 0.8], door: ['door', 0.5], back: ['back', 0.5],
    notify: ['notify', 0.7], cheers: ['cheers', 0.9], send: ['send', 0.5], pop: ['pop', 0.6], sad: ['sad', 0.7], like: ['like', 0.6],
    win: ['win', 0.6], bigwin: ['bigwin', 0.6], lose: ['lose', 0.5], reels: ['reels', 0.45], ballroll: ['ballroll', 0.55], pour: ['pour', 0.6],
    v_jackpot: ['v_jackpot', 1], v_blackjack: ['v_blackjack', 1], v_pils: ['v_pils', 1], v_storgevinst: ['v_storgevinst', 1],
    diceshake: ['diceshake', 0.8], diceroll: ['diceroll', 0.8], dicestop: ['dicestop', 0.9], drum: ['drum', 0.8], clash: ['clash', 0.7],
    go: ['go', 0.6], buzzer: ['buzzer', 0.5],
    v_potten: ['v_potten', 1], v_nomore: ['v_nomore', 0.9], v_skaal: ['v_skaal', 1], v_kjipt: ['v_kjipt', 1],
  };
  const buffers = {};
  const loading = {};
  function loadFile(file) {
    const a = ctx();
    if (!a || buffers[file] || loading[file]) return;
    loading[file] = fetch(`/sfx/${file}.mp3`)
      .then((r) => (r.ok ? r.arrayBuffer() : Promise.reject(new Error('mangler'))))
      .then((b) => new Promise((res, rej) => a.decodeAudioData(b, res, rej)))
      .then((buf) => (buffers[file] = buf))
      .catch(() => { /* bruk den syntetiske lyden */ });
  }
  // Last alle filene første gang man trykker på siden (små filer, caches av nettleseren)
  function preload() {
    Object.values(FILES).forEach(([f]) => loadFile(f));
  }
  // Spill en fil. Returnerer en stopp-funksjon, eller null hvis filen ikke er klar.
  function sample(name, { vol = 1, maxMs = 0, loop = false, delay = 0 } = {}) {
    const a = ctx();
    const def = FILES[name];
    if (!a || muted || !def) return null;
    const buf = buffers[def[0]];
    if (!buf) {
      loadFile(def[0]);
      return null;
    }
    const src = a.createBufferSource();
    src.buffer = buf;
    src.loop = loop;
    const g = a.createGain();
    const at = a.currentTime + delay;
    g.gain.setValueAtTime(def[1] * vol, at);
    src.connect(g).connect(a.destination);
    src.start(at);
    const stop = (fade = 0.15) => {
      try {
        const t = a.currentTime;
        g.gain.setValueAtTime(g.gain.value, t);
        g.gain.linearRampToValueAtTime(0.0001, t + fade);
        src.stop(t + fade + 0.02);
      } catch { /* allerede stoppet */ }
    };
    if (maxMs) setTimeout(() => stop(0.25), delay * 1000 + maxMs);
    return stop;
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
    // PvP: terninger, tromme, sverd, start og feil
    diceshake: () => [0, 0.08, 0.17, 0.24, 0.33, 0.41].forEach((t) => noise(0.05, { t, freq: 2600, q: 3, vol: 0.06 })),
    diceroll: () => [0, 0.12, 0.26, 0.42, 0.6, 0.82, 1.1].forEach((t, i) => noise(0.05, { t, freq: 1800, q: 3, vol: 0.07 - i * 0.007 })),
    dicestop: () => {
      noise(0.04, { freq: 1500, q: 3, vol: 0.09 });
      noise(0.04, { t: 0.07, freq: 1300, q: 3, vol: 0.07 });
    },
    drum: () => tone(90, { dur: 0.3, vol: 0.12, to: 55 }),
    clash: () => noise(0.25, { freq: 4200, q: 2, vol: 0.08 }),
    go: () => tone(880, { dur: 0.15, type: 'square', vol: 0.03 }),
    buzzer: () => tone(140, { dur: 0.35, type: 'sawtooth', vol: 0.04 }),
    // Vanlig knappetrykk
    tap: () => tone(700, { dur: 0.03, type: 'triangle', vol: 0.025 }),

    // ---- Resten av siden ----
    // Gjennom en dør til en ny side: et mykt «whoosh» oppover
    door: () => {
      noise(0.18, { freq: 500, to: 2400, q: 0.9, vol: 0.05 });
      tone(520, { t: 0.04, dur: 0.12, type: 'sine', vol: 0.03, to: 880 });
    },
    // Hjem / tilbake: samme whoosh, men nedover
    back: () => {
      noise(0.18, { freq: 2400, to: 500, q: 0.9, vol: 0.05 });
      tone(880, { t: 0.03, dur: 0.12, type: 'sine', vol: 0.03, to: 520 });
    },
    // Nytt varsel: en liten to-tone bjelle
    notify: () => {
      tone(988, { dur: 0.18, type: 'sine', vol: 0.05 });
      tone(1319, { t: 0.11, dur: 0.3, type: 'sine', vol: 0.045 });
    },
    // Pils bestilt: to glass som klirrer + litt skum
    cheers: () => {
      tone(2093, { dur: 0.25, type: 'sine', vol: 0.035 });
      tone(2637, { t: 0.005, dur: 0.22, type: 'sine', vol: 0.025 });
      tone(2217, { t: 0.09, dur: 0.3, type: 'sine', vol: 0.03 });
      noise(0.5, { t: 0.15, freq: 6000, q: 0.6, vol: 0.012 });
    },
    // Sendt (chat, innlegg, forslag, levert oppgave): kort blipp oppover
    send: () => tone(660, { dur: 0.09, type: 'triangle', vol: 0.04, to: 1100 }),
    // Ny melding fra andre: liten «pop»
    pop: () => tone(520, { dur: 0.07, type: 'sine', vol: 0.05, to: 780 }),
    // Pils som tappes: bitte små bobler
    pour: () => noise(0.06, { freq: 900 + Math.random() * 900, q: 6, vol: 0.02 }),
    // Kjipt: en liten, trist nedtur
    sad: () => [392, 370, 349, 294].forEach((f, i) => tone(f, { t: i * 0.16, dur: i === 3 ? 0.45 : 0.15, type: 'triangle', vol: 0.04 })),
    // Lik: et lite, lyst pling
    like: () => {
      tone(1175, { dur: 0.08, type: 'triangle', vol: 0.03 });
      tone(1568, { t: 0.05, dur: 0.12, type: 'triangle', vol: 0.03 });
    },
  };

  let lastTick = 0;
  function play(name) {
    if (window.__sfxLog) window.__sfxLog.push(name); // brukes av testene
    if (muted) return;
    // Ikke spill tikk tettere enn hvert 28. ms (blir bare sus)
    if (name === 'tick' || name === 'reelTick') {
      const now = performance.now();
      if (now - lastTick < 28) return;
      lastTick = now;
    }
    // Ekte lyd hvis den er lastet, ellers den syntetiske
    if (FILES[name] && sample(name)) return;
    if (!SOUNDS[name]) return;
    try {
      SOUNDS[name]();
    } catch { /* ignorer */ }
  }

  // Kasinoverten: norsk stemme (bare fra fil)
  let lastSay = 0;
  function say(name, delay = 0) {
    if (window.__sfxLog) window.__sfxLog.push(name);
    if (muted) return;
    const now = performance.now();
    if (now - lastSay < 1200) return; // ikke snakk i munnen på seg selv
    lastSay = now;
    sample(name, { delay });
  }

  // Lyd som går helt til man stopper den (f.eks. pils som tappes)
  function loop(name) {
    if (window.__sfxLog) window.__sfxLog.push(name);
    return sample(name, { loop: true }) || (() => {});
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
    say('v_nomore');
    // Ekte kule som ruller (fades ut rett før den faller ned)
    if (sample('ballroll', { maxMs: Math.max(800, dur * 1000 - 450), delay: 0.6 })) {
      setTimeout(() => play('ballDrop'), dur * 1000 - 300);
      return;
    }
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
  document.addEventListener('pointerdown', () => {
    ctx();
    preload();
  }, { once: true });

  // Lenker til en annen side: spill «dør»-lyden og vent et øyeblikk så den rekker å høres
  document.addEventListener('click', (e) => {
    if (muted || e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    const a = e.target.closest && e.target.closest('a[href]');
    if (!a || a.target === '_blank' || a.hasAttribute('download')) return;
    const url = new URL(a.href, location.href);
    if (url.origin !== location.origin || url.pathname.startsWith('/media/')) return;
    const samePage = url.pathname === location.pathname && url.search === location.search;
    if (samePage) return; // bare et anker på samme side
    const home = url.pathname === '/' || url.pathname === '/index.html';
    play(home ? 'back' : 'door');
    e.preventDefault();
    setTimeout(() => (location.href = a.href), 130);
  });

  // Faner og små knapper rundt omkring: et svakt klikk
  document.addEventListener('click', (e) => {
    if (e.target.closest && e.target.closest('.hs-tab, .task-cat, .ptab, .ff, .partner-chip, .suggest-kinds label, .auth-tab')) play('tap');
  });

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
    say,
    loop,
    sample: (name, opts) => sample(name, opts),
    loaded: () => Object.keys(buffers), // hvilke lydfiler som er klare (til testing)
    watch,
    follow,
    ballRoll,
    get muted() {
      return muted;
    },
  };
})();
