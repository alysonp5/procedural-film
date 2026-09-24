// live.cjs : proves FILM.audio.live (the playable mode's real-time sound) works and is the same engine.
//   node tools/audio/live.cjs
//   1 equivalence (Node host)  drive live() with a stand-in AudioContext, pulling 1024-sample blocks the
//                 way a ScriptProcessorNode does, queueing a song at the start and effects between blocks;
//                 then render the same events offline (synth) on the frames live() reports they landed
//                 on. The two must match sample for sample: one driver, one APU.
//   2 real time (Chromium)     a running AudioContext plays live() for 1.5 s while the page feeds a jump
//                 every 20 frames from requestAnimationFrame; the driver frame count must advance at
//                 60 per second and the output must carry sound (an AnalyserNode reads its level).
'use strict';
const fs = require('fs');
const C = require('../common.cjs');
const H = require('./host.cjs');

function equivalence() {
  const FILM = H.load({ foley: false });
  const SR = 48000;
  let node = null;
  const ctx = {
    sampleRate: SR,
    destination: {},
    createScriptProcessor(size) {
      node = { size, connect() {}, disconnect() {}, onaudioprocess: null };
      return node;
    },
  };
  const L = FILM.audio.live(ctx, { song: 'overworld' });
  const blocks = 240; // 240 x 1024 samples = 5.12 s
  const got = new Float32Array(blocks * 1024);
  const landed = [{ f: 0, type: 'song', id: 'overworld' }];
  const plan = { 20: { type: 'jump', big: false }, 45: { type: 'coin' }, 70: { type: 'stomp', combo: 2 }, 110: { type: 'song', id: 'star' }, 150: { type: 'powerup' }, 200: { type: 'kick', combo: 3 } };
  for (let b = 0; b < blocks; b++) {
    if (plan[b]) {
      landed.push(Object.assign({ f: L.frame }, plan[b])); // it sounds on the next driver frame not yet made
      L.event(plan[b]);
    }
    const out = new Float32Array(1024);
    node.onaudioprocess({ outputBuffer: { getChannelData: () => out } });
    got.set(out, b * 1024);
  }
  const ref = FILM.audio.synth(SR, { events: landed, samples: got.length, foley: false });
  let bad = 0;
  let maxd = 0;
  for (let i = 0; i < got.length; i++) {
    const d = Math.abs(got[i] - ref[i]);
    if (d > 0) bad++;
    maxd = Math.max(maxd, d);
  }
  return { n: got.length, bad, maxd, landed: landed.map((e) => `f${e.f} ${e.type}${e.id ? ' ' + e.id : ''}`).join(', ') };
}

async function realtime() {
  const src = C.sources({ player: false, lenient: true });
  const browser = await C.launch(['--autoplay-policy=no-user-gesture-required']);
  try {
    const pg = await C.openPage(browser, src.files.filter((f) => fs.existsSync(f)), { scale: 0.1, prefix: 'audio-live' });
    return await pg.page.evaluate(async () => {
      const ctx = new AudioContext({ sampleRate: 48000 });
      await ctx.resume();
      const an = ctx.createAnalyser();
      an.fftSize = 2048;
      an.connect(ctx.destination);
      const L = FILM.audio.live(ctx, { dest: an, song: 'overworld' });
      const errors = [];
      window.addEventListener('error', (e) => errors.push(e.message));
      const f0 = L.frame;
      const t0 = ctx.currentTime;
      let raf = 0;
      let peakRms = 0;
      const buf = new Float32Array(2048);
      await new Promise((res) => {
        const tick = () => {
          raf++;
          if (raf % 20 === 0) L.events([{ type: 'jump', big: raf % 40 === 0 }]);
          an.getFloatTimeDomainData(buf);
          let e = 0;
          for (const x of buf) e += x * x;
          peakRms = Math.max(peakRms, Math.sqrt(e / buf.length));
          if (ctx.currentTime - t0 < 1.5) requestAnimationFrame(tick);
          else res();
        };
        requestAnimationFrame(tick);
      });
      const out = { seconds: +(ctx.currentTime - t0).toFixed(3), frames: L.frame - f0, peakRmsDb: +(20 * Math.log10(peakRms + 1e-12)).toFixed(1), state: ctx.state, errors };
      L.stop();
      await ctx.close();
      return out;
    });
  } finally {
    await browser.close();
  }
}

(async () => {
  const eq = equivalence();
  const ok1 = eq.bad === 0;
  console.log(`${ok1 ? 'PASS' : 'FAIL'} equivalence: live() vs offline synth on the same frames, ${eq.n} samples, ${eq.bad} differ (max |diff| ${eq.maxd}); events landed on ${eq.landed}`);
  const rt = await realtime();
  const rate = rt.frames / rt.seconds;
  const ok2 = rt.errors.length === 0 && rate > 50 && rate < 70 && rt.peakRmsDb > -40;
  console.log(`${ok2 ? 'PASS' : 'FAIL'} real time: ${rt.seconds} s of a running AudioContext advanced ${rt.frames} driver frames (${rate.toFixed(1)} per second), output level up to ${rt.peakRmsDb} dBFS RMS, context ${rt.state}, ${rt.errors.length} errors${rt.errors.length ? ': ' + rt.errors.join('; ') : ''}`);
  if (!ok1 || !ok2) process.exit(1);
})().catch((e) => {
  console.error(e.stack || e.message);
  process.exit(1);
});
