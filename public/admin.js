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

async function load() {
  const data = await post('/api/admin/login');
  $('panel').classList.remove('hidden');
  $('count').textContent = data.participants.length;
  $('rows').innerHTML = '';
  data.participants.forEach((p) => {
    const tr = document.createElement('tr');
    [p.name, p.tickets.join(', '), `${p.spinsUsed}/${p.spinsAllowed}`, p.spinWins, p.bestScore].forEach((v) => {
      const td = document.createElement('td');
      td.textContent = v;
      tr.appendChild(td);
    });
    $('rows').appendChild(tr);
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

$('login-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  password = $('password').value;
  try {
    await load();
    showMsg('Innlogget ✅', true);
  } catch (err) {
    $('panel').classList.add('hidden');
    showMsg(err.message);
  }
});

$('draw-btn').addEventListener('click', async () => {
  if (!confirm('Kjøre loddtrekningen nå? Den kan bare kjøres én gang.')) return;
  try {
    const { draw } = await post('/api/admin/draw');
    renderDraw(draw);
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
