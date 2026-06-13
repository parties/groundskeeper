#!/usr/bin/env node
'use strict';
// groundskeeper usage logger. Wired to PostToolUse(matcher=Skill).
// Hot path: must NEVER block a skill. No stdout, always exit 0.
const fs = require('fs');
const { paths } = require('./lib');

function record(input) {
  let skill = '';
  try {
    const o = JSON.parse(input);
    const ti = (o && o.tool_input) || {};
    skill = ti.skill || ti.name || ti.skill_name || '';
  } catch {
    const m = input.match(/"skill"\s*:\s*"([^"]*)"/);
    if (m) skill = m[1];
  }
  if (!skill || typeof skill !== 'string') return;

  const P = paths();
  try { fs.mkdirSync(P.GK_DATA, { recursive: true }); } catch {}
  const line = JSON.stringify({ ts: Math.floor(Date.now() / 1000), t: new Date().toISOString(), skill }) + '\n';
  try { fs.appendFileSync(P.GK_USAGE, line); } catch {}
}

let buf = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (d) => { buf += d; });
process.stdin.on('end', () => { try { record(buf); } catch {} process.exit(0); });
process.stdin.on('error', () => process.exit(0));
