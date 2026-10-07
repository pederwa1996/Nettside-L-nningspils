'use strict';

const $ = (id) => document.getElementById(id);
let password = '';

async function post(path, body = {}) {
  const res = await fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password, ...body }),
  });
  const json = await res.json();
  if (!res.ok) throw new Error(json.error || 'Noe gikk galt');
  return json;
}

function showMsg(text, ok = false) {
  $('msg').textContent = text;
  $('msg').className = ok ? 'success' : 'error';
}

function avatarImg(url) {
  const img = document.createElement('img');
  img.src = url;
  img.className = 'avatar';
  img.style.width = img.style.height = '40px';
  img.style.verticalAlign = 'middle';
  return img;
}

// ---- Budsjett i kroner ----
const kr = (n) => `${Math.round(n).toLocaleString('no-NO')} kr`;

function renderBudget(b) {
  const pct = b.total > 0 ? Math.max(0, Math.min(100, (b.remaining / b.total) * 100)) : 0;
  const potPct = b.total > 0 ? Math.max(0, Math.min(pct, (b.potential / b.total) * 100)) : 0;
  $('budget').innerHTML = `
    <div class="budget-main${b.remaining < b.price ? ' empty' : ''}">
      <span class="budget-left">${kr(b.remaining)}</span>
      <span class="muted">igjen av ${kr(b.total)} · nok til ${b.affordable} pils til</span>
    </div>
    <div class="budget-bar" title="Grønt: igjen. Stripete: pils i omløp som kan bli bestilt."><i style="width:${pct}%"></i><b style="width:${potPct}%;left:${pct - potPct}%"></b></div>
    <div class="budget-rows">
      <div><span>🍺 Levert</span><b>${b.beersBought} pils · −${kr(b.spent)}</b></div>
      <div><span>⏳ Bestilt, venter</span><b>${b.pending} pils · ${kr(b.pending * b.price)}</b></div>
      <div><span>🎟️ Til gode i omløp</span><b>${b.owed} pils · ${kr(b.owed * b.price)}</b></div>
      <div class="${b.afterAll < 0 ? 'neg' : ''}"><span>📉 Hvis alt løses inn</span><b>${kr(b.afterAll)} igjen</b></div>
    </div>
    <p class="note">Pris per pils: ${kr(b.price)}. «I omløp» er mulige utgifter, ikke penger som er brukt.</p>`;
  $('budget-total').value = b.total;
  $('budget-price').value = b.price;
}

$('budget-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  try {
    const r = await post('/api/admin/budget', { total: Number($('budget-total').value), price: Number($('budget-price').value) });
    renderBudget(r.budget);
    showMsg('Budsjettet er lagret 💳', true);
  } catch (err) {
    showMsg(err.message);
  }
});

// ---- 💡 Forslag (egen mappe) ----
let suggFilter = 'new';
let suggList = [];
function renderSuggestions(list) {
  suggList = list;
  const unread = list.filter((x) => !x.read).length;
  $('sugg-count').textContent = unread;
  const box = $('admin-suggestions');
  box.innerHTML = '';
  const shown = suggFilter === 'new' ? list.filter((x) => !x.read) : list;
  if (!shown.length) box.innerHTML = `<p class="muted">${suggFilter === 'new' ? 'Ingen nye forslag.' : 'Ingen forslag ennå.'}</p>`;
  shown.forEach((x) => {
    const card = document.createElement('div');
    card.className = `sugg-item${x.read ? ' read' : ''}`;
    const head = document.createElement('p');
    head.className = 'sugg-head';
    const who = document.createElement('strong');
    who.textContent = x.name;
    const meta = document.createElement('span');
    meta.className = 'muted';
    meta.textContent = ` · ${x.kindLabel} · ${new Date(x.at).toLocaleTimeString('no-NO', { hour: '2-digit', minute: '2-digit' })}`;
    head.append(who, meta);
    const text = document.createElement('p');
    text.className = 'sugg-text';
    text.textContent = x.text;
    const btns = document.createElement('div');
    btns.className = 'task-admin-btns';
    const read = document.createElement('button');
    read.className = 'small-btn';
    read.textContent = x.read ? '↺ Ulest' : '✓ Lest';
    read.addEventListener('click', () => suggAction(x.id, x.read ? 'unread' : 'read'));
    const del = document.createElement('button');
    del.className = 'secondary small-btn';
    del.textContent = 'Slett';
    del.addEventListener('click', () => confirm('Slette forslaget?') && suggAction(x.id, 'delete'));
    btns.append(read, del);
    card.append(head, text, btns);
    box.appendChild(card);
  });
}
async function suggAction(id, action) {
  try {
    await post('/api/admin/suggestion', { id, action });
    await load();
  } catch (err) {
    showMsg(err.message);
  }
}
document.querySelectorAll('.sugg-f').forEach((b) => b.addEventListener('click', () => {
  suggFilter = b.dataset.f;
  document.querySelectorAll('.sugg-f').forEach((x) => x.classList.toggle('secondary', x !== b));
  renderSuggestions(suggList);
}));
if (location.hash === '#forslag') document.getElementById('forslag').open = true;

async function load() {
  post('/api/admin/budget').then((r) => renderBudget(r.budget)).catch(() => {});
  const data = await post('/api/admin/login');
  $('panel').classList.remove('hidden');
  renderSuggestions(data.suggestions || []);
  $('count').textContent = data.participants.length;
  $('rows').innerHTML = '';
  data.participants.forEach((p) => {
    const tr = document.createElement('tr');
    [p.name, p.tickets.join(', '), `${p.spinsUsed}/${p.spinsAllowed}`, p.spinWins, p.bestScore, p.flus].forEach((v) => {
      const td = document.createElement('td');
      td.textContent = v;
      tr.appendChild(td);
    });
    const pw = document.createElement('td');
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'small-btn' + (p.hasPassword ? ' secondary' : '');
    btn.textContent = p.hasPassword ? '🔑 Nytt' : '🔑 Sett';
    btn.title = p.hasPassword ? 'Har passord. Trykk for å sette et nytt.' : 'Har ikke passord';
    btn.addEventListener('click', async () => {
      const newPassword = prompt(`Nytt passord for ${p.name} (minst 4 tegn):`);
      if (!newPassword) return;
      try {
        await post('/api/admin/set-password', { name: p.name, newPassword });
        showMsg(`Passordet til ${p.name} er satt. Fortell det til dem!`, true);
        await load();
      } catch (err) {
        showMsg(err.message);
      }
    });
    pw.appendChild(btn);
    tr.appendChild(pw);
    $('rows').appendChild(tr);
  });

  // ---- Oppgaver ----
  const pending = data.taskQueue || [];
  $('review-count').textContent = pending.length;
  $('admin-review').innerHTML = pending.length ? '' : '<p class="muted">Ingen innleveringer venter.</p>';
  pending.forEach((a) => {
    const box = document.createElement('div');
    box.className = 'review-box';
    const h = document.createElement('p');
    h.innerHTML = '<strong></strong> leverte <strong></strong> (<span></span>)';
    h.querySelectorAll('strong')[0].textContent = a.with.length ? `${a.name} + ${a.with.join(', ')}` : a.name;
    h.querySelectorAll('strong')[1].textContent = a.title;
    h.querySelector('span').textContent = `${CAT_ICON[a.cat] || ''} ${a.beer ? '🍺 1 pils' : `🎰 ${a.reward} spinn`}${a.with.length ? ' hver' : ''}`;
    box.appendChild(h);
    if (a.url) {
      const img = document.createElement('img');
      img.src = a.url;
      img.className = 'task-preview';
      box.appendChild(img);
    }
    if (a.text) {
      const q = document.createElement('blockquote');
      q.textContent = a.text;
      box.appendChild(q);
    }
    const row = document.createElement('div');
    row.className = 'story-actions';
    const ok = document.createElement('button');
    ok.textContent = '✅ Godkjenn';
    ok.addEventListener('click', async () => {
      await post('/api/admin/task-review', { id: a.id, attempt: a.attempt, approve: true });
      await load();
    });
    const no = document.createElement('button');
    no.className = 'secondary';
    no.textContent = '❌ Avvis';
    no.addEventListener('click', async () => {
      const reason = prompt('Hvorfor avvises den? (vises for deltakeren, valgfritt)');
      if (reason === null) return;
      await post('/api/admin/task-review', { id: a.id, attempt: a.attempt, approve: false, reason });
      await load();
    });
    row.append(ok, no);
    box.appendChild(row);
    $('admin-review').appendChild(box);
  });

  $('admin-tasks').innerHTML = data.tasks.length ? '' : '<li class="muted">Ingen oppgaver.</li>';
  data.tasks.forEach((t) => {
    const li = document.createElement('li');
    li.className = 'duel-row';
    const span = document.createElement('span');
    const last = t.attempts[t.attempts.length - 1];
    const status = t.cat !== 'first'
      ? `✅ ${t.approved || 0} ganger`
      : t.status === 'done' ? `✅ ${last.name}` : t.status === 'pending' ? `⏳ ${last.name}` : '🟢 ledig';
    span.textContent = `${CAT_ICON[t.cat] || ''} ${t.title} · ${t.beer ? '🍺 1 pils' : `🎰 ${t.reward}`} · ${status}`;
    const btns = document.createElement('span');
    btns.className = 'task-admin-btns';
    const editBtn = document.createElement('button');
    editBtn.className = 'small-btn';
    editBtn.textContent = '✏️ Rediger';
    editBtn.addEventListener('click', () => {
      const open = li.querySelector('.task-edit');
      if (open) return open.remove();
      li.appendChild(taskEditor(t));
    });
    const del = document.createElement('button');
    del.className = 'secondary small-btn';
    del.textContent = 'Slett';
    del.addEventListener('click', async () => {
      if (!confirm(`Slette oppgaven «${t.title}»?`)) return;
      await post('/api/admin/task-delete', { id: t.id });
      await load();
    });
    btns.append(editBtn, del);
    li.append(span, btns);
    $('admin-tasks').appendChild(li);
  });

  $('story-count').textContent = data.stories.length;
  $('admin-stories').innerHTML = data.stories.length ? '' : '<p class="muted">Ingen bilder i storyen.</p>';
  data.stories.forEach((s) => {
    const fig = document.createElement('figure');
    const img = document.createElement('img');
    img.src = s.url;
    const cap = document.createElement('figcaption');
    cap.textContent = s.name + (s.caption ? `: ${s.caption}` : '');
    const del = document.createElement('button');
    del.className = 'secondary small-btn';
    del.textContent = 'Slett';
    del.addEventListener('click', async () => {
      if (!confirm(`Slette bildet fra ${s.name}?`)) return;
      await post('/api/admin/story-delete', { id: s.id });
      await load();
    });
    fig.append(img, cap, del);
    $('admin-stories').appendChild(fig);
  });

  $('admin-mogg').innerHTML = data.moggPodium.length ? '' : '<li class="muted">Ingen på pallen.</li>';
  data.moggPodium.forEach((e) => {
    const li = document.createElement('li');
    li.className = 'duel-row';
    const span = document.createElement('span');
    span.append(avatarImg(e.url), document.createTextNode(` ${e.name} · ${e.score.toFixed(2)}`));
    const del = document.createElement('button');
    del.className = 'secondary small-btn';
    del.textContent = 'Fjern';
    del.addEventListener('click', async () => {
      if (!confirm(`Fjerne ${e.name} fra pallen?`)) return;
      await post('/api/admin/mogg-remove', { name: e.name });
      await load();
    });
    li.append(span, del);
    $('admin-mogg').appendChild(li);
  });

  $('admin-chat').innerHTML = data.chat.length ? '' : '<li class="muted">Ingen meldinger.</li>';
  data.chat.forEach((m) => {
    const li = document.createElement('li');
    li.className = 'duel-row';
    const span = document.createElement('span');
    span.textContent = `${m.name}: ${m.text}`;
    const del = document.createElement('button');
    del.className = 'secondary small-btn';
    del.textContent = 'Slett';
    del.addEventListener('click', async () => {
      await post('/api/admin/chat-delete', { id: m.id });
      await load();
    });
    li.append(span, del);
    $('admin-chat').appendChild(li);
  });

  const state = await (await fetch('/api/state')).json();
  renderDraw(state.draw);
}

function renderDraw(draw) {
  $('draw-btn').disabled = !!draw;
  $('draw-btn').textContent = draw ? 'Trekningen er gjennomført ✅' : '🎲 Kjør loddtrekning';
  if (!draw) {
    $('draw-result').innerHTML = '';
    return;
  }
  const ul = document.createElement('ul');
  ul.className = 'winners';
  draw.winners.forEach((w) => {
    const li = document.createElement('li');
    li.innerHTML = `<span class="ticket small">#${w.ticket}</span> `;
    li.append(w.name || 'Ikke utdelt');
    ul.appendChild(li);
  });
  $('draw-result').innerHTML = '';
  $('draw-result').appendChild(ul);
}

// Vis bestillingsboblen med en gang etter innlogging
function showBubble() {
  if (document.querySelector('.admin-bubble')) return;
  const s = document.createElement('script');
  s.src = '/admin-bubble.js?' + Date.now();
  document.body.appendChild(s);
}

async function login() {
  try {
    await load();
    showMsg('Innlogget ✅', true);
    // Husk passordet i denne fanen, så spinn-admin-siden slipper ny innlogging
    try {
      if (password) sessionStorage.setItem('adminPassword', password);
    } catch { /* ignorer */ }
    showBubble();
  } catch (err) {
    $('panel').classList.add('hidden');
    showMsg(err.message);
    try {
      sessionStorage.removeItem('adminPassword');
    } catch { /* ignorer */ }
  }
}

$('login-form').addEventListener('submit', (e) => {
  e.preventDefault();
  password = $('password').value;
  login();
});

try {
  password = sessionStorage.getItem('adminPassword') || '';
} catch { /* ignorer */ }
if (password) login();
// Spillmesteren (admin-profilen) slipper passordet på enheter der den er logget inn
else fetch('/api/admin/me').then((r) => r.json()).then((r) => r.admin && login()).catch(() => {});

$('draw-btn').addEventListener('click', async () => {
  if (!confirm('Kjøre loddtrekningen nå? Den kan bare kjøres én gang.')) return;
  try {
    const { draw } = await post('/api/admin/draw');
    renderDraw(draw);
  } catch (err) {
    showMsg(err.message);
  }
});

const CAT_ICON = { first: '⚡', duo: '👯', mingle: '🤝', gang: '🎉' };
const CAT_OPTIONS = `
  <option value="first">⚡ Førstemann til mølla (én person)</option>
  <option value="duo">👯 Duo (med én kollega, begge får belønning)</option>
  <option value="mingle">🤝 Mingle (alle kan gjøre den én gang)</option>
  <option value="gang">🎉 Hele gjengen (flere sammen, alle får belønning)</option>`;

// Vis «minst antall» bare for gjengen, og pils bare for førstemann
function catFields(sel, minRow, beerRow, beerBox, rewardInput) {
  const sync = () => {
    minRow.classList.toggle('hidden', sel.value !== 'gang');
    beerRow.classList.toggle('hidden', sel.value !== 'first');
    if (sel.value !== 'first') beerBox.checked = false;
    rewardInput.disabled = beerBox.checked;
  };
  sel.addEventListener('change', sync);
  beerBox.addEventListener('change', sync);
  sync();
}

// Skjema for å redigere en oppgave rett i listen
function taskEditor(t) {
  const box = document.createElement('div');
  box.className = 'task-form task-edit';
  box.innerHTML = `
    <label class="field">Kategori
      <select class="te-cat">${CAT_OPTIONS}</select>
    </label>
    <label class="field te-min-row">Minst antall personer (deg inkludert)
      <input class="te-min" type="number" min="3" max="20">
    </label>
    <input class="te-title" type="text" maxlength="80" placeholder="Tittel">
    <textarea class="te-desc task-text" maxlength="400" placeholder="Beskrivelse"></textarea>
    <label class="field">Belønning (spinn, 1–10)
      <input class="te-reward" type="number" min="1" max="10">
    </label>
    <label class="field">Bevis
      <select class="te-proof">
        <option value="photo">Bilde kreves</option>
        <option value="text">Tekst holder (bilde valgfritt)</option>
      </select>
    </label>
    <label class="check-row te-beer-row"><input class="te-beer" type="checkbox"> 🍺 Skikkelig vanskelig: gir 1 pils i stedet for spinn</label>
    <label class="check-row te-reopen-row hidden"><input class="te-reopen" type="checkbox"> ↺ Gjør oppgaven ledig igjen (den er løst nå)</label>
    <div class="story-actions">
      <button type="button" class="te-save">💾 Lagre</button>
      <button type="button" class="secondary te-cancel">Avbryt</button>
    </div>`;
  const q = (c) => box.querySelector(c);
  q('.te-title').value = t.title;
  q('.te-desc').value = t.desc || '';
  q('.te-reward').value = t.reward || 3;
  q('.te-proof').value = t.proof;
  q('.te-beer').checked = !!t.beer;
  q('.te-cat').value = t.cat || 'first';
  q('.te-min').value = t.min > 2 ? t.min : 4;
  catFields(q('.te-cat'), q('.te-min-row'), q('.te-beer-row'), q('.te-beer'), q('.te-reward'));
  q('.te-reopen-row').classList.toggle('hidden', t.status !== 'done');
  q('.te-cancel').addEventListener('click', () => box.remove());
  q('.te-save').addEventListener('click', async () => {
    try {
      await post('/api/admin/task-edit', {
        id: t.id,
        title: q('.te-title').value,
        desc: q('.te-desc').value,
        reward: Number(q('.te-reward').value) || 1,
        proof: q('.te-proof').value,
        beer: q('.te-beer').checked ? 1 : 0,
        cat: q('.te-cat').value,
        min: Number(q('.te-min').value) || 4,
        reopen: q('.te-reopen').checked,
      });
      showMsg(`Oppgaven «${q('.te-title').value}» er lagret ✅`, true);
      await load();
    } catch (err) {
      showMsg(err.message);
    }
  });
  return box;
}

$('new-task-cat').innerHTML = CAT_OPTIONS;
catFields($('new-task-cat'), $('new-task-min-row'), $('new-task-beer-row'), $('new-task-beer'), $('new-task-reward'));

$('new-task-btn').addEventListener('click', async () => {
  try {
    await post('/api/admin/task-add', {
      title: $('new-task-title').value,
      desc: $('new-task-desc').value,
      reward: Number($('new-task-reward').value),
      proof: $('new-task-proof').value,
      beer: $('new-task-beer').checked ? 1 : 0,
      cat: $('new-task-cat').value,
      min: Number($('new-task-min').value) || 4,
    });
    $('new-task-title').value = '';
    $('new-task-desc').value = '';
    await load();
    showMsg('Oppgaven er lagt til ✅', true);
  } catch (err) {
    showMsg(err.message);
  }
});

$('clear-chat-btn').addEventListener('click', async () => {
  if (!confirm('Slette alle meldinger i chatten?')) return;
  try {
    await post('/api/admin/chat-delete', { all: true });
    await load();
  } catch (err) {
    showMsg(err.message);
  }
});

$('reset-draw-btn').addEventListener('click', async () => {
  if (!confirm('Angre trekningen? Vinnerloddene blir fjernet.')) return;
  try {
    await post('/api/admin/reset-draw');
    await load();
  } catch (err) {
    showMsg(err.message);
  }
});

$('reset-all-btn').addEventListener('click', async () => {
  if (!confirm('Slette ALLE deltakere, lodd, spinn og trekningen?')) return;
  try {
    await post('/api/admin/reset-all');
    await load();
  } catch (err) {
    showMsg(err.message);
  }
});
