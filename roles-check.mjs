// node roles-check.mjs : the rules for "who is who" and "a notation belongs here".
// The hearing below is invented (no real case, no real people). If the private fixture made from a real test recording
// is on this computer (_test/roles/fixtures.json, never published), the same rules are checked on it too.
import fs from 'node:fs';
import { roles, inserts, turns } from './roles-core.js';
let pass = 0, fail = 0; const check = (name, ok, got) => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : '  |  got: ' + JSON.stringify(got)}`); ok ? pass++ : fail++; };
const make = lines => { const out = []; let t = 0; for (const [sp, text] of lines) text.split(' ').forEach((w, k) => { out.push({ t: w, s: +(t += 0.3).toFixed(2), e: +(t + 0.2).toFixed(2), ...(k === 0 ? { p: true, sp } : {}) }); }); return out; };

// as a recogniser gives it: lower case, no punctuation, and the fast exchange at the start heard as one voice (Speaker 1)
const HEARING = [
  ['Speaker 1', 'any objection lack of foundation your honor overruled thank you your honor i move into evidence the lease as exhibit number twelve no further questions'],
  ['Speaker 2', 'good afternoon ms dlamini'],
  ['Speaker 3', 'good afternoon'],
  ['Speaker 2', 'you are the owner of the flat on harbour road right'],
  ['Speaker 3', 'yes i am'],
  ['Speaker 2', 'and did you sign the lease yourself'],
  ['Speaker 3', 'i did'],
  ['Speaker 2', 'when was that'],
  ['Speaker 3', 'in march i think the fourth of march'],
  ['Speaker 1', 'objection your honor leading sustained'],
  ['Speaker 2', 'what happened after you signed'],
  ['Speaker 3', 'he moved in the same week and he paid the deposit in cash'],
  ['Speaker 2', 'did he pay the rent every month'],
  ['Speaker 3', 'no only the first two months'],
  ['Speaker 2', 'and how much is still owing'],
  ['Speaker 3', 'about nine thousand'],
  ['Speaker 4', 'sorry could you repeat that'],
  ['Speaker 2', 'is that amount in the statement you gave the court'],
  ['Speaker 3', 'it is'],
  ['Speaker 2', 'do you have any other agreement with him'],
  ['Speaker 3', 'i do not'],
];
const ASKS = /^(you are .* right|and did .*|when was that|what happened .*|did he .*|and how much .*|is that amount .*|do you have .*|sorry could .*)$/;
const MARKED = HEARING.map(([sp, t]) => [sp, t.replace(ASKS, m => m[0].toUpperCase() + m.slice(1) + '?')]);

for (const [kind, lines] of [['as heard', HEARING], ['with punctuation', MARKED]]) {
  const w = make(lines), r = roles(w), by = Object.fromEntries(r.map(x => [x.label, x]));
  check(`${kind}: the one who answers is the witness, and sure of it`, by['Speaker 3'].role === 'witness' && by['Speaker 3'].sure, by['Speaker 3']);
  check(`${kind}: the one who asks is the examiner, and sure of it`, by['Speaker 2'].role === 'examiner' && by['Speaker 2'].sure, by['Speaker 2']);
  check(`${kind}: a voice with the court's words and counsel's is flagged as two people, not named`, by['Speaker 1'].role === 'mixed' && by['Speaker 1'].mixedAt.length >= 4, by['Speaker 1']);
  check(`${kind}: one turn is not enough to say`, by['Speaker 4'].role === '', by['Speaker 4']);
  check(`${kind}: every answer carries its evidence`, r.filter(x => x.role).every(x => x.evidence.length && x.evidence[0].length > 10), r.map(x => x.evidence));
  check(`${kind}: the witness's name comes from the examiner's greeting`, by['Speaker 3'].name === 'MS. DLAMINI', by['Speaker 3'].name);
  const ins = inserts(w);
  check(`${kind}: the exhibit is pointed at, as offered (not as received), with its notation`, ins.length === 1 && ins[0].kind === 'exhibit' && ins[0].i === 0 && ins[0].text === '(Exhibit twelve offered into evidence.)', ins);
}
{ const w = make([['Speaker 1', 'so thanks for coming in tell me where did you grow up'], ['Speaker 2', 'well i grew up near the stadium we lived with my grandmother'], ['Speaker 1', 'okay and what was it like'], ['Speaker 2', 'honestly it was like the whole street woke up at night'], ['Speaker 1', 'did you play too'], ['Speaker 2', 'of course i played until my mother called me in']]);
  const r = roles(w);
  check('an interview: nobody is called the court or two people, and no notation is pointed at', !r.some(x => x.role === 'court' || x.role === 'mixed') && inserts(w).length === 0, r.map(x => [x.label, x.role])); }
{ const w = make([['A', 'do you swear to tell the truth'], ['B', 'i do'], ['A', "we'll take a short recess"], ['B', 'thank you'], ['A', 'we are going off the record'], ['B', 'okay'], ['A', 'back on the record']]);
  const k = w.findIndex(x => x.t === "we'll"); w.splice(k, 0, { t: '(Witness', s: 2.8, e: 2.8, p: true, lg: { k: 'n' } }, { t: 'sworn.)', s: 2.8, e: 2.8 });
  const ins = inserts(w), ts = turns(w);
  check('an oath, a recess, off and back on the record are pointed at', ins.map(x => x.kind).join() === 'oath,recess,off,on' && ins[0].text === '(Witness sworn.)', ins.map(x => [x.kind, x.text]));
  check('a notation already in the transcript is not read as speech', !ts.some(t => /sworn\./.test(t.text)), ts.map(t => t.text)); }

const priv = new URL('./_test/roles/fixtures.json', import.meta.url);
if (fs.existsSync(priv)) {
  const fx = JSON.parse(fs.readFileSync(priv));
  for (const kind of ['court_plain', 'court_marked']) {
    const r = roles(fx[kind]), by = Object.fromEntries(r.map(x => [x.label, x])), ins = inserts(fx[kind]);
    check(`real test recording (private), ${kind}: witness, examiner, the two-in-one voice and the exhibit`, by['Speaker 4'].role === 'witness' && by['Speaker 2'].role === 'examiner' && by['Speaker 1'].role === 'mixed' && by['Speaker 3'].role === '' && ins.length === 1 && ins[0].kind === 'exhibit', r.map(x => [x.label, x.role]));
  }
}
console.log(`${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
