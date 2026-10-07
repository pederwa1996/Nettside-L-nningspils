'use strict';

(function () {
  const $ = (id) => document.getElementById(id);
  let data = null;
  let qty = 1;
  let busy = false;

  async function api(path, body) {
    const res = await fetch(path, body
      ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }
      : {});
    const json = await res.json();
    if (!res.ok) throw new Error(json.error || 'Noe gikk galt');
    return json;
  }

  function showMsg(text, kind = '') {
    $('msg').textContent = text;
    $('msg').className = 'result ' + kind;
  }

  const STATUS = {
    pending: ['⏳ Venter på spillmesteren', 'pending'],
    delivered: ['✅ Levert', 'delivered'],
    cancelled: ['❌ Kansellert', 'cancelled'],
  };

  // ---------- Glassene: ett per pils du kan bestille ----------
  function renderGlasses() {
    const me = data.me;
    const n = Math.min(me.beersOwed, data.maxPerOrder);
    const empty = me.beersOwed <= 0;
    $('bar-order').classList.toggle('hidden', empty);
    $('bar-empty').classList.toggle('hidden', !empty);
    if (empty) return;
    qty = Math.max(1, Math.min(qty, n));
    const wrap = $('tap-glasses');
    wrap.innerHTML = '';
    for (let i = 1; i <= n; i++) {
      const g = document.createElement('button');
      g.type = 'button';
      g.className = `glass${i <= qty ? ' on' : ''}`;
      g.setAttribute('aria-label', `${i} pils`);
      g.innerHTML = '<span class="g-beer"></span><span class="g-foam"></span>';
      g.addEventListener('click', () => {
        if (filling) return;
        qty = i;
        if (window.sfx) sfx.play('tap');
        renderGlasses();
      });
      wrap.appendChild(g);
    }
    $('th-text').textContent = `🍺 Hold inne for å tappe ${qty} pils`;
  }

  function render() {
    const me = data.me;
    $('not-joined').classList.toggle('hidden', !!me);
    $('bar').classList.toggle('hidden', !me);
    if (!me) return;
    $('my-beers').textContent = me.beersOwed;
    $('my-flus').textContent = me.flus;
    const w = data.won;
    const total = w.wheel + w.tickets + w.slot + (w.task || 0);
    $('won-info').textContent = total
      ? `Du har vunnet ${total} pils totalt: ${w.wheel} fra lykkehjulet, ${w.tickets} fra loddtrekningen, ${w.slot} fra automaten og ${w.task || 0} fra oppgaver.`
      : 'Du har ikke vunnet noen pils ennå. Prøv lykkehjulet eller automaten!';
    renderGlasses();

    const ul = $('orders');
    ul.innerHTML = '';
    if (!data.orders.length) ul.innerHTML = '<li class="muted">Ingen bestillinger ennå.</li>';
    data.orders.forEach((o) => {
      const li = document.createElement('li');
      const [label, cls] = STATUS[o.status];
      li.className = `order ${cls}`;
      const main = document.createElement('div');
      main.className = 'order-main';
      const title = document.createElement('strong');
      title.textContent = `${o.qty} × 🍺 ${o.pay === 'flus' ? `(${o.cost} cash)` : '(til gode)'}`;
      const meta = document.createElement('span');
      meta.className = 'muted';
      meta.textContent = `${timeOfDay(o.at)}${o.note ? ` · ${o.note}` : ''}`;
      const st = document.createElement('span');
      st.className = 'order-status';
      st.textContent = label;
      main.append(title, meta, st);
      li.appendChild(main);
      if (o.status === 'pending') {
        const cancel = document.createElement('button');
        cancel.className = 'secondary small-btn';
        cancel.textContent = 'Avbryt';
        cancel.addEventListener('click', () => act(async () => {
          await api('/api/bar/cancel', { id: o.id });
          showMsg('Bestillingen er avbrutt.');
        }));
        li.appendChild(cancel);
      }
      ul.appendChild(li);
    });
  }

  async function refresh() {
    try {
      data = await api('/api/bar');
      render();
    } catch (err) {
      console.error(err);
    }
  }

  async function act(fn) {
    if (busy) return;
    busy = true;
    try {
      await fn();
    } catch (err) {
      showMsg(err.message, 'lose');
    }
    busy = false;
    await refresh();
  }

  function order() {
    act(async () => {
      const n = qty;
      await api('/api/bar/order', { qty: n, pay: 'credit', note: $('note').value });
      showMsg(`🍻 Skål! ${n} pils er bestilt. Spillmesteren kommer med ${n > 1 ? 'dem' : 'den'} til bordet.`, 'win');
      slideBeer();
      if (window.sfx) sfx.play('cheers');
      qty = 1;
    });
  }

  // ---------- Hold inne kranen: glassene fylles opp, og når de er fulle bestilles pilsen ----------
  const FILL_MS = 1300;
  let filling = null;
  function startFill(e) {
    if (e) e.preventDefault();
    if (filling || busy || !data || !data.me || data.me.beersOwed < 1) return;
    const glasses = [...document.querySelectorAll('#tap-glasses .glass.on')];
    const start = performance.now();
    const total = FILL_MS + (glasses.length - 1) * 350;
    $('tap-handle').classList.add('pouring');
    $('th-text').textContent = '🍺 Tapper …';
    let lastSound = 0;
    filling = { raf: 0 };
    (function frame(now) {
      const p = Math.min(1, (now - start) / total);
      $('th-fill').style.width = `${p * 100}%`;
      glasses.forEach((g, i) => {
        const share = 1 / glasses.length;
        const gp = Math.max(0, Math.min(1, (p - i * share) / share));
        g.style.setProperty('--fill', gp);
      });
      // Litt sildring mens det tappes
      if (window.sfx && now - lastSound > 140) {
        lastSound = now;
        sfx.play('pour');
      }
      if (p >= 1) {
        stopFill(true);
        return;
      }
      filling.raf = requestAnimationFrame(frame);
    })(start);
  }
  function stopFill(done) {
    if (!filling) return;
    cancelAnimationFrame(filling.raf);
    filling = null;
    $('tap-handle').classList.remove('pouring');
    if (done === true) {
      order();
      return;
    }
    // Slapp for tidlig: glassene renner tilbake
    $('th-fill').style.width = '0%';
    document.querySelectorAll('#tap-glasses .glass').forEach((g) => g.style.setProperty('--fill', 0));
    $('th-text').textContent = `🍺 Hold inne for å tappe ${qty} pils`;
    showMsg('Hold inne kranen helt til glassene er fulle 🍺');
  }
  $('tap-handle').addEventListener('pointerdown', startFill);
  ['pointerup', 'pointerleave', 'pointercancel'].forEach((ev) => $('tap-handle').addEventListener(ev, () => stopFill(false)));
  $('tap-handle').addEventListener('contextmenu', (e) => e.preventDefault());
  // Tastatur: Enter/mellomrom bestiller med en gang
  $('tap-handle').addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      order();
    }
  });

  // Det tomme glasset vingler litt trist når man trykker på det
  $('be-glass').addEventListener('click', () => {
    const g = $('be-glass');
    g.classList.remove('wobble');
    void g.offsetWidth;
    g.classList.add('wobble');
    if (window.sfx) sfx.play('sad');
  });

  // ---------- Baren som scene: bartender og krakker ----------
  let admins = [];
  let lastRooms = {};
  fetch('/api/state').then((r) => r.json()).then((d) => {
    admins = d.admins || [];
    renderScene();
  }).catch(() => {});

  function renderScene() {
    const stoolsEl = document.getElementById('stools');
    if (!stoolsEl) return;
    const meName = data && data.me ? data.me.name : null;
    const here = [...(lastRooms['kasino-bar'] || []), ...(lastRooms.baren || [])];
    // Spillmesteren står bak disken hvis hen er i baren
    const bt = here.find((x) => admins.includes(x.name));
    const tender = document.getElementById('bartender');
    tender.innerHTML = '';
    if (bt) {
      tender.append(avatarEl(bt.avatar, bt.name, 46), Object.assign(document.createElement('span'), { textContent: `${bt.name.split(' ')[0]} 👑` }));
      tender.classList.remove('away');
    } else {
      tender.append(Object.assign(document.createElement('div'), { className: 'bartender-emoji', textContent: '🤵' }), Object.assign(document.createElement('span'), { textContent: 'Spillmesteren' }));
      tender.classList.add('away');
    }
    const guests = here.filter((x) => x !== bt);
    const count = Math.max(6, guests.length + (guests.length % 2));
    stoolsEl.innerHTML = '';
    for (let i = 0; i < count; i++) {
      const g = guests[i];
      const stool = document.createElement('div');
      stool.className = 'stool' + (g ? ' taken' : '') + (g && g.name === meName ? ' me' : '');
      if (g) {
        const a = document.createElement('a');
        a.href = `/profil.html?navn=${encodeURIComponent(g.name)}`;
        a.className = 'stool-guest';
        a.append(avatarEl(g.avatar, g.name, 42), Object.assign(document.createElement('span'), { textContent: g.name === meName ? 'Deg' : g.name.split(' ')[0] }));
        stool.appendChild(a);
      }
      stool.appendChild(Object.assign(document.createElement('div'), { className: 'stool-seat' }));
      stool.appendChild(Object.assign(document.createElement('div'), { className: 'stool-leg' }));
      stoolsEl.appendChild(stool);
    }
    const n = here.length;
    document.getElementById('bar-crowd').textContent = n <= 1 ? 'Stille i baren akkurat nå. Ta med noen! 🍻' : `${n} i baren nå 🍻`;
  }

  document.addEventListener('presence', (e) => {
    lastRooms = e.detail.rooms || {};
    renderScene();
  });

  // En pils sklir bortover disken når man bestiller
  function slideBeer() {
    const s = document.getElementById('bar-slide');
    if (!s) return;
    s.classList.remove('go');
    void s.offsetWidth;
    s.classList.add('go');
  }

  // Oppdater når spillmesteren leverer
  onLive('orders', () => !busy && refresh());
  setInterval(() => !busy && refresh(), 20000);
  window.refreshBar = refresh;
  refresh();
})();
