// contract.cjs : checks the timing contract of docs/v2-architecture.md 8.2 from the driver's own register
// writes (music.js alone, no game needed), and, given an event list, how the real timeline meets it.
//   node tools/audio/contract.cjs [--events events.json]
//   lengths    the flagpole slide lasts exactly `frames`; bossfall 64 frames; the flag fanfare's last
//              sound is inside its 168 frames and fades out rather than stopping loud; the ending lands
//              the tonic by frame 256 and is still sounding at 256; the rescue cadences on the tonic
//              within 288 frames
//   timeline   (with events) the gaps the contract promises: flag -> first tally >= 168, bossfall ->
//              rescue >= 64, rescue -> ending >= 288, ending -> power-off >= 256; and the payoffs are not
//              covered: no effect on pulse 1 during the fanfare, the rescue's cadence or the ending tag
'use strict';
const fs = require('fs');
const H = require('./host.cjs');
const args = process.argv.slice(2);
const ei = args.indexOf('--events');
const FILM = H.load({ foley: false });
const out = [];
const ok = (cond, msg) => out.push(`${cond ? 'PASS' : 'FAIL'} ${msg}`);

// per-frame volume of a pulse channel from the register log
function pulseVols(events, frames, base) {
  const buf = FILM.audio.synth(48000, { events, samples: Math.ceil(((frames + 2) / 60) * 48000), foley: false, log: true });
  const byF = new Map(buf.log);
  const v = new Array(frames).fill(0);
  let cur = 0;
  for (let f = 0; f < frames; f++) {
    for (const [a, val] of pairs(byF.get(f) || [])) if (a === base) cur = val & 15;
    v[f] = cur;
  }
  return v;
}
function* pairs(w) {
  for (let i = 0; i < w.length; i += 2) yield [w[i], w[i + 1]];
}
const lastOn = (v) => v.reduce((m, x, i) => (x > 0 ? i : m), -1);

for (const n of [40, 70, 95]) {
  const v = pulseVols([{ f: 0, type: 'flagpole', height: 5000, frames: n }], n + 20, 0x4000);
  ok(lastOn(v) === n - 1, `flagpole frames ${n}: pulse 1 sounds frames 0..${lastOn(v)} (${lastOn(v) + 1} frames)`);
}
{
  const v = pulseVols([{ f: 0, type: 'bossfall' }], 100, 0x4000);
  ok(lastOn(v) === 63, `bossfall: pulse 1 sounds frames 0..${lastOn(v)} (${lastOn(v) + 1} frames, contract 64)`);
}
{
  const ev = [{ f: 0, type: 'song', id: 'flag' }];
  const v1 = pulseVols(ev, 220, 0x4000);
  const v2 = pulseVols(ev, 220, 0x4004);
  const last = Math.max(lastOn(v1), lastOn(v2));
  ok(last <= 167 && v1[last] <= 2 && v2[Math.max(0, lastOn(v2))] <= 2, `flag fanfare: last sound at frame ${last} (limit 167), pulse volumes there ${v1[lastOn(v1)]} / ${v2[lastOn(v2)]} (a fade, not a cut)`);
}
{
  const v = pulseVols([{ f: 0, type: 'song', id: 'ending' }], 300, 0x4000);
  const info = FILM.audio.info().songs.ending;
  ok(v[192] > 0 && v[255] > 0 && v[299] > 0, `ending tag: the tonic D5 starts at frame 192 (volume ${v[192]}) and still sounds at frames 255 and 299 (volume ${v[255]}, ${v[299]}); song ${info.frames} frames, no loop`);
}
{
  const v = pulseVols([{ f: 0, type: 'song', id: 'rescue' }], 290, 0x4000);
  ok(v[216] > 0, `rescue: the cadence note D5 sounds from frame 216 (volume ${v[216]}), inside the 288-frame minimum`);
}

if (ei >= 0) {
  const events = JSON.parse(fs.readFileSync(args[ei + 1], 'utf8'));
  const first = (pred) => events.find(pred);
  const songF = (id) => (first((e) => e.type === 'song' && e.id === id) || {}).f;
  const tl = FILM.TIMELINE.crt || {};
  const flag = songF('flag');
  const tally = (first((e) => e.type === 'tally') || {}).f;
  const boss = (first((e) => e.type === 'bossfall') || {}).f;
  const rescue = songF('rescue');
  const ending = songF('ending');
  const off = tl.powerOff ? tl.powerOff[0] : null;
  const gap = (a, b, min, what) => (a == null || b == null ? out.push(`SKIP ${what}: not in the events`) : ok(b - a >= min, `${what}: ${b - a} frames (contract >= ${min})`));
  gap(flag, tally, 168, 'flag fanfare -> first tally');
  gap(boss, rescue, 64, 'bossfall -> rescue');
  gap(rescue, ending, 288, 'rescue -> ending');
  gap(ending, off, 256, 'ending -> power-off');
  // payoffs uncovered: effects that take pulse 1 inside them
  const P1 = new Set(['start', 'powerup', 'pipe', 'flagpole', 'bossfall', 'roar']);
  const cover = (a, b, what) => {
    if (a == null) return;
    const hits = events.filter((e) => e.type !== 'song' && P1.has(e.type) && e.f >= a && e.f < b);
    ok(hits.length === 0, `${what} (frames ${a}..${b - 1}): ${hits.length ? hits.map((e) => e.type + '@' + e.f).join(', ') + ' take pulse 1' : 'no effect takes the melody'}`);
  };
  cover(flag, flag + 168, 'flag fanfare');
  cover(rescue, rescue + 288, 'rescue');
  cover(ending, ending + 256, 'ending tag');
}
console.log(out.join('\n'));
if (out.some((l) => l.startsWith('FAIL'))) process.exit(1);
