'use strict';

// Arena: små PvP-spill om cash, spinn eller pils.
// Utfordreren spiller sin del først; motstanderen får varsel, spiller, og vinneren tar potten.
(function () {
  const $ = (id) => document.getElementById(id);
  let data = null;
  let game = 'dice';
  let stakeType = 'cash';
  let stake = 50;
  let busy = false;
  const STEPS = { cash: [10, 25, 50, 100, 200, 500], spins: [1, 2, 3, 4, 5], beer: [1, 2] };

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

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const balanceOf = (type) => (!data ? 0 : type === 'cash' ? data.me.flus : type === 'spins' ? data.me.spinsLeft : data.me.beersOwed);
  const LABEL = { cash: 'cash 💰', spins: 'spinn 🎡', beer: 'pils 🍺' };

  function msg(text, kind = '') {
    $('msg').textContent = text;
    $('msg').className = `result ${kind}`;
  }

  // ---------- Spillene ----------
  const overlay = $('overlay');
  const box = $('box');
  function show(html) {
    box.innerHTML = html;
    overlay.classList.remove('hidden');
  }
  function hide() {
    overlay.classList.add('hidden');
    box.innerHTML = '';
  }

  async function playDice() {
    show('<div class="ag-big dice-roll">🎲🎲</div><p>Terningene kastes …</p>');
    await sleep(1100);
    return {};
  }

  async function playReaction() {
    const { sessionId } = await api('/api/arena/start', { game: 'reaction' });
    const times = [];
    for (let round = 1; round <= 3; round++) {
      // eslint-disable-next-line no-await-in-loop
      times.push(await reactionRound(round));
      // eslint-disable-next-line no-await-in-loop
      await sleep(900);
    }
    const shown = times.map((t) => (t < 0 ? 'tjuvstart' : `${Math.round(t)} ms`)).join(' · ');
    show(`<div class="ag-big">⚡</div><p>${shown}</p>`);
    await sleep(1200);
    return { sessionId, times };
  }

  function reactionRound(round) {
    return new Promise((resolve) => {
      show(`<p class="muted">Runde ${round} av 3</p><div class="react-pad wait" id="pad">Vent på grønt …</div>`);
      const pad = $('pad');
      let greenAt = 0;
      let done = false;
      const timer = setTimeout(() => {
        greenAt = performance.now();
        pad.className = 'react-pad go';
        pad.textContent = 'TRYKK!';
      }, 1500 + Math.random() * 2000);
      pad.addEventListener('pointerdown', () => {
        if (done) return;
        done = true;
        if (!greenAt) {
          clearTimeout(timer);
          pad.className = 'react-pad foul';
          pad.textContent = 'Tjuvstart! 😬';
          return setTimeout(() => resolve(-1), 700);
        }
        const t = performance.now() - greenAt;
        pad.textContent = `${Math.round(t)} ms`;
        resolve(t);
      });
    });
  }

  async function playMath() {
    const { sessionId, questions } = await api('/api/arena/start', { game: 'math' });
    const answers = [];
    const start = performance.now();
    for (let i = 0; i < questions.length; i++) {
      // eslint-disable-next-line no-await-in-loop
      answers.push(await mathQuestion(questions[i], i, questions.length, start));
    }
    return { sessionId, answers };
  }

  function mathQuestion(q, i, n, start) {
    return new Promise((resolve) => {
      show(`<p class="muted">Regnestykke ${i + 1} av ${n} · <span id="clock">0.0</span> s</p>
        <div class="ag-big math-q">${q} = ?</div>
        <form id="mform" class="math-form"><input id="mans" type="number" inputmode="numeric" autocomplete="off" required><button type="submit">${i + 1 < n ? 'Neste' : 'Ferdig'}</button></form>`);
      const tick = setInterval(() => {
        const c = $('clock');
        if (c) c.textContent = ((performance.now() - start) / 1000).toFixed(1);
      }, 100);
      $('mans').focus();
      $('mform').addEventListener('submit', (e) => {
        e.preventDefault();
        clearInterval(tick);
        resolve(Number($('mans').value));
      });
    });
  }

  const PLAY = { dice: playDice, reaction: playReaction, math: playMath };

  // ---------- Utfordre ----------
  $('go').addEventListener('click', async () => {
    if (busy) return;
    const opponent = $('opponent').value;
    if (!opponent) return msg('Velg en motstander først.', 'lose');
    if (balanceOf(stakeType) < stake) return msg(`Du har ikke ${stake} ${LABEL[stakeType]}.`, 'lose');
    busy = true;
    msg('');
    try {
      const payload = await PLAY[game]();
      const r = await api('/api/arena/challenge', { game, opponent, stakeType, stake, ...payload });
      hide();
      msg(`✅ Utfordringen er sendt til ${opponent}! ${r.challenge.cDetail ? `Ditt resultat: ${r.challenge.cDetail}.` : ''}`, 'win');
      await load();
    } catch (err) {
      hide();
      msg(err.message, 'lose');
    }
    busy = false;
  });

  async function respond(a, decline) {
    if (busy) return;
    busy = true;
    try {
      if (decline) {
        await api('/api/arena/respond', { id: a.id, decline: true });
      } else {
        const payload = await PLAY[a.game]();
        const r = await api('/api/arena/respond', { id: a.id, ...payload });
        const c = r.challenge;
        show(`<div class="ag-big">${r.won ? '🏆' : r.tie ? '🤝' : '😬'}</div>
          <p><b>Du:</b> ${c.oDetail}<br><b>${c.challenger}:</b> ${c.cDetail}</p>
          <p class="arena-result ${r.won ? 'win' : r.tie ? '' : 'lose'}">${r.result}</p>
          <button type="button" id="close-res">OK</button>`);
        $('close-res').addEventListener('click', hide);
        if (r.won && window.celebrate) {
          celebrate({
            tier: c.stakeType === 'beer' ? 'beer' : c.stake * (c.stakeType === 'cash' ? 1 : 50) >= 200 ? 'big' : 'win',
            amount: c.stakeType === 'cash' ? c.stake * 2 : 0,
            title: c.stakeType === 'beer' ? `+${c.stake} PILS!` : 'DU VANT!',
            icon: c.icon,
            sub: c.stakeType === 'spins' ? `+${c.stake * 2} spinn tilbake (${c.stake} fra ${c.challenger})` : c.stakeType === 'beer' ? `Du vant ${c.stake} pils fra ${c.challenger}. Løs den inn i baren 🍻` : `${c.oDetail} mot ${c.cDetail}`,
          });
        }
      }
      await load();
    } catch (err) {
      hide();
      alert(err.message);
    }
    busy = false;
  }

  async function cancel(a) {
    if (!confirm('Trekke tilbake utfordringen? Du får innsatsen tilbake.')) return;
    try {
      await api('/api/arena/cancel', { id: a.id });
      await load();
    } catch (err) {
      alert(err.message);
    }
  }

  // ---------- Visning ----------
  function row(a, kind) {
    const other = kind === 'in' ? a.challenger : a.opponent;
    const r = el('div', 'arena-row');
    r.append(avatarEl(data.avatars[other], other, 36));
    const body = el('div', 'ar-body');
    if (kind === 'recent') {
      const head = a.winner ? `${a.winner} vant ${a.stakeText}` : `Uavgjort (${a.stakeText})`;
      body.append(el('b', '', `${a.icon} ${head}`), el('small', 'muted', `${a.challenger}: ${a.cDetail} · ${a.opponent}: ${a.oDetail}`));
    } else {
      body.append(el('b', '', `${a.icon} ${a.gameName} om ${a.stakeText}`), el('small', 'muted', kind === 'in' ? `fra ${a.challenger}` : `mot ${a.opponent}${a.cDetail ? ` · ${a.cDetail}` : ''}`));
    }
    r.appendChild(body);
    if (kind === 'in') {
      const ok = el('button', 'small-btn', 'Spill');
      ok.type = 'button';
      ok.addEventListener('click', () => respond(a, false));
      const no = el('button', 'secondary small-btn', 'Nei');
      no.type = 'button';
      no.addEventListener('click', () => respond(a, true));
      r.append(ok, no);
    } else if (kind === 'out') {
      const x = el('button', 'secondary small-btn', 'Trekk');
      x.type = 'button';
      x.addEventListener('click', () => cancel(a));
      r.append(x);
    }
    return r;
  }

  function list(id, items, kind, empty) {
    const box2 = $(id);
    box2.innerHTML = '';
    if (!items.length) box2.appendChild(el('p', 'muted', empty));
    items.forEach((a) => box2.appendChild(row(a, kind)));
  }

  function renderStake() {
    const steps = STEPS[stakeType];
    if (!steps.includes(stake)) stake = { cash: 50, spins: 1, beer: 1 }[stakeType];
    $('stake-amount').textContent = `${stake} ${LABEL[stakeType]}`;
    const have = balanceOf(stakeType);
    $('balance').textContent = `Du har ${have} ${LABEL[stakeType]}. Vinneren tar ${stake * 2}.`;
    $('go').disabled = have < stake;
    document.querySelectorAll('#stake-type .sg').forEach((b) => b.classList.toggle('active', b.dataset.type === stakeType));
  }

  function render() {
    const sel = $('opponent');
    const keep = sel.value;
    sel.innerHTML = data.people.length ? '' : '<option value="">Ingen andre deltakere ennå</option>';
    data.people.forEach((p) => {
      const o = el('option', '', p.name);
      o.value = p.name;
      sel.appendChild(o);
    });
    if (keep) sel.value = keep;
    $('incoming-card').classList.toggle('hidden', !data.incoming.length);
    list('incoming', data.incoming, 'in', '');
    list('outgoing', data.outgoing, 'out', 'Ingen utfordringer venter.');
    list('recent', data.recent, 'recent', 'Ingen kamper ennå. Bli den første!');
    renderStake();
  }

  document.querySelectorAll('#game-pick .ag').forEach((b) => b.addEventListener('click', () => {
    game = b.dataset.game;
    document.querySelectorAll('#game-pick .ag').forEach((x) => x.classList.toggle('active', x === b));
  }));
  document.querySelectorAll('#stake-type .sg').forEach((b) => b.addEventListener('click', () => {
    stakeType = b.dataset.type;
    renderStake();
  }));
  $('stake-minus').addEventListener('click', () => {
    const s = STEPS[stakeType];
    stake = s[Math.max(0, s.indexOf(stake) - 1)];
    renderStake();
  });
  $('stake-plus').addEventListener('click', () => {
    const s = STEPS[stakeType];
    stake = s[Math.min(s.length - 1, s.indexOf(stake) + 1)];
    renderStake();
  });

  async function load() {
    try {
      data = await api('/api/arena');
      render();
    } catch (err) {
      msg(err.message, 'lose');
    }
  }

  // Live: noen utfordret deg eller svarte
  onLive('arena', () => !busy && load());
  onLive('notify', () => !busy && load());
  // Lenke med ?mot=Navn velger motstanderen
  const pre = new URLSearchParams(location.search).get('mot');
  load().then(() => {
    if (pre && data) $('opponent').value = pre;
  });
})();
