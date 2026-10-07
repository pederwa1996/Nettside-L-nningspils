'use strict';

// Øverst til høyre på alle sider: grønn tekst hver gang noen vinner en pils.
// Forsvinner etter 5 sekunder. Trenger media.js (onLive).
(function () {
  const SHOW_MS = 5000;
  const box = document.createElement('div');
  box.className = 'beer-wins';
  box.setAttribute('aria-live', 'polite');
  document.body.appendChild(box);
  const seen = new Set();

  function show(e, remaining = SHOW_MS) {
    if (seen.has(e.id) || remaining < 800) return;
    seen.add(e.id);
    const line = document.createElement('div');
    line.className = 'beer-win';
    line.textContent = e.text;
    // Fade-ut starter ett sekund før slutt, uansett hvor mye tid som er igjen
    line.style.animationDelay = `0s, ${Math.max(0, remaining - 1000)}ms`;
    box.prepend(line);
    while (box.children.length > 4) box.lastChild.remove();
    setTimeout(() => line.remove(), remaining);
  }

  onLive('beer-win', (e) => show(e));

  // Bytter man side akkurat når noen vinner, tas det med når den nye siden lastes
  function catchUp() {
    fetch('/api/beer-wins').then((r) => r.json()).then((d) => {
      d.wins.forEach((e) => show(e, SHOW_MS - (d.now - e.at)));
    }).catch(() => {});
  }
  catchUp();
  document.addEventListener('visibilitychange', () => document.visibilityState === 'visible' && catchUp());
})();
