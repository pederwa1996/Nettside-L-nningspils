'use strict';

// Varig lagring i Supabase Storage, slik at ingenting forsvinner når Render
// starter på nytt. Brukes bare hvis SUPABASE_URL og SUPABASE_KEY er satt.
//
// - Data (deltakere, spinn, chat ...) lagres som én JSON-fil i en privat bøtte.
// - Bilder lastes opp til en offentlig bøtte.
// Bøttene opprettes automatisk ved oppstart.

const SUPABASE_URL = (process.env.SUPABASE_URL || '').replace(/\/+$/, '');
const SUPABASE_KEY = process.env.SUPABASE_KEY || '';
const DATA_BUCKET = process.env.SUPABASE_DATA_BUCKET || 'lonningspils-data';
const MEDIA_BUCKET = process.env.SUPABASE_MEDIA_BUCKET || 'lonningspils-media';
const STATE_PATH = 'state.json';

const enabled = Boolean(SUPABASE_URL && SUPABASE_KEY);

function headers(extra = {}) {
  const h = { apikey: SUPABASE_KEY, ...extra };
  // Nye "sb_secret_..."-nøkler er ikke JWT og skal bare sendes som apikey.
  // Den gamle service_role-nøkkelen (JWT) må også sendes som Bearer.
  if (!SUPABASE_KEY.startsWith('sb_')) h.Authorization = `Bearer ${SUPABASE_KEY}`;
  return h;
}

async function request(method, urlPath, { body, headers: extra, okStatuses = [] } = {}) {
  const res = await fetch(`${SUPABASE_URL}${urlPath}`, { method, headers: headers(extra), body });
  if (!res.ok && !okStatuses.includes(res.status)) {
    const text = await res.text().catch(() => '');
    throw new Error(`Supabase ${method} ${urlPath} feilet (${res.status}): ${text.slice(0, 200)}`);
  }
  return res;
}

async function ensureBucket(name, isPublic) {
  const res = await request('POST', '/storage/v1/bucket', {
    body: JSON.stringify({ id: name, name, public: isPublic }),
    headers: { 'Content-Type': 'application/json' },
    okStatuses: [400, 409],
  });
  if (!res.ok) {
    // 400/409 betyr som regel at bøtta allerede finnes
    const text = await res.text();
    if (!/already exists|Duplicate/i.test(text)) throw new Error(`Kunne ikke opprette bøtta ${name}: ${text.slice(0, 200)}`);
  }
}

async function init() {
  await ensureBucket(DATA_BUCKET, false);
  await ensureBucket(MEDIA_BUCKET, true);
}

// ---------- Data ----------
async function loadState() {
  const res = await request('GET', `/storage/v1/object/${DATA_BUCKET}/${STATE_PATH}`, { okStatuses: [400, 404] });
  if (!res.ok) return null; // finnes ikke ennå
  return JSON.parse(await res.text());
}

async function uploadState(json) {
  await request('POST', `/storage/v1/object/${DATA_BUCKET}/${STATE_PATH}`, {
    body: json,
    headers: { 'Content-Type': 'application/json', 'x-upsert': 'true', 'Cache-Control': 'no-cache' },
  });
}

// Lagrer maks én gang om gangen, og alltid den nyeste versjonen.
let pendingJson = null; // funksjon som lager JSON når vi faktisk skal lagre
let running = null;
let timer = null;

function scheduleSave(getJson) {
  if (!enabled) return;
  pendingJson = getJson;
  clearTimeout(timer);
  timer = setTimeout(flush, 400);
}

function flush() {
  clearTimeout(timer);
  if (running) return running;
  running = (async () => {
    while (pendingJson) {
      const json = pendingJson();
      pendingJson = null;
      for (let attempt = 1; attempt <= 3; attempt++) {
        try {
          await uploadState(json);
          break;
        } catch (err) {
          console.error(`Lagring til Supabase feilet (forsøk ${attempt}):`, err.message);
          if (attempt < 3) await new Promise((r) => setTimeout(r, 1000 * attempt));
        }
      }
    }
    running = null;
  })();
  return running;
}

// ---------- Bilder ----------
const inflight = new Set(); // opplastinger som ikke er ferdige ennå

function uploadImage(objectPath, buf) {
  const p = uploadImageNow(objectPath, buf);
  inflight.add(p);
  p.finally(() => inflight.delete(p));
  return p;
}

async function uploadImageNow(objectPath, buf) {
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      await request('POST', `/storage/v1/object/${MEDIA_BUCKET}/${objectPath}`, {
        body: buf,
        headers: { 'Content-Type': 'image/jpeg', 'x-upsert': 'true', 'Cache-Control': 'max-age=86400' },
      });
      return;
    } catch (err) {
      console.error(`Opplasting av ${objectPath} feilet (forsøk ${attempt}):`, err.message);
      await new Promise((r) => setTimeout(r, 1000 * attempt));
    }
  }
}

async function deleteImages(objectPaths) {
  if (!objectPaths.length) return;
  await request('DELETE', `/storage/v1/object/${MEDIA_BUCKET}`, {
    body: JSON.stringify({ prefixes: objectPaths }),
    headers: { 'Content-Type': 'application/json' },
  }).catch((err) => console.error('Sletting av bilder feilet:', err.message));
}

async function deleteAllImages() {
  for (const folder of ['avatars', 'stories', 'mogg', 'tasks']) {
    for (;;) {
      const res = await request('POST', `/storage/v1/object/list/${MEDIA_BUCKET}`, {
        body: JSON.stringify({ prefix: folder, limit: 1000, offset: 0 }),
        headers: { 'Content-Type': 'application/json' },
      }).catch(() => null);
      if (!res) break;
      const items = (await res.json()).filter((it) => it.name && it.id);
      if (!items.length) break;
      await deleteImages(items.map((it) => `${folder}/${it.name}`));
      if (items.length < 1000) break;
    }
  }
}

function publicUrl(objectPath) {
  return `${SUPABASE_URL}/storage/v1/object/public/${MEDIA_BUCKET}/${objectPath}`;
}

// Venter til alt er lagret: data og bilder (brukes før serveren stopper)
async function drain() {
  await Promise.all([flush(), ...inflight]);
}

module.exports = { enabled, init, loadState, scheduleSave, flush, drain, uploadImage, deleteImages, deleteAllImages, publicUrl };
