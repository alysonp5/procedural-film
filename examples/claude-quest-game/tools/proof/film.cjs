#!/usr/bin/env node
// tools/proof/film.cjs : T1 film integrity (docs/game-spec.md 2.2 and 13.1). Owner: P1.
//
//   node tools/proof/film.cjs          every check; exits 1 on any failure
//   node tools/proof/film.cjs --fast   skip record() (the tape program's replan, the slow check)
//
// The film is the engine with W.live false. After any change to src/game/*.js these must hold:
//   fingerprint(sim()) === 'cb881de9' with source 'recorded'; sim().length === 3627;
//   FILM_SNAP (the 2.2 snapshot-stream hash) === '8c597014';
//   record() (the tape program replayed by the bot) gives fp 'cb881de9' and rle === CQ.RECORDED.rle.
// Plus the attract demo (U5): FILM.game.demo() is done at film frame 2001 (flagpole 1821 + 180).
// A red here is a film regression to fix in the engine, never a reason to re-record the tape.
'use strict';

const H = require('./harness.cjs');

const WANT = { fp: 'cb881de9', length: 3627, snap: '8c597014', flag: 1821, demoDone: 2001 };
const fast = process.argv.includes('--fast');
let fails = 0;
function check(name, ok, got) {
  console.log(`[${ok ? 'PASS' : 'FAIL'}] ${name}${got !== undefined ? ': ' + got : ''}`);
  if (!ok) fails++;
}

const t0 = process.hrtime.bigint();
const ms = () => Number((process.hrtime.bigint() - t0) / 1000000n);
const G = H.load();
const S = G.game.sim();
const fp = G.fingerprint(S);
check('sim fingerprint', fp === WANT.fp && S.source === 'recorded', `${fp} (source ${S.source})`);
check('sim length', S.length === WANT.length, S.length);
const snap = G.snapHash(S.states);
check('FILM_SNAP', snap === WANT.snap, snap);
const flag = S.events.find((e) => e.type === 'flagpole');
check('first flagpole event', !!flag && flag.f === WANT.flag, flag ? flag.f : 'none');
// the film never emits a live-only event (section 7)
const LIVE = new Set(['levelstart', 'pause', 'unpause', 'hurt', 'die', 'lifelost', 'gameover', 'cursor', 'continue', 'quit',
  'checkpoint', 'token', 'clear', 'hurry', 'complete', 'credits', 'throw', 'zap', 'poof', 'bosshit', 'bossdefeat', 'spit',
  'ember', 'spring', 'crumble']);
const liveEv = S.events.filter((e) => LIVE.has(e.type));
check('no live-only events in the film', liveEv.length === 0, liveEv.length ? liveEv.slice(0, 3).map((e) => e.f + ':' + e.type).join(' ') : 'none');

if (typeof G.game.demo === 'function') {
  const d = G.game.demo();
  const startFrame = d.frame;
  let steps = 0;
  while (!d.done && steps < 4000) {
    d.step();
    steps++;
  }
  check('demo starts on the first play frame', startFrame === 310, startFrame);
  check('demo done at film frame 2001', d.done && d.frame === WANT.demoDone, `done ${d.done} at frame ${d.frame} after ${steps} steps`);
} else check('FILM.game.demo exists', false, 'missing');

if (!fast) {
  const r = G.game.record();
  check('record() fingerprint', r.fp === WANT.fp, r.fp);
  check('record() rle === CQ.RECORDED.rle', r.rle === G.CQ.RECORDED.rle, r.rle === G.CQ.RECORDED.rle ? 'identical' : `differs (${r.rle.length} vs ${G.CQ.RECORDED.rle.length} chars)`);
}
console.log(`${fails ? 'FAIL' : 'PASS'} film.cjs: ${fails} failure(s) in ${(ms() / 1000).toFixed(1)}s`);
process.exit(fails ? 1 : 0);
