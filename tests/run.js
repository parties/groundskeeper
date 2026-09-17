#!/usr/bin/env node
'use strict';
// groundskeeper test suite (pure Node, cross-platform). Run: node tests/run.js
const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFileSync } = require('child_process');

const SCRIPTS = path.join(__dirname, '..', 'plugins', 'groundskeeper', 'scripts');
let pass = 0, fail = 0;
const ok = (m) => { console.log('ok   - ' + m); pass++; };
const no = (m) => { console.log('FAIL - ' + m); fail++; };
const eq = (a, b, m) => (a === b ? ok(m) : no(`${m} (got ${JSON.stringify(a)} want ${JSON.stringify(b)})`));
const yes = (c, m) => (c ? ok(m) : no(m));

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'gk-'));
process.on('exit', () => { try { fs.rmSync(TMP, { recursive: true, force: true }); } catch {} });

const CFG = path.join(TMP, '.claude');
const ENV = Object.assign({}, process.env, { CLAUDE_CONFIG_DIR: CFG });
process.env.CLAUDE_CONFIG_DIR = CFG;
fs.mkdirSync(path.join(CFG, 'skills'), { recursive: true });
fs.mkdirSync(path.join(CFG, 'groundskeeper'), { recursive: true });

const lib = require(path.join(SCRIPTS, 'lib.js'));
const P = lib.paths();
const now = Math.floor(Date.now() / 1000), day = 86400;

function mkskill(name, mtime) {
  const d = path.join(CFG, 'skills', name);
  fs.mkdirSync(d, { recursive: true });
  const sm = path.join(d, 'SKILL.md');
  fs.writeFileSync(sm, `---\nname: ${name}\n---\nbody\n`);
  fs.utimesSync(sm, mtime, mtime);
}
function adu(skill, ts) { fs.appendFileSync(P.GK_USAGE, JSON.stringify({ ts, t: 'x', skill }) + '\n'); }
function coldNames() { return lib.report(P).personal_cold.map((r) => r.skill).sort(); }

// --- log.js records the skill name ---
execFileSync('node', [path.join(SCRIPTS, 'log.js')], {
  input: '{"tool_name":"Skill","tool_input":{"skill":"foo:bar"}}', env: ENV,
});
eq(JSON.parse(fs.readFileSync(P.GK_USAGE, 'utf8').trim().split('\n').pop()).skill, 'foo:bar', 'log.js records skill name');
fs.rmSync(P.GK_USAGE);

// --- cold math (default cold_days=45, grace=14) ---
mkskill('hot', now - 200 * day); adu('hot', now - 1 * day);
mkskill('coldone', now - 200 * day); adu('coldone', now - 50 * day);
mkskill('fresh', now - 5 * day);
mkskill('deadold', now - 100 * day);
mkskill('idle44', now - 200 * day); adu('idle44', now - 44 * day);

eq(coldNames().join(','), 'coldone,deadold', 'cold set = coldone + deadold (45d default)');
eq(lib.report(P).config.cold_days, 45, 'default cold_days = 45');
yes(!coldNames().includes('idle44'), 'idle44 (44d < 45) not cold');
yes(!coldNames().includes('fresh'), 'fresh (grace) not cold');
yes(!coldNames().includes('hot'), 'hot not cold');

// --- configurable threshold ---
lib.setConfig(P, 'cold_days', 60);
yes(!coldNames().includes('coldone'), 'cold_days=60: coldone (50d) not cold');
lib.setConfig(P, 'cold_days', 30);
yes(coldNames().includes('coldone') && coldNames().includes('idle44'), 'cold_days=30: coldone + idle44 cold');
lib.setConfig(P, 'cold_days', 45); // reset
eq(/error/.test(lib.setConfig(P, 'bogus', 5)), true, 'config rejects unknown key');
eq(/error/.test(lib.setConfig(P, 'cold_days', 'abc')), true, 'config rejects non-int value');
eq(JSON.parse(execFileSync('node', [path.join(SCRIPTS, 'audit.js'), 'config'], { env: ENV }).toString()).cold_days, 45, 'audit.js config get works');

// --- keep (permanent suppression) ---
lib.keepAdd(P, 'coldone');
yes(!coldNames().includes('coldone'), 'kept skill excluded from cold');
yes(lib.report(P).suppressed.some((s) => s.skill === 'coldone' && s.reason === 'kept'), 'kept skill listed in suppressed');
lib.keepRemove(P, 'coldone');
yes(coldNames().includes('coldone'), 'unkept skill cold again');

// --- snooze (temporary suppression) ---
lib.snoozeAdd(P, 'coldone', 10);
yes(!coldNames().includes('coldone'), 'snoozed skill excluded from cold');
yes(lib.report(P).suppressed.some((s) => s.skill === 'coldone' && s.reason === 'snoozed' && s.until), 'snoozed skill listed with until date');
// expire the snooze (set until in the past)
{ const st = lib.readState(P); st.snoozed.coldone = now - 1; lib.writeState(P, st); }
yes(coldNames().includes('coldone'), 'expired snooze: skill cold again');
lib.snoozeRemove(P, 'coldone');

// --- disable / restore ---
lib.disableOne(P, 'coldone');
yes(fs.existsSync(path.join(CFG, 'skills-disabled', 'coldone')) && !fs.existsSync(path.join(CFG, 'skills', 'coldone')), 'disable moves to graveyard');
eq(lib.readState(P).disabled.coldone.orig_path, path.join(CFG, 'skills', 'coldone'), 'disable records orig_path');
yes(fs.existsSync(path.join(CFG, 'skills-disabled', 'coldone', '.groundskeeper-restore')), 'disable writes restore note');
lib.restoreOne(P, 'coldone');
yes(fs.existsSync(path.join(CFG, 'skills', 'coldone')) && !fs.existsSync(path.join(CFG, 'skills-disabled', 'coldone')), 'restore moves back');
eq(lib.readState(P).disabled.coldone, undefined, 'restore clears state');

// --- refuses plugin key ---
yes(/can't be disabled/.test(lib.disableOne(P, 'foo:bar')), 'refuses plugin key');
yes(!fs.existsSync(path.join(CFG, 'skills-disabled', 'foo:bar')), 'plugin key not moved');

// --- nudge: cap + suppression ---
fs.writeFileSync(P.GK_STATE, JSON.stringify({ last_nudge: now, disabled: {} }));
eq(execFileSync('node', [path.join(SCRIPTS, 'nudge.js')], { env: ENV }).toString(), '', 'nudge silent within cap window');

fs.writeFileSync(P.GK_STATE, JSON.stringify({ last_nudge: now - 8 * day, kept: { coldone: true, deadold: true } }));
eq(execFileSync('node', [path.join(SCRIPTS, 'nudge.js')], { env: ENV }).toString(), '', 'nudge silent when all cold skills suppressed');

fs.writeFileSync(P.GK_STATE, JSON.stringify({ last_nudge: now - 8 * day, disabled: {} }));
const out = execFileSync('node', [path.join(SCRIPTS, 'nudge.js')], { env: ENV }).toString();
yes(/cold 45d\+/.test(out), 'nudge fires after window with cold skills (uses config window)');
yes(lib.readState(P).last_nudge > now - 8 * day, 'nudge updates last_nudge');

// --- symlinked skills + nested libraries -----------------------------------
// The shape that used to scan as zero skills: ~/.claude/skills entries that are
// symlinks into a git repo, and library entries holding skills/<name>/SKILL.md
// instead of a SKILL.md of their own.
const EXT = path.join(TMP, 'external');
const symType = process.platform === 'win32' ? 'junction' : 'dir';
let symlinksWork = true;

// a single skill living outside the skills dir, linked in
const extSkill = path.join(EXT, 'linked-solo');
fs.mkdirSync(extSkill, { recursive: true });
fs.writeFileSync(path.join(extSkill, 'SKILL.md'), '---\nname: linked-solo\n---\nbody\n');
fs.utimesSync(path.join(extSkill, 'SKILL.md'), now - 200 * day, now - 200 * day);

// a library of skills, linked in the same way
const extLib = path.join(EXT, 'linked-lib');
for (const n of ['alpha', 'beta']) {
  const d = path.join(extLib, 'skills', n);
  fs.mkdirSync(d, { recursive: true });
  fs.writeFileSync(path.join(d, 'SKILL.md'), `---\nname: ${n}\n---\nbody\n`);
  fs.utimesSync(path.join(d, 'SKILL.md'), now - 200 * day, now - 200 * day);
}

try {
  fs.symlinkSync(extSkill, path.join(CFG, 'skills', 'linked-solo'), symType);
  fs.symlinkSync(extLib, path.join(CFG, 'skills', 'linked-lib'), symType);
} catch { symlinksWork = false; }

if (!symlinksWork) {
  console.log('skip - symlink tests (no symlink privilege on this platform)');
} else {
  const rows = lib.discover(P);
  const keys = rows.map((r) => r.key);
  yes(keys.includes('linked-solo'), 'symlinked single skill is discovered');
  yes(keys.includes('linked-lib:alpha') && keys.includes('linked-lib:beta'), 'symlinked library discovered as lib:skill');

  const byKey = {};
  for (const r of rows) byKey[r.key] = r;
  eq(byKey['linked-lib:alpha'].scope, 'personal', 'library skill keeps personal scope');
  eq(byKey['linked-lib:alpha'].plugin, 'linked-lib', 'library skill records its library name');

  // disableOne gates on isRemovable, so this is the prune rule for both
  eq(lib.isRemovable(P, byKey['linked-solo']), false, 'symlinked skill is not removable (resolves outside skills dir)');
  eq(lib.isRemovable(P, byKey['linked-lib:alpha']), false, 'library skill is not removable (composite key)');
  eq(lib.isRemovable(P, { scope: 'personal', key: 'deadold' }), true, 'real in-tree skill is removable');
  eq(lib.isRemovable(P, { scope: 'plugin', key: 'p:x' }), false, 'plugin skill is not removable');

  // and disableOne refuses without moving anything
  yes(/can't be disabled/.test(lib.disableOne(P, 'linked-solo')), 'disableOne refuses a symlinked skill');
  yes(fs.existsSync(path.join(extSkill, 'SKILL.md')), 'refused symlink target left untouched');
  yes(fs.existsSync(path.join(CFG, 'skills', 'linked-solo')), 'refused symlink itself left in place');

  // the report exposes the flag
  const rep = lib.report(P);
  const solo = rep.personal_cold.find((r) => r.skill === 'linked-solo');
  yes(solo && solo.removable === false, 'report carries removable=false for symlinked cold skill');
  const dead = rep.personal_cold.find((r) => r.skill === 'deadold');
  yes(dead && dead.removable === true, 'report carries removable=true for in-tree cold skill');

  // a link pointing back up the tree must not report the same skill twice
  try { fs.symlinkSync(extLib, path.join(extLib, 'skills', 'loop'), symType); } catch {}
  const looped = lib.discover(P).map((r) => r.key);
  eq(looped.length, new Set(looped).size, 'symlink cycle yields no duplicate skills');
}

console.log('----');
console.log(`pass=${pass} fail=${fail}`);
process.exit(fail ? 1 : 0);
