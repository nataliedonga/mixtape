/* Mixtape home: one small fact per tool, read from this device. A fact that cannot be read is left out, silently. */
import { facts, plural, SANDBOX } from '../backup-core.js';
const words = {
  songs: n => n ? plural(n, 'song') : 'No songs yet',
  mixes: n => n ? plural(n, 'mix', 'mixes') : '',
  cutter: n => n ? `${plural(n, 'file')} from last time` : '',
  transcripts: n => n ? plural(n, 'transcript') : '',
  reader: n => n ? plural(n, 'recent document') : '',
};
async function show() {
  let f; try { f = await facts(); } catch (e) { return; }
  for (const node of document.querySelectorAll('[data-fact]')) { const k = node.dataset.fact, n = f[k]; node.textContent = typeof n === 'number' && words[k] ? words[k](n) : ''; }
}
/* in a test sandbox the links keep the sandbox name, so the Storage page opened from here looks at the same test stores */
if (SANDBOX) for (const a of document.querySelectorAll('a[href="../storage/"]')) a.href = `../storage/?sandbox=${SANDBOX}`;
show();
/* another Mixtape window added or removed something: look again */
try { new BroadcastChannel((SANDBOX ? SANDBOX + '-' : '') + 'mixtape').onmessage = () => { show(); }; } catch (e) {}
addEventListener('pageshow', e => { if (e.persisted) show(); });
