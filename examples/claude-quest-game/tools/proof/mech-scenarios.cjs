#!/usr/bin/env node
// tools/proof/mech-scenarios.cjs : T3 mechanics scenario proofs MC1 to MC10 (docs/game-spec.md 13.3),
// plus the package P2 gates: no hook runs for a film world, every sprite name exists in the manifest, and
// the owned sources are free of banned calls and media patterns. Owner: P2.
//
//   node tools/proof/mech-scenarios.cjs              every check
//   node tools/proof/mech-scenarios.cjs --only MC3   named checks only (comma separated)
//
// Fixture levels: tools/proof/fixtures/mech-defs.cjs, loaded through P1's harness (tools/proof/harness.cjs).
// The oracles below are written from the spec's numbers, never read back from the modules. Exits 1 on any failure.
'use strict';

const fs = require('fs');
const path = require('path');
const H = require('./harness.cjs');
const { DEFS, LIFT_H, LIFT_V2 } = require('./fixtures/mech-defs.cjs');

const argv = process.argv.slice(2);
const onlyArg = argv.indexOf('--only') >= 0 ? argv[argv.indexOf('--only') + 1] : null;
const ONLY = onlyArg ? new Set(onlyArg.split(',')) : null;

const BT = { A: 1, B: 2, SELECT: 4, START: 8, UP: 16, DOWN: 32, LEFT: 64, RIGHT: 128 };
const { A, B, LEFT, RIGHT } = BT;
const Q = (v) => v / 4096;
const rowTop = (r) => r * 16 - 12;
// docs/game-spec.md 6.1, the literal table (checked against the formula in MC5)
const SIN64 = [0, 2, 3, 5, 6, 8, 9, 10, 11, 12, 13, 14, 15, 15, 16, 16, 16, 16, 16, 15, 15, 14, 13, 12, 11, 10, 9, 8, 6, 5, 3, 2,
  0, -2, -3, -5, -6, -8, -9, -10, -11, -12, -13, -14, -15, -15, -16, -16, -16, -16, -16, -15, -15, -14, -13, -12, -11, -10, -9, -8, -6, -5, -3, -2];
// docs/game-spec.md 6.3: u for lift kinds h and v
function specU(t, speed, phase, D) {
  const m = 2 * D;
  const o = (((Math.floor(t * speed) + phase) % m) + m) % m;
  return o < D ? o : 2 * D - o;
}

// ------------------------------------------------------------------------------------------------
// a tiny test runner (the shape of engine-scenarios.cjs)
// ------------------------------------------------------------------------------------------------
class Fail extends Error {}
function mk(name) {
  const t = { name, fails: [], notes: [], checks: 0 };
  t.ok = (cond, msg) => {
    t.checks++;
    if (!cond) t.fails.push(msg);
    return !!cond;
  };
  t.eq = (a, b, msg) => t.ok(a === b, `${msg}: got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`);
  t.must = (cond, msg) => {
    t.checks++;
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

function until(G, W, input, pred, cap, t, what) {
  const inp = typeof input === 'function' ? input : () => input;
  const events = [];
  for (let i = 0; i < cap; i++) {
    const ev = G.step(W, inp(W, i));
    for (const e of ev) events.push(e);
    if (pred(W, ev, events)) return events;
  }
  if (t) t.must(false, `${what || 'condition'} not reached in ${cap} frames (mode ${W.mode}, st ${W.p && W.p.st}, x ${W.p && W.p.x}, y ${W.p && W.p.y})`);
  return events;
}
// walk (in taps, so no run-up overshoots) until he stands still within 3 px of x
function standAt(G, W, x, t) {
  const go = (w) => (Math.abs(w.p.vx) >= 0.75 || Math.abs(w.p.x - x) <= 3 ? 0 : w.p.x < x ? RIGHT : LEFT);
  until(G, W, go, (w) => Math.abs(w.p.x - x) <= 3 && w.p.vx === 0 && w.p.ground, 300, t, `standing at x ${x}`);
}
// a live player standing (or, with air, falling from rest) at x, feet y; the camera brought to him
function place(W, x, y = 148, air = false) {
  const p = W.p;
  p.x = x;
  p.y = y;
  p.vx = 0;
  p.vy = 0;
  p.ground = !air;
  p.jumping = false;
  p.jumped = false;
  p.ride = -1;
  W.cam = Math.max(0, Math.min(W.lv.maxCam, Math.floor(x + 8 - 128)));
}
function recsOf(G, s, re) {
  const out = [];
  for (let k = 0; k < s.spr.length; k += 5) {
    const n = s.spr[k];
    if (n < 1000 && re.test(G.CQ.NAMES[n])) out.push({ name: G.CQ.NAMES[n], x: s.spr[k + 1], y: s.spr[k + 2], flags: s.spr[k + 3], pal: s.spr[k + 4] });
  }
  return out;
}
const enemy = (W, kind) => W.lv.ents.find((e) => e.kind === kind);

const TESTS = {};

// ------------------------------------------------------------------------------------------------
// MC1 lifts: carry follows dx, dy; landing only from above; walking off ends the ride and starts coyote;
// a 112 px h-lift cycle never pushes the rider off
// ------------------------------------------------------------------------------------------------
TESTS.MC1 = (G, t) => {
  // positions are the spec's pure functions of lv.t
  {
    const W = G.startAt('mc-h');
    let bad = 0;
    for (let i = 0; i < 500; i++) {
      G.step(W, 0);
      const L = W.lv.lifts[0];
      if (L.x !== LIFT_H.tx * 16 + specU(W.lv.t, 1, 0, 112) || L.y !== 116) bad++;
    }
    t.eq(bad, 0, 'h-lift x = tx*16 + u(lv.t) on every frame');
    const W2 = G.startAt('mc-v');
    bad = 0;
    for (let i = 0; i < 500; i++) {
      G.step(W2, 0);
      const L = W2.lv.lifts[1];
      if (L.y !== LIFT_V2.y1 - specU(W2.lv.t, 0.5, 48, 48) || L.x !== LIFT_V2.tx * 16) bad++;
    }
    t.eq(bad, 0, 'v-lift top = y1 - u(lv.t) on every frame');
  }
  // land on H1 from above, then ride a full cycle (and more) with no input
  {
    const W = G.startAt('mc-h');
    const L = () => W.lv.lifts[0];
    place(W, L().x + 16, 80, true);
    until(G, W, 0, (w) => w.p.ride === 0, 80, t, 'landing on the h-lift');
    t.eq(W.p.y, L().y, 'feet on the lift top after landing');
    t.ok(W.p.ground, 'grounded on the lift');
    const off0 = W.p.x - L().x;
    let carryBad = 0, offBad = 0, rideLost = -1, minX = Infinity, maxX = -Infinity;
    for (let i = 0; i < 300; i++) {
      const px = W.p.x, py = W.p.y;
      G.step(W, 0);
      const l = L();
      minX = Math.min(minX, l.x);
      maxX = Math.max(maxX, l.x);
      if (W.p.ride !== 0 && rideLost < 0) rideLost = i;
      if (W.p.x - px !== l.dx || W.p.y - py !== l.dy || W.p.y !== l.y) carryBad++;
      if (W.p.x - l.x !== off0) offBad++;
    }
    t.eq(rideLost, -1, 'the rider stays on through 300 frames (more than the 224-frame cycle)');
    t.eq(carryBad, 0, 'each frame the rider moves by exactly the lift\'s dx, dy');
    t.eq(offBad, 0, 'his place on the lift never shifts (the camera never pushes him)');
    t.eq(maxX - minX, 112, 'the lift travels 112 px');
    t.eq(W.p.st, 'play', 'still in play');
  }
  // one-way: a jump from under the static lift passes up through it and lands on it from above
  {
    const W = G.startAt('mc-h');
    const L = () => W.lv.lifts[1];
    place(W, 50 * 16 + 16, 148);
    let throughBad = 0, landed = -1, y0AtLand = null, prevY = W.p.y;
    for (let i = 0; i < 120 && landed < 0; i++) {
      G.step(W, A);
      if (W.p.vy < 0 && (W.p.ride >= 0 || W.p.ground)) throughBad++;
      if (W.p.ride === 1) {
        landed = i;
        y0AtLand = prevY;
      }
      prevY = W.p.y;
    }
    t.eq(throughBad, 0, 'rising through the lift never lands on it');
    t.ok(landed > 0, `landed on the lift from above (frame ${landed})`);
    t.ok(y0AtLand !== null && y0AtLand <= L().y, `his feet were above the top the frame before (${y0AtLand} <= ${L().y})`);
    t.eq(W.p.y, 116, 'standing on the static lift');
    // falling with his feet already below the top: no landing
    const W2 = G.startAt('mc-h');
    place(W2, 50 * 16 + 16, 124, true);
    until(G, W2, 0, (w) => w.p.ground, 60, t, 'falling past the lift to the floor');
    t.eq(W2.p.y, 148, 'feet below the lift top fall through to the floor');
    t.eq(W2.p.ride, -1, 'no ride from below');
  }
  // walking off the end ends the ride and starts coyote time (modern), not in the nes feel
  for (const feel of ['modern', 'nes']) {
    const W = G.startAt('mc-h', { feel });
    place(W, 50 * 16 + 16, 100, true);
    until(G, W, 0, (w) => w.p.ride === 1, 60, t, `${feel}: landing on the static lift`);
    until(G, W, RIGHT, (w) => w.p.ride === -1, 120, t, `${feel}: walking off the lift`);
    t.ok(!W.p.ground, `${feel}: airborne after walking off`);
    t.eq(W.p.coyote, feel === 'modern' ? 5 : 0, `${feel}: coyote frames on walking off`);
    t.ok(W.p.x > 50 * 16 + 48 - 16, `${feel}: he left over the lift's right end`);
  }
  // a jump off a lift ends the ride
  {
    const W = G.startAt('mc-h');
    place(W, W.lv.lifts[0].x + 16, 80, true);
    until(G, W, 0, (w) => w.p.ride === 0, 80, t, 'landing on H1');
    G.step(W, A);
    G.step(W, A);
    t.eq(W.p.ride, -1, 'a jump ends the ride');
  }
  // the v-lifts: carry follows dy for a whole cycle (2 * 48 / 0.5 = 192 frames)
  {
    const W = G.startAt('mc-v');
    const L = () => W.lv.lifts[1];
    place(W, L().x + 16, 40, true);
    until(G, W, 0, (w) => w.p.ride === 1, 120, t, 'landing on V2');
    let bad = 0, lost = -1, minY = Infinity, maxY = -Infinity;
    for (let i = 0; i < 200; i++) {
      const py = W.p.y;
      G.step(W, 0);
      if (W.p.ride !== 1 && lost < 0) lost = i;
      if (W.p.y !== L().y || W.p.y - py !== L().dy) bad++;
      minY = Math.min(minY, L().y);
      maxY = Math.max(maxY, L().y);
    }
    t.eq(lost, -1, 'riding V2 through a whole cycle');
    t.eq(bad, 0, 'feet follow the v-lift top every frame (dy)');
    t.eq(minY + ':' + maxY, '84:132', 'V2 travels 84 to 132');
  }
};

// ------------------------------------------------------------------------------------------------
// MC2 falling lift: crumble, 20 frames of shake, then the fall; gone below y 200
// ------------------------------------------------------------------------------------------------
TESTS.MC2 = (G, t) => {
  const W = G.startAt('mc-fall');
  const L = () => W.lv.lifts[0];
  place(W, 20 * 16 + 16, 100, true);
  let f0 = -1;
  const ev = until(G, W, 0, (w, e) => e.some((x) => x.type === 'crumble'), 60, t, 'crumble on landing');
  f0 = first(ev, 'crumble').f;
  t.eq(W.p.ride, 0, 'the crumble fires on first contact');
  t.eq(types(ev, 'crumble').length, 1, 'one crumble');
  const xs = [], ys = [], all = [];
  let crumbles = 0;
  for (let i = 1; i <= 80; i++) {
    const e = G.step(W, 0);
    crumbles += types(e, 'crumble').length;
    all.push(...e);
    const s = G.snapshot(W);
    const rec = recsOf(G, s, /^lift$/)[0];
    xs.push(rec ? rec.x - 20 * 16 : null);
    ys.push(L().y);
  }
  t.eq(crumbles, 0, 'no second crumble');
  // frames 1..20 after contact: the drawing shakes 1 px either way, the top stays at 132
  const shake = xs.slice(0, 20);
  t.ok(shake.every((d, i) => d === (i % 2 === 0 ? 1 : -1)), `20 frames of shake, x ±1 alternating: ${shake.join(',')}`);
  t.ok(ys.slice(0, 20).every((y) => y === 132), 'the top holds at 132 while it shakes');
  t.eq(xs[20], 0, 'the shake ends when the fall starts');
  // from frame 21: vy += 1/16 per frame, up to 2
  let vy = 0, y = 132, bad = 0;
  for (let i = 20; i < 60; i++) {
    vy = Math.min(2, vy + Q(0x100));
    y += vy;
    if (ys[i] !== y && !(y > 200 && ys[i] > 200)) bad++;
  }
  t.eq(bad, 0, 'the fall: vy grows by Q(0x100) a frame to a cap of 2');
  t.ok(ys[20] > 132, 'falling on frame 21 after contact');
  // the rider fell with it into the pit
  t.ok(first(all, 'die', (e) => e.cause === 'pit'), 'a rider who stays falls to a pit death');
  G.run(W, 0, 100);
  t.eq(L().st, 'gone', 'gone below y 200');
  t.eq(recsOf(G, G.snapshot(W), /^lift$/).filter((r) => r.x === 20 * 16 || r.x === 20 * 16 + 1).length, 0, 'a gone lift draws nothing');
  t.note(`crumble at f ${f0}`);
};

// ------------------------------------------------------------------------------------------------
// MC3 springs: held from a y 148 top peaks with feet at 61.6 (big drawing top 37.6, F8); unheld 16.3 px
// ------------------------------------------------------------------------------------------------
TESTS.MC3 = (G, t) => {
  // held, big Claw'd standing on the spring
  {
    const W = G.startAt('mc-spring', { form: 'big' });
    place(W, 312, 148 - Q(0x700), true); // one frame's fall above the spring, landing on it with A held
    const ev = G.run(W, A, 1);
    const sp = first(ev, 'spring');
    t.ok(sp && sp.held === true, 'spring {held: true} on the landing frame');
    t.eq(W.p.vy, -5, 'held launch vy -5');
    let minY = W.p.y, apexF = 0, n = 0;
    const names = [];
    for (let i = 0; i < 60; i++) {
      names.push(recsOf(G, G.snapshot(W), /^spring\d$/).map((r) => r.name)[0]);
      G.step(W, A);
      n++;
      if (W.p.y < minY) {
        minY = W.p.y;
        apexF = n;
      }
    }
    // the rise: 35 frames of vy = -5 + k * Q(0x240)
    let y = 148, v = -5;
    for (let k = 0; k < 35; k++) {
      v += Q(0x240);
      y += v;
    }
    t.eq(minY, y, 'apex feet (oracle)');
    t.eq(minY, 61.59375, 'apex feet at y 61.6');
    t.eq(minY - 24, 37.59375, 'big drawing top at 37.6 (F8: at least 32)');
    t.ok(minY >= 56, 'F8: feet stay at y 56 or lower');
    t.eq(apexF, 35, 'the rise lasts 35 frames');
    t.eq(names.slice(0, 7).join(','), 'spring2,spring2,spring2,spring3,spring3,spring3,spring1', 'spring2 3 frames, spring3 3 frames, then spring1');
  }
  // not held, small
  {
    const W = G.startAt('mc-spring');
    place(W, 316, 148); // standing on it: launched on the first grounded frame
    const ev = G.run(W, 0, 1);
    const sp = first(ev, 'spring');
    t.ok(sp && sp.held === false, 'spring {held: false}');
    let minY = W.p.y;
    for (let i = 0; i < 40; i++) {
      G.step(W, 0);
      minY = Math.min(minY, W.p.y);
    }
    t.eq(148 - minY, 16.3125, 'unheld rise 16.3 px');
  }
  // coyote and buffer clear; the horizontal speed is kept
  {
    const W = G.startAt('mc-spring');
    place(W, 306, 148);
    W.p.vx = 1.25;
    W.p.buf = 3;
    const ev = G.run(W, RIGHT, 3);
    const sp = first(ev, 'spring');
    t.ok(!!sp, 'walking onto the spring launches');
    t.eq(W.p.buf, 0, 'the jump buffer clears');
    t.ok(W.p.vx >= 1.25, 'horizontal speed kept');
  }
};

// ------------------------------------------------------------------------------------------------
// MC4 embers: leap frames follow (lv.t + phase) % period; contact hurts with cause fire
// ------------------------------------------------------------------------------------------------
TESTS.MC4 = (G, t) => {
  {
    const W = G.startAt('mc-ember');
    place(W, 40, 148);
    const leaps = [];
    let minY = Infinity, back = -1, leapT = -1, flipBad = 0, behindBad = 0, tellBad = 0, peekBad = 0;
    const tells = [];
    for (let i = 0; i < 400; i++) {
      const ev = G.step(W, 0);
      const e = W.lv.embers[0];
      if (first(ev, 'ember')) {
        leaps.push(W.lv.t);
        leapT = W.lv.t;
      }
      if (leapT >= 0 && e.up) minY = Math.min(minY, e.y);
      if (leapT >= 0 && !e.up && back < 0) back = W.lv.t - leapT;
      const snap = G.snapshot(W);
      const r = recsOf(G, snap, /^ember\d$/)[0];
      if (e.up && r) {
        if (!!(r.flags & 2) !== e.vy > 0) flipBad++;
        if (!!(r.flags & 4) !== e.y > 152) behindBad++;
      }
      // the tell: the glow at its column on exactly the 36 frames before each leap (leaps at 90, 210, 330),
      // the head peeking (an ember drawing behind the tiles, over its rest line) on the last 12 of them
      const due = 120 - ((((W.lv.t + 30) % 120) + 120) % 120);
      const want = !e.up && due <= 36;
      const glow = recsOf(G, snap, /^t_lavaGlow\d$/);
      if (want !== (glow.length === 1 && glow[0].x === 13 * 16 && glow[0].y === rowTop(10))) tellBad++;
      if (want && due === 36) tells.push(W.lv.t);
      const peek = !e.up && r;
      if (!!peek !== (want && due <= 12) || (peek && !(r.flags & 4 && r.y + 16 < 164))) peekBad++;
    }
    t.eq(leaps.join(','), '90,210,330', 'leaps at every lv.t with (lv.t + 30) % 120 === 0');
    t.eq(tells.join(','), '54,174,294', 'the tell starts 36 frames before every leap');
    t.eq(tellBad, 0, 'the lava at its column glows on exactly those 36 frames, and never otherwise');
    t.eq(peekBad, 0, 'its head peeks (behind the surface, over its rest line) on the last 12 of them only');
    t.eq(minY, 164 - 64.1875, 'rise 64.2 px from the rest line 164');
    t.ok(back >= 52 && back <= 56, `back behind the lava in about 54 frames (${back})`);
    t.eq(flipBad, 0, 'flipped vertically while falling');
    t.eq(behindBad, 0, 'behind the tiles while its feet are below 152');
  }
  // an ember's own vy (the 1-4 first pit's -4): the same integration, a lower apex (oracle from 6.5's rule)
  {
    const W = G.startAt('mc-ember-low');
    let y = 164, vy = -4, top = 164;
    do {
      vy += Q(0x300);
      y += vy;
      top = Math.min(top, y);
    } while (vy <= 0);
    let minY = Infinity;
    for (let i = 0; i < 200; i++) {
      G.step(W, 0);
      if (W.lv.embers[0].up) minY = Math.min(minY, W.lv.embers[0].y);
    }
    t.eq(minY, top, `vy -4: apex feet y ${top} (a ${(164 - top).toFixed(1)} px rise)`);
  }
  // standing on the bridge over it: a small Claw'd dies to it (cause fire); big shrinks (hurt fire)
  for (const form of ['small', 'big']) {
    const W = G.startAt('mc-ember', { form });
    place(W, 13 * 16 - 4, 132);
    const ev = until(G, W, 0, (w, e) => e.some((x) => x.type === 'die' || x.type === 'hurt'), 200, t, `${form}: ember contact`);
    const hit = first(ev, form === 'small' ? 'die' : 'hurt');
    t.ok(hit && hit.cause === 'fire', `${form}: ${form === 'small' ? 'die' : 'hurt'} {cause: fire}`);
    t.ok(W.lv.t > 90 && W.lv.t < 90 + 54, `${form}: hit during the first leap (lv.t ${W.lv.t})`);
  }
  // star and invincibility frames: no hurt
  for (const k of ['star', 'inv']) {
    const W = G.startAt('mc-ember');
    place(W, 13 * 16 - 4, 132);
    W.p[k] = 400;
    const ev = G.run(W, 0, 200);
    t.eq(types(ev, 'die').length + types(ev, 'hurt').length, 0, `${k}: an ember never hurts`);
  }
  // off screen: the leap still happens, silently
  {
    const W = G.startAt('mc-ember');
    place(W, 40, 148);
    W.cam = 240;
    W.p.x = 300;
    const ev = G.run(W, 0, 100);
    t.eq(types(ev, 'ember').length, 0, 'no ember event while it is off screen');
    t.ok(W.lv.embers[0].up, 'it leaps anyway');
  }
};

// ------------------------------------------------------------------------------------------------
// MC5 moths: moth y follows SIN64; a stomp kills with the combo; the hover moth is a function of lv.t
// ------------------------------------------------------------------------------------------------
TESTS.MC5 = (G, t) => {
  let tbl = 0;
  for (let i = 0; i < 64; i++) if (SIN64[i] !== Math.round(16 * Math.sin((2 * Math.PI * i) / 64))) tbl++;
  t.eq(tbl, 0, 'the SIN64 literal equals round(16 sin(2 pi i / 64))');
  t.eq(JSON.stringify(G.CQ.SIN64), JSON.stringify(SIN64), 'the module\'s table is the spec\'s');
  {
    const W = G.startAt('mc-foes');
    place(W, 300, 148);
    const m = enemy(W, 'moth');
    t.eq(m.y0, rowTop(8) + 16, 'y0 is the spawn cell\'s feet line');
    let bad = 0, n = 0, px = m.x;
    for (let i = 0; i < 200; i++) {
      G.step(W, 0);
      if (m.st !== 'walk') break;
      n++;
      if (m.y !== m.y0 + SIN64[m.t & 63] || m.x - px !== -0.75) bad++;
      px = m.x;
    }
    t.ok(n >= 64, `the moth flew a whole bob (${n} frames)`);
    t.eq(bad, 0, 'y = y0 + SIN64[t & 63], x falls by 0.75 a frame');
  }
  // stomps: combo 1 scores 100, combo 2 scores 200; the moth falls straight down (vy 0)
  for (const combo of [0, 1]) {
    const W = G.startAt('mc-foes');
    place(W, 300, 148);
    const m = enemy(W, 'moth');
    G.run(W, 0, 14); // near the bottom of its bob (SIN64[15..16] = 16)
    t.must(m.st === 'walk', 'the moth is flying');
    place(W, m.x - 0.75, m.y - 13, true);
    W.p.vy = 2;
    W.p.combo = combo;
    const s0 = W.score, b0 = W.stats.bugs;
    const ev = G.run(W, 0, 1);
    const st = first(ev, 'stomp');
    t.ok(st && st.combo === combo + 1, `stomp {combo: ${combo + 1}}`);
    t.eq(m.st, 'dead', 'the stomped moth is dead');
    t.eq(m.vy, 0, 'the dead fall starts at vy 0');
    t.eq(W.score - s0, combo === 0 ? 100 : 200, 'the stomp combo scores');
    t.eq(W.stats.bugs - b0, 1, 'a bug counted');
    t.eq(W.p.vy, -4, 'he bounces off it');
    t.eq(types(ev, 'die').length + types(ev, 'hurt').length, 0, 'no hurt');
    const r = recsOf(G, G.snapshot(W), /^moth\d$/).find((q) => q.x === Math.floor(m.x));
    t.ok(r && r.flags & 2, 'drawn upside down while it falls');
  }
  // side contact hurts (cause enemy)
  {
    const W = G.startAt('mc-foes');
    place(W, 300, 148);
    const m = enemy(W, 'moth');
    G.run(W, 0, 16); // SIN64[16] = 16: the moth at its lowest, level with him
    place(W, m.x - 12, 148);
    const ev = until(G, W, 0, (w, e) => e.some((x) => x.type === 'die'), 30, t, 'moth side contact');
    t.eq(first(ev, 'die').cause, 'enemy', 'moth contact: die {cause: enemy}');
  }
  // hover moth: two worlds with different inputs and activation frames agree at every lv.t
  {
    const W1 = G.startAt('mc-foes'), W2 = G.startAt('mc-foes');
    place(W1, 440, 148);
    place(W2, 40, 148);
    for (const W of [W1, W2]) enemy(W, 'moth').st = 'gone'; // the moth would reach him first
    const h1 = enemy(W1, 'hover'), h2 = enemy(W2, 'hover');
    t.eq(h1.y0, rowTop(6) + 16, 'hover y0');
    let bad = 0, cmp = 0, flipBad = 0;
    for (let i = 0; i < 300; i++) {
      if (i === 70) place(W2, 460, 148);
      G.step(W1, i & 16 ? RIGHT : LEFT);
      G.step(W2, 0);
      if (h1.st === 'walk' && h1.y !== h1.y0 + 2 * SIN64[(W1.lv.t >> 1) & 63]) bad++;
      if (h1.st === 'walk' && h1.x !== 640) bad++;
      if (h1.st === 'walk' && h2.st === 'walk' && W1.lv.t === W2.lv.t) {
        cmp++;
        if (h1.y !== h2.y) bad++;
      }
      const r = recsOf(G, G.snapshot(W1), /^moth\d$/).find((q) => q.x === 640);
      if (r && !!(r.flags & 1) !== W1.p.x + 8 > 640 + 8) flipBad++;
    }
    t.eq(bad, 0, 'hover y = y0 + 2 SIN64[(lv.t >> 1) & 63], x fixed, the same in both worlds');
    t.ok(cmp > 150, `compared on ${cmp} frames`);
    t.eq(flipBad, 0, 'it faces the player');
  }
  // palettes: U slots in an under level
  {
    const Wo = G.startAt('mc-foes'), Wu = G.startAt('mc-foes-u');
    for (const W of [Wo, Wu]) {
      place(W, 620, 148);
      enemy(W, 'moth').x = 700;
      G.run(W, 0, 2);
    }
    const pals = (W) => recsOf(G, G.snapshot(W), /^(moth|spike_walk)\d$/).map((r) => r.name.replace(/\d$/, '') + ':' + r.pal).sort().join(' ');
    t.eq(pals(Wo), 'moth:0 moth:0 spike_walk:0', 'over: own palettes');
    t.eq(pals(Wu), 'moth:10 moth:10 spike_walk:11', 'under: mothU (10) and spikeU (11)');
  }
};

// ------------------------------------------------------------------------------------------------
// MC6 spike beetle: never leaves a 3-wide island; a stomp on it hurts (cause spike)
// ------------------------------------------------------------------------------------------------
TESTS.MC6 = (G, t) => {
  {
    const W = G.startAt('mc-foes');
    place(W, 620, 148);
    const s = enemy(W, 'spike');
    let out = 0, minX = Infinity, maxX = -Infinity, n = 0;
    for (let i = 0; i < 1500; i++) {
      G.step(W, 0);
      if (s.st !== 'walk') break;
      n++;
      if (s.x + 2 < 800 || s.x + 14 > 848 || s.y !== 148) out++;
      minX = Math.min(minX, s.x);
      maxX = Math.max(maxX, s.x);
    }
    t.eq(n, 1500, 'walking for 1500 frames');
    t.eq(out, 0, 'its hitbox (x+2..x+14) never leaves the island (x 800..848) and it never falls');
    t.ok(minX <= 800 && maxX >= 832, `it walks the whole island (x ${minX} to ${maxX})`);
  }
  // stomped from above: small dies, big shrinks, both with cause spike; no stomp; the beetle lives
  for (const form of ['small', 'big']) {
    const W = G.startAt('mc-foes', { form });
    place(W, 620, 148);
    const s = enemy(W, 'spike');
    G.run(W, 0, 4);
    place(W, s.x, 148 - 13, true);
    W.p.vy = 2;
    const ev = G.run(W, 0, 1);
    t.eq(types(ev, 'stomp').length, 0, `${form}: no stomp`);
    const hit = first(ev, form === 'small' ? 'die' : 'hurt');
    t.ok(hit && hit.cause === 'spike', `${form}: ${form === 'small' ? 'die' : 'hurt'} {cause: spike}`);
    t.eq(s.st, 'walk', `${form}: the beetle is unharmed`);
  }
  // a star kills it
  {
    const W = G.startAt('mc-foes');
    place(W, 620, 148);
    const s = enemy(W, 'spike');
    G.run(W, 0, 4);
    place(W, s.x, 148 - 13, true);
    W.p.vy = 2;
    W.p.star = 100;
    G.run(W, 0, 1);
    t.eq(s.st, 'dead', 'star contact kills the beetle');
  }
  // a block bumped under it knocks it out (it is a walker, not a flier)
  {
    const W = G.startAt('mc-bump');
    const s = enemy(W, 'spike');
    place(W, 240, 148); // his centre under the middle brick (col 15)
    G.run(W, 0, 2);
    t.must(s.st === 'walk' && s.x + 14 > 240 && s.x + 2 < 256, `the beetle stands on the middle brick (x ${s.x})`);
    const ev = until(G, W, A, (w, e) => e.some((x) => x.type === 'kick'), 40, t, 'a bump under the beetle');
    t.eq(s.st, 'dead', 'a bumped block knocks the beetle out');
    t.eq(types(ev, 'hurt').length + types(ev, 'die').length, 0, 'the bump from below never hurts him');
  }
};

// ------------------------------------------------------------------------------------------------
// MC7 carets: at most 2; bounce 13.75 px; a wall poofs; every kind dies to one caret for 200
// ------------------------------------------------------------------------------------------------
TESTS.MC7 = (G, t) => {
  const flying = (W) => (W.carets || []).filter((c) => c.st === 'fly').length;
  // at most two in flight
  {
    const W = G.startAt('mc-caret', { form: 'code' });
    place(W, 120, 148);
    let throws = 0, maxFly = 0;
    for (let i = 0; i < 12; i++) {
      const ev = G.step(W, i & 1 ? 0 : B);
      throws += types(ev, 'throw').length;
      maxFly = Math.max(maxFly, flying(W));
    }
    t.eq(throws, 2, 'six B presses with two carets in flight: two throws');
    t.eq(maxFly, 2, 'never more than two in flight');
    // the throw pose: 8 frames
    const W2 = G.startAt('mc-caret', { form: 'code' });
    place(W2, 40, 148);
    const poses = [];
    for (let i = 0; i < 12; i++) {
      G.step(W2, i === 0 ? B : 0);
      const s = G.snapshot(W2);
      poses.push(recsOf(G, s, /^clawdB_/)[0].name === 'clawdB_throw' ? 1 : 0);
    }
    t.eq(poses.join(''), '111111110000', 'clawdB_throw for 8 frames');
    // an area entry mid-throw clears the pose and the carets (the pose only counts down in play)
    G.step(W2, B);
    t.must(W2.p.throwT > 0 && W2.carets.length > 0, 'a throw under way');
    for (const s of G.CQ.systems) if (s.enter) s.enter(W2, W2.lv);
    t.eq(W2.p.throwT + ':' + W2.carets.length, '0:0', 'the enter hook clears throwT and the carets');
    // not Code: B only runs
    const W3 = G.startAt('mc-caret', { form: 'big' });
    const ev3 = G.run(W3, (w, i) => (i & 1 ? 0 : B), 10);
    t.eq(types(ev3, 'throw').length, 0, 'big Claw\'d without Code throws nothing');
  }
  // the bounce and the wall poof
  {
    const W = G.startAt('mc-caret', { form: 'code' });
    place(W, 40, 148);
    G.step(W, B);
    const c = W.carets[0];
    t.eq(c.x - c.vx * c.t, 40 + 8 + 10, 'spawn at the centre x + 8 + face * 10 (it moves on its throw frame)');
    t.eq(c.y, 148 - 16 + 1.25, 'spawn y - 16, vy 1, gravity 0.25');
    t.eq(c.vx, 3.5, 'vx 3.5');
    let bounced = false, peak = Infinity, poofEv = null, poofX = null, frames = 0;
    const seen = [];
    for (let i = 0; i < 100 && W.carets.length; i++) {
      const ev = G.step(W, 0);
      frames++;
      if (c.vy === -2.75) bounced = true;
      else if (bounced && c.st === 'fly') peak = Math.min(peak, c.y);
      if (first(ev, 'poof')) {
        poofEv = first(ev, 'poof');
        poofX = c.x;
      }
      const r = recsOf(G, G.snapshot(W), /^(caret|poof)\d$/)[0];
      if (r) seen.push(r.name);
    }
    t.ok(bounced, 'it bounced on the floor');
    t.eq(144 - peak, 13.75, 'the bounce rises 13.75 px');
    t.ok(!!poofEv, 'the wall at col 16 poofs it (poof event)');
    t.eq(poofX + 4, 16 * 16, 'the poof sits against the wall');
    t.eq(W.carets.length, 0, 'the poof is over after its 12 frames');
    t.ok(seen.includes('poof1') && seen.includes('poof2') && seen.includes('poof3'), 'poof1..3 drawn');
    t.ok(['caret1', 'caret2', 'caret3', 'caret4'].every((n) => seen.includes(n)), 'caret1..4 drawn (turning)');
  }
  // every kind dies to one caret for 200
  const cases = [['mc-k-g', 'bug', 1], ['mc-k-k', 'shellbug', 1], ['mc-k-k', 'shell', 0], ['mc-k-m', 'moth', 1], ['mc-k-n', 'hover', 1], ['mc-k-s', 'spike', 1]];
  for (const [id, kind, bug] of cases) {
    const W = G.startAt(id, { form: 'code' });
    W.p.inv = 1000; // the carets' proof, not the enemies'
    G.run(W, 0, 2);
    const e = W.lv.ents[0];
    if (kind === 'shell') Object.assign(e, { kind: 'shell', st: 'shell', vx: 0 });
    const s0 = W.score, b0 = W.stats.bugs;
    const ev = until(G, W, (w, i) => (i === 0 ? B : 0), (w, e2) => e2.some((x) => x.type === 'zap'), 120, t, `${kind}: one caret hit`);
    const z = first(ev, 'zap');
    t.eq(z.kind, kind, `${kind}: zap {kind}`);
    t.eq(e.st, 'dead', `${kind}: dead`);
    t.eq(e.vy, -3, `${kind}: knocked up (vy -3)`);
    t.eq(W.score - s0, 200, `${kind}: 200 points`);
    t.eq(W.stats.bugs - b0, bug, `${kind}: ${bug ? 'a bug counted' : 'a shell is not counted again'}`);
    t.eq(types(ev, 'throw').length, 1, `${kind}: one caret`);
    t.eq(W.carets.filter((c) => c.st === 'fly').length, 0, `${kind}: the caret is gone`);
  }
};

// ------------------------------------------------------------------------------------------------
// MC8 the boss: 5 carets give bossdefeat and 5000; enrage at 2 HP; spit on each roar, at most 2; after
// the defeat the ENTER key skips bossfall and the rescue starts 16 frames after the last tile
// ------------------------------------------------------------------------------------------------
TESTS.MC8 = (G, t) => {
  {
    const W = G.startAt('mc-boss', { form: 'code' });
    const b = W.lv.boss;
    t.eq(b.hp, 5, 'the boss has 5 hp');
    W.p.inv = 100000; // the carets' proof: spit and contact are MC8's second part
    const s0 = W.score, bug0 = W.stats.bugs;
    // two carets 4 frames apart: the first hits, the second poofs off the flicker without damage
    const ev1 = G.run(W, (w, i) => (i === 0 || i === 4 ? B : 0), 60);
    t.eq(types(ev1, 'bosshit').map((e) => e.hp).join(','), '4', 'the first caret hits (hp 4)');
    t.eq(types(ev1, 'poof').length, 1, 'the second poofs off the hit flicker');
    t.eq(b.hp, 4, 'no damage while hitT > 0');
    const snapHit = [];
    const hits = [], enr = [];
    let last = -100, n = 0;
    const ev2 = until(G, W, (w, i) => {
      const fly = (w.carets || []).filter((c) => c.st === 'fly').length;
      if (fly === 0 && i - last > 20 && !w.prev) {
        last = i;
        return B;
      }
      return 0;
    }, (w, e) => {
      n++;
      for (const x of e) if (x.type === 'bosshit') {
        hits.push(x.hp);
        enr.push(Math.abs(b.vx) + '/' + b.hopEvery);
        const s = G.snapshot(w);
        const r = recsOf(G, s, /^boss_/)[0];
        snapHit.push(r ? r.pal + ':' + (r.flags & 256) : '-');
      }
      return e.some((x) => x.type === 'bossdefeat');
    }, 3000, t, 'the boss beaten by carets');
    t.eq(hits.join(','), '3,2,1,0', 'bosshit {hp} 3, 2, 1, 0 after the first');
    t.eq(enr.join(' '), '0.5/120 0.75/90 0.75/90 0.75/90', 'enraged from 2 HP: |vx| 0.75, a hop every 90');
    t.ok(snapHit.every((q) => q === '9:256'), `a hit shows pal 9 with FLICKER (${snapHit.join(' ')})`);
    const d = first(ev2, 'bossdefeat');
    t.ok(!!d, 'bossdefeat');
    t.eq(W.score - s0, 5000, 'the boss by carets is worth 5000 (the hits score nothing)');
    t.eq(W.stats.bugs - bug0, 1, 'the boss counts one bug');
    t.ok(b.dead && b.fall && b.flip, 'b.dead, b.fall and b.flip');
    t.ok(first(ev2, 'song', (e) => e.id === 'none' && e.f === d.f), 'the song goes to none');
    let hitT = [];
    for (let i = 0; i < 20; i++) {
      hitT.push(b.hitT);
      G.step(W, 0);
    }
    t.eq(hitT.slice(0, 17).join(','), '16,15,14,13,12,11,10,9,8,7,6,5,4,3,2,1,0', 'hitT: 16 on the hit frame, then down to 0');
    until(G, W, 0, (w) => b.gone, 400, t, 'the beaten boss sinks into the lava');
    t.ok(!recsOf(G, G.snapshot(W), /^boss_/).length, 'the boss is gone from the snapshot');
    // to the ENTER key: no bossfall; the rescue song 16 frames after the last bridge tile
    const ev3 = until(G, W, (w) => (w.p.st === 'play' ? RIGHT : 0), (w, e) => e.some((x) => x.type === 'song' && x.id === 'rescue'), 1200, t, 'the rescue');
    t.eq(types(ev3, 'bossfall').length, 0, 'no bossfall after the defeat');
    const br = types(ev3, 'bridge');
    const rs = first(ev3, 'song', (e) => e.id === 'rescue');
    t.eq(br.length, 12, 'twelve bridge tiles');
    t.eq(rs.f - br[br.length - 1].f, 16, 'the rescue starts 16 frames after the last bridge tile');
  }
  // spit: one on every roar, never more than two in flight, gone on its second contact or in lava
  {
    const W = G.startAt('mc-boss');
    W.p.inv = 100000;
    const b = W.lv.boss;
    let roars = 0, spits = 0, maxFly = 0, bad = 0;
    for (let i = 0; i < 1500; i++) {
      const ev = G.step(W, 0);
      const r = types(ev, 'roar').length, s = types(ev, 'spit').length;
      roars += r;
      spits += s;
      if (r !== s) bad++;
      maxFly = Math.max(maxFly, W.lv.spit.length);
      if (s) {
        const sp = W.lv.spit[W.lv.spit.length - 1];
        const face = b.face > 0 ? 1 : -1;
        const v = Math.abs(sp.vx);
        if (Math.sign(sp.vx) !== face || v < 0.5 || v > 2.5 || v * 16 !== Math.round(v * 16) || sp.t !== 1) bad++;
      }
    }
    t.ok(roars >= 9, `${roars} roars in 1500 frames`);
    t.eq(spits, roars, 'one spit on every roar');
    t.eq(bad, 0, 'spit on the roar frame, toward the player, 0.5 to 2.5 px a frame in 1/16 px');
    t.ok(maxFly >= 1 && maxFly <= 2, `at most 2 in flight (${maxFly})`);
    // two already in flight: the next roar spits nothing
    until(G, W, 0, (w) => (w.lv.boss.t % 150) === 98, 200, t, 'two frames before a roar');
    W.lv.spit = [0, 1].map((k) => ({ x: 200 + k * 20, y: -3000, vx: 0, vy: 0, t: 0, hits: 0, gone: false }));
    const ev = G.run(W, 0, 4);
    t.ok(types(ev, 'roar').length === 1 && types(ev, 'spit').length === 0, 'a roar with two in flight spits nothing');
    t.eq(W.lv.spit.length, 2, 'still two');
    // one spit's life: a bounce on a solid top, then gone on the second contact
    const W2 = G.startAt('mc-boss');
    W2.p.inv = 100000;
    until(G, W2, 0, (w, e) => e.some((x) => x.type === 'spit'), 400, t, 'a spit');
    const sp = W2.lv.spit[0];
    let bounces = 0, life = 0;
    for (let i = 0; i < 300 && W2.lv.spit.includes(sp); i++) {
      const vy0 = sp.vy;
      G.step(W2, 0);
      if (vy0 > 0 && sp.vy === -2) bounces++;
      life++;
    }
    t.eq(bounces, 1, 'one bounce (vy -2 again)');
    t.ok(!W2.lv.spit.includes(sp) && life < 300, `gone after its second contact (${life} frames)`);
  }
  // aimed: a spit's first landing, or its bounce's, falls on the spot where he stood when it was spat
  // (followed on a copy of the world; his centre against the spit's centre where it meets the bridge)
  {
    const miss = [];
    let n = 0;
    for (const x of [66, 88, 108, 150]) {
      const W = G.startAt('mc-boss');
      W.p.inv = 100000;
      standAt(G, W, x, t);
      for (let i = 0; i < 1200; i++) {
        const ev = G.step(W, 0);
        if (!types(ev, 'spit').length) continue;
        const cx = W.p.x + 8;
        const c = G.clone(W);
        const sp = c.lv.spit[c.lv.spit.length - 1];
        const lands = [];
        for (let k = 0; k < 300 && c.lv.spit.includes(sp); k++) {
          const h0 = sp.hits;
          G.step(c, 0);
          if (sp.hits > h0) lands.push(sp.x + 4);
        }
        n++;
        const err = Math.min(...lands.map((l) => Math.abs(l - cx)));
        if (!(err <= 6)) miss.push(`x ${x}: centre ${cx}, landings ${lands.map((l) => l.toFixed(1)).join('/')}`);
      }
    }
    t.ok(n >= 24 && miss.length === 0, `${n} spits, each landing within 6 px of where he stood${miss.length ? ': ' + miss.slice(0, 4).join('; ') : ''}`);
  }
  // lingering off the bridge: after 90 frames the Big Bug walks to the bridge's near end and paces its
  // first 32 px; once he is on the bridge it has its whole stretch again
  {
    const W = G.startAt('mc-boss');
    W.p.inv = 100000;
    const b = W.lv.boss;
    until(G, W, 0, (w) => w.lv.boss.active, 300, t, 'the boss awake');
    const xFar = b.xFar;
    t.eq(xFar, 18 * 16, 'its stretch ends at range[1]');
    until(G, W, 0, (w) => w.lv.boss.linger >= 89, 200, t, '89 frames off the bridge');
    t.eq(b.x1, xFar, 'before 90 frames it keeps its whole stretch');
    G.run(W, 0, 400);
    t.ok(b.x1 === b.x0 + 32 && b.x <= b.x0 + 32, `then it paces the bridge's near end (x ${b.x}, x1 ${b.x1})`);
    let hi = 0;
    G.run(W, 0, 300, { onFrame: (w) => (hi = Math.max(hi, w.lv.boss.x)) });
    t.ok(hi <= b.x0 + 32, `and stays there while he lingers (max x ${hi})`);
    until(G, W, RIGHT, (w) => w.p.x + 8 >= 8 * 16 + 4, 200, t, 'onto the bridge');
    G.run(W, 0, 1);
    t.ok(b.linger === 0 && b.x1 === xFar, `on the bridge: its whole stretch again (x1 ${b.x1})`);
  }
  // parked off the bridge, unprotected: the aimed spit hits him within 5 s wherever he stands
  for (const x of [66, 88, 108]) {
    const W = G.startAt('mc-boss', { form: 'code' });
    standAt(G, W, x, t);
    let k = 0, hit = null;
    for (; k < 300 && !hit; k++) hit = first(G.step(W, 0), 'hurt');
    t.ok(hit && hit.cause === 'fire', `parked at x ${x}: hurt by spit after ${k} frames (${hit ? hit.cause : 'never'})`);
  }
  // spit contact: fire, unless star or inv
  for (const k of ['none', 'star', 'inv']) {
    const W = G.startAt('mc-boss');
    const p = W.p;
    if (k !== 'none') p[k] = 400;
    W.lv.spit = [{ x: p.x + 4, y: p.y - 12, vx: 0, vy: -0.125, t: 0, hits: 0, gone: false }];
    const ev = G.run(W, 0, 1);
    const hit = first(ev, 'die');
    if (k === 'none') t.ok(hit && hit.cause === 'fire', 'spit contact: die {cause: fire}');
    else t.ok(!hit, `${k}: spit never hurts`);
  }
  // carets pass through spit
  {
    const W = G.startAt('mc-boss', { form: 'code' });
    W.p.inv = 100000;
    G.step(W, B);
    const c = W.carets[0];
    W.lv.spit = [{ x: c.x + 2, y: c.y - 4, vx: 0, vy: -0.125, t: 0, hits: 0, gone: false }];
    G.step(W, 0);
    t.ok(c.st === 'fly' && W.lv.spit.length === 1, 'a caret passes through spit');
  }
};

// ------------------------------------------------------------------------------------------------
// MC9 tokens: pickup sets the bit and emits token; a rebuilt level after a death does not respawn it
// ------------------------------------------------------------------------------------------------
TESTS.MC9 = (G, t) => {
  const W = G.startAt('mc-tok');
  const bits = () => W.lv.tokens.map((k) => k.tx + ':' + k.bit).join(' ');
  t.eq(bits(), '3:0 10:1 20:2 30:3 45:4', 't chars numbered by column from tokenBase, then the def.tokens overlay');
  t.eq(String.fromCharCode(W.lv.grid[8 * W.lv.w + 10]), '.', 'a t leaves an empty cell');
  const tk = W.lv.tokens.find((k) => k.tx === 10);
  t.eq(tk.y, rowTop(8), 'the token sits in its cell');
  // the spinning sprite: token1..4 by (vf >> 3) & 3
  let spinBad = 0;
  for (let i = 0; i < 40; i++) {
    G.step(W, 0);
    const s = G.snapshot(W);
    const r = recsOf(G, s, /^token\d$/).find((q) => q.x === 160);
    if (!r || r.name !== 'token' + (1 + ((s.f + 1) >> 3 & 3)) || r.y !== rowTop(8)) spinBad++;
  }
  t.eq(spinBad, 0, 'token1..4 spin on (vf >> 3) & 3');
  place(W, 160, 128, true);
  const s0 = W.score;
  const ev = G.run(W, 0, 1);
  const te = first(ev, 'token');
  t.ok(te && te.id === 'mc-tok' && te.n === 1, 'token {id: mc-tok, n: 1}');
  t.eq(W.tokens['mc-tok'], 2, 'W.tokens[main] |= 1 << bit');
  t.eq(W.score - s0, 1000, '1000 points');
  t.ok(!W.lv.tokens.some((k) => k.bit === 1), 'collected: gone from the level');
  G.run(W, 0, 60);
  t.eq(types(G.run(W, 0, 30), 'token').length, 0, 'collected once');
  // a death: the rebuilt level keeps the others and never respawns bit 1
  G.CQ.K.hurt(W, true, 'time');
  until(G, W, 0, (w) => w.mode === 'play' && w.p.st === 'play' && w.lv.t === 0, 600, t, 'the respawn');
  t.eq(bits(), '3:0 20:2 30:3 45:4', 'after a death the level is rebuilt without the collected token');
  t.eq(W.tokens['mc-tok'], 2, 'the bitmask survives the death');
  // the sub-area: tokenBase 5, the bit goes to its main level
  const W2 = G.startAt('mc-tok-b');
  t.eq(W2.lv.tokens.map((k) => k.tx + ':' + k.bit).join(' '), '8:5', 'a sub-area numbers from its tokenBase');
  place(W2, 128, 148);
  const ev2 = G.run(W2, 0, 1);
  t.ok(first(ev2, 'token', (e) => e.id === 'mc-tok' && e.n === 5), 'token {id: main, n: 5}');
  t.eq(W2.tokens['mc-tok'], 32, 'the bit lands in the main level\'s mask');
  // snapshot fields read the bitmask
  t.eq(G.snapshot(W2).tokenTotal, 1, 'snapshot tokenTotal');
};

// ------------------------------------------------------------------------------------------------
// MC10 clone parity: clone mid-action, step both 240 frames with the same buttons, identical stateHash;
// stepping the original never touches the clone
// ------------------------------------------------------------------------------------------------
TESTS.MC10 = (G, t) => {
  const pat = (i) => [0, RIGHT, RIGHT | B, A, 0, LEFT, B, A | RIGHT, 0, RIGHT][(i >> 3) % 10];
  const setups = {
    'h-lift rider': () => {
      const W = G.startAt('mc-h');
      place(W, W.lv.lifts[0].x + 16, 80, true);
      until(G, W, 0, (w) => w.p.ride === 0, 80, t, 'ride');
      return [W, 0];
    },
    'v-lift rider': () => {
      const W = G.startAt('mc-v');
      place(W, W.lv.lifts[1].x + 16, 40, true);
      until(G, W, 0, (w) => w.p.ride === 1, 120, t, 'ride');
      return [W, 0];
    },
    'falling lift shaking': () => {
      const W = G.startAt('mc-fall');
      place(W, 20 * 16 + 16, 100, true);
      until(G, W, 0, (w) => w.lv.lifts[0].st === 'shake', 60, t, 'shake');
      G.run(W, 0, 5);
      return [W, 0];
    },
    'spring launch': () => {
      const W = G.startAt('mc-spring', { form: 'big' });
      place(W, 312, 148);
      G.run(W, A, 3);
      return [W, A];
    },
    'ember in the air': () => {
      const W = G.startAt('mc-ember');
      place(W, 40, 148);
      G.run(W, 0, 100);
      t.must(W.lv.embers[0].up, 'ember up');
      return [W, 0];
    },
    'moths and a beetle': () => {
      const W = G.startAt('mc-foes');
      place(W, 460, 148);
      G.run(W, 0, 30);
      return [W, 0];
    },
    'carets in flight': () => {
      const W = G.startAt('mc-caret', { form: 'code' });
      place(W, 300, 148);
      G.run(W, (w, i) => (i === 0 || i === 3 ? B : 0), 5);
      t.must(W.carets.length === 2, 'two carets');
      return [W, 0];
    },
    'boss fight with spit and flicker': () => {
      const W = G.startAt('mc-boss', { form: 'code' });
      W.p.inv = 100000;
      until(G, W, (w, i) => (i % 25 === 0 ? B : 0), (w) => w.lv.spit.length > 0 && w.lv.boss.hitT > 0, 1500, t, 'spit and a hit');
      return [W, 0];
    },
    'tokens': () => {
      const W = G.startAt('mc-tok');
      place(W, 120, 148);
      return [W, 0];
    },
  };
  for (const [name, setup] of Object.entries(setups)) {
    const [W] = setup();
    const C = G.clone(W);
    const h0 = G.stateHash(W);
    t.eq(G.stateHash(C), h0, `${name}: the clone hashes like the original`);
    for (const k of ['lifts', 'springs', 'embers', 'tokens', 'spit']) {
      if (W.lv[k]) t.ok(C.lv[k] !== W.lv[k] && W.lv[k].every((o, i) => o !== C.lv[k][i]), `${name}: lv.${k} deep-copied`);
    }
    if (W.carets) t.ok(C.carets !== W.carets && W.carets.every((o, i) => o !== C.carets[i]), `${name}: W.carets deep-copied`);
    const evW = G.run(W, (w, i) => pat(i), 240);
    t.eq(G.stateHash(C), h0, `${name}: stepping the original leaves the clone untouched`);
    const evC = G.run(C, (w, i) => pat(i), 240);
    t.eq(G.stateHash(C), G.stateHash(W), `${name}: identical stateHash after 240 frames`);
    t.eq(JSON.stringify(evC), JSON.stringify(evW), `${name}: identical events`);
    t.note(`${name} ${G.stateHash(W)}`);
  }
};

// ------------------------------------------------------------------------------------------------
// the package gates
// ------------------------------------------------------------------------------------------------
// FILM: no hook runs for a film world (W.live false), and they do run for a live one
TESTS.FILM = () => {
  const t = mk('FILM');
  const G = H.load({ defs: DEFS });
  const calls = {};
  const wrap = (obj, key, label) => {
    const fn = obj[key];
    if (typeof fn !== 'function') return;
    obj[key] = function () {
      calls[label] = (calls[label] || 0) + 1;
      return fn.apply(this, arguments);
    };
  };
  for (const s of G.CQ.systems) {
    for (const k of Object.keys(s)) {
      if (k === 'spawn') for (const ch of Object.keys(s.spawn)) wrap(s.spawn, ch, `${s.name}.spawn.${ch}`);
      else wrap(s, k, `${s.name}.${k}`);
    }
  }
  for (const [kind, K] of Object.entries(G.CQ.KINDS)) for (const k of ['move', 'onStomp', 'sprite']) wrap(K, k, `${kind}.${k}`);
  const S = G.game.sim();
  const d = G.game.demo();
  while (!d.done) d.step();
  const film = Object.entries(calls).map(([k, v]) => k + '=' + v);
  t.eq(film.join(' '), '', 'hooks called during the film and the attract demo');
  t.eq(G.fingerprint(S), 'cb881de9', 'the film fingerprint with P2 loaded');
  t.eq(G.snapHash(S.states), '8c597014', 'FILM_SNAP with P2 loaded');
  // a live world does call them (the instrumentation works)
  const W = G.startAt('mc-foes');
  place(W, 460, 148);
  G.run(W, 0, 20);
  t.ok(Object.keys(calls).length >= 8, `a live world calls the hooks (${Object.keys(calls).sort().join(' ')})`);
  return t;
};

// every sprite name the modules emit exists in the manifest at its spec size
TESTS.SPRITES = (G, t) => {
  const M = G.FILM.SPRITE_MANIFEST || {};
  const want = { moth1: [16, 16], moth2: [16, 16], spike_walk1: [16, 16], spike_walk2: [16, 16], caret1: [8, 8], caret2: [8, 8], caret3: [8, 8], caret4: [8, 8],
    poof1: [8, 8], poof2: [8, 8], poof3: [8, 8], token1: [16, 16], token2: [16, 16], token3: [16, 16], token4: [16, 16], ember1: [16, 16], ember2: [16, 16],
    spring1: [16, 16], spring2: [16, 16], spring3: [16, 16], lift: [16, 8], liftU: [16, 8], liftC: [16, 8], fireball1: [8, 8], fireball4: [8, 8] };
  const size = (n) => {
    const m = M[n];
    return m ? [m.w != null ? m.w : m[0], m.h != null ? m.h : m[1]] : null;
  };
  const bad = Object.entries(want).filter(([n, wh]) => {
    const s = size(n);
    return !s || s[0] !== wh[0] || s[1] !== wh[1];
  });
  t.eq(bad.map(([n]) => n + ':' + JSON.stringify(size(n))).join(' '), '', 'manifest names and sizes');
  // and every name that reaches a live snapshot in these proofs is known to the manifest
  const seen = new Set();
  const scan = (W, frames, inp) => {
    for (let i = 0; i < frames; i++) {
      G.step(W, inp ? inp(W, i) : 0);
      const s = G.snapshot(W);
      for (let k = 0; k < s.spr.length; k += 5) if (s.spr[k] < 1000) seen.add(G.CQ.NAMES[s.spr[k]]);
    }
  };
  for (const id of ['mc-h', 'mc-fall', 'mc-spring', 'mc-ember', 'mc-foes', 'mc-foes-u', 'mc-tok']) {
    const W = G.startAt(id);
    if (id === 'mc-foes' || id === 'mc-foes-u') place(W, 620, 148);
    if (id === 'mc-fall') place(W, 20 * 16 + 16, 100, true);
    if (id === 'mc-spring') place(W, 316, 148);
    scan(W, 200);
  }
  const Wb = G.startAt('mc-boss', { form: 'code' });
  Wb.p.inv = 100000;
  scan(Wb, 600, (w, i) => (i % 25 === 0 ? B : 0));
  const missing = [...seen].filter((n) => !M[n]);
  t.eq(missing.join(' '), '', 'every drawn name exists in FILM.SPRITE_MANIFEST');
  const need = ['lift', 'spring2', 'ember1', 'moth1', 'spike_walk1', 'token1', 'caret1', 'fireball1'];
  t.eq(need.filter((n) => !seen.has(n)).join(' '), '', 'the proofs drew every system');
};

// the owned sources: no banned calls, no forbidden media patterns
TESTS.SRC = (G, t) => {
  const C = require('../common.cjs');
  const owned = ['src/game/12-foes.js', 'src/game/13-platforms.js', 'src/game/14-caret.js', 'src/game/15-tokens.js'];
  // gate 3 bans these even inside strings and comments
  const BANNED = [/Math\s*\.\s*random/, /\bDate\b/, /performance\s*\.\s*now/, /crypto/, /Math\s*\.\s*(sin|cos|tan|atan2?|sqrt|pow|exp|log)\b/];
  for (const f of owned) {
    const code = fs.readFileSync(path.join(H.ROOT, f), 'utf8');
    t.eq(BANNED.filter((re) => re.test(code)).map(String).join(' '), '', `${f}: banned calls (runtime trig included)`);
    t.eq(C.scanForbidden(code).map((h) => h.pattern + '@' + h.line).join(' '), '', `${f}: forbidden media patterns`);
  }
};

// ------------------------------------------------------------------------------------------------
const G = H.load({ defs: DEFS });
const loaded = G.files.map((f) => path.basename(f)).filter((f) => /^1[1-9]-/.test(f));
console.log(`1x modules: ${loaded.join(' ')}`);
let fails = 0;
for (const name of Object.keys(TESTS).filter((n) => !ONLY || ONLY.has(n))) {
  let t = mk(name);
  const t0 = process.hrtime.bigint();
  try {
    const r = TESTS[name](G, t);
    if (r && r.fails) t = Object.assign(r, { name });
  } catch (e) {
    if (!(e instanceof Fail)) t.fails.push('threw: ' + (e && e.stack ? e.stack.split('\n').slice(0, 4).join(' | ') : e));
  }
  const ms = Number((process.hrtime.bigint() - t0) / 1000000n);
  if (t.fails.length) fails++;
  console.log(`[${t.fails.length ? 'FAIL' : 'PASS'}] ${name} (${t.checks} checks, ${ms} ms)${t.notes.length && process.env.VERBOSE ? ' ' + t.notes.join('; ') : ''}`);
  for (const f of t.fails.slice(0, 20)) console.log(`       ${f}`);
}
console.log(`${fails ? 'FAIL' : 'PASS'} mech-scenarios.cjs: ${fails} failing check group(s)`);
process.exit(fails ? 1 : 0);
