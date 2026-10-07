'use strict';

// Øverst til høyre: grønn tekst hver gang noen vinner en pils. Forsvinner etter 5 sekunder.
// Trenger media.js (onLive).
(function () {
  const box = document.createElement('div');
  box.className = 'beer-wins';
  box.setAttribute('aria-live', 'polite');
  document.body.appendChild(box);

  onLive('beer-win', (e) => {
    const line = document.createElement('div');
    line.className = 'beer-win';
    line.textContent = e.text;
    box.prepend(line);
    // Maks fire linjer om gangen
    while (box.children.length > 4) box.lastChild.remove();
    setTimeout(() => line.remove(), 5000);
  });
})();
