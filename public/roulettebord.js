'use strict';

// Felles roulette i kasinoet: ett hjul for alle. Alle ser hverandres innsatser på
// spillebrettet, og hjulet spinner for alle samtidig. Oppdateres live.
(function () {
  const $ = (id) => document.getElementById(id);
  const ORDER = [0, 32, 15, 19, 4, 21, 2, 25, 17, 34, 6, 27, 13, 36, 11, 30, 8, 23, 10, 5, 24, 16, 33, 1, 20, 14, 31, 9, 22, 18, 29, 7, 28, 12, 35, 3, 26];
  const RED = new Set([1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36]);
  const colorOf = (n) => (n === 0 ? 'green' : RED.has(n) ? 'red' : 'black');
  const COLOR = { green: '#1f9d55', red: '#c0392b', black: '#1b1e2e' };
  const NAME = { green: 'grønn', red: 'rød', black: 'svart' };
  const CHIPS = [10, 25, 50, 100, 200];
  let t = null;
  let me = null;
  let chip = 25;
  let busy = false;
  let rotation = 0;
  let spunRound = null; // runden hjulet allerede har spunnet for
  let loaded = false;
  let settledRound; // runden vi har vist resultat for (undefined = ikke lastet ennå)

  async function api(path, body) {
    const res = await fetch(path, body
      ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }
      : {});
    const json = await res.json();
    if (!res.ok) throw new Error(json.error || 'Noe gikk galt');
    return json;
  }

  function el(tag, cls, text) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text !== undefined) e.textContent = text;
    return e;
  }

  function msg(text, kind = '') {
    $('rl-result').textContent = text;
    $('rl-result').className = `result ${kind}`;
  }

  const secs = (at) => Math.max(0, Math.ceil((at - Date.now()) / 1000));

  // ---------- Hjulet ----------
  function draw() {
    const canvas = $('roulette');
    const ctx = canvas.getContext('2d');
    const r = canvas.width / 2;
    const seg = (Math.PI * 2) / ORDER.length;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ORDER.forEach((n, i) => {
      const start = -Math.PI / 2 + i * seg - seg / 2;
      ctx.beginPath();
      ctx.moveTo(r, r);
      ctx.arc(r, r, r - 6, start, start + seg);
      ctx.closePath();
      ctx.fillStyle = COLOR[colorOf(n)];
      ctx.fill();
      ctx.strokeStyle = '#c9a227';
      ctx.lineWidth = 2;
      ctx.stroke();
      ctx.save();
      ctx.translate(r, r);
      ctx.rotate(start + seg / 2 + Math.PI / 2);
      ctx.fillStyle = '#fff';
      ctx.font = 'bold 26px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(String(n), 0, -r + 42);
      ctx.restore();
    });
    ctx.beginPath();
    ctx.arc(r, r, r * 0.55, 0, Math.PI * 2);
    ctx.fillStyle = '#5a3d1a';
    ctx.fill();
    ctx.beginPath();
    ctx.arc(r, r, r * 0.2, 0, Math.PI * 2);
    ctx.fillStyle = '#c9a227';
    ctx.fill();
  }

  // Spinn hjulet så tallet havner under pila når tiden er ute
  function spinTo(number, ms) {
    const segDeg = 360 / ORDER.length;
    const idx = ORDER.indexOf(number);
    const jitter = (Math.random() - 0.5) * segDeg * 0.5;
    const wanted = (360 - idx * segDeg + jitter + 360) % 360;
    const current = ((rotation % 360) + 360) % 360;
    rotation += 360 * 5 + ((wanted - current + 360) % 360);
    const c = $('roulette');
    c.style.transition = `transform ${Math.max(1.5, ms / 1000)}s cubic-bezier(0.15, 0.85, 0.2, 1)`;
    c.style.transform = `rotate(${rotation}deg)`;
    if (window.sfx && document.body.dataset.tab === 'roulette') sfx.ballRoll(Math.max(1500, ms));
  }

  // ---------- Visning ----------
  function statusText() {
    if (t.phase === 'open') return 'Plasser en innsats for å starte runden';
    if (t.phase === 'betting') return `Innsatser … hjulet spinner om ${secs(t.spinAt)} s`;
    if (t.phase === 'spinning') return 'Hjulet spinner … 🎡';
    return `${t.number} ${NAME[colorOf(t.number)]}!`;
  }

  function render() {
    if (!t) return;
    $('rl-status').textContent = statusText();
    $('rl-status').className = `rl-status ph-${t.phase}`;

    // Siste tall
    const hist = $('rl-history');
    hist.innerHTML = '';
    t.history.forEach((n) => hist.appendChild(el('span', `rl-dot ${colorOf(n)}`, String(n))));

    // Hjulet: spinn én gang per runde
    if (t.phase === 'spinning' && t.number !== null && spunRound !== t.round) {
      spunRound = t.round;
      $('rl-number').classList.add('hidden');
      spinTo(t.number, t.resultAt - Date.now());
    }
    const num = $('rl-number');
    if (t.phase === 'result') {
      num.textContent = t.number;
      num.className = `rl-number ${colorOf(t.number)}`;
    } else if (t.phase !== 'spinning') num.classList.add('hidden');

    // Spillebrettet med alles innsatser
    const open = ['open', 'betting'].includes(t.phase);
    document.querySelectorAll('.rl-spot').forEach((spot) => {
      const b = t.bets[spot.dataset.type];
      spot.querySelector('.rl-total').textContent = b.total ? `${b.total}` : '';
      const chips = spot.querySelector('.rl-chips');
      chips.innerHTML = '';
      b.players.slice(0, 6).forEach((x) => {
        const a = avatarEl(x.avatar, x.name, 22);
        a.title = `${x.name}: ${x.amount}`;
        chips.appendChild(a);
      });
      if (b.players.length > 6) chips.appendChild(el('span', 'rl-more', `+${b.players.length - 6}`));
      spot.disabled = !open || !me;
      const won = t.phase === 'result' && t.last && ({
        red: colorOf(t.number) === 'red',
        black: colorOf(t.number) === 'black',
        even: t.number !== 0 && t.number % 2 === 0,
        odd: t.number % 2 === 1,
      })[spot.dataset.type];
      spot.classList.toggle('won', !!won);
      spot.classList.toggle('mine', t.myBets.some((x) => x.type === spot.dataset.type));
    });

    // Sjetonger på bordet (alles innsatser) og ny runde
    if (window.sfx && document.body.dataset.tab === 'roulette') sfx.watch('rl-bets', Object.values(t.bets).reduce((n, b) => n + b.total, 0), 'chip');

    // Mine innsatser
    const mineTotal = t.myBets.reduce((s, b) => s + b.amount, 0);
    const LABEL = { red: 'Rød', black: 'Svart', even: 'Partall', odd: 'Oddetall' };
    $('rl-mine').textContent = mineTotal ? `Dine innsatser: ${t.myBets.map((b) => `${LABEL[b.type]} ${b.amount}`).join(' · ')} (maks ${t.maxBet} per runde)` : '';
    $('rl-clear').classList.toggle('hidden', !(t.phase === 'betting' && mineTotal));
    renderChips();

    // Resultat for meg
    if (t.phase === 'result' && t.last && t.round !== settledRound) {
      if (settledRound !== undefined && mineTotal) {
        const won = t.last.myWin;
        if (won > 0 && window.celebrate) {
          celebrate({ tier: won >= 200 ? 'big' : 'win', amount: won, icon: colorOf(t.number) === 'red' ? '🔴' : colorOf(t.number) === 'black' ? '⚫' : '🟢', sub: `${t.number} ${NAME[colorOf(t.number)]}! Innsats ${mineTotal} → ${won} tilbake` });
          msg(`🎉 ${t.number} ${NAME[colorOf(t.number)]}! Du vant ${won} cash.`, 'win');
        } else {
          msg(`${t.number} ${NAME[colorOf(t.number)]}. Du tapte ${mineTotal} cash.`, 'lose');
          if (window.loseNudge) loseNudge($('rl-result'));
        }
      }
      settledRound = t.round;
    } else if (t.phase !== 'result' && settledRound === undefined) settledRound = null;
    if (t.phase === 'betting' && $('rl-result').textContent && !mineTotal) msg('');
  }

  function renderChips() {
    const wrap = $('rl-chips');
    wrap.innerHTML = '';
    CHIPS.filter((c) => c >= t.minBet && c <= t.maxBet).forEach((c) => {
      const b = el('button', `chip${c === chip ? ' active' : ''}`, String(c));
      b.type = 'button';
      b.disabled = !me || c > me.flus;
      b.addEventListener('click', () => {
        chip = c;
        renderChips();
      });
      wrap.appendChild(b);
    });
    $('rl-chip').textContent = chip;
  }

  async function send(path, body) {
    if (busy) return;
    busy = true;
    try {
      const r = await api(path, body);
      t = r.table;
      me = r.me;
      if (window.casinoSetWallet) window.casinoSetWallet(r.me);
      render();
    } catch (err) {
      msg(err.message, 'lose');
    }
    busy = false;
  }

  document.querySelectorAll('.rl-spot').forEach((spot) => spot.addEventListener('click', () => {
    msg('');
    send('/api/roulette/bet', { type: spot.dataset.type, amount: chip });
  }));
  $('rl-clear').addEventListener('click', () => send('/api/roulette/clear', {}));

  async function load() {
    try {
      const r = await api('/api/roulette');
      t = r.table;
      me = r.me;
      if (r.me && window.casinoSetWallet) window.casinoSetWallet(r.me);
      // Kommer man inn midt i et spinn (første lasting), står hjulet bare på tallet
      if (!loaded && t.phase === 'spinning') spunRound = t.round;
      loaded = true;
      render();
    } catch { /* ignorer */ }
  }
  window.refreshRoulette = load;

  draw();
  onLive('roulette', () => !busy && load());
  setInterval(() => t && t.phase === 'betting' && render(), 1000);
  load();
})();
