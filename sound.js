/* The sound control shared by Mixtape's apps: "Clearer speech" and "Both / Left only / Right only", for listening.

   Nothing is routed until one of them is first switched on: until then the page plays exactly as it always did.
   From then on the sound of that player goes through one small processor (enhance-worklet.js) on its way out.
   "Clearer speech" is remembered on this device; the side is not (so a voice is never missing by surprise).
   Nothing leaves this computer. */
const KEY = 'mixtape-clearer-speech';
const state = { on: false, side: '' };
try { state.on = localStorage.getItem(KEY) === '1'; } catch (e) {}
let ctx = null, loading = null; const wired = new WeakMap(), nodes = new Set();

/* the processor as a node of an audio context (the Cutter has its own context, and uses this too) */
export async function enhanceNode(context) {
  if (!context.__mixtapeEnh) context.__mixtapeEnh = context.audioWorklet.addModule(new URL('./enhance-worklet.js', import.meta.url));
  await context.__mixtapeEnh;
  return new AudioWorkletNode(context, 'mixtape-enhance', { numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [2], channelCount: 2, channelCountMode: 'explicit' });
}
const tell = () => { for (const n of nodes) n.port.postMessage({ on: state.on, side: state.side }); };

/* a media element is sent through the processor, once; before that it is left alone */
async function wire(el) {
  if (!el || wired.has(el)) return; wired.set(el, true);
  ctx ||= new AudioContext({ latencyHint: 'playback' });
  const wake = () => { if (ctx.state !== 'running') ctx.resume().catch(() => {}); };
  el.addEventListener('play', wake); document.addEventListener('pointerdown', wake, true); document.addEventListener('keydown', wake, true); wake();
  const node = await (loading = enhanceNode(ctx)); nodes.add(node); node.port.postMessage({ on: state.on, side: state.side });
  const src = ctx.createMediaElementSource(el); src.connect(node); node.connect(ctx.destination); // only now does the element's sound leave through here
}

const STYLE = `
.mxsound { position: relative; display: inline-flex; }
.mxsound-pop { position: absolute; bottom: calc(100% + 8px); right: 0; z-index: 60; min-width: 250px; padding: 12px; border-radius: 12px; border: 1px solid var(--line, var(--faint, #8886)); background: var(--surface, var(--sheet, var(--bg, Canvas))); color: var(--ink, var(--text, CanvasText)); box-shadow: 0 10px 30px #0006; font: 14px/1.4 var(--f-ui, system-ui, sans-serif); text-align: left; }
.mxsound-pop[hidden] { display: none; }
.mxsound-pop label { display: flex; gap: 8px; align-items: flex-start; cursor: pointer; } .mxsound-pop small { display: block; opacity: .75; font-size: 12.5px; }
.mxsound-pop .mxs-h { margin: 12px 0 6px; font-size: 12px; letter-spacing: .06em; text-transform: uppercase; opacity: .7; }
.mxsound-pop .mxs-seg { display: flex; border: 1px solid var(--line, var(--faint, #8886)); border-radius: 8px; overflow: hidden; }
.mxsound-pop .mxs-seg button { flex: 1; height: 34px; border: 0; border-radius: 0; background: transparent; color: inherit; font: inherit; cursor: pointer; padding: 0 6px; white-space: nowrap; }
.mxsound-pop .mxs-seg button + button { border-left: 1px solid var(--line, var(--faint, #8886)); }
.mxsound-pop .mxs-seg button[aria-pressed="true"] { background: var(--accent, #1f6f78); color: var(--accent-ink, #fff); font-weight: 650; }
.mxsound-pop button:focus-visible, .mxsound > button:focus-visible { outline: 2px solid var(--accent, currentColor); outline-offset: 2px; }
.mxsound > button.mxs-live { border-color: var(--accent, currentColor); color: var(--accent, inherit); }`;

/* The button and its small panel. after: the element it sits after; media: () => the media element playing now;
   cls: the page's own button class; toast: the page's message line. Returns { refresh } (call it when the media changes). */
export function soundControl({ after, media, cls = '', toast = () => {} }) {
  if (!after || document.querySelector('.mxsound')) return { refresh() {} };
  const st = document.createElement('style'); st.textContent = STYLE; document.head.appendChild(st);
  const box = document.createElement('span'); box.className = 'mxsound';
  box.innerHTML = `<button type="button" class="${cls}" id="soundBtn" aria-haspopup="true" aria-expanded="false" title="Sound: clearer speech, or one side only">Sound</button>
    <div class="mxsound-pop" id="soundPop" hidden role="group" aria-label="Sound">
      <label><input type="checkbox" id="soundClear"><span><b>Clearer speech</b><small>Cuts hum and rumble, lifts quiet voices, holds back loud ones. For listening: your files are not changed.</small></span></label>
      <div class="mxs-h">Voices</div>
      <div class="mxs-seg" id="soundSide"><button type="button" data-v="" aria-pressed="true">Both</button><button type="button" data-v="L" aria-pressed="false">Left only</button><button type="button" data-v="R" aria-pressed="false">Right only</button></div>
      <small style="display:block;margin-top:6px;opacity:.75;font-size:12.5px">For calls recorded with each person on their own side: hear one, silence the other.</small>
    </div>`;
  after.after(box);
  const btn = box.querySelector('#soundBtn'), pop = box.querySelector('#soundPop'), chk = box.querySelector('#soundClear'), seg = box.querySelector('#soundSide');
  const draw = () => { chk.checked = state.on; seg.querySelectorAll('button').forEach(b => b.setAttribute('aria-pressed', b.dataset.v === state.side)); const live = state.on || !!state.side; btn.classList.toggle('mxs-live', live); btn.textContent = state.side ? `Sound: ${state.side === 'L' ? 'left' : 'right'} only` : state.on ? 'Sound: clearer' : 'Sound'; };
  const apply = async () => { draw(); tell(); if (state.on || state.side) { try { await wire(media()); tell(); } catch (e) { console.warn('sound:', e); toast('The sound could not be changed in this browser.', 6000); } } };
  const close = () => { pop.hidden = true; btn.setAttribute('aria-expanded', 'false'); };
  btn.addEventListener('click', () => { pop.hidden = !pop.hidden; btn.setAttribute('aria-expanded', String(!pop.hidden)); });
  chk.addEventListener('change', () => { state.on = chk.checked; try { localStorage.setItem(KEY, state.on ? '1' : '0'); } catch (e) {} apply(); });
  seg.addEventListener('click', e => { const b = e.target.closest('button'); if (!b) return; state.side = b.dataset.v; apply(); if (state.side) toast(`Only the ${state.side === 'L' ? 'left' : 'right'} side is heard; the other is silenced. Your file is not changed.`, 4000); });
  document.addEventListener('pointerdown', e => { if (!pop.hidden && !box.contains(e.target)) close(); }, true);
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && !pop.hidden) { close(); btn.focus(); } });
  draw(); if (state.on) apply();
  return { refresh() { if (state.on || state.side) apply(); } };
}
if (['localhost', '127.0.0.1'].includes(location.hostname)) window.__sound = { state, get ctx() { return ctx; }, nodes, wired };
