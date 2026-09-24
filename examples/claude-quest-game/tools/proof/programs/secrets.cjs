// tools/proof/programs/secrets.cjs : the World 1 secrets, one program each (docs/game-spec.md 13.2, 4.10).
// Owner: P3. Each starts at its level like a level proof (create plus one START press) and ends on the
// secret's own proof event; none may die on the way.
'use strict';
const routes = require('./routes.cjs');

const cellIs = (W, id, tx, ty, ch) => W.lv.def.id === id && W.lv.grid[ty * W.lv.w + tx] === ch.charCodeAt(0);
const standing = (c) => c.p.ground && c.p.st === 'play';
const toward = (x, y) => (c) => -Math.abs(c.p.x + 8 - x) - 2 * Math.abs(c.p.y - y);
const X = { depth: 8, width: 24, stand: [6, 16, 32], walk: [6, 12, 24], dirs: [128, 64, 130], jumpDirs: [0, 128, 130, 64], jump: [3, 8, 14, 20, 28] };
const oneup = (e) => e.type === 'oneup';
// a cell left of column tx that play changed (a coin taken, a block used): kept only by the same level object
const changedBefore = (W, tx) => {
  const ch = W.lv.changes;
  for (let i = 0; i < ch.length; i += 2) if (ch[i] % W.lv.w < tx) return true;
  return false;
};
// the 1UP item from a block: bump it (the cell turns used), then catch the item (a oneup event)
function lifeBlock(k, name, tx, ty) {
  return [
    k.search(`${name}: bump it`, (c) => c.lv.grid[ty * c.lv.w + tx] === 85 && standing(c), Object.assign({}, X, { score: toward(tx * 16 + 8, ty * 16 + 4) })),
    k.search(`${name}: catch the 1UP`, (c) => c.lives > c.__lives0, Object.assign({}, X, { after: 0, runUps: true, score: (c) => (c.items.length ? -Math.abs(c.p.x - c.items[0].x) - Math.abs(c.p.y - c.items[0].y) : 0) })),
  ];
}
// remember the lives before the catch on every copy the search makes (a field on the world)
const markLives = (k) => k.move('count the lives', () => true, 0);

module.exports = [
  {
    name: 'oneup-1-2',
    order: 20,
    what: "1-2: the hidden 1UP block + at (67, 5), bumped from the deck, and its 1UP caught",
    opts: { start: '1-2' },
    exit: [(e, W) => oneup(e) && cellIs(W, '1-2', 67, 5, 'U')],
    build: (k) => [
      k.mode('play'),
      k.wait('down through the ceiling gap', (W) => W.p.ground),
      k.advance('up the stack to h3', k.onCols(28, 29, 7), { avoid: (c) => c.p.ground && c.p.y === 148 && c.p.x > 29 * 16 - 8 && c.p.x < 31 * 16 }),
      k.hop('hop from h3 to h4', k.onCols(31, 31, 6)),
      k.advance('over the trenches to the step before the deck', (W) => W.p.x >= 52 * 16 && W.p.ground),
      k.search('up onto the deck', (c) => standing(c) && k.onCols(58, 66, 7)(c), Object.assign({}, X, { score: toward(62 * 16, 100) })),
      k.move('note the lives', (W) => ((W.__lives0 = W.lives), true), 0),
      ...lifeBlock(k, 'the hidden block over the deck', 67, 5),
    ],
    check: (W) => [[W.lives === 4, `a life gained (${W.lives})`]],
  },
  {
    name: 'oneup-1-3',
    order: 21,
    what: '1-3: the 1UP block N at (108, 6) over T10, and its 1UP (it stays on the block in the sky)',
    opts: { start: '1-3' },
    exit: [(e, W) => oneup(e) && cellIs(W, '1-3', 108, 6, 'U')],
    build: (k) => {
      const r = routes.r13(k, {});
      const at = r.findIndex((m) => /falling packets/.test(m.label));
      return [
        k.mode('play'),
        ...r.slice(0, at + 1),
        k.move('note the lives', (W) => ((W.__lives0 = W.lives), true), 0),
        ...lifeBlock(k, 'the N block over T10', 108, 6),
      ];
    },
    check: (W) => [[W.lives === 4, `a life gained (${W.lives})`]],
  },
  {
    name: 'oneup-1-4',
    order: 22,
    what: '1-4: the hidden 1UP block + at (91, 6) in the safe room, and its 1UP caught',
    opts: { start: '1-4' },
    exit: [(e, W) => oneup(e) && cellIs(W, '1-4', 91, 6, 'U')],
    build: (k) => {
      const r = routes.r14(k, {});
      const at = r.findIndex((m) => /lava lake/.test(m.label));
      return [
        k.mode('play'),
        ...r.slice(0, at + 1),
        k.advance('into the safe room', (W) => W.p.x >= 86 * 16 && W.p.ground, { avoid: (c) => c.p.x > 94 * 16 }),
        k.move('note the lives', (W) => ((W.__lives0 = W.lives), true), 0),
        ...lifeBlock(k, 'the hidden block in the safe room', 91, 6),
      ];
    },
    check: (W) => [[W.lives === 4, `a life gained (${W.lives})`]],
  },
  {
    name: 'multicoin',
    order: 23,
    what: '1-2: the multi-coin brick C at (71, 7), bumped from the lower corridor until it is spent (10 coins)',
    opts: { start: '1-2' },
    exit: [(e, W) => e.type === 'coin' && cellIs(W, '1-2', 71, 7, 'U')],
    build: (k) => [
      k.mode('play'),
      k.wait('down through the ceiling gap', (W) => W.p.ground),
      k.advance('up the stack to h3', k.onCols(28, 29, 7), { avoid: (c) => c.p.ground && c.p.y === 148 && c.p.x > 29 * 16 - 8 && c.p.x < 31 * 16 }),
      k.hop('hop from h3 to h4', k.onCols(31, 31, 6)),
      k.advance('over the trenches to the step before the deck', (W) => W.p.x >= 52 * 16 && W.p.ground),
      // into the lower corridor under the deck once its bugs are dealt with, and under the brick
      k.search('under the multi-coin brick', (c) => standing(c) && c.p.y === 148 && c.p.vx === 0 && Math.abs(c.p.x + 8 - (71 * 16 + 8)) <= 3, Object.assign({}, X, { depth: 10, score: toward(71 * 16 + 8, 148) })),
      // bump it again and again (a hop straight up, released at once, lands before the next)
      k.move('bump it until it is spent', (W) => W.lv.grid[7 * W.lv.w + 71] === 85, (W) => (W.p.ground && !(W.prev & 1) ? 1 : 0)),
    ],
    check: (W, events) => {
      const coins = events.filter((e) => e.type === 'coin').length;
      return [[W.lv.multi && Object.values(W.lv.multi).some((m) => m.n === 10), `the brick paid 10 coins (${JSON.stringify(W.lv.multi)}, ${coins} coins in all)`]];
    },
  },
  {
    name: 'pipe-1-1',
    order: 24,
    what: "1-1: down the pipe at 134 into the coin room 1-1b and back out by its side pipe, rising from pipe 148 of the same 1-1",
    opts: { start: '1-1' },
    exit: [(e, W) => e.type === 'levelstart', (e, W) => e.type === 'pipe' && W.lv.def.id === '1-1b', (e, W) => e.type === 'pipe' && W.lv.def.id === '1-1' && W.p.st === 'pipeUp'],
    build: (k) => {
      const r = routes.r11(k, { tokens: true });
      const a = r.findIndex((m) => /on to the pipe at 134/.test(m.label));
      const b = r.findIndex((m) => /up out of pipe 148/.test(m.label));
      return [k.mode('play'), k.advance('to the pipe at 134', (W) => W.p.x >= 128 * 16 && W.p.ground), ...r.slice(a + 1, b + 1)];
    },
    // the same level object: what he changed in 1-1 before the pipe (coins, bricks) is still changed
    check: (W) => [[W.lv.def.id === '1-1' && W.p.x === 148 * 16 + 8 && changedBefore(W, 134), `back in the same 1-1 at pipe 148 (x ${W.p.x}, its earlier changes kept: ${changedBefore(W, 134)})`]],
  },
  {
    name: 'pipe-1-2',
    order: 25,
    what: '1-2: down the cellar pipe at 90 into 1-2b and back out by its side pipe, rising from pipe 128 of the same 1-2',
    opts: { start: '1-2' },
    exit: [(e, W) => e.type === 'levelstart', (e, W) => e.type === 'pipe' && W.lv.def.id === '1-2b', (e, W) => e.type === 'pipe' && W.lv.def.id === '1-2' && W.p.st === 'pipeUp'],
    build: (k) => {
      const r = routes.r12(k, { tokens: true });
      const a = r.findIndex((m) => /to the cellar pipe/.test(m.label));
      const b = r.findIndex((m) => /up out of pipe 128/.test(m.label));
      const start = r.findIndex((m) => /up the stack to h3/.test(m.label));
      return [k.mode('play'), k.wait('down through the ceiling gap', (W) => W.p.ground), ...r.slice(start, start + 2), ...r.slice(a, b + 1)];
    },
    check: (W) => [[W.lv.def.id === '1-2' && W.p.x === 128 * 16 + 8 && changedBefore(W, 90), `back in the same 1-2 at pipe 128 (x ${W.p.x}, its earlier changes kept: ${changedBefore(W, 90)})`]],
  },
  {
    name: 'boss',
    order: 26,
    what: "1-4 as Claw'd Code: five carets beat the Big Bug (5000), then the ENTER key and the rescue",
    opts: { start: '1-4', form: 'code' },
    exit: ['bossdefeat', 'axe', 'complete'],
    build: (k) => [k.mode('play'), ...routes.r14(k, { boss: true })],
    check: (W, events) => {
      const hits = events.filter((e) => e.type === 'bosshit');
      return [
        [hits.length === 5 && hits.map((e) => e.hp).join() === '4,3,2,1,0', `five caret hits (${hits.map((e) => e.hp).join(',')})`],
        [!events.some((e) => e.type === 'bossfall'), 'no boss fall after the defeat'],
      ];
    },
  },
];
