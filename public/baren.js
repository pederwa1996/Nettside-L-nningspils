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
    $('flus-cost').textContent = qty * data.price;
    const me = data.me;
    $('order-credit').disabled = me.beersOwed < qty;
    $('order-flus').disabled = me.flus < qty * data.price;
  }

  function render() {
    const me = data.me;
    $('not-joined').classList.toggle('hidden', !!me);
    $('bar').classList.toggle('hidden', !me);
    if (!me) return;
    $('my-beers').textContent = me.beersOwed;
    $('my-flus').textContent = me.flus;
    $('price').textContent = data.price;
    const w = data.won;
    const total = w.wheel + w.tickets + w.slot;
    $('won-info').textContent = total
      ? `Du har vunnet ${total} pils totalt: ${w.wheel} fra lykkehjulet, ${w.tickets} fra loddtrekningen og ${w.slot} fra automaten.`
      : 'Du har ikke vunnet noen pils ennå, men du kan kjøpe for flus.';
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
      title.textContent = `${o.qty} × 🍺 ${o.pay === 'flus' ? `(${o.cost} flus)` : '(til gode)'}`;
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
  $('order-flus').addEventListener('click', () => order('flus'));

  // Oppdater når spillmesteren leverer
  onLive('orders', () => !busy && refresh());
  setInterval(() => !busy && refresh(), 20000);
  refresh();
})();
