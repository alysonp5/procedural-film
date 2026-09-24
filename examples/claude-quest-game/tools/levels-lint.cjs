#!/usr/bin/env node
// tools/levels-lint.cjs : the World 1 level rules (docs/game-spec.md 4.1, 4.2, 4.10 and 13.6). Owner: P3.
//
//   node tools/levels-lint.cjs            every check on every level in CQ.GAME_DEFS; exits 1 on any failure
//   node tools/levels-lint.cjs --verbose  also prints every passing check (and every jump's takeoff window)
//   node tools/levels-lint.cjs --only 1-2  the jump physics for the named levels only (a quicker edit loop)
//
// Static rules: 12 equal-width rows; rows 0 to 2 empty; only legal characters; F3 (no standing surface or
// lift top above y 68); F4 (every lift top at least 32 px below any solid tile over its path); F6 (no
// ceiling opening within 6 columns of a standing surface in row 7 or above); F7 (a horizontal lift travels
// at most 112 px); F8 (a held spring launch peaks with his feet at y >= 56, with open air above it);
// the castle at most width - 5 and on solid floor; checkpoint posts on solid floor with room above;
// token bits unique per main level (3 each, 12 in all); firebar overrides on an f block; embers over
// lava; pipes, poles and routing that resolve.
//
// The maps: 1-1 and 1-1b reuse the film's row and scenery arrays by reference; W12, W12B, W12X, W13 and
// W14G equal the arrays printed in the spec (4.6 to 4.9) except for the changes listed in CHANGES below,
// each with the F rule it keeps. Every difference is printed.
//
// Jumps (F1, F2): every jump a level requires is listed in JUMPS. Each is checked twice:
//   1. the rule as written: the gap against the spec's envelope table (4.1): a required jump at most the
//      walk-speed maximum minus 1, an optional or finale jump at most the run-speed maximum minus 2; a
//      required climb at most 3 tiles, an optional one at most 4.
//   2. the physics: the engine itself (NES-accurate feel, enemies and hazards removed, lifts frozen as solid
//      rows where listed) jumps it at walk speed, small and big Claw'd, under the level's real ceilings, from
//      every takeoff point from the perfect last-frame edge back to 64 px behind it (A held 1 to 40 frames,
//      the direction held, let go or reversed in the air). The widest run of takeoff points that land is
//      the jump's takeoff window: at least 16 px (one tile of forgiveness) for a required jump; an
//      optional jump needs 16 px walking or 32 px at run speed.
'use strict';

const fs = require('fs');
const path = require('path');
const H = require('./proof/harness.cjs');

const ROOT = path.resolve(__dirname, '..');
const verbose = process.argv.includes('--verbose');
const onlyArg = process.argv.indexOf('--only');
const ONLY = onlyArg > 0 ? String(process.argv[onlyArg + 1] || '').split(',') : null; // jump physics for these levels only

// ------------------------------------------------------------------------------------------------
// the spec's rules
// ------------------------------------------------------------------------------------------------
// 4.1: max gap (tiles) by landing height change -5..+5; null: not reachable
const WALK = { '-5': 7, '-4': 7, '-3': 6, '-2': 6, '-1': 6, 0: 5, 1: 5, 2: 4, 3: 4, 4: 3, 5: null };
const RUN = { '-5': 12, '-4': 11, '-3': 10, '-2': 10, '-1': 9, 0: 8, 1: 8, 2: 7, 3: 7, 4: 6, 5: null };
const LEGAL = new Set('.#BX?M*oWGw[]{}!|hH-_jJLl=%Afgkp' + 'NCSTR+mnst');
const TOP_MIN = 68; // F3: the highest standing surface (row 5)
const LIFT_ROOM = 32; // F4
const CEIL_REACH = 6; // F6
const LIFT_TRAVEL = 112; // F7
const SPRING_RISE = 86.4, SPRING_FEET_MIN = 56; // F8 (MC3: a held launch rises 86.4 px)
const rowTop = (r) => r * 16 - 12;
const MAPS = ['W12', 'W12B', 'W12X', 'W13', 'W14G'];
const MAP_OF = { '1-2': 'W12', '1-2b': 'W12B', '1-2x': 'W12X', '1-3': 'W13', '1-4': 'W14G' };

// ------------------------------------------------------------------------------------------------
// Geometry changes against the spec's printed maps (4.6 to 4.9). Each: the level, the cells (row, first
// column, the spec's characters, ours), the rule it keeps and why. The lint re-derives the full
// difference and fails on any cell not listed here.
// ------------------------------------------------------------------------------------------------
const H4 = 'the h4 column moves from col 33 to col 31: under the row 3 ceiling a small Claw\'d on h3 (top y 100) has 32 px of headroom, so the printed 3-tile hop to h4 is out of reach for anyone (no takeoff window); with one tile between them it has a 24 px window';
const TRENCH = 'the walls of the beetle trench (cols 42 and 47) are one tile high: from a two-tile wall the ceiling cuts the arc to 48 px and the 4-tile hop has no takeoff window at walk speed; from one tile it has 20 px';
const PILLAR = 'the ember pillars stand one tile high (top y 132, was 116): from y 116 the ceiling cuts the arc and pillar to pillar has a 12 px window for small Claw\'d; from y 132 it has 36 px';
const CHANGES = [
  { id: '1-2', row: 4, col: 30, from: '..ooo', to: 'ooo..', rule: 'F1', why: 'the coins over h4 follow it; ' + H4 },
  { id: '1-2', row: 6, col: 31, from: '..W', to: 'W..', rule: 'F1', why: H4 },
  { id: '1-2', row: 7, col: 31, from: '..W', to: 'W..', rule: 'F1', why: H4 },
  { id: '1-2', row: 8, col: 31, from: '..W', to: 'W..', rule: 'F1', why: H4 },
  { id: '1-2', row: 9, col: 31, from: 'g.W.', to: 'W..g', rule: 'F1', why: 'the bug that walked the gap before h4 now walks the floor after it (col 34); ' + H4 },
  { id: '1-2', row: 8, col: 42, from: 'W', to: '.', rule: 'F1', why: TRENCH },
  { id: '1-2', row: 8, col: 47, from: 'W', to: '.', rule: 'F1', why: TRENCH },
  { id: '1-4', row: 8, col: 125, from: '##', to: '..', rule: 'F1', why: PILLAR },
  { id: '1-4', row: 8, col: 130, from: '##', to: '..', rule: 'F1', why: PILLAR },
];
// definition changes (not map cells), printed with the map changes; test(D) confirms each is in the defs
const DEF_CHANGES = [
  { id: '1-2', what: 'the elevator lifts V1 and V2 move one tile right (tx 154 and 159, were 153 and 158)', rule: 'F1', why: 'from V2 the printed 3-tile gap to the landing ledge has an 8 px takeoff window under the ceiling; with 2-tile gaps on every hop (island to V1, V1 to V2, V2 to the ledge) each has at least 24 px',
    test: (D) => D['1-2'].lifts[0].tx === 154 && D['1-2'].lifts[1].tx === 159 },
  { id: '1-4', what: 'the lake lift moves one tile right (tx 67, x1 1184; still 112 px of travel)', rule: 'F1, F7', why: 'from its right end the printed 4-tile jump to the shore has a 10 px window (the ceiling cuts the arc); with 3 tiles it has 26 px, and the shore end of the lake is still reached from its left end with a 1-tile gap',
    test: (D) => D['1-4'].lifts[0].tx === 67 && D['1-4'].lifts[0].x1 === 1184 },
  { id: '1-4', what: 'the long floor firebar at 55 turns clockwise (dir 1) and the short ceiling bar at 61 the other way (dir -1); the spec had them the other way round', rule: 'F1', why: 'turning counter-clockwise the long bar rises on the far side of its block and meets him as he crosses: the hall can only be run, at full speed, in 14 frames of every 160 (7 of 80 start phases, none walking). Clockwise it rises in front of him and sweeps away over the top, and he follows it under: 68 of 80 start phases cross at walk speed (55 big)',
    test: (D) => D['1-4'].firebars.some((f) => f.tx === 55 && f.dir === 1) && D['1-4'].firebars.some((f) => f.tx === 61 && f.dir === -1) },
  { id: '1-2x', what: 'a start ({ x: 72, y: 148 }) is added', rule: 'none', why: 'the routing never uses it (he rises from pipe 2), but a console created at 1-2x directly needs one',
    test: (D) => !!D['1-2x'].start },
  { id: '1-4', what: 'the first pit\'s ember (tx 19) leaps lower (vy -4, apex feet y 121) on phase 125 (was vy -5, phase 90)', rule: '4.11 (1-4 teaches embers safely)', why: 'a running jump over the 3-wide pit crosses its column with his feet at y 84 to 96, inside a -5 leap\'s apex band, so 14.7% of blind run-and-jumps died to it; at -4 a normal run-and-jump clears it (2.0% over take-offs from tile 15.6 to 17.4, all from the lip) while a walking jump or a short hop can still be caught (5.2%, 12.7%), and its first leap (lv.t 55) plays while he drops off the entry platform',
    test: (D) => D['1-4'].embers.some((e) => e.tx === 19 && e.period === 180 && e.phase === 125 && e.vy === -4) },
];
// (checked and printed once the defs are loaded, below)

// ------------------------------------------------------------------------------------------------
// The jumps each level requires (or offers). from/to: [firstCol, lastCol, row] of the standing surface
// (its top is rowTop(row)); lift: true when that end is a lift frozen at that position for the physics
// check; kind 'req' (the route needs it: walk rule), 'opt' (a secret, a token or the finale: run rule).
// ------------------------------------------------------------------------------------------------
const J = (name, from, to, kind = 'req', o = {}) => Object.assign({ name, from, to, kind }, o);
const JUMPS = {
  '1-1': [
    J('the pit at 27-29', [21, 26, 10], [30, 35, 10]),
    J('up the gateway pipe at 39', [36, 38, 10], [39, 40, 8]),
    J('up the gateway pipe at 51', [41, 50, 10], [51, 52, 8]),
    J('the star-run pit at 108-109', [102, 107, 10], [110, 121, 10]),
    J('up the pipe at 134', [122, 133, 10], [134, 135, 8]),
    J('the pit at 141-142', [138, 140, 10], [143, 147, 10]),
    J('up the pipe at 148', [143, 147, 10], [148, 149, 8]),
    J('onto the low platform', [168, 171, 10], [172, 173, 8], 'opt'),
    J('onto the high platform', [172, 173, 8], [176, 177, 6], 'opt'),
  ],
  '1-1b': [J('over the hump', [1, 7, 10], [8, 11, 8])],
  '1-2': [
    J('onto the h2 column', [20, 23, 10], [24, 24, 8]),
    J('climb the h3 column', [25, 27, 10], [28, 29, 7]),
    J('hop from h3 to h4', [28, 29, 7], [31, 31, 6]),
    J('onto the trench wall', [32, 41, 10], [42, 42, 9]),
    J('over the trapped beetle', [42, 42, 9], [47, 47, 9]),
    J('out of the trench', [48, 55, 10], [56, 56, 8]),
    J('onto the deck', [56, 56, 8], [58, 73, 7]),
    J('up the cellar pipe', [84, 89, 10], [90, 91, 8]),
    J('over the up pipe', [120, 127, 10], [128, 129, 8]),
    J('to the first island', [130, 133, 10], [137, 139, 10]),
    J('to the sentry island', [137, 139, 10], [143, 145, 10]),
    J('to the last island', [143, 145, 10], [149, 151, 10]),
    J('onto V1 at its foot', [149, 151, 10], [154, 156, 10, 'lift']),
    J('V1 to V2 where they cross', [154, 156, 8, 'lift'], [159, 161, 8, 'lift']),
    J('V2 low to the ledge', [159, 161, 8, 'lift'], [164, 175, 7]),
    J('V2 at its foot to the ledge', [159, 161, 9, 'lift'], [164, 175, 7]),
  ],
  '1-2b': [J('onto the GG step', [1, 10, 10], [11, 12, 7])],
  '1-3': [
    J('the start cloud to T1', [0, 10, 10], [14, 17, 8]),
    J('T1 to T2', [14, 17, 8], [21, 23, 6]),
    J('T2 down to T3', [21, 23, 6], [27, 32, 10]),
    J('T4 onto H1 at its left end', [34, 48, 10], [51, 53, 8, 'lift']),
    J('H1 at its right end to T6', [58, 60, 8, 'lift'], [62, 65, 8]),
    J('T6 to T7', [62, 65, 8], [68, 70, 6]),
    J('T7 over the hover moth to T8', [68, 70, 6], [74, 77, 8]),
    J('T8 to the checkpoint rack', [74, 77, 8], [81, 88, 9]),
    J('onto packet 1', [81, 88, 9], [90, 92, 9, 'lift']),
    J('packet 1 to packet 2', [90, 92, 9, 'lift'], [94, 96, 8, 'lift']),
    J('packet 2 to packet 3', [94, 96, 8, 'lift'], [98, 100, 9, 'lift']),
    J('packet 3 to packet 4', [98, 100, 9, 'lift'], [102, 104, 8, 'lift']),
    J('packet 4 to T10', [102, 104, 8, 'lift'], [107, 110, 9]),
    J('T10 onto V1 at its foot', [107, 110, 9], [112, 114, 9, 'lift']),
    J('V1 to V2 where they cross', [112, 114, 7, 'lift'], [117, 119, 7, 'lift']),
    J('V2 at its top to T11', [117, 119, 5, 'lift'], [122, 125, 5]),
    J('T11 down to T12', [122, 125, 5], [128, 136, 8]),
    J('T12 to T13', [128, 136, 8], [140, 147, 9]),
    J('T13 onto H2 at its left end', [140, 147, 9], [149, 151, 8, 'lift']),
    J('H2 at its right end to T14', [155, 157, 8, 'lift'], [159, 163, 7]),
    J('T14 down to the goal cloud', [159, 163, 7], [168, 172, 10]),
  ],
  '1-4': [
    J('the first lava pit', [5, 17, 10], [21, 35, 10]),
    J('the second lava pit', [21, 35, 10], [38, 54, 10]),
    J('over the floor firebar block', [38, 54, 10], [56, 65, 10]),
    J('onto the lake lift at its left end', [56, 65, 10], [67, 69, 8, 'lift']),
    J('the lake lift at its right end to the shore', [74, 76, 8, 'lift'], [80, 95, 10]),
    J('onto the first pillar', [80, 121, 10], [125, 126, 9]),
    J('pillar to pillar', [125, 126, 9], [130, 131, 9]),
    J('the second pillar down to the ledge', [130, 131, 9], [135, 135, 10]),
    J('the second pillar straight to the step', [130, 131, 9], [136, 139, 8], 'opt'),
    J('up onto the bridge step', [135, 135, 10], [136, 139, 8]),
  ],
};

// ------------------------------------------------------------------------------------------------
let fails = 0, warns = 0;
const failed = [];
function check(ok, what) {
  if (!ok) {
    fails++;
    failed.push(what);
    console.log(`[FAIL] ${what}`);
  } else if (verbose) console.log(`[ok]   ${what}`);
  return ok;
}
function note(what) {
  console.log(`[info] ${what}`);
}

// the spec's printed maps
function specMaps() {
  const lines = fs.readFileSync(path.join(ROOT, 'docs', 'game-spec.md'), 'utf8').split('\n');
  const maps = [];
  let cur = null;
  for (const line of lines) {
    const m = line.match(/^\/\*\s*(\d+)\*\/\s*'([^']*)',?\s*$/);
    if (!m) continue;
    if (+m[1] === 0) maps.push((cur = []));
    cur.push(m[2]);
  }
  const out = {};
  maps.forEach((rows, i) => (out[MAPS[i]] = rows));
  return out;
}

const G = H.load();
const CQ = G.CQ;
const DEFS = CQ.GAME_DEFS || {};
const ORDER = CQ.GAME_ORDER || [];
const SOLID = CQ.SOLID;
const isSolid = (ch) => SOLID[ch.charCodeAt(0)] === 1;
// a cell that is (or becomes, once bumped) something to stand on
const standable = (ch) => isSolid(ch) || ch === '*' || ch === '+';
const mainOf = (d) => d.main || d.id;

check(Object.keys(DEFS).length > 0, 'CQ.GAME_DEFS exists (src/game/01-world1.js)');
for (const c of DEF_CHANGES) {
  check(!!DEFS[c.id] && c.test(DEFS), `${c.id}: the listed definition change is in the defs: ${c.what}`);
  note(`${c.id} definition: ${c.what} (${c.rule}) ${c.why}`);
}
check(Array.isArray(ORDER) && ORDER.join() === '1-1,1-2,1-3,1-4', `CQ.GAME_ORDER is 1-1, 1-2, 1-3, 1-4 (${ORDER.join(', ')})`);

// ------------------------------------------------------------------------------------------------
// the maps against the film and the spec
// ------------------------------------------------------------------------------------------------
{
  const film = CQ.LEVEL_DEFS;
  const d11 = DEFS['1-1'], d11b = DEFS['1-1b'];
  check(d11 && d11.rows === film[0].rows && d11.scenery === film[0].scenery, "1-1 reuses the film's rows and scenery by reference");
  check(d11b && d11b.rows === film[1].rows, "1-1b reuses the film's coin room rows by reference");
  const spec = specMaps();
  for (const id of Object.keys(MAP_OF)) {
    const want = spec[MAP_OF[id]], d = DEFS[id];
    if (!check(!!want && !!d, `${id}: the spec prints ${MAP_OF[id]} and GAME_DEFS has ${id}`)) continue;
    const listed = CHANGES.filter((c) => c.id === id);
    const expect = want.map((r) => r.split(''));
    for (const c of listed) {
      const row = expect[c.row];
      check(want[c.row].substr(c.col, c.from.length) === c.from, `${id}: change at row ${c.row} col ${c.col} starts from the spec's '${c.from}'`);
      for (let k = 0; k < c.to.length; k++) row[c.col + k] = c.to[k];
    }
    let diff = 0;
    for (let r = 0; r < 12; r++) {
      const a = expect[r].join(''), b = d.rows[r] || '';
      if (a.length !== b.length) {
        check(false, `${id}: row ${r} is ${b.length} wide, the spec plus the listed changes ${a.length}`);
        diff++;
        continue;
      }
      for (let c = 0; c < a.length; c++) {
        if (a[c] !== b[c]) {
          check(false, `${id}: row ${r} col ${c} is '${b[c]}', the spec plus the listed changes '${a[c]}' (an unlisted change)`);
          diff++;
        }
      }
    }
    if (!diff) check(true, `${id}: the map equals ${MAP_OF[id]} in the spec${listed.length ? ` plus ${listed.length} listed change(s)` : ''}`);
    for (const c of listed) note(`${id} row ${c.row} col ${c.col}: '${c.from}' -> '${c.to}' (${c.rule}) ${c.why}`);
  }
}

// ------------------------------------------------------------------------------------------------
// per level
// ------------------------------------------------------------------------------------------------
const tokenBits = {}; // main -> [[id, bit, where]]
for (const id of Object.keys(DEFS)) {
  const d = DEFS[id];
  const rows = d.rows || [];
  const L = `${id}`;
  if (!check(rows.length === 12, `${L}: 12 rows (${rows.length})`)) continue;
  const w = rows[0].length;
  check(rows.every((r) => r.length === w), `${L}: every row is ${w} wide`);
  check(w >= 20, `${L}: at least one screen wide (${w})`);
  const at = (c, r) => (r < 0 || r > 11 ? '.' : c < 0 || c >= w ? '#' : rows[r][c]);
  check([0, 1, 2].every((r) => /^\.*$/.test(rows[r])), `${L}: rows 0 to 2 are empty (the HUD band)`);
  const bad = new Set();
  for (const r of rows) for (const ch of r) if (!LEGAL.has(ch)) bad.add(ch);
  check(!bad.size, `${L}: only legal characters${bad.size ? ' (found ' + [...bad].join(' ') + ')' : ''}`);
  check(typeof d.name === 'string' && d.name.length > 0, `${L}: has a name`);
  check(d.start && typeof d.start.x === 'number' && typeof d.start.y === 'number', `${L}: has a start`);

  // standing surfaces: a standable cell with no solid cell above it (row 3 cells are the ceiling: F6)
  const surfaces = [];
  for (let r = 4; r < 12; r++) for (let c = 0; c < w; c++) if (standable(at(c, r)) && !isSolid(at(c, r - 1))) surfaces.push([c, r]);
  // F3
  const high = surfaces.filter(([, r]) => rowTop(r) < TOP_MIN);
  check(!high.length, `${L}: F3 no standing surface above y ${TOP_MIN}${high.length ? ' (' + high.slice(0, 6).map(([c, r]) => `col ${c} row ${r}`).join(', ') + ')' : ''}`);
  const lifts = d.lifts || [];
  lifts.forEach((lf, i) => {
    const w3 = lf.w || 3;
    const topMin = lf.k === 'v' ? lf.y0 : lf.y;
    const topMax = lf.k === 'v' ? lf.y1 : lf.y;
    check(topMin >= TOP_MIN, `${L}: F3 lift ${i} (${lf.k} at ${lf.tx}) top at its highest y ${topMin} >= ${TOP_MIN}`);
    // F7
    if (lf.k === 'h') check(lf.x1 - lf.tx * 16 <= LIFT_TRAVEL && lf.x1 > lf.tx * 16, `${L}: F7 lift ${i} travels ${lf.x1 - lf.tx * 16} px (at most ${LIFT_TRAVEL})`);
    // F4: the swept box of the lift top and the room above it
    const x0 = lf.tx * 16, x1 = (lf.k === 'h' ? lf.x1 : lf.tx * 16) + w3 * 16 - 1;
    let worst = Infinity, hit = null;
    for (let r = 0; r < 12; r++) {
      for (let c = Math.floor(x0 / 16); c <= Math.floor(x1 / 16); c++) {
        if (!standable(at(c, r))) continue;
        const top = rowTop(r), bottom = top + 16;
        if (bottom <= topMin) {
          if (topMin - bottom < worst) (worst = topMin - bottom), (hit = [c, r]);
        } else if (top < topMax + 8) {
          worst = -1;
          hit = [c, r];
        }
      }
    }
    check(worst >= LIFT_ROOM, `${L}: F4 lift ${i} (${lf.k} at ${lf.tx}) keeps ${worst === Infinity ? 'open sky' : worst + ' px'} over its path${hit ? ` (col ${hit[0]} row ${hit[1]})` : ''}`);
  });
  // F6
  const ceiling = [...Array(w).keys()].some((c) => isSolid(at(c, 3)));
  if (ceiling) {
    const liftTops = lifts.map((lf) => ({ c0: lf.tx, c1: (lf.k === 'h' ? Math.floor(lf.x1 / 16) : lf.tx) + (lf.w || 3) - 1, top: lf.k === 'v' ? lf.y0 : lf.y }));
    const openings = [...Array(w).keys()].filter((c) => !isSolid(at(c, 3)));
    const near = [];
    for (const c of openings) {
      for (const [sc, sr] of surfaces) if (sr <= 7 && Math.abs(sc - c) <= CEIL_REACH) near.push(`opening col ${c} near surface col ${sc} row ${sr}`);
      for (const t of liftTops) if (t.top <= rowTop(7) && c >= t.c0 - CEIL_REACH && c <= t.c1 + CEIL_REACH) near.push(`opening col ${c} near a lift at y ${t.top}`);
    }
    check(!near.length, `${L}: F6 no ceiling opening within ${CEIL_REACH} columns of a surface in row 7 or above${near.length ? ' (' + near.slice(0, 4).join('; ') + ')' : ''}`);
  }
  // F8 and the spring's open air
  for (let r = 0; r < 12; r++) {
    for (let c = 0; c < w; c++) {
      if (at(c, r) !== 'S') continue;
      const apex = rowTop(r) - SPRING_RISE;
      check(apex >= SPRING_FEET_MIN, `${L}: F8 the spring at col ${c} row ${r} peaks with his feet at y ${apex.toFixed(1)} (>= ${SPRING_FEET_MIN})`);
      const topRow = Math.max(3, Math.floor((apex - 24 + 12) / 16));
      let clear = true;
      for (let rr = topRow; rr < r; rr++) if (isSolid(at(c, rr))) clear = false;
      check(clear, `${L}: the spring at col ${c} has open air up to its apex (rows ${topRow}..${r - 1})`);
      check(isSolid(at(c, r + 1)) || r === 11, `${L}: the spring at col ${c} stands on something`);
    }
  }
  // the castle
  if (d.castle != null) {
    check(d.castle <= w - 5, `${L}: the castle at col ${d.castle} is at most width - 5 (${w - 5})`);
    let floor = true;
    for (let c = d.castle; c < d.castle + 5; c++) if (!isSolid(at(c, 10))) floor = false;
    check(floor, `${L}: the castle stands on solid floor`);
  }
  // the pole
  if (d.pole != null) {
    let ball = -1;
    for (let r = 0; r < 12; r++) if (at(d.pole, r) === '!') ball = r;
    check(ball >= 3, `${L}: the pole at col ${d.pole} has its ball`);
    let mast = ball >= 0;
    for (let r = ball + 1; r < 9 && mast; r++) if (at(d.pole, r) !== '|') mast = false;
    check(mast && isSolid(at(d.pole, 9)), `${L}: the pole's mast runs to a block at row 9`);
  }
  // the checkpoint
  if (d.mid) {
    const m = d.mid;
    check(mainOf(d) === d.id, `${L}: the checkpoint is in a main level`);
    check(isSolid(at(m.tx, m.row)), `${L}: the checkpoint post at col ${m.tx} stands on solid floor (row ${m.row})`);
    check(!isSolid(at(m.tx, m.row - 1)) && !isSolid(at(m.tx, m.row - 2)), `${L}: the checkpoint post has room (rows ${m.row - 2}, ${m.row - 1})`);
  }
  // firebars keyed by their f block, embers over lava
  for (const fb of d.firebars || []) {
    if (fb.tx === undefined && fb.ty === undefined && (id === '1-1' || id === '1-1b')) continue;
    check(typeof fb.tx === 'number' && typeof fb.ty === 'number' && at(fb.tx, fb.ty) === 'f', `${L}: the firebar override at (${fb.tx}, ${fb.ty}) sits on an f block`);
  }
  for (const e of d.embers || []) check(at(e.tx, 10) === 'L', `${L}: the ember at col ${e.tx} rises from lava (row 10 is '${at(e.tx, 10)}')`);
  // pipes
  const rim = (tx) => [...Array(12).keys()].some((r) => at(tx, r) === '[' && at(tx + 1, r) === ']');
  if (d.pipeDown) check(rim(d.pipeDown.tx), `${L}: the down pipe at col ${d.pipeDown.tx} has a rim`);
  if (d.pipeUp) check(rim(d.pipeUp.tx), `${L}: the up pipe at col ${d.pipeUp.tx} has a rim`);
  if (d.pipeSide) check(at(d.pipeSide.tx, d.pipeSide.row) === 'h' && at(d.pipeSide.tx, d.pipeSide.row + 1) === 'H', `${L}: the side pipe's mouth is at col ${d.pipeSide.tx}, rows ${d.pipeSide.row}-${d.pipeSide.row + 1}`);
  // routing
  for (const [k, v] of [['next', d.next], ['main', d.main], ['respawn', d.respawn], ['pipeDown.to', d.pipeDown && d.pipeDown.to], ['pipeSide.to', d.pipeSide && d.pipeSide.to]]) {
    if (v !== undefined) check(typeof v === 'string' && !!DEFS[v], `${L}: ${k} '${v}' is a level in GAME_DEFS`);
  }
  if (d.pipeSide && d.pipeSide.at === 'pipeUp' && DEFS[d.pipeSide.to]) check(!!DEFS[d.pipeSide.to].pipeUp, `${L}: the side pipe rises from ${d.pipeSide.to}'s pipeUp`);
  // tokens
  const spots = [];
  for (let r = 0; r < 12; r++) for (let c = 0; c < w; c++) if (at(c, r) === 't') spots.push([c, r]);
  spots.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const base = d.tokenBase | 0;
  const list = spots.map(([c, r], i) => [c, r, base + i]).concat((d.tokens || []).map((t) => [t[0], t[1], t[2] | 0]));
  for (const [c, r, bit] of list) {
    (tokenBits[mainOf(d)] || (tokenBits[mainOf(d)] = [])).push([id, bit, `(${c}, ${r})`]);
    check(!isSolid(at(c, r)) && rowTop(r) >= 36, `${L}: the token at (${c}, ${r}) sits in open air below the HUD band`);
  }
  // the 1UP blocks and the multi-coin brick are not in the film's maps
  if (id === '1-1' || id === '1-1b') {
    let n = 0;
    for (const r of rows) for (const ch of r) if ('NC+Smnst'.includes(ch)) n++;
    check(n === 0, `${L}: the film's map carries none of the game's new characters`);
  }
}
// F5: every token and every 1UP block (and the multi-coin brick) has a listed route, and the program that
// proves it has saved tapes in both feel modes (tools/proof/levels.cjs replays them)
const ROUTES = {
  token: {
    '1-1:0': ['(66, 3) jump from the brick canopy top', 'perfect'],
    '1-1:1': ['(176, 3) jump from the high platform', 'perfect'],
    '1-1:2': ['1-1b (10, 4) jump from the hump', 'perfect'],
    '1-2:0': ['(72, 4) upper corridor, hop from the deck', 'perfect'],
    '1-2:1': ['(162, 4) on the jump from V2 to the landing ledge', 'perfect'],
    '1-2:2': ['1-2b (12, 4) hop from the GG step', 'perfect'],
    '1-3:0': ['(42, 4) walk the cloud bank (a held spring launch only)', 'perfect'],
    '1-3:1': ['(125, 3) hop on T11', 'perfect'],
    '1-3:2': ['(153, 4) hop off H2 under the moths', 'perfect'],
    '1-4:0': ['(72, 5) hop off the lake lift', 'perfect'],
    '1-4:1': ['(105, 5) break the bricks when big, jump into the pocket', 'perfect'],
    '1-4:2': ['(130, 5) hop on the second pillar', 'perfect'],
  },
  block: {
    '1-2:67:5': ['the hidden 1UP +, bumped from the deck', 'oneup-1-2'],
    '1-3:108:6': ['the 1UP block N over T10', 'oneup-1-3'],
    '1-4:91:6': ['the hidden 1UP + in the safe room', 'oneup-1-4'],
    '1-2:71:7': ['the multi-coin brick C, from the lower corridor', 'multicoin'],
  },
};
{
  const tapes = path.join(ROOT, 'tools', 'proof', 'tapes');
  const proven = (prog) => ['nes', 'modern'].every((f) => fs.existsSync(path.join(tapes, `${prog}.${f}.json`)));
  for (const main of Object.keys(tokenBits)) {
    for (const [, bit, where] of tokenBits[main]) {
      const r = ROUTES.token[`${main}:${bit}`];
      check(!!r, `${main}: F5 token bit ${bit} ${where} has a listed route`);
      if (r) check(proven(r[1]), `${main}: F5 token bit ${bit}: '${r[0]}' is proven by the saved '${r[1]}' tapes`);
    }
  }
  for (const id of Object.keys(DEFS)) {
    const rows = DEFS[id].rows;
    for (let r = 0; r < 12; r++) {
      for (let c = 0; c < rows[r].length; c++) {
        if (!'N+C'.includes(rows[r][c])) continue;
        const key = `${id}:${c}:${r}`;
        const rt = ROUTES.block[key];
        check(!!rt, `${id}: F5 the ${rows[r][c]} block at (${c}, ${r}) has a listed route`);
        if (rt) check(proven(rt[1]), `${id}: F5 ${rt[0]} is proven by the saved '${rt[1]}' tapes`);
      }
    }
  }
}
// tokens: 3 per main level, bits 0..2 each once, 12 in all
{
  let total = 0;
  for (const main of ORDER) {
    const bits = (tokenBits[main] || []).map((t) => t[1]).sort();
    total += bits.length;
    check(bits.join() === '0,1,2', `${main}: token bits 0, 1, 2 each exactly once (${(tokenBits[main] || []).map((t) => t[0] + ':' + t[1] + t[2]).join(' ')})`);
  }
  check(total === 12, `12 tokens in World 1 (${total})`);
}

// ------------------------------------------------------------------------------------------------
// jumps: the table (the rule as written) and the physics (the engine, with the real ceilings)
// ------------------------------------------------------------------------------------------------
const { A, B, LEFT, RIGHT } = CQ.BUTTONS;
const PH = CQ.PH;

// a live NES-feel world standing in level id with the hazards gone, lifts frozen as solid rows where the
// jump lists them, and the takeoff surface extended `ext` tiles back (air cells only) for the slack test
function jumpWorld(id, jmp, big, ext) {
  const W = G.startAt(id, { feel: 'nes', form: big ? 'big' : 'small' });
  const lv = W.lv;
  lv.ents = [];
  lv.firebars = [];
  lv.boss = null;
  if (lv.lifts) lv.lifts = [];
  if (lv.embers) lv.embers = [];
  if (lv.springs) lv.springs = [];
  if (lv.tokens) lv.tokens = [];
  lv.camCap = null;
  const put = (c, r) => {
    if (c >= 0 && c < lv.w && lv.grid[r * lv.w + c] === 46) lv.grid[r * lv.w + c] = 35; // '.' -> '#'
  };
  for (const end of [jmp.from, jmp.to]) if (end[3] === 'lift') for (let c = end[0]; c <= end[1]; c++) put(c, end[2]);
  const dir = jmp.to[0] > jmp.from[1] ? 1 : -1;
  for (let k = 1; k <= ext; k++) put(dir > 0 ? jmp.from[0] - k : jmp.from[1] + k, jmp.from[2]);
  return W;
}
// does a jump at the given speed land on `to` from the takeoff edge moved `back` px behind the perfect one?
const NS = Array.from({ length: 40 }, (_, i) => i + 1);
const MS = [[999, false]];
for (const m of [48, 36, 28, 22, 16, 12, 8, 4]) MS.push([m, false], [m, true]);
const W0S = new Map();
function lands(id, jmp, big, run, back) {
  const key = id + '|' + jmp.name + '|' + big;
  if (!W0S.has(key)) W0S.set(key, jumpWorld(id, jmp, big, 4));
  const W0 = W0S.get(key);
  const dir = jmp.to[0] > jmp.from[1] ? 1 : -1;
  const hw = big ? 10 : 5;
  // perfect last frame: the trailing foot probe on the takeoff's last pixel, the body clear of any wall
  // ahead (a climb with no gap starts with his body against the step, not inside it)
  let edgeX = dir > 0 ? (jmp.from[1] + 1) * 16 - 1 - (9 - hw) : jmp.from[0] * 16 - (6 + hw);
  const y0 = rowTop(jmp.from[2]);
  const bodyHits = (x) => {
    const L = x + 8 - hw, R = x + 7 + hw, h = big ? 22 : 16;
    for (let xx = L; ; xx = Math.min(R, xx + 8)) {
      for (let yy = y0 - 1; yy > y0 - h; yy -= 4) if (CQ.K.solidAt(W0.lv, xx, yy)) return true;
      if (CQ.K.solidAt(W0.lv, xx, y0 - h + 1)) return true;
      if (xx === R) return false;
    }
  };
  while (bodyHits(edgeX)) edgeX -= dir;
  const x = edgeX - dir * back;
  const top = rowTop(jmp.to[2]);
  const D = dir > 0 ? RIGHT : LEFT;
  const bb = D | (run ? B : 0);
  for (const n of NS) {
    // m: the frame he lets go of the direction (rev: or pushes the other way), so a short target is not overshot
    for (const [m, rev] of MS) {
      const W = G.clone(W0);
      const p = W.p;
      p.x = x;
      p.y = rowTop(jmp.from[2]);
      p.vx = dir * (run ? PH.maxRun : PH.maxWalk);
      p.ground = true;
      p.face = dir;
      W.cam = Math.max(0, Math.min(W.lv.maxCam, Math.floor(x + 8 - 160)));
      let ok = false;
      for (let k = 0; k < 240; k++) {
        const b = (k < m ? bb : rev ? (dir > 0 ? LEFT : RIGHT) : 0) | (k < n ? A : 0);
        G.step(W, b);
        if (W.p.st !== 'play' || W.p.y > 200) break;
        if (k > 1 && W.p.ground) {
          const lx = W.p.x + 9 - hw, rx = W.p.x + 6 + hw;
          ok = W.p.y === top && rx >= jmp.to[0] * 16 && lx <= jmp.to[1] * 16 + 15;
          break;
        }
      }
      if (ok) return true;
    }
  }
  return false;
}
// the takeoff window: the widest run of takeoff points (every 2 px, up to 64 px behind the perfect edge)
// from which the jump lands
// (the scan stops once the window reaches WINDOW_CAP px: enough for every rule)
const WINDOW_CAP = 40;
function slack(id, jmp, big, run) {
  let best = -1, from = -1;
  for (let back = 0; back <= 64; back += 2) {
    if (lands(id, jmp, big, run, back)) {
      if (from < 0) from = back;
      best = Math.max(best, back - from);
      if (best >= WINDOW_CAP) break;
    } else if (from >= 0) break; // the window closed (they do not reopen further back)
    else from = -1;
  }
  return best;
}
for (const id of Object.keys(JUMPS)) {
  if (ONLY && !ONLY.includes(id)) continue;
  for (const jmp of JUMPS[id]) {
    const dir = jmp.to[0] > jmp.from[1] ? 1 : -1;
    const gap = dir > 0 ? jmp.to[0] - jmp.from[1] - 1 : jmp.from[0] - jmp.to[1] - 1;
    const dh = jmp.from[2] - jmp.to[2];
    const req = jmp.kind === 'req';
    const table = req ? WALK : RUN;
    const max = table[String(Math.max(-5, Math.min(5, dh)))];
    const lim = max == null ? -1 : max - (req ? 1 : 2);
    const tag = `${id}: ${jmp.name} (gap ${gap}, ${dh >= 0 ? '+' : ''}${dh}, ${req ? 'required' : 'optional'})`;
    check(gap <= lim, `${tag}: F1 gap ${gap} <= ${req ? 'walk' : 'run'} max ${max} - ${req ? 1 : 2}`);
    if (dh > 0) check(dh <= (req ? 3 : 4), `${tag}: F2 climb ${dh} <= ${req ? 3 : 4}`);
    for (const big of [false, true]) {
      if (jmp.small && big) continue;
      if (jmp.big && !big) continue;
      const who = big ? 'big' : 'small';
      const sw = slack(id, jmp, big, false);
      if (req) {
        check(sw >= 16, `${tag}: physics, ${who} at walk speed has a ${sw < 0 ? 'no' : sw + ' px'} takeoff window (>= 16)`);
      } else {
        // optional: a 16 px window at walk speed, or a 32 px one at run speed
        const sr = sw >= 16 ? -2 : slack(id, jmp, big, true);
        check(sw >= 16 || sr >= 32, `${tag}: physics, ${who} has a takeoff window of ${sw < 0 ? 'none' : sw + ' px'} walking${sr === -2 ? '' : ', ' + (sr < 0 ? 'none' : sr + ' px') + ' running'} (>= 16 walking or 32 running)`);
      }
    }
  }
}

console.log(`${fails ? 'FAIL' : 'PASS'} levels-lint: ${Object.keys(DEFS).length} levels, ${fails} failure(s)`);
process.exit(fails ? 1 : 0);
