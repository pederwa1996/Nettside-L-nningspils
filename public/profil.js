'use strict';

(function () {
  const $ = (id) => document.getElementById(id);
  let data = null;
  let openItem = null; // id på aktiviteten som vises stort
  const openComments = new Set(); // aktiviteter der alle kommentarene vises
  const openForms = new Set(); // aktiviteter der kommentarfeltet er åpent

  const params = new URLSearchParams(location.search);
  let name = params.get('navn') || '';
  // Fra et varsel: ?innlegg=<id> åpner det innlegget
  let jumpTo = params.get('innlegg');
  let scrolledToGuestbook = false;

  let adminPassword = '';
  try {
    adminPassword = sessionStorage.getItem('adminPassword') || '';
  } catch { /* ignorer */ }

  async function api(path, body) {
    const res = await fetch(path, body
      ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }
      : {});
    const json = await res.json();
    if (!res.ok) throw new Error(json.error || 'Noe gikk galt');
    return json;
  }

  function el(tag, cls, text) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text !== undefined) e.textContent = text;
    return e;
  }

  const profileLink = (n) => `/profil.html?navn=${encodeURIComponent(n)}`;

  function when(ms) {
    const sameDay = new Date(ms).toDateString() === new Date().toDateString();
    return sameDay ? `${timeAgo(ms)} · ${timeOfDay(ms)}` : new Date(ms).toLocaleString('no-NO', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
  }

  function lastSeenText(p) {
    if (p.name === data.viewer || (p.lastSeen && Date.now() - p.lastSeen < 3 * 60 * 1000)) return '🟢 Online nå';
    if (!p.lastSeen) return 'Ikke sett på en stund';
    return `Sist online ${when(p.lastSeen)}`;
  }

  // ---------- Øverst: alle deltakere ----------
  function renderPeople() {
    const wrap = $('people');
    wrap.innerHTML = '';
    data.people.forEach((p) => {
      const a = el('a', 'person' + (p.name === data.profile.name ? ' active' : ''));
      a.href = profileLink(p.name);
      a.append(avatarEl(p.avatar, p.name, 48), el('span', 'person-name', (p.isAdmin ? '👑 ' : '') + (p.name === data.viewer ? 'Deg' : p.name.split(' ')[0])));
      wrap.appendChild(a);
    });
    const active = wrap.querySelector('.active');
    if (active) active.scrollIntoView({ inline: 'center', block: 'nearest' });
  }

  // ---------- Statistikk ----------
  // ---------- Bio ----------
  function renderBio(p) {
    const mine = p.name === data.viewer;
    $('p-bio').textContent = p.bio || '';
    $('p-bio').classList.toggle('hidden', !p.bio);
    $('bio-edit').classList.toggle('hidden', !mine || !$('bio-form').classList.contains('hidden'));
    $('bio-edit').textContent = p.bio ? '✏️ Endre bio' : '✏️ Skriv en bio';
  }

  $('bio-edit').addEventListener('click', () => {
    $('bio-input').value = data.profile.bio || '';
    $('bio-form').classList.remove('hidden');
    $('bio-edit').classList.add('hidden');
    $('bio-input').focus();
  });
  $('bio-cancel').addEventListener('click', () => {
    $('bio-form').classList.add('hidden');
    renderBio(data.profile);
  });
  $('bio-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      const r = await api('/api/profile/bio', { bio: $('bio-input').value });
      data.profile.bio = r.bio;
      $('bio-form').classList.add('hidden');
      renderBio(data.profile);
    } catch (err) {
      alert(err.message);
    }
  });

  // ---------- Hilsener (gjestebok) ----------
  function renderGuestbook(p) {
    const box = $('guestbook');
    // Ikke tegn på nytt mens noen skriver
    if (document.activeElement === $('gb-input') && $('gb-input').value) return;
    box.innerHTML = '';
    $('gb-input').placeholder = p.name === data.viewer ? 'Skriv noe på din egen vegg ...' : `Skriv en hilsen til ${p.name.split(' ')[0]} ...`;
    if (!p.guestbook.length) {
      box.appendChild(el('p', 'muted', p.name === data.viewer ? 'Ingen hilsener ennå.' : 'Ingen hilsener ennå. Bli den første! 👋'));
      return;
    }
    p.guestbook.forEach((c) => {
      const row = el('div', 'gb-item');
      const av = el('a');
      av.href = profileLink(c.from);
      av.appendChild(avatarEl(c.avatar, c.from, 34));
      const body = el('div', 'gb-body');
      const who = el('a', 'gb-name', c.from);
      who.href = profileLink(c.from);
      body.append(who, el('span', 'gb-text', c.text), el('small', 'muted', when(c.at)));
      row.append(av, body);
      if (c.from === data.viewer || p.name === data.viewer || adminPassword) {
        const del = el('button', 'gb-del', '✕');
        del.type = 'button';
        del.title = 'Slett';
        del.addEventListener('click', async () => {
          if (!confirm('Slette hilsenen?')) return;
          try {
            const r = await api('/api/profile/comment-delete', { navn: p.name, id: c.id, password: adminPassword });
            data.profile.guestbook = r.guestbook;
            renderGuestbook(data.profile);
          } catch (err) {
            alert(err.message);
          }
        });
        row.appendChild(del);
      }
      box.appendChild(row);
    });
  }

  $('gb-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const text = $('gb-input').value.trim();
    if (!text) return;
    try {
      const r = await api('/api/profile/comment', { navn: data.profile.name, text });
      $('gb-input').value = '';
      data.profile.guestbook = r.guestbook;
      renderGuestbook(data.profile);
    } catch (err) {
      alert(err.message);
    }
  });

  function renderStats(s) {
    const wl = (r) => `${r.won}–${r.lost}`;
    const tiles = [
      ['🍺', s.beersWon, 'pils vunnet'],
      ['🍻', s.beersOwed, 'pils til gode'],
      ['🎰', s.spinsLeft, 'spinn igjen'],
      ['💰', s.flus, 'cash'],
      ['🎡', s.wheelSpins, 'hjulspinn'],
      ['🕊️', s.flappyBest, 'Flappy-rekord'],
      ['🗿', s.moggBest === null ? '–' : s.moggBest.toFixed(2), 'beste mogg'],
      ['⚔️', wl(s.duels), 'dueller V–T'],
      ['🗿', wl(s.moggs), 'mogg-offs V–T'],
      ['🎯', s.tasksDone, 'oppgaver løst'],
      ['🎲', (s.casinoNet > 0 ? '+' : '') + s.casinoNet, 'cash i kasino'],
      ['💬', s.chatMessages, 'chatmeldinger'],
    ];
    const grid = $('stats');
    grid.innerHTML = '';
    tiles.forEach(([icon, value, label]) => {
      const t = el('div', 'stat');
      t.append(el('span', 'stat-icon', icon), el('span', 'stat-value', String(value)), el('span', 'stat-label', label));
      grid.appendChild(t);
    });
  }

  // ---------- Ett innlegg (brukes både i feeden og i det store bildet) ----------
  function renderItem(a, { big = false } = {}) {
    const item = el('article', 'feed-item' + (big ? ' big' : ''));
    const head = el('div', 'feed-head');
    head.append(el('span', 'feed-icon', a.icon));
    const txt = el('div', 'feed-text');
    const who = el('strong', '', data.profile.name);
    txt.append(who, document.createTextNode(` ${a.text}`));
    head.append(txt);
    item.append(head, el('p', 'feed-time muted', when(a.at)));

    if (a.url) {
      const img = el('img', 'feed-img');
      img.src = a.url;
      img.alt = a.text;
      img.loading = 'lazy';
      if (!big) img.addEventListener('click', () => openLightbox(a.id));
      item.appendChild(img);
    } else if (a.story) {
      item.appendChild(el('p', 'note', '📸 Storyen er utløpt'));
    }

    // Likes og kommentarer
    const actions = el('div', 'feed-actions');
    const like = el('button', 'like-btn' + (a.liked ? ' liked' : ''), `${a.liked ? '❤️' : '🤍'} ${a.likes || ''}`.trim());
    like.type = 'button';
    like.disabled = !data.viewer;
    like.title = data.viewer ? 'Lik' : 'Registrer deg for å like';
    like.addEventListener('click', () => react('/api/react/like', { id: a.id }));
    const cbtn = el('button', 'comment-btn', `💬 ${a.comments.length || ''}`.trim());
    cbtn.type = 'button';
    cbtn.addEventListener('click', () => {
      if (!data.viewer) return alert('Registrer deg for å kommentere.');
      openForms.add(a.id);
      render();
      const input = document.querySelector(`.feed-item[data-id="${a.id}"] .comment-input`) || $('lightbox-item').querySelector('.comment-input');
      if (input) input.focus();
    });
    actions.append(like, cbtn);
    if (a.likes) {
      const by = a.likedBy.join(', ') + (a.likes > a.likedBy.length ? ` og ${a.likes - a.likedBy.length} til` : '');
      actions.append(el('span', 'liked-by muted', `Likt av ${by}`));
    }
    item.appendChild(actions);

    const list = el('div', 'comments');
    const showAll = big || openComments.has(a.id);
    const shown = showAll ? a.comments : a.comments.slice(-2);
    if (a.comments.length > shown.length) {
      const more = el('button', 'link-btn', `Vis alle ${a.comments.length} kommentarene`);
      more.type = 'button';
      more.addEventListener('click', () => {
        openComments.add(a.id);
        render();
      });
      list.appendChild(more);
    }
    shown.forEach((c) => {
      const row = el('div', 'comment');
      const link = el('a');
      link.href = profileLink(c.name);
      link.appendChild(avatarEl(c.avatar, c.name, 26));
      const body = el('div', 'comment-body');
      const nameLink = el('a', 'comment-name', c.name);
      nameLink.href = profileLink(c.name);
      body.append(nameLink, el('span', 'comment-text', c.text), el('span', 'comment-time muted', timeAgo(c.at)));
      row.append(link, body);
      if (c.name === data.viewer || adminPassword) {
        const del = el('button', 'comment-del', '✕');
        del.type = 'button';
        del.title = 'Slett kommentar';
        del.addEventListener('click', () => {
          if (confirm('Slette kommentaren?')) react('/api/react/comment-delete', { id: a.id, commentId: c.id, password: adminPassword });
        });
        row.appendChild(del);
      }
      list.appendChild(row);
    });
    item.appendChild(list);

    if (data.viewer && (big || openForms.has(a.id))) {
      const form = el('form', 'comment-form');
      const input = el('input', 'comment-input');
      input.type = 'text';
      input.maxLength = 300;
      input.placeholder = 'Skriv en kommentar ...';
      const send = el('button', 'small-btn', 'Send');
      send.type = 'submit';
      form.append(input, send);
      form.addEventListener('submit', async (e) => {
        e.preventDefault();
        if (!input.value.trim()) return;
        const text = input.value;
        input.value = '';
        await react('/api/react/comment', { id: a.id, text }, () => (input.value = text));
      });
      item.appendChild(form);
    }
    return item;
  }

  async function react(path, body, onError) {
    try {
      const r = await api(path, body);
      const i = data.activity.findIndex((x) => x.id === r.activity.id);
      if (i >= 0) data.activity[i] = r.activity;
      render();
    } catch (err) {
      if (onError) onError();
      alert(err.message);
    }
  }

  // ---------- Bildegalleri og stort bilde ----------
  function renderGallery() {
    const photos = data.activity.filter((a) => a.url);
    $('gallery-section').classList.toggle('hidden', !photos.length);
    const g = $('gallery');
    g.innerHTML = '';
    photos.forEach((a) => {
      const b = el('button', 'gallery-item');
      b.type = 'button';
      const img = el('img');
      img.src = a.url;
      img.alt = a.text;
      img.loading = 'lazy';
      b.appendChild(img);
      if (a.likes || a.comments.length) b.appendChild(el('span', 'gallery-badge', `❤️ ${a.likes} 💬 ${a.comments.length}`));
      b.addEventListener('click', () => openLightbox(a.id));
      g.appendChild(b);
    });
  }

  function openLightbox(id) {
    openItem = id;
    $('lightbox').classList.remove('hidden');
    document.body.classList.add('no-scroll');
    renderLightbox();
  }

  function closeLightbox() {
    openItem = null;
    $('lightbox').classList.add('hidden');
    document.body.classList.remove('no-scroll');
  }

  function renderLightbox() {
    if (!openItem) return;
    const a = data.activity.find((x) => x.id === openItem);
    if (!a) return closeLightbox();
    const box = $('lightbox-item');
    // Ikke tegn på nytt mens man skriver en kommentar i det store bildet
    const typing = box.contains(document.activeElement) && document.activeElement.value;
    if (typing) return;
    box.innerHTML = '';
    box.appendChild(renderItem(a, { big: true }));
  }

  $('lightbox-close').addEventListener('click', closeLightbox);
  $('lightbox').addEventListener('click', (e) => {
    if (e.target === $('lightbox')) closeLightbox();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeLightbox();
  });

  // ---------- Hele siden ----------
  function render() {
    const p = data.profile;
    document.title = `${p.name} – Lønningspils`;
    $('profile').classList.remove('hidden');
    $('p-avatar').replaceChildren(avatarEl(p.avatar, p.name, 120));
    $('p-name').textContent = p.name === data.viewer ? `${p.name} (deg)` : p.name;
    $('p-badge').classList.toggle('hidden', !p.isAdmin);
    $('p-joined').textContent = lastSeenText(p);
    renderBio(p);
    renderGuestbook(p);
    renderPeople();
    renderStats(p.stats);
    renderGallery();
    const feed = $('feed');
    // Behold det man holder på å skrive i en kommentar
    const drafts = {};
    feed.querySelectorAll('.feed-item').forEach((it) => {
      const input = it.querySelector('.comment-input');
      if (input && input.value) drafts[it.dataset.id] = input.value;
    });
    feed.innerHTML = '';
    if (!data.activity.length) feed.appendChild(el('p', 'muted', 'Ingen aktivitet ennå.'));
    data.activity.forEach((a) => {
      const item = renderItem(a);
      item.dataset.id = a.id;
      if (drafts[a.id] && item.querySelector('.comment-input')) item.querySelector('.comment-input').value = drafts[a.id];
      feed.appendChild(item);
    });
    renderLightbox();
  }

  async function load() {
    try {
      const url = name ? `/api/profile?navn=${encodeURIComponent(name)}` : '/api/profile';
      data = await api(url);
      name = data.profile.name;
      $('error').textContent = '';
      if (jumpTo) openComments.add(jumpTo); // vis alle kommentarene på innlegget
      render();
      if (jumpTo) showPost(jumpTo);
      if (location.hash === '#hilsener' && !scrolledToGuestbook) {
        scrolledToGuestbook = true;
        $('hilsener').scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    } catch (err) {
      $('error').innerHTML = '';
      $('error').append(document.createTextNode(err.message + ' '));
      const a = el('a', '', 'Gå til forsiden');
      a.href = '/';
      $('error').appendChild(a);
    }
  }

  function showPost(id) {
    jumpTo = null;
    const a = data.activity.find((x) => x.id === id);
    if (!a) return;
    if (a.url) return openLightbox(id); // bilder vises stort, med kommentarene under
    const item = document.querySelector(`.feed-item[data-id="${id}"]`);
    if (!item) return;
    item.scrollIntoView({ behavior: 'smooth', block: 'center' });
    item.classList.add('highlight');
  }

  function typingSomewhere() {
    const ae = document.activeElement;
    return ae && ae.classList && ae.classList.contains('comment-input') && ae.value;
  }

  // Live: oppdater når noen liker, kommenterer eller gjør noe nytt
  const liveReload = (msg) => {
    if (data && msg && msg.name === data.profile.name && !typingSomewhere()) load();
  };
  onLive('reactions', liveReload);
  onLive('activity', liveReload);
  load();
})();
