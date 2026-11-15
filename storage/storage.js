/* Privacy and storage: shows what Mixtape keeps on this device, backs it up to one file, restores it, forgets it.
   All the work is in ../backup-core.js; this file is the page. Every word from a backup reaches the page as plain
   text (textContent), never as HTML. */
import * as core from '../backup-core.js';
const { plural, sizeText } = core;
const $ = s => document.querySelector(s);
const el = (tag, props = {}, kids = []) => { const n = document.createElement(tag); for (const k in props) { if (k === 'class') n.className = props[k]; else if (k === 'text') n.textContent = props[k]; else n.setAttribute(k, props[k]); } for (const c of kids) n.append(c); return n; };
const dateText = iso => { try { return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' }); } catch (e) { return 'an unknown date'; } };
let busy = false; /* one big job at a time: a backup, a restore or a forget */

if (core.SANDBOX) { const s = $('#sandbox'); s.hidden = false; s.textContent = `Test sandbox “${core.SANDBOX}”: this page is looking at test stores, not the real ones.`; }

/* ---------- pressing twice ---------- */
/* A button that removes things acts on the second press only, and only when that press comes at least 0.6 s after the
   first (so a double-click or a bounce does nothing) and within 4 s (after which it goes back to how it was). */
const ARM_MIN = 600, ARM_MAX = 4000;
let armed = null;
function disarm() { if (!armed) return; clearTimeout(armed.timer); armed.btn.textContent = armed.label; armed.btn.classList.remove('armed'); if (armed.note) { armed.note.hidden = true; armed.note.textContent = ''; } armed = null; }
function twoPress(btn, { again, note, warning, run }) {
  btn.addEventListener('click', async () => {
    if (busy) return;
    const now = performance.now();
    if (armed && armed.btn === btn) {
      if (now - armed.at < ARM_MIN) return; /* too soon after the first press to be meant */
      disarm(); await run(); return;
    }
    disarm();
    armed = { btn, at: now, label: btn.textContent, note, timer: setTimeout(disarm, ARM_MAX) };
    btn.textContent = again; btn.classList.add('armed');
    if (note) { note.textContent = warning; note.hidden = false; }
  });
}

/* ---------- what is kept ---------- */
async function draw() {
  let s;
  try { s = await core.survey(); } catch (e) { $('#rows').replaceChildren(el('tr', {}, [el('td', { colspan: '4', class: 'wait', text: 'This browser would not let Mixtape look at its storage just now. Reload the page to try again.' })])); $('#estimate').textContent = ''; return null; }
  const body = $('#rows'); disarm(); body.replaceChildren();
  let firstDownload = true;
  for (const r of s.rows) {
    if (r.download && firstDownload) { firstDownload = false; body.append(el('tr', { class: 'group' }, [el('th', { colspan: '4', scope: 'colgroup', text: 'Downloaded so Mixtape works offline' })])); }
    const what = el('th', { scope: 'row' }, [el('span', { class: 'name', text: r.title }), el('span', { class: 'desc', text: r.what })]);
    const items = el('td', { 'data-label': 'In it now', text: r.items }), size = el('td', { class: 'num', 'data-label': 'Size', text: r.empty ? 'nothing' : sizeText(r.bytes) });
    const act = el('td', { class: 'act' });
    if (!r.empty) {
      const note = el('p', { class: 'warn', role: 'alert' }); note.hidden = true;
      const btn = el('button', { class: 'btn small', type: 'button', text: 'Forget this', 'aria-label': `Forget this: ${r.title}` });
      twoPress(btn, { again: 'Press again to forget', note, warning: `${r.consequence}${r.download ? '' : ' This cannot be undone: back up first if you might want it again.'} Press again within 4 seconds to go ahead.`, run: () => forgetRow(r) });
      act.append(btn, note);
    } else act.append(el('span', { class: 'none', text: 'Nothing to forget' }));
    body.append(el('tr', { 'data-row': r.id, class: r.empty ? 'empty' : '' }, [what, items, size, act]));
  }
  /* the browser's own figures */
  const e = $('#estimate');
  if (s.used != null) e.textContent = `The browser says everything stored at this address comes to about ${s.used > 0 ? sizeText(s.used) : 'nothing'}${s.quota ? `, out of ${sizeText(s.quota)} it will allow` : ''}.`;
  else e.textContent = 'This browser does not say how much room is used in all.';
  const p = $('#protect'), pb = $('#protectBtn');
  if (s.kept === true) { p.textContent = 'Protected: the browser has agreed not to clear this to make room.'; p.className = 'ok'; pb.hidden = true; }
  else if (s.kept === false) { p.textContent = 'Not protected yet: if this device runs very short of space, the browser is allowed to clear what Mixtape keeps.'; p.className = 'caution'; pb.hidden = false; }
  else { p.textContent = 'This browser does not say whether what is kept here is protected from being cleared.'; p.className = ''; pb.hidden = true; }
  const o = $('#others'); o.hidden = !s.others;
  if (s.others) o.textContent = `Also stored at this web address, but not Mixtape’s: ${plural(s.others, 'other item')} (for example from another app published beside it, or from testing). Mixtape does not read, back up or forget those.`;
  return s;
}
async function forgetRow(r) {
  if (busy) return; busy = true;
  const out = $('#forgetOut'); let ok = false;
  try { ok = await core.forget(r.id); } catch (e) {}
  busy = false; const s = await draw();
  const now = s && s.rows.find(x => x.id === r.id), gone = !now || now.empty;
  out.textContent = ok && gone ? `Forgotten: ${r.title}. It is gone from this device.${r.id === 'library' || r.id === 'transcripts' || r.id === 'studio' || r.id === 'settings' ? ' If Mixtape is open in another window, reload that window.' : ''}`
    : `${r.title} could not be fully forgotten. Close other Mixtape windows, then press Forget this again.`;
  out.className = 'result ' + (ok && gone ? 'good' : 'bad');
}
$('#refreshBtn').addEventListener('click', () => { draw(); });
$('#protectBtn').addEventListener('click', async () => {
  const yes = await core.askProtection(); await draw();
  if (yes === false) { $('#protect').textContent = 'The browser said no for now. It usually says yes once Mixtape is installed on this device or has been used a few times. Nothing is lost by its saying no; a backup file is the surer protection.'; }
});

/* ---------- back up ---------- */
const countsText = c => { const b = [plural(c.songs, 'song')]; if (c.lyrics) b.push(`lyrics for ${c.lyrics}`); b.push(plural(c.playlists, 'playlist'), plural(c.favourites, 'favourite'), plural(c.transcripts, 'transcript'), plural(c.marks, 'sensitive mark'), plural(c.mixes, 'Studio mix', 'Studio mixes'), plural(c.settings, 'setting')); return b.join(', '); };
function progress(which, label, frac) { $(`#${which}Work`).hidden = false; $(`#${which}Lbl`).textContent = label; $(`#${which}Bar`).value = Math.max(0, Math.min(1, frac || 0)); }
function say(node, kind, lines) { node.className = 'result ' + kind; node.replaceChildren(...lines.map(l => typeof l === 'string' ? el('p', { text: l }) : l)); }
const plainError = e => e instanceof core.BackupError ? e.message : e && e.message === 'nosubtle' ? new core.BackupError('secure').message : null;

$('#backupBtn').addEventListener('click', async () => {
  if (busy) return; const out = $('#backupOut'); disarm();
  const name = `Mixtape backup ${new Date().toISOString().slice(0, 10)}.mixtape-backup`;
  let writable = null;
  if (window.showSaveFilePicker) {
    try { const h = await window.showSaveFilePicker({ suggestedName: name, types: [{ description: 'Mixtape backup', accept: { 'application/octet-stream': ['.mixtape-backup'] } }] }); writable = await h.createWritable(); }
    catch (e) { if (e && e.name === 'AbortError') return say(out, '', ['No backup was made: you closed the window without choosing where to save it.']); writable = null; }
  }
  busy = true; $('#backupBtn').disabled = true; say(out, '', []);
  try {
    progress('backup', 'Writing the backup…', 0);
    const r = await core.writeBackup(writable, f => progress('backup', `Writing the backup… ${Math.round(f * 100)}%`, f));
    if (r.blob) { const u = URL.createObjectURL(r.blob), a = el('a', { href: u, download: name }); document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(u), 120000); }
    const lines = [`Backup ${r.blob ? 'made: your browser is saving it to your downloads as' : 'saved as'} “${name}” (${sizeText(r.bytes)}).`, `In it: ${countsText(r.counts)}.`,
      'Keep the file somewhere safe and private. It is not locked with a password, so anyone who has the file can open what is in it.'];
    if (r.blob) lines.push('Wait until the download has finished before you forget anything here: the file is still being copied out until then.');
    if (r.silent) lines.push(`${plural(r.silent, 'entry', 'entries')} in the song library had no sound and ${r.silent === 1 ? 'was' : 'were'} left out.`);
    say(out, 'good', lines);
  } catch (e) {
    if (writable) { try { await writable.abort(); } catch (e2) {} }
    say(out, 'bad', [plainError(e) || 'The backup could not be finished, so no usable file was made. The disk you chose may be full or may have been unplugged. Free some space or choose another place, then press the button again.']);
  }
  $('#backupWork').hidden = true; $('#backupBtn').disabled = false; busy = false;
});

/* ---------- restore ---------- */
function reportOf(R) {
  const added = [], had = [], trouble = [];
  if (R.songs.added) added.push(plural(R.songs.added, 'song or recording', 'songs and recordings') + (R.lyrics.added ? ` (${R.lyrics.added} with lyrics)` : ''));
  if (R.playlists.added) added.push(plural(R.playlists.added, 'playlist'));
  if (R.playlists.joined) added.push(`songs put into ${plural(R.playlists.joined, 'playlist')} you already had`);
  if (R.favourites.added) added.push(plural(R.favourites.added, 'favourite'));
  if (R.transcripts.added) added.push(plural(R.transcripts.added, 'transcript'));
  if (R.marks.added) added.push(plural(R.marks.added, 'sensitive mark'));
  if (R.mixes.added) added.push(plural(R.mixes.added, 'Studio mix', 'Studio mixes'));
  if (R.settings.added) added.push(plural(R.settings.added, 'setting'));
  if (R.songs.had) had.push(plural(R.songs.had, 'song or recording', 'songs and recordings'));
  if (R.playlists.same) had.push(plural(R.playlists.same, 'playlist'));
  if (R.favourites.had) had.push(plural(R.favourites.had, 'favourite'));
  if (R.transcripts.had) had.push(plural(R.transcripts.had, 'transcript'));
  if (R.marks.had) had.push(plural(R.marks.had, 'sensitive mark'));
  if (R.mixes.had) had.push(plural(R.mixes.had, 'Studio mix', 'Studio mixes'));
  if (R.settings.had) had.push(plural(R.settings.had, 'setting'));
  if (R.songs.failed) trouble.push(`${plural(R.songs.failed, 'song')} could not be saved on this device`);
  if (R.transcripts.failed) trouble.push(`${plural(R.transcripts.failed, 'transcript')} could not be saved`);
  if (R.listsFailed) trouble.push('the playlists and favourites could not be saved');
  const list = (title, items) => el('div', {}, [el('h3', { text: title }), el('ul', {}, items.map(t => el('li', { text: t })))]);
  const lines = [`The backup made on ${dateText(R.madeAt)} was checked and is whole.`];
  if (!added.length && !trouble.length) lines.push('Everything in this backup was already on this device, so nothing was added.');
  if (added.length) lines.push(list('Added', added));
  if (had.length) lines.push(list('Already here, so left as they were', had));
  if (trouble.length) { lines.push(list('Not restored', trouble)); lines.push(R.full ? 'This device ran out of room. Free some space, then restore the same file again: what was added stays, and only the rest will be added.' : 'Restore the same file again to try once more: what was added stays, and only the rest will be added.'); }
  else if (R.full) lines.push('Some settings or mixes did not fit on this device. Free some space, then restore the same file again.');
  if (added.length) lines.push('If Mixtape is open in another window, it has been told to look again.');
  return { lines, kind: trouble.length || R.full ? 'bad' : 'good' };
}
async function restoreFile(file) {
  if (busy) return null; busy = true; const out = $('#restoreOut'); disarm();
  $('#restoreBtn').disabled = true; say(out, '', []);
  const label = { check: 'Checking the whole file before adding anything…', songs: 'Adding songs…', transcripts: 'Adding transcripts…' };
  let R = null;
  try {
    progress('restore', label.check, 0);
    R = await core.restore(file, (stage, f) => progress('restore', `${label[stage] || 'Working…'} ${Math.round(f * 100)}%`, f));
    const rep = reportOf(R); say(out, rep.kind, rep.lines);
  } catch (e) {
    say(out, 'bad', [plainError(e) || 'The restore stopped part-way because this browser would not save any more. Whatever was added before that is kept. Close other Mixtape windows, free some space, then choose the same file again: only what is still missing will be added.']);
  }
  $('#restoreWork').hidden = true; $('#restoreBtn').disabled = false; busy = false;
  await draw(); return R;
}
$('#restoreBtn').addEventListener('click', () => { if (!busy) $('#restoreIn').click(); });
$('#restoreIn').addEventListener('change', e => { const f = e.target.files[0]; e.target.value = ''; if (f) restoreFile(f); });

/* ---------- forget everything ---------- */
const allNote = el('p', { class: 'warn', role: 'alert' }); allNote.hidden = true; $('#forgetAllBtn').after(allNote);
twoPress($('#forgetAllBtn'), { again: 'Press again to forget everything', note: allNote,
  warning: 'Every song, recording, transcript, mix and setting will be gone from this device and cannot be brought back without a backup file. Press again within 4 seconds to go ahead.',
  run: async () => {
    if (busy) return; busy = true; const out = $('#forgetOut'); let ok = false;
    try { ok = await core.forget('everything'); } catch (e) {}
    busy = false; const s = await draw();
    const left = s ? s.rows.filter(r => !r.empty && !r.appCopy) : [];
    if (ok && !left.length) say(out, 'good', ['Everything has been forgotten. Nothing of yours is kept on this device now; the list above shows it.', 'If Mixtape is open in another window, close or reload that window so it does not save anything back.']);
    else say(out, 'bad', [`Not everything could be forgotten${left.length ? `: still here are ${left.map(r => r.title.toLowerCase()).join(', ')}` : ''}. Close other Mixtape windows, then press the button again.`]);
  } });

draw();
if (['localhost', '127.0.0.1', '[::1]'].includes(location.hostname)) window.__storage = { core, draw, restoreFile, ARM_MIN, ARM_MAX };
