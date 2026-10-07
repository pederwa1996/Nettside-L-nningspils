'use strict';

// Arena: små PvP-spill om cash, spinn eller pils.
// Utfordreren spiller sin del først; motstanderen får varsel, spiller, og vinneren tar potten.
(function () {
  const $ = (id) => document.getElementById(`ar-${id}`); // arenaen ligger på PvP-siden med egne id-er
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

  // ---------- 🎲 Terninger: begeret ristes, terningene ruller ut og spretter ----------
  const PIPS = { 1: [5], 2: [1, 9], 3: [1, 5, 9], 4: [1, 3, 7, 9], 5: [1, 3, 5, 7, 9], 6: [1, 3, 4, 6, 7, 9] };
  function dieHtml(n, cls = '') {
    return `<div class="die ${cls}" data-n="${n}">${[1, 2, 3, 4, 5, 6, 7, 8, 9].map((i) => `<i class="${PIPS[n].includes(i) ? 'pip' : ''}"></i>`).join('')}</div>`;
  }
  function setDie(d, n) {
    d.dataset.n = n;
    [...d.children].forEach((p, i) => p.classList.toggle('pip', PIPS[n].includes(i + 1)));
  }
  const parseDice = (detail) => {
    const m = /(\d)\s*\+\s*(\d)/.exec(detail || '');
    return m ? [Number(m[1]), Number(m[2])] : null;
  };
  // Terningene triller ut og lander på verdiene (ca. 2 s)
  async function rollDiceInto(wrap, values) {
    wrap.innerHTML = `${dieHtml(1 + Math.floor(Math.random() * 6), 'rolling')}${dieHtml(1 + Math.floor(Math.random() * 6), 'rolling r2')}`;
    const dice = [...wrap.querySelectorAll('.die')];
    if (window.sfx) sfx.play('diceroll');
    const end = performance.now() + 1700;
    let last = 0;
    await new Promise((resolve) => {
      (function frame(now) {
        // Bytt side ofte i starten, sjeldnere mot slutten (som ekte terninger som roer seg)
        const left = end - now;
        const every = left > 900 ? 70 : left > 400 ? 140 : 260;
        if (now - last > every) {
          last = now;
          dice.forEach((d) => setDie(d, 1 + Math.floor(Math.random() * 6)));
        }
        if (now < end) requestAnimationFrame(frame);
        else resolve();
      })(performance.now());
    });
    dice.forEach((d, i) => {
      setDie(d, values[i]);
      d.classList.remove('rolling');
      d.classList.add('landed');
    });
    if (window.sfx) sfx.play('dicestop');
    await sleep(350);
  }
  function countUp(el, to, ms = 600) {
    const t0 = performance.now();
    return new Promise((resolve) => {
      (function f(now) {
        const p = Math.min(1, (now - t0) / ms);
        el.textContent = Math.round(to * p);
        if (p < 1) requestAnimationFrame(f);
        else resolve();
      })(t0);
    });
  }

  // Utfordreren: rist begeret og slå det i bordet. Terningene er hemmelige til motstanderen kaster.
  async function playDice() {
    show(`<p class="dice-title">🎲 Terningduell</p>
      <div class="dice-table"><div class="dice-cup shaking"></div><div class="dice-row" id="ar-dice-me"></div></div>
      <p class="dice-status" id="ar-dice-status">Rister begeret …</p>`);
    if (window.sfx) sfx.play('diceshake');
    await sleep(1600);
    const cup = box.querySelector('.dice-cup');
    cup.classList.remove('shaking');
    cup.classList.add('slam');
    if (window.sfx) sfx.play('dicestop');
    $('dice-status').textContent = 'Kastet! Terningene ligger skjult under begeret 🤫';
    await sleep(1300);
    return {};
  }

  // Motstanderen: begeret til utfordreren løftes, så kaster du selv
  async function showDiceDuel(c, me) {
    const theirs = parseDice(c.cDetail);
    const mine = parseDice(c.oDetail);
    if (!theirs || !mine) return;
    show(`<p class="dice-title">🎲 Terningduell</p>
      <div class="dice-side"><span class="ds-name">${c.challenger.split(' ')[0]}</span><div class="dice-table small"><div class="dice-cup"></div><div class="dice-row" id="ar-dice-them"></div></div><b class="ds-sum" id="ar-sum-them">?</b></div>
      <div class="dice-vs">VS</div>
      <div class="dice-side"><span class="ds-name">Deg</span><div class="dice-table"><div class="dice-cup shaking"></div><div class="dice-row" id="ar-dice-me"></div></div><b class="ds-sum" id="ar-sum-me">?</b></div>
      <p class="dice-status" id="ar-dice-status">Rister begeret …</p>`);
    // Løft begeret til motstanderen
    $('dice-them').innerHTML = dieHtml(theirs[0], 'landed') + dieHtml(theirs[1], 'landed');
    const cups = box.querySelectorAll('.dice-cup');
    await sleep(500);
    cups[0].classList.add('lift');
    await countUp($('sum-them'), theirs[0] + theirs[1], 400);
    if (window.sfx) sfx.play('diceshake');
    await sleep(1000);
    cups[1].classList.remove('shaking');
    cups[1].classList.add('lift');
    $('dice-status').textContent = 'Terningene ruller …';
    await rollDiceInto($('dice-me'), mine);
    await countUp($('sum-me'), mine[0] + mine[1], 500);
    const a = theirs[0] + theirs[1];
    const b = mine[0] + mine[1];
    $('dice-status').textContent = b > a ? '🏆 Du vant!' : b < a ? `😬 ${c.challenger.split(' ')[0]} vant` : '🤝 Uavgjort';
    $('dice-status').className = `dice-status ${b > a ? 'win' : b < a ? 'lose' : ''}`;
    await sleep(1100);
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
      show(`<p class="muted">Runde ${round} av 3</p><div class="react-pad wait" id="ar-pad">Vent på grønt …</div>`);
      const pad = $('pad');
      let greenAt = 0;
      let done = false;
      const timer = setTimeout(() => {
        greenAt = performance.now();
        pad.className = 'react-pad go';
        pad.textContent = 'TRYKK!';
        if (window.sfx) sfx.play('go');
      }, 1500 + Math.random() * 2000);
      pad.addEventListener('pointerdown', () => {
        if (done) return;
        done = true;
        if (!greenAt) {
          clearTimeout(timer);
          pad.className = 'react-pad foul';
          pad.textContent = 'Tjuvstart! 😬';
          if (window.sfx) sfx.play('buzzer');
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
      show(`<p class="muted">Regnestykke ${i + 1} av ${n} · <span id="ar-clock">0.0</span> s</p>
        <div class="ag-big math-q">${q} = ?</div>
        <form id="ar-mform" class="math-form"><input id="ar-mans" type="number" inputmode="numeric" autocomplete="off" required><button type="submit">${i + 1 < n ? 'Neste' : 'Ferdig'}</button></form>`);
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
        const payload = a.game === 'dice' ? {} : await PLAY[a.game]();
        const r = await api('/api/arena/respond', { id: a.id, ...payload });
        const c = r.challenge;
        if (a.game === 'dice') await showDiceDuel(c);
        show(`<div class="ag-big">${r.won ? '🏆' : r.tie ? '🤝' : '😬'}</div>
          <p><b>Du:</b> ${c.oDetail}<br><b>${c.challenger}:</b> ${c.cDetail}</p>
          <p class="arena-result ${r.won ? 'win' : r.tie ? '' : 'lose'}">${r.result}</p>
          <button type="button" id="ar-close-res">OK</button>`);
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
    document.querySelectorAll('#ar-stake-type .sg').forEach((b) => b.classList.toggle('active', b.dataset.type === stakeType));
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

  document.querySelectorAll('#ar-game-pick .ag').forEach((b) => b.addEventListener('click', () => {
    game = b.dataset.game;
    document.querySelectorAll('#ar-game-pick .ag').forEach((x) => x.classList.toggle('active', x === b));
  }));
  document.querySelectorAll('#ar-stake-type .sg').forEach((b) => b.addEventListener('click', () => {
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

  // Knappene øverst på PvP-siden velger spillet (terning, reaksjon, hoderegning)
  const INFO = {
    dice: ['🎲 Terningduell', 'Begge kaster to terninger. Høyest sum vinner potten. Ren flaks, ren spenning.'],
    reaction: ['⚡ Reaksjon', 'Trykk så fort du kan når feltet blir grønt. 3 runder, laveste snitt vinner. Tjuvstart gir straff.'],
    math: ['🧠 Hoderegning', '6 regnestykker. Flest riktige vinner, og ved likt vinner den raskeste.'],
  };
  window.arenaSetGame = (g) => {
    if (!INFO[g]) return;
    game = g;
    $('title').textContent = INFO[g][0];
    $('rules').textContent = INFO[g][1];
    $('go').textContent = { dice: '🎲 Kast og utfordre', reaction: '⚡ Start og utfordre', math: '🧠 Start og utfordre' }[g];
    document.querySelectorAll('#ar-game-pick .ag').forEach((x) => x.classList.toggle('active', x.dataset.game === g));
  };
  window.arenaData = () => data;
  // PvP-siden kan ha valgt fane før arena.js var lastet
  if (['dice', 'reaction', 'math'].includes(document.body.dataset.tab)) window.arenaSetGame(document.body.dataset.tab);

  async function load() {
    try {
      data = await api('/api/arena');
      render();
      if (window.onArenaData) window.onArenaData(data);
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
