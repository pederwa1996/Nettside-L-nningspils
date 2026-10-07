'use strict';

(function () {
  const $ = (id) => document.getElementById(id);
  let data = null;
  let openForm = null; // id på oppgaven som har skjemaet åpent
  const drafts = {}; // id -> { image, text }

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

  function sortKey(t) {
    const me = data.me && data.me.name;
    if (t.status === 'pending' && t.claimedBy === me) return 0;
    if (t.status === 'open') return 1;
    if (t.status === 'pending') return 2;
    return 3;
  }

  function renderTask(t) {
    const me = data.me;
    const card = el('section', `card task task-${t.status}${t.beer ? ' task-beer' : ''}`);
    const head = el('div', 'task-head');
    head.append(el('h3', 'task-title', t.title), t.beer
      ? el('span', 'task-reward beer', '🍺 1 PILS')
      : el('span', 'task-reward', `🎰 ${spinsWord(t.reward)} + 💰 ${t.cash} cash`));
    if (t.beer) card.append(el('span', 'task-hard', '🔥 Skikkelig vanskelig'));
    card.append(head, el('p', 'task-desc', t.desc));
    card.append(el('p', 'note', t.proof === 'photo' ? '📸 Bevis: bilde' : '✍️ Bevis: skriv hva du gjorde (bilde valgfritt)'));

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

    const draft = (drafts[t.id] = drafts[t.id] || { image: null, text: '' });
    const form = el('div', 'task-form');
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
        await api('/api/tasks/submit', { id: t.id, image: draft.image, text: draft.text });
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
    const list = $('tasks');
    list.innerHTML = '';
    // Ledige pils-oppgaver først, så etter belønning
    const tasks = data.tasks.slice().sort((a, b) => sortKey(a) - sortKey(b) || (b.beer || 0) - (a.beer || 0) || b.reward - a.reward);
    if (!tasks.length) list.append(el('p', 'muted center', 'Ingen oppgaver ennå.'));
    tasks.forEach((t) => list.appendChild(renderTask(t)));
  }

  async function refresh() {
    try {
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
      drafts[id] = drafts[id] || { image: null, text: '' };
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
