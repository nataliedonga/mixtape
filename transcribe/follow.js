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
  lab.title = 'Backup Track is installed: follow the site it is following, so the picture and the lit word here move with it. The sound comes from Backup Track; this recording is silent while it follows.';
  const box = document.createElement('input'); box.type = 'checkbox'; box.id = 'btFollowBox'; lab.append(box, ' Follow Backup Track'); pb.appendChild(lab);
  let on = false, muted = null, last = null, pingT = 0;
  const ask = what => document.dispatchEvent(new CustomEvent('backup-track:listen', { detail: what }));
  document.addEventListener('backup-track:hello', () => { lab.hidden = false; });
  function apply(s) {
    last = s; const cur = api.cur; if (!on || !cur || !cur.media || !s || !s.loaded) return; const m = cur.media;
    if (muted !== m) { if (muted) muted.muted = false; m.muted = true; muted = m; } // the recording now open is the silent one
    if (m.playbackRate !== s.rate) m.playbackRate = s.rate;
    const t = s.cur + (s.paused ? 0 : Math.max(0, Date.now() - s.at) / 1000 * s.rate), end = m.duration || Infinity;
    if (t < end && Math.abs(m.currentTime - t) > (s.paused ? 0.05 : 0.35)) m.currentTime = t;
    if (s.paused || t >= end) { if (!m.paused) m.pause(); } else if (m.paused) m.play().catch(() => {});
  }
  document.addEventListener('backup-track:state', e => { try { apply(JSON.parse(e.detail)); } catch (err) {} });
  box.addEventListener('change', () => {
    on = box.checked; clearInterval(pingT);
    if (on) { ask('on'); pingT = setInterval(() => ask('on'), 20000); /* said again now and then, in case the extension was restarted */ api.toast('Following Backup Track: this recording moves with the site and is silent here (the sound comes from Backup Track). Open the same recording in both.', 8000); if (last) apply(last); }
    else { ask('off'); if (muted) { muted.muted = false; muted = null; } if (api.cur && api.cur.media) api.cur.media.pause(); api.toast('No longer following Backup Track.', 3000); }
  });
  ask('probe'); setTimeout(() => ask('probe'), 1500); // is the extension there? (it answers with backup-track:hello)
  if (['localhost', '127.0.0.1'].includes(location.hostname)) window.__follow = { get on() { return on; }, get last() { return last; } };
}
