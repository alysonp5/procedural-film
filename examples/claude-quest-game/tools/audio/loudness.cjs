// loudness.cjs : measure the whole film against the master target and say what GAIN would hit it.
//   node tools/audio/loudness.cjs [--mock | --events saved.json] [--target -14]
// Renders with the Node host (the film's own code), measures with ffmpeg ebur128 (integrated loudness,
// true peak), and solves for music.js's GAIN: the console is scaled by GAIN, the TV foley is not, so the
// solve iterates render-and-measure until the integrated loudness is within 0.05 LU of the target.
// It never edits music.js: set GAIN by hand to the printed value and re-run to confirm.
'use strict';
const fs = require('fs');
const path = require('path');
const H = require('./host.cjs');
const args = process.argv.slice(2);
const ti = args.indexOf('--target');
const TARGET = ti >= 0 ? Number(args[ti + 1]) : -14;
(async () => {
  const ei = args.indexOf('--events');
  const { events, source } = await H.events({ mock: args.includes('--mock'), file: ei >= 0 ? args[ei + 1] : null });
  const FILM = H.load();
  const G0 = FILM.audio.info().gain;
  const file = path.join(H.OUT, 'loudness-probe.wav');
  const measure = (scale) => {
    const nes = FILM.audio.synth(48000, { events, foley: false });
    const withTv = new Float32Array(nes.length);
    for (let i = 0; i < nes.length; i++) withTv[i] = nes[i] * scale;
    FILM.foley.apply(withTv, 48000);
    H.writeWav(file, withTv, 48000);
    return H.loudness(file);
  };
  let scale = 1;
  let L = measure(scale);
  console.log(`events: ${source}; GAIN ${G0}: ${L.I} LUFS integrated, true peak ${L.TP} dBTP`);
  for (let k = 0; k < 4 && Math.abs(L.I - TARGET) > 0.05; k++) {
    scale *= Math.pow(10, (TARGET - L.I) / 20);
    L = measure(scale);
  }
  console.log(`GAIN ${(G0 * scale).toFixed(3)} gives ${L.I} LUFS, true peak ${L.TP} dBTP (limit -1.0)${L.TP > -1 ? '  OVER THE PEAK LIMIT' : ''}`);
  fs.rmSync(file, { force: true });
})().catch((e) => {
  console.error(e.stack || e.message);
  process.exit(1);
});
