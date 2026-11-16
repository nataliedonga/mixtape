// node enhance-check.mjs — the "clearer speech" processor, measured on made-up sound (tones standing in for voices).
import { makeEnhancer, gainFor } from './enhance-core.js';
let pass = 0, fail = 0; const ok = (c, name) => { if (c) pass++; else { fail++; console.log('FAIL ' + name); } };
const SR = 22050, tone = (hz, amp, sec, ch = 1) => { const n = Math.round(SR * sec), d = new Float32Array(n * ch); for (let i = 0; i < n; i++) { const v = amp * Math.sin(2 * Math.PI * hz * i / SR); for (let c = 0; c < ch; c++) d[i * ch + c] = v; } return d; };
const rms = (d, from = 0.5, ch = 1, c = 0) => { let s = 0, n = 0; for (let i = Math.round(d.length / ch * from); i < d.length / ch; i++) { s += d[i * ch + c] ** 2; n++; } return Math.sqrt(s / n); };
const db = x => 20 * Math.log10(x + 1e-12), amp = x => Math.pow(10, x / 20), peak = d => d.reduce((m, v) => Math.max(m, Math.abs(v)), 0);
const run = (d, ch = 1, opts) => makeEnhancer(SR, opts).process(Float32Array.from(d), d.length / ch, ch);

// a quiet voice and a loud voice end up much nearer each other, and the quiet one is brought up
{ const quiet = run(tone(700, amp(-38), 2)), loud = run(tone(700, amp(-8), 2)), before = 30, after = db(rms(loud)) - db(rms(quiet));
  ok(after <= before / 2 && after > 0, `a 30 dB gap between a quiet and a loud voice is at least halved (now ${after.toFixed(1)} dB)`);
  ok(db(rms(quiet)) - (-38 - 3.01) >= 9, `the quiet voice is at least 9 dB louder than it was (${(db(rms(quiet)) - (-38 - 3.01)).toFixed(1)} dB)`); }
// hum and rumble under the voice are cut, compared with a voice at the same level
{ const hum = db(rms(run(tone(50, amp(-20), 2)))), voice = db(rms(run(tone(700, amp(-20), 2))));
  ok(voice - hum >= 10, `50 Hz hum comes out at least 10 dB under a voice of the same level (${(voice - hum).toFixed(1)} dB)`); }
// the consonant range is lifted relative to the body of the voice
{ const body = db(rms(run(tone(400, amp(-45), 2)))), bright = db(rms(run(tone(3000, amp(-45), 2))));
  ok(bright - body >= 2.5 && bright - body <= 5.5, `3 kHz is lifted about 4 dB over 400 Hz (${(bright - body).toFixed(1)} dB)`); }
// nothing clips, even full-scale sound that starts suddenly
{ const d = new Float32Array(SR * 2); d.set(tone(900, 1, 1), SR); const out = run(d);
  ok(peak(out) <= 0.9, `full-scale sound after silence never passes the ceiling (peak ${peak(out).toFixed(3)})`); }
// room noise between words is not brought up
{ const noise = new Float32Array(SR * 2); let seed = 7; for (let i = 0; i < noise.length; i++) { seed = (seed * 16807) % 2147483647; noise[i] = (seed / 2147483647 - 0.5) * 2 * amp(-66); }
  const out = run(noise); ok(db(rms(out)) <= db(rms(noise)) + 1, `noise far below speech is not made louder (${(db(rms(out)) - db(rms(noise))).toFixed(1)} dB)`);
  ok(run(new Float32Array(SR)).every(v => v === 0), 'silence stays silence'); }
// cut into pieces of any size, the sound comes out the same
{ const d = tone(700, amp(-25), 1.5, 2), whole = run(d, 2), e = makeEnhancer(SR), parts = Float32Array.from(d); let i = 0, k = 0; const sizes = [128, 1, 4096, 37, 1024];
  while (i < parts.length / 2) { const n = Math.min(sizes[k++ % sizes.length], parts.length / 2 - i); e.process(parts.subarray(i * 2, (i + n) * 2), n, 2); i += n; }
  let worst = 0; for (let j = 0; j < whole.length; j++) worst = Math.max(worst, Math.abs(whole[j] - parts[j])); ok(worst < 1e-6, `pieces of any size give the same sound as the whole (largest difference ${worst.toExponential(1)})`); }
// both sides get the same gain: a loud left does not leave a quiet right behind
{ const n = SR * 2, d = new Float32Array(n * 2); for (let i = 0; i < n; i++) { d[i * 2] = amp(-10) * Math.sin(2 * Math.PI * 600 * i / SR); d[i * 2 + 1] = amp(-30) * Math.sin(2 * Math.PI * 900 * i / SR); }
  const out = run(d, 2), gap = db(rms(out, 0.5, 2, 0)) - db(rms(out, 0.5, 2, 1)); ok(Math.abs(gap - 20) < 1.5, `the two sides keep their balance (20 dB apart before, ${gap.toFixed(1)} dB after)`); }
// one side only: with and without clearer speech
{ const n = SR, d = new Float32Array(n * 2); for (let i = 0; i < n; i++) { d[i * 2] = 0.2 * Math.sin(2 * Math.PI * 300 * i / SR); d[i * 2 + 1] = 0.2 * Math.sin(2 * Math.PI * 1000 * i / SR); }
  const r = run(d, 2, { on: false, side: 'R' }); let same = true, right = true; for (let i = 0; i < n; i++) { if (r[i * 2] !== r[i * 2 + 1]) same = false; if (r[i * 2] !== d[i * 2 + 1]) right = false; }
  ok(same && right, 'Right only, clearer speech off: the right side is on both sides, untouched, and the left is gone');
  const l = run(d, 2, { on: true, side: 'L' }); let both = true; for (let i = 0; i < n; i++) if (l[i * 2] !== l[i * 2 + 1]) both = false; ok(both && rms(l, 0.5, 2) > 0.05, 'Left only with clearer speech: one voice, on both sides');
  const off = run(d, 2, { on: false }); ok(off.every((v, i) => v === d[i]), 'with everything off the sound is not touched at all'); }
ok(gainFor(-20) < gainFor(-40) && gainFor(-40) > gainFor(-70), 'the gain is highest for quiet speech, lower for loud speech and for room noise');
console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
