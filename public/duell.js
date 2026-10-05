'use strict';

const $ = (id) => document.getElementById(id);
const EMOJI = { stein: '✊', saks: '✌️', papir: '✋' };
const LABEL = { stein: 'Stein', saks: 'Saks', papir: 'Papir' };

let data = null;
let stake = 1;
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

function moveButtons(onPick) {
  const wrap = document.createElement('div');
  wrap.className = 'moves';
  Object.keys(EMOJI).forEach((m) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'move';
    b.innerHTML = `<span class="move-emoji">${EMOJI[m]}</span>${LABEL[m]}`;
    b.addEventListener('click', () => onPick(m));
    wrap.appendChild(b);
  });
  return wrap;
}

function spinsWord(n) {
  return n === 1 ? '1 spinn' : `${n} spinn`;
}

function resultText(d, myName) {
  const cm = `${EMOJI[d.challengerMove]} ${d.challenger}`;
  const om = `${d.opponent} ${EMOJI[d.opponentMove]}`;
  let outcome;
  if (!d.winner) outcome = 'Uavgjort';
  else if (myName && d.winner === myName) outcome = `Du vant ${spinsWord(d.stake)}! 🎉`;
  else if (myName) outcome = `Du tapte ${spinsWord(d.stake)} 😢`;
  else outcome = `${d.winner} vant ${spinsWord(d.stake)}`;
  return `${cm} mot ${om} · ${outcome}`;
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

function render() {
  const { me } = data;
  $('not-joined').classList.toggle('hidden', !!me);
  $('duel-app').classList.toggle('hidden', !me);

  // Siste dueller (offentlig)
  $('feed').innerHTML = '';
  if (!data.feed.length) $('feed').innerHTML = '<li class="muted">Ingen dueller ennå.</li>';
  data.feed.forEach((d) => {
    const li = document.createElement('li');
    li.textContent = resultText(d, null);
    $('feed').appendChild(li);
  });

  if (!me) return;
  $('my-spins').textContent = me.spinsLeft;

  // Motstandere
  const sel = $('opponent');
  const chosen = sel.value;
  sel.innerHTML = '';
  if (!data.opponents.length) sel.innerHTML = '<option value="">Ingen andre deltakere ennå</option>';
  data.opponents.forEach((n) => {
    const o = document.createElement('option');
    o.value = n;
    o.textContent = n;
    sel.appendChild(o);
  });
  if (data.opponents.includes(chosen)) sel.value = chosen;

  stake = Math.max(1, Math.min(stake, me.spinsLeft || 1));
  $('stake').textContent = stake;

  // Innkommende
  $('incoming-section').classList.toggle('hidden', !data.incoming.length);
  $('incoming').innerHTML = '';
  data.incoming.forEach((d) => {
    const box = document.createElement('div');
    box.className = 'duel-box';
    const p = document.createElement('p');
    p.innerHTML = `<strong></strong> utfordrer deg om <strong>${spinsWord(d.stake)}</strong>! Velg ditt trekk:`;
    p.querySelector('strong').textContent = d.challenger;
    box.appendChild(p);
    box.appendChild(moveButtons((m) => act(async () => {
      const r = await api('/api/duel/respond', { duelId: d.id, move: m });
      const won = r.duel.winner === me.name;
      showMsg(resultText(r.duel, me.name), r.duel.winner ? (won ? 'win' : 'lose') : '');
    })));
    const decline = document.createElement('button');
    decline.className = 'secondary small-btn';
    decline.textContent = 'Avslå';
    decline.addEventListener('click', () => act(async () => {
      await api('/api/duel/respond', { duelId: d.id, decline: true });
      showMsg('Du avslo utfordringen.');
    }));
    box.appendChild(decline);
    $('incoming').appendChild(box);
  });

  // Utgående
  $('outgoing-section').classList.toggle('hidden', !data.outgoing.length);
  $('outgoing').innerHTML = '';
  data.outgoing.forEach((d) => {
    const row = document.createElement('div');
    row.className = 'duel-row';
    const span = document.createElement('span');
    span.textContent = `${EMOJI[d.challengerMove]} mot ${d.opponent} · ${spinsWord(d.stake)}`;
    const cancel = document.createElement('button');
    cancel.className = 'secondary small-btn';
    cancel.textContent = 'Trekk tilbake';
    cancel.addEventListener('click', () => act(async () => {
      await api('/api/duel/cancel', { duelId: d.id });
      showMsg('Utfordringen er trukket tilbake, og du har fått innsatsen tilbake.');
    }));
    row.append(span, cancel);
    $('outgoing').appendChild(row);
  });

  // Historikk
  $('history').innerHTML = '';
  if (!data.history.length) $('history').innerHTML = '<li class="muted">Du har ikke duellert ennå.</li>';
  data.history.forEach((d) => {
    const li = document.createElement('li');
    if (d.status === 'done') {
      li.textContent = resultText(d, me.name);
      if (d.winner) li.classList.add(d.winner === me.name ? 'won' : 'lost');
    } else {
      const other = d.challenger === me.name ? d.opponent : d.challenger;
      li.textContent = `Duell med ${other} · ${d.status === 'declined' ? 'avslått' : 'trukket tilbake'}`;
      li.classList.add('muted');
    }
    $('history').appendChild(li);
  });
}

async function refresh() {
  try {
    data = await api('/api/duels');
    render();
  } catch (err) {
    console.error(err);
  }
}

$('stake-minus').addEventListener('click', () => {
  stake = Math.max(1, stake - 1);
  $('stake').textContent = stake;
});
$('stake-plus').addEventListener('click', () => {
  stake = Math.min(Math.max(1, data.me ? data.me.spinsLeft : 1), stake + 1);
  $('stake').textContent = stake;
});

$('challenge-moves').replaceWith(Object.assign(moveButtons((m) => act(async () => {
  const opponent = $('opponent').value;
  if (!opponent) throw new Error('Velg en motstander.');
  await api('/api/duel/challenge', { opponent, stake, move: m });
  showMsg(`Utfordring sendt til ${opponent}! Du valgte ${LABEL[m].toLowerCase()} ${EMOJI[m]}`, 'win');
})), { id: 'challenge-moves' }));

refresh();
setInterval(() => !busy && refresh(), 4000);
