// tools/proof/fixtures/mech-defs.cjs : the fixture levels tools/proof/mech-scenarios.cjs plays (MC1 to
// MC10). Owner: P2. Small maps in the GAME_DEFS schema (docs/game-spec.md 4.3), ids prefixed 'mc-' so they
// never collide with World 1 or P1's 'en-' fixtures. Every map is 12 rows of equal width; row r has its
// top at 16r - 12; the ground rows 10 and 11 fill y 148 to 180.
'use strict';

function blank(w, ground = '#') {
  const rows = [];
  for (let r = 0; r < 12; r++) rows.push(new Array(w).fill(r >= 10 ? ground : '.'));
  return rows;
}
function put(rows, c, r, str) {
  for (let i = 0; i < str.length; i++) rows[r][c + i] = str[i];
  return rows;
}
function pit(rows, c, n, fill = '.') {
  for (let i = 0; i < n; i++) rows[10][c + i] = rows[11][c + i] = fill;
  return rows;
}
const done = (rows) => rows.map((r) => r.join(''));
const base = (id, extra) => Object.assign({ id, name: id.toUpperCase(), world: '7-1', kind: 'over', time: 400, song: 'overworld', start: { x: 40, y: 148 } }, extra);

// mc-h: a 112 px horizontal lift (H1's profile) over a pit, and a static lift over solid ground for the
// one-way test (a lift with x1 at its own column never moves)
const H = blank(80);
pit(H, 20, 20);
const LIFT_H = { k: 'h', tx: 20, y: 116, w: 3, x1: 20 * 16 + 112, speed: 1, phase: 0 };
const LIFT_S = { k: 'h', tx: 50, y: 116, w: 3, x1: 50 * 16, speed: 1, phase: 0 };

// mc-v: two vertical lifts in opposite phase over a pit (the 1-2 elevator), ground either side at 148
const V = blank(60);
pit(V, 20, 12);
const LIFT_V1 = { k: 'v', tx: 21, w: 3, y0: 100, y1: 148, speed: 0.5, phase: 0 };
const LIFT_V2 = { k: 'v', tx: 26, w: 3, y0: 84, y1: 132, speed: 0.5, phase: 48 };

// mc-fall: a falling lift over a pit
const FALL = blank(50);
pit(FALL, 16, 16);

// mc-spring: the spring flush with the floor (its top y 148), open sky above
const SPRING = blank(40);
put(SPRING, 20, 10, 'S');

// mc-ember: a castle hall, a lava pool at cols 12-14 under a bridge in row 9 (top y 132)
const EMBER = blank(40);
pit(EMBER, 12, 3);
put(EMBER, 12, 10, 'LLL');
put(EMBER, 12, 11, 'lll');
put(EMBER, 11, 9, '=====');

// mc-foes: a moth (col 30, row 8), a hover moth (col 40, row 6), a spike beetle on a 3-wide island
// (cols 50-52, pits either side)
const FOES = blank(80);
put(FOES, 30, 8, 'm');
put(FOES, 40, 6, 'n');
pit(FOES, 47, 3);
pit(FOES, 53, 3);
put(FOES, 51, 9, 's');

// mc-bump: a spike beetle on a 3-wide brick shelf (cols 14-16, row 7, top y 100), open floor under it
const BUMP = blank(40);
put(BUMP, 14, 7, 'BBB');
put(BUMP, 15, 6, 's');

// mc-k-*: one enemy of a kind at col 14 in front of the start (the hover moth at row 8, the rest at row 9)
function kindMap(ch) {
  const M = blank(40);
  put(M, 14, ch === 'n' ? 8 : 9, ch);
  return done(M);
}

// mc-caret: a wall at col 16 (rows 6-9), open floor either side
const CARET = blank(48);
for (let r = 6; r <= 9; r++) put(CARET, 16, r, 'X');

// mc-boss: P1's keep (en-boss): lava behind the start, the start platform (cols 4-7, top y 116), the
// bridge (8-19) over lava, the chain, the ENTER key (22) and Pearl's room
const KEEP = [
  '........................................',
  '........................................',
  '........................................',
  'wwwwwwwwwwwwwwwwwwwwwwww..............ww',
  'ww....................................ww',
  'ww....................................ww',
  'ww....................................ww',
  'ww.................%..A...............ww',
  'ww..####============###...............ww',
  'ww..####............###.........p.....ww',
  '##LL####LLLLLLLLLLLL####################',
  '##ll####llllllllllll####################',
];

// mc-tok: three t chars placed out of column order (numbered 10, 20, 30 left to right) and one overlay;
// mc-tok-b: its sub-area, tokenBase 5
const TOK = blank(60);
put(TOK, 30, 6, 't');
put(TOK, 10, 8, 't');
put(TOK, 20, 4, 't');
put(TOK, 3, 1, 't'); // column 3: bit 0
const TOKB = blank(20, 'G');
put(TOKB, 8, 9, 't');

const DEFS = {
  'mc-h': base('mc-h', { rows: done(H), lifts: [LIFT_H, LIFT_S] }),
  'mc-v': base('mc-v', { rows: done(V), lifts: [LIFT_V1, LIFT_V2] }),
  'mc-fall': base('mc-fall', { rows: done(FALL), lifts: [{ k: 'fall', tx: 20, y: 132, w: 3 }, { k: 'fall', tx: 26, y: 116, w: 3 }] }),
  'mc-spring': base('mc-spring', { rows: done(SPRING), kind: 'sky', song: 'sky' }),
  'mc-ember': base('mc-ember', { rows: done(EMBER), kind: 'castle', song: 'castle', embers: [{ tx: 13, period: 120, phase: 30 }] }),
  'mc-ember-low': base('mc-ember-low', { rows: done(EMBER), kind: 'castle', song: 'castle', embers: [{ tx: 13, period: 120, phase: 30, vy: -4 }] }),
  'mc-foes': base('mc-foes', { rows: done(FOES) }),
  'mc-bump': base('mc-bump', { rows: done(BUMP) }),
  'mc-foes-u': base('mc-foes-u', { rows: done(FOES).map((r, i) => (i >= 10 ? r.replace(/#/g, 'G') : r)), kind: 'under', song: 'underground' }),
  'mc-k-g': base('mc-k-g', { rows: kindMap('g') }),
  'mc-k-k': base('mc-k-k', { rows: kindMap('k') }),
  'mc-k-m': base('mc-k-m', { rows: kindMap('m') }),
  'mc-k-n': base('mc-k-n', { rows: kindMap('n') }),
  'mc-k-s': base('mc-k-s', { rows: kindMap('s') }),
  'mc-caret': base('mc-caret', { rows: done(CARET) }),
  'mc-boss': base('mc-boss', { rows: KEEP, kind: 'castle', song: 'castle', world: '7-4', time: 300, start: { x: 72, y: 116 },
    bridge: [8, 19], axe: 22, boss: { tx: 14, range: [9, 18], hp: 5 }, bossSong: 'boss' }),
  'mc-tok': base('mc-tok', { rows: done(TOK), tokens: [[45, 8, 4]], mid: { tx: 25, row: 10 } }),
  'mc-tok-b': base('mc-tok-b', { rows: done(TOKB), kind: 'under', song: 'underground', main: 'mc-tok', respawn: 'mc-tok', tokenBase: 5 }),
};

module.exports = { DEFS, LIFT_H, LIFT_S, LIFT_V1, LIFT_V2 };
