'use strict';

const $ = (id) => document.getElementById(id);

async function api(path, body) {
  const res = await fetch(path, body
    ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }
    : {});
  const json = await res.json();
  if (!res.ok) throw new Error(json.error || 'Noe gikk galt');
  return json;
}

// ---------- Innstillinger ----------
const W = 400;
const H = 600;
const GROUND = 40;
const STEP_MS = 1000 / 60;
const GRAVITY = 0.42;
const FLAP = -7.4;
const SPEED = 2.5;
const PIPE_EVERY = 90; // steg = 1,5 sekunder (må stemme med serveren)
const PIPE_W = 70;
const GAP = 170;
const BIRD_X = 100;
const BIRD_R = 22;

const canvas = $('game');
const ctx = canvas.getContext('2d');

// Sjefens ansikt. Faller tilbake til en tegnet smilefjes hvis bildet mangler.
const face = new Image();
let faceReady = false;
face.onload = () => (faceReady = true);
face.src = '/boss.png';

let me = null;
let gameId = null;
let mode = 'ready'; // ready | playing | dead
let bird, pipes, score, steps, lastTime, acc, deadAt, result;

function reset() {
  bird = { y: H / 2 - 40, v: 0 };
  pipes = [];
  score = 0;
  steps = 0;
  acc = 0;
  result = null;
  mode = 'ready';
  gameId = null;
  api('/api/game/start', {}).then((r) => (gameId = r.gameId)).catch(() => {});
}

function flap() {
  if (!me) return;
  if (mode === 'ready') mode = 'playing';
  if (mode === 'playing') bird.v = FLAP;
  else if (mode === 'dead' && performance.now() - deadAt > 700) reset();
}

function update() {
  if (mode === 'ready') {
    bird.y = H / 2 - 40 + Math.sin(performance.now() / 250) * 8;
    return;
  }
  if (mode !== 'playing') {
    // la ansiktet falle ned etter krasj
    if (bird.y < H - GROUND - BIRD_R) {
      bird.v += GRAVITY;
      bird.y = Math.min(bird.y + bird.v, H - GROUND - BIRD_R);
    }
    return;
  }

  if (steps % PIPE_EVERY === 0) {
    const min = 80;
    const max = H - GROUND - GAP - 80;
    pipes.push({ x: W, top: min + Math.random() * (max - min), passed: false });
  }
  steps++;

  bird.v += GRAVITY;
  bird.y += bird.v;

  for (const p of pipes) {
    p.x -= SPEED;
    if (!p.passed && p.x + PIPE_W < BIRD_X - BIRD_R) {
      p.passed = true;
      score++;
    }
  }
  pipes = pipes.filter((p) => p.x > -PIPE_W);

  if (bird.y + BIRD_R >= H - GROUND || bird.y - BIRD_R <= 0 || pipes.some(hits)) die();
}

function hits(p) {
  const r = BIRD_R - 4; // litt snill kollisjon
  const inX = BIRD_X + r > p.x && BIRD_X - r < p.x + PIPE_W;
  return inX && (bird.y - r < p.top || bird.y + r > p.top + GAP);
}

async function die() {
  mode = 'dead';
  deadAt = performance.now();
  if (navigator.vibrate) navigator.vibrate(150);
  const finalScore = score;
  if (!gameId) {
    result = { error: 'Fikk ikke kontakt med serveren, poengene ble ikke lagret.' };
    return;
  }
  try {
    const r = await api('/api/game/end', { gameId, score: finalScore });
    me = r.me;
    result = r;
    renderInfo();
    renderLeaderboard(r.leaderboard);
    if (r.earnedSpins) {
      $('game-msg').textContent = `🎉 Du tjente ${r.earnedSpins} nye spinn! Gå til lykkehjulet for å bruke dem.`;
      $('game-msg').className = 'result win';
    }
  } catch (err) {
    result = { error: err.message };
  }
}

// ---------- Tegning ----------
function drawBackground() {
  const g = ctx.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0, '#2a2340');
  g.addColorStop(1, '#13151f');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = '#3a2f1a';
  ctx.fillRect(0, H - GROUND, W, GROUND);
  ctx.fillStyle = '#f5b301';
  ctx.fillRect(0, H - GROUND, W, 4);
}

// Rørene er ølglass: gyllent øl med skum ved åpningen
function drawPipe(x, y, h, foamAtBottom) {
  ctx.fillStyle = '#f5b301';
  ctx.fillRect(x, y, PIPE_W, h);
  ctx.fillStyle = 'rgba(255,255,255,0.25)';
  ctx.fillRect(x + 8, y, 8, h);
  const foamY = foamAtBottom ? y + h - 18 : y;
  ctx.fillStyle = '#fff8e7';
  ctx.fillRect(x - 5, foamY, PIPE_W + 10, 18);
  ctx.strokeStyle = '#c98f00';
  ctx.lineWidth = 3;
  ctx.strokeRect(x, y, PIPE_W, h);
}

function drawFace() {
  ctx.save();
  ctx.translate(BIRD_X, bird.y);
  ctx.rotate(Math.max(-0.5, Math.min(1.2, bird.v / 10)));
  ctx.beginPath();
  ctx.arc(0, 0, BIRD_R + 4, 0, Math.PI * 2);
  ctx.fillStyle = '#fff';
  ctx.fill();
  if (faceReady) {
    ctx.beginPath();
    ctx.arc(0, 0, BIRD_R + 2, 0, Math.PI * 2);
    ctx.clip();
    const s = (BIRD_R + 2) * 2;
    const ratio = face.width / face.height;
    const dw = ratio > 1 ? s * ratio : s;
    const dh = ratio > 1 ? s : s / ratio;
    ctx.drawImage(face, -dw / 2, -dh / 2, dw, dh);
  } else {
    ctx.font = `${BIRD_R * 2}px system-ui`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('😎', 0, 2);
  }
  ctx.restore();
}

function drawText(text, y, size, color = '#fff') {
  ctx.font = `bold ${size}px system-ui, sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.lineWidth = 6;
  ctx.strokeStyle = '#13151f';
  ctx.strokeText(text, W / 2, y);
  ctx.fillStyle = color;
  ctx.fillText(text, W / 2, y);
}

function draw() {
  drawBackground();
  for (const p of pipes) {
    drawPipe(p.x, 0, p.top, true);
    drawPipe(p.x, p.top + GAP, H - GROUND - p.top - GAP, false);
  }
  drawFace();

  if (mode !== 'ready') drawText(String(score), 60, 48);

  if (mode === 'ready') {
    drawText('Trykk for å starte', H / 2 + 60, 26);
  } else if (mode === 'dead') {
    ctx.fillStyle = 'rgba(0,0,0,0.45)';
    ctx.fillRect(0, 0, W, H);
    drawText('Sjefen krasjet! 💥', 190, 30);
    drawText(`${score} poeng`, 250, 40, '#f5b301');
    if (!result) drawText('Lagrer ...', 310, 20);
    else if (result.error) drawText(result.error, 310, 15, '#ff6b6b');
    else {
      if (result.isRecord) drawText('🏆 Ny rekord!', 310, 24, '#3ccf7a');
      if (result.earnedSpins) drawText(`+${result.earnedSpins} spinn på lykkehjulet!`, 350, 22, '#3ccf7a');
    }
    if (performance.now() - deadAt > 700) drawText('Trykk for å prøve igjen', 430, 20);
  }
}

function loop(now) {
  if (lastTime === undefined) lastTime = now;
  acc += Math.min(now - lastTime, 250);
  lastTime = now;
  while (acc >= STEP_MS) {
    update();
    acc -= STEP_MS;
  }
  draw();
  requestAnimationFrame(loop);
}

// ---------- Info og toppliste ----------
function renderInfo() {
  if (!me) return;
  $('best').textContent = me.bestScore;
  $('next').textContent = `${me.nextMilestone.score} poeng → ${me.nextMilestone.spins} spinn`;
}

function renderRewards(first) {
  $('rewards').innerHTML = '';
  for (let k = 1; k <= 5; k++) {
    const li = document.createElement('li');
    li.innerHTML = `<strong>${first * 2 ** (k - 1)} poeng</strong> → ${k} ${k > 1 ? 'nye' : 'nytt'} spinn`;
    $('rewards').appendChild(li);
  }
  const li = document.createElement('li');
  li.className = 'muted';
  li.textContent = '… og sånn fortsetter det, dobbelt så mange poeng gir ett spinn mer.';
  $('rewards').appendChild(li);
}

function renderLeaderboard(list) {
  $('leaderboard').innerHTML = '';
  if (!list.length) {
    $('leaderboard').innerHTML = '<li class="muted">Ingen har spilt ennå.</li>';
    return;
  }
  list.forEach((e, i) => {
    const li = document.createElement('li');
    if (me && e.name === me.name) li.classList.add('me');
    const medal = ['🥇', '🥈', '🥉'][i] || `${i + 1}.`;
    li.innerHTML = `<span class="rank">${medal}</span><span class="lb-name"></span><span class="lb-score">${e.score}</span>`;
    li.querySelector('.lb-name').textContent = e.name;
    $('leaderboard').appendChild(li);
  });
}

async function init() {
  const data = await api('/api/state');
  me = data.me;
  renderRewards(data.settings.gameFirstMilestone);
  renderLeaderboard(data.leaderboard);
  $('not-joined').classList.toggle('hidden', !!me);
  $('game-section').classList.toggle('hidden', !me);
  if (!me) return;
  renderInfo();
  reset();
  requestAnimationFrame(loop);
}

canvas.addEventListener('pointerdown', (e) => {
  e.preventDefault();
  flap();
});
window.addEventListener('keydown', (e) => {
  if (e.code === 'Space' || e.code === 'ArrowUp') {
    e.preventDefault();
    flap();
  }
});

init();
setInterval(() => api('/api/state').then((d) => renderLeaderboard(d.leaderboard)).catch(() => {}), 15000);
