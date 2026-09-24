// tools/proof/programs/routes.cjs : the route through each World 1 level, as planner moves. Owner: P3.
// Each route(k, o) returns the moves from the first play frame of its level to its exit; o.tokens takes
// the level's three tokens on the way (the perfect run), o.big says he arrives big.
'use strict';

// helpers: an event of a type (tested) seen in this frame's events, or earlier on this copy. The memory is
// a string on the copy (copies of copies inherit it by value, so one line of play never marks another).
let sawN = 0;
const sawEv = (type, test) => {
  const key = '|' + type + '#' + ++sawN + '|';
  return (c, ev) => {
    if (c.__saw && c.__saw.includes(key)) return true;
    if (ev.some((e) => e.type === type && (!test || test(e)))) {
      c.__saw = (c.__saw || '') + key;
      return true;
    }
    return false;
  };
};
const token = (main, n) => sawEv('token', (e) => e.id === main && e.n === n);
const tokenOf = (c, main, n) => ((c.tokens && c.tokens[main]) | 0) & (1 << n);
const has = (W, main, n) => ((W.tokens && W.tokens[main]) | 0) & (1 << n);
// a search score: closer to the point (px, feet y) is better
const toward = (x, y) => (c) => -Math.abs(c.p.x + 8 - x) - 2 * Math.abs(c.p.y - y);
// the item from a ? block (the floppy walks off; the terminal stays on its block): bump it from below,
// then reach it (a search that heads for the block's top)
function blockItem(k, name, tx, ty, X) {
  const standing = (c) => c.p.ground && c.p.st === 'play';
  return [
    k.search(`${name}: bump the block`, (c) => used(c, tx, ty) && standing(c), Object.assign({}, X, { score: toward(tx * 16 + 8, CQ_rowTop(ty) + 16) })),
    // the powerup event on this line of play (the floppy's at the pickup, the terminal's after its freeze)
    k.search(`${name}: the item`, ((pu) => (c, ev) => pu(c, ev) && c.freeze === 0 && standing(c))(sawEv('powerup')), Object.assign({}, X, { runUps: true, depth: 5, score: toward(tx * 16 + 8, CQ_rowTop(ty)) })),
  ];
}
const CQ_rowTop = (r) => r * 16 - 12;
// a block that has given its item (its cell is used: 'U')
const used = (c, tx, ty) => c.lv.grid[ty * c.lv.w + tx] === 85;
// the searches' gesture sets: open ground (1-1) and the rest
const OPEN = { depth: 8, width: 24, stand: [6, 16, 32], walk: [6, 12, 24], dirs: [128, 64, 130], jumpDirs: [0, 128, 130, 64], jump: [3, 8, 14, 20, 28] };

// World 1-1 HELLO, WORLD (the film's map). With o.tokens: the floppy at 45, the canopy token (66, 3), down
// the pipe at 134 for the coin room's token (10, 4), back up at 148, the high platform's token (176, 3).
function r11(k, o) {
  if (!o.tokens) return [k.advance('to the flagpole', (W) => W.p.st !== 'play')];
  const standing = (c) => c.p.ground && c.p.st === 'play';
  return [
    k.advance('to the floppy gateway', (W) => W.p.x >= 41 * 16 && W.p.ground),
    k.search('the floppy: bump its block and catch it', (c) => c.p.big && c.freeze === 0 && standing(c), Object.assign({}, OPEN, { score: (c) => (c.items.length ? -Math.abs(c.p.x - c.items[0].x) : used(c, 45, 6) ? -Math.abs(c.p.x - 800) : -Math.abs(c.p.x + 8 - 45 * 16 - 8)) })),
    k.search('onto the brick canopy and up to its token', (c) => tokenOf(c, '1-1', 0) && standing(c), Object.assign({}, OPEN, { runUps: true, score: toward(66 * 16 + 8, 84) })),
    k.advance('on to the pipe at 134', (W) => W.p.x >= 128 * 16 && W.p.ground),
    k.search('onto the pipe', (c) => standing(c) && c.p.y === 116 && c.p.x + 8 >= 134 * 16 + 4 && c.p.x + 8 <= 134 * 16 + 28, Object.assign({}, OPEN, { score: toward(134 * 16 + 16, 116) })),
    k.wait('down the pipe', (W) => W.p.st !== 'play', k.DOWN),
    k.wait('into the coin room', (W) => W.lv.def.id === '1-1b' && W.p.ground),
    k.search('the coin room token over the hump', (c) => tokenOf(c, '1-1', 2) && standing(c), Object.assign({}, OPEN, { score: toward(10 * 16 + 8, 116) })),
    k.search('out by the side pipe', (c) => c.p.st === 'pipeSide', Object.assign({}, OPEN, { after: 0, score: toward(15 * 16, 148) })),
    k.wait('up out of pipe 148', (W) => W.lv.def.id === '1-1' && W.p.st === 'play'),
    k.advance('on to the platforms', (W) => W.p.x >= 166 * 16 && W.p.ground),
    k.search('up the platforms to the high token', (c) => tokenOf(c, '1-1', 1) && standing(c), Object.assign({}, OPEN, { score: toward(176 * 16 + 8, 84) })),
    k.advance('to the flagpole', (W) => W.p.st !== 'play'),
  ];
}

// World 1-2 THE STACK, out through the exit yard 1-2x. With o.tokens: the ?M? block's item, the deck's
// token (72, 4), down the cellar pipe at 90 for the token over the GG step (12, 4), back up at 128, the
// elevator's token (162, 4) on the jump from V2 to the ledge.
const slot = (c) => c.p.ground && c.p.y === 148 && c.p.x > 29 * 16 - 8 && c.p.x < 31 * 16; // the one-tile slot before h4
function r12(k, o) {
  const standing = (c) => c.p.ground && c.p.st === 'play';
  const stack = [
    // (never down into the one-tile slot between h3 and h4: he would climb back out onto h3, not on)
    k.advance('up the stack to h3', k.onCols(28, 29, 7), { avoid: slot }),
    k.hop('hop from h3 to h4', k.onCols(31, 31, 6)),
  ];
  if (!o.tokens) {
    return [
      ...stack,
      k.advance('to the exit pipe', (W) => W.lv.def.id === '1-2x'),
      k.wait('up out of pipe 2', (W) => W.p.st === 'play'),
      k.advance('to the flagpole', (W) => W.p.st !== 'play'),
    ];
  }
  const X = Object.assign({}, OPEN, { avoid: slot });
  return [
    k.wait('down through the ceiling gap', (W) => W.p.ground),
    ...blockItem(k, 'the ?M? block', 13, 6, X),
    ...stack,
    k.advance('over the trenches to the step before the deck', (W) => W.p.x >= 52 * 16 && W.p.ground),
    k.search('up onto the deck and its token', (c) => tokenOf(c, '1-2', 0) && standing(c), Object.assign({}, X, { score: toward(72 * 16 + 8, 100) })),
    k.advance('to the cellar pipe', (W) => W.p.x >= 84 * 16 && W.p.ground),
    k.search('onto the cellar pipe', (c) => standing(c) && c.p.y === 116 && c.p.x + 8 >= 90 * 16 + 4 && c.p.x + 8 <= 90 * 16 + 28, Object.assign({}, X, { score: toward(90 * 16 + 16, 116) })),
    k.wait('down the pipe', (W) => W.p.st !== 'play', k.DOWN),
    k.wait('into the cellar', (W) => W.lv.def.id === '1-2b' && W.p.ground),
    k.search('the cellar token over the GG step', (c) => tokenOf(c, '1-2', 2) && standing(c), Object.assign({}, X, { score: toward(12 * 16 + 8, 100) })),
    k.search('out by the side pipe', (c) => c.p.st === 'pipeSide', Object.assign({}, X, { after: 0, score: toward(15 * 16, 148) })),
    k.wait('up out of pipe 128', (W) => W.lv.def.id === '1-2' && W.p.st === 'play'),
    k.advance('shell alley and the islands', (W) => W.p.x >= 146 * 16 && W.p.ground),
    k.search('up the elevator, its token, onto the ledge', (c) => tokenOf(c, '1-2', 1) && standing(c) && k.onCols(164, 175, 7)(c), Object.assign({}, X, { depth: 12, score: (c) => c.p.x + (tokenOf(c, '1-2', 1) ? 400 : 0) })),
    k.advance('to the exit pipe', (W) => W.lv.def.id === '1-2x'),
    k.wait('up out of pipe 2', (W) => W.p.st === 'play'),
    k.advance('to the flagpole', (W) => W.p.st !== 'play'),
  ];
}

// World 1-3 THE CLOUD. With o.tokens: up the spring onto the cloud bank for its token (42, 4), the token
// over T11 (125, 3), the token over H2 under the moths (153, 4); small Claw'd takes the floppy on T9.
// lifts (lv.lifts): 0 H1, 1-4 the falling packets, 5 V1, 6 V2, 7 H2
const SKY = { depth: 10, width: 24, stand: [6, 16, 32], walk: [6, 12, 24], dirs: [128, 64, 130], jumpDirs: [0, 128, 130, 64], jump: [3, 8, 14, 20, 28] };
const standOn = (k, c0, c1, r) => (c) => c.p.ground && c.p.st === 'play' && k.onCols(c0, c1, r)(c);
function r13(k, o) {
  const standing = (c) => c.p.ground && c.p.st === 'play';
  const T = (n) => (c) => tokenOf(c, '1-3', n) && standing(c);
  const small = (m) => k.skipIf((W) => W.p.big, m);
  return [
    ...(o.tokens
      ? [
        k.advance('up the first towers to T3', (W) => W.p.x >= 28 * 16 && W.p.ground),
        k.goto(27 * 16 + 4),
        // a run at the spring and a hop onto it with A held: the held launch rises past the bank's edge
        // and he steers over onto it, through its coins to the token
        k.runHops('the spring, held: up onto the cloud bank', [510, 514, 518, 522, 526, 506, 500], k.safe(k.g.then(k.g.onEvent('spring', (e) => e.held), k.g.lands(k.onCols(37, 42, 5)))), { b: k.R, ns: [40, 44, 50, 56, 36, 30] }),
        k.search('along the bank to its token', T(0), Object.assign({}, SKY, { score: toward(42 * 16, 68) })),
      ]
      : []),
    k.advance('over the spring, along T4', (W) => W.p.x >= 44 * 16 && W.p.ground),
    k.search('onto the drift lift H1 and across to T6', standOn(k, 62, 65, 8), SKY),
    k.advance('the moth gap to the checkpoint rack', (W) => W.p.x >= 83 * 16 && W.p.ground),
    ...(o.tokens ? blockItem(k, 'the ?M? block (small only)', 85, 6, SKY).map(small) : []),
    k.search('across the falling packets to T10', standOn(k, 107, 110, 9), SKY),
    k.search('up the twin elevators to T11', standOn(k, 122, 125, 5), SKY),
    ...(o.tokens ? [k.search('the token over T11', T(1), Object.assign({}, SKY, { score: toward(125 * 16, 68) }))] : []),
    k.advance('tower bowling, T12 to T13', (W) => W.p.x >= 142 * 16 && W.p.ground && W.p.y === 132),
    k.goto(143 * 16),
    ...(o.tokens ? [k.search('the token over H2, under the moths', T(2), Object.assign({}, SKY, { score: toward(153 * 16, 116) }))] : []),
    k.search('over the moth swarm on H2 to T14', standOn(k, 159, 163, 7), SKY),
    k.advance('down to the goal cloud and the flagpole', (W) => W.p.st !== 'play'),
  ];
}

// World 1-4 THE KERNEL, to the ENTER key; then the rescue plays itself. With o.tokens: the token over the
// lake (72, 5) from the lift, the M? block (the floppy when small, the terminal when big), the pocket
// token (105, 5) behind the bricks he breaks when big, the token over the second pillar (130, 5).
const LAKE = { depth: 10, width: 20, stand: [8, 20, 40], walk: [6, 12, 24], dirs: [128, 64], jumpDirs: [0, 128, 130, 64], jump: [4, 10, 16, 24] };
function r14(k, o) {
  const standing = (c) => c.p.ground && c.p.st === 'play';
  const T = (n) => (c) => tokenOf(c, '1-4', n);
  const shore = (c) => standing(c) && c.p.y === 148 && c.p.x >= 80 * 16;
  const X = Object.assign({}, OPEN, { runUps: true });
  return [
    k.advance('through the gate to the compile hall', (W) => W.p.x >= 740 && W.p.ground),
    k.goto(760),
    // the long floor bar: a run-up timed to its sweep, a hop over its block, and on past it
    k.runHop('under the long firebar and over its block', 850, null, { wait: 0, horizon: 200, goal: k.reaches((c) => c.p.x >= 61 * 16, 20) }),
    k.advance('to the lake shore', (W) => W.p.x >= 1016 && W.p.ground && W.p.y === 148, { avoid: (c) => c.p.x > 1040 }),
    k.goto(1030),
    // the lava lake: onto the drift lift when it comes, ride it (stepping clear of the embers), off at the far shore
    o.tokens
      ? k.search('across the lava lake on the lift, by way of its token', (c) => T(0)(c) && shore(c), Object.assign({}, LAKE, { depth: 12, score: (c) => c.p.x + (tokenOf(c, '1-4', 0) ? 400 : 0) }))
      : k.search('across the lava lake on the lift', shore, LAKE),
    ...(o.tokens
      ? [
        k.advance('into the safe room', (W) => W.p.x >= 83 * 16 && W.p.ground),
        k.goto(83 * 16),
        ...blockItem(k, 'the M? block', 85, 6, X).map((m) => k.skipIf((W) => W.p.code, m)),
        k.search('the spike gallery: break the bricks, the pocket and its token', (c) => T(1)(c) && standing(c), Object.assign({}, X, { depth: 8, score: toward(105 * 16 + 8, 84) })),
        k.advance('on to the ember pillars', (W) => W.p.x >= 120 * 16 && W.p.ground),
        k.search('the token over the second pillar', (c) => T(2)(c) && standing(c), Object.assign({}, X, { score: toward(130 * 16 + 8, 132) })),
      ]
      : []),
    ...(o.tokens || o.boss
      ? [
        // Claw'd Code on the step before the bridge: five carets into the Big Bug (a small or big Claw'd
        // skips this and goes the classic way, past it to the key)
        k.skipIf((W) => !W.p.code, k.advance('to the step before the bridge', (W) => W.p.x >= 136 * 16 && W.p.ground && W.p.y === 116, { avoid: (c) => c.p.x > 2236 })),
        k.skipIf((W) => !W.p.code, k.goto(2212)),
        k.skipIf((W) => !W.p.code, k.fight('five carets into the Big Bug', (W) => !W.lv.boss || W.lv.boss.dead || !W.p.code, { keep: (c) => c.p.x < 2240 })),
      ]
      : []),
    k.advance('to the ENTER key', (W) => W.p.st !== 'play'),
    k.wait('the rescue', () => false),
  ];
}

module.exports = { r11, r12, r13, r14, sawEv, token, has };
