'use strict';

(function () {
  const $ = (id) => document.getElementById(id);
  let data = null;
  let busy = false;
  let wheelRotation = 0;
  let wheelSpinning = false;

  async function api(path, body) {
    const res = await fetch(path, body
      ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }
      : {});
    const json = await res.json();
    if (!res.ok) throw new Error(json.error || 'Noe gikk galt');
    return json;
  }

  const flusWord = (n) => `${Math.abs(n)} cash`;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  function setWallet(me) {
    data.me = me;
    $('my-spins').textContent = me.spinsLeft;
    $('my-flus').textContent = me.flus;
    $('my-beers').textContent = me.beersOwed;
    document.querySelectorAll('.spin-price').forEach((el) => (el.textContent = data.spinPrice));
    $('slot-pull').disabled = busy || me.spinsLeft < 1;
    $('slot-pull-flus').disabled = busy || me.flus < data.spinPrice;
    if (!wheelSpinning) {
      $('spin-btn').disabled = me.spinsLeft <= 0;
      $('spin-flus-btn').disabled = me.flus < data.spinPrice;
      $('spin-btn').textContent = me.spinsLeft > 0 ? `Spinn! 🎡 (${me.spinsLeft} igjen)` : 'Ingen spinn igjen';
    }
    $('spin-total').textContent = me.spinWins ? `Du har vunnet ${me.spinWins} øl på hjulet totalt 🍺` : '';
  }
  // Bordene (blackjack, roulette, poker) oppdaterer lommeboken øverst
  window.casinoSetWallet = (me) => data && me && setWallet(me);

  // ---------- Automat ----------
  const SYMBOLS = ['🍒', '🍋', '🔔', '⭐', '7️⃣', '💎', '🍺'];
  const SYMBOL_H = 84;
  const strips = [...document.querySelectorAll('.reel .strip')];

  function setReel(strip, symbols) {
    strip.innerHTML = '';
    symbols.forEach((s) => {
      const d = document.createElement('div');
      d.className = 'symbol';
      d.textContent = s;
      strip.appendChild(d);
    });
  }

  function initReels() {
    strips.forEach((st) => setReel(st, [SYMBOLS[Math.floor(Math.random() * SYMBOLS.length)]]));
  }

  // Ruller hvert hjul gjennom tilfeldige symboler og stopper på resultatet, ett etter ett
  function spinReels(result) {
    return Promise.all(strips.map((st, i) => {
      const filler = Array.from({ length: 18 + i * 6 }, () => SYMBOLS[Math.floor(Math.random() * SYMBOLS.length)]);
      const current = st.lastElementChild ? st.lastElementChild.textContent : SYMBOLS[0];
      setReel(st, [current, ...filler, result[i]]);
      st.style.transition = 'none';
      st.style.transform = 'translateY(0)';
      void st.offsetHeight; // tving omtegning før animasjonen starter
      const dur = 1.2 + i * 0.5;
      st.style.transition = `transform ${dur}s cubic-bezier(0.12, 0.7, 0.2, 1)`;
      st.style.transform = `translateY(-${(filler.length + 1) * SYMBOL_H}px)`;
      return sleep(dur * 1000 + 50);
    })).then(() => strips.forEach((st, i) => {
      st.style.transition = 'none';
      st.style.transform = 'translateY(0)';
      setReel(st, [result[i]]);
    }));
  }

  async function pullSlot(pay) {
    if (busy) return;
    busy = true;
    $('slot-pull').disabled = true;
    $('slot-pull-flus').disabled = true;
    $('slot-result').textContent = '';
    $('slot-result').className = 'result';
    document.querySelector('.slot-machine').classList.remove('jackpot');
    try {
      const r = await api('/api/casino/slot', { pay });
      await spinReels(r.reels);
      setWallet(r.me);
      if (r.beer) {
        $('slot-result').textContent = '🍺🍺🍺 TRE PILS PÅ RAD! Du har vunnet en pils! Hent den i baren 🍻';
        $('slot-result').classList.add('win');
        document.querySelector('.slot-machine').classList.add('jackpot');
        beerWin('🍺🍺🍺 Tre pils på rad på automaten!');
      } else if (r.flus) {
        $('slot-result').textContent = `🎉 Du vant ${flusWord(r.flus)}!`;
        $('slot-result').classList.add('win');
        celebrate({ tier: r.flus >= 100 ? 'big' : 'win', amount: r.flus, icon: r.reels[0], sub: r.reels.join(' ') });
      } else {
        $('slot-result').textContent = 'Ingen gevinst denne gangen.';
        $('slot-result').classList.add('lose');
        loseNudge($('slot-result'));
      }
    } catch (err) {
      $('slot-result').textContent = err.message;
      $('slot-result').classList.add('lose');
    }
    busy = false;
    if (data.me) setWallet(data.me);
    loadLog();
  }

  $('slot-pull').addEventListener('click', () => pullSlot('spin'));
  $('slot-pull-flus').addEventListener('click', () => pullSlot('flus'));

  function renderPaytable(table) {
    const ul = $('paytable');
    ul.innerHTML = '';
    table.forEach((o) => {
      const li = document.createElement('li');
      const sym = o.id === 'cherry2' ? '🍒🍒 (to kirsebær)' : o.symbol.repeat(3);
      li.innerHTML = '<span class="pt-sym"></span><span class="pt-win"></span>';
      li.querySelector('.pt-sym').textContent = sym;
      li.querySelector('.pt-win').textContent = o.beer ? '1 pils 🍺' : `${o.flus} cash`;
      ul.appendChild(li);
    });
  }

  // Pils vunnet: størst feiring, med snarvei til baren
  function beerWin(sub) {
    celebrate({ tier: 'beer', sub: `${sub} Løs den inn i baren, så kommer spillmesteren med den til bordet.`, action: { label: '🍻 Til baren', onClick: () => showTab('bar') } });
  }

  // ---------- Lykkehjulet ----------
  const SEGMENTS = 20;
  const BEER_SEGMENTS = [0, 7, 14]; // 3 av 20 = 15 %
  const LOSE_SEGMENT = 10; // 1 av 20 = 5 %: mister et spinn
  const MISS_LABELS = ['Bom', 'Neste gang', 'Vann', 'Nope', 'Snart', 'Prøv igjen'];
  const segments = Array.from({ length: SEGMENTS }, (_, i) => {
    if (BEER_SEGMENTS.includes(i)) return { kind: 'beer', label: '🍺 ØL!' };
    if (i === LOSE_SEGMENT) return { kind: 'lose', label: '💀 −1 SPINN' };
    return { kind: 'miss', label: MISS_LABELS[i % MISS_LABELS.length] };
  });

  function drawWheel() {
    const canvas = $('wheel');
    const ctx = canvas.getContext('2d');
    const r = canvas.width / 2;
    const seg = (Math.PI * 2) / SEGMENTS;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    segments.forEach((s, i) => {
      const start = -Math.PI / 2 + i * seg;
      ctx.beginPath();
      ctx.moveTo(r, r);
      ctx.arc(r, r, r - 6, start, start + seg);
      ctx.closePath();
      ctx.fillStyle = s.kind === 'beer' ? '#f5b301' : s.kind === 'lose' ? '#111111' : i % 2 ? '#5a0a14' : '#7a0d1c';
      ctx.fill();
      ctx.strokeStyle = '#d4a530';
      ctx.lineWidth = 3;
      ctx.stroke();
      ctx.save();
      ctx.translate(r, r);
      ctx.rotate(start + seg / 2);
      ctx.textAlign = 'right';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = s.kind === 'beer' ? '#2a1500' : s.kind === 'lose' ? '#ff4d6d' : '#fff3c4';
      ctx.font = s.kind === 'miss' ? '22px system-ui, sans-serif' : 'bold 24px system-ui, sans-serif';
      if (s.kind === 'beer') ctx.font = 'bold 30px system-ui, sans-serif';
      ctx.fillText(s.label, r - 24, 0);
      ctx.restore();
    });
    ctx.beginPath();
    ctx.arc(r, r, 40, 0, Math.PI * 2);
    ctx.fillStyle = '#f5b301';
    ctx.fill();
    ctx.font = '40px system-ui';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('🍺', r, r + 2);
  }

  function wheelSpinTo(kind) {
    const candidates = segments.map((s, i) => (s.kind === kind ? i : -1)).filter((i) => i >= 0);
    const target = candidates[Math.floor(Math.random() * candidates.length)];
    const segDeg = 360 / SEGMENTS;
    const jitter = (Math.random() - 0.5) * segDeg * 0.7;
    // Segment i ligger (i + 0.5) * segDeg med klokka fra toppen; roter så det havner under pila.
    const wanted = (360 - (target + 0.5) * segDeg + jitter + 360) % 360;
    const current = ((wheelRotation % 360) + 360) % 360;
    wheelRotation += 360 * 6 + ((wanted - current + 360) % 360);
    $('wheel').style.transform = `rotate(${wheelRotation}deg)`;
    return sleep(5200);
  }

  async function onWheelSpin(pay) {
    if (wheelSpinning) return;
    wheelSpinning = true;
    $('spin-btn').disabled = true;
    $('spin-flus-btn').disabled = true;
    $('spin-result').textContent = '';
    $('spin-result').className = 'result';
    try {
      const result = await api('/api/spin', { pay });
      await wheelSpinTo(result.win ? 'beer' : result.lose ? 'lose' : 'miss');
      $('spin-result').textContent = result.win
        ? '🎉 Gratulerer! Du vant en øl! 🍺 Hent den i baren.'
        : result.lose
          ? (result.lostSpin ? '💀 Au! Du traff −1 SPINN og mistet et spinn.' : '💀 Du traff −1 SPINN, men hadde ingen spinn å miste. Puh!')
          : '😢 Ingen øl denne gangen.';
      $('spin-result').classList.add(result.win ? 'win' : 'lose');
      if (result.win) beerWin('Lykkehjulet ga deg en ekte pils!');
      else loseNudge($('spin-result'));
      wheelSpinning = false;
      setWallet(result.me);
    } catch (err) {
      $('spin-result').textContent = err.message;
      $('spin-result').classList.add('lose');
      wheelSpinning = false;
      setWallet(data.me);
    }
  }
  $('spin-btn').addEventListener('click', () => onWheelSpin('spin'));
  $('spin-flus-btn').addEventListener('click', () => onWheelSpin('flus'));

  // ---------- Felles ----------
  const TAB_HASH = { wheel: 'hjul', slot: 'automat', roulette: 'roulette', blackjack: 'blackjack', poker: 'poker', bar: 'baren' };

  function showTab(name) {
    document.body.dataset.tab = name; // hver fane har sitt eget tema
    if (window.updatePresenceRoom) window.updatePresenceRoom();
    document.querySelectorAll('.tab').forEach((x) => x.classList.toggle('active', x.dataset.tab === name));
    Object.keys(TAB_HASH).forEach((t) => $(`tab-${t}`).classList.toggle('hidden', t !== name));
    if (name === 'poker' && window.refreshPoker) window.refreshPoker();
    if (name === 'blackjack' && window.refreshBj) window.refreshBj();
    if (name === 'roulette' && window.refreshRoulette) window.refreshRoulette();
    history.replaceState(null, '', `#${TAB_HASH[name]}`);
    // Baren har sin egen oversikt over flus og bestillinger: hent den på nytt
    if (name === 'bar' && window.refreshBar) window.refreshBar();
    // Oppdater lommeboken når man kommer tilbake fra baren (flus kan ha blitt brukt der)
    if (name !== 'bar') api('/api/casino').then((d) => d.me && setWallet(d.me)).catch(() => {});
  }
  document.querySelectorAll('.tab').forEach((t) => t.addEventListener('click', () => showTab(t.dataset.tab)));
  // Lenker til en annen fane på samme side (f.eks. #roulette) bytter fane
  window.addEventListener('hashchange', () => {
    const tab = Object.keys(TAB_HASH).find((t) => `#${TAB_HASH[t]}` === location.hash);
    if (tab && data && data.me) showTab(tab);
  });
  // «Pils til gode» i lommeboken tar deg rett til baren
  $('wallet-beers').addEventListener('click', () => { showTab('bar'); window.scrollTo({ top: 0, behavior: 'smooth' }); });

  // ---------- Live gevinster ----------
  const GAME_ICON = { roulette: '🔴', blackjack: '🃏', slot: '🎰', poker: '♠️' };
  const GAME_NAME = { roulette: 'roulette', blackjack: 'blackjack', slot: 'automaten', poker: 'pokerbordet' };

  function winText(e) {
    if (e.beer) return 'fikk 🍺🍺🍺 og vant en pils!';
    if (e.game === 'blackjack' && e.detail === 'blackjack') return `fikk BLACKJACK og vant ${flusWord(e.won)}`;
    if (e.game === 'poker') return `vant potten på pokerbordet${e.detail ? ` med ${e.detail.toLowerCase()}` : ''}`;
    return `vant på ${GAME_NAME[e.game]}${e.game === 'slot' ? ` ${e.detail}` : ''}`;
  }

  function winRow(e, fresh) {
    const li = document.createElement('li');
    li.className = 'win-item' + (fresh ? ' fresh' : '');
    const link = document.createElement('a');
    link.href = `/profil.html?navn=${encodeURIComponent(e.name)}`;
    link.appendChild(avatarEl(e.avatar || (data && data.avatars[e.name]), e.name, 34));
    const text = document.createElement('div');
    text.className = 'win-text';
    const name = document.createElement('strong');
    name.textContent = e.name;
    const time = document.createElement('div');
    time.className = 'win-time muted';
    time.textContent = `${GAME_ICON[e.game]} ${timeOfDay(e.at)}`;
    text.append(name, document.createTextNode(` ${winText(e)}`), time);
    const amount = document.createElement('span');
    amount.className = 'win-amount';
    amount.textContent = e.beer ? '+1 🍺' : `+${e.won}`;
    li.append(link, text, amount);
    return li;
  }

  function renderLog(log) {
    const ul = $('casino-log');
    ul.innerHTML = '';
    if (!log.length) ul.innerHTML = '<li class="muted">Ingen gevinster ennå. Bli den første!</li>';
    log.forEach((e) => ul.appendChild(winRow(e, false)));
  }

  function showToast(e) {
    const t = document.createElement('div');
    t.className = 'win-toast';
    const msg = document.createElement('span');
    msg.textContent = `${e.name} ${e.beer ? 'vant en pils på automaten! 🍺🍺🍺' : `vant ${flusWord(e.won)} på ${GAME_NAME[e.game]}!`}`;
    t.append(avatarEl(e.avatar, e.name, 32), msg);
    $('win-toasts').appendChild(t);
    setTimeout(() => t.remove(), 4800);
    while ($('win-toasts').children.length > 3) $('win-toasts').firstChild.remove();
  }

  onLive('casino-win', (e) => {
    const ul = $('casino-log');
    const empty = ul.querySelector('.muted');
    if (empty) empty.remove();
    ul.prepend(winRow(e, true));
    while (ul.children.length > 10) ul.lastChild.remove();
    // Vis ikke toast for dine egne gevinster, de ser du allerede
    if (!data || !data.me || e.name !== data.me.name) showToast(e);
  });


  async function loadLog() {
    try {
      const d = await api('/api/casino');
      renderLog(d.log);
    } catch { /* ignorer */ }
  }

  async function init() {
    data = await api('/api/casino');
    $('not-joined').classList.toggle('hidden', !!data.me);
    $('casino').classList.toggle('hidden', !data.me);
    renderLog(data.log);
    if (!data.me) return;
    setWallet(data.me);
    renderPaytable(data.slotTable);
    initReels();
    drawWheel();
    $('chance').textContent = `${Math.round(data.wheelChance * 100)} %`;
    $('lose-chance').textContent = `${Math.round(data.wheelLoseChance * 100)} %`;
    const fromHash = Object.keys(TAB_HASH).find((t) => `#${TAB_HASH[t]}` === location.hash);
    // Lenken bestemmer fanen (f.eks. #baren)
    if (fromHash) showTab(fromHash);
  }

  init();
  setInterval(() => !busy && loadLog(), 10000);
})();
