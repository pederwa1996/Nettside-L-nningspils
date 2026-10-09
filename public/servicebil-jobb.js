'use strict';

// Jobbene hos kunden i Branæs Servicebil: små elektriker-minispill med tidsfrist.
//   🔌 Koble ledningene (lysbryter, stikkontakt, lampe): dra hver leder til riktig klemme
//   📟 Finn jordfeilen: mål isolasjonen på kursene og meld fra om den som er under 0,5 MΩ
//   ⚡ Sikringsskapet: koble hver kurs til sikringen som passer tverrsnittet
// Jobbene blir vanskeligere jo flere man har gjort (flere ledere, kursene nærmere grensen, mindre tid).
(function () {
  const W = 400;
  const H = 700;
  const sfx = (name) => window.sfx && window.sfx.play(name);
  const shuffle = (a) => {
    const b = a.slice();
    for (let i = b.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [b[i], b[j]] = [b[j], b[i]];
    }
    return b;
  };
  const pick = (a) => a[Math.floor(Math.random() * a.length)];

  function rr(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  // ---------- Ledere og klemmer ----------
  const WIRE = {
    brun: { name: 'Brun', colors: ['#7a4a1e'], key: 'L' },
    svart: { name: 'Svart', colors: ['#1b1b1b'], key: 'L1' },
    bla: { name: 'Blå', colors: ['#1f5fd1'], key: 'N' },
    jord: { name: 'Gul/grønn', colors: ['#e8c81e', '#2f9e44'], key: 'PE' },
  };
  const SLOT = {
    L: { label: 'L', sub: 'fase inn' },
    L1: { label: 'L1', sub: 'til 💡' },
    N: { label: 'N', sub: 'null' },
    PE: { label: '⏚', sub: 'jord' },
  };

  // ---------- Kursene i sikringsskapet ----------
  const KURSER = [
    { name: 'Lys stue', mm: '1,5' }, { name: 'Lys gang', mm: '1,5' }, { name: 'Lys soverom', mm: '1,5' },
    { name: 'Stikk kjøkken', mm: '2,5' }, { name: 'Vaskemaskin', mm: '2,5' }, { name: 'Varmekabel bad', mm: '2,5' },
    { name: 'Varmtvannsbereder', mm: '2,5' }, { name: 'Komfyr', mm: '4' }, { name: 'Elbillader', mm: '6' },
  ];
  const AMP = { '1,5': 10, '2,5': 16, 4: 20, 6: 32 };
  const CIRCUITS = ['Kjøkken', 'Bad', 'Stue', 'Gang', 'Soverom', 'Vaskerom', 'Garasje', 'Kontor', 'Uteboder'];

  // ---------- Lage en jobb ----------
  function create(level) {
    const n = level;
    let job;
    if (n === 1) job = wires('Koble lysbryteren', ['brun', 'bla', 'jord'], 32, true, '💡');
    else if (n === 2) job = wires('Montér stikkontakt', ['brun', 'bla', 'jord'], 24, false, '🔌');
    else if (n === 3) job = earthFault(4, 26, true);
    else if (n === 4) job = wires('Koble opp taklampa', ['brun', 'svart', 'bla', 'jord'], 26, false, '💡');
    else if (n === 5) job = fusebox(3, 28, true);
    else {
      const k = n - 6;
      const t = Math.max(13, 24 - k * 1.2);
      job = pick([
        () => wires(pick(['Koble lysbryteren', 'Bytt dimmer', 'Montér utelys', 'Koble opp taklampa']), ['brun', 'svart', 'bla', 'jord'], t, false, pick(['💡', '🎚️', '🏮'])),
        () => earthFault(Math.min(6, 4 + Math.floor(k / 2)), t + 4, false),
        () => fusebox(Math.min(5, 3 + Math.floor(k / 2)), t + 6, false),
      ])();
    }
    job.level = n;
    job.mistakes = 0;
    job.state = 'play';
    job.left = job.time;
    return job;
  }

  function wires(title, list, time, hint, icon) {
    const items = list.map((c, i) => ({ id: c, wire: WIRE[c], key: WIRE[c].key, x: 92, y: 210 + i * 86, done: null }));
    const slots = shuffle(list.map((c) => WIRE[c].key)).map((k, i) => ({ key: k, x: 318, y: 250 + i * 80, filled: null }));
    return {
      kind: 'wires', title, icon, time, items, slots, drag: null,
      help: hint ? 'Brun = fase (L) · Blå = null (N) · Gul/grønn = jord (⏚)' : 'Dra hver leder til riktig klemme',
    };
  }

  function fusebox(count, time, hint) {
    const kurser = shuffle(KURSER).slice(0, count);
    const items = kurser.map((k, i) => ({ key: AMP[k.mm], k, x: 172, y: 196 + i * 84, done: null }));
    const amps = kurser.map((k) => AMP[k.mm]);
    const decoy = pick([10, 16, 20, 32].filter((a) => !amps.includes(a)).concat([10, 16, 20, 32]));
    const slots = shuffle([...amps, decoy]).map((a, i) => ({ key: a, x: 300, y: 196 + i * (count >= 5 ? 72 : 84), filled: null }));
    return {
      kind: 'fuse', title: 'Koble opp sikringsskapet', icon: '⚡', time, items, slots, drag: null,
      help: hint ? '1,5 mm² → 10 A · 2,5 → 16 A · 4 → 20 A · 6 → 32 A' : 'Hver kurs til sikringen som passer tverrsnittet',
    };
  }

  function earthFault(count, time, colors) {
    const names = shuffle(CIRCUITS).slice(0, count);
    const bad = Math.floor(Math.random() * count);
    const lvlClose = !colors; // vanskeligere: de friske kursene ligger nærmere grensen
    const okVals = lvlClose ? ['0,7', '0,8', '1,1', '2,4', '0,9', '6,5', '1,6'] : ['> 999', '250', '120', '48', '310', '75'];
    const rows = names.map((name, i) => ({
      name: `Kurs ${i + 1} · ${name}`,
      bad: i === bad,
      value: i === bad ? pick(lvlClose ? ['0,3', '0,4', '0,45', '0,2'] : ['0,02', '0,05', '0,1', '0,2']) : pick(okVals),
      measured: false,
      y: 190 + i * 74,
    }));
    return {
      kind: 'earth', title: 'Finn jordfeilen', icon: '📟', time, rows, colors, measuring: null,
      help: 'Mål kursene · under 0,5 MΩ = jordfeil → trykk ⚠',
    };
  }

  // ---------- Oppdatering ----------
  function update(job, dt) {
    if (job.state !== 'play') return;
    job.left -= dt;
    if (job.measuring) {
      job.measuring.t -= dt;
      if (job.measuring.t <= 0) {
        job.measuring.row.measured = true;
        job.measuring = null;
        sfx('tap');
      }
    }
    if (job.left <= 0) {
      job.left = 0;
      job.state = 'failed';
      sfx('buzzer');
    }
  }

  function mistake(job, x, y) {
    job.mistakes++;
    job.left = Math.max(0, job.left - 2);
    job.flash = { x, y, t: 0.5 };
    sfx('buzzer');
    if (navigator.vibrate) navigator.vibrate(60);
  }

  function checkDone(job) {
    const done = job.kind === 'earth' ? job.found : job.items.every((i) => i.done);
    if (done) {
      job.state = 'won';
      sfx('win');
    }
  }

  // ---------- Fingeren ----------
  function down(job, x, y) {
    if (job.state !== 'play') return;
    if (job.kind === 'earth') {
      for (const r of job.rows) {
        if (y < r.y || y > r.y + 64) continue;
        if (!r.measured) {
          if (!job.measuring && x > 250) {
            job.measuring = { row: r, t: 0.7 };
            sfx('chip');
          }
        } else if (x > 318) {
          // ⚠ Meld feil
          if (r.bad) {
            job.found = true;
            r.marked = true;
            checkDone(job);
          } else mistake(job, x, y);
        }
      }
      return;
    }
    const it = job.items.find((i) => !i.done && Math.hypot(i.x - x, i.y - y) < 38);
    if (it) job.drag = { item: it, x, y };
  }

  function move(job, x, y) {
    if (job.drag) {
      job.drag.x = x;
      job.drag.y = y;
    }
  }

  function up(job, x, y) {
    if (!job.drag) return;
    const it = job.drag.item;
    job.drag = null;
    const slot = job.slots.find((s) => !s.filled && Math.hypot(s.x - x, s.y - y) < 42);
    if (!slot) return;
    if (slot.key === it.key) {
      slot.filled = it;
      it.done = slot;
      slot.pop = 0.3;
      sfx('chip');
      if (navigator.vibrate) navigator.vibrate(20);
      checkDone(job);
    } else mistake(job, slot.x, slot.y);
  }

  // Stjerner og poeng for jobben
  function rating(job) {
    if (job.state !== 'won') return { stars: 0, points: 0 };
    const share = job.left / job.time;
    const stars = job.mistakes === 0 && share > 0.45 ? 3 : job.mistakes <= 1 ? 2 : 1;
    const points = 100 + job.level * 40 + Math.round(job.left * 8) + stars * 25;
    return { stars, points };
  }

  // ---------- Tegning ----------
  function draw(ctx, job, customer) {
    // Vegg
    const g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, '#f3ece0');
    g.addColorStop(1, '#ded3c0');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = 'rgba(0, 0, 0, 0.035)';
    for (let y = 120; y < H; y += 40) ctx.fillRect(0, y, W, 1);

    // Topp: kunde, jobb og tid
    ctx.fillStyle = '#14204a';
    ctx.fillRect(0, 0, W, 118);
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#ffd56b';
    ctx.font = '800 12px system-ui';
    ctx.fillText(`🏠 ${customer.name} · ${customer.place}`, 16, 22);
    ctx.fillStyle = '#fff';
    ctx.font = '900 22px system-ui';
    ctx.fillText(`${job.icon} ${job.title}`, 16, 52);
    ctx.fillStyle = '#c9d3ee';
    // Hjelpeteksten krymper hvis den ikke får plass
    let fs = 12;
    do {
      ctx.font = `600 ${fs}px system-ui`;
      fs -= 0.5;
    } while (ctx.measureText(job.help).width > W - 32 && fs > 8);
    ctx.fillText(job.help, 16, 80);
    // Tid
    const share = Math.max(0, job.left / job.time);
    ctx.fillStyle = 'rgba(255, 255, 255, 0.15)';
    rr(ctx, 16, 96, W - 90, 10, 5);
    ctx.fill();
    ctx.fillStyle = share > 0.5 ? '#3ccf7a' : share > 0.25 ? '#ffd34d' : '#ff5a5a';
    rr(ctx, 16, 96, Math.max(10, (W - 90) * share), 10, 5);
    ctx.fill();
    ctx.textAlign = 'right';
    ctx.fillStyle = '#fff';
    ctx.font = '900 15px system-ui';
    ctx.fillText(`${Math.ceil(job.left)} s`, W - 16, 101);
    if (job.mistakes) {
      ctx.fillStyle = '#ff8a8a';
      ctx.font = '800 11px system-ui';
      ctx.fillText(`${job.mistakes} feil`, W - 16, 22);
    }

    if (job.kind === 'wires') drawWires(ctx, job);
    else if (job.kind === 'fuse') drawFuse(ctx, job);
    else drawEarth(ctx, job);

    if (job.flash && job.flash.t > 0) {
      job.flash.t -= 1 / 60;
      ctx.fillStyle = `rgba(255, 60, 60, ${job.flash.t})`;
      ctx.beginPath();
      ctx.arc(job.flash.x, job.flash.y, 34, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#b00020';
      ctx.font = '900 16px system-ui';
      ctx.textAlign = 'center';
      ctx.fillText('Feil! −2 s', job.flash.x, job.flash.y - 44);
    }
  }

  function wirePath(ctx, wire, x0, y0, x1, y1, width) {
    const draw = (color, w, dash) => {
      ctx.strokeStyle = color;
      ctx.lineWidth = w;
      ctx.setLineDash(dash || []);
      ctx.beginPath();
      ctx.moveTo(x0, y0);
      ctx.bezierCurveTo(x0 + 60, y0, x1 - 60, y1, x1, y1);
      ctx.stroke();
    };
    ctx.lineCap = 'round';
    draw('rgba(0, 0, 0, 0.25)', width + 3);
    draw(wire.colors[0], width);
    if (wire.colors[1]) draw(wire.colors[1], width, [10, 10]);
    ctx.setLineDash([]);
  }

  function drawWires(ctx, job) {
    // Boksen på veggen (bryter / stikkontakt / koblingsboks)
    ctx.fillStyle = 'rgba(0, 0, 0, 0.12)';
    rr(ctx, 214, 176, 168, 64 + job.slots.length * 80, 16);
    ctx.fill();
    ctx.fillStyle = '#fbfbf8';
    rr(ctx, 208, 170, 168, 64 + job.slots.length * 80, 16);
    ctx.fill();
    ctx.strokeStyle = '#c8c2b4';
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.font = '26px system-ui';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(job.icon, 292, 204);
    // Klemmene
    job.slots.forEach((s) => {
      const info = SLOT[s.key];
      ctx.fillStyle = '#2b2f36';
      ctx.font = '900 18px system-ui';
      ctx.textAlign = 'left';
      ctx.fillText(info.label, 222, s.y - 6);
      ctx.fillStyle = '#7a7466';
      ctx.font = '700 10px system-ui';
      ctx.fillText(info.sub, 222, s.y + 12);
      const p = s.pop ? 1 + s.pop : 1;
      if (s.pop) s.pop = Math.max(0, s.pop - 1 / 60);
      ctx.fillStyle = '#b8892b';
      ctx.beginPath();
      ctx.arc(s.x, s.y, 15 * p, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#e7c46b';
      ctx.beginPath();
      ctx.arc(s.x, s.y, 11 * p, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = '#7a5a12';
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.moveTo(s.x - 6, s.y);
      ctx.lineTo(s.x + 6, s.y);
      ctx.stroke();
    });
    // Kabelen kommer inn nede til venstre
    ctx.fillStyle = '#9a9a9a';
    rr(ctx, -10, 612, 70, 24, 12);
    ctx.fill();
    const ox = 52;
    const oy = 624;
    job.items.forEach((it) => {
      const end = it.done ? { x: it.done.x, y: it.done.y } : job.drag && job.drag.item === it ? { x: job.drag.x, y: job.drag.y } : { x: it.x, y: it.y };
      ctx.save();
      // Lederen fra kabelen til enden
      ctx.lineCap = 'round';
      ctx.strokeStyle = 'rgba(0, 0, 0, 0.2)';
      ctx.lineWidth = 10;
      ctx.beginPath();
      ctx.moveTo(ox, oy);
      ctx.bezierCurveTo(ox + 10, oy - 120, end.x - 120, end.y, end.x, end.y);
      ctx.stroke();
      const lay = (color, dash) => {
        ctx.strokeStyle = color;
        ctx.lineWidth = 7;
        ctx.setLineDash(dash || []);
        ctx.beginPath();
        ctx.moveTo(ox, oy);
        ctx.bezierCurveTo(ox + 10, oy - 120, end.x - 120, end.y, end.x, end.y);
        ctx.stroke();
      };
      lay(it.wire.colors[0]);
      if (it.wire.colors[1]) lay(it.wire.colors[1], [9, 9]);
      ctx.setLineDash([]);
      // Avisolert kobberende
      if (!it.done) {
        ctx.fillStyle = '#d98b3a';
        ctx.beginPath();
        ctx.arc(end.x, end.y, 6, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = '#fff';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(end.x, end.y, 14 + Math.sin(performance.now() / 200) * 2, 0, Math.PI * 2);
        ctx.stroke();
        ctx.fillStyle = '#2b2f36';
        ctx.font = '800 11px system-ui';
        ctx.textAlign = 'center';
        ctx.fillText(it.wire.name, end.x, end.y - 22);
      }
      ctx.restore();
    });
  }

  function drawFuse(ctx, job) {
    // Skapet
    ctx.fillStyle = '#e9e9ee';
    rr(ctx, 236, 150, 150, job.slots.length * (job.items.length >= 5 ? 72 : 84) + 40, 12);
    ctx.fill();
    ctx.strokeStyle = '#b9bcc6';
    ctx.lineWidth = 2;
    ctx.stroke();
    // Sikringer
    job.slots.forEach((s) => {
      ctx.fillStyle = '#fff';
      rr(ctx, s.x - 40, s.y - 26, 104, 52, 6);
      ctx.fill();
      ctx.strokeStyle = s.filled ? '#2ecc71' : '#aab';
      ctx.lineWidth = 2;
      ctx.stroke();
      ctx.fillStyle = s.filled ? '#2ecc71' : '#2b2f36';
      ctx.fillRect(s.x + 34, s.y - 14, 12, 28); // vippe
      ctx.fillStyle = '#14204a';
      ctx.font = '900 18px system-ui';
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      ctx.fillText(`${s.key} A`, s.x - 30, s.y);
      ctx.fillStyle = '#d98b3a';
      ctx.beginPath();
      ctx.arc(s.x - 40, s.y, 7, 0, Math.PI * 2);
      ctx.fill();
    });
    // Kursene
    job.items.forEach((it) => {
      const y = it.y;
      ctx.fillStyle = it.done ? '#e6f8ec' : '#fff';
      rr(ctx, 14, y - 30, 150, 60, 10);
      ctx.fill();
      ctx.strokeStyle = it.done ? '#2ecc71' : '#c8c2b4';
      ctx.lineWidth = 2;
      ctx.stroke();
      ctx.fillStyle = '#2b2f36';
      ctx.font = '800 13px system-ui';
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      ctx.fillText(it.k.name, 24, y - 9);
      ctx.fillStyle = '#7a7466';
      ctx.font = '700 12px system-ui';
      ctx.fillText(`${it.k.mm} mm²`, 24, y + 11);
      const end = it.done ? { x: it.done.x - 40, y: it.done.y } : job.drag && job.drag.item === it ? { x: job.drag.x, y: job.drag.y } : null;
      if (end) wirePath(ctx, { colors: ['#7a4a1e'] }, it.x, it.y, end.x, end.y, 5);
      ctx.fillStyle = it.done ? '#2ecc71' : '#d98b3a';
      ctx.beginPath();
      ctx.arc(it.x, it.y, 9, 0, Math.PI * 2);
      ctx.fill();
      if (!it.done) {
        ctx.strokeStyle = '#d98b3a';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(it.x, it.y, 15 + Math.sin(performance.now() / 200) * 2, 0, Math.PI * 2);
        ctx.stroke();
      }
    });
  }

  function drawEarth(ctx, job) {
    job.rows.forEach((r) => {
      ctx.fillStyle = r.marked ? '#ffe3e3' : '#fff';
      rr(ctx, 14, r.y, W - 28, 64, 12);
      ctx.fill();
      ctx.strokeStyle = r.marked ? '#e03131' : '#c8c2b4';
      ctx.lineWidth = 2;
      ctx.stroke();
      ctx.fillStyle = '#2b2f36';
      ctx.font = '800 14px system-ui';
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      ctx.fillText(r.name, 28, r.y + 32);
      const measuring = job.measuring && job.measuring.row === r;
      if (!r.measured) {
        ctx.fillStyle = measuring ? '#ffd34d' : '#14204a';
        rr(ctx, 262, r.y + 14, 110, 36, 18);
        ctx.fill();
        ctx.fillStyle = measuring ? '#3a2a00' : '#fff';
        ctx.font = '800 13px system-ui';
        ctx.textAlign = 'center';
        ctx.fillText(measuring ? `Måler${'.'.repeat(1 + (Math.floor(performance.now() / 200) % 3))}` : '📟 Mål', 317, r.y + 32);
      } else {
        const low = r.bad;
        ctx.textAlign = 'right';
        ctx.fillStyle = job.colors ? (low ? '#e03131' : '#1f9d55') : '#2b2f36';
        ctx.font = '900 16px system-ui';
        ctx.fillText(`${r.value} MΩ`, 306, r.y + 32);
        ctx.fillStyle = r.marked ? '#e03131' : '#ffb000';
        rr(ctx, 318, r.y + 14, 54, 36, 18);
        ctx.fill();
        ctx.fillStyle = '#fff';
        ctx.textAlign = 'center';
        ctx.font = '900 16px system-ui';
        ctx.fillText('⚠', 345, r.y + 32);
      }
    });
  }

  window.ServiceJobs = { create, update, draw, down, move, up, rating };
})();
