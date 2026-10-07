'use strict';

// Gevinst-popup i kasinoet: konfetti, mynter som regner, beløpet som teller opp,
// lyd og vibrasjon. Tre nivåer: 'win' (vanlig), 'big' (storgevinst) og 'beer' (pils!).
//   celebrate({ tier, amount, title, sub, icon })
//   loseNudge(element)  – liten, kort risting av resultatteksten ved tap
(function () {
  let audio = null;
  function ctx() {
    if (!audio && window.AudioContext) audio = new AudioContext();
    if (audio && audio.state === 'suspended') audio.resume();
    return audio;
  }

  function tone(freq, start, dur, type = 'triangle', vol = 0.12) {
    if (window.sfx && window.sfx.muted) return; // 🔇 i kasinoet
    const a = ctx();
    if (!a) return;
    const o = a.createOscillator();
    const g = a.createGain();
    o.type = type;
    o.frequency.value = freq;
    const t = a.currentTime + start;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(a.destination);
    o.start(t);
    o.stop(t + dur + 0.05);
  }

  function fanfare(tier) {
    // Stigende dur-arpeggio; større gevinst = flere toner og en akkord til slutt
    const notes = tier === 'beer' ? [523, 659, 784, 1047, 1319, 1568] : tier === 'big' ? [523, 659, 784, 1047, 1319] : [659, 784, 1047];
    notes.forEach((f, i) => tone(f, i * 0.09, 0.35));
    const end = notes.length * 0.09;
    if (tier !== 'win') [1047, 1319, 1568].forEach((f) => tone(f, end, 0.9, 'sine', 0.08));
  }

  // ---------- Konfetti ----------
  function confetti(canvas, tier) {
    const c = canvas.getContext('2d');
    const W = (canvas.width = innerWidth * devicePixelRatio);
    const H = (canvas.height = innerHeight * devicePixelRatio);
    const colors = tier === 'beer' ? ['#ffd34d', '#f5a301', '#fff3c4', '#ffffff', '#39ff6a'] : ['#ffd34d', '#ff3b5c', '#2ee6d6', '#39ff6a', '#ffffff', '#b06cff'];
    const n = tier === 'win' ? 90 : tier === 'big' ? 170 : 240;
    const parts = Array.from({ length: n }, () => ({
      x: W / 2 + (Math.random() - 0.5) * W * 0.2,
      y: H * 0.45,
      vx: (Math.random() - 0.5) * 26 * devicePixelRatio,
      vy: (-Math.random() * 22 - 8) * devicePixelRatio,
      s: (4 + Math.random() * 7) * devicePixelRatio,
      r: Math.random() * Math.PI,
      vr: (Math.random() - 0.5) * 0.4,
      color: colors[Math.floor(Math.random() * colors.length)],
    }));
    let frame = 0;
    (function step() {
      c.clearRect(0, 0, W, H);
      parts.forEach((p) => {
        p.vy += 0.55 * devicePixelRatio;
        p.vx *= 0.985;
        p.x += p.vx;
        p.y += p.vy;
        p.r += p.vr;
        c.save();
        c.translate(p.x, p.y);
        c.rotate(p.r);
        c.fillStyle = p.color;
        c.fillRect(-p.s / 2, -p.s / 4, p.s, p.s / 2);
        c.restore();
      });
      if (++frame < 200 && canvas.isConnected) requestAnimationFrame(step);
    })();
  }

  function rain(layer, tier) {
    const emojis = tier === 'beer' ? ['🍺', '🍻', '🍺', '⭐'] : ['💰', '🪙', '💵', '🪙'];
    const n = tier === 'win' ? 12 : tier === 'big' ? 24 : 30;
    for (let i = 0; i < n; i++) {
      const e = document.createElement('span');
      e.className = 'cel-drop';
      e.textContent = emojis[i % emojis.length];
      e.style.left = `${Math.random() * 100}%`;
      e.style.animationDelay = `${Math.random() * 0.9}s`;
      e.style.animationDuration = `${1.6 + Math.random() * 1.2}s`;
      e.style.fontSize = `${1.4 + Math.random() * 1.4}rem`;
      layer.appendChild(e);
    }
  }

  function countUp(el, to, ms) {
    const start = performance.now();
    let lastTick = 0;
    (function step(now) {
      const k = Math.min(1, (now - start) / ms);
      const eased = 1 - Math.pow(1 - k, 3);
      el.textContent = `+${Math.round(to * eased)}`;
      // Små «tikk» mens tallet stiger, som en myntteller
      if (now - lastTick > 70 && k < 1) {
        tone(1400 + 600 * k, 0, 0.04, 'square', 0.025);
        lastTick = now;
      }
      if (k < 1) requestAnimationFrame(step);
      else el.classList.add('done');
    })(start);
  }

  let current = null;
  // Ekte gevinstlyd og kasinoverten (sfx.js) hvis de er lastet, ellers den syntetiske fanfaren
  function winSound(tier, voice) {
    const s = window.sfx;
    if (!s || s.muted) return false;
    const ok = s.sample(tier === 'win' ? 'win' : 'bigwin');
    const line = voice || (tier === 'beer' ? 'v_pils' : tier === 'big' ? 'v_storgevinst' : null);
    if (line) s.say(line, tier === 'win' ? 0.2 : 0.5);
    return !!ok;
  }

  window.celebrate = function ({ tier = 'win', amount = 0, title, sub = '', icon, action, voice } = {}) {
    if (current) current.remove();
    const overlay = document.createElement('div');
    overlay.className = `celebrate cel-${tier}`;
    const canvas = document.createElement('canvas');
    canvas.className = 'cel-canvas';
    const drops = document.createElement('div');
    drops.className = 'cel-drops';
    const card = document.createElement('div');
    card.className = 'cel-card';
    const rays = document.createElement('div');
    rays.className = 'cel-rays';
    const ic = document.createElement('div');
    ic.className = 'cel-icon';
    ic.textContent = icon || (tier === 'beer' ? '🍺' : tier === 'big' ? '🤑' : '🎉');
    const h = document.createElement('div');
    h.className = 'cel-title';
    h.textContent = title || (tier === 'beer' ? 'PILS TIL GODE!' : tier === 'big' ? 'STORGEVINST!' : 'DU VANT!');
    card.append(rays, ic, h);
    if (amount > 0) {
      const amt = document.createElement('div');
      amt.className = 'cel-amount';
      const num = document.createElement('span');
      num.textContent = '+0';
      amt.append(num, document.createTextNode(' cash'));
      card.appendChild(amt);
      countUp(num, amount, tier === 'win' ? 700 : 1200);
    }
    if (sub) {
      const s = document.createElement('div');
      s.className = 'cel-sub';
      s.textContent = sub;
      card.appendChild(s);
    }
    if (action) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'cel-action';
      b.textContent = action.label;
      b.addEventListener('click', (e) => {
        e.stopPropagation();
        close();
        action.onClick();
      });
      card.appendChild(b);
    }
    const tap = document.createElement('div');
    tap.className = 'cel-tap';
    tap.textContent = 'Trykk for å fortsette';
    card.appendChild(tap);
    overlay.append(canvas, drops, card);
    document.body.appendChild(overlay);
    current = overlay;

    confetti(canvas, tier);
    rain(drops, tier);
    if (!winSound(tier, voice)) fanfare(tier);
    if (navigator.vibrate) navigator.vibrate(tier === 'win' ? [60, 40, 90] : [80, 50, 80, 50, 220]);

    function close() {
      overlay.classList.add('out');
      setTimeout(() => overlay.remove(), 300);
      if (current === overlay) current = null;
    }
    overlay.addEventListener('click', close);
    setTimeout(close, tier === 'beer' ? 6000 : tier === 'big' ? 4200 : 3000);
  };

  window.loseNudge = function (el) {
    if (!el) return;
    el.classList.remove('lose-shake');
    void el.offsetWidth;
    el.classList.add('lose-shake');
    if (!(window.sfx && window.sfx.sample('lose'))) tone(220, 0, 0.18, 'sine', 0.05);
  };

  // Nettlesere tillater bare lyd etter at man har trykket på siden
  document.addEventListener('pointerdown', ctx, { once: true });
})();
