'use strict';

const $ = (id) => document.getElementById(id);

let data = null;
let spinning = false;
let rotation = 0;

async function api(path, body) {
  const res = await fetch(path, body
    ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }
    : {});
  const json = await res.json();
  if (!res.ok) throw new Error(json.error || 'Noe gikk galt');
  return json;
}

// ---------- Lykkehjul ----------
const SEGMENTS = 20;
const BEER_SEGMENTS = [0, 7, 14]; // 3 av 20 = 15 %
const MISS_LABELS = ['Bom', 'Neste gang', 'Vann', 'Nope', 'Snart', 'Prøv igjen'];
const segments = Array.from({ length: SEGMENTS }, (_, i) =>
  BEER_SEGMENTS.includes(i) ? { beer: true, label: '🍺 ØL!' } : { beer: false, label: MISS_LABELS[i % MISS_LABELS.length] });

function drawWheel() {
  const canvas = $('wheel');
  const ctx = canvas.getContext('2d');
  const r = canvas.width / 2;
  const seg = (Math.PI * 2) / SEGMENTS;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  segments.forEach((s, i) => {
    const start = -Math.PI / 2 + i * seg;
    ctx.beginPath();
    ctx.moveTo(r, r);
    ctx.arc(r, r, r - 6, start, start + seg);
    ctx.closePath();
    ctx.fillStyle = s.beer ? '#f5b301' : i % 2 ? '#2b2f45' : '#3a3f5c';
    ctx.fill();
    ctx.strokeStyle = '#1b1e2e';
    ctx.lineWidth = 3;
    ctx.stroke();

    ctx.save();
    ctx.translate(r, r);
    ctx.rotate(start + seg / 2);
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = s.beer ? '#1b1e2e' : '#e8e8f0';
    ctx.font = s.beer ? 'bold 30px system-ui, sans-serif' : '22px system-ui, sans-serif';
    ctx.fillText(s.label, r - 24, 0);
    ctx.restore();
  });
  ctx.beginPath();
  ctx.arc(r, r, 40, 0, Math.PI * 2);
  ctx.fillStyle = '#f5b301';
  ctx.fill();
  ctx.font = '40px system-ui';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('🍺', r, r + 2);
}

function spinTo(win) {
  const candidates = segments.map((s, i) => (s.beer === win ? i : -1)).filter((i) => i >= 0);
  const target = candidates[Math.floor(Math.random() * candidates.length)];
  const segDeg = 360 / SEGMENTS;
  const jitter = (Math.random() - 0.5) * segDeg * 0.7;
  // Segment i ligger (i + 0.5) * segDeg med klokka fra toppen; roter så det havner under pila.
  const wanted = (360 - (target + 0.5) * segDeg + jitter + 360) % 360;
  const current = ((rotation % 360) + 360) % 360;
  rotation += 360 * 6 + ((wanted - current + 360) % 360);
  $('wheel').style.transform = `rotate(${rotation}deg)`;
  return new Promise((resolve) => setTimeout(resolve, 5200));
}

async function onSpin() {
  if (spinning) return;
  spinning = true;
  $('spin-btn').disabled = true;
  $('spin-result').textContent = '';
  $('spin-result').className = 'result';
  try {
    const result = await api('/api/spin', {});
    await spinTo(result.win);
    data.me = result.me;
    $('spin-result').textContent = result.win ? '🎉 Gratulerer! Du vant en øl! 🍺' : '😢 Ingen øl denne gangen.';
    $('spin-result').classList.add(result.win ? 'win' : 'lose');
  } catch (err) {
    $('spin-result').textContent = err.message;
    $('spin-result').classList.add('lose');
  }
  spinning = false;
  render();
}

// ---------- Visning ----------
function render() {
  const { settings, me, draw } = data;
  $('tpp').textContent = settings.ticketsPerPerson;
  $('spp').textContent = settings.spinsPerPerson;
  $('chance').textContent = `${Math.round(settings.spinWinChance * 100)} %`;
  $('win-count').textContent = settings.winningTickets;
  $('total-count').textContent = settings.totalTickets;
  $('participant-count').textContent = data.participantCount;
  $('tickets-left').textContent = data.ticketsLeft;

  $('join-section').classList.toggle('hidden', !!me || !!draw);
  $('me-section').classList.toggle('hidden', !me);
  $('wheel-section').classList.toggle('hidden', !me);

  if (me) {
    $('me-name').textContent = me.name;
    const winSet = new Set(me.winningTickets);
    $('my-tickets').innerHTML = '';
    me.tickets.forEach((t) => {
      const el = document.createElement('div');
      el.className = 'ticket' + (winSet.has(t) ? ' winner' : '');
      el.textContent = `#${t}`;
      $('my-tickets').appendChild(el);
    });
    if (draw) {
      $('my-result').textContent = me.winningTickets.length
        ? `🎉 Du har ${me.winningTickets.length} vinnerlodd! Det er ${me.winningTickets.length} øl til deg! 🍺`
        : 'Ingen vinnerlodd denne gangen 😢';
      $('my-result').className = 'result ' + (me.winningTickets.length ? 'win' : 'lose');
    } else {
      $('my-result').textContent = '';
    }
    $('spins-left').textContent = me.spinsLeft;
    if (!spinning) $('spin-btn').disabled = me.spinsLeft <= 0;
    $('spin-btn').textContent = me.spinsLeft > 0 ? 'Spinn! 🎰' : 'Ingen spinn igjen';
    $('spin-total').textContent = me.spinWins
      ? `Du har vunnet ${me.spinWins} øl på hjulet totalt 🍺`
      : '';
  }

  $('draw-pending').classList.toggle('hidden', !!draw);
  $('draw-done').classList.toggle('hidden', !draw);
  if (draw) {
    $('winners').innerHTML = '';
    draw.winners.forEach((w) => {
      const li = document.createElement('li');
      li.innerHTML = `<span class="ticket small">#${w.ticket}</span> `;
      li.append(w.name ? w.name : 'Ikke utdelt');
      if (!w.name) li.classList.add('muted');
      $('winners').appendChild(li);
    });
  }

  $('participants').innerHTML = '';
  if (!data.participants.length) {
    $('participants').innerHTML = '<li class="muted">Ingen ennå – bli den første!</li>';
  }
  data.participants.forEach((n) => {
    const li = document.createElement('li');
    li.textContent = n;
    $('participants').appendChild(li);
  });
}

async function refresh() {
  try {
    const fresh = await api('/api/state');
    if (spinning) fresh.me = data.me; // ikke avslør resultatet før hjulet stopper
    data = fresh;
    render();
  } catch (err) {
    console.error(err);
  }
}

$('join-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  $('join-error').textContent = '';
  try {
    await api('/api/join', { name: $('name').value });
    await refresh();
  } catch (err) {
    $('join-error').textContent = err.message;
  }
});

$('spin-btn').addEventListener('click', onSpin);

drawWheel();
refresh();
setInterval(refresh, 8000);
