#!/usr/bin/env node
'use strict';
// groundskeeper audit CLI.
//   report
//   disable <name>...        restore <name>...        list-disabled
//   config [get]             config set <key> <value>
//   keep <name>...           unkeep <name>...
//   snooze <name> [days]     unsnooze <name>...
const lib = require('./lib');
const P = lib.paths();
const argv = process.argv.slice(2);
const cmd = argv[0] || 'report';
const args = argv.slice(1);

function out(s) { process.stdout.write(s + '\n'); }
function err(s) { process.stderr.write(s + '\n'); }
function need(ok, usage) { if (!ok) { err('usage: audit.js ' + usage); process.exit(1); } }

switch (cmd) {
  case 'report':
    out(JSON.stringify(lib.report(P), null, 2));
    break;

  case 'disable':
    need(args.length, 'disable <name>...');
    for (const n of args) out(lib.disableOne(P, n));
    break;

  case 'restore':
    need(args.length, 'restore <name>...');
    for (const n of args) out(lib.restoreOne(P, n));
    break;

  case 'list-disabled':
    out(JSON.stringify(lib.readState(P).disabled || {}, null, 2));
    break;

  case 'config':
    if (args[0] === 'set') {
      need(args.length >= 3, 'config set <key> <value>');
      out(lib.setConfig(P, args[1], args[2]));
    } else {
      out(JSON.stringify(lib.readConfig(P), null, 2));
    }
    break;

  case 'keep':
    need(args.length, 'keep <name>...');
    for (const n of args) out(lib.keepAdd(P, n));
    break;

  case 'unkeep':
    need(args.length, 'unkeep <name>...');
    for (const n of args) out(lib.keepRemove(P, n));
    break;

  case 'snooze':
    need(args.length, 'snooze <name> [days]');
    out(lib.snoozeAdd(P, args[0], args[1] ? Number(args[1]) : undefined));
    break;

  case 'unsnooze':
    need(args.length, 'unsnooze <name>...');
    for (const n of args) out(lib.snoozeRemove(P, n));
    break;

  default:
    err(`groundskeeper audit: unknown command '${cmd}'`);
    err('commands: report | disable | restore | list-disabled | config [set] | keep | unkeep | snooze | unsnooze');
    process.exit(1);
}
