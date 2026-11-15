// The node suites that already exist must still pass.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

export const needsBrowser = false;
const SUITES = ['cutter/check.mjs', 'lyrics-check.cjs', 'transcript-check.cjs', 'roles-check.mjs', 'tags-check.mjs', 'style-check.mjs'];

export async function run(t) {
  for (const s of SUITES) {
    if (!fs.existsSync(path.join(t.root, s))) { t.check(`node ${s}`, 'the suite exists and exits with 0', false, 'the file is missing'); continue; }
    const p = spawnSync(process.execPath, [s], { cwd: t.root, encoding: 'utf8', timeout: 60000 });
    const out = ((p.stdout || '') + (p.stderr || '')).trim().split('\n'), fails = out.filter(l => /^FAIL|^not ok|✗/.test(l.trim()));
    t.check(`node ${s}`, 'exits with 0 and no line says FAIL', p.status === 0 && !fails.length, p.status === 0 && !fails.length ? out[out.length - 1].trim() : `exit ${p.status}${p.error ? ' (' + p.error.message + ')' : ''}; ${fails.length ? fails.slice(0, 4).join(' / ') : out.slice(-3).join(' / ')}`);
  }
}
