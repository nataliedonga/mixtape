/* Mixtape transcripts: a recording that was joined from clips in the Cutter shows where each clip begins.

   The Cutter remembers the clips of every file it joins (their names and lengths, in this browser: 'cutter:joined').
   When the transcript of such a file is finished or opened, a line of its own goes in at the start of each clip,
   "(Clip 3 of 100: its name)", once. The lines are part of the transcript: they are in saved files too, each can be
   edited or removed like any notation, and Ctrl + Z takes them all out. No heard word is changed. Nothing is sent
   anywhere. */
const $ = s => document.querySelector(s);
let api, busy = false;
const T = () => window.TranscriptCore;
const joined = () => { try { return JSON.parse(localStorage.getItem('cutter:joined') || '[]') || []; } catch (e) { return []; } };

async function apply() {
  const c = api.cur, r = c && c.tr; if (busy || !r || !r.done || r.clipLines || api.job || !Array.isArray(r.words) || !r.words.length) return;
  if ((r.notes && r.notes.length) || r.review) return; // notes and checks are pinned to word numbers: nothing is put in between while they are there
  if (r.words.some(w => w.s == null)) return; // every word needs its moment to know its clip
  const made = joined().find(j => j.name === c.track.name && j.size === c.track.size); if (!made || !Array.isArray(made.clips) || made.clips.length < 2) return;
  if (r.part && !r.part.whole) return; // only a part of the recording was written down
  busy = true;
  try {
    api.remember(); r.words = T().withClips(r.words, made.clips); r.clipLines = { n: made.clips.length, at: Date.now() }; api.drawAll();
    try { await api.save(); } catch (e) { return; }
    api.toast(`This recording was joined from ${made.clips.length} clips: a line marks where each one begins. Ctrl + Z takes them out.`, 8000);
  } finally { busy = false; }
}

export function initClips(a) {
  api = a;
  new MutationObserver(() => { apply(); }).observe($('#text'), { childList: true });
  if (['localhost', '127.0.0.1'].includes(location.hostname)) window.__clips = { apply, joined };
  apply();
}
