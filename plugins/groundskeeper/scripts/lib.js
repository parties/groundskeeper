'use strict';
// groundskeeper shared library. Pure Node (fs/path/os) — no external deps.
const fs = require('fs');
const path = require('path');
const os = require('os');

const DEFAULTS = { cold_days: 45, grace_days: 14, nudge_days: 7, snooze_days: 30 };
const CONFIG_KEYS = Object.keys(DEFAULTS);

function claudeDir() {
  return process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude');
}

function paths() {
  const dir = claudeDir();
  const data = path.join(dir, 'groundskeeper');
  return {
    CLAUDE_DIR: dir,
    GK_DATA: data,
    GK_USAGE: path.join(data, 'usage.jsonl'),
    GK_STATE: path.join(data, 'state.json'),
    GK_CONFIG: path.join(data, 'config.json'),
    PERSONAL_SKILLS: path.join(dir, 'skills'),
    PLUGINS_DIR: path.join(dir, 'plugins'),
    GRAVEYARD: path.join(dir, 'skills-disabled'),
  };
}

function nowS() { return Math.floor(Date.now() / 1000); }
function isoDay(ts) { return new Date(ts * 1000).toISOString().slice(0, 10); }

function mtimeS(file) {
  try { return Math.floor(fs.statSync(file).mtimeMs / 1000); } catch { return 0; }
}

// ---- config ----
function readConfig(P) {
  let c = {};
  try { c = JSON.parse(fs.readFileSync(P.GK_CONFIG, 'utf8')) || {}; } catch {}
  const out = Object.assign({}, DEFAULTS);
  for (const k of CONFIG_KEYS) if (typeof c[k] === 'number' && c[k] > 0) out[k] = Math.floor(c[k]);
  return out;
}

function setConfig(P, key, val) {
  if (!CONFIG_KEYS.includes(key)) return `error: unknown config key '${key}' (valid: ${CONFIG_KEYS.join(', ')})`;
  const n = Number(val);
  if (!Number.isFinite(n) || n <= 0 || Math.floor(n) !== n) return `error: '${key}' must be a positive integer`;
  const c = readConfig(P);
  c[key] = n;
  fs.mkdirSync(P.GK_DATA, { recursive: true });
  const tmp = P.GK_CONFIG + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(c, null, 2));
  fs.renameSync(tmp, P.GK_CONFIG);
  return `set ${key} = ${n}`;
}

// ---- usage + discovery ----
function readUsage(P) {
  const map = {};
  let data;
  try { data = fs.readFileSync(P.GK_USAGE, 'utf8'); } catch { return map; }
  for (const line of data.split('\n')) {
    const s = line.trim();
    if (!s) continue;
    let o;
    try { o = JSON.parse(s); } catch { continue; }
    if (!o || typeof o.skill !== 'string' || typeof o.ts !== 'number') continue;
    const e = map[o.skill] || { count: 0, first: o.ts, last: o.ts };
    e.count += 1;
    if (o.ts < e.first) e.first = o.ts;
    if (o.ts > e.last) e.last = o.ts;
    map[o.skill] = e;
  }
  return map;
}

function listDirs(d) {
  try {
    return fs.readdirSync(d, { withFileTypes: true })
      .filter((e) => e.isDirectory()).map((e) => e.name);
  } catch { return []; }
}

function pluginNameFor(skillMd) {
  let dir = path.dirname(skillMd);
  while (dir && dir !== path.dirname(dir)) {
    const pj = path.join(dir, '.claude-plugin', 'plugin.json');
    if (fs.existsSync(pj)) {
      try { return JSON.parse(fs.readFileSync(pj, 'utf8')).name || ''; } catch { return ''; }
    }
    dir = path.dirname(dir);
  }
  return '';
}

function findPluginSkillMds(root) {
  const out = [];
  const re = /[\\/]skills[\\/][^\\/]+[\\/]SKILL\.md$/;
  (function walk(dir, depth) {
    if (depth > 8) return;
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) walk(full, depth + 1);
      else if (e.isFile() && e.name === 'SKILL.md' && re.test(full)) out.push(full);
    }
  })(root, 0);
  return out;
}

function discover(P) {
  const rows = [];
  for (const name of listDirs(P.PERSONAL_SKILLS)) {
    const sm = path.join(P.PERSONAL_SKILLS, name, 'SKILL.md');
    if (!fs.existsSync(sm)) continue;
    rows.push({ scope: 'personal', key: name, plugin: '', path: sm, mtime: mtimeS(sm) });
  }
  for (const sm of findPluginSkillMds(P.PLUGINS_DIR)) {
    const skill = path.basename(path.dirname(sm));
    const plugin = pluginNameFor(sm) || 'unknown';
    rows.push({ scope: 'plugin', key: `${plugin}:${skill}`, plugin, path: sm, mtime: mtimeS(sm) });
  }
  const byKey = {};
  for (const r of rows) if (!byKey[r.key] || r.mtime > byKey[r.key].mtime) byKey[r.key] = r;
  return Object.values(byKey);
}

function basename(key) {
  const i = key.indexOf(':');
  return i >= 0 ? key.slice(i + 1) : key;
}

// ---- state ----
function readState(P) {
  try { return JSON.parse(fs.readFileSync(P.GK_STATE, 'utf8')); } catch { return {}; }
}
function writeState(P, st) {
  fs.mkdirSync(P.GK_DATA, { recursive: true });
  const tmp = P.GK_STATE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(st, null, 2));
  fs.renameSync(tmp, P.GK_STATE);
}

// suppression resolver: kept (permanent) or snoozed (until ts)
function suppressionFn(state, now) {
  const kept = state.kept || {};
  const sn = state.snoozed || {};
  return (skill) => {
    if (kept[skill]) return { reason: 'kept' };
    const u = sn[skill];
    if (typeof u === 'number' && u > now) return { reason: 'snoozed', until: u };
    return null;
  };
}

// ---- report ----
function report(P) {
  const cfg = readConfig(P);
  const usage = readUsage(P);
  const disc = discover(P);
  const now = nowS();
  const state = readState(P);
  const supp = suppressionFn(state, now);

  const GRACE = cfg.grace_days * 86400;
  const COLD = cfg.cold_days * 86400;

  const firsts = Object.values(usage).map((u) => u.first);
  const trackingSince = firsts.length ? firsts.reduce((a, b) => Math.min(a, b), Infinity) : now;

  const byBase = {};
  for (const [k, v] of Object.entries(usage)) byBase[basename(k)] = v;

  const rows = disc.map((d) => {
    const u = usage[d.key] || byBase[basename(d.key)] || null;
    const firstSeen = u ? Math.min(u.first, d.mtime || u.first) : (d.mtime || now);
    const age = now - firstSeen;
    const idle = u ? (now - u.last) : (now - trackingSince);
    const cold = age >= GRACE && idle >= COLD;
    const s = supp(d.key);
    return {
      scope: d.scope, key: d.key, plugin: d.plugin,
      uses: u ? u.count : 0, last_ts: u ? u.last : null,
      age, idle, cold, suppressed: !!s, supp: s,
    };
  });

  const fmt = (arr) => arr.map((r) => ({
    skill: r.key,
    last_used: r.last_ts ? isoDay(r.last_ts) : null,
    days_cold: Math.floor(r.idle / 86400),
    uses: r.uses,
  }));

  const coldRows = rows.filter((r) => r.cold && !r.suppressed);

  const byPlugin = {};
  for (const r of rows.filter((r) => r.scope === 'plugin' && !r.suppressed)) {
    (byPlugin[r.plugin] = byPlugin[r.plugin] || []).push(r);
  }
  const pluginsFullyCold = Object.entries(byPlugin)
    .filter(([, rs]) => rs.length > 0 && rs.every((r) => r.cold))
    .map(([plugin, rs]) => ({ plugin, skills: rs.map((r) => r.key) }));

  const suppressed = rows.filter((r) => r.suppressed).map((r) => ({
    skill: r.key,
    reason: r.supp.reason,
    until: r.supp.until ? isoDay(r.supp.until) : undefined,
    would_be_cold: r.cold,
  }));

  return {
    config: cfg,
    total: rows.length,
    cold_count: coldRows.length,
    hot_count: rows.filter((r) => !r.cold && !r.suppressed).length,
    suppressed_count: suppressed.length,
    personal_cold: fmt(coldRows.filter((r) => r.scope === 'personal')),
    plugin_cold: fmt(coldRows.filter((r) => r.scope === 'plugin')),
    plugins_fully_cold: pluginsFullyCold,
    suppressed,
  };
}

// ---- keep / snooze ----
function keepAdd(P, name) {
  const s = readState(P); s.kept = s.kept || {}; s.kept[name] = true; writeState(P, s);
  return `keeping '${name}' (excluded from cold reports + nudges)`;
}
function keepRemove(P, name) {
  const s = readState(P); if (s.kept) delete s.kept[name]; writeState(P, s);
  return `unkept '${name}'`;
}
function snoozeAdd(P, name, days) {
  const cfg = readConfig(P);
  const d = days && days > 0 ? Math.floor(days) : cfg.snooze_days;
  const until = nowS() + d * 86400;
  const s = readState(P); s.snoozed = s.snoozed || {}; s.snoozed[name] = until; writeState(P, s);
  return `snoozed '${name}' for ${d}d (until ${isoDay(until)})`;
}
function snoozeRemove(P, name) {
  const s = readState(P); if (s.snoozed) delete s.snoozed[name]; writeState(P, s);
  return `unsnoozed '${name}'`;
}

// ---- disable / restore ----
function disableOne(P, name) {
  if (name.includes(':')) return `skip '${name}': plugin skills can't be disabled individually`;
  const src = path.join(P.PERSONAL_SKILLS, name);
  let st;
  try { st = fs.statSync(src); } catch { return `skip '${name}': not found in ${P.PERSONAL_SKILLS}`; }
  if (!st.isDirectory()) return `skip '${name}': not a directory`;

  const resolved = fs.realpathSync(src);
  const base = fs.realpathSync(P.PERSONAL_SKILLS);
  if (path.dirname(resolved) !== base) return `skip '${name}': refusing path outside skills dir`;

  fs.mkdirSync(P.GRAVEYARD, { recursive: true });
  const dst = path.join(P.GRAVEYARD, name);
  if (fs.existsSync(dst)) return `skip '${name}': already in graveyard`;

  const all = [...report(P).personal_cold];
  const row = all.find((r) => r.skill === name) || {};
  fs.renameSync(src, dst);

  const note = [
    'groundskeeper disabled this skill (reversible).',
    `name: ${name}`,
    `disabled_on: ${new Date().toISOString()}`,
    `last_used: ${row.last_used || 'never'}`,
    `days_cold: ${row.days_cold != null ? row.days_cold : 'unknown'}`,
    `orig_path: ${src}`,
    `restore: audit.js restore ${name}`,
    '',
  ].join('\n');
  try { fs.writeFileSync(path.join(dst, '.groundskeeper-restore'), note); } catch {}

  const state = readState(P);
  state.disabled = state.disabled || {};
  state.disabled[name] = {
    disabled_on: nowS(),
    last_used: row.last_used || null,
    days_cold: row.days_cold != null ? row.days_cold : null,
    orig_path: src,
  };
  writeState(P, state);
  return `disabled '${name}' -> ${dst}`;
}

function restoreOne(P, name) {
  const src = path.join(P.GRAVEYARD, name);
  const dst = path.join(P.PERSONAL_SKILLS, name);
  try { if (!fs.statSync(src).isDirectory()) throw new Error('nd'); }
  catch { return `skip '${name}': not in graveyard`; }
  if (fs.existsSync(dst)) return `skip '${name}': already exists at ${dst}`;
  fs.mkdirSync(P.PERSONAL_SKILLS, { recursive: true });
  try { fs.unlinkSync(path.join(src, '.groundskeeper-restore')); } catch {}
  fs.renameSync(src, dst);
  const state = readState(P);
  if (state.disabled) delete state.disabled[name];
  writeState(P, state);
  return `restored '${name}' -> ${dst}`;
}

module.exports = {
  paths, nowS, report, discover, readUsage,
  readConfig, setConfig, DEFAULTS, CONFIG_KEYS,
  readState, writeState, keepAdd, keepRemove, snoozeAdd, snoozeRemove,
  disableOne, restoreOne,
};
