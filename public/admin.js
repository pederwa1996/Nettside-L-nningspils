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

async function load() {
  post('/api/admin/budget').then((r) => renderBudget(r.budget)).catch(() => {});
  const data = await post('/api/admin/login');
  $('panel').classList.remove('hidden');
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
  const pending = data.tasks.filter((t) => t.status === 'pending');
  $('review-count').textContent = pending.length;
  $('admin-review').innerHTML = pending.length ? '' : '<p class="muted">Ingen innleveringer venter.</p>';
  pending.forEach((t) => {
    const a = t.attempts[t.attempts.length - 1];
    const box = document.createElement('div');
    box.className = 'review-box';
    const h = document.createElement('p');
    h.innerHTML = '<strong></strong> leverte <strong></strong> (🎰 <span></span> spinn)';
    h.querySelectorAll('strong')[0].textContent = a.name;
    h.querySelectorAll('strong')[1].textContent = t.title;
    h.querySelector('span').textContent = t.reward;
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
      await post('/api/admin/task-review', { id: t.id, approve: true });
      await load();
    });
    const no = document.createElement('button');
    no.className = 'secondary';
    no.textContent = '❌ Avvis';
    no.addEventListener('click', async () => {
      const reason = prompt('Hvorfor avvises den? (vises for deltakeren, valgfritt)');
      if (reason === null) return;
      await post('/api/admin/task-review', { id: t.id, approve: false, reason });
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
    const status = t.status === 'done' ? `✅ ${last.name}` : t.status === 'pending' ? `⏳ ${last.name}` : '🟢 ledig';
    span.textContent = `${t.title} · 🎰 ${t.reward} · ${status}`;
    const del = document.createElement('button');
    del.className = 'secondary small-btn';
    del.textContent = 'Slett';
    del.addEventListener('click', async () => {
      if (!confirm(`Slette oppgaven «${t.title}»?`)) return;
      await post('/api/admin/task-delete', { id: t.id });
      await load();
    });
    li.append(span, del);
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

$('new-task-btn').addEventListener('click', async () => {
  try {
    await post('/api/admin/task-add', {
      title: $('new-task-title').value,
      desc: $('new-task-desc').value,
      reward: Number($('new-task-reward').value),
      proof: $('new-task-proof').value,
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
