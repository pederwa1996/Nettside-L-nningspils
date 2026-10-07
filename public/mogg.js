import { analyzeFace, preload, verdict, PART_LABELS } from '/mogg-analyze.mjs';

const $ = (id) => document.getElementById(`mg-${id}`); // mogg-off ligger på PvP-siden med egne id-er
let data = null;
let busy = false;
let flow = null; // { mode: 'challenge'|'respond'|'practice', opponent?, id?, result? }

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

const fmt = (n) => Number(n).toFixed(2);

// ---------- Pallen ----------
function renderPodium() {
  const pod = data.podium;
  $('podium').innerHTML = '';
  if (!pod.length) {
    $('podium').innerHTML = '<p class="muted center">Ingen har mogget ennå. Bli den første chaden på pallen!</p>';
  }
  // Rekkefølge på pallen: 2. – 1. – 3.
  [1, 0, 2].forEach((i) => {
    const e = pod[i];
    if (!e) return;
    const col = document.createElement('div');
    col.className = `podium-col place-${i + 1}`;
    const img = document.createElement('img');
    img.src = e.url;
    img.alt = e.name;
    const name = document.createElement('div');
    name.className = 'podium-name';
    name.textContent = e.name;
    const score = document.createElement('div');
    score.className = 'podium-score';
    score.textContent = fmt(e.score);
    const step = document.createElement('div');
    step.className = 'podium-step';
    step.textContent = ['🥇', '🥈', '🥉'][i];
    col.append(img, name, score, step);
    $('podium').appendChild(col);
  });
  $('podium-rest').innerHTML = '';
  pod.slice(3).forEach((e) => {
    const li = document.createElement('li');
    li.append(avatarEl(e.url, e.name, 32));
    const n = document.createElement('span');
    n.className = 'lb-name';
    n.textContent = e.name;
    const s = document.createElement('span');
    s.className = 'lb-score';
    s.textContent = fmt(e.score);
    li.append(n, s);
    $('podium-rest').appendChild(li);
  });
}

// ---------- Resultater ----------
function face(url, name, score, won) {
  const d = document.createElement('div');
  d.className = 'vs-face' + (won ? ' won' : '');
  const img = document.createElement('img');
  img.src = url;
  img.alt = name;
  const n = document.createElement('div');
  n.className = 'vs-name';
  n.textContent = name;
  const s = document.createElement('div');
  s.className = 'vs-score';
  s.textContent = fmt(score);
  d.append(img, n, s);
  if (won) {
    const crown = document.createElement('span');
    crown.className = 'vs-crown';
    crown.textContent = '👑';
    d.appendChild(crown);
  }
  return d;
}

function renderFeed() {
  $('feed').innerHTML = '';
  if (!data.feed.length) $('feed').innerHTML = '<p class="muted">Ingen mogg-offs ennå.</p>';
  data.feed.forEach((m) => {
    const box = document.createElement('div');
    box.className = 'vs';
    const mid = document.createElement('div');
    mid.className = 'vs-mid';
    mid.textContent = 'VS';
    box.append(
      face(m.challengerUrl, m.challenger, m.challengerScore, m.winner === m.challenger),
      mid,
      face(m.opponentUrl, m.opponent, m.opponentScore, m.winner === m.opponent),
    );
    const res = document.createElement('p');
    res.className = 'vs-result';
    res.textContent = m.winner
      ? `${m.winner} mogget ${m.winner === m.challenger ? m.opponent : m.challenger} og vant 1 spinn 🗿`
      : 'Uavgjort! Ingen ble mogget.';
    $('feed').append(box, res);
  });
}

function render() {
  const { me } = data;
  renderPodium();
  renderFeed();
  $('not-joined').classList.toggle('hidden', !!me);
  $('mogg-app').classList.toggle('hidden', !me);
  if (!me) return;
  $('my-spins').textContent = me.spinsLeft;

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

  $('incoming-section').classList.toggle('hidden', !data.incoming.length);
  $('incoming').innerHTML = '';
  data.incoming.forEach((m) => {
    const box = document.createElement('div');
    box.className = 'duel-box';
    const p = document.createElement('p');
    p.append(avatarEl(data.avatars[m.challenger], m.challenger, 32), document.createTextNode(' '));
    const b = document.createElement('strong');
    b.textContent = m.challenger;
    p.append(b, document.createTextNode(' utfordrer deg til mogg-off om 1 spinn! Scoren til utfordreren er hemmelig til du har tatt ditt bilde.'));
    const go = document.createElement('button');
    go.textContent = '📸 Ta selfie og svar';
    go.addEventListener('click', () => startFlow({ mode: 'respond', id: m.id, opponent: m.challenger }));
    const decline = document.createElement('button');
    decline.className = 'secondary small-btn';
    decline.textContent = 'Avslå';
    decline.addEventListener('click', () => act(async () => {
      await api('/api/mogg/respond', { id: m.id, decline: true });
      showMsg('Du avslo utfordringen.');
    }));
    const row = document.createElement('div');
    row.className = 'story-actions';
    row.append(go, decline);
    box.append(p, row);
    $('incoming').appendChild(box);
  });

  $('outgoing-section').classList.toggle('hidden', !data.outgoing.length);
  $('outgoing').innerHTML = '';
  data.outgoing.forEach((m) => {
    const row = document.createElement('div');
    row.className = 'duel-row';
    const span = document.createElement('span');
    span.textContent = `Mot ${m.opponent} · din score ${fmt(m.challengerScore)}`;
    const cancel = document.createElement('button');
    cancel.className = 'secondary small-btn';
    cancel.textContent = 'Trekk tilbake';
    cancel.addEventListener('click', () => act(async () => {
      await api('/api/mogg/cancel', { id: m.id });
      showMsg('Utfordringen er trukket tilbake, og du har fått spinnet tilbake.');
    }));
    row.append(span, cancel);
    $('outgoing').appendChild(row);
  });
}

async function refresh() {
  try {
    data = await api('/api/mogg');
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

// ---------- Selfie og analyse ----------
function startFlow(f) {
  flow = f;
  $('camera').click();
}

function closeModal() {
  $('analyze').classList.add('hidden');
  document.body.classList.remove('no-scroll');
  flow = null;
}

const STEPS = ['Måler kjevelinjen ...', 'Sjekker jegerøynene ...', 'Beregner chad-faktor ...', 'Sammenligner med Sigma-databasen ...'];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

$('camera').addEventListener('change', async () => {
  const file = $('camera').files[0];
  $('camera').value = '';
  if (!file || !flow) return;

  $('analyze').classList.remove('hidden');
  document.body.classList.add('no-scroll');
  $('analyze-busy').classList.remove('hidden');
  $('analyze-result').classList.add('hidden');
  $('analyze-submit').classList.add('hidden');
  $('analyze-retake').classList.add('hidden');
  $('analyze-error').textContent = '';
  $('analyze-img').src = URL.createObjectURL(file);

  let i = 0;
  $('analyze-step').textContent = STEPS[0];
  const ticker = setInterval(() => ($('analyze-step').textContent = STEPS[++i % STEPS.length]), 700);
  try {
    // Litt dramatisk ventetid, selv om analysen er rask
    const [result] = await Promise.all([analyzeFace(file, resizeImage), sleep(2200)]);
    clearInterval(ticker);
    flow.result = result;
    $('analyze-img').src = result.image;
    await revealScore(result);
  } catch (err) {
    clearInterval(ticker);
    $('analyze-busy').classList.add('hidden');
    $('analyze-error').textContent = err.message.includes('ansikt') ? err.message : `Analysen feilet: ${err.message}`;
  }
  $('analyze-retake').classList.remove('hidden');
});

async function revealScore(result) {
  $('analyze-busy').classList.add('hidden');
  $('analyze-result').classList.remove('hidden');
  $('analyze-verdict').textContent = '';
  $('analyze-parts').innerHTML = '';
  const start = performance.now();
  await new Promise((resolve) => {
    const tick = (now) => {
      const t = Math.min(1, (now - start) / 1200);
      $('analyze-score').textContent = fmt(result.score * (1 - Math.pow(1 - t, 3)));
      if (t < 1) requestAnimationFrame(tick);
      else resolve();
    };
    requestAnimationFrame(tick);
  });
  $('analyze-score').textContent = fmt(result.score);
  $('analyze-verdict').textContent = verdict(result.score);
  Object.entries(PART_LABELS).forEach(([k, label]) => {
    const row = document.createElement('div');
    row.className = 'mogg-part';
    row.innerHTML = `<span></span><span class="bar"><span style="width:${result.parts[k] * 10}%"></span></span><span class="val">${result.parts[k].toFixed(1)}</span>`;
    row.firstChild.textContent = label;
    $('analyze-parts').appendChild(row);
  });
  if (flow.mode !== 'practice') {
    $('analyze-submit').textContent = flow.mode === 'challenge' ? `Utfordre ${flow.opponent} ⚔️` : 'Send inn og se hvem som vant';
    $('analyze-submit').classList.remove('hidden');
  }
}

$('analyze-cancel').addEventListener('click', closeModal);
$('analyze-retake').addEventListener('click', () => $('camera').click());
$('analyze-submit').addEventListener('click', async () => {
  const f = flow;
  if (!f || !f.result) return;
  $('analyze-submit').disabled = true;
  try {
    const payload = { image: f.result.image, score: f.result.score, parts: f.result.parts };
    if (f.mode === 'challenge') {
      await api('/api/mogg/challenge', { opponent: f.opponent, ...payload });
      showMsg(`Utfordring sendt til ${f.opponent} med score ${fmt(f.result.score)} 🗿`, 'win');
    } else {
      const r = await api('/api/mogg/respond', { id: f.id, ...payload });
      const m = r.mogg;
      if (!m.winner) showMsg(`Uavgjort! Begge fikk ${fmt(m.opponentScore)}.`);
      else if (m.winner === data.me.name) showMsg(`🗿 Du mogget ${m.challenger}! ${fmt(m.opponentScore)} mot ${fmt(m.challengerScore)}. +1 spinn`, 'win');
      else showMsg(`😬 ${m.challenger} mogget deg. ${fmt(m.challengerScore)} mot ${fmt(m.opponentScore)}. −1 spinn`, 'lose');
    }
    closeModal();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  } catch (err) {
    $('analyze-error').textContent = err.message;
  }
  $('analyze-submit').disabled = false;
  refresh();
});

$('challenge-btn').addEventListener('click', () => {
  const opponent = $('opponent').value;
  if (!opponent) return showMsg('Velg en motstander.', 'lose');
  if (data.me.spinsLeft < 1) return showMsg('Du trenger minst 1 spinn for å utfordre.', 'lose');
  startFlow({ mode: 'challenge', opponent });
});
$('practice-btn').addEventListener('click', () => startFlow({ mode: 'practice' }));

refresh();
preload();
setInterval(() => !busy && !flow && refresh(), 5000);
