/* Follow Backup Track. Backup Track is a separate browser extension that plays your own copy of a recording in step
   with the player on another site (a transcription platform). With this switched on, the recording open here follows
   too: its picture and its lit word move with the site, so you can see who is speaking at that moment. The sound comes
   from Backup Track, so the recording here is silent while it follows.

   Nothing goes over any network. The extension tells this page three things, through an event in the page: where
   your audio is, whether it is playing, and at what speed. This page tells the extension nothing but "follow" and
   "stop". If the extension is not installed, the switch is never shown. */
export function initFollow(api) {
  const pb = document.querySelector('#pb'); if (!pb) return;
  const lab = document.createElement('label'); lab.className = 'fl'; lab.id = 'btFollow'; lab.hidden = true;
  lab.title = 'Backup Track is installed: this recording follows the website it is following. If Backup Track has an audio of its own, it makes the sound and this one is silent; if it has none, this one plays with its sound. Never both.';
  const box = document.createElement('input'); box.type = 'checkbox'; box.id = 'btFollowBox'; lab.append(box, ' Follow Backup Track'); pb.appendChild(lab);
  let on = false, muted = null, last = null, pingT = 0;
  const ask = what => document.dispatchEvent(new CustomEvent('backup-track:listen', { detail: what }));
  document.addEventListener('backup-track:hello', () => { lab.hidden = false; });
  // There is only ever one sound. If Backup Track has an audio of its own, it makes the sound and this recording follows
  // it silently (picture and lit word). If it has none, this recording follows the website itself, with its own sound:
  // Backup Track then only passes on what the website's player is doing.
  let how = '';
  function apply(s) {
    last = s; const cur = api.cur; if (!on || !cur || !cur.media || !s) return; const m = cur.media, end = m.duration || Infinity;
    const own = !s.loaded; if (own && !s.site) return; // nothing to follow yet: the website has not played
    if (own) { if (muted) { muted.muted = false; muted = null; } } else if (muted !== m) { if (muted) muted.muted = false; m.muted = true; muted = m; }
    const ref = own ? s.site : s, rate = ref.rate || 1, raw = (own ? ref.t : ref.cur) + (ref.paused ? 0 : Math.max(0, Date.now() - s.at) / 1000 * rate), t = own && api.siteToRec ? api.siteToRec(raw) : raw;
    if (m.playbackRate !== rate) m.playbackRate = rate;
    if (t >= 0 && t < end && Math.abs(m.currentTime - t) > (ref.paused ? 0.05 : 0.35)) m.currentTime = t;
    if (ref.paused || t >= end || t < 0) { if (!m.paused) m.pause(); } else if (m.paused) m.play().catch(() => {});
    const now = own ? 'own' : 'ext'; if (now !== how) { how = now; api.toast(own ? 'Following the website: this recording plays here, with its sound (Backup Track has no audio of its own).' : 'Following Backup Track: it makes the sound; this recording follows silently.', 6000); }
  }
  document.addEventListener('backup-track:state', e => { try { apply(JSON.parse(e.detail)); } catch (err) {} });
  box.addEventListener('change', () => {
    on = box.checked; clearInterval(pingT);
    if (on) { ask('on'); pingT = setInterval(() => ask('on'), 20000); /* said again now and then, in case the extension was restarted */ how = ''; if (last) apply(last); else api.toast('Following: press play on the website.', 5000); }
    else { ask('off'); how = ''; if (muted) { muted.muted = false; muted = null; } if (api.cur && api.cur.media) api.cur.media.pause(); api.toast('No longer following Backup Track.', 3000); }
  });
  ask('probe'); setTimeout(() => ask('probe'), 1500); // is the extension there? (it answers with backup-track:hello)
  if (['localhost', '127.0.0.1'].includes(location.hostname)) window.__follow = { get on() { return on; }, get last() { return last; } };
}
