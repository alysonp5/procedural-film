#!/usr/bin/env node
// tools/proof/engine-scenarios.cjs : T3 engine scenario proofs EN1 to EN14 (docs/game-spec.md 13.3),
// plus the seam, API, snapshot and end-to-end checks of package P1. Owner: P1.
//
//   node tools/proof/engine-scenarios.cjs            every check, twice: with every src/game module
//                                                    loaded, and bare (no 1x modules: 11-19 skipped)
//   node tools/proof/engine-scenarios.cjs --bare     bare only
//   node tools/proof/engine-scenarios.cjs --all      every module only
//   node tools/proof/engine-scenarios.cjs --only EN6,EN7
//
// The fixture levels live in tools/proof/fixtures/engine-defs.cjs. Exits 1 on any failure.
'use strict';

const fs = require('fs');
const path = require('path');
const H = require('./harness.cjs');
const { DEFS } = require('./fixtures/engine-defs.cjs');

const argv = process.argv.slice(2);
const onlyArg = argv.indexOf('--only') >= 0 ? argv[argv.indexOf('--only') + 1] : null;
const ONLY = onlyArg ? new Set(onlyArg.split(',')) : null;
const CONFIGS = argv.includes('--bare') ? ['bare'] : argv.includes('--all') ? ['all'] : ['all', 'bare'];

const BT = { A: 1, B: 2, SELECT: 4, START: 8, UP: 16, DOWN: 32, LEFT: 64, RIGHT: 128 };
const { A, B, SELECT, START, UP, DOWN, LEFT, RIGHT } = BT;
const rowTop = (r) => r * 16 - 12;

// ------------------------------------------------------------------------------------------------
// a tiny test runner
// ------------------------------------------------------------------------------------------------
class Fail extends Error {}
function mk(name) {
  const t = { name, fails: [], notes: [] };
  t.ok = (cond, msg) => {
    if (!cond) t.fails.push(msg);
    return !!cond;
  };
  t.eq = (a, b, msg) => t.ok(a === b, `${msg}: got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`);
  t.must = (cond, msg) => {
    if (!cond) {
      t.fails.push(msg);
      throw new Fail(msg);
    }
  };
  t.note = (msg) => t.notes.push(msg);
  return t;
}
const types = (ev, type) => ev.filter((e) => e.type === type);
const first = (ev, type, test) => ev.find((e) => e.type === type && (!test || test(e)));

// step W with input until pred(W, ev) (after the frame) or cap frames; returns the events
function until(G, W, input, pred, cap, t, what) {
  const inp = typeof input === 'function' ? input : () => input;
  const events = [];
  for (let i = 0; i < cap; i++) {
    const ev = G.step(W, inp(W, i));
    for (const e of ev) events.push(e);
    if (pred(W, ev, events)) return events;
  }
  if (t) t.must(false, `${what || 'condition'} not reached in ${cap} frames (mode ${W.mode}, st ${W.p && W.p.st}, x ${W.p && W.p.x.toFixed(1)}, y ${W.p && W.p.y.toFixed(1)})`);
  return events;
}
const sawType = (type, test) => (W, ev) => ev.some((e) => e.type === type && (!test || test(e)));
// run right and hop onto the pole over the stair block at its foot (the fixture poles stand at col 16)
const toPole = (W) => RIGHT | B | (W.p.ground && !(W.prev & A) && W.p.x > 176 ? A : 0);

// put a live player standing at x (feet y) and bring the camera to him
function place(W, x, y = 148) {
  const p = W.p;
  p.x = x;
  p.y = y;
  p.vx = 0;
  p.vy = 0;
  p.ground = true;
  p.jumping = false;
  p.jumped = false;
  W.cam = Math.max(0, Math.min(W.lv.maxCam, Math.floor(x + 8 - 128)));
}
const cellAt = (W, tx, ty) => String.fromCharCode(W.lv.grid[ty * W.lv.w + tx]);
// the player's sprite record in a snapshot: [name, x, y, flags, pal]
function playerRec(G, s) {
  const spr = s.spr;
  for (let k = 0; k < spr.length; k += 5) {
    const n = spr[k];
    if (n < 1000 && /^clawd[SBM]_/.test(G.CQ.NAMES[n])) return [G.CQ.NAMES[n], spr[k + 1], spr[k + 2], spr[k + 3], spr[k + 4]];
  }
  return null;
}
function recsOf(G, s, re) {
  const out = [];
  for (let k = 0; k < s.spr.length; k += 5) {
    const n = s.spr[k];
    if (n < 1000 && re.test(G.CQ.NAMES[n])) out.push({ i: k / 5, name: G.CQ.NAMES[n], x: s.spr[k + 1], y: s.spr[k + 2], flags: s.spr[k + 3], pal: s.spr[k + 4] });
  }
  return out;
}

// ------------------------------------------------------------------------------------------------
// the scenarios
// ------------------------------------------------------------------------------------------------
const TESTS = {};

// EN1: 300 frames of pause leave stateHash(W) unchanged; unpause resumes on the next frame
TESTS.EN1 = (G, t) => {
  for (const feel of ['modern', 'nes']) {
    const W = G.startAt('en-flat', { feel });
    G.run(W, RIGHT | B, 40);
    t.ok(G.game.create && true, '');
    const ev = G.run(W, START, 1);
    t.ok(!!first(ev, 'pause'), `${feel}: START in play emits pause`);
    t.eq(W.mode, 'pause', `${feel}: mode after START`);
    const h0 = G.stateHash(W);
    const s0 = G.snapshot(W);
    const vf0 = W.vf, lt0 = W.lv.t, mt0 = W.mt, time0 = W.time, flash0 = W.flashN;
    // every button but START, pressed and released in a pattern
    const pat = [0, RIGHT | B, A, LEFT, A | B | DOWN, UP | SELECT];
    const evP = G.run(W, (w, i) => pat[i % pat.length], 300);
    t.eq(evP.length, 0, `${feel}: events during 300 paused frames`);
    t.eq(G.stateHash(W), h0, `${feel}: stateHash after 300 paused frames`);
    t.ok(W.vf === vf0 && W.lv.t === lt0 && W.mt === mt0 && W.time === time0 && W.flashN === flash0, `${feel}: vf, lv.t, mt, time and flashN hold`);
    const s1 = G.snapshot(W);
    t.eq(s1.m, 4, `${feel}: snapshot mode code while paused`);
    t.ok(s1.spr.length > 0 && s1.spr.length === s0.spr.length, `${feel}: the paused snapshot carries the frozen play record`);
    t.eq(s1.f, s0.f, `${feel}: the snapshot's visual clock holds`);
    t.eq(s1.pausable, false, `${feel}: not pausable while paused`);
    const evU = G.run(W, START, 1);
    t.ok(!!first(evU, 'unpause'), `${feel}: START while paused emits unpause`);
    t.eq(W.mode, 'play', `${feel}: mode after unpause`);
    t.eq(W.lv.t, lt0, `${feel}: the unpause frame itself does not step the world`);
    G.run(W, START, 1); // START still held: no new press, the world steps
    t.eq(W.lv.t, lt0 + 1, `${feel}: the next frame steps the world`);
    t.eq(W.mode, 'play', `${feel}: holding START does not pause again`);
    t.eq(W.vf, vf0 + 1, `${feel}: the visual clock resumes`);
  }
  // pause clears the jump buffer
  const W = G.startAt('en-flat');
  G.run(W, A, 1);
  G.run(W, 0, 3);
  G.run(W, A, 1);
  t.ok(W.p.buf > 0, 'an airborne A press buffers a jump');
  G.run(W, A | START, 1);
  t.eq(W.p.buf, 0, 'pause entry clears the buffer');
};

// EN2: pause is refused in pipes, on the pole, during the grow freeze, the axe sequence and death
TESTS.EN2 = (G, t) => {
  // pulse START every other frame while cond(W) holds; count presses and pause events
  const probe = (W, cond, cap, label) => {
    let presses = 0;
    const events = [];
    for (let i = 0; i < cap && cond(W); i++) {
      const b = i & 1 ? START : 0;
      if (b && t.ok(!W.p || !G.CQ.pausable(W), `${label}: pausable reads false`)) presses++;
      for (const e of G.step(W, b)) events.push(e);
    }
    t.ok(presses >= 3, `${label}: START was pressed (${presses} times)`);
    t.eq(types(events, 'pause').length, 0, `${label}: pause events`);
    t.ok(W.mode !== 'pause', `${label}: never paused`);
    return events;
  };
  // pipes: down into en-r1b and out again
  {
    const W = G.startAt('en-r1');
    place(W, 164, 116);
    until(G, W, DOWN, (w) => w.p.st === 'pipeDown', 5, t, 'pipe entry');
    probe(W, (w) => /^pipe/.test(w.p.st), 200, 'pipe down');
    t.eq(W.lv.def.id, 'en-r1b', 'arrived in en-r1b');
    until(G, W, RIGHT, (w) => w.p.st === 'pipeSide', 400, t, 'side pipe entry');
    probe(W, (w) => /^pipe/.test(w.p.st), 200, 'side pipe and rise');
  }
  // the pole and the goal sequence
  {
    const W = G.startAt('en-e1');
    until(G, W, toPole, (w) => w.p.st === 'pole', 600, t, 'the pole');
    probe(W, (w) => w.mode === 'play', 1200, 'flagpole to the clear card');
  }
  // the grow freeze
  {
    const W = G.startAt('en-blocks');
    place(W, 800);
    until(G, W, (w, i) => (i === 0 ? A : 0), sawType('sprout'), 60, t, 'M bumped');
    until(G, W, 0, (w) => w.items.length && w.items[0].st === 'move', 60, t, 'floppy sprouted');
    until(G, W, 0, (w) => w.items.length && w.items[0].ground && w.items[0].y === 148, 200, t, 'floppy on the ground');
    until(G, W, RIGHT, (w) => w.freeze > 0, 400, t, 'floppy picked up');
    probe(W, (w) => w.freeze > 0, 100, 'grow freeze');
  }
  // the axe sequence and the rescue
  {
    const W = G.startAt('en-e2');
    until(G, W, RIGHT, (w) => w.p.st === 'axe', 600, t, 'the ENTER key');
    probe(W, (w) => w.mode === 'play' && !w.ending, 1200, 'axe sequence and rescue');
  }
  // death
  {
    const W = G.startAt('en-hit');
    until(G, W, RIGHT, (w) => w.p.st === 'dead', 400, t, 'a death');
    probe(W, (w) => w.mode === 'play', 400, 'death');
  }
};

// EN3: coyote: modern jumps 4 frames after walking off a ledge; nes does not
TESTS.EN3 = (G, t) => {
  for (const feel of ['modern', 'nes']) {
    for (const k of [4, 5, 6]) {
      const W = G.startAt('en-flat', { feel });
      until(G, W, RIGHT, (w) => !w.p.ground && !w.p.jumped, 400, t, 'walked off the ledge');
      const off = W.f - 1; // the frame he walked off
      G.run(W, RIGHT, k - 1);
      const ev = G.run(W, RIGHT | A, 1);
      const j = first(ev, 'jump');
      const want = feel === 'modern' && k <= 5;
      t.ok(!!j === want, `${feel}: an A press ${k} frames after walking off ${want ? 'jumps' : 'does not jump'} (frame ${off + k})`);
      if (j) t.ok(W.p.vy < 0 && W.p.jumped, `${feel}: the coyote jump rises`);
    }
  }
};

// EN4: buffer: A pressed 5 frames before landing and held jumps on the first grounded frame (modern);
// released early, no jump; nes no jump
TESTS.EN4 = (G, t) => {
  // hop, and find the first grounded frame G (the frame whose step starts on the ground)
  const setup = (feel) => {
    const W = G.startAt('en-flat', { feel });
    G.run(W, 0, 4);
    G.run(W, A, 2);
    G.run(W, 0, 2);
    const c = G.clone(W);
    let n = 0;
    while (!c.p.ground && n < 200) {
      G.step(c, 0);
      n++;
    }
    return { W, landF: W.f + n - 1, groundF: W.f + n };
  };
  for (const feel of ['modern', 'nes']) {
    for (const early of [5, 6]) {
      const { W, groundF } = setup(feel);
      const pressF = groundF - early;
      t.must(pressF > W.f, 'the press frame is ahead');
      G.run(W, 0, pressF - W.f);
      const ev = G.run(W, A, 20);
      const j = first(ev, 'jump');
      if (feel === 'modern') t.ok(j && j.f === groundF, `${feel}: A pressed ${early} frames before the first grounded frame and held jumps on it (jump at ${j ? j.f : 'none'}, want ${groundF})`);
      else t.ok(!j, `${feel}: A pressed ${early} frames early and held does not jump (got ${j ? j.f : 'none'})`);
    }
    {
      const { W, groundF } = setup(feel);
      G.run(W, 0, groundF - 5 - W.f);
      G.run(W, A, 3);
      const ev = G.run(W, 0, 20);
      t.ok(!first(ev, 'jump'), `${feel}: A released before landing does not jump`);
    }
  }
  const { W, groundF } = setup('modern');
  G.run(W, 0, groundF - 8 - W.f);
  const ev = G.run(W, A, 20);
  t.ok(!first(ev, 'jump'), 'modern: an A press 8 frames early has expired by the landing');
};

// EN5: corner: a 3 px graze of a brick edge passes (modern) and bumps (nes); a 3 px graze of * or + bumps in both
TESTS.EN5 = (G, t) => {
  const cases = [
    { col: 10, side: 'left', x: 11 * 16 - 7, shift: 3, ch: 'B' },
    { col: 40, side: 'right', x: 40 * 16 - 9, shift: -3, ch: 'B' },
    { col: 20, side: 'left', x: 21 * 16 - 7, shift: 3, ch: '*' },
    { col: 30, side: 'left', x: 31 * 16 - 7, shift: 3, ch: '+' },
  ];
  for (const feel of ['modern', 'nes']) {
    for (const c of cases) {
      const W = G.startAt('en-corner', { feel });
      place(W, c.x);
      const x0 = W.p.x;
      const ev = G.run(W, A, 24);
      const label = `${feel}: a 3 px ${c.side} graze of ${c.ch} at col ${c.col}`;
      if (c.ch === 'B') {
        if (feel === 'modern') {
          t.ok(!first(ev, 'bump') && !first(ev, 'brick'), `${label} passes without a bump`);
          const dx = W.p.x - x0;
          t.ok(Math.sign(dx) === Math.sign(c.shift) && Math.abs(dx) >= Math.abs(c.shift) && Math.abs(dx) <= 4, `${label} slides him past the edge within 4 px (dx ${dx})`);
          t.eq(cellAt(W, c.col, 6), 'B', `${label} leaves the brick`);
        } else {
          t.ok(!!first(ev, 'bump'), `${label} bumps`);
          t.eq(W.p.x, x0, `${label} does not slide`);
        }
      } else {
        t.ok(!!first(ev, 'sprout'), `${label} bumps the hidden block open`);
        t.eq(cellAt(W, c.col, 6), 'U', `${label} leaves a used block`);
        t.eq(W.p.x, x0, `${label} does not slide`);
        if (c.ch === '+') t.ok(W.items.some((it) => it.k === 'life'), `${label} sprouts the 1UP floppy`);
      }
    }
  }
};

// EN6: death after the checkpoint: die, lifelost, levelstart {checkpoint: true}, x = mid.tx * 16, enemies
// before x + 64 gone, tokens kept
TESTS.EN6 = (G, t) => {
  for (const feel of ['modern', 'nes']) {
    const W = G.startAt('en-a', { feel });
    W.tokens['en-a'] = 5;
    W.tokens['other'] = 2;
    const nEnts = W.lv.ents.length;
    const ev = until(G, W, RIGHT, sawType('levelstart'), 1500, t, 'respawn');
    const ck = first(ev, 'checkpoint');
    const die = first(ev, 'die');
    const lost = first(ev, 'lifelost');
    const ls = first(ev, 'levelstart');
    t.ok(ck && ck.id === 'en-a', `${feel}: checkpoint {id: 'en-a'} emitted`);
    t.ok(die && die.cause === 'enemy' && ck && die.f > ck.f, `${feel}: die {cause: 'enemy'} after the checkpoint`);
    t.ok(lost && lost.lives === 2 && lost.f > die.f, `${feel}: lifelost {lives: 2}`);
    t.ok(ls && ls.id === 'en-a' && ls.checkpoint === true && ls.lives === 2, `${feel}: levelstart {id: 'en-a', lives: 2, checkpoint: true}`);
    t.eq(W.p.x, 12 * 16, `${feel}: respawn x`);
    t.eq(W.p.y, rowTop(10), `${feel}: respawn feet`);
    t.eq(W.cam, 12 * 16 + 8 - 128, `${feel}: camera on him`);
    t.ok(W.lv.ents.every((e) => !(e.x < W.p.x + 64)), `${feel}: no enemy before x + 64`);
    t.eq(W.lv.ents.length, nEnts - 1, `${feel}: enemies after the respawn (the one behind the post removed)`);
    t.ok(W.tokens['en-a'] === 5 && W.tokens.other === 2, `${feel}: tokens kept`);
    t.ok(W.time === 400 && !W.p.big, `${feel}: full time, small`);
    t.eq(W.retries, 1, `${feel}: retries`);
    t.ok(W.mid && W.mid.id === 'en-a' && W.mid.tx === 12, `${feel}: the checkpoint stays active`);
    const s = G.snapshot(W);
    t.eq(recsOf(G, s, /^ckpt_on$/).length, 1, `${feel}: the post shows its flag`);
    // a second death does not re-emit the checkpoint
    const ev2 = until(G, W, RIGHT, sawType('levelstart'), 1500, t, 'second respawn');
    t.ok(!first(ev2, 'checkpoint') && first(ev2, 'levelstart').checkpoint === true, `${feel}: second respawn at the checkpoint, no second checkpoint event`);
  }
};

// EN7: game over then CONTINUE: 3 lives, score 0, main level start, continue event; END returns to title
TESTS.EN7 = (G, t) => {
  const toContinue = (feel) => {
    const W = G.startAt('en-a', { feel, lives: 1 });
    W.tokens['en-a'] = 3;
    const ev = until(G, W, RIGHT, sawType('gameover'), 1500, t, 'game over');
    t.ok(first(ev, 'checkpoint') && first(ev, 'lifelost', (e) => e.lives === 0), `${feel}: died past the checkpoint with the last life`);
    t.ok(first(ev, 'song', (e) => e.id === 'gameover'), `${feel}: the gameover song`);
    t.eq(W.mode, 'gameover', `${feel}: mode`);
    t.eq(G.snapshot(W).m, 3, `${feel}: snapshot mode code`);
    G.run(W, 0, 179);
    t.eq(W.mode, 'gameover', `${feel}: still game over after 179 more frames`);
    G.run(W, 0, 1);
    t.eq(W.mode, 'continue', `${feel}: continue after 180 frames`);
    const s = G.snapshot(W);
    t.ok(s.m === 5 && s.cont && s.cont.sel === 0 && s.spr.length === 0, `${feel}: continue snapshot {m 5, cont.sel 0, empty spr}`);
    return W;
  };
  for (const feel of ['modern', 'nes']) {
    const W = toContinue(feel);
    W.score = 12345;
    let ev = G.run(W, DOWN, 1);
    t.ok(first(ev, 'cursor') && W.cont.sel === 1, `${feel}: DOWN moves to END`);
    G.run(W, 0, 1);
    ev = G.run(W, SELECT, 1);
    t.ok(first(ev, 'cursor') && W.cont.sel === 0, `${feel}: SELECT moves back to CONTINUE`);
    G.run(W, 0, 1);
    ev = G.run(W, A, 1);
    const c = first(ev, 'continue');
    t.ok(c && c.id === 'en-a', `${feel}: continue {id: 'en-a'}`);
    t.ok(W.lives === 3 && W.score === 0 && W.coins === 0 && W.continues === 1 && W.mid === null, `${feel}: 3 lives, score 0, checkpoint cleared`);
    t.ok(W.mode === 'lives' && W.pending === 'en-a', `${feel}: the lives screen for the main level`);
    ev = until(G, W, 0, sawType('levelstart'), 120, t, 'restart');
    const ls = first(ev, 'levelstart');
    t.ok(ls.id === 'en-a' && ls.checkpoint === false && W.p.x === 64, `${feel}: main level start, not the checkpoint`);
    t.eq(W.tokens['en-a'], 3, `${feel}: tokens kept through the continue`);
  }
  const W = toContinue('modern');
  G.run(W, UP, 1);
  G.run(W, 0, 1);
  const ev = G.run(W, START, 1);
  t.ok(first(ev, 'quit') && W.mode === 'title', 'END (START on END) emits quit and returns to the title');
  t.ok(W.tokens && Object.keys(W.tokens).length === 0 && W.lives === W.startLives && W.score === 0 && W.continues === 0, 'the title starts a new run');
  G.run(W, 0, 1);
  t.eq(W.song, 'title', 'the title song');
};

// EN8: routing: to the sub-area and back on the same level object, rising from the parent's pipeUp; a
// side pipe to a new area; a death in a sub-area restarts its main level
TESTS.EN8 = (G, t) => {
  {
    const W = G.startAt('en-r1');
    const r1 = W.lv;
    place(W, 164, 116);
    until(G, W, DOWN, (w) => w.lv.def.id === 'en-r1b', 100, t, 'en-r1b');
    t.ok(W.areas.length === 2 && W.areas[0] === r1 && W.areas[1] === W.lv, 'W.areas holds the parent and the sub-area');
    until(G, W, RIGHT, (w) => w.lv !== w.areas[1] || w.lv === r1, 600, t, 'back to en-r1');
    t.ok(W.lv === r1, 'back on the same level object');
    t.ok(W.p.st === 'pipeUp' && W.p.x === 30 * 16 + 8, `rising from pipeUp 30 (x ${W.p.x})`);
    until(G, W, 0, (w) => w.p.st === 'play', 100, t, 'out of the pipe');
    t.ok(W.p.y === rowTop(8) && W.p.ground, 'standing on the pipe top');
    t.ok(W.areas.length === 1 && W.areas[0] === r1, 'W.areas back to one');
  }
  {
    const W = G.startAt('en-r2');
    const r2 = W.lv;
    place(W, 164, 116);
    until(G, W, DOWN, (w) => w.lv.def.id === 'en-r2b', 100, t, 'en-r2b');
    W.lv.ents.length = 0; // clear the room's bug for the walk back
    until(G, W, RIGHT, (w) => w.lv === r2, 600, t, 'back to en-r2');
    t.ok(W.p.st === 'pipeUp' && W.p.x === 20 * 16 + 8, `rising from pipeUp 20 (x ${W.p.x})`);
    until(G, W, 0, (w) => w.p.st === 'play', 100, t, 'out of the pipe');
    place(W, 600);
    const ev = until(G, W, RIGHT, (w) => w.lv.def.id === 'en-r2x', 400, t, 'the exit yard');
    t.ok(W.areas.length === 1 && W.areas[0] === W.lv && W.lv !== r2, 'a side pipe to a new area drops the parent');
    t.ok(W.p.st === 'pipeUp' && W.p.x === 2 * 16 + 8, 'rising from pipe 2 in the exit yard');
    t.ok(first(ev, 'song', (e) => e.id === 'overworld' && e.section === 'A'), "the exit yard's song with section A (an over kind)");
    t.eq(W.mainId, 'en-r2', 'the exit yard belongs to en-r2');
  }
  {
    const W = G.startAt('en-r2');
    place(W, 164, 116);
    until(G, W, DOWN, (w) => w.lv.def.id === 'en-r2b', 100, t, 'en-r2b');
    const ev = until(G, W, 0, sawType('levelstart'), 800, t, 'death in the sub-area');
    t.ok(first(ev, 'die') && first(ev, 'levelstart').id === 'en-r2', 'a death in en-r2b restarts en-r2');
    t.ok(W.lv.def.id === 'en-r2' && W.areas.length === 1, 'one area after the restart');
  }
};

// EN8 on the real World 1 (src/game/01-world1.js), when it is loaded: 1-1 to 1-1b and back rises from
// pipe 148 on the same level object; 1-2 to 1-2b and back rises from 128; 1-2's exit reaches 1-2x; a
// death in 1-2b restarts 1-2
TESTS.EN8W = (G, t) => {
  const D = G.CQ.GAME_DEFS || {};
  const need = ['1-1', '1-1b', '1-2', '1-2b', '1-2x'];
  if (!need.every((id) => D[id])) {
    t.note(`skipped: CQ.GAME_DEFS lacks ${need.filter((id) => !D[id]).join(', ')}`);
    return 'skip';
  }
  const downPipe = (W, tx) => {
    place(W, tx * 16 + 4, W.lv.pipeDownY);
    W.lv.ents.forEach((e) => (e.st = 'gone'));
    return until(G, W, DOWN, (w) => w.lv.def.id !== W.areas[0].def.id || w.areas.length === 2, 120, t, `down pipe ${tx}`);
  };
  // from: a standing x to walk out from. The sub-areas pass col 14, past 1-1b's hump (cols 8-11) and
  // 1-2b's block (cols 11-12), which a plain walk right from the drop point cannot clear.
  const walkOut = (W, target, from) => {
    if (from != null) place(W, from);
    W.lv.ents.forEach((e) => (e.st = 'gone'));
    return until(G, W, RIGHT, (w) => w.lv === target || w.lv.def.id === target, 900, t, 'side pipe');
  };
  {
    const W = G.startAt('1-1');
    const l11 = W.lv;
    downPipe(W, 134);
    t.eq(W.lv.def.id, '1-1b', '1-1 pipe 134 leads to 1-1b');
    walkOut(W, l11, 14 * 16);
    t.ok(W.lv === l11 && W.p.x === 148 * 16 + 8, `1-1b's side pipe rises from pipe 148 of the same 1-1 (x ${W.p.x})`);
  }
  {
    const W = G.startAt('1-2');
    const l12 = W.lv;
    downPipe(W, 90);
    t.eq(W.lv.def.id, '1-2b', '1-2 pipe 90 leads to 1-2b');
    walkOut(W, l12, 14 * 16);
    t.ok(W.lv === l12 && W.p.x === 128 * 16 + 8, `1-2b's side pipe rises from pipe 128 of the same 1-2 (x ${W.p.x})`);
    until(G, W, 0, (w) => w.p.st === 'play', 100, t, 'out');
    place(W, 196 * 16);
    walkOut(W, '1-2x');
    t.ok(W.lv.def.id === '1-2x' && W.areas.length === 1, "1-2's side exit reaches 1-2x");
  }
  {
    const W = G.startAt('1-2');
    downPipe(W, 90);
    W.time = 1;
    W.timeT = 0;
    const ev = until(G, W, 0, sawType('levelstart'), 800, t, 'death in 1-2b');
    t.ok(first(ev, 'die', (e) => e.cause === 'time') && first(ev, 'levelstart').id === '1-2', 'a death in 1-2b restarts 1-2');
  }
};

// EN9: hurry at 100: hurry, the hurry song, then <song>Fast 90 frames later; star end resumes the fast variant
TESTS.EN9 = (G, t) => {
  for (const [id, song, section] of [['en-flat', 'overworld', 'A'], ['en-under', 'underground', undefined]]) {
    const W = G.startAt(id);
    W.time = 101;
    W.timeT = 0;
    const ev = until(G, W, 0, sawType('hurry'), 30, t, 'hurry');
    const h = first(ev, 'hurry');
    t.ok(first(ev, 'song', (e) => e.id === 'hurry' && e.f === h.f), `${id}: the hurry song on the hurry frame`);
    t.eq(W.time, 100, `${id}: hurry at 100`);
    const ev2 = until(G, W, 0, sawType('song'), 120, t, 'fast song');
    const fs1 = first(ev2, 'song');
    t.ok(fs1.id === song + 'Fast' && fs1.section === section && fs1.f === h.f + 90, `${id}: ${song}Fast${section ? '/' + section : ''} 90 frames after (got ${fs1.id}/${fs1.section} at +${fs1.f - h.f})`);
    // the spark: the star song, then its end resumes the fast variant
    const p = W.p;
    W.items.push({ k: 'spark', x: p.x, y: p.y, vx: 0, vy: 0, st: 'move', t: 0, ground: true, y1: p.y });
    const ev3 = G.run(W, 0, 2);
    t.ok(first(ev3, 'song', (e) => e.id === 'star'), `${id}: the star song`);
    const ev4 = until(G, W, 0, sawType('song'), 400, t, 'star end');
    const fs2 = first(ev4, 'song');
    const want = section ? 'B' : undefined;
    t.ok(fs2.id === song + 'Fast' && fs2.section === want, `${id}: the star's end resumes ${song}Fast${want ? '/' + want : ''} (got ${fs2.id}/${fs2.section})`);
  }
  // a star during the jingle: the star song holds until the jingle is over, then star, then fast
  const W = G.startAt('en-flat');
  W.time = 101;
  W.timeT = 0;
  until(G, W, 0, sawType('hurry'), 30, t, 'hurry');
  W.items.push({ k: 'spark', x: W.p.x, y: W.p.y, vx: 0, vy: 0, st: 'move', t: 0, ground: true, y1: W.p.y });
  const ev = G.run(W, 0, 400);
  const songs = types(ev, 'song').map((e) => e.id + (e.section ? '/' + e.section : ''));
  t.eq(songs.join(','), 'star,overworldFast/B', 'star during the jingle, then the fast song at its end');
  // the clock runs out
  const W2 = G.startAt('en-flat');
  W2.time = 1;
  W2.timeT = 0;
  const ev5 = until(G, W2, 0, sawType('die'), 30, t, 'time out');
  t.ok(first(ev5, 'die', (e) => e.cause === 'time'), 'time 0: die {cause: time}');
};

// EN10: multi-coin C: at most 10 coins inside 240 frames, then U; never breaks
TESTS.EN10 = (G, t) => {
  const hop = (W) => (W.p.ground && !(W.prev & A) ? A : 0);
  for (const form of ['small', 'big']) {
    for (const feel of ['modern', 'nes']) {
      const W = G.startAt('en-blocks', { form, feel });
      place(W, 160);
      const coins = [];
      let broke = false, usedAt = -1;
      for (let i = 0; i < 400; i++) {
        const ev = G.step(W, hop(W));
        for (const e of ev) if (e.type === 'coin') coins.push(e.f);
        const c = cellAt(W, 10, 7);
        if (c === '.') broke = true;
        if (c === 'U' && usedAt < 0) usedAt = W.f - 1;
      }
      const label = `${form}/${feel}`;
      t.eq(coins.length, 10, `${label}: coins from one multi-coin brick`);
      t.ok(coins.length === 10 && coins[9] - coins[0] < 240, `${label}: all ten inside the 240-frame window`);
      t.ok(usedAt === coins[9], `${label}: it turns used on the bump that pays the 10th coin`);
      t.ok(!broke, `${label}: it never breaks`);
      t.ok(W.lv.multi && Object.keys(W.lv.multi).length === 1, `${label}: its state lives in lv.multi`);
    }
  }
  // the window closes: the first bump after it still pays, and spends the block
  const W = G.startAt('en-blocks');
  place(W, 320);
  const ev = G.run(W, A, 12);
  t.eq(types(ev, 'coin').length, 1, 'one bump, one coin');
  G.run(W, 0, 250);
  const ev2 = G.run(W, A, 12);
  t.ok(types(ev2, 'coin').length === 1 && cellAt(W, 20, 7) === 'U', 'the first bump after the window pays and turns used');
  const ev3 = G.run(W, 0, 30).concat(G.run(W, A, 12));
  t.ok(types(ev3, 'coin').length === 0 && first(ev3, 'bump'), 'a used block just bumps');
};

// EN11: N and + sprout life; pickup gives a life and oneup; sky-level items never move
TESTS.EN11 = (G, t) => {
  const code = (ch) => ch.charCodeAt(0);
  t.ok(G.CQ.SOLID[code('+')] === 0 && G.CQ.SOLID[code('N')] === 1 && G.CQ.SOLID[code('C')] === 1, "SOLID: '+' is not solid, N and C are");
  for (const [col, ch] of [[30, 'N'], [40, '+']]) {
    const W = G.startAt('en-blocks');
    place(W, col * 16);
    const ev = until(G, W, (w, i) => (i === 0 ? A : 0), sawType('sprout'), 40, t, `${ch} bumped`);
    t.ok(first(ev, 'sprout') && W.items.length === 1 && W.items[0].k === 'life', `${ch}: sprouts the life item`);
    t.eq(cellAt(W, col, 7), 'U', `${ch}: turns used`);
    const lives = W.lives;
    until(G, W, LEFT, (w) => w.p.x <= col * 16 - 72, 120, t, 'step back');
    until(G, W, 0, (w) => w.items[0] && w.items[0].st === 'move' && w.items[0].ground && w.items[0].y === 148, 300, t, 'life walking on the ground');
    const score = W.score;
    const ev2 = until(G, W, RIGHT | B, sawType('oneup'), 400, t, 'the 1UP caught');
    t.eq(W.lives, lives + 1, `${ch}: a life`);
    t.eq(W.score, score, `${ch}: no points`);
    t.ok(W.items.length === 0 && first(ev2, 'oneup'), `${ch}: the item is gone, oneup emitted`);
  }
  // lives cap at 99
  const W99 = G.startAt('en-blocks', { lives: 99 });
  place(W99, 30 * 16);
  G.run(W99, A, 1);
  until(G, W99, LEFT, (w) => w.p.x <= 30 * 16 - 72, 120, t, 'step back');
  until(G, W99, 0, (w) => w.items[0] && w.items[0].ground && w.items[0].y === 148, 300, t, 'life on the ground');
  until(G, W99, RIGHT | B, sawType('oneup'), 400, t, 'the 1UP caught');
  t.eq(W99.lives, 99, 'lives cap at 99');
  // the sky: every item stays where it sprouted
  for (const feel of ['modern', 'nes']) {
    const W = G.startAt('en-sky', { feel });
    // right to left, the camera kept home: an item more than 32 px left of the camera is gone (the film's rule)
    for (const col of [22, 18, 14, 10]) {
      place(W, col * 16);
      W.cam = 0;
      until(G, W, (w, i) => (i === 0 ? A : 0), sawType('sprout'), 40, t, `sky block ${col}`);
      G.run(W, 0, 20);
    }
    G.run(W, 0, 40);
    t.eq(W.items.map((it) => it.k).join(','), 'life,spark,mushroom,life', `${feel}: sky items sprouted`);
    const pos = W.items.map((it) => it.st + '@' + it.x + ',' + it.y).join(' ');
    t.ok(W.items.every((it) => it.st === 'rest'), `${feel}: every sky item rests (${pos})`);
    G.run(W, 0, 300);
    const pos2 = W.items.map((it) => it.st + '@' + it.x + ',' + it.y).join(' ');
    t.eq(pos2, pos, `${feel}: sky items have not moved after 300 frames`);
  }
};

// EN12: terminal when big, floppy when small; code freeze 30 frames; a hit drops code to small in both feel modes
TESTS.EN12 = (G, t) => {
  for (const feel of ['modern', 'nes']) {
    {
      const W = G.startAt('en-blocks', { feel });
      place(W, 800);
      until(G, W, (w, i) => (i === 0 ? A : 0), sawType('sprout'), 40, t, 'M bumped small');
      t.eq(W.items[0].k, 'mushroom', `${feel}: small bumps the floppy`);
    }
    const W = G.startAt('en-blocks', { feel, form: 'big' });
    place(W, 800);
    until(G, W, (w, i) => (i === 0 ? A : 0), sawType('sprout'), 40, t, 'M bumped big');
    t.eq(W.items[0].k, 'terminal', `${feel}: big bumps the terminal`);
    until(G, W, 0, (w) => w.items[0].st === 'rest' && w.p.ground, 80, t, 'terminal sprouted');
    const it = W.items[0];
    t.ok(it.x === 800 && it.y === rowTop(7), `${feel}: the terminal stays on its block`);
    G.run(W, 0, 60);
    t.ok(W.items[0] && W.items[0].x === 800 && W.items[0].y === rowTop(7), `${feel}: ...and never walks`);
    // find a way up to it: back off k frames, then a jump right holding A n frames
    let plan = null;
    search: for (let k = 0; k <= 40; k += 2) {
      for (const n of [4, 8, 12, 16, 20]) {
        const c = G.clone(W);
        const seq = [];
        for (let i = 0; i < k; i++) seq.push(LEFT);
        for (let i = 0; i < 8; i++) seq.push(0);
        for (let i = 0; i < n; i++) seq.push(RIGHT | A);
        for (let i = 0; i < 60; i++) seq.push(RIGHT);
        for (let i = 0; i < seq.length; i++) {
          G.step(c, seq[i]);
          if (c.freeze > 0 && c.freezeK === 'code') {
            plan = seq.slice(0, i + 1);
            break search;
          }
          if (c.p.st !== 'play') break;
        }
      }
    }
    t.must(plan, `${feel}: a route up to the terminal`);
    const score = W.score;
    G.run(W, plan, plan.length);
    const pick = W.f - 1;
    t.ok(W.freeze === 30 && W.freezeK === 'code' && W.score === score + 1000, `${feel}: the pickup: 1000 and a 30-frame code freeze`);
    const lt = W.lv.t;
    const sFreeze = G.snapshot(W);
    const pr = playerRec(G, sFreeze);
    t.ok(pr && pr[4] === 7 && pr[3] & 256, `${feel}: during the freeze Claw'd shows pal 7 with FLICKER (${pr})`);
    const ev = until(G, W, 0, sawType('powerup'), 40, t, 'powerup');
    const pu = first(ev, 'powerup');
    t.ok(pu.form === 'code' && pu.f === pick + 30, `${feel}: powerup {form: 'code'} 30 frames after the pickup (+${pu.f - pick})`);
    t.eq(W.lv.t, lt, `${feel}: the world held during the freeze`);
    t.ok(W.p.code && W.code && W.p.big, `${feel}: Claw'd Code`);
    G.run(W, 0, 1);
    const pr2 = playerRec(G, G.snapshot(W));
    t.ok(pr2 && pr2[4] === 7 && !(pr2[3] & 256), `${feel}: Claw'd Code draws in pal 7`);
    // another M bumped while Code is another terminal
    // a hit drops Code to small
    const H2 = G.startAt('en-hit', { feel, form: 'code' });
    t.ok(H2.p.code && H2.p.big, `${feel}: form 'code' starts as Claw'd Code`);
    const evh = until(G, H2, RIGHT, sawType('hurt'), 300, t, 'hit');
    t.ok(first(evh, 'hurt', (e) => e.cause === 'enemy') && !first(evh, 'pipe'), `${feel}: hurt {cause: 'enemy'} (not the film's pipe)`);
    t.ok(!H2.p.big && !H2.p.code && !H2.code && !H2.big && H2.p.inv === 119, `${feel}: small, no code, invincible (inv ${H2.p.inv})`);
    // big (not code) also drops to small
    const H3 = G.startAt('en-hit', { feel, form: 'big' });
    until(G, H3, RIGHT, sawType('hurt'), 300, t, 'hit');
    t.ok(!H3.p.big, `${feel}: a hit drops big to small`);
  }
};

// EN13: memory: 50 deaths in a row keep W.areas at 1 or 2 entries and W.built unchanged in live play
TESTS.EN13 = (G, t) => {
  const W = G.startAt('en-r2', { lives: 99 });
  const built0 = W.built.length;
  let deaths = 0, maxAreas = 0, minAreas = 9, frames = 0, sub = 0;
  while (deaths < 50 && frames < 60000) {
    let b = 0;
    if (W.mode === 'play' && W.p.st === 'play' && W.lv.def.id === 'en-r2') {
      if (deaths % 2 === 0) {
        if (W.p.x !== 164 || W.p.y !== 116) place(W, 164, 116);
        b = DOWN; // into the room with the bug
      } else b = RIGHT | B; // or run into the side-pipe exit's way... and meet the time
    }
    if (W.mode === 'play' && W.p.st === 'play' && W.lv.def.id === 'en-r2' && deaths % 2 === 1 && W.time > 2) {
      W.time = 2;
      W.timeT = 0;
    }
    const ev = G.step(W, b);
    frames++;
    if (W.lv.def.id === 'en-r2b') sub++;
    for (const e of ev) if (e.type === 'lifelost') deaths++;
    if (W.mode === 'play') {
      maxAreas = Math.max(maxAreas, W.areas.length);
      minAreas = Math.min(minAreas, W.areas.length);
    }
    if (W.built.length !== built0) break;
  }
  t.eq(deaths, 50, 'deaths');
  t.ok(sub > 0, 'half of them in the sub-area');
  t.ok(minAreas >= 1 && maxAreas <= 2, `W.areas stayed within 1..2 (${minAreas}..${maxAreas})`);
  t.eq(W.built.length, built0, 'W.built unchanged');
  t.eq(W.levels.length, 0, 'W.levels unused in live play');
  t.eq(W.retries, 50, 'retries count every life lost');
};

// EN14: clear card 150 frames, then the lives screen for next; the credits: a 672-frame parade with
// fireworks that START skips, then the card, which takes START from 60 frames in
TESTS.EN14 = (G, t) => {
  {
    const W = G.startAt('en-e1');
    const ev = until(G, W, toPole, sawType('flagpole'), 600, t, 'the pole');
    const grabTime = W.time;
    const ev2 = until(G, W, 0, sawType('clear'), 1000, t, 'the clear card');
    const c = first(ev2, 'clear');
    t.ok(c.id === 'en-e1' && c.time === grabTime && c.score === W.score && c.tokens === 0, `clear {id, score, time: ${grabTime}, tokens}`);
    t.eq(W.mode, 'clear', 'mode clear');
    const s = G.snapshot(W);
    t.ok(s.m === 6 && s.spr.length === 0 && s.clear && s.clear.id === 'en-e1' && s.clear.name === 'THE RUN' && s.clear.time === grabTime && s.clear.coins === 0, `the clear snapshot ${JSON.stringify(s.clear)}`);
    let n = 0;
    while (W.mode === 'clear' && n < 400) {
      G.step(W, START | A);
      n++;
    }
    t.eq(n, 150, 'the clear card lasts 150 frames (buttons do not skip it)');
    t.ok(W.mode === 'lives' && W.pending === 'en-e2', `then the lives screen for next (${W.mode} ${W.pending})`);
    const sl = G.snapshot(W);
    t.ok(sl.m === 1 && sl.name === 'THE KEEP' && sl.lid === 'en-e2' && sl.world === '9-2', `the lives screen names the next level (${sl.name}, ${sl.world})`);
    t.eq(W.mid, null, 'a clear clears the checkpoint');
    t.ok(!!first(ev, 'flagpole'), 'flagpole');
  }
  const toCredits = () => {
    const W = G.startAt('en-e2');
    W.retries = 2;
    until(G, W, RIGHT, sawType('axe'), 600, t, 'the ENTER key');
    const ev = until(G, W, 0, sawType('complete'), 1200, t, 'the ending');
    const c = first(ev, 'complete');
    t.ok(c && c.retries === 2 && c.tokens === 0 && c.score === W.score, `complete {score, tokens, retries} ${JSON.stringify(c)}`);
    t.ok(first(ev, 'song', (e) => e.id === 'ending-full'), 'the ending-full song');
    const s = G.snapshot(W);
    t.ok(s.end && s.end.lines.length === 7 && s.end.lines[4] === '✓ 0/12 TOKENS' && s.end.lines[5] === '✓ 2 RETRIES', `seven ending lines (${s.end && s.end.lines.join(' / ')})`);
    until(G, W, 0, (w) => G.snapshot(w).end.push >= 0, 800, t, 'PUSH START');
    G.run(W, START, 1);
    t.eq(W.mode, 'play', 'START right as PUSH START appears is too early');
    G.run(W, 0, 61);
    const evc = G.run(W, START, 1);
    t.ok(first(evc, 'credits') && W.mode === 'credits', 'START after the ending text: credits');
    t.ok(first(evc, 'song', (e) => e.id === 'credits' && !e.section), 'the credits song starts with the credits');
    const sc = G.snapshot(W);
    t.ok(sc.m === 7 && sc.spr.length === 0 && sc.credits && sc.credits.t === 0 && sc.credits.tokens === 0 && sc.credits.perfect === false, `the credits snapshot ${JSON.stringify(sc.credits)}`);
    return W;
  };
  // the parade (672 frames): fireworks on frames 96, 288, 480 and 576; then the card, where START is
  // accepted from frame 732 (60 frames on the card)
  {
    const W = toCredits();
    const fw = [];
    G.run(W, 0, 671, { onFrame: (w, ev) => { if (first(ev, 'firework')) fw.push(w.credits.t); } });
    t.eq(fw.join(), '96,288,480,576', 'a firework on frames 96, 288, 480 and 576 of the parade');
    t.eq(W.credits.t, 671, 'credits clock: the parade\'s last frame');
    const evp = G.run(W, 0, 1);
    t.ok(W.credits.t === 672 && !types(evp, 'song').length, 'the card at frame 672, the song landing there by itself (no song event)');
    G.run(W, 0, 58);
    G.run(W, START, 1); // t 731
    t.eq(W.mode, 'credits', 'START 59 frames into the card is ignored');
    const ev = G.run(W, START, 1); // t 732, a fresh press? (held from the last frame: no)
    t.eq(W.mode, 'credits', 'a held START is not a press');
    G.run(W, 0, 1);
    const ev2 = G.run(W, START, 1); // t 734
    t.ok(W.mode === 'title', `START 60 or more frames into the card returns to the title (${W.mode})`);
    t.eq(types(ev.concat(ev2), 'song').map((e) => e.id).join(), '', 'no song change on the step that leaves the credits');
    G.run(W, 0, 1);
    t.eq(W.song, 'title', 'the title song');
  }
  // START during the parade skips to the card: the clock jumps to 672 and the song to its card section
  {
    const W = toCredits();
    G.run(W, 0, 99);
    const ev = G.run(W, START, 1); // t 100
    t.ok(W.mode === 'credits' && W.credits.t === 672, `START in the parade skips to the card (t ${W.credits.t})`);
    t.ok(first(ev, 'song', (e) => e.id === 'credits' && e.section === 'card'), 'the song jumps to its card section');
    const evr = G.run(W, 0, 600);
    t.ok(!first(evr, 'firework') && W.mode === 'credits', 'no firework after the skip; the card holds without START');
  }
  {
    const W = toCredits();
    G.run(W, 0, 99);
    G.run(W, START, 1); // skip: t 672
    G.run(W, 0, 59); // t 731
    G.run(W, START, 1); // t 732
    t.ok(W.mode === 'title', `after a skip, START at exactly 60 frames into the card is accepted (${W.mode})`);
  }
  {
    const W = toCredits();
    let n = 0;
    while (W.mode === 'credits' && n < 6000) {
      G.step(W, 0);
      n++;
    }
    t.eq(n, 672 + 3600, 'the final card returns to the title by itself 3600 frames in');
  }
};

// ------------------------------------------------------------------------------------------------
// P1's other acceptance: the seam, the API, the snapshot fields, the boss fields, the film path, the
// sources, and live play end to end
// ------------------------------------------------------------------------------------------------
TESTS.SEAM = (G, t) => {
  const CQ = G.CQ;
  const kit = ['Q', 'PH', 'BUTTONS', 'rowTop', 'rowOf', 'cell', 'solidAt', 'headAt', 'setCell', 'bodyL', 'bodyR', 'bodyH', 'drawH',
    'emit', 'setSong', 'addScore', 'pop', 'popOf', 'comboPoints', 'hurt', 'nudgeX'];
  t.eq(Object.keys(CQ.K).sort().join(','), kit.slice().sort().join(','), 'CQ.K holds exactly the kit');
  t.ok(Object.isFrozen(CQ.K), 'CQ.K is frozen');
  t.ok(CQ.KINDS && typeof CQ.KINDS === 'object' && Array.isArray(CQ.systems), 'CQ.KINDS and CQ.systems');
  t.eq(JSON.stringify(CQ.PAL), JSON.stringify({ STAR1: 1, BUG_U: 5, SHELLBUG_U: 6, CODE: 7, LIFE: 8, BOSS_HIT: 9, MOTH_U: 10, SPIKE_U: 11, FRAG_U: 12 }), 'CQ.PAL');
  t.eq(JSON.stringify(CQ.FLAG), JSON.stringify({ FLIP: 1, FLIPV: 2, BEHIND: 4, BUMP: 16, FEET: 32, RIGHT: 64, LEFT: 128, FLICKER: 256 }), 'CQ.FLAG');
  t.ok(CQ.PAL_BUG_U === 5 && CQ.PAL_SHELLBUG_U === 6 && CQ.ANCHOR && CQ.ANCHOR.FEET === 32, 'the existing PAL_BUG_U, PAL_SHELLBUG_U and ANCHOR stay');
  t.eq(CQ.K.popOf('200'), 1, "popOf('200')");
  t.eq(CQ.K.popOf('5000'), 8, "popOf('5000')");
  const p = { big: true, x: 0 };
  t.ok(CQ.K.drawH(p) === 24 && CQ.K.drawH({ big: false }) === 16, 'drawH 24 big, 16 small');
  // nudgeX: walls and the camera, vx untouched
  const W = G.startAt('en-corner');
  place(W, 100);
  W.p.vx = 1.25;
  CQ.K.nudgeX(W, W.lv, W.p, 5);
  t.ok(W.p.x === 105 && W.p.vx === 1.25, 'nudgeX moves by dx and leaves vx');
  W.cam = 100;
  CQ.K.nudgeX(W, W.lv, W.p, -20);
  t.eq(W.p.x, 100, 'nudgeX keeps him on the camera');
  // TILE_NAMES (9.2)
  const T = CQ.TILE_NAMES;
  t.ok(T.over.C === 't_brick' && T.under.C === 't_brickU' && T.castle.B === 't_brickC' && T.castle.C === 't_brickC', 'TILE_NAMES: C and the castle B');
  t.eq(JSON.stringify(T.sky), JSON.stringify({ '#': 't_cloudTop', B: 't_brick', C: 't_brick', U: 't_used', X: 't_stair', T: 't_rackTop', R: 't_rack' }), 'TILE_NAMES.sky');
  t.ok(['N', 'C', 'T', 'S'].every((c) => CQ.SOLID[c.charCodeAt(0)] === 1), 'SOLID gains N C T S');
  t.ok(CQ.K.headAt({ w: 1, grid: Uint8Array.of('+'.charCodeAt(0)) }, 8, rowTop(0) + 4) === true, "headAt treats '+' as solid");
};

// the hook call points (2.4), probed in a fresh context with a recording system and a recording kind
TESTS.HOOKS = (G0, t) => {
  const log = [];
  const G = H.load({
    bare: true,
    defs: (CQ) => {
      const rows = require('./fixtures/engine-defs.cjs').blank(48);
      rows[9][30] = 'm';
      rows[9][20] = 's'; // no 'spike' kind registered: it must not spawn
      rows[5][12] = 't';
      rows[5][13] = 'Q';
      const done = rows.map((r) => r.join(''));
      return { 'hk-a': { id: 'hk-a', name: 'HOOKS', world: '7-1', kind: 'over', rows: done, time: 400, song: 'overworld', start: { x: 40, y: 148 },
        pipeDown: { tx: 44, to: 'hk-a' } } };
    },
  });
  const CQ = G.CQ;
  const rec = (name) => (...args) => {
    log.push({ name, args, f: args.find((a) => a && typeof a === 'object' && 'mode' in a) ? args.find((a) => a && 'mode' in a).f : -1 });
  };
  let supportArgs = null, landArgs = null;
  CQ.systems.push({
    spawn: { t: (lv, tx, ty, def, W) => (log.push({ name: 'spawn', args: [lv, tx, ty, def, W] }), '.'), Q: () => 'U' },
    build: rec('build'), enter: rec('enter'), pre: rec('pre'), input: rec('input'), step: rec('step'),
    support: (W, lv, p) => ((supportArgs = [W, lv, p]), false),
    land: (W, lv, p, y0) => ((landArgs = [W, lv, p, y0]), false),
    grounded: rec('grounded'),
    sprites: (W, lv, out, vf) => {
      log.push({ name: 'sprites', args: [W, lv, out, vf] });
      out.push(CQ.ni('probe'), 1, 2, 0, 0);
    },
    cloneLevel: rec('cloneLevel'), cloneWorld: rec('cloneWorld'),
  });
  const moth = { moves: 0, stomps: 0 };
  CQ.KINDS.moth = {
    top: 12, flier: true, spiky: false,
    move(W, lv, e) { moth.moves++; moth.t = e.t; },
    onStomp(W, lv, e, p) { moth.stomps++; e.st = 'dead'; e.vy = 0; },
    sprite(W, lv, e, vf) { return ['moth1', 16, 0, 10]; },
  };
  // the film never calls a hook
  const F = CQ.newWorld({});
  for (let i = 0; i < 700; i++) CQ.step(F, i === 200 ? START : i > 320 ? RIGHT : 0);
  CQ.snapshot(F);
  CQ.cloneWorld(F);
  t.eq(log.length + (supportArgs ? 1 : 0) + (landArgs ? 1 : 0) + moth.moves, 0, 'a film world calls no hook');
  // live
  const W = G.startAt('hk-a');
  const spawn = log.find((e) => e.name === 'spawn');
  t.ok(spawn && spawn.args[1] === 12 && spawn.args[2] === 5 && spawn.args[3].id === 'hk-a' && spawn.args[4] === W, 'spawn[ch](lv, tx, ty, def, W) for the t cell');
  t.eq(String.fromCharCode(W.lv.grid[5 * W.lv.w + 12]), '.', 'spawn returns the char left in the grid');
  t.eq(String.fromCharCode(W.lv.grid[5 * W.lv.w + 13]), 'U', 'a spawn hook may leave another char');
  const iBuild = log.findIndex((e) => e.name === 'build' && e.args[1].id === 'hk-a' && e.args[2] === W);
  const iEnter = log.findIndex((e) => e.name === 'enter' && e.args[0] === W);
  t.ok(iBuild >= 0 && iEnter > iBuild, 'build(lv, def, W) then enter(W, lv) at startLevel');
  t.eq(W.lv.ents.filter((e) => e.kind === 'moth').length, 1, "an 'm' spawns a moth (its kind is registered)");
  t.eq(W.lv.ents.filter((e) => e.kind === 'spike').length, 0, "an 's' spawns nothing without a spike kind");
  const m = W.lv.ents.find((e) => e.kind === 'moth');
  t.ok(m.y0 === rowTop(9) + 16 && m.y === m.y0 && m.st === 'wait', 'the moth: feet line y0, waiting');
  log.length = 0;
  G.run(W, RIGHT, 1);
  const order = log.map((e) => e.name).join(',');
  t.eq(order, 'pre,grounded,input,step', 'one play frame calls pre, grounded, input, step in that order');
  t.ok(supportArgs === null, 'support is not asked while a tile holds him');
  // walk off nothing... jump: land is asked while falling with no tile under him
  G.run(W, A, 1);
  G.run(W, 0, 40);
  t.ok(landArgs && landArgs[0] === W && typeof landArgs[3] === 'number', 'land(W, lv, p, y0) asked while falling');
  // activation at cam + 328: the moth at x 480 wakes once the camera reaches 152
  until(G, W, RIGHT | B, (w) => m.st === 'walk', 400, t, 'the moth wakes');
  t.ok(W.cam + 328 >= 480 && moth.moves >= 1, `the moth activates at cam + 328 (cam ${W.cam}) and its move() runs`);
  // sprites(W, lv, out, vf) before the player
  log.length = 0;
  const s = G.snapshot(W);
  const sp = log.find((e) => e.name === 'sprites');
  t.ok(sp && sp.args[0] === W && sp.args[3] === W.vf, 'sprites(W, lv, out, vf)');
  const probeI = recsOf(G, s, /^probe$/)[0], playerI = recsOf(G, s, /^clawd/)[0], mothI = recsOf(G, s, /^moth1$/)[0];
  t.ok(probeI && playerI && probeI.i < playerI.i, 'a system sprite comes before the player');
  t.ok(mothI && mothI.pal === 10 && mothI.y === Math.floor(m.y) - 16, "a kind's sprite() gives name, height, flags and pal");
  // clones
  log.length = 0;
  const c = G.clone(W);
  t.ok(log.some((e) => e.name === 'cloneLevel' && e.args[0] === W.lv && e.args[1] === c.lv) && log.some((e) => e.name === 'cloneWorld' && e.args[0] === W && e.args[1] === c), 'cloneLevel(src, dst) and cloneWorld(src, dst)');
  // a stomp calls onStomp after the stomp event, and the engine bounces him
  const W2 = G.startAt('hk-a');
  const m2 = W2.lv.ents.find((e) => e.kind === 'moth');
  m2.st = 'walk';
  m2.x = 200;
  m2.y = 148;
  place(W2, 200);
  W2.p.y = 140;
  W2.p.vy = 2;
  W2.p.ground = false;
  const ev = G.run(W2, 0, 1);
  t.ok(first(ev, 'stomp') && moth.stomps === 1 && W2.p.vy < 0, 'a stomp: the stomp event, onStomp(), the bounce');
  // enter after enterArea and exitArea (the down pipe loops to its own level here)
  log.length = 0;
  place(W2, 44 * 16 + 4, 148);
  W2.lv.pipeDownY = 148;
  until(G, W2, DOWN, (w) => w.areas.length === 2, 60, t, 'pipe');
  t.ok(log.some((e) => e.name === 'enter' && e.args[1] === W2.lv), 'enter(W, lv) after enterArea');
};

TESTS.API = (G, t) => {
  const FG = G.FILM.game;
  t.ok(Object.isFrozen(FG), 'FILM.game is frozen');
  t.eq(['BUTTONS', 'create', 'demo', 'sim', 'draw', 'events', 'tape', 'record'].filter((k) => !(k in FG)).join(), '', 'FILM.game members');
  const g = FG.create({ start: 'en-flat', feel: 'nes', top: 4321, shellMenu: true, form: 'big', lives: 7, live: false, junk: 1 });
  const W = g.state();
  t.ok(W.live === true && W.feel === 'nes' && W.assist === false && W.top === 4321 && W.shellMenu === true && W.startId === 'en-flat', 'create(opts): live, feel, top, shellMenu, start');
  t.eq(g.mode, 'title', 'mode getter');
  t.eq(g.frame, 0, 'frame getter');
  const ev = g.step(START);
  t.ok(first(ev, 'start') && g.frame === 1, 'step(buttons) returns the events');
  for (let i = 0; i < 120 && g.mode !== 'play'; i++) g.step(0);
  t.ok(g.mode === 'play' && W.lives === 7 && W.p.big && g.pausable === true, 'form and lives (proofs only); pausable getter');
  const s = g.snapshot();
  t.ok(s.m === 2 && s.live === true && s.shell === true && s.pausable === true, 'snapshot()');
  t.eq(typeof g.draw, 'function', 'draw(ctx, view)');
  const d = FG.create();
  t.ok(d.state().startId === '1-1' && d.state().feel === 'modern' && d.state().assist === true && d.state().top === 0 && d.state().lives === 3, 'defaults: 1-1, modern, top 0, 3 lives');
  const demo = FG.demo();
  t.ok(demo.frame === 310 && demo.done === false && typeof demo.step === 'function' && typeof demo.draw === 'function', 'demo(): frame 310, not done');
  const dW = demo.snapshot();
  t.ok(dW.m === 2 && dW.live === false, 'the demo is a film-rules world in play');
};

// every snapshot field of section 8, on a live world and the film
TESTS.SNAP = (G, t) => {
  const W = G.startAt('en-r1', { shellMenu: true });
  const s = G.snapshot(W);
  const want = { m: 'number', live: 'boolean', shell: 'boolean', pausable: 'boolean', lid: 'string', main: 'string', name: 'string',
    lives: 'number', tokens: 'number', tokenTotal: 'number' };
  for (const k in want) t.eq(typeof s[k], want[k], `s.${k} type`);
  t.ok('clear' in s && 'cont' in s && 'credits' in s && s.clear === null && s.cont === null && s.credits === null, 'clear, cont, credits are null in play');
  t.ok(s.spr instanceof G.CQ.snapshot(W).spr.constructor && s.spr.constructor.name === 'Int16Array', 'spr is an Int16Array');
  t.ok(s.lid === 'en-r1' && s.main === 'en-r1' && s.name === 'ROUTE ONE' && s.shell === true, 'lid, main, name, shell');
  W.tokens['en-r1'] = 5;
  W.tokens['x'] = 3;
  const s2 = G.snapshot(W);
  t.ok(s2.tokens === 5 && s2.tokenTotal === 4, `tokens (current main) and tokenTotal (the run): ${s2.tokens}, ${s2.tokenTotal}`);
  t.eq(recsOf(G, s2, /^ckpt_off$/).length, 1, 'the checkpoint post, not yet passed');
  const post = recsOf(G, s2, /^ckpt_off$/)[0];
  t.ok(post.x === 20 * 16 && post.y === rowTop(10) - 32, 'the post stands at (tx * 16, rowTop(row) - 32)');
  place(W, 164, 116);
  until(G, W, DOWN, (w) => w.lv.def.id === 'en-r1b', 100, t, 'sub-area');
  const s3 = G.snapshot(W);
  t.ok(s3.lid === 'en-r1b' && s3.main === 'en-r1' && s3.tokens === 5, 'a sub-area: lid, its main, the main level tokens');
  t.eq(recsOf(G, s3, /^ckpt/).length, 0, 'no post in a sub-area');
  // the film: s.f === W.f - 1 and the new fields at rest
  const F = G.CQ.newWorld({});
  for (let i = 0; i < 50; i++) G.step(F, 0);
  const sf = G.snapshot(F);
  t.ok(sf.f === F.f - 1 && sf.live === false && sf.shell === false && sf.pausable === false && sf.clear === null, 'film snapshot: f === W.f - 1, live false');
  t.ok(F.vf === F.f, 'film: W.vf === W.f');
  // frag palette 12 in an under level (live)
  const U = G.startAt('en-under', { form: 'big' });
  U.lv.grid[7 * U.lv.w + 3] = 'B'.charCodeAt(0);
  place(U, 40);
  G.run(U, A, 8);
  const fr = recsOf(G, G.snapshot(U), /^fragment/);
  t.ok(fr.length === 4 && fr.every((r) => r.pal === 12), `under brick fragments use pal 12 (${fr.map((r) => r.pal)})`);
};

// the boss fields P2 may set, and the boss song
TESTS.BOSS = (G, t) => {
  const W = G.startAt('en-boss');
  const b = W.lv.boss;
  t.ok(b.hopEvery === 120 && b.dead === false && b.hitT === 0 && b.flip === false && b.hp === 5, 'boss defaults: hopEvery 120, dead false, hitT 0, flip false, hp from def');
  // it wakes on the first play frame here (it stands within cam + 320): the boss song on that frame
  t.ok(!b.active && W.song === 'castle', 'asleep at the level start, the level song playing');
  const evA = G.run(W, 0, 1);
  t.ok(b.active && first(evA, 'song', (e) => e.id === 'boss'), `the boss song on the frame it wakes (song ${W.song})`);
  const W1 = G.startAt('en-boss');
  const hops = [];
  W1.lv.boss.hopEvery = 90;
  place(W1, 72, 116);
  W1.p.inv = 100000;
  const ev = G.run(W1, 0, 400);
  for (const e of types(ev, 'hop')) hops.push(e.f);
  t.ok(hops.length >= 3 && hops.every((f, i) => i === 0 || f - hops[i - 1] === 90), `hops every hopEvery frames (${hops.join(',')})`);
  // hitT and flip in the sprite
  W1.lv.boss.hitT = 5;
  W1.lv.boss.flip = true;
  const r = recsOf(G, G.snapshot(W1), /^boss_/)[0];
  t.ok(r && r.pal === 9 && r.flags & 256 && r.flags & 2, `hitT > 0: pal 9 with FLICKER; flip: FLIPV (${r && r.pal}, ${r && r.flags})`);
  // a dead boss never hurts, and the ENTER key skips bossfall; the rescue 16 frames after the last tile
  const W2 = G.startAt('en-boss');
  const b2 = W2.lv.boss;
  b2.dead = true;
  b2.fall = true;
  b2.vy = -3;
  b2.flip = true;
  const ev2 = until(G, W2, RIGHT, sawType('song', (e) => e.id === 'rescue'), 900, t, 'the rescue');
  t.ok(!first(ev2, 'die') && !first(ev2, 'hurt'), 'a dead boss never hurts');
  t.ok(!first(ev2, 'bossfall'), 'no bossfall for a dead boss');
  const lastTile = types(ev2, 'bridge').pop();
  const rescue = first(ev2, 'song', (e) => e.id === 'rescue');
  t.eq(rescue.f - lastTile.f, 16, 'the rescue starts 16 frames after the last bridge tile');
  // a live boss still falls (bossfall), with the film's timing
  const W3 = G.startAt('en-boss', { form: 'big' });
  W3.p.star = 100000;
  const ev3 = until(G, W3, RIGHT, sawType('song', (e) => e.id === 'rescue'), 900, t, 'the rescue');
  const lt3 = types(ev3, 'bridge').pop();
  t.ok(first(ev3, 'bossfall') && first(ev3, 'song', (e) => e.id === 'rescue').f - lt3.f === 68, 'a live boss falls; the rescue 68 frames after the last tile (as the film)');
};

// clone parity on live worlds: clone at a frame, step both 240 frames with the same buttons, identical
// stateHash; the clone shares nothing (stepping it leaves the original alone)
TESTS.CLONE = (G, t) => {
  const runs = [
    ['en-a', (W, i) => (i % 50 < 40 ? RIGHT : RIGHT | A)],
    ['en-blocks', (W) => (W.p.ground && !(W.prev & A) ? A | RIGHT : RIGHT)],
    ['en-r1', (W, i) => (W.lv.def.id === 'en-r1' && i < 30 ? DOWN : RIGHT)],
    ['en-e2', () => RIGHT],
  ];
  for (const [id, input] of runs) {
    const W = G.startAt(id, { form: 'big' });
    if (id === 'en-r1') place(W, 164, 116);
    let i = 0;
    for (let k = 0; k < 4; k++) {
      const c = G.clone(W);
      const h0 = G.stateHash(W);
      t.eq(G.stateHash(c), h0, `${id} @${W.f}: a fresh clone hashes the same`);
      const inputs = [];
      for (let j = 0; j < 240; j++) inputs.push(input(W, i + j));
      G.run(c, inputs, 240);
      t.eq(G.stateHash(W), h0, `${id} @${W.f}: stepping the clone leaves the original`);
      G.run(W, inputs, 240);
      i += 240;
      t.eq(G.stateHash(W), G.stateHash(c), `${id} @${W.f}: original and clone agree after 240 frames`);
    }
  }
};

// the same console and the same buttons give the same snapshot stream (the 2.2 serialisation)
TESTS.DET = (G, t) => {
  const tape = [];
  for (let i = 0; i < 3000; i++) tape.push(i === 0 ? START : i % 97 < 70 ? RIGHT | B : i % 97 < 80 ? RIGHT | A : LEFT);
  const play = () => {
    const g = G.FILM.game.create({ start: 'en-a', feel: 'modern', lives: 5 });
    const snaps = [];
    const events = [];
    for (const b of tape) {
      for (const e of g.step(b)) events.push(e);
      snaps.push(g.snapshot());
    }
    return { snap: G.snapHash(snaps), fp: G.fingerprint(events, g.state().score) };
  };
  const a = play(), b = play();
  t.ok(a.snap === b.snap && a.fp === b.fp, `two runs agree (${a.snap} ${a.fp} / ${b.snap} ${b.fp})`);
};

// no Math.random, Date, performance.now or crypto in an owned src file; no forbidden media pattern
TESTS.SRC = (G, t) => {
  const C = require('../common.cjs');
  const owned = ['src/game/10-engine.js', 'src/game/20-tape.js', 'src/game/40-api.js'];
  const BANNED = [/Math\s*\.\s*random/, /\bDate\b/, /performance\s*\.\s*now/, /crypto\s*\.\s*(getRandomValues|randomUUID)/];
  const strip = (code) => code.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, '')).replace(/(^|[^:'"`\\])\/\/.*$/gm, '$1');
  for (const f of owned) {
    const code = fs.readFileSync(path.join(H.ROOT, f), 'utf8');
    const hits = BANNED.filter((re) => re.test(strip(code))).map(String);
    t.eq(hits.join(' '), '', `${f}: banned calls`);
    const media = C.scanForbidden(code);
    t.eq(media.map((h) => h.pattern + '@' + h.line).join(' '), '', `${f}: forbidden media patterns`);
  }
};

// live play of fixture levels end to end through FILM.game.create: title, lives, play, pause, clear,
// game over, continue, credits, and back to the title
TESTS.E2E = (G, t) => {
  const g = G.FILM.game.create({ start: 'en-e1', lives: 1, shellMenu: true });
  const W = g.state();
  const modes = [];
  const ev = [];
  let last = null;
  const tick = (b) => {
    for (const e of g.step(b)) ev.push(e);
    if (g.mode !== last) modes.push((last = g.mode));
    g.snapshot();
  };
  modes.push((last = g.mode));
  tick(0);
  tick(START);
  while (g.mode !== 'play') tick(0);
  for (let i = 0; i < 20; i++) tick(RIGHT);
  tick(START);
  for (let i = 0; i < 60; i++) tick(0);
  tick(START);
  let n = 0;
  while (g.mode !== 'clear' && n++ < 2000) tick(W.p.st === 'play' ? toPole(W) : 0);
  while (g.mode !== 'play' && n++ < 4000) tick(0);
  t.eq(W.lv.def.id, 'en-e2', 'the clear leads to next');
  while (g.mode !== 'continue' && n++ < 6000) tick(W.p.st === 'play' ? LEFT : 0);
  tick(A);
  while (g.mode !== 'play' && n++ < 8000) tick(0);
  while (g.mode !== 'credits' && n++ < 12000) {
    const push = W.ending && G.snapshot(W).end && G.snapshot(W).end.push >= 0 && W.ending.t > W.ending.times.push + 62;
    tick(W.p.st === 'play' ? RIGHT : push && !(W.prev & START) ? START : 0);
  }
  for (let i = 0; i < 1330; i++) tick(0);
  tick(START);
  const seq = modes.join(' > ');
  t.eq(seq, 'title > title2 > lives > play > pause > play > clear > lives > play > gameover > continue > lives > play > credits > title', 'the mode sequence');
  const want = ['start', 'levelstart', 'pause', 'unpause', 'flagpole', 'clear', 'die', 'lifelost', 'gameover', 'continue', 'axe', 'complete', 'credits'];
  const got = ev.map((e) => e.type);
  t.eq(want.filter((w) => got.indexOf(w) < 0).join(','), '', 'every event of the run was emitted');
  t.ok(first(ev, 'die', (e) => e.cause === 'lava'), 'the lava death');
};

// ------------------------------------------------------------------------------------------------
function runConfig(cfg) {
  const G = H.load({ defs: DEFS, bare: cfg === 'bare' });
  const names = Object.keys(TESTS).filter((n) => !ONLY || ONLY.has(n));
  let fails = 0;
  const loaded = G.files.map((f) => path.basename(f)).filter((f) => /^1[1-9]-/.test(f));
  console.log(`--- ${cfg}: ${cfg === 'bare' ? 'no 1x modules' : '1x modules: ' + (loaded.join(' ') || 'none present')}`);
  for (const name of names) {
    const t = mk(name);
    const t0 = process.hrtime.bigint();
    let result;
    try {
      result = TESTS[name](G, t);
    } catch (e) {
      if (!(e instanceof Fail)) t.fails.push('threw: ' + (e && e.stack ? e.stack.split('\n').slice(0, 4).join(' | ') : e));
    }
    const ms = Number((process.hrtime.bigint() - t0) / 1000000n);
    const tag = t.fails.length ? 'FAIL' : result === 'skip' ? 'SKIP' : 'PASS';
    if (t.fails.length) fails++;
    console.log(`[${tag}] ${name} (${ms} ms)${t.notes.length ? ' ' + t.notes.join('; ') : ''}`);
    for (const f of t.fails.slice(0, 20)) console.log(`       ${f}`);
  }
  return fails;
}

let total = 0;
for (const cfg of CONFIGS) total += runConfig(cfg);
console.log(`${total ? 'FAIL' : 'PASS'} engine-scenarios.cjs: ${total} failing check group(s)`);
process.exit(total ? 1 : 0);
