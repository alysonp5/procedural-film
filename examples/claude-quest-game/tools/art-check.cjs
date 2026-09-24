#!/usr/bin/env node
// art-check.cjs : the art gate (docs/game-spec.md 13.6, T6). Exits non-zero on any failure.
//
//   node tools/art-check.cjs
//
// Loads src/lib.js and src/manifest.js in a sandbox (no browser, no canvas) and checks:
//   A1 every manifest name has a map in lib.SPRITES_DEF of exactly its declared size (so no name falls
//      back to the magenta placeholder), every row the same length
//   A2 every map (each legend variant) uses at most 3 opaque colours, every one a lib.NES colour, and
//      every key in its rows is '.' or in its legend
//   A3 character maps (everything but tiles, scenery and lift segments) use only the keys 1 2 3 and '.'
//   A4 every name in docs/game-spec.md 9.1 exists at its size, and the new lib.SPAL entries exist,
//      frozen, three NES colours each, with the values 9.1 fixes
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');
const SRC = path.join(ROOT, 'src');

function load() {
  const window = {};
  const ctx = vm.createContext({ window, console, Math, Object, Array, String, Number, Map, Set, WeakMap, JSON, Error, isFinite, parseInt, parseFloat, Float64Array, Uint32Array, Uint8Array, Int16Array, Float32Array });
  for (const f of ['lib.js', 'manifest.js']) vm.runInContext(fs.readFileSync(path.join(SRC, f), 'utf8'), ctx, { filename: f });
  return window.FILM;
}

// docs/game-spec.md 9.1: every new name and its size
const NEW = [];
const add = (name, w, h) => NEW.push([name, w, h]);
['moth1', 'moth2', 'spike_walk1', 'spike_walk2', 'terminal', 'token1', 'token2', 'token3', 'token4', 'ember1', 'ember2', 'spring1', 'spring2', 'spring3', 't_rackTop', 't_rack', 't_cloudTop'].forEach((n) => add(n, 16, 16));
['caret1', 'caret2', 'caret3', 'caret4', 'poof1', 'poof2', 'poof3'].forEach((n) => add(n, 8, 8));
['ckpt_off', 'ckpt_on'].forEach((n) => add(n, 16, 32));
add('clawdB_throw', 24, 24);
['lift', 'liftU', 'liftC'].forEach((n) => add(n, 16, 8));

// 9.1 palettes with fixed values ([slot1, slot2, slot3] as NES indices); the rest must merely exist
const SPAL_FIXED = {
  clawdCode: [0x30, 0x26, 0x0f], life: [0x1a, 0x30, 0x0f], bossHit: [0x30, 0x30, 0x0f],
  moth: [0x37, 0x17, 0x0f], mothU: [0x37, 0x17, 0x0c], spike: [0x13, 0x30, 0x0f], spikeU: [0x13, 0x30, 0x0c],
  terminal: [0x26, 0x30, 0x0f], caret: [0x30, 0x26, 0x0f], poof: [0x30, 0x10, 0x0f], token: [0x26, 0x30, 0x17],
  spring: [0x26, 0x30, 0x0f], ckpt: [0x26, 0x30, 0x0f], ckptOff: [0x10, 0x00, 0x0f],
};

// tiles, scenery and lift segments use free legend keys; everything else is a character sprite
const FREE_KEYS = /^(t_|flag$|castleFlag$|castle$|cloud\d$|bush\d$|hill[SB]$|lift[UC]?$)/;

function main() {
  const FILM = load();
  const L = FILM.lib;
  const M = FILM.SPRITE_MANIFEST;
  const SP = L.SPRITES_DEF;
  const NES = new Set(L.NES.map((c) => c.toUpperCase()));
  const fails = { A1: [], A2: [], A3: [], A4: [] };
  const names = Object.keys(M);

  for (const name of names) {
    const m = M[name];
    const def = SP[name];
    if (!def) {
      fails.A1.push(`${name}: no map (draws the magenta placeholder)`);
      continue;
    }
    const rows = def.r;
    if (!Array.isArray(rows) || rows.length !== m.h || rows.some((r) => typeof r !== 'string' || r.length !== m.w)) {
      const lens = Array.isArray(rows) ? [...new Set(rows.map((r) => r.length))].join('/') : '?';
      fails.A1.push(`${name}: map is ${lens}x${Array.isArray(rows) ? rows.length : '?'}, manifest says ${m.w}x${m.h}`);
      continue;
    }
    const keys = new Set(rows.join('').replace(/\./g, ''));
    const legends = def.legends || [def.l];
    legends.forEach((lg, li) => {
      const cols = new Set();
      for (const k of keys) {
        const c = lg && lg[k];
        if (!c) fails.A2.push(`${name}${legends.length > 1 ? '#' + li : ''}: key '${k}' has no colour`);
        else if (!NES.has(String(c).toUpperCase())) fails.A2.push(`${name}: key '${k}' is ${c}, not a lib.NES colour`);
        else cols.add(String(c).toUpperCase());
      }
      if (cols.size > 3) fails.A2.push(`${name}: ${cols.size} opaque colours (${[...cols].join(' ')}), the limit is 3`);
    });
    if (!FREE_KEYS.test(name)) {
      const bad = [...keys].filter((k) => !'123'.includes(k));
      if (bad.length) fails.A3.push(`${name}: character map uses key(s) ${bad.map((k) => `'${k}'`).join(' ')} (only 1 2 3 .)`);
    }
  }

  for (const [name, w, h] of NEW) {
    if (!M[name]) fails.A4.push(`${name}: missing from src/manifest.js`);
    else if (M[name].w !== w || M[name].h !== h) fails.A4.push(`${name}: manifest size ${M[name].w}x${M[name].h}, 9.1 says ${w}x${h}`);
  }
  if (!Object.isFrozen(L.SPAL)) fails.A4.push('lib.SPAL is not frozen');
  for (const k of Object.keys(SPAL_FIXED)) {
    const p = L.SPAL[k];
    if (!p) { fails.A4.push(`lib.SPAL.${k} is missing`); continue; }
    if (!Object.isFrozen(p)) fails.A4.push(`lib.SPAL.${k} is not frozen`);
    const want = SPAL_FIXED[k].map((i) => L.NES[i].toUpperCase());
    if (p.length !== 3 || p.some((c, i) => String(c).toUpperCase() !== want[i])) fails.A4.push(`lib.SPAL.${k} is [${p.join(', ')}], 9.1 says [${want.join(', ')}]`);
  }
  // no star step is green (art bible 2.4): hue of each slot-1 colour must not sit in the green band
  for (const p of L.SPAL.clawdStar) {
    const i = L.NES.findIndex((c) => c.toUpperCase() === String(p[0]).toUpperCase());
    if ([0x09, 0x0a, 0x0b, 0x19, 0x1a, 0x1b, 0x29, 0x2a, 0x2b, 0x39, 0x3a, 0x3b].includes(i)) fails.A4.push(`clawdStar step ${p.join(',')} is green`);
  }

  const labels = {
    A1: `every manifest name (${names.length}) has a map of exactly its size`,
    A2: 'every map uses at most 3 opaque lib.NES colours',
    A3: 'character maps use only the keys 1 2 3 and .',
    A4: `the ${NEW.length} names of 9.1 and the ${Object.keys(SPAL_FIXED).length} new SPAL palettes exist as specified`,
  };
  let ok = true;
  for (const k of Object.keys(fails)) {
    const f = fails[k];
    console.log(`[${f.length ? 'FAIL' : 'PASS'}] ${k} ${labels[k]}`);
    for (const line of f.slice(0, 20)) console.log('       ' + line);
    if (f.length > 20) console.log(`       ... ${f.length - 20} more`);
    if (f.length) ok = false;
  }
  console.log(ok ? 'art-check OK' : 'art-check FAILED');
  process.exit(ok ? 0 : 1);
}

main();
