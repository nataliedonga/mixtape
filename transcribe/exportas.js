/* Mixtape transcripts: "Choose what goes in the file".
   One transcript, many kinds of file: with or without the speakers' names, with or without the time stamps, every word
   that was said or the clean version a style asks for (Rev's legal guide leaves out "um" and "uh"; TranscribeMe's clean
   verbatim leaves out fillers and a word said twice). Nothing is taken out of the transcript itself: the choices only
   decide what is written into this file, and a preview shows it before it is saved. */
import { partExport } from './part.js';
import { styleOf, STYLES } from './matter.js';
import { clock } from '../tags-core.js';
import { toDocx, toPdf } from './exportdoc.js';
const $ = s => document.querySelector(s), esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const KEY = 'mixtape-export-as';
const LEAVES = { '': 'ums and uhs, a word said twice in a row, and openers like “So,” and “Well,”', rev: '“um” and “uh”, and cut-off part-words (Rev’s legal guide keeps everything else)', 'tm-clean': 'fillers (unless one is the whole answer) and a word said twice in a row', 'tm-full': 'nothing: full verbatim keeps every word' };
let api, dlg;
const T = () => window.TranscriptCore;
const DEF = { speakers: true, times: true, clean: false, silence: false, unsure: false, kind: 'txt' };
const saved = () => { try { return Object.assign({}, DEF, JSON.parse(localStorage.getItem(KEY)) || {}); } catch (e) { return { ...DEF }; } };

function make(o) { // the file's text and name, from the choices
  const cur = api.cur, r = partExport({ ...cur.tr, styleFor: o.style }, { silence: o.silence ? 10 : 0, unsure: o.unsure ? 0.5 : 0 }), sens = api.sensitive(cur.track.id), words = r.words.map(w => (w.s == null ? { ...w, s: 0 } : w));
  const base = (cur.track.title || 'transcript').replace(/[\\/:*?"<>|]+/g, '-') + (sens ? ' (SENSITIVE)' : ''), page = o.kind === 'txt' || o.kind === 'docx' || o.kind === 'pdf', tag = [o.clean ? 'clean' : '', !o.speakers && page ? 'no speakers' : '', !o.times && page ? 'no times' : ''].filter(Boolean).join(', ');
  const was = T().cleanStyle(); T().setCleanStyle(o.style); let text, doc = null;
  try {
    if (page) { text = T().toTxt(words, { clean: o.clean, style: o.style, timestamps: o.times, speakers: o.speakers, caps: o.style === 'rev' }); if (sens) text = api.sensLine + '\n\n' + text; }
    else { const timed = r.words.slice(0, T().timedUpTo(r.words)); text = o.kind === 'srt' ? T().toSrt(timed, o.clean) : T().toVtt(timed, o.clean); if (sens && o.kind === 'vtt') text = text.replace(/^WEBVTT[^\n]*\n+/, m => m.trimEnd() + '\n\nNOTE ' + api.sensLine + '\n\n'); }
    if (o.kind === 'docx' || o.kind === 'pdf') { // the same paragraphs, as a document
      const hidden = o.clean ? T().cleanHidden(words, o.style) : null;
      doc = { title: cur.track.title || 'Transcript', note: sens ? api.sensLine : '', paras: T().paragraphs(words).map(p => ({ time: o.times ? clock(p.start) : '', speaker: o.speakers && p.speaker ? (o.style === 'rev' ? p.speaker.toUpperCase() : p.speaker) : '', text: T().joinShown(words, p.i0, p.i1, hidden) })).filter(p => p.text) };
    }
  } finally { T().setCleanStyle(was); }
  return { text, doc, name: `${base}${tag ? ` (${tag})` : ''}.${o.kind}` };
}
const read = () => ({ style: $('#xaStyle').value, speakers: $('#xaSpeakers').checked, times: $('#xaTimes').checked, clean: $('#xaClean').checked, silence: $('#xaSilence').checked, unsure: $('#xaUnsure').checked, kind: dlg.querySelector('input[name=xaKind]:checked').value });
function show() {
  const o = read(), sub = o.kind === 'srt' || o.kind === 'vtt';
  $('#xaSpeakers').disabled = $('#xaTimes').disabled = sub; $('#xaSubNote').hidden = !sub;
  $('#xaLeaves').textContent = `Leaves out ${LEAVES[o.style] || LEAVES['']}.`;
  $('#xaStyleNote').textContent = o.style === 'rev' ? 'In the file, Rev’s way: Exhibit 5 and Page 15 in digits, numbers from 11 in digits (not at the start of a sentence), $42 for “forty two dollars”, years in digits, “gonna” written out as “going to”, and a spaced double dash for a cut-off word.' : o.style === 'tm-full' ? 'In the file: “them” for “’em”, and a double dash after a cut-off word.' : '';
  $('#xaTagNote').textContent = o.style === 'rev' ? 'Rev’s legal guide has no tag for a guess or for silence, so these two do nothing in this style. Tags you put in yourself are written its way.' : 'Tags you put in yourself are always written, in this style’s wording.';
  let m; try { m = make(o); } catch (e) { $('#xaPreview').textContent = 'This cannot be made: ' + (e.message || e); return; }
  $('#xaName').textContent = m.name; $('#xaPreview').textContent = m.text.split('\n').slice(0, 14).join('\n') + (m.text.split('\n').length > 14 ? '\n…' : '');
}
export function exportAs() {
  const cur = api.cur; if (!cur || !cur.tr) return; const o = saved(), st = styleOf(cur.tr);
  $('#xaStyle').value = st; $('#xaSpeakers').checked = o.speakers; $('#xaTimes').checked = o.times; $('#xaClean').checked = o.clean; $('#xaSilence').checked = o.silence; $('#xaUnsure').checked = o.unsure;
  (dlg.querySelector(`input[name=xaKind][value="${o.kind}"]`) || dlg.querySelector('input[name=xaKind]')).checked = true;
  show(); dlg.showModal(); $('#xaSave').focus();
}
export function initExportAs(a) {
  api = a; const st = document.createElement('style');
  st.textContent = `#exportAs { width: min(680px, calc(100vw - 24px)); max-height: calc(100vh - 24px); padding: 0; border: 1px solid var(--faint, #888); border-radius: 14px; background: var(--paper, Canvas); color: var(--ink, CanvasText); font: 15px/1.5 var(--f-ui, system-ui, sans-serif); }
#exportAs::backdrop { background: rgba(0, 0, 0, .45); } #exportAs form { padding: 18px 20px; display: grid; gap: 12px; } #exportAs h2 { margin: 0; font-size: 19px; }
#exportAs .xrow { display: flex; flex-wrap: wrap; align-items: center; gap: 8px 16px; } #exportAs label { display: inline-flex; align-items: center; gap: 7px; cursor: pointer; }
#exportAs select { height: 32px; padding: 0 8px; border: 1px solid var(--faint, #888); border-radius: 7px; background: var(--sheet, transparent); color: inherit; font: inherit; }
#exportAs small { color: var(--muted, inherit); display: block; } #exportAs fieldset { border: 0; padding: 0; margin: 0; display: grid; gap: 6px; } #exportAs legend { padding: 0; font-weight: 650; margin-bottom: 4px; }
#exportAs pre { margin: 0; padding: 10px 12px; max-height: 200px; overflow: auto; border: 1px solid var(--faint, #8884); border-radius: 9px; background: var(--sheet, transparent); font: 13px/1.5 var(--f-mono, ui-monospace, monospace); white-space: pre-wrap; overflow-wrap: anywhere; }
#exportAs .xname { font: 600 13px var(--f-mono, ui-monospace, monospace); overflow-wrap: anywhere; } #exportAs .xbtns { display: flex; justify-content: flex-end; gap: 8px; }
#exportAs button { height: 36px; padding: 0 14px; border: 1px solid var(--faint, #888); border-radius: 9px; background: transparent; color: inherit; font: inherit; cursor: pointer; } #exportAs #xaSave { background: var(--accent, #1f6f78); border-color: var(--accent, #1f6f78); color: var(--accent-ink, #fff); font-weight: 650; }
#exportAs :focus-visible { outline: 2px solid var(--accent, currentColor); outline-offset: 1px; }`;
  document.head.appendChild(st);
  dlg = document.createElement('dialog'); dlg.id = 'exportAs'; dlg.setAttribute('aria-labelledby', 'xaTitle');
  dlg.innerHTML = `<form method="dialog"><h2 id="xaTitle">Choose what goes in the file</h2>
    <small>The transcript itself is not changed. These choices only decide what is written into this file.</small>
    <div class="xrow"><label for="xaStyle">Style</label><select id="xaStyle">${STYLES.map(([v, t]) => `<option value="${v}">${esc(t)}</option>`).join('')}</select></div><small id="xaStyleNote"></small>
    <fieldset><legend>In the file</legend>
      <label><input type="checkbox" id="xaSpeakers"> The speakers’ names</label>
      <label><input type="checkbox" id="xaTimes"> A time stamp on each paragraph</label>
      <label><input type="checkbox" id="xaClean"> Clean version: leave out what the style leaves out</label><small id="xaLeaves"></small>
      <label><input type="checkbox" id="xaUnsure"> Mark words the recogniser was unsure of as guesses</label>
      <label><input type="checkbox" id="xaSilence"> Mark silences of ten seconds or more</label><small id="xaTagNote"></small>
    </fieldset>
    <fieldset><legend>Kind of file</legend><div class="xrow">
      <label><input type="radio" name="xaKind" value="docx"> Word (.docx)</label><label><input type="radio" name="xaKind" value="pdf"> PDF (.pdf)</label><label><input type="radio" name="xaKind" value="txt"> Text (.txt)</label><label><input type="radio" name="xaKind" value="srt"> Subtitles (.srt)</label><label><input type="radio" name="xaKind" value="vtt"> Web subtitles (.vtt)</label></div>
      <small id="xaSubNote" hidden>Subtitles carry their own times and no speaker names.</small></fieldset>
    <div><div class="xname" id="xaName"></div><pre id="xaPreview" aria-label="How the file begins" tabindex="0"></pre></div>
    <div class="xbtns"><button type="button" id="xaCancel">Cancel</button><button type="button" id="xaSave">Save the file</button></div></form>`;
  document.body.appendChild(dlg);
  dlg.addEventListener('change', show);
  $('#xaCancel').addEventListener('click', () => dlg.close());
  $('#xaSave').addEventListener('click', async () => {
    const o = read(); let m, blob; try { m = make(o); blob = m.doc ? await (o.kind === 'docx' ? toDocx(m.doc) : toPdf(m.doc)) : new Blob([m.text], { type: 'text/plain' }); } catch (e) { console.error(e); return api.toast('The file could not be made: ' + (e.message || e), 7000); }
    try { localStorage.setItem(KEY, JSON.stringify({ speakers: o.speakers, times: o.times, clean: o.clean, silence: o.silence, unsure: o.unsure, kind: o.kind })); } catch (e) {}
    const a = document.createElement('a'), u = URL.createObjectURL(blob); a.href = u; a.download = m.name; a.click(); setTimeout(() => URL.revokeObjectURL(u), 60e3);
    dlg.close(); api.toast(`Saved “${m.name}”.`, 5000);
  });
  if (['localhost', '127.0.0.1'].includes(location.hostname)) window.__exportAs = { make, exportAs, toDocx, toPdf };
}
