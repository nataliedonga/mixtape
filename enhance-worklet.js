/* "Clearer speech" and "one side only" while listening: the same processor that is used when saving (enhance-core.js),
   run on the sound as it plays. Messages: { on: true/false } and { side: '' | 'L' | 'R' }. */
import { makeEnhancer } from './enhance-core.js';

class MixtapeEnhance extends AudioWorkletProcessor {
  constructor() {
    super(); this.e = makeEnhancer(sampleRate, { on: false, side: '' }); this.buf = new Float32Array(256);
    this.port.onmessage = m => { const d = m.data || {}; if ('on' in d) this.e.on = !!d.on; if ('side' in d) this.e.side = d.side === 'L' || d.side === 'R' ? d.side : ''; };
  }
  process(inputs, outputs) {
    const inp = inputs[0], out = outputs[0]; if (!inp || !inp.length || !out.length) return true;
    const n = inp[0].length, L = inp[0], R = inp[1] || inp[0]; if (this.buf.length < n * 2) this.buf = new Float32Array(n * 2);
    const b = this.buf; for (let i = 0; i < n; i++) { b[i * 2] = L[i]; b[i * 2 + 1] = R[i]; }
    this.e.process(b, n, 2);
    const oL = out[0], oR = out[1] || out[0]; for (let i = 0; i < n; i++) { oL[i] = b[i * 2]; oR[i] = b[i * 2 + 1]; }
    return true;
  }
}
registerProcessor('mixtape-enhance', MixtapeEnhance);
