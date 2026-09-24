// drums.cjs : are the DMC drums heard in the mix? For each song, every DMC trigger in the register log
// ($4015 = $1F) is located and the level of the 25 ms after it is compared with the 25 ms before it,
// band-passed to 60-400 Hz where the kick, snare body and timpani live.
//   node tools/audio/drums.cjs [song ...]
'use strict';
const H = require('./host.cjs');
const pick = process.argv.slice(2);
const FILM = H.load({ foley: false });
const info = FILM.audio.info();
const SR = 48000;
// RBJ biquad, Q 0.707: high-pass or low-pass at f0
function biquad(x, f0, hp) {
  const w = (2 * Math.PI * f0) / SR;
  const al = Math.sin(w) / (2 * 0.707);
  const c = Math.cos(w);
  const b = hp ? [(1 + c) / 2, -(1 + c), (1 + c) / 2] : [(1 - c) / 2, 1 - c, (1 - c) / 2];
  const a = [1 + al, -2 * c, 1 - al];
  const y = new Float32Array(x.length);
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
  for (let i = 0; i < x.length; i++) {
    const v = (b[0] * x[i] + b[1] * x1 + b[2] * x2 - a[1] * y1 - a[2] * y2) / a[0];
    x2 = x1;
    x1 = x[i];
    y2 = y1;
    y1 = v;
    y[i] = v;
  }
  return y;
}
const band = (x) => biquad(biquad(x, 60, true), 400, false);
const rms = (x, a, b) => {
  let e = 0;
  for (let i = Math.max(0, a); i < Math.min(x.length, b); i++) e += x[i] * x[i];
  return Math.sqrt(e / Math.max(1, b - a));
};
for (const id of pick.length ? pick : FILM.audio.songs) {
  const s = info.songs[id];
  const frames = s.frames;
  const buf = FILM.audio.synth(SR, { events: [{ f: 0, type: 'song', id }], samples: Math.round((frames / 60) * SR), foley: false, log: true });
  const y = band(buf);
  const lifts = [];
  for (const [f, w] of buf.log) {
    for (let i = 0; i < w.length; i += 2) {
      if (w[i] === 0x4015 && w[i + 1] === 0x1f) {
        const at = Math.round((f * SR) / 60);
        const n = Math.round(0.025 * SR);
        if (at - n < 0 || at + n > y.length) continue; // both windows must lie inside the render
        lifts.push(20 * Math.log10((rms(y, at, at + n) + 1e-9) / (rms(y, at - n, at) + 1e-9)));
      }
    }
  }
  if (!lifts.length) {
    console.log(`${id.padEnd(12)} no DMC drums`);
    continue;
  }
  lifts.sort((a, b) => a - b);
  const med = lifts[lifts.length >> 1];
  console.log(`${id.padEnd(12)} ${String(lifts.length).padStart(3)} DMC hits; 60-400 Hz level after vs before: median ${med >= 0 ? '+' : ''}${med.toFixed(1)} dB, lowest ${lifts[0].toFixed(1)} dB, highest ${lifts[lifts.length - 1].toFixed(1)} dB`);
}
