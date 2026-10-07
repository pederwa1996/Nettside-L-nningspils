'use strict';

(function () {
  const $ = (id) => document.getElementById(id);
  let data = null;
  let openForm = null; // id på oppgaven som har skjemaet åpent
  const drafts = {}; // id -> { image, text, with }
  let people = []; // alle deltakere, til å velge kollegaer i duo/gjengen

  // Kategoriene
  const CATS = {
    first: { icon: '⚡', name: 'Førstemann til mølla', short: 'Førstemann', rule: 'Bare én kan ta hver oppgave: den som leverer først, tar den. Blir det avvist, åpnes den for alle igjen.' },
    duo: { icon: '👯', name: 'Duo', short: 'Duo', rule: 'Gjør oppgaven sammen med en kollega, og velg hvem når du leverer. Begge får belønningen! Alle kan gjøre hver duo-oppgave én gang.' },
    mingle: { icon: '🤝', name: 'Mingle', short: 'Mingle', rule: 'Legg bort mobilen og snakk med folk! Alle kan gjøre hver oppgave én gang.' },
    gang: { icon: '🎉', name: 'Hele gjengen', short: 'Gjengen', rule: 'Samle gjengen! Velg alle kollegaene som var med når du leverer. Alle som var med, får belønningen.' },
  };
  const CAT_HASH = { first: 'forstemann', duo: 'duo', mingle: 'mingle', gang: 'gjengen' };
  let cat = Object.keys(CAT_HASH).find((k) => `#${CAT_HASH[k]}` === location.hash) || 'first';

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

  const spinsWord = (n) => (n === 1 ? '1 spinn' : `${n} spinn`);

  function el(tag, cls, text) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text !== undefined) e.textContent = text;
    return e;
  }

  // Kan jeg gjøre denne nå?
  function openForMe(t) {
    if (t.cat === 'first') return t.status === 'open';
    return !t.myAttempt || t.myAttempt.status === 'rejected';
  }

  function sortKey(t) {
    const me = data.me && data.me.name;
    if (t.cat !== 'first') {
      if (t.myAttempt && t.myAttempt.status === 'pending') return 0;
      return openForMe(t) ? 1 : 3;
    }
    if (t.status === 'pending' && t.claimedBy === me) return 0;
    if (t.status === 'open') return 1;
    if (t.status === 'pending') return 2;
    return 3;
  }

  function renderTask(t) {
    const me = data.me;
    const card = el('section', `card task task-${t.status}${t.beer ? ' task-beer' : ''}`);
    const head = el('div', 'task-head');
    const each = t.cat === 'duo' || t.cat === 'gang' ? ' hver' : '';
    head.append(el('h3', 'task-title', t.title), t.beer
      ? el('span', 'task-reward beer', `🍺 1 PILS${each}`)
      : el('span', 'task-reward', `🎰 ${spinsWord(t.reward)} + 💰 ${t.cash} cash${each}`));
    if (t.beer) card.append(el('span', 'task-hard', '🔥 Skikkelig vanskelig'));
    card.append(head, el('p', 'task-desc', t.desc));
    const tags = [t.proof === 'photo' ? '📸 Bevis: bilde' : '✍️ Bevis: skriv hva du gjorde (bilde valgfritt)'];
    if (t.cat === 'duo') tags.unshift('👯 Med én kollega');
    if (t.cat === 'gang') tags.unshift(`👥 Minst ${t.min} personer`);
    card.append(el('p', 'note', tags.join(' · ')));
    if (t.cat !== 'first') return renderShared(t, card);

    if (t.myAttempt && t.myAttempt.status === 'rejected' && t.status === 'open') {
      card.append(el('p', 'task-rejected', `❌ Innleveringen din ble avvist${t.myAttempt.reason ? `: ${t.myAttempt.reason}` : ''}. Du kan prøve igjen.`));
    }

    if (t.status === 'done') {
      const mine = me && t.completedBy === me.name;
      card.append(el('p', 'task-status done', mine ? (t.beer ? '✅ Du klarte den og vant en pils! Løs den inn i baren 🍻' : `✅ Du løste denne og fikk ${spinsWord(t.reward)} og ${t.cash} cash!`) : `✅ Løst av ${t.completedBy}`));
      return card;
    }
    if (t.status === 'pending') {
      if (me && t.claimedBy === me.name) {
        const row = el('div', 'task-row');
        const withdraw = el('button', 'secondary small-btn', 'Trekk tilbake');
        withdraw.addEventListener('click', async () => {
          if (!confirm('Trekke tilbake innleveringen? Da blir oppgaven åpen for alle igjen.')) return;
          try {
            await api('/api/tasks/withdraw', { id: t.id });
            showMsg('Innleveringen er trukket tilbake.');
          } catch (err) {
            showMsg(err.message, 'lose');
          }
          refresh();
        });
        row.append(el('p', 'task-status pending', '⏳ Levert! Venter på godkjenning fra admin.'), withdraw);
        card.append(row);
      } else {
        card.append(el('p', 'task-status locked', `🔒 ${t.claimedBy} har levert, venter på godkjenning`));
      }
      return card;
    }

    // Åpen oppgave
    return renderForm(t, card);
  }

  // Duo, mingle og hele gjengen: alle kan gjøre dem (én gang hver)
  function renderShared(t, card) {
    const me = data.me;
    const a = t.myAttempt;
    const others = (a && a.by && me ? [a.by, ...a.with].filter((n) => n !== me.name) : []);
    const withText = others.length ? ` med ${others.join(', ')}` : '';
    if (a && a.status === 'rejected') {
      card.append(el('p', 'task-rejected', `❌ Innleveringen${withText} ble avvist${a.reason ? `: ${a.reason}` : ''}. Dere kan prøve igjen.`));
    }
    if (t.doneCount) {
      const done = el('p', 'task-done-by');
      done.textContent = `✅ Klart ${t.doneCount} ${t.doneCount === 1 ? 'gang' : 'ganger'}: ${t.doneBy.map((g) => g.map((n) => n.split(' ')[0]).join(' & ')).join(' · ')}`;
      card.append(done);
    }
    if (a && a.status === 'approved') {
      card.classList.add('task-done');
      card.append(el('p', 'task-status done', `✅ Du klarte denne${withText} og fikk ${spinsWord(t.reward)} og ${t.cash} cash!`));
      return card;
    }
    if (a && a.status === 'pending') {
      if (a.by === me.name) {
        const row = el('div', 'task-row');
        const withdraw = el('button', 'secondary small-btn', 'Trekk tilbake');
        withdraw.addEventListener('click', async () => {
          if (!confirm('Trekke tilbake innleveringen?')) return;
          try {
            await api('/api/tasks/withdraw', { id: t.id });
            showMsg('Innleveringen er trukket tilbake.');
          } catch (err) {
            showMsg(err.message, 'lose');
          }
          refresh();
        });
        row.append(el('p', 'task-status pending', `⏳ Levert${withText}! Venter på godkjenning.`), withdraw);
        card.append(row);
      } else {
        card.append(el('p', 'task-status pending', `⏳ ${a.by} leverte denne med deg. Venter på godkjenning.`));
      }
      return card;
    }
    return renderForm(t, card);
  }

  // Velg kollegaene som var med (duo: én, gjengen: flere)
  function partnerPicker(t, draft) {
    const me = data.me;
    const box = el('div', 'partner-pick');
    const need = t.cat === 'duo' ? 1 : t.min - 1;
    const label = el('p', 'field-label', '');
    const update = () => {
      label.textContent = t.cat === 'duo'
        ? `👯 Hvem gjorde du den med? ${draft.with.length ? `(${draft.with[0]})` : ''}`
        : `👥 Hvem var med? Velg minst ${need} (${draft.with.length} valgt)`;
    };
    update();
    const list = el('div', 'partner-list');
    people.filter((x) => x.name !== me.name).forEach((x) => {
      const b = el('button', 'partner-chip');
      b.type = 'button';
      b.append(avatarEl(x.avatar, x.name, 30), el('span', '', x.name.split(' ')[0]));
      b.classList.toggle('on', draft.with.includes(x.name));
      b.addEventListener('click', () => {
        if (t.cat === 'duo') draft.with = draft.with[0] === x.name ? [] : [x.name];
        else if (draft.with.includes(x.name)) draft.with = draft.with.filter((n) => n !== x.name);
        else draft.with.push(x.name);
        list.querySelectorAll('.partner-chip').forEach((c, i) => c.classList.toggle('on', draft.with.includes(people.filter((y) => y.name !== me.name)[i].name)));
        update();
      });
      list.appendChild(b);
    });
    if (!list.children.length) list.append(el('p', 'muted', 'Ingen andre har registrert seg ennå.'));
    box.append(label, list);
    return box;
  }

  function renderForm(t, card) {
    const me = data.me;
    if (!me) return card;
    if (openForm !== t.id) {
      const btn = el('button', '', 'Lever bevis');
      btn.addEventListener('click', () => {
        openForm = t.id;
        render();
      });
      card.append(btn);
      return card;
    }

    const draft = (drafts[t.id] = drafts[t.id] || { image: null, text: '', with: [] });
    const form = el('div', 'task-form');
    if (t.cat === 'duo' || t.cat === 'gang') form.append(partnerPicker(t, draft));
    const pick = el('button', 'secondary', draft.image ? '📸 Bytt bilde' : '📸 Ta eller velg bilde');
    pick.type = 'button';
    pick.addEventListener('click', () => {
      $('proof-input').dataset.task = t.id;
      $('proof-input').click();
    });
    if (draft.image) {
      const img = el('img', 'task-preview');
      img.src = draft.image;
      form.append(img);
    }
    const ta = el('textarea', 'task-text');
    ta.placeholder = t.proof === 'text' ? 'Skriv hva du gjorde ...' : 'Kommentar (valgfritt)';
    ta.maxLength = 500;
    ta.value = draft.text;
    ta.addEventListener('input', () => (draft.text = ta.value));
    const row = el('div', 'story-actions');
    const cancel = el('button', 'secondary', 'Avbryt');
    cancel.addEventListener('click', () => {
      openForm = null;
      render();
    });
    const send = el('button', '', 'Send inn');
    send.addEventListener('click', async () => {
      send.disabled = true;
      send.textContent = 'Sender ...';
      try {
        await api('/api/tasks/submit', { id: t.id, image: draft.image, text: draft.text, with: draft.with });
        delete drafts[t.id];
        openForm = null;
        showMsg(`Levert! «${t.title}» venter nå på godkjenning 🎯`, 'win');
        window.scrollTo({ top: 0, behavior: 'smooth' });
      } catch (err) {
        alert(err.message);
      }
      refresh();
    });
    row.append(cancel, send);
    form.append(pick, ta, row);
    card.append(form);
    return card;
  }

  function render() {
    const me = data.me;
    $('not-joined').classList.toggle('hidden', !!me);
    $('intro').classList.toggle('hidden', !me);
    if (me) $('my-spins').textContent = me.spinsLeft;
    // Fanene med antall oppgaver du kan gjøre i hver kategori
    const tabs = $('task-cats');
    tabs.innerHTML = '';
    Object.entries(CATS).forEach(([k, c]) => {
      const n = data.tasks.filter((t) => t.cat === k && openForMe(t)).length;
      const b = el('button', `task-cat cat-${k}${k === cat ? ' active' : ''}`);
      b.type = 'button';
      b.append(el('span', 'tc-ico', c.icon), el('b', '', c.short), el('small', '', `${n} ledige`));
      b.addEventListener('click', () => {
        cat = k;
        openForm = null;
        history.replaceState(null, '', `#${CAT_HASH[k]}`);
        render();
      });
      tabs.appendChild(b);
    });
    $('cat-rule').innerHTML = '';
    $('cat-rule').className = `cat-rule cat-${cat}`;
    $('cat-rule').append(el('strong', '', `${CATS[cat].icon} ${CATS[cat].name}`), el('span', '', CATS[cat].rule));

    const list = $('tasks');
    list.innerHTML = '';
    // Ledige pils-oppgaver først, så etter belønning
    const tasks = data.tasks.filter((t) => t.cat === cat).sort((a, b) => sortKey(a) - sortKey(b) || (b.beer || 0) - (a.beer || 0) || b.reward - a.reward);
    if (!tasks.length) list.append(el('p', 'muted center', 'Ingen oppgaver ennå.'));
    tasks.forEach((t) => list.appendChild(renderTask(t)));
  }

  async function refresh() {
    try {
      if (!people.length) people = (await api('/api/tasks/people')).people;
      data = await api('/api/tasks');
      render();
    } catch (err) {
      console.error(err);
    }
  }

  $('proof-input').addEventListener('change', async () => {
    const input = $('proof-input');
    const file = input.files[0];
    const id = input.dataset.task;
    input.value = '';
    if (!file || !id) return;
    try {
      drafts[id] = drafts[id] || { image: null, text: '', with: [] };
      drafts[id].image = await resizeImage(file, 1080, 0.8);
      render();
    } catch (err) {
      alert(err.message);
    }
  });

  // Ikke tegn siden på nytt mens noen skriver eller velger bilde
  onLive('tasks', () => !openForm && refresh());
  setInterval(() => !openForm && refresh(), 20000);
  refresh();
})();
