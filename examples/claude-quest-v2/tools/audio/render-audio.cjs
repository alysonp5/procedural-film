// render-audio.cjs : render FILM.audio offline in headless Chromium (the film's real path: the full
// load order, FILM.audio.render into an OfflineAudioContext) to a 48 kHz stereo float WAV, and measure it.
//   node tools/audio/render-audio.cjs [--start 0] [--end <duration>] [--out /tmp/cq2/audio/score.wav] [--mock | --events saved.json]
// Events: FILM.game.events() when the game is loaded; --mock (or no game) renders the mock list instead
// (tools/audio/mock-events.js, passed as render's tools-only `events` option). The source is printed.
'use strict';
const path = require('path');
const fs = require('fs');
const C = require('../common.cjs');
const H = require('./host.cjs');

(async () => {
  const args = C.parseArgs(process.argv.slice(2), ['mock']);
  const SR = 48000;
  const src = C.sources({ player: false, lenient: true });
  const start = args.start != null ? Number(args.start) : 0;
  const end = args.end != null ? Number(args.end) : src.timeline.duration;
  const out = C.resolveOut(typeof args.out === 'string' ? args.out : path.join(H.OUT, 'score.wav'));
  fs.mkdirSync(path.dirname(out), { recursive: true });
  const browser = await C.launch();
  let pg;
  try {
    pg = await C.openPage(browser, src.files.filter((f) => fs.existsSync(f)), { scale: 0.1, prefix: 'audio-render' });
    const problems = [...pg.loadErrors.map((e) => `${e.file}:${e.line}:${e.col} ${e.message}`), ...pg.pageErrors];
    if (problems.length) throw new Error('load errors:\n  ' + problems.join('\n  '));
    const hasGame = await pg.page.evaluate(() => !!(window.FILM.game && typeof FILM.game.events === 'function'));
    const saved = typeof args.events === 'string' ? JSON.parse(fs.readFileSync(args.events, 'utf8')) : null;
    const mock = saved || (args.mock || !hasGame ? H.mockEvents() : null);
    const a = await pg.page.evaluate(
      async ([s, e, sr, ev]) => {
        const len = Math.max(1, Math.round((e - s) * sr));
        const ctx = new OfflineAudioContext(2, len, sr);
        const t0 = performance.now();
        FILM.audio.render(ctx, ev ? { start: s, dest: ctx.destination, events: ev } : { start: s, dest: ctx.destination });
        const ms = performance.now() - t0;
        const buf = await ctx.startRendering();
        const L = buf.getChannelData(0), R = buf.getChannelData(1);
        const inter = new Float32Array(len * 2);
        let peak = 0;
        for (let i = 0; i < len; i++) {
          inter[2 * i] = L[i];
          inter[2 * i + 1] = R[i];
          peak = Math.max(peak, Math.abs(L[i]), Math.abs(R[i]));
        }
        const bytes = new Uint8Array(inter.buffer);
        let bin = '';
        for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
        const nEv = ev ? ev.length : FILM.game.events().length;
        return { b64: btoa(bin), frames: len, peak, ms, nEv };
      },
      [start, end, SR, mock]
    );
    C.writeWavFloat(out, a.b64, 2, SR);
    const L = H.loudness(out);
    console.log(`events: ${saved ? args.events + ' (a saved event list)' : mock ? 'tools/audio/mock-events.js (mock)' : 'FILM.game.events() (the real game)'}, ${a.nEv} events`);
    console.log(`rendered ${start}..${end} s: FILM.audio.render (synthesis + scheduling) took ${a.ms.toFixed(0)} ms in Chromium; sample peak ${a.peak.toFixed(4)} (${(20 * Math.log10(a.peak)).toFixed(2)} dBFS)`);
    console.log(`loudness (ffmpeg ebur128): integrated ${L.I} LUFS, LRA ${L.LRA} LU, true peak ${L.TP} dBTP -> ${out}`);
    if (pg.pageErrors.length || pg.consoleErrors.length) console.log('page errors:', pg.pageErrors, pg.consoleErrors);
  } finally {
    if (pg) await pg.close();
    await browser.close();
  }
})().catch((e) => {
  console.error(e.stack || e.message);
  process.exit(1);
});
