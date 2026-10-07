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

  function renderQty() {
    $('qty').textContent = qty;
    const me = data.me;
    $('order-credit').disabled = me.beersOwed < qty;
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
    renderQty();

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

  function order(pay) {
    act(async () => {
      await api('/api/bar/order', { qty, pay, note: $('note').value });
      showMsg(`🍻 Bestilt ${qty} pils! Spillmesteren kommer med den til bordet.`, 'win');
      slideBeer();
      qty = 1;
    });
  }

  $('qty-minus').addEventListener('click', () => {
    qty = Math.max(1, qty - 1);
    renderQty();
  });
  $('qty-plus').addEventListener('click', () => {
    qty = Math.min(data.maxPerOrder, qty + 1);
    renderQty();
  });
  $('order-credit').addEventListener('click', () => order('credit'));

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
    const here = (lastRooms['kasino-bar'] || []).slice();
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
