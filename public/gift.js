'use strict';

// 🎁 Gi en gave: spinn, cash eller pils fra det du selv har.
//   openGift({ name, avatar })
(function () {
  const QUICK = { spins: [1, 2, 3, 5], cash: [50, 100, 200, 500], beer: [1, 2, 3] };
  let box = null;

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

  function close() {
    if (box) box.remove();
    box = null;
  }

  window.openGift = async function ({ name, avatar }) {
    close();
    let info;
    try {
      info = await api('/api/gifts');
    } catch (err) {
      alert(err.message);
      return;
    }
    const first = name.split(' ')[0];
    let kind = ['beer', 'spins', 'cash'].find((k) => info.balance[k] >= info.kinds[k].min) || 'spins';
    let amount = 0;

    box = el('div', 'gift-overlay');
    const card = el('div', 'gift-card');
    const x = el('button', 'gift-x', '✕');
    x.type = 'button';
    x.addEventListener('click', close);
    box.addEventListener('click', (e) => e.target === box && close());

    const head = el('div', 'gift-head');
    const av = el('span', 'gift-av');
    av.append(avatarEl(avatar, name, 52), el('i', 'gift-bow', '🎁'));
    head.append(av, el('h2', '', `Gi en gave til ${first}`));

    const kinds = el('div', 'gift-kinds');
    const amounts = el('div', 'gift-amounts');
    const custom = el('input', 'gift-custom');
    custom.type = 'number';
    custom.inputMode = 'numeric';
    const msg = el('input', 'gift-msg');
    msg.type = 'text';
    msg.maxLength = 120;
    msg.placeholder = `Hilsen til ${first} (valgfritt)`;
    const send = el('button', 'big gift-send');
    send.type = 'button';
    const err = el('p', 'result lose gift-err');

    function renderKinds() {
      kinds.innerHTML = '';
      Object.entries(info.kinds).forEach(([k, d]) => {
        const b = el('button', `gift-kind kind-${k}${k === kind ? ' on' : ''}`);
        b.type = 'button';
        const have = info.balance[k];
        b.disabled = have < d.min;
        b.append(el('span', 'gk-icon', d.icon), el('b', '', d.label), el('small', '', `Du har ${have}`));
        b.addEventListener('click', () => {
          kind = k;
          amount = 0;
          if (window.sfx) sfx.play('tap');
          render();
        });
        kinds.appendChild(b);
      });
    }

    function renderAmounts() {
      const d = info.kinds[kind];
      const max = Math.min(d.max, info.balance[kind]);
      if (!amount) amount = Math.min(QUICK[kind][0], max) || d.min;
      amounts.innerHTML = '';
      QUICK[kind].filter((n) => n >= d.min && n <= max).forEach((n) => {
        const b = el('button', `gift-amt${n === amount ? ' on' : ''}`, `${n}`);
        b.type = 'button';
        b.addEventListener('click', () => {
          amount = n;
          custom.value = '';
          render();
        });
        amounts.appendChild(b);
      });
      custom.min = d.min;
      custom.max = max;
      custom.placeholder = `Annet (${d.min}–${max})`;
      const word = kind === 'beer' ? 'pils' : d.label;
      send.textContent = `🎁 Gi ${amount} ${word} ${d.icon}`;
      send.disabled = max < d.min || amount < d.min || amount > max;
    }

    function render() {
      renderKinds();
      renderAmounts();
      err.textContent = '';
    }

    custom.addEventListener('input', () => {
      const v = Math.floor(Number(custom.value));
      if (v > 0) amount = v;
      renderAmounts();
    });

    send.addEventListener('click', async () => {
      send.disabled = true;
      try {
        await api('/api/gifts', { to: name, kind, amount, message: msg.value });
        if (window.sfx) {
          sfx.play(kind === 'beer' ? 'cheers' : 'coin');
        }
        card.innerHTML = '';
        const done = el('div', 'gift-done');
        const d = info.kinds[kind];
        done.append(el('div', 'gift-open', '🎁'), el('h2', '', 'Gave sendt!'), el('p', '', `${first} fikk ${amount} ${kind === 'beer' ? 'pils' : d.label} ${d.icon} og får et varsel.`));
        const ok = el('button', 'big', 'Supert 🙌');
        ok.type = 'button';
        ok.addEventListener('click', close);
        done.appendChild(ok);
        card.appendChild(done);
        setTimeout(close, 3500);
        if (window.onGiftSent) window.onGiftSent();
      } catch (e) {
        err.textContent = e.message;
        send.disabled = false;
      }
    });

    const label = (t) => el('p', 'gift-label', t);
    card.append(x, head, label('Hva vil du gi?'), kinds, label('Hvor mye?'), amounts, custom, msg, err, send);
    box.appendChild(card);
    document.body.appendChild(box);
    render();
  };
})();
