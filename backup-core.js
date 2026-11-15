/* Mixtape: what is kept on this device, and backing it up, restoring it and forgetting it.
   Used by storage/ (the whole of it) and home/ (the small facts). Nothing here talks to any server.

   THE BACKUP FILE (.mixtape-backup), version 1
     bytes 0-15    the words "MIXTAPE-BACKUP1" and a line feed (16 bytes of plain text)
     bytes 16-19   H, the length of the header, as a 32-bit whole number, high byte first
     next H bytes  the header: JSON text in UTF-8
     next 32 bytes the SHA-256 of those H header bytes
     the rest      the parts, back to back, in the order the header lists them
   The header:
     { format: "mixtape-backup", version: 1, madeAt: ISO date, chunk: 4194304, payloadBytes: n,
       counts: { songs, playlists, favourites, lyrics, transcripts, marks, mixes, settings },
       parts: [ { name, kind: "json" | "binary", offset, bytes, check } ] }
     offset is counted from the first byte after the 32-byte header hash; the parts leave no gaps and do not overlap,
     so the whole file is exactly 16 + 4 + H + 32 + payloadBytes long.
     check is a hash of the part taken 4 MiB at a time (so a song never has to fit in memory): the SHA-256 of each
     4 MiB piece, joined end to end, then the SHA-256 of that, in hex.
   The parts:
     library (json)     { tracks: [ { meta: {the song's details, lyrics included}, bin: { blob: {part, as, mime}, art: … } } ] }
     lists (json)       { playlists: [ { id, name, ids, created } ], favourites: [ids] }
     marks (json)       { marks: [ { id, sensitive, at } ] }
     local (json)       { keys: { name: text } }   Studio mixes and settings
     transcript (json)  one transcript each
     blob (binary)      a song's sound, its artwork, or another binary field of a song
   Sound is never turned into text: it is copied byte for byte.

   A backup is someone else's data until it is checked. Nothing is written until the whole file has passed: the marker,
   the version, every offset and length against the real size, every hash, and the type of every field. */

const LOCALHOST = ['localhost', '127.0.0.1', '[::1]'].includes(location.hostname);
/* Tests only: on localhost, ?sandbox=name gives every store its own name, so a test never touches the real ones. */
export const SANDBOX = (() => { if (!LOCALHOST) return ''; const m = /[?&]sandbox=([a-z0-9]{3,24})(?:&|$)/.exec(location.search); return m ? m[1] : ''; })();
const PRE = SANDBOX ? SANDBOX + '-' : '';
const DB = { lib: PRE + 'mixtape-player', tr: PRE + 'mixtape-transcripts', cut: PRE + 'cutter-session', reader: PRE + 'reader-recent', links: PRE + 'mixtape-studio-links' };
export const CHANNEL = PRE + 'mixtape';
export const MAGIC = 'MIXTAPE-BACKUP1\n', FORMAT = 'mixtape-backup', VERSION = 1, CHUNK = 4194304;
const PREFIX_FIXED = 16 + 4 + 32, MAX_HEADER = 64 * 1048576;

export const plural = (n, one, many) => `${n.toLocaleString('en')} ${n === 1 ? one : (many || one + 's')}`;
export function sizeText(b) {
  if (!(b > 0)) return 'nothing';
  if (b < 1024) return 'under 1 KB';
  if (b < 1048576) return `${Math.round(b / 1024)} KB`;
  if (b < 1073741824) return `${(b / 1048576).toFixed(b < 10485760 ? 1 : 0)} MB`;
  return `${(b / 1073741824).toFixed(2)} GB`;
}
const uid = () => (crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2));
const tell = () => { try { const c = new BroadcastChannel(CHANNEL); c.postMessage({ type: 'library' }); c.postMessage({ type: 'lists' }); setTimeout(() => c.close(), 500); } catch (e) {} };

/* ---------- the browser's stores ---------- */
/* Opens a database only if it is already there. Opening one that is not would create it empty, and the tool it belongs
   to would then find a database with nothing set up in it. Gives null when there is none. */
export function openExisting(name) {
  return new Promise((res, rej) => {
    let fresh = false, r;
    try { r = indexedDB.open(name); } catch (e) { return rej(e); }
    r.onupgradeneeded = () => { fresh = true; try { r.transaction.abort(); } catch (e) {} };
    r.onsuccess = () => { if (fresh) { try { r.result.close(); } catch (e) {} res(null); } else res(r.result); };
    r.onerror = e => { if (fresh) { try { e.preventDefault(); } catch (e2) {} res(null); } else rej(r.error || new Error('storage is not available')); };
  });
}
/* For restoring: opens the database, making it exactly as its own tool would if it is not there yet. */
function openMake(name, version, stores) {
  const make = () => new Promise((res, rej) => {
    const r = indexedDB.open(name, version);
    r.onupgradeneeded = () => { const d = r.result; for (const s of stores) if (!d.objectStoreNames.contains(s)) d.createObjectStore(s, { keyPath: 'id' }); };
    r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error || new Error('storage is not available'));
    r.onblocked = () => rej(new Error('blocked'));
  });
  return openExisting(name).then(d => {
    if (!d) return make();
    if (stores.every(s => d.objectStoreNames.contains(s))) return d;
    const old = d.version; d.close();
    if (old < version) return make();
    throw new Error('storage is set up differently');
  });
}
const txDone = t => new Promise((res, rej) => { t.oncomplete = () => res(); t.onerror = t.onabort = () => rej(t.error || new Error('The change could not be saved')); });
const reqDone = r => new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
async function readAll(d, store) { if (!d || !d.objectStoreNames.contains(store)) return []; return reqDone(d.transaction(store, 'readonly').objectStore(store).getAll()); }
async function countOf(d, store) { if (!d || !d.objectStoreNames.contains(store)) return 0; return reqDone(d.transaction(store, 'readonly').objectStore(store).count()); }
async function clearAll(name) {
  const d = await openExisting(name); if (!d) return;
  try { const names = [...d.objectStoreNames]; if (!names.length) return; const t = d.transaction(names, 'readwrite'), done = txDone(t); for (const s of names) t.objectStore(s).clear(); await done; } finally { d.close(); }
}
/* roughly how many bytes a stored thing takes: sound and pictures exactly, the words around them near enough */
function weigh(v, depth = 0) {
  if (v == null) return 0;
  if (typeof v === 'string') return v.length;
  if (typeof v === 'number') return 8;
  if (typeof v === 'boolean') return 1;
  if (typeof Blob !== 'undefined' && v instanceof Blob) return v.size;
  if (v instanceof ArrayBuffer) return v.byteLength;
  if (ArrayBuffer.isView(v)) return v.byteLength;
  if (typeof v !== 'object' || depth > 30) return 0;
  if (Array.isArray(v)) { let n = 0; for (const x of v) n += weigh(x, depth + 1); return n; }
  if (Object.getPrototypeOf(v) !== Object.prototype) return 0; /* a pointer to a file or folder: it holds no copy */
  let n = 0; for (const k of Object.keys(v)) n += k.length + weigh(v[k], depth + 1); return n;
}

/* The small settings store. A name here is the name the tools use; in a test sandbox the stored key has the prefix. */
const OWN_KEY = /^(mixtape-|cutter:|reader:)/;
function localAll() {
  const out = []; let other = 0;
  try {
    for (const key of Object.keys(localStorage)) {
      const name = PRE ? (key.startsWith(PRE) ? key.slice(PRE.length) : null) : key;
      if (name == null) continue;
      if (!OWN_KEY.test(name)) { other++; continue; }
      const value = localStorage.getItem(key); if (typeof value === 'string') out.push({ name, value });
    }
  } catch (e) {}
  return { own: out, other };
}
const localGet = name => { try { return localStorage.getItem(PRE + name); } catch (e) { return null; } };
const localSet = (name, value) => { try { localStorage.setItem(PRE + name, value); return true; } catch (e) { return false; } };
const localDrop = test => { let ok = true; try { for (const { name } of localAll().own) if (test(name)) localStorage.removeItem(PRE + name); } catch (e) { ok = false; } return ok; };
const GROUP = name => /^mixtape-studio-/.test(name) ? 'studio' : /^cutter:/.test(name) ? 'cutter' : /^reader:/.test(name) ? 'reader' : 'settings';
const isMix = name => /^mixtape-studio-project(:|-v1$)/.test(name);

/* the browser's private folders: the Cutter's working copies of exports ('cutter') and of cuts ('cuts') */
const WORK_DIRS = ['cutter', 'cuts'];
async function privateRoot(create) {
  if (!navigator.storage || !navigator.storage.getDirectory) return null;
  let root = await navigator.storage.getDirectory();
  if (SANDBOX) { try { root = await root.getDirectoryHandle(SANDBOX, { create: !!create }); } catch (e) { return null; } }
  return root;
}
async function workFiles() {
  let files = 0, bytes = 0, other = 0;
  try {
    const root = await privateRoot(false); if (!root) return { files, bytes, other };
    const walk = async dir => { for await (const [, h] of dir.entries()) { if (h.kind === 'file') { files++; try { bytes += (await h.getFile()).size; } catch (e) {} } else await walk(h); } };
    for await (const [name, h] of root.entries()) { if (h.kind === 'directory' && WORK_DIRS.includes(name)) await walk(h); else if (!SANDBOX) other++; }
  } catch (e) {}
  return { files, bytes, other };
}
async function workClear() {
  let ok = true;
  try {
    const root = await privateRoot(false); if (!root) return ok;
    for (const name of WORK_DIRS) {
      let dir; try { dir = await root.getDirectoryHandle(name); } catch (e) { continue; }
      const names = []; for await (const [k] of dir.entries()) names.push(k);
      for (const k of names) { try { await dir.removeEntry(k, { recursive: true }); } catch (e) { ok = false; } }
    }
  } catch (e) { ok = false; }
  return ok;
}

/* downloads kept for working offline */
const CACHE_OWN = name => /^mixtape-/.test(name) || name === 'transformers-cache';
export const isAppCopy = name => /^mixtape-v\d+$/.test(name);
function cacheWords(name) {
  if (isAppCopy(name)) return { title: 'Mixtape itself, for use offline', what: `The app's own pages (copy ${name.replace('mixtape-v', '')}), so Mixtape opens with no internet. It holds none of your files.` };
  if (/^mixtape-lyrics-runtime/.test(name)) return { title: 'Speech recogniser: the program', what: 'The program that turns speech into words, downloaded once so transcripts can be made offline.' };
  if (name === 'transformers-cache') return { title: 'Speech recogniser: what it has learnt', what: 'The downloaded recognisers themselves (the large files that know what words sound like).' };
  if (/^mixtape-speaker/.test(name)) return { title: 'Speaker recogniser', what: 'The download that tells one voice from another in a recording.' };
  if (/^mixtape-stems-runtime/.test(name)) return { title: 'Stem splitter: the program', what: 'The program that splits a song into vocals, drums, bass and the rest.' };
  if (/^mixtape-stems-model/.test(name)) return { title: 'Stem splitter: what it has learnt', what: 'The large download the stem splitter works from.' };
  if (/^mixtape-orch/.test(name)) return { title: 'Orchestra recordings', what: 'Instrument sounds for the Studio, downloaded the first time each was used.' };
  return { title: `Another Mixtape download (${name})`, what: 'A download Mixtape keeps so it works offline.' };
}
async function cacheList() {
  const out = []; let other = 0;
  try {
    if (!('caches' in self)) return { own: out, other };
    for (const key of await caches.keys()) {
      const name = PRE ? (key.startsWith(PRE) ? key.slice(PRE.length) : null) : key;
      if (name == null) continue;
      if (!CACHE_OWN(name)) { other++; continue; }
      let files = 0, bytes = 0;
      try {
        const c = await caches.open(key);
        for (const rq of await c.keys()) { files++; try { const rs = await c.match(rq); if (rs) { const len = +rs.headers.get('content-length'); bytes += len > 0 ? len : (await rs.blob()).size; } } catch (e) {} }
      } catch (e) {}
      out.push({ name, key, files, bytes });
    }
  } catch (e) {}
  return { own: out, other };
}

/* ---------- what is kept on this device ---------- */
const isSong = t => t && !t.stemOf && t.kind !== 'video';
async function withDb(name, fn, none) { let d = null; try { d = await openExisting(name); if (!d) return none; return await fn(d); } catch (e) { return none; } finally { if (d) try { d.close(); } catch (e) {} } }

/* One cheap fact per tool for the home page. A fact that cannot be read is simply left out (null). */
export async function facts() {
  const f = { songs: null, mixes: null, transcripts: null, cutter: null, reader: null };
  await Promise.all([
    withDb(DB.lib, async d => { const all = await readAll(d, 'tracks'); f.songs = all.filter(t => isSong(t) && (t.blob || t.buf)).length; }),
    withDb(DB.tr, async d => { f.transcripts = await countOf(d, 'transcripts'); }),
    withDb(DB.cut, async d => { f.cutter = await countOf(d, 'files'); }),
    withDb(DB.reader, async d => { f.reader = await countOf(d, 'docs'); }),
  ]);
  try { const raw = localGet('mixtape-studio-projects'); if (raw != null) { const l = JSON.parse(raw); if (Array.isArray(l)) f.mixes = l.length; } } catch (e) {}
  return f;
}

/* Every store Mixtape uses, in plain words, with how much is in it. */
export async function survey() {
  const rows = [], local = localAll(), by = { studio: [], cutter: [], reader: [], settings: [] };
  for (const kv of local.own) by[GROUP(kv.name)].push(kv);
  const lsBytes = list => list.reduce((n, kv) => n + (kv.name.length + kv.value.length) * 2, 0);
  let unread = false;

  /* the song library */
  { let tracks = [], lists = [], here = false, failed = false;
    try { const d = await openExisting(DB.lib); if (d) { here = true; try { tracks = await readAll(d, 'tracks'); lists = await readAll(d, 'lists'); } finally { d.close(); } } } catch (e) { failed = true; unread = true; }
    const songs = tracks.filter(isSong).length, stems = tracks.filter(t => t.stemOf).length, videos = tracks.filter(t => !t.stemOf && t.kind === 'video').length;
    const fav = lists.find(l => l.id === '__fav'), favs = fav && Array.isArray(fav.ids) ? fav.ids.length : 0, pls = lists.filter(l => l.id !== '__fav').length, lyr = tracks.filter(t => t.lyrics).length;
    const bits = []; if (songs) bits.push(plural(songs, 'song')); if (videos) bits.push(plural(videos, 'video')); if (stems) bits.push(plural(stems, 'split part')); if (pls) bits.push(plural(pls, 'playlist')); if (favs) bits.push(plural(favs, 'favourite')); if (lyr) bits.push(`${plural(lyr, 'song')} with lyrics`);
    rows.push({ id: 'library', title: 'The song library', what: 'Every song, recording and video you added, with artwork and lyrics, plus your playlists and favourites. Used by the Player, the Studio, the Cutter and Transcripts.',
      items: failed ? 'could not be read just now' : bits.join(', ') || 'nothing', bytes: weigh(tracks) + weigh(lists), empty: !failed && !tracks.length && !lists.length, here, failed,
      consequence: 'All your songs, recordings, lyrics, playlists and favourites will be gone from this device. The files you added them from are not touched.' });
  }
  /* transcripts and sensitive marks */
  { let trs = [], flags = [], failed = false;
    try { const d = await openExisting(DB.tr); if (d) { try { trs = await readAll(d, 'transcripts'); flags = await readAll(d, 'flags'); } finally { d.close(); } } } catch (e) { failed = true; unread = true; }
    const marked = new Set(flags.filter(f => f && f.sensitive).map(f => f.id)); for (const t of trs) if (t && t.sensitive) marked.add(t.id);
    const bits = []; if (trs.length) bits.push(plural(trs.length, 'transcript')); if (marked.size) bits.push(`${plural(marked.size, 'recording')} marked sensitive`);
    rows.push({ id: 'transcripts', title: 'Transcripts', what: 'The words of every transcript and read-along, with their timings and your corrections, and the list of recordings you marked sensitive.',
      items: failed ? 'could not be read just now' : bits.join(', ') || 'nothing', bytes: weigh(trs) + weigh(flags), empty: !failed && !trs.length && !flags.length, failed,
      consequence: 'Every transcript and read-along will be gone from this device. The recordings stay in the song library, and a recording you marked sensitive stays marked for as long as it is there.' });
  }
  /* Studio */
  { const mixes = by.studio.filter(kv => isMix(kv.name)).length; let links = 0, lbytes = 0;
    await withDb(DB.links, async d => { links = await countOf(d, 'handles'); lbytes = 200 * links; });
    const bits = []; if (mixes) bits.push(plural(mixes, 'mix', 'mixes')); if (links) bits.push('a pointer to the linked project folder'); if (!bits.length && by.studio.length) bits.push('layout choices');
    rows.push({ id: 'studio', title: 'Studio mixes', what: 'Each mix you made in the Studio (which songs, where they sit, the levels and effects), how you laid the Studio out, and a pointer to a project folder if you linked one. The songs themselves are in the song library.',
      items: bits.join(', ') || 'nothing', bytes: lsBytes(by.studio) + lbytes, empty: !by.studio.length && !links,
      consequence: 'Every Studio mix will be gone from this device. The songs in them stay in the song library. Close any open Studio window first, or it will save its mix again.' });
  }
  /* the Cutter */
  { let files = [], state = 0, failed = false;
    try { const d = await openExisting(DB.cut); if (d) { try { files = await readAll(d, 'files'); state = await countOf(d, 'state'); } finally { d.close(); } } } catch (e) { failed = true; unread = true; }
    const work = await workFiles(), parts = by.cutter.filter(kv => /^cutter:parts:/.test(kv.name)).length, copies = files.filter(f => f && f.file).length;
    const bits = []; if (files.length) bits.push(`${plural(files.length, 'file')} from your last visit${copies ? ` (${copies} kept as a full copy)` : ''}`); if (work.files) bits.push(plural(work.files, 'working copy', 'working copies')); if (parts) bits.push(`cut marks for ${plural(parts, 'file')}`); if (!bits.length && (by.cutter.length || state)) bits.push('settings');
    rows.push({ id: 'cutter', title: 'The Cutter’s last session', what: 'The files that were open in the Cutter last time (a full copy only where the browser could not find the file again), where you were, the working copies of recent exports, your cut marks and the Cutter’s settings.',
      items: failed ? 'could not be read just now' : bits.join(', ') || 'nothing', bytes: weigh(files) + work.bytes + lsBytes(by.cutter), empty: !failed && !files.length && !state && !work.files && !by.cutter.length, failed,
      consequence: 'The Cutter will open empty next time, with its settings and cut marks gone. Files you already saved, and the files on your disk, are not touched.' });
    rows.otherFolders = work.other;
  }
  /* the Reader */
  { let docs = 0, failed = false;
    try { const d = await openExisting(DB.reader); if (d) { try { docs = await countOf(d, 'docs'); } finally { d.close(); } } } catch (e) { failed = true; unread = true; }
    const bits = []; if (docs) bits.push(plural(docs, 'recent document')); if (!bits.length && by.reader.length) bits.push('one setting');
    rows.push({ id: 'reader', title: 'The Reader’s recent list', what: 'The names of documents you opened in the Reader, each with a pointer to where the file is on this device, and whether “Save as I go” is on. No copy of any document is kept.',
      items: failed ? 'could not be read just now' : bits.join(', ') || 'nothing', bytes: docs * 300 + lsBytes(by.reader), empty: !failed && !docs && !by.reader.length, failed,
      consequence: 'The Reader’s list of recent documents will be empty. The documents themselves are not touched.' });
  }
  /* settings */
  rows.push({ id: 'settings', title: 'Settings', what: 'Small things the Player and Transcripts remember: the volume, where you stopped, how lists are sorted, which panels are open, and measurements of your songs that make the Studio quicker.',
    items: by.settings.length ? plural(by.settings.length, 'setting') : 'nothing', bytes: lsBytes(by.settings), empty: !by.settings.length,
    consequence: 'Mixtape will go back to how it was the first time you opened it: volume, sorting and where you stopped are forgotten. Close other Mixtape windows first, or they will save their settings again.' });
  /* downloads */
  const cl = await cacheList();
  for (const c of cl.own) { const w = cacheWords(c.name);
    rows.push({ id: 'cache:' + c.name, title: w.title, what: w.what, items: plural(c.files, 'file'), bytes: c.bytes, empty: false, download: true, appCopy: isAppCopy(c.name),
      consequence: isAppCopy(c.name) ? 'Mixtape will not open without internet until you have opened it once while online. None of your songs or transcripts are affected.' : 'It will be downloaded again the next time you use that feature, which needs internet. None of your songs or transcripts are affected.' });
  }
  /* things at this address that are not Mixtape's */
  let otherDbs = 0;
  if (!SANDBOX) { try { if (indexedDB.databases) { const known = new Set(Object.values(DB)); otherDbs = (await indexedDB.databases()).filter(d => d.name && !known.has(d.name)).length; } } catch (e) {} }
  const others = SANDBOX ? 0 : local.other + cl.other + otherDbs + (rows.otherFolders || 0);
  /* the browser's own figures */
  let used = null, quota = null, kept = null;
  try { if (navigator.storage && navigator.storage.estimate) { const e = await navigator.storage.estimate(); used = e.usage ?? null; quota = e.quota ?? null; } } catch (e) {}
  try { if (navigator.storage && navigator.storage.persisted) kept = await navigator.storage.persisted(); } catch (e) {}
  return { rows, others, used, quota, kept, unread };
}
export async function askProtection() { try { if (navigator.storage && navigator.storage.persist) return await navigator.storage.persist(); } catch (e) {} return null; }

/* ---------- forgetting ---------- */
/* id: a row's id from survey(), or 'everything'. Gives true when all of it went. */
export async function forget(id) {
  let ok = true; const attempt = async fn => { try { if ((await fn()) === false) ok = false; } catch (e) { ok = false; } };
  const library = () => clearAll(DB.lib);
  /* The marks protect recordings, so a mark outlives its transcript for as long as the recording is in the library. */
  const transcripts = async () => {
    const d = await openExisting(DB.tr); if (!d) return;
    try {
      let keep = new Set(); const lib = await openExisting(DB.lib);
      if (lib) { try { if (lib.objectStoreNames.contains('tracks')) keep = new Set(await reqDone(lib.transaction('tracks', 'readonly').objectStore('tracks').getAllKeys())); } finally { lib.close(); } }
      const names = [...d.objectStoreNames]; if (!names.length) return;
      const marks = names.includes('flags') ? await readAll(d, 'flags') : [], sens = new Set(marks.filter(f => f && f.sensitive).map(f => f.id));
      if (names.includes('transcripts')) for (const t of await readAll(d, 'transcripts')) if (t && t.sensitive) sens.add(t.id);
      const t = d.transaction(names, 'readwrite'), done = txDone(t);
      for (const s of names) if (s !== 'flags') t.objectStore(s).clear();
      if (names.includes('flags')) { const o = t.objectStore('flags'); for (const f of marks) if (f && !keep.has(f.id)) o.delete(f.id); for (const sid of sens) if (keep.has(sid)) o.put({ id: sid, sensitive: true, at: Date.now() }); }
      await done;
    } finally { d.close(); }
  };
  const studio = async () => { await clearAll(DB.links); return localDrop(n => GROUP(n) === 'studio'); };
  const cutter = async () => { await clearAll(DB.cut); const a = await workClear(); return localDrop(n => GROUP(n) === 'cutter') && a; };
  const reader = async () => { await clearAll(DB.reader); return localDrop(n => GROUP(n) === 'reader'); };
  const settings = () => localDrop(n => GROUP(n) === 'settings');
  const cache = name => caches.delete(PRE + name);
  if (id === 'everything') {
    /* the library first, so that no recording is left for a sensitive mark to stay on */
    for (const fn of [library, transcripts, studio, cutter, reader, settings]) await attempt(fn);
    for (const c of (await cacheList()).own) if (!isAppCopy(c.name)) await attempt(() => cache(c.name));
  } else if (id === 'library') await attempt(library);
  else if (id === 'transcripts') await attempt(transcripts);
  else if (id === 'studio') await attempt(studio);
  else if (id === 'cutter') await attempt(cutter);
  else if (id === 'reader') await attempt(reader);
  else if (id === 'settings') await attempt(settings);
  else if (id.startsWith('cache:') && CACHE_OWN(id.slice(6))) await attempt(() => cache(id.slice(6)));
  else return false;
  tell();
  return ok;
}

/* ---------- making a backup ---------- */
const hex = u8 => [...u8].map(b => b.toString(16).padStart(2, '0')).join('');
const sha = async data => { if (!crypto.subtle) throw new Error('nosubtle'); return new Uint8Array(await crypto.subtle.digest('SHA-256', data)); };
function join(list) { let n = 0; for (const a of list) n += a.length; const out = new Uint8Array(n); let o = 0; for (const a of list) { out.set(a, o); o += a.length; } return out; }
/* the check of one part, read 4 MiB at a time; each piece is handed to `each` as it is read */
async function checkOf(blob, each) {
  const digests = [];
  for (let o = 0; o < blob.size; o += CHUNK) {
    const want = Math.min(CHUNK, blob.size - o), buf = await blob.slice(o, o + want).arrayBuffer();
    if (buf.byteLength !== want) throw new Error('short');
    digests.push(await sha(buf)); if (each) await each(buf);
  }
  return hex(await sha(join(digests)));
}
const TYPED = { Uint8Array, Int8Array, Uint8ClampedArray, Int16Array, Uint16Array, Int32Array, Uint32Array, Float32Array, Float64Array };
const BAD_KEY = k => k === '__proto__' || k === 'constructor' || k === 'prototype';
/* Plain data only: text, numbers, yes/no, nothing, lists, and objects of those. Anything else is left out. */
function plain(v, depth = 0) {
  if (v === null || typeof v === 'boolean') return v;
  if (typeof v === 'string') return v.length > 2e7 ? v.slice(0, 2e7) : v;
  if (typeof v === 'number') return isFinite(v) ? v : null;
  if (typeof v !== 'object' || depth > 60) return undefined;
  if (Array.isArray(v)) return v.map(x => { const p = plain(x, depth + 1); return p === undefined ? null : p; });
  const proto = Object.getPrototypeOf(v); if (proto !== Object.prototype && proto !== null) return undefined;
  const out = {}; for (const k of Object.keys(v)) { if (BAD_KEY(k)) continue; const p = plain(v[k], depth + 1); if (p !== undefined) out[k] = p; }
  return out;
}

/* Reads everything that goes into a backup. Sound and pictures stay where they are (only pointers are held). */
export async function collect() {
  const parts = [], add = (name, kind, data) => { parts.push({ name, kind, data }); return parts.length - 1; };
  const json = (name, obj) => add(name, 'json', new Blob([JSON.stringify(obj)], { type: 'application/json' }));
  const counts = { songs: 0, playlists: 0, favourites: 0, lyrics: 0, transcripts: 0, marks: 0, mixes: 0, settings: 0 };
  let tracks = [], lists = [], trs = [], flags = [], silent = 0;
  { const d = await openExisting(DB.lib); if (d) { try { tracks = await readAll(d, 'tracks'); lists = await readAll(d, 'lists'); } finally { d.close(); } } }
  { const d = await openExisting(DB.tr); if (d) { try { trs = await readAll(d, 'transcripts'); flags = await readAll(d, 'flags'); } finally { d.close(); } } }
  const lib = { tracks: [] }, blobs = [];
  for (const t of tracks) {
    if (!t || typeof t !== 'object') continue;
    const sound = t.blob instanceof Blob ? t.blob : t.buf instanceof ArrayBuffer ? new Blob([t.buf], { type: typeof t.type === 'string' ? t.type : '' }) : null;
    if (!sound) { silent++; continue; }
    const meta = {}, bin = {};
    for (const k of Object.keys(t)) {
      const v = t[k]; if (k === 'blob' || k === 'buf' || BAD_KEY(k)) continue;
      if (v instanceof Blob) { bin[k] = { as: 'blob', mime: v.type || '' }; blobs.push([bin[k], v]); }
      else if (v instanceof ArrayBuffer) { bin[k] = { as: 'buffer', mime: '' }; blobs.push([bin[k], new Blob([v])]); }
      else if (ArrayBuffer.isView(v) && TYPED[v.constructor.name]) { bin[k] = { as: v.constructor.name, mime: '' }; blobs.push([bin[k], new Blob([v])]); }
      else { const p = plain(v); if (p !== undefined) meta[k] = p; }
    }
    bin.blob = { as: 'blob', mime: sound.type || '' }; blobs.push([bin.blob, sound]);
    lib.tracks.push({ meta, bin });
    if (isSong(t)) counts.songs++; if (t.lyrics) counts.lyrics++;
  }
  const fav = lists.find(l => l && l.id === '__fav'), favourites = fav && Array.isArray(fav.ids) ? fav.ids.filter(x => typeof x === 'string') : [];
  const playlists = lists.filter(l => l && l.id !== '__fav').map(l => ({ id: typeof l.id === 'string' ? l.id : '', name: typeof l.name === 'string' ? l.name : 'Playlist', ids: Array.isArray(l.ids) ? l.ids.filter(x => typeof x === 'string') : [], created: typeof l.created === 'number' ? l.created : 0 }));
  counts.playlists = playlists.length; counts.favourites = favourites.length;
  const marks = flags.filter(f => f && typeof f.id === 'string').map(f => ({ id: f.id, sensitive: !!f.sensitive, at: typeof f.at === 'number' && isFinite(f.at) ? f.at : 0 }));
  counts.marks = marks.filter(m => m.sensitive).length;
  const keys = {}; for (const kv of localAll().own) { keys[kv.name] = kv.value; if (isMix(kv.name)) counts.mixes++; else if (GROUP(kv.name) !== 'studio') counts.settings++; }
  /* the words first, the sound after: the order the header lists is the order in the file */
  const libAt = json('library', null); json('lists', { playlists, favourites }); json('marks', { marks }); json('local', { keys });
  for (const t of trs) { const p = plain(t); if (p && typeof p.id === 'string') { json('transcript', p); counts.transcripts++; } }
  for (const [ref, blob] of blobs) ref.part = add('blob', 'binary', blob);
  parts[libAt].data = new Blob([JSON.stringify(lib)], { type: 'application/json' });
  return { parts, counts, silent };
}
function prefixOf(parts, counts, payloadBytes, madeAt) {
  const header = { format: FORMAT, version: VERSION, madeAt, chunk: CHUNK, payloadBytes, counts, parts: parts.map(p => ({ name: p.name, kind: p.kind, offset: p.offset, bytes: p.data.size, check: p.check })) };
  return new TextEncoder().encode(JSON.stringify(header));
}
async function sealed(hb) { const len = new Uint8Array(4); new DataView(len.buffer).setUint32(0, hb.length); return join([new TextEncoder().encode(MAGIC), len, hb, await sha(hb)]); }
/* Writes the backup. With `writable` (a file the person chose) it goes straight to disk a piece at a time; without, the
   result is a Blob made of pointers to the stored sound, which the browser copies out when it is downloaded.
   Either way no more than one 4 MiB piece of sound is in memory at once. */
export async function writeBackup(writable, onProgress) {
  const { parts, counts, silent } = await collect(), madeAt = new Date().toISOString();
  let off = 0; for (const p of parts) { p.offset = off; off += p.data.size; p.check = '0'.repeat(64); }
  const total = off, blank = prefixOf(parts, counts, total, madeAt), prefixLen = PREFIX_FIXED + blank.length;
  if (blank.length > MAX_HEADER) throw new Error('toolarge');
  let done = 0; const tick = n => { done += n; if (onProgress) onProgress(total ? done / total : 1); };
  if (writable) await writable.write(new Uint8Array(prefixLen)); /* room for the header, filled in at the end */
  for (const p of parts) p.check = await checkOf(p.data, async buf => { if (writable) await writable.write(buf); tick(buf.byteLength); });
  const hb = prefixOf(parts, counts, total, madeAt); if (hb.length !== blank.length) throw new Error('header moved');
  const prefix = await sealed(hb);
  if (writable) { await writable.write({ type: 'write', position: 0, data: prefix }); await writable.close(); return { counts, silent, bytes: prefixLen + total, blob: null }; }
  return { counts, silent, bytes: prefixLen + total, blob: new Blob([prefix, ...parts.map(p => p.data)], { type: 'application/octet-stream' }) };
}

/* ---------- reading a backup: everything is checked before anything is written ---------- */
export class BackupError extends Error { constructor(kind) { super(MESSAGES[kind] || MESSAGES.damaged); this.kind = kind; } }
const MESSAGES = {
  not: 'That file is not a Mixtape backup, so nothing was restored. Choose the file whose name ends in “.mixtape-backup”.',
  short: 'That backup file is cut short: the copy or download did not finish, so part of it is missing. Nothing was restored. Copy the file again from where you keep it, then choose it once more.',
  newer: 'That backup was made by a newer Mixtape than this one, so nothing was restored. Open Mixtape while online so it can update, then restore again.',
  damaged: 'That backup file is damaged, or was changed after it was made, so nothing was restored. If you have another copy of the backup, use that one.',
  secure: 'Backups can only be made and checked when Mixtape is opened from its secure address (one that begins with https). Nothing was changed.',
};
const whole = n => Number.isInteger(n) && n >= 0 && n <= Number.MAX_SAFE_INTEGER;
const isObj = v => v !== null && typeof v === 'object' && !Array.isArray(v);
const bad = () => { throw new BackupError('damaged'); };
const txt = (v, max = 500) => (typeof v === 'string' ? v : v == null || typeof v === 'object' ? '' : String(v)).slice(0, max);
const numOf = v => (typeof v === 'number' && isFinite(v) && v >= 0 ? v : 0);
/* An id from a file is used only if it is short and made of plain characters; any other gets a fresh one here. */
const goodId = v => typeof v === 'string' && /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/.test(v);
const FIELD = /^[A-Za-z][A-Za-z0-9_]{0,40}$/;
function cleanLyrics(ly) {
  if (!isObj(ly) || !Array.isArray(ly.lines)) return null;
  const lines = ly.lines.filter(l => isObj(l) && typeof l.text === 'string').map(l => ({ ...l, text: l.text.slice(0, 2000), t: typeof l.t === 'number' && isFinite(l.t) && l.t >= 0 ? l.t : null }));
  return lines.length ? { ...ly, lines, source: txt(ly.source, 20) || 'text', updated: numOf(ly.updated) || Date.now() } : null;
}
async function readHeader(file) {
  if (!file || typeof file.size !== 'number') throw new BackupError('not');
  const ml = MAGIC.length;
  if (file.size < ml) throw new BackupError('not');
  const magic = new Uint8Array(await file.slice(0, ml).arrayBuffer()); for (let i = 0; i < ml; i++) if (magic[i] !== MAGIC.charCodeAt(i)) throw new BackupError('not');
  if (file.size < ml + 4) throw new BackupError('short');
  const hl = new DataView(await file.slice(ml, ml + 4).arrayBuffer()).getUint32(0), base = PREFIX_FIXED + hl;
  if (hl < 2 || hl > MAX_HEADER) bad();
  if (base > file.size) throw new BackupError('short');
  const hb = new Uint8Array(await file.slice(ml + 4, ml + 4 + hl).arrayBuffer()), seal = new Uint8Array(await file.slice(ml + 4 + hl, base).arrayBuffer());
  if (hb.length !== hl || seal.length !== 32) throw new BackupError('short');
  const real = await sha(hb); for (let i = 0; i < 32; i++) if (real[i] !== seal[i]) bad();
  let h; try { h = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(hb)); } catch (e) { bad(); }
  if (!isObj(h) || h.format !== FORMAT) bad();
  if (!Number.isInteger(h.version) || h.version < 1) bad();
  if (h.version > VERSION) throw new BackupError('newer');
  if (h.chunk !== CHUNK || !whole(h.payloadBytes) || !Array.isArray(h.parts) || h.parts.length > 5e6 || typeof h.madeAt !== 'string' || h.madeAt.length > 40 || isNaN(Date.parse(h.madeAt))) bad();
  if (!isObj(h.counts)) bad(); for (const k of ['songs', 'playlists', 'favourites', 'lyrics', 'transcripts', 'marks', 'mixes', 'settings']) if (!whole(h.counts[k])) bad();
  let at = 0; const names = { library: 0, lists: 0, marks: 0, local: 0 };
  for (const p of h.parts) {
    if (!isObj(p) || !whole(p.offset) || !whole(p.bytes) || typeof p.check !== 'string' || !/^[0-9a-f]{64}$/.test(p.check)) bad();
    if (p.kind === 'json') { if (p.name === 'transcript') { /* any number of these */ } else if (Object.prototype.hasOwnProperty.call(names, p.name)) names[p.name]++; else bad(); if (p.bytes > 1073741824) bad(); }
    else if (p.kind === 'binary') { if (p.name !== 'blob') bad(); } else bad();
    if (p.offset !== at) bad(); at += p.bytes; if (!whole(at)) bad();
  }
  if (at !== h.payloadBytes) bad(); for (const k in names) if (names[k] !== 1) bad();
  if (base + h.payloadBytes > file.size) throw new BackupError('short');
  if (base + h.payloadBytes < file.size) bad();
  return { h, base };
}
/* Checks the whole file and reads its words. Gives { header, base, tracks, lists, marks, keys, transcripts } where
   transcripts is a list of part numbers (each is read again, one at a time, when it is restored). */
export async function readBackup(file, onProgress) {
  if (!crypto.subtle) throw new BackupError('secure');
  const { h, base } = await readHeader(file), part = p => file.slice(base + p.offset, base + p.offset + p.bytes);
  let done = 0;
  for (const p of h.parts) {
    let check; try { check = await checkOf(part(p), buf => { done += buf.byteLength; if (onProgress) onProgress(h.payloadBytes ? done / h.payloadBytes : 1); }); } catch (e) { throw new BackupError(e instanceof BackupError ? e.kind : 'short'); }
    if (check !== p.check) bad();
  }
  const jsonOf = async i => { try { return JSON.parse(await part(h.parts[i]).text()); } catch (e) { bad(); } };
  const find = name => h.parts.findIndex(p => p.name === name);
  /* the library: every field typed, every pointer to a part in range, and no part used twice */
  const lib = await jsonOf(find('library')); if (!isObj(lib) || !Array.isArray(lib.tracks)) bad();
  const used = new Set(), tracks = [];
  for (const t of lib.tracks) {
    if (!isObj(t) || !isObj(t.meta) || !isObj(t.bin) || !isObj(t.bin.blob) || t.bin.blob.as !== 'blob') bad();
    const bin = {};
    for (const k of Object.keys(t.bin)) {
      const b = t.bin[k];
      if (!FIELD.test(k) || BAD_KEY(k) || k === 'id' || k === 'buf' || !isObj(b) || !whole(b.part) || b.part >= h.parts.length || h.parts[b.part].kind !== 'binary' || used.has(b.part)) bad();
      if (b.as !== 'blob' && b.as !== 'buffer' && !Object.prototype.hasOwnProperty.call(TYPED, b.as)) bad();
      if (TYPED[b.as] && h.parts[b.part].bytes % TYPED[b.as].BYTES_PER_ELEMENT) bad();
      if (b.mime != null && typeof b.mime !== 'string') bad();
      used.add(b.part); bin[k] = { part: b.part, as: b.as, mime: txt(b.mime, 100) };
    }
    if (!h.parts[bin.blob.part].bytes) bad(); /* a song with no sound is not a song */
    const m = plain(t.meta); if (!isObj(m)) bad();
    for (const k of Object.keys(m)) if (!FIELD.test(k) || Object.prototype.hasOwnProperty.call(bin, k)) delete m[k];
    const name = txt(m.name), ly = cleanLyrics(m.lyrics);
    const meta = { ...m, name, size: numOf(m.size), type: txt(m.type, 100), title: txt(m.title) || name.replace(/\.[^.]+$/, '') || 'Untitled', artist: txt(m.artist), album: txt(m.album), track: Math.floor(numOf(m.track)), duration: numOf(m.duration), added: numOf(m.added) || Date.now() };
    delete meta.lyrics; if (ly) meta.lyrics = ly;
    delete meta.kind; if (m.kind === 'video') meta.kind = 'video';
    delete meta.stemName; if (typeof m.stemName === 'string' && m.stemName) meta.stemName = txt(m.stemName, 40);
    delete meta.stemOf; delete meta.id;
    tracks.push({ fileId: typeof m.id === 'string' ? m.id : '', stemOf: typeof m.stemOf === 'string' ? m.stemOf : '', meta, bin });
  }
  for (let i = 0; i < h.parts.length; i++) if (h.parts[i].kind === 'binary' && !used.has(i)) bad();
  const ids = arr => { if (!Array.isArray(arr)) bad(); for (const x of arr) if (typeof x !== 'string' || x.length > 300) bad(); return arr; };
  const li = await jsonOf(find('lists')); if (!isObj(li) || !Array.isArray(li.playlists)) bad();
  const lists = { favourites: ids(li.favourites), playlists: li.playlists.map(p => { if (!isObj(p)) bad(); return { id: typeof p.id === 'string' ? p.id : '', name: txt(p.name, 200) || 'Playlist', ids: ids(p.ids), created: numOf(p.created) || Date.now() }; }) };
  const mk = await jsonOf(find('marks')); if (!isObj(mk) || !Array.isArray(mk.marks)) bad();
  const marks = mk.marks.map(f => { if (!isObj(f) || typeof f.id !== 'string' || f.id.length > 300 || typeof f.sensitive !== 'boolean') bad(); return { id: f.id, sensitive: f.sensitive, at: numOf(f.at) || Date.now() }; });
  const lo = await jsonOf(find('local')); if (!isObj(lo) || !isObj(lo.keys)) bad();
  const keys = new Map();
  for (const k of Object.keys(lo.keys)) {
    const v = lo.keys[k]; if (BAD_KEY(k) || k.length > 400 || !OWN_KEY.test(k) || typeof v !== 'string' || v.length > 2e7) bad();
    if (/^mixtape-studio-project(s$|:|-v1$)/.test(k)) { let j; try { j = JSON.parse(v); } catch (e) { bad(); } if (k === 'mixtape-studio-projects' ? !Array.isArray(j) : !isObj(j)) bad(); }
    keys.set(k, v);
  }
  const transcripts = [];
  for (let i = 0; i < h.parts.length; i++) if (h.parts[i].name === 'transcript') { const t = cleanTranscript(await jsonOf(i)); if (!t) bad(); transcripts.push(i); }
  return { header: h, base, tracks, lists, marks, keys, transcripts, file };
}
function cleanTranscript(raw) {
  const t = plain(raw); if (!isObj(t) || typeof t.id !== 'string' || !t.id || t.id.length > 300) return null;
  if (t.words != null) { if (!Array.isArray(t.words)) return null; for (const w of t.words) if (!isObj(w) || (w.t != null && typeof w.t !== 'string')) return null; }
  return t;
}
/* every text that is exactly an old id becomes the new one, object names included (some settings are filed by song) */
function remap(v, map, depth = 0) {
  if (typeof v === 'string') return map.has(v) ? map.get(v) : v;
  if (v === null || typeof v !== 'object' || depth > 60) return v;
  if (Array.isArray(v)) return v.map(x => remap(x, map, depth + 1));
  const out = {}; for (const k of Object.keys(v)) { if (BAD_KEY(k)) continue; out[map.has(k) ? map.get(k) : k] = remap(v[k], map, depth + 1); }
  return out;
}

/* Restores a checked backup by adding to what is here. Nothing already on the device is replaced or removed.
   Gives a report of exactly what was added and what was left alone. */
export async function restore(file, onProgress) {
  const say = (stage, frac) => { if (onProgress) onProgress(stage, frac); };
  const b = await readBackup(file, f => say('check', f)), h = b.header;
  const partBlob = (i, mime) => { const p = h.parts[i]; return file.slice(b.base + p.offset, b.base + p.offset + p.bytes, mime || ''); };
  const R = { madeAt: h.madeAt, songs: { added: 0, had: 0, failed: 0 }, playlists: { added: 0, joined: 0, same: 0 }, favourites: { added: 0, had: 0 }, lyrics: { added: 0 },
    transcripts: { added: 0, had: 0, failed: 0 }, marks: { added: 0, had: 0 }, mixes: { added: 0, had: 0 }, settings: { added: 0, had: 0 }, listsFailed: false, full: false };

  /* songs: one already here (the same id, or the same file name and size) is left as it is */
  const lib = await openMake(DB.lib, 1, ['tracks', 'lists']);
  const idMap = new Map(), moved = new Map(); let present;
  try {
    const here = await readAll(lib, 'tracks'), haveId = new Set(here.map(t => t.id)), haveKey = new Map(here.map(t => [t.name + '|' + t.size, t.id]));
    const todo = [];
    for (const t of b.tracks) {
      const key = t.meta.name + '|' + t.meta.size;
      if (t.fileId && haveId.has(t.fileId)) { idMap.set(t.fileId, t.fileId); R.songs.had++; continue; }
      if (haveKey.has(key)) { if (t.fileId) { idMap.set(t.fileId, haveKey.get(key)); if (haveKey.get(key) !== t.fileId) moved.set(t.fileId, haveKey.get(key)); } R.songs.had++; continue; }
      const id = goodId(t.fileId) ? t.fileId : uid();
      if (t.fileId) { idMap.set(t.fileId, id); if (id !== t.fileId) moved.set(t.fileId, id); }
      haveId.add(id); haveKey.set(key, id); todo.push({ t, id });
    }
    const totalBytes = todo.reduce((n, x) => n + h.parts[x.t.bin.blob.part].bytes, 0) || 1; let doneBytes = 0;
    for (const { t, id } of todo) {
      const rec = { ...t.meta, id }; let ok = true;
      if (t.stemOf) { const parent = idMap.get(t.stemOf) || (goodId(t.stemOf) ? t.stemOf : ''); if (parent) rec.stemOf = parent; }
      for (const k of Object.keys(t.bin)) {
        const ref = t.bin[k], p = h.parts[ref.part];
        /* copied out of the file, so the song stays after the backup file is moved or deleted */
        const buf = p.bytes <= 536870912 ? await partBlob(ref.part).arrayBuffer() : null;
        if (buf && buf.byteLength !== p.bytes) { ok = false; break; }
        rec[k] = ref.as === 'blob' ? (buf ? new Blob([buf], { type: ref.mime }) : partBlob(ref.part, ref.mime)) : ref.as === 'buffer' ? buf : new TYPED[ref.as](buf);
        if (rec[k] == null) { ok = false; break; }
      }
      if (!('art' in rec)) rec.art = null;
      if (ok) { try { const tx = lib.transaction('tracks', 'readwrite'), done = txDone(tx); tx.objectStore('tracks').add(rec); await done; } catch (e) { ok = false; if (e && e.name === 'QuotaExceededError') R.full = true; } }
      if (ok) { R.songs.added++; if (rec.lyrics) R.lyrics.added++; } else { R.songs.failed++; idMap.delete(t.fileId); }
      doneBytes += h.parts[t.bin.blob.part].bytes; say('songs', doneBytes / totalBytes);
    }
    present = new Set(await reqDone(lib.transaction('tracks', 'readonly').objectStore('tracks').getAllKeys()));
    /* playlists join up by name; favourites are added to the ones here. One transaction, so it is all or nothing. */
    const to = id => { const n = idMap.get(id); return n && present.has(n) ? n : null; };
    try {
      const tx = lib.transaction('lists', 'readwrite'), o = tx.objectStore('lists'), done = txDone(tx), all = await reqDone(o.getAll());
      for (const pl of b.lists.playlists) {
        const want = [...new Set(pl.ids.map(to).filter(Boolean))]; let l = all.find(x => x && x.id !== '__fav' && x.name === pl.name);
        if (!l) { l = { id: goodId(pl.id) && !all.some(x => x && x.id === pl.id) ? pl.id : uid(), name: pl.name, ids: want, created: pl.created }; all.push(l); o.put(l); R.playlists.added++; continue; }
        if (!Array.isArray(l.ids)) l.ids = [];
        const extra = want.filter(id => !l.ids.includes(id));
        if (extra.length) { l.ids.push(...extra); o.put(l); R.playlists.joined++; } else R.playlists.same++;
      }
      const fav = all.find(x => x && x.id === '__fav') || { id: '__fav', ids: [] }, set = new Set(Array.isArray(fav.ids) ? fav.ids : []);
      for (const id of new Set(b.lists.favourites.map(to).filter(Boolean))) { if (set.has(id)) R.favourites.had++; else { set.add(id); R.favourites.added++; } }
      if (R.favourites.added) o.put({ id: '__fav', ids: [...set] });
      await done;
    } catch (e) { R.listsFailed = true; R.playlists = { added: 0, joined: 0, same: 0 }; R.favourites = { added: 0, had: 0 }; }
  } finally { lib.close(); }

  /* transcripts and sensitive marks */
  const mapId = id => idMap.get(id) || (goodId(id) ? id : null);
  if (b.transcripts.length || b.marks.length) {
    const d = await openMake(DB.tr, 2, ['transcripts', 'flags']);
    try {
      const have = new Set(await reqDone(d.transaction('transcripts', 'readonly').objectStore('transcripts').getAllKeys()));
      for (const [n, i] of b.transcripts.entries()) {
        let t = null; try { t = cleanTranscript(JSON.parse(await partBlob(i).text())); } catch (e) {}
        const id = t && mapId(t.id);
        if (!id) { R.transcripts.failed++; continue; }
        if (have.has(id)) { R.transcripts.had++; continue; }
        t.id = id;
        try { const tx = d.transaction('transcripts', 'readwrite'), done = txDone(tx); tx.objectStore('transcripts').add(t); await done; have.add(id); R.transcripts.added++; } catch (e) { R.transcripts.failed++; }
        say('transcripts', (n + 1) / b.transcripts.length);
      }
      /* a mark is a protection: one in the backup is put back even if the device now says "not sensitive" */
      const tx = d.transaction('flags', 'readwrite'), o = tx.objectStore('flags'), done = txDone(tx), cur = new Map((await reqDone(o.getAll())).map(f => [f.id, f]));
      for (const m of b.marks) {
        const id = mapId(m.id); if (!id) continue; const c = cur.get(id);
        if (!c) { o.put({ id, sensitive: m.sensitive, at: m.at }); cur.set(id, m); if (m.sensitive) R.marks.added++; }
        else if (m.sensitive && !c.sensitive) { o.put({ id, sensitive: true, at: m.at }); R.marks.added++; }
        else if (m.sensitive) R.marks.had++;
      }
      await done;
    } finally { d.close(); }
  }

  /* Studio mixes and settings: only what is not here yet. A mix is its own entry plus a line in the Studio's list. */
  const fix = v => { if (!moved.size) return v; try { const j = JSON.parse(v); return j !== null && typeof j === 'object' ? JSON.stringify(remap(j, moved)) : v; } catch (e) { return v; } };
  let index = []; try { const j = JSON.parse(localGet('mixtape-studio-projects')); if (Array.isArray(j)) index = j.filter(isObj); } catch (e) {}
  const hadIndex = localGet('mixtape-studio-projects') != null, fileIndex = new Map();
  try { for (const x of JSON.parse(b.keys.get('mixtape-studio-projects') || '[]')) if (isObj(x) && typeof x.id === 'string') fileIndex.set(x.id, x); } catch (e) {}
  let indexChanged = false;
  for (const [k, v] of b.keys) {
    if (k === 'mixtape-studio-projects') continue;
    if (k.startsWith('mixtape-studio-project:')) {
      const fid = k.slice(23), id = goodId(fid) ? fid : uid();
      if (localGet('mixtape-studio-project:' + id) != null) { R.mixes.had++; continue; }
      if (!localSet('mixtape-studio-project:' + id, fix(v))) { R.full = true; continue; }
      let name = ''; try { name = txt(JSON.parse(v).name, 200); } catch (e) {}
      const meta = fileIndex.get(fid) || {};
      if (!index.some(x => x.id === id)) { index.push({ id, name: txt(meta.name, 200) || name || 'My mix', updated: numOf(meta.updated) || Date.now() }); indexChanged = true; }
      R.mixes.added++; continue;
    }
    if (k === 'mixtape-studio-project-v1') { /* a mix from before the Studio kept several: only read when there is no list */
      if (hadIndex || localGet(k) != null) { R.mixes.had++; continue; }
      if (localSet(k, fix(v))) R.mixes.added++; else R.full = true; continue;
    }
    let name = k; if (k.startsWith('mixtape-longpeaks:') && moved.has(k.slice(18))) name = 'mixtape-longpeaks:' + moved.get(k.slice(18));
    const group = GROUP(name), count = group === 'studio' ? null : R.settings;
    if (localGet(name) != null) { if (count) count.had++; continue; }
    if (name === 'mixtape-studio-current' && !goodId(v)) continue;
    if (localSet(name, fix(v))) { if (count) count.added++; } else R.full = true;
  }
  if (indexChanged && !localSet('mixtape-studio-projects', JSON.stringify(index))) R.full = true;
  tell();
  return R;
}
