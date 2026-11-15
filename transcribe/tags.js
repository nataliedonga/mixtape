/* Mixtape transcripts: tags ([inaudible], a guess, [crosstalk], [laughter] and the rest), in the wording of the style
   in use (../tags-core.js). A row of the style's own tags sits above the transcript: select the words (or leave it on
   the word being played) and press one. The heard words stay in the transcript underneath; the tag is what is shown
   and saved. Pressing the same tag again takes it off; Ctrl + Z undoes. */
import { instead, after, offered, mark } from '../tags-core.js';
import { styleOf } from './matter.js';
const $ = s => document.querySelector(s), esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
let api, bar, lastKey = '';
const STYLE = `
#tagBar { display: flex; flex-wrap: wrap; align-items: center; gap: 6px 8px; margin: 0 0 10px; font: 13.5px/1.4 var(--f-ui, system-ui, sans-serif); }
#tagBar[hidden] { display: none; } #tagBar .tl { color: var(--muted, inherit); } #tagBar .tn { color: var(--muted, inherit); font-size: 12.5px; flex-basis: 100%; }
#tagBar button { height: 28px; padding: 0 9px; border: 1px solid var(--faint, #888); border-radius: 999px; background: transparent; color: inherit; font: 12.5px var(--f-mono, ui-monospace, monospace); cursor: pointer; }
#tagBar button.aft { border-style: dashed; } #tagBar button:focus-visible { outline: 2px solid var(--accent, currentColor); outline-offset: 1px; }
#text .w.tgd { font-family: var(--f-mono, ui-monospace, monospace); font-size: .88em; padding: 0 3px; border-radius: 4px; background: color-mix(in srgb, var(--accent, #1f6f78) 16%, transparent); }
#text .w.tgx { display: none; } #text .w .tga { font-family: var(--f-mono, ui-monospace, monospace); font-size: .88em; opacity: .8; }`;
const short = t => { t = Math.max(0, Math.floor(t || 0)); return Math.floor(t / 60) + ':' + String(t % 60).padStart(2, '0'); };

/* the words in the page take the look of their tags (app.js draws the heard words; this goes over them) */
function paint() {
  const c = api.cur, r = c && c.tr; if (!r) return; const words = r.words, style = styleOf(r);
  for (const el of document.querySelectorAll('#text .w[data-i]')) {
    const i = +el.dataset.i, w = words[i]; if (!w || el.querySelector('input, textarea')) continue;
    const had = el.classList.contains('tgd') || el.classList.contains('tgx') || el.querySelector('.tga');
    if (!w.tg && !(w.ta || []).length) { if (had) { el.classList.remove('tgd', 'tgx'); el.textContent = w.t; } continue; }
    let text = w.t, cls = '';
    if (w.tg) {
      const first = i === 0 || w.p || words[i - 1].tg !== w.tg || words[i - 1].lg || (words[i - 1].ta || []).length;
      let j = i; while (!first && j > 0 && !words[j].p && words[j - 1].tg === w.tg) j--; let k = i + 1; while (k < words.length && !words[k].p && !words[k].lg && words[k].tg === w.tg && !(words[k - 1].ta || []).length) k++;
      const shown = instead(w.tg, words.slice(first ? i : j, k), style);
      if (shown) { if (first) { text = shown; cls = 'tgd'; el.title = `Tagged. Heard as: “${words.slice(i, k).map(x => x.t).join(' ')}”. Press the same tag again to take it off.`; } else cls = 'tgx'; }
    }
    el.classList.toggle('tgd', cls === 'tgd'); el.classList.toggle('tgx', cls === 'tgx');
    const aft = (w.ta || []).map(k => after(k, style)).filter(Boolean).join(' ');
    const end = aft ? (/([.,?!;:]+)$/.exec(text) || ['', ''])[1] : ''; // what is not speech goes before the mark that closes the word, as in a saved file
    const html = esc(end ? text.slice(0, -end.length) : text) + (aft ? ` <span class="tga">${esc(aft)}</span>${esc(end)}` : ''); if (el.innerHTML !== html) el.innerHTML = html; // only when it differs: writing it again would call this again
  }
}
function target() { // the selected words, or the word being played: [i0, i1]
  const c = api.cur, sel = getSelection(), w = n => (n && (n.nodeType === 1 ? n : n.parentElement) || document.body).closest('#text .w[data-i]');
  if (sel && !sel.isCollapsed) { const a = w(sel.anchorNode), b = w(sel.focusNode); if (a && b) { const x = +a.dataset.i, y = +b.dataset.i; return [Math.min(x, y), Math.max(x, y)]; } }
  const k = window.TranscriptCore.wordAt(c.tr.words, c.media ? c.media.currentTime : 0); return k < 0 ? null : [k, k];
}
function draw() {
  const c = api.cur, r = c && c.tr, show = !!(r && r.mode === 'heard' && r.done && r.words.length && !api.job);
  if (show) paint();
  const style = show ? styleOf(r) : '', key = show + style; if (key === lastKey) return; lastKey = key;
  bar.hidden = !show; if (!show) return;
  bar.innerHTML = `<span class="tl">Tag</span>${offered(style).map(([k, label, what, where]) => `<button type="button" data-tag="${k}" class="${where === 'after' ? 'aft' : ''}" title="${esc(what)}">${esc(label)}</button>`).join('')}`
    + `<span class="tn">Select words in the transcript (or leave it on the word being played) and press a tag. Solid: stands for the words. Dashed: goes after the word. The heard words are kept underneath.</span>`;
}
async function click(e) {
  const b = e.target.closest('button[data-tag]'); if (!b) return; const c = api.cur, r = c.tr, t = target();
  if (!t) return api.toast('Click a word first, or select the words to tag.', 5000);
  api.remember(); r.words = mark(r.words, t[0], t[1], b.dataset.tag);
  try { await api.save(); } catch (err) { return; } getSelection().removeAllRanges(); api.drawAll();
  const w = r.words[t[1]], on = b.classList.contains('aft') ? (w.ta || []).includes(b.dataset.tag) : w.tg === b.dataset.tag;
  api.toast(on ? `${b.textContent} ${t[0] === t[1] ? `at ${short(r.words[t[0]].s)}` : `on ${t[1] - t[0] + 1} words from ${short(r.words[t[0]].s)}`}. The heard words are kept. Ctrl + Z undoes.` : `${b.textContent} taken off.`, 5000);
}
export function initTags(a) {
  api = a; const st = document.createElement('style'); st.textContent = STYLE; document.head.appendChild(st);
  bar = document.createElement('section'); bar.id = 'tagBar'; bar.hidden = true; bar.setAttribute('aria-label', 'Tags for this transcript’s style'); $('#text').before(bar);
  bar.addEventListener('mousedown', e => { if (e.target.closest('button')) e.preventDefault(); }); // pressing a tag must not drop the selection in the text
  bar.addEventListener('click', click);
  new MutationObserver(draw).observe($('#text'), { childList: true }); // at once, before the page is painted: the text must not jump down a moment later, under a click already on its way
  if (['localhost', '127.0.0.1'].includes(location.hostname)) window.__tags = { draw, paint, target };
  draw();
}
