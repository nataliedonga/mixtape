/* Removing a recording from the Transcripts list. Each row gets a small ✕ (shown when the row is pointed at or
   focused). It asks first, naming the recording and its length (two recordings can share a name), and then removes,
   together: the recording from Mixtape's library, its transcript and notes, and its "sensitive" mark. The original
   file on the computer is never touched: only Mixtape's own copy goes. A leftover mention in a playlist is harmless
   (the Player skips songs that are gone). */
const $ = s => document.querySelector(s);
const open = name => new Promise((res, rej) => { const r = indexedDB.open(name); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
const run = (db, stores, fn) => new Promise((res, rej) => { const have = stores.filter(s => db.objectStoreNames.contains(s)); if (!have.length) return res(); const t = db.transaction(have, 'readwrite'); fn(t, have); t.oncomplete = () => res(); t.onerror = t.onabort = () => rej(t.error); });
const short = t => { t = Math.floor(t || 0); const h = Math.floor(t / 3600), m = Math.floor(t / 60) % 60, s = t % 60; return (h ? h + ':' + String(m).padStart(2, '0') : m) + ':' + String(s).padStart(2, '0'); };

export function initRemove(api) {
  const list = $('#libL'); if (!list) return;
  const link = document.createElement('link'); link.rel = 'stylesheet'; link.href = 'remove.css'; document.head.appendChild(link);
  // the ✕ is added to each row whenever the list is redrawn
  const dress = () => { for (const li of list.querySelectorAll('li[data-id]')) if (!li.querySelector('.rm')) { const b = document.createElement('button'); b.type = 'button'; b.className = 'rm'; b.textContent = '✕'; const name = (li.querySelector('.n') || li).textContent.trim(); b.title = 'Remove this recording from Mixtape (the file on your computer is not touched)'; b.setAttribute('aria-label', `Remove “${name}” from Mixtape`); li.appendChild(b); } };
  new MutationObserver(dress).observe(list, { childList: true }); dress();
  // before the list's own click (which opens the recording)
  list.addEventListener('click', e => { const b = e.target.closest('.rm'); if (!b) return; e.stopPropagation(); e.preventDefault(); remove(b.closest('li[data-id]').dataset.id); }, true);
  list.addEventListener('keydown', e => { if (e.target.closest && e.target.closest('.rm') && (e.key === 'Enter' || e.key === ' ')) e.stopPropagation(); }, true);

  async function remove(id) {
    const cur = api.cur, isCur = !!cur && cur.track.id === id;
    if (api.job && isCur) return api.toast('Pause the transcript that is being written first, then remove the recording.', 6000);
    let pdb, tdb;
    try {
      pdb = await open('mixtape-player');
      const t = await new Promise((res, rej) => { const q = pdb.transaction('tracks').objectStore('tracks').get(id); q.onsuccess = () => res(q.result); q.onerror = () => rej(q.error); });
      if (!t) { api.toast('That recording is already gone.'); return api.reload(); }
      const has = await new Promise(res => open('mixtape-transcripts').then(d => { tdb = d; if (!d.objectStoreNames.contains('transcripts')) return res(null); const q = d.transaction('transcripts').objectStore('transcripts').get(id); q.onsuccess = () => res(q.result || null); q.onerror = () => res(null); }, () => res(null)));
      const words = has && Array.isArray(has.words) ? has.words.length : 0, notes = has && Array.isArray(has.notes) ? has.notes.length : 0;
      const what = `Remove “${t.title || t.name}”${t.duration ? ` (${short(t.duration)} long)` : ''} from Mixtape?\n\n`
        + (words ? `Its transcript (${words.toLocaleString()} words${notes ? `, ${notes} note${notes === 1 ? '' : 's'}` : ''}) is removed with it. Save the transcript as a file first if you want to keep it.\n\n` : '')
        + 'The original file on your computer is not touched. This cannot be undone.';
      if (!confirm(what)) return;
      if (isCur && cur.media) { try { cur.media.pause(); } catch (e) {} }
      // the recording and anything split from it; then its transcript and its mark
      const stems = await new Promise(res => { const q = pdb.transaction('tracks').objectStore('tracks').getAll(); q.onsuccess = () => res((q.result || []).filter(x => x.stemOf === id).map(x => x.id)); q.onerror = () => res([]); });
      await run(pdb, ['tracks'], tx => { const s = tx.objectStore('tracks'); s.delete(id); for (const k of stems) s.delete(k); });
      if (tdb) await run(tdb, ['transcripts', 'flags'], (tx, have) => { for (const st of have) tx.objectStore(st).delete(id); });
      try { const c = new BroadcastChannel('mixtape'); c.postMessage({ type: 'forgot' }); setTimeout(() => c.close(), 500); } catch (e) {} // an open Player drops it too
      if (isCur) { const u = new URL(location.href); u.searchParams.delete('song'); location.href = u.pathname + (u.searchParams.toString() ? '?' + u.searchParams : ''); return; } // what was open is gone: start clean
      await api.reload(); api.toast(`Removed “${t.title || t.name}”.`, 4000);
    } catch (e) { api.toast('That recording could not be removed (the browser’s storage refused). Reload the page and try again.', 7000); console.error(e); }
    finally { try { if (pdb) pdb.close(); } catch (e) {} try { if (tdb) tdb.close(); } catch (e) {} }
  }
  if (['localhost', '127.0.0.1'].includes(location.hostname)) window.__remove = remove;
}
