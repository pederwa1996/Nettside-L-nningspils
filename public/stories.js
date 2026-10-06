'use strict';

// Story-linje (som på Instagram) + fullskjermsvisning. Trenger media.js og et
// element med id="stories-bar" på siden.
(function () {
  const bar = document.getElementById('stories-bar');
  if (!bar) return;

  const STORY_MS = 5000;
  let groups = [];
  let me = null;
  let viewer = null; // { gi, ii, timer }

  async function api(path, body) {
    const res = await fetch(path, body
      ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }
      : {});
    const json = await res.json();
    if (!res.ok) throw new Error(json.error || 'Noe gikk galt');
    return json;
  }

  // ---------- Linjen ----------
  function seenKey(item) {
    return `story-seen-${item.id}`;
  }
  function isSeen(item) {
    try { return localStorage.getItem(seenKey(item)) === '1'; } catch { return false; }
  }
  function markSeen(item) {
    try { localStorage.setItem(seenKey(item), '1'); } catch { /* ignorer */ }
  }

  function renderBar() {
    bar.innerHTML = '';
    if (me) {
      const add = document.createElement('button');
      add.className = 'story-bubble add';
      add.type = 'button';
      const ring = document.createElement('span');
      ring.className = 'story-ring add';
      ring.appendChild(avatarEl(me.avatar, me.name, 56));
      const plus = document.createElement('span');
      plus.className = 'story-plus';
      plus.textContent = '+';
      ring.appendChild(plus);
      const label = document.createElement('span');
      label.className = 'story-name';
      label.textContent = 'Din story';
      add.append(ring, label);
      add.addEventListener('click', () => fileInput.click());
      bar.appendChild(add);
    }
    groups.forEach((g, gi) => {
      const b = document.createElement('button');
      b.className = 'story-bubble';
      b.type = 'button';
      const ring = document.createElement('span');
      ring.className = 'story-ring' + (g.items.every(isSeen) ? ' seen' : '');
      ring.appendChild(avatarEl(g.avatar, g.name, 56));
      const label = document.createElement('span');
      label.className = 'story-name';
      label.textContent = me && g.name === me.name ? 'Deg' : g.name.split(' ')[0];
      b.append(ring, label);
      b.addEventListener('click', () => {
        const firstUnseen = g.items.findIndex((it) => !isSeen(it));
        openViewer(gi, firstUnseen >= 0 ? firstUnseen : 0);
      });
      bar.appendChild(b);
    });
    if (!me && !groups.length) {
      bar.innerHTML = '<p class="muted story-empty">Ingen story ennå.</p>';
    }
  }

  async function load() {
    try {
      const data = await api('/api/stories');
      groups = data.groups;
      me = data.me;
      renderBar();
    } catch (err) {
      console.error(err);
    }
  }

  // ---------- Publisering ----------
  const fileInput = document.createElement('input');
  fileInput.type = 'file';
  fileInput.accept = 'image/*';
  fileInput.hidden = true;
  document.body.appendChild(fileInput);

  const composer = document.createElement('div');
  composer.className = 'story-overlay hidden';
  composer.innerHTML = `
    <div class="story-compose">
      <img class="story-preview" alt="">
      <input class="story-caption" type="text" maxlength="150" placeholder="Skriv noe (valgfritt)">
      <p class="error story-error"></p>
      <div class="story-actions">
        <button type="button" class="secondary story-cancel">Avbryt</button>
        <button type="button" class="story-publish">Del i story</button>
      </div>
    </div>`;
  document.body.appendChild(composer);
  let pending = null;

  fileInput.addEventListener('change', async () => {
    const file = fileInput.files[0];
    fileInput.value = '';
    if (!file) return;
    try {
      pending = await resizeImage(file, 1080, 0.8);
      composer.querySelector('.story-preview').src = pending;
      composer.querySelector('.story-caption').value = '';
      composer.querySelector('.story-error').textContent = '';
      composer.classList.remove('hidden');
    } catch (err) {
      alert(err.message);
    }
  });
  composer.querySelector('.story-cancel').addEventListener('click', () => composer.classList.add('hidden'));
  composer.querySelector('.story-publish').addEventListener('click', async (e) => {
    const btn = e.currentTarget;
    btn.disabled = true;
    btn.textContent = 'Deler ...';
    try {
      await api('/api/stories', { image: pending, caption: composer.querySelector('.story-caption').value });
      composer.classList.add('hidden');
      await load();
    } catch (err) {
      composer.querySelector('.story-error').textContent = err.message;
    }
    btn.disabled = false;
    btn.textContent = 'Del i story';
  });

  // ---------- Visning ----------
  const view = document.createElement('div');
  view.className = 'story-overlay story-view hidden';
  view.innerHTML = `
    <div class="story-frame">
      <div class="story-progress"></div>
      <div class="story-head">
        <span class="story-who"></span>
        <span class="story-when muted"></span>
        <button type="button" class="story-delete hidden" title="Slett">🗑️</button>
        <button type="button" class="story-close" title="Lukk">✕</button>
      </div>
      <img class="story-img" alt="">
      <p class="story-text"></p>
      <div class="story-tap left"></div>
      <div class="story-tap right"></div>
    </div>`;
  document.body.appendChild(view);

  function show() {
    const g = groups[viewer.gi];
    const item = g.items[viewer.ii];
    markSeen(item);
    view.querySelector('.story-img').src = item.url;
    view.querySelector('.story-text').textContent = item.caption || '';
    view.querySelector('.story-text').classList.toggle('hidden', !item.caption);
    const who = view.querySelector('.story-who');
    who.innerHTML = '';
    who.append(avatarEl(g.avatar, g.name, 32), document.createTextNode(` ${g.name}`));
    view.querySelector('.story-when').textContent = timeAgo(item.at);
    view.querySelector('.story-delete').classList.toggle('hidden', !(me && g.name === me.name));

    const prog = view.querySelector('.story-progress');
    prog.innerHTML = '';
    g.items.forEach((_, i) => {
      const seg = document.createElement('span');
      const fill = document.createElement('span');
      fill.className = i < viewer.ii ? 'done' : i === viewer.ii ? 'active' : '';
      if (i === viewer.ii) fill.style.animationDuration = `${STORY_MS}ms`;
      seg.appendChild(fill);
      prog.appendChild(seg);
    });

    clearTimeout(viewer.timer);
    viewer.timer = setTimeout(next, STORY_MS);
  }

  function openViewer(gi, ii) {
    viewer = { gi, ii, timer: null };
    view.classList.remove('hidden');
    document.body.classList.add('no-scroll');
    show();
  }

  function closeViewer() {
    if (!viewer) return;
    clearTimeout(viewer.timer);
    viewer = null;
    view.classList.add('hidden');
    document.body.classList.remove('no-scroll');
    renderBar();
  }

  function next() {
    const g = groups[viewer.gi];
    if (viewer.ii < g.items.length - 1) viewer.ii++;
    else if (viewer.gi < groups.length - 1) {
      viewer.gi++;
      viewer.ii = 0;
    } else return closeViewer();
    show();
  }

  function prev() {
    if (viewer.ii > 0) viewer.ii--;
    else if (viewer.gi > 0) {
      viewer.gi--;
      viewer.ii = groups[viewer.gi].items.length - 1;
    }
    show();
  }

  view.querySelector('.story-tap.right').addEventListener('click', next);
  view.querySelector('.story-tap.left').addEventListener('click', prev);
  view.querySelector('.story-close').addEventListener('click', closeViewer);
  view.querySelector('.story-delete').addEventListener('click', async () => {
    const item = groups[viewer.gi].items[viewer.ii];
    clearTimeout(viewer.timer);
    if (!confirm('Slette dette bildet fra storyen din?')) return show();
    try {
      await api('/api/stories/delete', { id: item.id });
    } catch (err) {
      alert(err.message);
    }
    closeViewer();
    load();
  });
  document.addEventListener('keydown', (e) => {
    if (!viewer) return;
    if (e.key === 'Escape') closeViewer();
    if (e.key === 'ArrowRight') next();
    if (e.key === 'ArrowLeft') prev();
  });

  onLive('stories', () => !viewer && load());
  onLive('avatars', () => !viewer && load());
  window.reloadStories = load;
  load();
})();
