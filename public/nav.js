'use strict';

// En tydelig «🏠 Hjem»-knapp øverst til venstre på alle undersider.
// (Menyen nederst er borte: forsiden er navet, og flisene der tar deg videre.)
(function () {
  const path = location.pathname.replace(/\/$/, '') || '/';
  window.refreshNav = () => {};
  if (path === '/' || path === '/index.html') return;
  const a = document.createElement('a');
  a.className = 'home-btn';
  a.href = '/';
  a.setAttribute('aria-label', 'Til forsiden');
  a.innerHTML = '<span class="home-btn-icon">🏠</span><span>Hjem</span>';
  document.body.appendChild(a);
  document.body.classList.add('has-home');
})();
