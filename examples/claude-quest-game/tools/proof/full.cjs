#!/usr/bin/env node
// tools/proof/full.cjs : one whole game per feel mode, the title to the credits (docs/game-spec.md 13.2). Owner: P3.
//
//   node tools/proof/full.cjs                 replay tapes/full.nes.json and tapes/full.modern.json: the
//                                             fingerprint, the credits reached, no death, all 12 tokens
//   node tools/proof/full.cjs --replan        plan both runs again and save the tapes
//   node tools/proof/full.cjs --feel modern   one feel only
//
// The run is the perfect run (programs/perfect.cjs: every level of World 1, all 12 tokens, Claw'd Code
// from 1-2, the Big Bug beaten with five carets), then the ending: he waits for PUSH START TO SHIP IT,
// presses START, and the tape ends on the frame the credits begin. It starts at the title of
// create({ start: '1-1', feel }) with one START press, as NEW QUEST does, so T8 can feed it to the game
// page (tapes/full.<feel>.json: { opts, rle, frames, fp, meta }).
'use strict';

const fs = require('fs');
const path = require('path');
const H = require('./harness.cjs');
const { plan, replay } = require('./levels.cjs');
const perfect = require('./programs/perfect.cjs');

const TAPE_DIR = path.join(__dirname, 'tapes');

const full = {
  name: 'full',
  what: 'title to credits: the perfect run, the ending, START, the credits',
  opts: { start: '1-1' },
  exit: ['complete', 'credits'],
  cap: (CQ) => perfect.cap(CQ) + 3000,
  build: (k) => {
    const route = perfect.perfectRoute(k);
    route.pop(); // the perfect run's last move waits out the rescue for good
    return route.concat([
      k.wait('the ending text, to its push prompt', (W) => !!(W.ending && W.ending.times && W.ending.t > W.ending.times.push + 61)),
      k.hold(k.START, 2),
      k.wait('the credits', (W) => W.mode === 'credits'),
    ]);
  },
  check: (W, events, CQ) => {
    const done = events.find((e) => e.type === 'complete');
    return [
      [W.mode === 'credits', `in the credits (mode ${W.mode})`],
      [CQ.tokenCount(W) === 12 && !!W.credits && W.credits.perfect, `all 12 tokens, the credits' perfect card (${CQ.tokenCount(W)})`],
      [!!done && done.score === W.score, `the complete event carries the final score (${done && done.score} vs ${W.score})`],
      [(W.retries | 0) === 0, `no retries (${W.retries | 0})`],
    ];
  },
};

function main() {
  const argv = process.argv.slice(2);
  const fi = argv.indexOf('--feel');
  const feels = fi >= 0 ? [argv[fi + 1]] : ['nes', 'modern'];
  const replan = argv.includes('--replan');
  const trace = argv.includes('--trace');
  const G = H.load();
  fs.mkdirSync(TAPE_DIR, { recursive: true });
  let fails = 0;
  const t0 = Date.now();
  for (const feel of feels) {
    const file = path.join(TAPE_DIR, `full.${feel}.json`);
    const tag = `full.${feel}`.padEnd(14);
    if (replan) {
      const r = plan(G, full, feel, { trace });
      if (!r.ok) {
        fails++;
        console.log(`[FAIL] ${tag} ${r.why}`);
        continue;
      }
      const obj = {
        opts: Object.assign({}, full.opts, { feel }), rle: G.encode(r.tape), frames: r.frames, fp: r.fp,
        meta: { program: 'full', what: full.what, score: r.score, tokens: G.CQ.tokenCount(r.W), lives: r.W.lives, planned: 'tools/proof/full.cjs --replan' },
      };
      fs.writeFileSync(file, JSON.stringify(obj, null, 1) + '\n');
      const rr = replay(G, full, obj);
      if (!rr.ok) {
        fails++;
        console.log(`[FAIL] ${tag} planned, but the saved tape does not replay: ${rr.why}`);
        continue;
      }
      console.log(`[PASS] ${tag} planned ${r.frames} frames to the credits, fp ${r.fp}, score ${r.score}, tokens ${G.CQ.tokenCount(r.W)}`);
    } else {
      if (!fs.existsSync(file)) {
        fails++;
        console.log(`[FAIL] ${tag} no tape (${path.relative(H.ROOT, file)}): run with --replan`);
        continue;
      }
      const obj = JSON.parse(fs.readFileSync(file, 'utf8'));
      const r = replay(G, full, obj);
      if (!r.ok) {
        fails++;
        console.log(`[FAIL] ${tag} ${r.why}`);
        continue;
      }
      console.log(`[PASS] ${tag} replayed ${r.frames} frames to the credits, fp ${r.fp}, score ${r.score}, tokens ${G.CQ.tokenCount(r.W)}`);
    }
  }
  console.log(`${fails ? 'FAIL' : 'PASS'} full.cjs: ${feels.length} run(s), ${fails} failure(s) in ${((Date.now() - t0) / 1000).toFixed(1)} s`);
  process.exit(fails ? 1 : 0);
}

module.exports = { full };
if (require.main === module) main();
