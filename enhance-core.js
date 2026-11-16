/* Clearer speech: one small sound processor, used the same way wherever Mixtape plays or saves sound, so what is saved
   sounds like what was heard. Plain arithmetic on the samples; no AI, no outside code, nothing sent anywhere.

   In order:
   1. rumble and mains hum below the voice are cut (a steep high-pass at 100 Hz);
   2. the part of the voice that carries the consonants is lifted a little (a gentle rise around 3 kHz);
   3. the level is evened out: quiet speech is brought up and loud speech held back, so a soft speaker and a loud one
      end up near each other (a compressor with make-up gain); what lies well below speech (room noise between
      words) is not brought up with it, and is turned down a little;
   4. nothing can clip (a limiter just under full scale).
   Both sides of a stereo sound get the same gain at every moment, so the picture between them does not move.

   It does not take noise out from under a voice: that needs a model, and is not here.

   side: 'L' or 'R' keeps only that side of a two-sided sound and puts it on both (a call recorded with each person on
   their own side is heard with one of them silenced); '' keeps both. It works with or without "clearer speech". */
const dB = x => Math.pow(10, x / 20);
const THRESH = -32, RATIO = 3, KNEE = 8, MAKEUP = 13;      // dB: where evening-out begins, how hard, how gently, and the lift after
const FLOOR = -58, FLOOR_CUT = 9;                           // dB: below this is room noise; it is turned down by up to this much
const CEIL = dB(-1);                                        // the limiter's ceiling

function highpass(sr, hz) { const w = 2 * Math.PI * hz / sr, c = Math.cos(w), a = Math.sin(w) / (2 * Math.SQRT1_2), a0 = 1 + a; return [(1 + c) / 2 / a0, -(1 + c) / a0, (1 + c) / 2 / a0, -2 * c / a0, (1 - a) / a0]; }
function peaking(sr, hz, q, gain) { const A = Math.pow(10, gain / 40), w = 2 * Math.PI * Math.min(hz, sr * 0.45) / sr, c = Math.cos(w), a = Math.sin(w) / (2 * q), a0 = 1 + a / A; return [(1 + a * A) / a0, -2 * c / a0, (1 - a * A) / a0, -2 * c / a0, (1 - a / A) / a0]; }

/* the gain (in dB) for a level (in dB): evening-out above the threshold, a soft knee, less lift for what is below speech */
export function gainFor(level) {
  let g = MAKEUP; const over = level - THRESH;
  if (over > KNEE / 2) g -= over * (1 - 1 / RATIO); else if (over > -KNEE / 2) g -= (1 - 1 / RATIO) * (over + KNEE / 2) ** 2 / (2 * KNEE);
  if (level < FLOOR + 12) g -= Math.min(MAKEUP + FLOOR_CUT, (FLOOR + 12 - level) * 1.5); // room noise: the lift is taken back, then a little more
  return g;
}

/* A processor for one stream. process(data, frames, channels) changes interleaved samples in place and may be called
   piece after piece: the sound comes out the same however it is cut into pieces. */
export function makeEnhancer(sampleRate, { on = true, side = '' } = {}) {
  const hp = highpass(sampleRate, 100), pk = peaking(sampleRate, 3000, 0.8, 4);
  const st = []; // per channel: the two filters' memories
  const att = Math.exp(-1 / (sampleRate * 0.004)), rel = Math.exp(-1 / (sampleRate * 0.16)), gs = Math.exp(-1 / (sampleRate * 0.012)), lrel = Math.exp(-1 / (sampleRate * 0.08));
  let env = 0, gain = dB(gainFor(-90)), lim = 1;
  const api = {
    on, side,
    process(data, frames, ch) {
      const k = api.side === 'R' ? 1 : 0, one = !!api.side && ch > 1;
      while (st.length < ch) st.push(new Float64Array(12));
      for (let i = 0; i < frames; i++) {
        const o = i * ch;
        if (one) { const v = data[o + k]; for (let c = 0; c < ch; c++) data[o + c] = v; }
        if (!api.on) continue;
        let peak = 0;
        for (let c = 0; c < ch; c++) {
          const s = st[c]; let x = data[o + c];
          let y = hp[0] * x + hp[1] * s[0] + hp[2] * s[1] - hp[3] * s[2] - hp[4] * s[3]; s[1] = s[0]; s[0] = x; s[3] = s[2]; s[2] = y; x = y;
          y = hp[0] * x + hp[1] * s[8] + hp[2] * s[9] - hp[3] * s[10] - hp[4] * s[11]; s[9] = s[8]; s[8] = x; s[11] = s[10]; s[10] = y; x = y; // twice over: a steeper cut
          y = pk[0] * x + pk[1] * s[4] + pk[2] * s[5] - pk[3] * s[6] - pk[4] * s[7]; s[5] = s[4]; s[4] = x; s[7] = s[6]; s[6] = y;
          data[o + c] = y; const a = y < 0 ? -y : y; if (a > peak) peak = a;
        }
        env = peak > env ? att * env + (1 - att) * peak : rel * env + (1 - rel) * peak;      // how loud it is just now, both sides together
        const want = dB(gainFor(20 * Math.log10(env + 1e-9))); gain = gs * gain + (1 - gs) * want; // the gain moves smoothly, so it is not heard working
        let top = 0; for (let c = 0; c < ch; c++) { const v = data[o + c] * gain; data[o + c] = v; const a = v < 0 ? -v : v; if (a > top) top = a; }
        const need = top * lim > CEIL ? CEIL / top : 1; lim = need < lim ? need : Math.min(1, lrel * lim + (1 - lrel) * 1); // the limiter drops at once and lets go slowly
        if (lim < 1) for (let c = 0; c < ch; c++) data[o + c] *= lim;
      }
      return data;
    },
  };
  return api;
}
