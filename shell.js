/* Mixtape shell: four things every tool shares, in one small file (with shell.css).
     1. "Mixtape was updated" notice, when a new version takes over while the page is open. Never reloads by itself.
     2. A last-resort net for errors nobody caught: one calm message through the tool's own toast, details on request.
     3. "?" opens the tool's keys sheet. Tools with a sheet of their own keep it; the others get one from here.
     4. A short first-run welcome that points at the real controls.
   Nothing here talks to any server: the only fetch is this app's own changes.json. Everything is best-effort, so a
   failure in here must never break the tool it sits in.

   A tool hooks up with one call (all fields optional):
     MixtapeShell.init({
       tool: 'player',                      which welcome to show, and the name of its "seen" flag
       toast: (message, ms) => …,           the tool's own toast, so messages look and sound like the tool
       busy: () => boolean,                 true while work is in progress (the update notice then says "when you have finished")
       keys: { title, rows }                a sheet drawn here; rows are [keys, what it does], or ['Heading']
          or { open, host, match, close }   the tool's own sheet: open() shows it; it is on screen when the element
                                            `host` is not hidden and holds `match`; close() shuts it (default: hide host)
       welcomeSeen: boolean,                the tool already showed a welcome of its own on this device
     });
   The single pieces also work by themselves: MixtapeShell.toast = fn, MixtapeShell.busy = fn, MixtapeShell.keys(title, rows). */
(function () {
  'use strict';
  if (window.MixtapeShell) return;
  const ROOT = new URL('.', (document.currentScript && document.currentScript.src) || location.href); // where Mixtape lives (it is published under a sub-path)
  const S = { tool: '', toast: null, busy: null, keys: null, welcome: null };
  const ls = { get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }, set(k, v) { try { localStorage.setItem(k, v); } catch (e) {} } };
  const mk = (tag, cls, text) => { const n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; };
  const button = (label, cls, fn) => { const b = mk('button', cls, label); b.type = 'button'; b.addEventListener('click', fn); return b; };
  const onScreen = n => !!(n && n.isConnected && n.getClientRects().length && getComputedStyle(n).visibility !== 'hidden');
  const NAMES = { player: 'the Player', studio: 'the Studio', cutter: 'the Cutter', transcripts: 'Transcripts', reader: 'the Reader' };

  /* ---------- what is in the way ---------- */
  // Dialogs, sheets and menus of the tools. "?" and the welcome stay out of their way.
  const DIALOGS = 'dialog[open], [aria-modal="true"], [role="dialog"], #modal, #sheet, #menu, .menu, #busy, .trimwrap, .lyrwrap';
  function blocked(forWelcome) {
    const mine = n => n.closest('.mxs');
    for (const n of document.querySelectorAll(DIALOGS + (forWelcome ? ', #now, #dropveil, #veil, #drop' : ''))) if (!mine(n) && onScreen(n)) return true;
    return !!modal;
  }
  const typingIn = e => {
    const t = (e.composedPath && e.composedPath()[0]) || e.target; if (!t || !t.closest) return false;
    const f = t.closest('input, textarea, select, [contenteditable=""], [contenteditable="true"], [contenteditable="plaintext-only"]');
    return !!f && !(f.tagName === 'INPUT' && /^(range|checkbox|radio|button|submit|file|color)$/.test(f.type));
  };

  /* ---------- keeping the focus inside an open sheet ---------- */
  const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';
  const focusables = box => [...box.querySelectorAll(FOCUSABLE)].filter(onScreen);
  /* Tab stays inside `box` until release() is called; release puts the focus back where it was.
     own: the sheet is one of ours, so Esc closes it and no key reaches the tool's shortcuts underneath.
     Otherwise (a tool's own sheet) only Tab is taken; Esc is the tool's, with onEsc as the fallback. */
  function trap(box, { own = false, onEsc = null, back = document.activeElement } = {}) {
    const key = e => {
      if (!box.isConnected) return;
      if (e.key === 'Tab' && !e.ctrlKey && !e.altKey && !e.metaKey) {
        const f = focusables(box), at = f.indexOf(document.activeElement); e.stopPropagation();
        if (!f.length) return e.preventDefault();
        if (e.shiftKey ? at <= 0 : at === f.length - 1 || at < 0) { e.preventDefault(); f[e.shiftKey ? f.length - 1 : 0].focus(); }
        return;
      }
      if (e.key === 'Escape') { if (own) { e.preventDefault(); e.stopPropagation(); } if (onEsc) onEsc(); return; }
      if (own) e.stopPropagation();
    };
    window.addEventListener('keydown', key, true);
    setTimeout(() => { if (box.isConnected && !box.contains(document.activeElement)) { const f = focusables(box), first = box.querySelector('[data-mxs-first]') || f.find(n => /\bprimary\b/.test(n.className)) || f[0]; if (first) first.focus(); } }, 40);
    return () => { window.removeEventListener('keydown', key, true); if (back && back !== document.body && onScreen(back)) { try { back.focus({ preventScroll: true }); } catch (e) {} } };
  }

  /* ---------- our own sheet (keys, what changed, details) ---------- */
  let modal = null, modalN = 0;
  function closeModal() { if (!modal) return; const m = modal; modal = null; m.wrap.remove(); m.release(); }
  function openModal(title, fill, { wide = false, back } = {}) {
    const from = back || (modal ? modal.back : document.activeElement); closeModal();
    const wrap = mk('div', 'mxs mxs-scrim'), box = mk('div', 'mxs-dialog' + (wide ? ' mxs-wide' : '')), h = mk('h2', 'mxs-title', title), body = mk('div', 'mxs-body'), acts = mk('div', 'mxs-acts');
    h.id = 'mxs-title-' + (++modalN); box.setAttribute('role', 'dialog'); box.setAttribute('aria-modal', 'true'); box.setAttribute('aria-labelledby', h.id);
    const close = button('Close', 'mxs-btn mxs-primary', closeModal); close.setAttribute('data-mxs-first', '');
    box.append(h, body, acts); wrap.append(box); fill(body, acts); acts.append(mk('span', 'mxs-sp'), close);
    wrap.addEventListener('pointerdown', e => { if (e.target === wrap) closeModal(); });
    document.body.append(wrap);
    modal = { wrap, back: from, release: trap(box, { own: true, onEsc: closeModal, back: from }) };
    return box;
  }

  /* ---------- 3. keys ---------- */
  // The two links every keys sheet ends with.
  function extras() {
    const row = mk('div', 'mxs mxs-extras');
    row.append(button('Show the welcome again', 'mxs-link', () => { const back = modal && modal.back; closeKeys(); setTimeout(() => welcome(true, back), 60); }),
      button('What changed lately', 'mxs-link', () => showChanges(false)));
    return row;
  }
  function openKeys() {
    const k = S.keys; if (!k) return;
    if (k.open) return k.open();
    openModal(k.title || 'Keys', body => {
      const list = mk('div', 'mxs-keys');
      for (const r of k.rows || []) {
        if (r.length < 2) { list.append(mk('h3', 'mxs-khead', r[0])); continue; }
        const keys = mk('span', 'mxs-kcell'); (Array.isArray(r[0]) ? r[0] : [r[0]]).forEach((x, i) => { if (i) keys.append(' '); keys.append(mk('kbd', '', x)); });
        list.append(keys, mk('span', 'mxs-kwhat', r[1]));
      }
      body.append(list, extras());
    });
  }
  const adoptedOpen = () => { const k = S.keys; if (!k || !k.host) return null; const h = document.querySelector(k.host), m = h && !h.hidden && h.querySelector(k.match); return m && onScreen(m) ? m : null; };
  function closeKeys() {
    const k = S.keys; if (modal) return closeModal();
    if (!k || !k.host || !adoptedOpen()) return;
    if (k.close) k.close(); else { const h = document.querySelector(k.host); if (h) h.hidden = true; }
  }
  // A tool's own keys sheet: keep the focus in it while it is open, put it back afterwards, and add the two links.
  function adopt() {
    const k = S.keys, host = document.querySelector(k.host); if (!host) return;
    let release = null;
    const check = () => {
      const m = adoptedOpen();
      if (m && !release) {
        if (!host.querySelector('.mxs-extras')) m.after(extras());
        release = trap(host, { onEsc: () => setTimeout(() => { if (release && adoptedOpen()) closeKeys(); }, 0) });
      } else if (!m && release) { const r = release; release = null; r(); }
    };
    new MutationObserver(check).observe(host, { attributes: true, attributeFilter: ['hidden'], childList: true, subtree: true });
    check();
  }
  // "?" anywhere that is not a text box. A tool that opens its own sheet on "?" has already done so by the time this runs.
  window.addEventListener('keydown', e => {
    if (e.key !== '?' || e.ctrlKey || e.metaKey || e.altKey || !S.keys || typingIn(e)) return;
    if (adoptedOpen() || blocked(false)) return;
    e.preventDefault(); endTour('aside'); openKeys();
  });

  /* ---------- 2. errors nobody caught ---------- */
  const errors = []; let lastSaid = 0, held = 0;
  const NOISE = /ResizeObserver loop|^Script error\.?$|play\(\) request was interrupted|play\(\) failed because|The operation was aborted|The user aborted a request|signal is aborted|AbortError/i;
  const where = () => Math.max(16, ...[...document.querySelectorAll('body > footer, body > .hintbar, #bar, .exportbar, .pb')].filter(onScreen).map(n => { const r = n.getBoundingClientRect(); return r.bottom >= innerHeight - 2 ? innerHeight - r.top + 12 : 0; }));
  let ownToast = null, ownT = 0;
  function say(message, ms, actions) {
    let host = null;
    if (S.toast) { try { S.toast(message, ms); host = document.getElementById('toast'); if (host && (host.hidden || !host.textContent.includes(message.slice(0, 40)))) host = null; } catch (e) { host = null; } }
    if (!host) {
      if (S.toast && document.getElementById('toast') && !document.getElementById('toast').hidden) return; // said, but by a toast we cannot add buttons to
      if (!ownToast) { ownToast = mk('div', 'mxs mxs-toast'); ownToast.setAttribute('role', 'status'); }
      ownToast.textContent = message; ownToast.style.bottom = where() + 'px'; document.body.append(ownToast); host = ownToast;
      clearTimeout(ownT); ownT = setTimeout(() => ownToast.remove(), ms);
    }
    for (const a of actions) host.append(' ', a);
  }
  function note(err, kind) {
    const e = err && typeof err === 'object' ? err : { message: String(err) }, name = e.name || 'Error', msg = String(e.message || e.reason || err || '');
    if (e.name === 'AbortError' || NOISE.test(msg) || NOISE.test(name)) return;
    const full = /QuotaExceededError/i.test(name) || /quota|storage is full|not enough space/i.test(msg);
    errors.push({ at: new Date().toISOString(), kind, name, msg, stack: String(e.stack || '').split('\n').filter((l, i) => i || !l.includes(msg) || !msg).slice(0, 12).join('\n'), full }); if (errors.length > 20) errors.shift();
    const now = Date.now(); if (now - lastSaid < 8000) { held++; return; } // a burst is said once; the rest are under Details
    lastSaid = now; held = 0;
    const details = button('Details', 'mxs-toastbtn', showDetails);
    if (full) {
      const go = mk('a', 'mxs-toastbtn', 'Open Storage'); go.href = new URL('storage/', ROOT).href;
      say('This device is out of room for Mixtape, so that last change may not have been saved. Open the Storage page to see what is taking the space, free some, then try again.', 14000, [go, details]);
    } else say('Something went wrong and that last action may not have finished. Your files are still on this device. Try it again; if it keeps happening, reload the page.', 10000, [details]);
  }
  window.addEventListener('error', e => {
    if (!e.error && !e.filename) return; // "Script error." from another origin, or a file that failed to load: nothing we can say
    if (e.filename && !e.filename.startsWith(location.origin)) return; // an extension's script, not Mixtape's
    note(e.error || { name: 'Error', message: e.message, stack: `${e.filename}:${e.lineno}:${e.colno}` }, 'error');
  });
  window.addEventListener('unhandledrejection', e => note(e.reason, 'promise'));
  function detailsText() {
    return [`Mixtape, ${NAMES[S.tool] || S.tool || 'page'} (${location.pathname})`, navigator.userAgent, '',
      ...errors.slice().reverse().map(x => `${x.at}  ${x.kind}  ${x.name}: ${x.msg}${x.stack ? '\n' + x.stack : ''}`)].join('\n');
  }
  function showDetails() {
    openModal('What went wrong', (body, acts) => {
      const last = errors[errors.length - 1];
      body.append(mk('p', '', !last ? 'Nothing has gone wrong on this page since it was opened.' : last.full ? 'The browser said there is no room left on this device for Mixtape. Nothing already saved was removed.' : `Part of ${NAMES[S.tool] || 'this page'} stopped unexpectedly${errors.length > 1 ? ` (${errors.length} times since the page was opened)` : ''}. What was already saved is untouched.`));
      body.append(mk('p', 'mxs-quiet', 'The technical detail below stays on this device. Nothing was sent anywhere. If you ask someone for help, copy it and send it yourself.'));
      const pre = mk('pre', 'mxs-pre', detailsText()); pre.tabIndex = 0; pre.setAttribute('aria-label', 'Technical detail'); body.append(pre);
      const said = mk('span', 'mxs-quiet'); said.setAttribute('role', 'status');
      acts.append(button('Copy', 'mxs-btn', async () => {
        try { await navigator.clipboard.writeText(pre.textContent); said.textContent = 'Copied.'; }
        catch (e) { const r = document.createRange(); r.selectNodeContents(pre); const s = getSelection(); s.removeAllRanges(); s.addRange(r); said.textContent = 'Selected: press Ctrl+C to copy.'; }
      }), said);
    }, { wide: true });
  }

  /* ---------- 1. a new version took over ---------- */
  const vOf = k => { const m = /^mixtape-v(\d+)$/.exec(k); return m ? +m[1] : 0; };
  const newestCache = async () => { try { return (await caches.keys()).filter(vOf).sort((a, b) => vOf(b) - vOf(a))[0] || null; } catch (e) { return null; } };
  let loadedV = 0, bar = null, barT = 0, reloading = false, reg = null, putOff = null; // putOff: the waiting version "Later" was pressed for
  newestCache().then(k => { loadedV = k ? vOf(k) : 0; });
  // The list of changes: from the newest saved copy of the app (so it is the new version's list even before a reload,
  // and it works offline), else from the app's own folder.
  async function readChanges() {
    const url = new URL('changes.json', ROOT).href;
    try { const k = await newestCache(), hit = k && await (await caches.open(k)).match(url); if (hit) return await hit.json(); } catch (e) {}
    const r = await fetch(url, { cache: 'no-store' }); if (!r.ok) throw new Error('changes.json: ' + r.status); return r.json();
  }
  function showChanges(onlyNew) {
    openModal(onlyNew ? 'What changed' : 'What changed lately', body => {
      const wait = mk('p', 'mxs-quiet', 'Reading the list…'); body.append(wait);
      readChanges().then(all => {
        const list = (Array.isArray(all) ? all : []).filter(x => x && Array.isArray(x.items) && x.items.length);
        const fresh = onlyNew && loadedV ? list.filter(x => +x.version > loadedV) : [], use = fresh.length ? fresh.slice(0, 6) : list.slice(0, onlyNew ? 3 : 8);
        wait.remove(); if (!use.length) return body.append(mk('p', '', 'There is no list of changes for this version.'));
        for (const x of use) {
          const h = mk('h3', 'mxs-khead', `Version ${x.version}`); if (x.date) h.append(mk('span', 'mxs-date', ' · ' + x.date)); const ul = mk('ul', 'mxs-list');
          for (const it of x.items) ul.append(mk('li', '', String(it))); body.append(h, ul);
        }
      }).catch(() => { wait.textContent = 'The list of changes could not be read just now. Nothing else is affected.'; });
    });
  }
  const isBusy = () => { try { return !!(S.busy && S.busy()); } catch (e) { return false; } };
  function updateBar() {
    if (bar) return;
    bar = mk('div', 'mxs mxs-update'); bar.setAttribute('role', 'region'); bar.setAttribute('aria-label', 'Mixtape was updated');
    const text = mk('span', 'mxs-utext'); text.setAttribute('role', 'status');
    const set = () => { const t = `Mixtape was updated. ${isBusy() ? 'Reload when you have finished.' : 'Reload to use the new version.'}`; if (text.textContent !== t) text.textContent = t; bar.style.bottom = where() + 'px'; };
    const later = () => { clearInterval(barT); bar.remove(); bar = null; putOff = reg && reg.waiting; try { sessionStorage.setItem('mixtape-update-later', '1'); } catch (e) {} };
    const says = mk('span', 'mxs-usays'), btns = mk('span', 'mxs-ubtns');
    says.append(text, ' ', button('What changed', 'mxs-link', () => showChanges(true))); btns.append(button('Later', 'mxs-btn', later), button('Reload', 'mxs-btn mxs-primary', reload));
    bar.append(says, btns);
    document.body.append(bar); set(); barT = setInterval(set, 1500);
  }
  // Reload was pressed. A new version that is still waiting is told to take over first; the page reloads once it has.
  function reload() {
    try { sessionStorage.removeItem('mixtape-update-later'); } catch (e) {}
    const w = reg && reg.waiting; if (!w) return location.reload();
    reloading = true; try { w.postMessage({ type: 'SKIP_WAITING' }); } catch (e) {}
    setTimeout(() => location.reload(), 4000);
  }
  function watchUpdates() {
    const sw = navigator.serviceWorker; if (!sw || !/^https?:$/.test(location.protocol)) return;
    let had = !!sw.controller; // no controller yet: this is the first visit, and the first take-over is not an update
    sw.addEventListener('controllerchange', () => { if (reloading) return location.reload(); if (!had) { had = true; return; } updateBar(); });
    // A new version that is installed but waiting for this page (a service worker that does not take over by itself).
    // Checked from the state of things, not from one event, so no ordering of events can hide it.
    const waiting = () => { if (reg && reg.waiting && reg.waiting !== putOff && sw.controller) updateBar(); };
    const track = w => { if (w) w.addEventListener('statechange', () => setTimeout(waiting, 1200)); };
    const hook = r => {
      if (!r || reg) return; reg = r; track(r.installing); r.addEventListener('updatefound', () => track(r.installing));
      let later = false; try { later = sessionStorage.getItem('mixtape-update-later') === '1'; } catch (e) {}
      if (later) putOff = r.waiting; waiting();
    };
    sw.getRegistration().then(hook).catch(() => {}); sw.ready.then(hook).catch(() => {});
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') waiting(); });
  }
  try { watchUpdates(); } catch (e) {}

  /* ---------- 4. the first-run welcome ---------- */
  // Each step points at a real control. A control that is not on screen (hidden, or not there yet) has its step left out.
  const WELCOME = {
    player: [
      ['[data-act="add"]', 'Start here. Press Add songs and choose music files from this device. They are kept in this browser, on this device; nothing is uploaded.'],
      ['#bar .ctrls', 'Play, pause and skip from here, or press Space. Press the song title on the left of this bar for the full Now Playing view.'],
      ['[data-act="move"]', 'Move songs puts your whole library into one file, to carry to another phone or computer, or to keep as a copy.'],
      ['.adds a.btn', 'The other tools open from here: Studio mixes, Transcribe writes down what is said, Cutter trims, Reader opens PDFs. Press ? at any time to see the keys.', '.adds'],
    ],
    studio: [
      ['#lib', 'Your songs. Press ▶ to listen, then drag one onto a track, or press Add.'],
      ['#tl', 'The timeline. Turn the mouse wheel over a waveform to zoom in and out where the mouse is; Shift + wheel moves sideways. Drag a part’s name bar to move it; drag across its waveform to select a stretch.'],
      ['#playBtn', 'Space plays and pauses. Everything you do is saved as you go, and Ctrl + Z undoes it.'],
      ['[data-act="shortcuts"]', 'Every shortcut is listed here. Press ? at any time to open it.'],
    ],
    cutter: [
      ['#openBtn', 'Start here. Press Open files and choose a sound or video file, or drop one anywhere on the page. It stays on this computer.'],
      ['#tl', 'The timeline. Click to move the playhead; drag across it to mark a part you want to keep.'],
      ['#addPart', 'Or press N for a new part at the playhead, then I and O to set where it starts and ends. With no parts marked, the whole file is used.'],
      ['#exportBtn', 'Export writes the parts to your Downloads, or to a folder you choose. Press ? at any time to see the keys.'],
    ],
    transcripts: [
      ['#openBtn', 'Start here. Press Open a file… and choose a recording or a video from this computer. Nothing is uploaded.'],
      ['#libL', 'Or pick a recording from your Mixtape library in this list.'],
      ['#goHeard', 'Press Transcribe and Mixtape writes down what is said, here on this device. If you already have the text, paste it beside this and press Match it instead.'],
      ['#doc', 'The words appear here. Click any word to hear it from there. Tab plays and pauses, even while you are typing a correction. Press ? to see the keys.'],
    ],
    reader: [
      ['#openBtn', 'Start here. Press Open… and choose a document: a PDF, a Word file, an ebook or plain text. Or drop one anywhere on this page. It is opened on this computer and never uploaded.'],
      ['.auto', 'In a PDF you can highlight, add notes, fill in forms and sign. Save as I go puts every change into the file as you make it; untick it to save only when you press Save.'],
      ['#revertBtn', 'Changed your mind? Back to original puts the PDF back exactly as it was when you opened it here.'],
      ['#recentBtn', 'Documents you opened before are listed here. Press ? at any time to see the keys.'],
    ],
  };
  const FLAG = () => 'mixtape-welcome:' + S.tool;
  let tour = null;
  function endTour(why) { // 'done' | 'never' | 'skip' | 'aside' (something else needs the screen: nothing is remembered)
    if (!tour) return; const t = tour; tour = null;
    clearInterval(t.timer); window.removeEventListener('keydown', t.key, true); removeEventListener('resize', t.place); removeEventListener('scroll', t.place, true);
    t.card.remove(); t.ring.remove();
    if (why === 'done' || why === 'never') ls.set(FLAG(), 'done'); else if (why === 'skip') ls.set(FLAG(), ls.get(FLAG()) === 'skipped' ? 'done' : 'skipped'); // skipped twice is an answer
    if (t.back && t.back !== document.body && onScreen(t.back)) { try { t.back.focus({ preventScroll: true }); } catch (e) {} }
  }
  function welcome(force, back) {
    if (tour || !S.tool) return false;
    if (!force && ls.get(FLAG()) === 'done') return false;
    if (blocked(true)) return false;
    const steps = (S.welcome || WELCOME[S.tool] || []).map(([sel, text, ring]) => ({ sel, text, ring })).filter(s => onScreen(document.querySelector(s.sel)));
    if (!steps.length) return false;
    const card = mk('div', 'mxs mxs-tour'), ring = mk('div', 'mxs mxs-ring'), count = mk('p', 'mxs-step'), text = mk('p', 'mxs-ttext'), acts = mk('div', 'mxs-acts');
    card.setAttribute('role', 'dialog'); card.setAttribute('aria-label', `Welcome to ${NAMES[S.tool] || 'Mixtape'}`); text.setAttribute('aria-live', 'polite'); ring.setAttribute('aria-hidden', 'true');
    const next = button('Next', 'mxs-btn mxs-primary', () => go(1));
    acts.append(button('Don’t show again', 'mxs-link', () => endTour('never')), mk('span', 'mxs-sp'), button('Skip', 'mxs-btn', () => endTour('skip')), next);
    card.append(count, text, acts);
    let i = -1;
    const target = () => { const s = steps[i], n = s && document.querySelector(s.ring || s.sel); return onScreen(n) ? n : null; };
    const place = () => {
      const n = target(); if (!n) return;
      const r = n.getBoundingClientRect(), W = innerWidth, H = innerHeight, cw = card.offsetWidth, ch = card.offsetHeight, gap = 14, fit = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
      Object.assign(ring.style, { left: r.left - 4 + 'px', top: r.top - 4 + 'px', width: r.width + 8 + 'px', height: r.height + 8 + 'px' });
      let x = fit(r.left + r.width / 2 - cw / 2, 12, W - cw - 12), y;
      if (r.bottom + gap + ch <= H - 12) y = r.bottom + gap;                      // under it
      else if (r.top - gap - ch >= 12) y = r.top - gap - ch;                        // over it
      else if (r.right + gap + cw <= W - 12) { x = r.right + gap; y = fit(r.top + 24, 12, H - ch - 12); } // beside it
      else if (r.left - gap - cw >= 12) { x = r.left - gap - cw; y = fit(r.top + 24, 12, H - ch - 12); }
      else { x = fit(r.left + 40, 12, W - cw - 12); y = fit(r.top + 60, 12, H - ch - 12); } // a large panel: inside it, near its top
      card.style.left = x + 'px'; card.style.top = y + 'px';
    };
    function go(d) {
      i += d; while (i < steps.length && !onScreen(document.querySelector(steps[i].sel))) i++; // a control that went away: its step is left out
      if (i >= steps.length) return endTour('done');
      const left = steps.slice(i + 1).some(s => onScreen(document.querySelector(s.sel)));
      count.textContent = `${i + 1} of ${steps.length}`; text.textContent = steps[i].text; next.textContent = left ? 'Next' : 'Done';
      try { target().scrollIntoView({ block: 'nearest', inline: 'nearest' }); } catch (e) {}
      place();
    }
    const key = e => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); endTour('skip'); } };
    tour = { card, ring, key, place, back: back || document.activeElement,
      timer: setInterval(() => { if (!tour) return; if (blocked(true)) return endTour('aside'); if (!target()) return go(1); place(); }, 400) };
    document.body.append(ring, card); go(1); if (!tour) return false;
    window.addEventListener('keydown', key, true); addEventListener('resize', place); addEventListener('scroll', place, true);
    next.focus({ preventScroll: true });
    return true;
  }
  // The first time a tool is opened on this device. If a dialog is in the way, wait for it; give up quietly after a while.
  function firstRun(tries) {
    if (!S.tool || ls.get(FLAG()) === 'done' || tour) return;
    if (!welcome(false) && tries > 0) setTimeout(() => firstRun(tries - 1), 3000);
  }

  /* ---------- hooking up ---------- */
  const api = {
    get toast() { return S.toast; }, set toast(f) { S.toast = typeof f === 'function' ? f : null; },
    get busy() { return S.busy; }, set busy(f) { S.busy = typeof f === 'function' ? f : null; },
    keys(title, rows) { S.keys = { title, rows }; },
    init(o = {}) {
      if (o.tool) S.tool = o.tool;
      if (o.toast) api.toast = o.toast;
      if (o.busy) api.busy = o.busy;
      if (o.welcome) S.welcome = o.welcome;
      if (o.keys) { S.keys = o.keys; if (o.keys.host) { try { adopt(); } catch (e) {} } }
      if (o.welcomeSeen && ls.get(FLAG()) == null) ls.set(FLAG(), 'done');
      setTimeout(() => firstRun(4), 900);
    },
    openKeys, closeKeys, welcome: force => welcome(force !== false), details: showDetails, changes: () => showChanges(false),
    trap, // (box, { onEsc }) → release(): for a tool's other dialogs
  };
  window.MixtapeShell = api;
})();
