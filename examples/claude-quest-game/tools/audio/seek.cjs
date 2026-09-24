// seek.cjs : seek-exactness and determinism of FILM.audio.render, in headless Chromium (the film's path).
//   node tools/audio/seek.cjs [--at 30] [--mock]
//   seek         render from 0 and from --at (default 30 s) in one page: the seek render must equal the full
//                render's tail sample for sample (both channels)
//   determinism  a second, fresh page renders the whole film again: identical bytes (FNV hash of the samples)
//   node = page  the Node host (tools/audio/host.cjs) renders the same film: identical bytes, so the audio
//                tools that run in Node measure exactly what the film plays
'use strict';
const fs = require('fs');
const C = require('../common.cjs');
const H = require('./host.cjs');

(async () => {
  const args = C.parseArgs(process.argv.slice(2), ['mock']);
  const AT = args.at != null ? Number(args.at) : 30;
  const SR = 48000;
  const src = C.sources({ player: false, lenient: true });
  const D = src.timeline.duration;
  const files = src.files.filter((f) => fs.existsSync(f));
  const browser = await C.launch();
  const results = [];
  let mock = null;
  try {
    const run = async (label, starts) => {
      const pg = await C.openPage(browser, files, { scale: 0.1, prefix: 'audio-seek' });
      const hasGame = await pg.page.evaluate(() => !!(window.FILM.game && typeof FILM.game.events === 'function'));
      if (args.mock || !hasGame) mock = mock || H.mockEvents();
      const r = await pg.page.evaluate(
        async ([starts, D, sr, ev]) => {
          const fnv = (f) => {
            const u = new Uint8Array(f.buffer, f.byteOffset, f.byteLength);
            let h1 = 0x811c9dc5 | 0;
            let h2 = 0x01000193 | 0;
            for (let i = 0; i < u.length; i++) {
              h1 = Math.imul(h1 ^ u[i], 0x01000193);
              if ((i & 3) === 3) h2 = Math.imul(h2 ^ h1, 0x5bd1e995);
            }
            return (h1 >>> 0).toString(16).padStart(8, '0') + (h2 >>> 0).toString(16).padStart(8, '0');
          };
          const out = {};
          const bufs = [];
          for (const s of starts) {
            const len = Math.round((D - s) * sr);
            const ctx = new OfflineAudioContext(2, len, sr);
            FILM.audio.render(ctx, ev ? { start: s, dest: ctx.destination, events: ev } : { start: s, dest: ctx.destination });
            const b = await ctx.startRendering();
            bufs.push([b.getChannelData(0), b.getChannelData(1)]);
            out['hash' + s] = fnv(b.getChannelData(0));
          }
          if (starts.length === 2) {
            const off = Math.round(starts[1] * sr);
            let maxd = 0;
            let bad = 0;
            let n = 0;
            for (let c = 0; c < 2; c++) {
              const A = bufs[0][c];
              const B = bufs[1][c];
              for (let i = 0; i < B.length; i++) {
                const d = Math.abs(A[off + i] - B[i]);
                n++;
                if (d > 0) bad++;
                if (d > maxd) maxd = d;
              }
            }
            out.seek = { compared: n, mismatched: bad, maxAbsDiff: maxd };
          }
          return out;
        },
        [starts, D, SR, mock]
      );
      await pg.close();
      return r;
    };
    const a = await run('page 1', [0, AT]);
    const b = await run('page 2', [0]);
    const events = mock || (await H.gameEvents());
    const FILM = H.load();
    const nodeHash = H.fnv(FILM.audio.synth(SR, { events }));
    results.push(`events: ${mock ? 'tools/audio/mock-events.js (mock)' : 'FILM.game.events() (the real game)'}`);
    const sk = a.seek;
    results.push(`${sk.mismatched === 0 ? 'PASS' : 'FAIL'} seek: render from ${AT} s vs the full render's tail: ${sk.compared} samples compared (both channels), ${sk.mismatched} differ, max |diff| ${sk.maxAbsDiff}`);
    results.push(`${a.hash0 === b.hash0 ? 'PASS' : 'FAIL'} determinism: page 1 ${a.hash0}, fresh page 2 ${b.hash0}`);
    results.push(`${nodeHash === a.hash0 ? 'PASS' : 'FAIL'} node = page: Node host ${nodeHash}, Chromium ${a.hash0}`);
  } finally {
    await browser.close();
  }
  console.log(results.join('\n'));
  if (results.some((r) => r.startsWith('FAIL'))) process.exit(1);
})().catch((e) => {
  console.error(e.stack || e.message);
  process.exit(1);
});
