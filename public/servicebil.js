'use strict';

// 🚐 Branæs Servicebil: kjør Røa Elektriske-bilen ut til kundene og gjør jobben.
// Fase 1 (veien): styr bilen med fingeren (dra) eller piltastene, unngå trafikken og spis pølser
//   og vafler så energien holder. Fase 2 (hos kunden): hver 1000 m stopper du og får en jobb,
//   et lite elektriker-minispill (servicebil-jobb.js) som blir vanskeligere utover dagen.
//   Feiler du, klager kunden. Tre klager, og sjefen ringer og avslutter dagen.
(function () {
  const $ = (id) => document.getElementById(id);

  async function api(path, body) {
    const res = await fetch(path, body
      ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }
      : {});
    const json = await res.json();
    if (!res.ok) throw new Error(json.error || 'Noe gikk galt');
    return json;
  }

  // ---------- Mål og innstillinger ----------
  const W = 400;
  const H = 700;
  const ROAD_L = 62;
  const ROAD_R = 338;
  const LANE_W = (ROAD_R - ROAD_L) / 3;
  const laneX = (i) => ROAD_L + LANE_W * (i + 0.5);
  const CAR_W = 46;
  const CAR_H = 92;
  const CAR_Y = H - 170;
  const SPEED_START = 300; // px per sekund
  const SPEED_MAX = 720;
  const SPEED_GAIN = 7; // per sekund
  const PX_PER_M = 10; // 10 px = 1 meter
  const PX_PER_POINT = 40;
  const STOP_EVERY_M = 1000;
  const ENERGY_DRAIN = 3.2; // per sekund på veien
  const FOOD_POINTS = 10;
  const MAX_COMPLAINTS = 3;
  const BLUE = '#26397a';

  const FOODS = [
    { k: 'pølse', icon: '🌭', name: 'Pølse', energy: 22, ring: '#e8590c', weight: 0.65 },
    { k: 'vaffel', icon: '🧇', name: 'Vaffel', energy: 32, ring: '#f2b705', weight: 0.35 },
  ];
  const CUSTOMERS = [
    { name: 'Fru Hansen', place: 'Røa' }, { name: 'Familien Berg', place: 'Smestad' }, { name: 'Kebabsjappa', place: 'Majorstua' },
    { name: 'Barnehagen Solstråla', place: 'Vinderen' }, { name: 'Tannlegen', place: 'Ullern' }, { name: 'Hytta til sjefen', place: 'Bærum' },
    { name: 'Bestemor Olsen', place: 'Hovseter' }, { name: 'Pizzeriaen', place: 'Bogstadveien' }, { name: 'Frisøren', place: 'Røa senter' },
    { name: 'Advokatkontoret', place: 'Frogner' }, { name: 'Bakeriet', place: 'Grefsen' }, { name: 'Los Tacos', place: 'Majorstua' },
  ];

  // Røa Elektriske-logoen (samme som på forsiden)
  const logo = new Image();
  let logoReady = false;
  logo.onload = () => (logoReady = true);
  logo.src = '/roa-logo.svg';

  // ---------- Lerret (skarpt på mobil) ----------
  const canvas = $('servicebil');
  const ctx = canvas.getContext('2d');
  const dpr = Math.min(3, window.devicePixelRatio || 1);
  canvas.width = W * dpr;
  canvas.height = H * dpr;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

  // ---------- Tilstand ----------
  let me = null;
  let info = null;
  let gameId = null;
  let mode = 'ready'; // ready | playing | arrive | job | jobdone | dead
  let car;
  let speed;
  let distance;
  let bonus;
  let jobsDone;
  let level;
  let complaints;
  let energy;
  let hungryWarned;
  let things; // hindringer, mat og kundens parkeringsplass
  let scenery; // hus og trær langs veien
  let floaters;
  let sparks;
  let nextRowAt;
  let nextTollAt;
  let nextStopAt;
  let job;
  let jobResult;
  let customer;
  let resumeSpeed;
  let brake;
  let dash;
  let shake;
  let deadAt;
  let doneAt;
  let result;

  function reset() {
    car = { x: laneX(1), target: laneX(1), tilt: 0 };
    speed = SPEED_START;
    distance = 0;
    bonus = 0;
    jobsDone = 0;
    level = 0;
    complaints = 0;
    energy = 100;
    hungryWarned = false;
    things = [];
    floaters = [];
    sparks = [];
    nextRowAt = 500;
    nextTollAt = 5200;
    nextStopAt = STOP_EVERY_M * PX_PER_M;
    job = null;
    jobResult = null;
    customer = null;
    dash = 0;
    shake = 0;
    result = null;
    if (!scenery) {
      scenery = [];
      for (let y = -100; y < H + 100; y += 90) addScenery(y);
    }
    mode = 'ready';
    gameId = null;
    api('/api/hiace/start', {}).then((r) => (gameId = r.gameId)).catch(() => {});
  }

  const score = () => Math.floor(distance / PX_PER_POINT) + bonus;
  const meters = () => Math.floor(distance / PX_PER_M);

  // ---------- Kulisser: villahus, trær og lyktestolper (Røa-stemning) ----------
  const HOUSE_COLORS = ['#f2e6c9', '#d9534f', '#f5f5f0', '#5b7fa6', '#e8c547', '#8fb07a', '#c98f5b'];
  function addScenery(y) {
    for (const side of [0, 1]) {
      const r = Math.random();
      const x = side ? ROAD_R + 34 : ROAD_L - 34;
      if (r < 0.45) scenery.push({ type: 'house', x, y, side, color: HOUSE_COLORS[Math.floor(Math.random() * HOUSE_COLORS.length)], roof: Math.random() < 0.5 ? '#3b3b3b' : '#7a2e1f' });
      else if (r < 0.85) scenery.push({ type: 'tree', x: x + (Math.random() - 0.5) * 16, y, s: 16 + Math.random() * 8 });
      if (Math.random() < 0.3) scenery.push({ type: 'lamp', x: side ? ROAD_R + 6 : ROAD_L - 6, y: y + 40, side });
    }
  }

  // ---------- Hindringer ----------
  const CAR_COLORS = ['#c0392b', '#2c3e50', '#16a085', '#8e44ad', '#f39c12', '#7f8c8d', '#2980b9', '#ecf0f1'];
  function makeObstacle(kind, lane, y) {
    const x = laneX(lane);
    if (kind === 'car') return { kind, x, y, w: 40, h: 76, color: CAR_COLORS[Math.floor(Math.random() * CAR_COLORS.length)], hit: true, lane };
    if (kind === 'hole') return { kind, x, y, w: 46, h: 30, hit: true, lane };
    if (kind === 'works') return { kind, x, y, w: LANE_W - 14, h: 30, hit: true, lane };
    if (kind === 'tram') return { kind, x: laneX(1), y: y - 120, w: 52, h: 200, hit: true, lane: 1 };
    if (kind === 'bar') return { kind, x, y, w: LANE_W - 4, h: 14, hit: true, lane };
    return null;
  }

  // Hvilke filer er opptatt rundt et område øverst (så det alltid finnes en vei forbi)
  function busyLanes(top, bottom) {
    const busy = new Set();
    things.forEach((t) => {
      if (!t.hit || t.kind === 'guard') return;
      if (t.y + t.h / 2 > top && t.y - t.h / 2 < bottom) busy.add(t.lane);
    });
    return busy;
  }

  function spawnRow() {
    const y = -80;
    const busy = busyLanes(y - 160, y + 140);
    const free = [0, 1, 2].filter((l) => !busy.has(l));
    if (free.length <= 1) return; // la spilleren puste
    const hard = distance > 3500;
    const r = Math.random();

    // P-vakt som går over veien (alene i raden)
    if (r < 0.1 && distance > 1500 && busy.size === 0) {
      const fromLeft = Math.random() < 0.5;
      things.push({ kind: 'guard', x: fromLeft ? ROAD_L - 10 : ROAD_R + 10, y, w: 26, h: 26, vx: (fromLeft ? 1 : -1) * (55 + Math.random() * 30), hit: true, lane: -1 });
      return;
    }
    // Trikken i midtfila
    if (r < 0.2 && free.includes(1) && busy.size === 0 && distance > 1200) {
      things.push(makeObstacle('tram', 1, y));
      if (Math.random() < 0.6) addFood(Math.random() < 0.5 ? 0 : 2, y - 60);
      return;
    }
    const kinds = ['car', 'car', 'hole', 'works'];
    const shuffled = free.sort(() => Math.random() - 0.5);
    const blocks = hard && shuffled.length === 3 && Math.random() < 0.45 ? 2 : 1;
    for (let i = 0; i < blocks; i++) things.push(makeObstacle(kinds[Math.floor(Math.random() * kinds.length)], shuffled[i], y + (Math.random() - 0.5) * 30));
    const left = shuffled.slice(blocks);
    // Mer mat når montøren er sulten
    if (left.length && Math.random() < (energy < 40 ? 0.7 : 0.45)) addFood(left[Math.floor(Math.random() * left.length)], y - 10);
  }

  function addFood(lane, y) {
    const food = Math.random() < FOODS[0].weight ? FOODS[0] : FOODS[1];
    things.push({ kind: 'food', food, x: laneX(lane), y, w: 34, h: 34, hit: false, lane });
  }

  function spawnToll() {
    const y = -80;
    if (busyLanes(y - 220, y + 200).size) return false;
    const open = Math.floor(Math.random() * 3);
    things.push({ kind: 'gantry', x: W / 2, y: y - 10, w: 0, h: 0, hit: false, lane: -1, open });
    [0, 1, 2].filter((l) => l !== open).forEach((l) => things.push(makeObstacle('bar', l, y)));
    return true;
  }

  // ---------- Styring ----------
  let drag = null;
  const keys = { left: false, right: false };
  function toLogical(e) {
    const r = canvas.getBoundingClientRect();
    return { x: ((e.clientX - r.left) / r.width) * W, y: ((e.clientY - r.top) / r.height) * H };
  }
  canvas.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    startAudio();
    const p = toLogical(e);
    if (mode === 'ready') start();
    else if (mode === 'dead') {
      if (performance.now() - deadAt > 900) reset();
      return;
    } else if (mode === 'job') {
      canvas.setPointerCapture(e.pointerId);
      ServiceJobs.down(job, p.x, p.y);
      return;
    } else if (mode === 'jobdone') {
      if (performance.now() - doneAt > 700) leaveCustomer();
      return;
    }
    drag = { id: e.pointerId, x0: p.x, car0: car.target };
    canvas.setPointerCapture(e.pointerId);
  });
  canvas.addEventListener('pointermove', (e) => {
    const p = toLogical(e);
    if (mode === 'job') return ServiceJobs.move(job, p.x, p.y);
    if (!drag || e.pointerId !== drag.id || mode !== 'playing') return;
    car.target = clampX(drag.car0 + (p.x - drag.x0) * 1.25);
  });
  const endDrag = (e) => {
    if (mode === 'job') {
      const p = toLogical(e);
      ServiceJobs.up(job, p.x, p.y);
    }
    if (drag && e.pointerId === drag.id) drag = null;
  };
  canvas.addEventListener('pointerup', endDrag);
  canvas.addEventListener('pointercancel', endDrag);
  document.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowLeft' || e.key === 'a') keys.left = true;
    else if (e.key === 'ArrowRight' || e.key === 'd') keys.right = true;
    else if (e.key === ' ' || e.key === 'Enter') {
      if (mode === 'ready') start();
      else if (mode === 'dead' && performance.now() - deadAt > 900) reset();
      else if (mode === 'jobdone' && performance.now() - doneAt > 700) leaveCustomer();
      else return;
    } else return;
    e.preventDefault();
    startAudio();
  });
  document.addEventListener('keyup', (e) => {
    if (e.key === 'ArrowLeft' || e.key === 'a') keys.left = false;
    if (e.key === 'ArrowRight' || e.key === 'd') keys.right = false;
  });
  const clampX = (x) => Math.max(ROAD_L + CAR_W / 2 + 2, Math.min(ROAD_R - CAR_W / 2 - 2, x));

  function start() {
    if (!me) return;
    mode = 'playing';
    $('sb-msg').textContent = '';
    $('sb-msg').className = 'result';
    if (window.sfx) sfx.play('go');
  }

  // ---------- Motorlyd: en lav, myk dur som stiger med farten ----------
  let audio = null;
  function startAudio() {
    if (audio || !window.AudioContext) return;
    const a = new AudioContext();
    const o1 = a.createOscillator();
    const o2 = a.createOscillator();
    const f = a.createBiquadFilter();
    const g = a.createGain();
    o1.type = 'sawtooth';
    o2.type = 'triangle';
    f.type = 'lowpass';
    f.frequency.value = 380;
    g.gain.value = 0;
    o1.connect(f);
    o2.connect(f);
    f.connect(g).connect(a.destination);
    o1.start();
    o2.start();
    audio = { a, o1, o2, g };
  }
  function engine() {
    if (!audio) return;
    const on = (mode === 'playing' || mode === 'arrive') && !(window.sfx && sfx.muted) && document.visibilityState === 'visible';
    const t = audio.a.currentTime;
    const base = 40 + Math.max(0, speed - 100) * 0.09;
    audio.o1.frequency.setTargetAtTime(base, t, 0.15);
    audio.o2.frequency.setTargetAtTime(base * 2.01, t, 0.15);
    audio.g.gain.setTargetAtTime(on ? 0.035 : 0, t, on ? 0.2 : 0.08);
  }

  // ---------- Fase 2: fram til kunden og gjør jobben ----------
  function arrive() {
    mode = 'arrive';
    customer = CUSTOMERS[Math.floor(Math.random() * CUSTOMERS.length)];
    const stop = { kind: 'stop', x: laneX(2), y: -60, w: 0, h: 0, hit: false, lane: 2, customer, color: HOUSE_COLORS[Math.floor(Math.random() * HOUSE_COLORS.length)] };
    // Rydd veien foran bilen, så man ikke krasjer på vei inn til kunden
    things = things.filter((t) => t.y > CAR_Y + 40);
    things.push(stop);
    resumeSpeed = speed;
    // Jevn oppbremsing slik at bilen står stille akkurat på parkeringsplassen
    brake = { stop, a: (speed * speed) / (2 * (CAR_Y - stop.y)) };
    car.target = laneX(2);
    floaters.push({ x: W / 2, y: 200, text: `🏠 Framme hos ${customer.name}!`, color: '#7dffb0', life: 1.6, big: true });
    if (window.sfx) sfx.play('notify');
  }

  function startJob() {
    level++;
    job = ServiceJobs.create(level);
    mode = 'job';
    if (window.sfx) sfx.play('door');
  }

  function finishJob() {
    jobResult = ServiceJobs.rating(job);
    if (job.state === 'won') {
      jobsDone++;
      bonus += jobResult.points;
    } else complaints++;
    mode = 'jobdone';
    doneAt = performance.now();
    if (job.state !== 'won' && window.sfx) sfx.play('sad');
  }

  function leaveCustomer() {
    if (complaints >= MAX_COMPLAINTS) return endDay('complaints');
    things = things.filter((t) => t.kind !== 'stop');
    job = null;
    mode = 'playing';
    speed = Math.max(SPEED_START, resumeSpeed * 0.85);
    nextStopAt = distance + STOP_EVERY_M * PX_PER_M;
    nextRowAt = distance + speed * 0.9;
    nextTollAt = Math.max(nextTollAt, distance + 2500);
    car.target = laneX(1);
    if (window.sfx) sfx.play('go');
  }

  // ---------- Spill-løkka ----------
  function update(dt) {
    // Kulissene ruller når bilen kjører
    const v = mode === 'playing' || mode === 'arrive' ? speed : mode === 'ready' ? 120 : 0;
    dash = (dash + v * dt) % 60;
    scenery.forEach((s) => (s.y += v * dt));
    scenery = scenery.filter((s) => s.y < H + 120);
    const topmost = Math.min(...scenery.map((s) => s.y), 9999);
    if (topmost > -20) addScenery(topmost - 90);
    floaters.forEach((f) => { f.y -= 40 * dt; f.life -= dt; });
    floaters = floaters.filter((f) => f.life > 0);
    sparks.forEach((p) => { p.x += p.vx * dt; p.y += p.vy * dt; p.vy += 300 * dt; p.life -= dt; });
    sparks = sparks.filter((p) => p.life > 0);
    shake = Math.max(0, shake - dt * 30);

    if (mode === 'job') {
      ServiceJobs.update(job, dt);
      if (job.state !== 'play') finishJob();
      return;
    }
    if (mode === 'arrive') {
      speed = Math.max(0, speed - brake.a * dt);
      distance += speed * dt;
      things.forEach((t) => (t.y += speed * dt));
      car.x += (car.target - car.x) * Math.min(1, dt * 5);
      if (speed < 8 || brake.stop.y >= CAR_Y) {
        speed = 0;
        brake.stop.y = CAR_Y;
        car.x = car.target;
        startJob();
      }
      return;
    }
    if (mode !== 'playing') return;

    speed = Math.min(SPEED_MAX, speed + SPEED_GAIN * dt);
    distance += speed * dt;
    energy = Math.max(0, energy - ENERGY_DRAIN * dt);
    if (energy < 25 && !hungryWarned) {
      hungryWarned = true;
      floaters.push({ x: W / 2, y: CAR_Y - 140, text: '😵 Sulten! Finn en 🌭', color: '#ff9b6b', life: 1.6, big: true });
      if (window.sfx) sfx.play('buzzer');
    }
    if (energy >= 35) hungryWarned = false;
    if (energy <= 0) return endDay('energy');

    // Styring: piltaster flytter målet, bilen glir mykt etter
    if (keys.left) car.target = clampX(car.target - 340 * dt);
    if (keys.right) car.target = clampX(car.target + 340 * dt);
    const prev = car.x;
    car.x += (car.target - car.x) * Math.min(1, dt * 12);
    car.tilt = Math.max(-0.18, Math.min(0.18, ((car.x - prev) / Math.max(dt, 0.001)) * 0.0009));

    // Kunden hver 1000 m
    if (distance >= nextStopAt) return arrive();

    // Nye rader: tettere jo fortere det går (men aldri raskere enn man rekker å reagere)
    if (distance >= nextRowAt && distance < nextStopAt - 900) {
      spawnRow();
      const t = Math.max(0.62, 1.15 - (speed - SPEED_START) / 900);
      nextRowAt = distance + speed * t;
    }
    if (distance >= nextTollAt && distance < nextStopAt - 1500 && spawnToll()) {
      nextTollAt = distance + 6500 + Math.random() * 3000;
      nextRowAt = Math.max(nextRowAt, distance + 260);
    }

    things.forEach((t) => {
      t.y += speed * dt;
      if (t.kind === 'guard') t.x += t.vx * dt;
    });
    things = things.filter((t) => t.y - (t.h || 0) / 2 < H + 60 && !t.gone);

    // Kollisjon (litt snill: boksen er mindre enn bilen)
    const hw = CAR_W / 2 - 4;
    const hh = CAR_H / 2 - 6;
    for (const t of things) {
      const over = Math.abs(t.x - car.x) < hw + t.w / 2 - 2 && Math.abs(t.y - CAR_Y) < hh + t.h / 2 - 2;
      if (!over || t.gone) continue;
      if (t.hit) return crash(t);
      if (t.kind === 'food') eat(t);
    }
  }

  function eat(t) {
    t.gone = true;
    energy = Math.min(100, energy + t.food.energy);
    bonus += FOOD_POINTS;
    floaters.push({ x: t.x, y: t.y, text: `+${t.food.energy} ⚡ ${t.food.icon}`, color: '#ffe27a', life: 0.9 });
    if (window.sfx) sfx.play('coin');
  }

  const END_TEXT = {
    car: 'Du kjørte inn i en bil! 💥', hole: 'Rett i et hull i veien! 🕳️', works: 'Rett i veiarbeidet! 🚧',
    tram: 'Trikken vinner alltid … 🚋', bar: 'Bommen var nede! 🚧', guard: 'Du kjørte nesten ned P-vakta! 👮',
    energy: 'Tom for energi! Montøren må hjem og spise 🌭', complaints: '📞 Sjefen ringer: tre klager, du er ferdig for i dag!',
  };

  function crash(t) {
    shake = 14;
    for (let i = 0; i < 22; i++) sparks.push({ x: car.x, y: CAR_Y - CAR_H / 2, vx: (Math.random() - 0.5) * 340, vy: -Math.random() * 300, life: 0.6 + Math.random() * 0.5, c: Math.random() < 0.5 ? '#ffd34d' : '#ff7a3d' });
    if (window.sfx) sfx.play('clash');
    if (navigator.vibrate) navigator.vibrate([80, 40, 140]);
    endDay(t.kind);
  }

  async function endDay(reason) {
    mode = 'dead';
    deadAt = performance.now();
    if ((reason === 'energy' || reason === 'complaints') && window.sfx) sfx.play('sad'); // krasj har egen lyd
    const finalScore = score();
    result = { reason: END_TEXT[reason] || 'Ferdig for i dag!', score: finalScore, jobs: jobsDone, meters: meters() };
    if (!gameId) {
      result.error = 'Fikk ikke kontakt med serveren, poengene ble ikke lagret.';
      return;
    }
    try {
      const r = await api('/api/hiace/end', { gameId, score: finalScore, jobs: jobsDone });
      Object.assign(result, r);
      me = r.me;
      info = { ...info, best: r.best, next: r.next, leaderboard: r.leaderboard };
      renderInfo();
      if (r.earnedSpins) {
        $('sb-msg').textContent = `🎉 Du tjente ${r.earnedSpins} nye spinn! Bruk dem på lykkehjulet.`;
        $('sb-msg').className = 'result win';
        if (window.celebrate) celebrate({ tier: 'win', icon: '🚐', title: `+${r.earnedSpins} SPINN!`, sub: `${finalScore} poeng i Branæs Servicebil` });
      } else if (r.isRecord && window.sfx) sfx.play('win');
    } catch (err) {
      result.error = err.message;
    }
  }

  // ---------- Tegning ----------
  function roundRect(x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  const rr0 = (x, y, w, h, r) => roundRect(x, y, w, h, r);

  function drawRoad() {
    // Gress og fortau
    ctx.fillStyle = '#4c7a3a';
    ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = '#b9b4a8';
    ctx.fillRect(ROAD_L - 16, 0, 16, H);
    ctx.fillRect(ROAD_R, 0, 16, H);
    ctx.fillStyle = 'rgba(0, 0, 0, 0.12)';
    for (let y = -60 + dash; y < H; y += 30) {
      ctx.fillRect(ROAD_L - 16, y, 16, 1);
      ctx.fillRect(ROAD_R, y, 16, 1);
    }
    // Asfalt
    const g = ctx.createLinearGradient(ROAD_L, 0, ROAD_R, 0);
    g.addColorStop(0, '#34373d');
    g.addColorStop(0.5, '#3d4047');
    g.addColorStop(1, '#34373d');
    ctx.fillStyle = g;
    ctx.fillRect(ROAD_L, 0, ROAD_R - ROAD_L, H);
    // Trikkeskinner i midtfila
    ctx.strokeStyle = 'rgba(200, 200, 210, 0.28)';
    ctx.lineWidth = 2;
    [-10, 10].forEach((dx) => {
      ctx.beginPath();
      ctx.moveTo(laneX(1) + dx, 0);
      ctx.lineTo(laneX(1) + dx, H);
      ctx.stroke();
    });
    // Kantlinjer og stiplede fillinjer
    ctx.fillStyle = '#f2f2f2';
    ctx.fillRect(ROAD_L + 3, 0, 3, H);
    ctx.fillRect(ROAD_R - 6, 0, 3, H);
    ctx.fillStyle = 'rgba(255, 255, 255, 0.8)';
    for (const lx of [ROAD_L + LANE_W, ROAD_L + LANE_W * 2]) {
      for (let y = -60 + dash; y < H; y += 60) ctx.fillRect(lx - 2, y, 4, 30);
    }
  }

  function drawScenery() {
    scenery.forEach((s) => {
      if (s.type === 'house') {
        ctx.save();
        ctx.translate(s.x, s.y);
        ctx.fillStyle = 'rgba(0, 0, 0, 0.18)';
        ctx.fillRect(-21, -25, 46, 54);
        ctx.fillStyle = s.color;
        ctx.fillRect(-24, -28, 46, 54);
        // Saltak sett ovenfra: to flater med møne på midten
        ctx.fillStyle = s.roof;
        ctx.fillRect(-26, -30, 25, 58);
        ctx.fillStyle = shade(s.roof, 25);
        ctx.fillRect(-1, -30, 25, 58);
        ctx.fillStyle = '#ddd';
        ctx.fillRect(s.side ? -18 : 10, -12, 6, 6); // pipe
        ctx.restore();
      } else if (s.type === 'tree') {
        ctx.fillStyle = 'rgba(0, 0, 0, 0.18)';
        ctx.beginPath();
        ctx.arc(s.x + 4, s.y + 5, s.s, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#2f6b2a';
        ctx.beginPath();
        ctx.arc(s.x, s.y, s.s, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#3f8a36';
        ctx.beginPath();
        ctx.arc(s.x - s.s * 0.3, s.y - s.s * 0.3, s.s * 0.55, 0, Math.PI * 2);
        ctx.fill();
      } else if (s.type === 'lamp') {
        ctx.strokeStyle = '#555';
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.moveTo(s.x, s.y);
        ctx.lineTo(s.x + (s.side ? -14 : 14), s.y);
        ctx.stroke();
        ctx.fillStyle = '#ffe9a8';
        ctx.beginPath();
        ctx.arc(s.x + (s.side ? -15 : 15), s.y, 3, 0, Math.PI * 2);
        ctx.fill();
      }
    });
  }

  function shade(hex, amt) {
    const n = parseInt(hex.slice(1), 16);
    const c = (v) => Math.max(0, Math.min(255, v + amt));
    return `rgb(${c(n >> 16)}, ${c((n >> 8) & 255)}, ${c(n & 255)})`;
  }

  // Andre biler sett ovenfra
  function drawCar(t) {
    ctx.save();
    ctx.translate(t.x, t.y);
    ctx.fillStyle = 'rgba(0, 0, 0, 0.3)';
    roundRect(-t.w / 2 + 3, -t.h / 2 + 4, t.w, t.h, 9);
    ctx.fill();
    ctx.fillStyle = t.color;
    roundRect(-t.w / 2, -t.h / 2, t.w, t.h, 9);
    ctx.fill();
    ctx.fillStyle = 'rgba(20, 30, 45, 0.85)';
    roundRect(-t.w / 2 + 5, -t.h / 2 + 16, t.w - 10, 14, 4);
    ctx.fill();
    roundRect(-t.w / 2 + 5, t.h / 2 - 22, t.w - 10, 10, 3);
    ctx.fill();
    ctx.fillStyle = 'rgba(255, 255, 255, 0.18)';
    roundRect(-t.w / 2 + 6, -t.h / 2 + 34, t.w - 12, t.h - 60, 4);
    ctx.fill();
    ctx.fillStyle = '#ff4d4d';
    ctx.fillRect(-t.w / 2 + 3, t.h / 2 - 4, 8, 3);
    ctx.fillRect(t.w / 2 - 11, t.h / 2 - 4, 8, 3);
    ctx.restore();
  }

  function drawThing(t) {
    if (t.kind === 'car') return drawCar(t);
    ctx.save();
    ctx.translate(t.x, t.y);
    if (t.kind === 'hole') {
      ctx.fillStyle = '#1d1e22';
      ctx.beginPath();
      ctx.ellipse(0, 0, t.w / 2, t.h / 2, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = '#55585f';
      ctx.lineWidth = 2;
      ctx.stroke();
      ctx.fillStyle = 'rgba(80, 120, 160, 0.5)';
      ctx.beginPath();
      ctx.ellipse(-4, 2, t.w / 4, t.h / 5, 0, 0, Math.PI * 2);
      ctx.fill();
    } else if (t.kind === 'works') {
      // Sperring med rødt og hvitt + kjegler
      ctx.fillStyle = '#fff';
      ctx.fillRect(-t.w / 2, -7, t.w, 14);
      ctx.fillStyle = '#e03131';
      for (let x = -t.w / 2; x < t.w / 2; x += 14) ctx.fillRect(x, -7, 7, 14);
      ctx.font = '18px system-ui';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('🚧', -t.w / 2 + 6, -14);
      ctx.fillText('🚧', t.w / 2 - 6, -14);
    } else if (t.kind === 'tram') {
      // Blå Oslo-trikk
      ctx.fillStyle = 'rgba(0, 0, 0, 0.3)';
      roundRect(-t.w / 2 + 3, -t.h / 2 + 4, t.w, t.h, 10);
      ctx.fill();
      ctx.fillStyle = '#1f5fbf';
      roundRect(-t.w / 2, -t.h / 2, t.w, t.h, 10);
      ctx.fill();
      ctx.fillStyle = '#e8eef8';
      ctx.fillRect(-t.w / 2 + 5, -t.h / 2 + 10, t.w - 10, t.h - 20);
      ctx.fillStyle = '#1f5fbf';
      for (let y = -t.h / 2 + 40; y < t.h / 2 - 20; y += 50) ctx.fillRect(-t.w / 2, y, t.w, 6);
      ctx.fillStyle = '#333';
      ctx.fillRect(-2, -t.h / 2 + 6, 4, t.h - 12); // strømavtaker
      ctx.fillStyle = '#fff';
      ctx.font = 'bold 11px system-ui';
      ctx.textAlign = 'center';
      ctx.fillText('TRIKK', 0, t.h / 2 - 18);
    } else if (t.kind === 'bar') {
      ctx.fillStyle = '#fff';
      ctx.fillRect(-t.w / 2, -5, t.w, 10);
      ctx.fillStyle = '#e03131';
      for (let x = -t.w / 2; x < t.w / 2; x += 16) ctx.fillRect(x, -5, 8, 10);
    } else if (t.kind === 'gantry') {
      // Bomstasjon over hele veien, med grønn pil over den åpne fila
      ctx.fillStyle = '#5b616b';
      ctx.fillRect(-W / 2 + ROAD_L - 14, -34, ROAD_R - ROAD_L + 28, 12);
      ctx.fillStyle = '#2b2f36';
      ctx.fillRect(-W / 2 + ROAD_L - 14, -26, 8, 30);
      ctx.fillRect(-W / 2 + ROAD_R + 6, -26, 8, 30);
      ctx.fillStyle = '#ffd34d';
      ctx.font = 'bold 10px system-ui';
      ctx.textAlign = 'center';
      ctx.fillText('BOMSTASJON · AUTOPASS', 0, -42);
      for (let l = 0; l < 3; l++) {
        const lx = laneX(l) - W / 2;
        ctx.fillStyle = l === t.open ? '#2ecc71' : '#e74c3c';
        ctx.beginPath();
        ctx.arc(lx, -28, 5, 0, Math.PI * 2);
        ctx.fill();
        if (l === t.open) {
          ctx.font = '16px system-ui';
          ctx.fillText('⬇️', lx, -8);
        }
      }
    } else if (t.kind === 'guard') {
      // P-vakt i uniform, med blokk
      ctx.fillStyle = 'rgba(0, 0, 0, 0.25)';
      ctx.beginPath();
      ctx.ellipse(3, 4, 13, 9, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.font = '26px system-ui';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('👮', 0, 0);
      ctx.fillStyle = '#ffd34d';
      ctx.font = 'bold 9px system-ui';
      ctx.fillText('P-VAKT', 0, -20);
    } else if (t.kind === 'food') {
      // Pølse eller vaffel som svever litt
      const p = 1 + Math.sin(performance.now() / 180 + t.x) * 0.08;
      ctx.scale(p, p);
      ctx.fillStyle = 'rgba(255, 255, 255, 0.85)';
      ctx.beginPath();
      ctx.arc(0, 0, 19, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = t.food.ring;
      ctx.lineWidth = 3;
      ctx.stroke();
      ctx.font = '22px system-ui';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(t.food.icon, 0, 1);
    } else if (t.kind === 'stop') {
      // Kundens hus: parkeringsplass i høyre fil og et skilt med navnet
      ctx.strokeStyle = '#2ecc71';
      ctx.lineWidth = 3;
      ctx.setLineDash([8, 6]);
      rr0(-34, -56, 68, 112, 8);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = 'rgba(46, 204, 113, 0.18)';
      ctx.fill();
      ctx.fillStyle = '#2ecc71';
      ctx.font = '900 13px system-ui';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('P', 0, -40);
      // Huset ved siden av veien
      ctx.fillStyle = 'rgba(0, 0, 0, 0.2)';
      ctx.fillRect(56, -36, 60, 76);
      ctx.fillStyle = t.color;
      ctx.fillRect(52, -40, 60, 76);
      ctx.fillStyle = '#7a2e1f';
      ctx.fillRect(48, -44, 34, 84);
      ctx.fillStyle = '#9a3e2a';
      ctx.fillRect(82, -44, 34, 84);
      ctx.fillStyle = '#14204a';
      rr0(-60, -96, 150, 30, 8);
      ctx.fill();
      ctx.fillStyle = '#ffd56b';
      ctx.font = '800 12px system-ui';
      ctx.fillText(`🏠 ${t.customer.name}`, 15, -81);    }
    ctx.restore();
  }

  // Røa Elektriske-bilen sett ovenfra: hvit Hiace med blå stripe, takstige, blinklys og logo på taket
  function drawVan(x, y, tilt) {
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(tilt);
    const w = CAR_W;
    const h = CAR_H;
    // Skygge
    ctx.fillStyle = 'rgba(0, 0, 0, 0.35)';
    roundRect(-w / 2 + 4, -h / 2 + 6, w, h, 8);
    ctx.fill();
    // Speil
    ctx.fillStyle = '#222';
    ctx.fillRect(-w / 2 - 5, -h / 2 + 14, 6, 8);
    ctx.fillRect(w / 2 - 1, -h / 2 + 14, 6, 8);
    // Karosseri (fronten er kort og flat, som på en Hiace)
    ctx.fillStyle = '#f7f8fa';
    roundRect(-w / 2, -h / 2, w, h, 8);
    ctx.fill();
    ctx.strokeStyle = '#c9ced6';
    ctx.lineWidth = 1;
    ctx.stroke();
    // Blå Røa-stripe langs sidene
    ctx.fillStyle = BLUE;
    ctx.fillRect(-w / 2, -h / 2 + 26, 4, h - 34);
    ctx.fillRect(w / 2 - 4, -h / 2 + 26, 4, h - 34);
    // Frontrute
    ctx.fillStyle = '#1f2a3a';
    roundRect(-w / 2 + 4, -h / 2 + 6, w - 8, 13, 4);
    ctx.fill();
    ctx.fillStyle = 'rgba(255, 255, 255, 0.25)';
    ctx.fillRect(-w / 2 + 8, -h / 2 + 8, 10, 3);
    // Lykter
    ctx.fillStyle = '#fff6c8';
    ctx.fillRect(-w / 2 + 3, -h / 2 + 1, 9, 3);
    ctx.fillRect(w / 2 - 12, -h / 2 + 1, 9, 3);
    // Takstige
    ctx.strokeStyle = '#9aa3ad';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(-w / 2 + 9, -h / 2 + 26);
    ctx.lineTo(-w / 2 + 9, h / 2 - 8);
    ctx.moveTo(w / 2 - 9, -h / 2 + 26);
    ctx.lineTo(w / 2 - 9, h / 2 - 8);
    ctx.stroke();
    ctx.lineWidth = 1.5;
    for (let yy = -h / 2 + 30; yy < h / 2 - 8; yy += 8) {
      ctx.beginPath();
      ctx.moveTo(-w / 2 + 9, yy);
      ctx.lineTo(-w / 2 + 14, yy);
      ctx.moveTo(w / 2 - 14, yy);
      ctx.lineTo(w / 2 - 9, yy);
      ctx.stroke();
    }
    // Logoen på taket (leses langs bilen)
    ctx.save();
    ctx.translate(0, 8);
    ctx.rotate(-Math.PI / 2);
    if (logoReady) ctx.drawImage(logo, -36, -8, 72, 16.4);
    else {
      ctx.fillStyle = BLUE;
      ctx.font = 'bold 8px system-ui';
      ctx.textAlign = 'center';
      ctx.fillText('RØA ELEKTRISKE', 0, 3);
    }
    ctx.restore();
    // Gult blinklys på taket (servicebil)
    const on = Math.floor(performance.now() / 260) % 2 === 0;
    ctx.fillStyle = on ? '#ffb000' : '#8a5a00';
    roundRect(-7, -h / 2 + 21, 14, 6, 2);
    ctx.fill();
    if (on && mode === 'playing') {
      ctx.fillStyle = 'rgba(255, 176, 0, 0.25)';
      ctx.beginPath();
      ctx.arc(0, -h / 2 + 24, 16, 0, Math.PI * 2);
      ctx.fill();
    }
    // Baklys
    ctx.fillStyle = '#e03131';
    ctx.fillRect(-w / 2 + 2, h / 2 - 3, 7, 3);
    ctx.fillRect(w / 2 - 9, h / 2 - 3, 7, 3);
    ctx.restore();
  }

  // Røa-bilen fra siden (startskjermen): en hvit Hiace med logo, stige og blinklys
  function drawSideVan(x, y, s) {
    ctx.save();
    ctx.translate(x, y);
    ctx.scale(s, s);
    // Skygge
    ctx.fillStyle = 'rgba(0, 0, 0, 0.3)';
    ctx.beginPath();
    ctx.ellipse(112, 98, 116, 7, 0, 0, Math.PI * 2);
    ctx.fill();
    // Karosseri: boksformet med kort, skrå front
    ctx.fillStyle = '#f7f8fa';
    ctx.beginPath();
    ctx.moveTo(4, 88);
    ctx.lineTo(2, 14);
    ctx.quadraticCurveTo(2, 6, 10, 6);
    ctx.lineTo(176, 6);
    ctx.quadraticCurveTo(186, 6, 190, 14);
    ctx.lineTo(212, 46);
    ctx.quadraticCurveTo(222, 52, 222, 62);
    ctx.lineTo(222, 84);
    ctx.quadraticCurveTo(222, 90, 216, 90);
    ctx.lineTo(10, 90);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = '#b8bec8';
    ctx.lineWidth = 1.5;
    ctx.stroke();
    // Frontrute og sidevindu i førerhuset
    ctx.fillStyle = '#26354a';
    ctx.beginPath();
    ctx.moveTo(166, 12);
    ctx.lineTo(186, 12);
    ctx.lineTo(207, 44);
    ctx.lineTo(166, 44);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = 'rgba(255, 255, 255, 0.2)';
    ctx.fillRect(170, 15, 8, 26);
    // Skyvedør
    ctx.strokeStyle = '#c3c8d0';
    ctx.beginPath();
    ctx.moveTo(150, 10);
    ctx.lineTo(150, 86);
    ctx.moveTo(98, 10);
    ctx.lineTo(98, 86);
    ctx.stroke();
    // Blå stripe og logo på siden
    ctx.fillStyle = BLUE;
    ctx.fillRect(4, 64, 218, 7);
    if (logoReady) ctx.drawImage(logo, 12, 20, 140, 31.8);
    // Støtfanger og lykt
    ctx.fillStyle = '#3a3f47';
    ctx.fillRect(196, 82, 28, 7);
    ctx.fillStyle = '#fff3b0';
    ctx.fillRect(214, 56, 8, 8);
    // Takstige og blinklys
    ctx.strokeStyle = '#9aa3ad';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(14, 0);
    ctx.lineTo(160, 0);
    ctx.stroke();
    for (let i = 20; i <= 156; i += 14) {
      ctx.beginPath();
      ctx.moveTo(i, 0);
      ctx.lineTo(i, 6);
      ctx.stroke();
    }
    const on = Math.floor(performance.now() / 300) % 2 === 0;
    ctx.fillStyle = on ? '#ffb000' : '#9a6a00';
    roundRect(168, -4, 14, 10, 3);
    ctx.fill();
    // Hjul
    [52, 176].forEach((wx) => {
      ctx.fillStyle = '#1b1b1f';
      ctx.beginPath();
      ctx.arc(wx, 90, 17, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#9aa0a8';
      ctx.beginPath();
      ctx.arc(wx, 90, 7, 0, Math.PI * 2);
      ctx.fill();
    });
    ctx.restore();
  }

  function drawHud() {
    ctx.fillStyle = 'rgba(10, 12, 20, 0.74)';
    roundRect(8, 8, W - 16, 56, 12);
    ctx.fill();
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'left';
    ctx.fillStyle = '#fff';
    ctx.font = '900 20px system-ui';
    ctx.fillText(`${score()}`, 20, 28);
    ctx.font = '700 10px system-ui';
    ctx.fillStyle = '#a9b3c9';
    ctx.fillText('POENG', 20, 46);
    // Neste kunde
    ctx.textAlign = 'center';
    const toGo = Math.max(0, Math.ceil((nextStopAt - distance) / PX_PER_M));
    ctx.fillStyle = '#7dffb0';
    ctx.font = '900 15px system-ui';
    ctx.fillText(mode === 'playing' ? `🏠 ${toGo} m` : '🏠 Framme', 140, 28);
    ctx.fillStyle = '#a9b3c9';
    ctx.font = '700 10px system-ui';
    ctx.fillText(`${meters()} m kjørt · ${jobsDone} jobb${jobsDone === 1 ? '' : 'er'}`, 140, 46);
    // Klager
    ctx.font = '14px system-ui';
    for (let i = 0; i < MAX_COMPLAINTS; i++) {
      ctx.globalAlpha = i < complaints ? 1 : 0.25;
      ctx.fillText(i < complaints ? '😡' : '🙂', 226 + i * 20, 28);
    }
    ctx.globalAlpha = 1;
    ctx.fillStyle = '#a9b3c9';
    ctx.font = '700 10px system-ui';
    ctx.fillText('KLAGER', 246, 46);
    // Energi
    const low = energy < 25;
    const blink = low && Math.floor(performance.now() / 250) % 2 === 0;
    ctx.fillStyle = 'rgba(255, 255, 255, 0.14)';
    roundRect(292, 20, 92, 14, 7);
    ctx.fill();
    ctx.fillStyle = blink ? '#ff3b3b' : energy > 50 ? '#3ccf7a' : energy > 25 ? '#ffd34d' : '#ff5a5a';
    roundRect(292, 20, Math.max(8, 92 * (energy / 100)), 14, 7);
    ctx.fill();
    ctx.fillStyle = '#a9b3c9';
    ctx.font = '700 10px system-ui';
    ctx.fillText('🌭 ENERGI', 338, 46);
  }

  function drawFloaters() {
    floaters.forEach((f) => {
      ctx.globalAlpha = Math.min(1, f.life * 2);
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.font = f.big ? '900 22px system-ui' : '900 16px system-ui';
      ctx.lineWidth = 4;
      ctx.strokeStyle = 'rgba(0, 0, 0, 0.6)';
      ctx.strokeText(f.text, f.x, f.y);
      ctx.fillStyle = f.color;
      ctx.fillText(f.text, f.x, f.y);
    });
    ctx.globalAlpha = 1;
  }

  function panel(y, h) {
    ctx.fillStyle = 'rgba(8, 10, 18, 0.88)';
    roundRect(24, y, W - 48, h, 18);
    ctx.fill();
    ctx.strokeStyle = 'rgba(255, 176, 0, 0.6)';
    ctx.lineWidth = 2;
    ctx.stroke();
  }

  function drawStart() {
    panel(110, 420);
    drawSideVan(W / 2 - 112 * 1.15, 158, 1.15);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#ffb000';
    ctx.font = '900 28px system-ui';
    ctx.fillText('BRANÆS SERVICEBIL', W / 2, 312);
    ctx.fillStyle = '#e6e9f2';
    ctx.font = '700 14px system-ui';
    ctx.fillText('Kjør ut til kundene og gjør jobben.', W / 2, 340);
    ctx.font = '600 13px system-ui';
    ctx.fillStyle = '#a9b3c9';
    ctx.fillText('👆 Dra fingeren for å styre (eller ← →)', W / 2, 372);
    ctx.fillText('🌭 🧇 Spis underveis, ellers går energien tom', W / 2, 396);
    ctx.fillText('🏠 Hver 1000 m: en jobb hos kunden', W / 2, 420);
    ctx.fillText('😡 Tre klager, og sjefen ringer', W / 2, 444);
    const p = (Math.sin(performance.now() / 300) + 1) / 2;
    ctx.fillStyle = `rgba(255, 176, 0, ${0.7 + p * 0.3})`;
    ctx.font = '900 18px system-ui';
    ctx.fillText(me ? 'TRYKK FOR Å STARTE' : 'Logg inn for å spille', W / 2, 496);
  }

  function drawJobDone() {
    const won = job.state === 'won';
    panel(210, 290);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = '900 26px system-ui';
    ctx.fillStyle = won ? '#7dffb0' : '#ff8a8a';
    ctx.fillText(won ? '✔ JOBB UTFØRT!' : '😡 KUNDEN KLAGER', W / 2, 250);
    ctx.font = '30px system-ui';
    ctx.fillText(won ? '⭐'.repeat(jobResult.stars) + '☆'.repeat(3 - jobResult.stars) : '☆☆☆', W / 2, 296);
    ctx.fillStyle = '#e6e9f2';
    ctx.font = '700 14px system-ui';
    ctx.fillText(won ? `${customer.name} er fornøyd${job.mistakes ? ` (${job.mistakes} feil underveis)` : ''}` : 'Tiden gikk ut før jobben var ferdig.', W / 2, 338);
    ctx.fillStyle = won ? '#ffe27a' : '#ff9b9b';
    ctx.font = '900 30px system-ui';
    ctx.fillText(won ? `+${jobResult.points}` : `${complaints} av ${MAX_COMPLAINTS} klager`, W / 2, 384);
    if (performance.now() - doneAt > 700) {
      ctx.fillStyle = '#ffb000';
      ctx.font = '900 16px system-ui';
      ctx.fillText(complaints >= MAX_COMPLAINTS ? 'TRYKK FOR Å SE RESULTATET' : 'TRYKK FOR Å KJØRE VIDERE 🚐', W / 2, 460);
    }
  }

  function drawDead() {
    if (performance.now() - deadAt < 500) return;
    panel(160, 360);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#ff7a7a';
    ctx.font = '900 24px system-ui';
    ctx.fillText('FERDIG FOR I DAG', W / 2, 196);
    ctx.fillStyle = '#e6e9f2';
    ctx.font = '700 13px system-ui';
    ctx.fillText(result.reason, W / 2, 226);
    ctx.fillStyle = '#fff';
    ctx.font = '900 48px system-ui';
    ctx.fillText(result.score, W / 2, 284);
    ctx.font = '700 12px system-ui';
    ctx.fillStyle = '#a9b3c9';
    ctx.fillText(`POENG · ${result.meters} m · 🏠 ${result.jobs} jobb${result.jobs === 1 ? '' : 'er'} utført`, W / 2, 322);
    let line = '';
    let color = '#ffe27a';
    if (result.error) {
      line = result.error;
      color = '#ff9b9b';
    } else if (result.earnedSpins) line = `🎉 +${result.earnedSpins} spinn til lykkehjulet!`;
    else if (result.isRecord) line = '🏆 Ny rekord!';
    else if (result.best !== undefined) line = `Rekorden din: ${result.best}`;
    ctx.fillStyle = color;
    ctx.font = '800 15px system-ui';
    ctx.fillText(line, W / 2, 364);
    if (result.next && !result.error) {
      ctx.fillStyle = '#a9b3c9';
      ctx.font = '600 12px system-ui';
      ctx.fillText(`Neste belønning: ${result.next.score} poeng = ${result.next.spins} spinn`, W / 2, 390);
    }
    if (performance.now() - deadAt > 900) {
      ctx.fillStyle = '#ffb000';
      ctx.font = '900 17px system-ui';
      ctx.fillText('TRYKK FOR EN NY ARBEIDSDAG', W / 2, 470);
    }
  }

  function draw() {
    if (mode === 'job' || mode === 'jobdone') {
      ServiceJobs.draw(ctx, job, customer);
      if (mode === 'jobdone') drawJobDone();
      return;
    }
    ctx.save();
    if (shake) ctx.translate((Math.random() - 0.5) * shake, (Math.random() - 0.5) * shake);
    drawRoad();
    drawScenery();
    things.forEach(drawThing);
    drawVan(car.x, CAR_Y, mode === 'playing' ? car.tilt : 0);
    sparks.forEach((p) => {
      ctx.globalAlpha = Math.min(1, p.life * 2);
      ctx.fillStyle = p.c;
      ctx.fillRect(p.x - 2, p.y - 2, 4, 4);
    });
    ctx.globalAlpha = 1;
    ctx.restore();
    if (mode !== 'ready') drawHud();
    drawFloaters();
    if (mode === 'ready') drawStart();
    if (mode === 'dead') drawDead();
  }

  let last = performance.now();
  function frame(now) {
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    update(dt);
    engine();
    draw();
    requestAnimationFrame(frame);
  }

  // ---------- Info under spillet ----------
  function renderInfo() {
    if (!info) return;
    $('sb-best').textContent = info.best;
    $('sb-next').textContent = `${info.next.score} poeng = ${info.next.spins} spinn`;
    const ol = $('sb-board');
    ol.innerHTML = '';
    if (!info.leaderboard.length) ol.innerHTML = '<li class="muted">Ingen har kjørt ennå. Bli den første!</li>';
    info.leaderboard.forEach((e, i) => {
      const li = document.createElement('li');
      if (me && e.name === me.name) li.classList.add('me');
      li.innerHTML = `<span class="rank">${['🥇', '🥈', '🥉'][i] || `${i + 1}.`}</span><span class="lb-name"></span><span class="lb-score">${e.score}</span>`;
      li.querySelector('.lb-name').textContent = e.name;
      if (window.avatarEl) li.querySelector('.rank').after(avatarEl((info.avatars || {})[e.name], e.name, 28));
      ol.appendChild(li);
    });
    const f = info.first;
    $('sb-rewards').innerHTML = [1, 2, 3, 4, 5].map((k) => `<li><b>${f * 2 ** (k - 1)} poeng</b> → ${k} spinn</li>`).join('');
  }

  async function load() {
    try {
      info = await api('/api/hiace');
      me = info.me;
      $('not-joined').classList.toggle('hidden', !!me);
      renderInfo();
    } catch { /* ignorer */ }
  }

  reset();
  load();
  requestAnimationFrame(frame);
  // Til testene
  window.__servicebil = { get mode() { return mode; }, get score() { return score(); }, get things() { return things; }, get job() { return job; }, car: () => car, set energy(v) { energy = v; }, jump: (m) => { distance = Math.max(distance, nextStopAt - m * PX_PER_M); } };
})();
