'use strict';

// Menyen nederst, lik på alle sider: Hjem · Kasino · PvP · Chat · Profil.
// Viser et lite hint første gang, og et rødt tall på PvP når noen har utfordret deg.
(function () {
  const ITEMS = [
    { key: 'home', href: '/', icon: '🏠', label: 'Hjem', paths: ['/', '/index.html'] },
    { key: 'casino', href: '/kasino.html', icon: '🎰', label: 'Kasino', paths: ['/kasino.html', '/baren.html'] },
    { key: 'pvp', href: '/pvp.html', icon: '⚔️', label: 'PvP', paths: ['/pvp.html', '/duell.html', '/mogg.html', '/spill.html'] },
    { key: 'chat', href: '/chat.html', icon: '💬', label: 'Chat', paths: ['/chat.html'] },
    { key: 'profile', href: '/profil.html', icon: '👤', label: 'Profil', paths: ['/profil.html'] },
  ];

  const path = location.pathname.replace(/\/$/, '') || '/';
  const nav = document.createElement('nav');
  nav.className = 'bottom-nav';
  nav.setAttribute('aria-label', 'Meny');
  ITEMS.forEach((it) => {
    const a = document.createElement('a');
    a.href = it.href;
    a.dataset.key = it.key;
    if (it.paths.includes(path)) {
      a.classList.add('active');
      a.setAttribute('aria-current', 'page');
    }
    a.innerHTML = `<span class="nav-icon">${it.icon}</span><span class="nav-label">${it.label}</span><b class="nav-badge hidden"></b>`;
    nav.appendChild(a);
  });
  document.body.appendChild(nav);
  document.body.classList.add('has-nav');

  // Hint første gang, så folk ser at menyen finnes
  let seenHint = false;
  try {
    seenHint = localStorage.getItem('navHintSeen') === '1';
  } catch { /* ignorer */ }
  function showHint() {
    if (seenHint || document.body.classList.contains('logged-out')) return;
    seenHint = true;
    const hint = document.createElement('div');
    hint.className = 'nav-hint';
    hint.innerHTML = '👇 Her er menyen! Trykk for å gå til <b>Kasino</b>, <b>PvP</b>, <b>Chat</b> og <b>Profil</b>.';
    const close = () => {
      hint.remove();
      nav.classList.remove('nav-glow');
      try {
        localStorage.setItem('navHintSeen', '1');
      } catch { /* ignorer */ }
    };
    hint.addEventListener('click', close);
    nav.addEventListener('click', close, { once: true });
    setTimeout(close, 9000);
    document.body.appendChild(hint);
    nav.classList.add('nav-glow');
  }

  let me = null;
  async function load() {
    try {
      const res = await fetch('/api/state');
      const d = await res.json();
      if (!d.me) return;
      me = d.me.name;
      const n = (d.incomingDuels || 0) + (d.incomingMoggs || 0);
      const badge = nav.querySelector('[data-key="pvp"] .nav-badge');
      badge.textContent = n;
      badge.classList.toggle('hidden', !n);
      setTimeout(showHint, 800);
    } catch { /* ignorer */ }
  }
  // Nye utfordringer kommer som varsler til meg
  if (window.onLive) window.onLive('notify', (msg) => (!msg || !me || msg.to === me) && load());
  // Forsiden sier ifra når man nettopp har registrert seg eller logget inn
  window.refreshNav = load;
  setInterval(load, 30000);
  load();
})();
