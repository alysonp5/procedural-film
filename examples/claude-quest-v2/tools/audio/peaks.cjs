// peaks.cjs : where the loudest moments of a render are, and what the game was doing there.
//   node tools/audio/peaks.cjs [wav=/tmp/cq2/audio/score.wav] [--top 12] [--events events.json]
// True peak is estimated the BS.1770 way: every sample is 4x oversampled (a 48-tap windowed-sinc
// interpolator per phase), not only the loudest sample of a window, since an inter-sample peak can sit
// beside a smaller sample. The loudest peaks are listed at least 0.5 s apart, each with the song playing
// and the effects that started in the 0.5 s before it (grouped: "tally x23"). ffmpeg's ebur128 true peak
// for the whole file is printed as the reference; the two agree within about 0.1 dB.
'use strict';
const fs = require('fs');
const path = require('path');
const H = require('./host.cjs');
const args = process.argv.slice(2);
const flag = (k) => {
  const i = args.indexOf('--' + k);
  return i >= 0 ? args[i + 1] : null;
};
const TOP = Number(flag('top') || 12);
const valueIdx = new Set(['top', 'events'].map((k) => args.indexOf('--' + k) + 1).filter((i) => i > 0));
const file = args.find((a, i) => !a.startsWith('--') && !valueIdx.has(i)) || path.join(H.OUT, 'score.wav');
const evFile = flag('events') || path.join(H.OUT, 'events.json');
const { sr, data } = H.readWav(file);
const events = fs.existsSync(evFile) ? JSON.parse(fs.readFileSync(evFile, 'utf8')) : [];

// polyphase 4x interpolator: phases 1/4, 2/4, 3/4, 24 taps each side, Kaiser-like (Blackman) window
const TAPS = 24;
const phases = [0.25, 0.5, 0.75].map((fr) => {
  const h = new Float64Array(2 * TAPS);
  for (let k = -TAPS + 1; k <= TAPS; k++) {
    const x = k - fr;
    const s = Math.sin(Math.PI * x) / (Math.PI * x);
    const u = (x + TAPS) / (2 * TAPS);
    const w = 0.42 - 0.5 * Math.cos(2 * Math.PI * u) + 0.08 * Math.cos(4 * Math.PI * u);
    h[k + TAPS - 1] = s * w;
  }
  return h;
});
const tp = new Float32Array(data.length);
for (let i = 0; i < data.length; i++) {
  let m = Math.abs(data[i]);
  if (i >= TAPS && i + TAPS < data.length) {
    for (const h of phases) {
      let acc = 0;
      for (let k = 0; k < 2 * TAPS; k++) acc += h[k] * data[i - TAPS + 1 + k];
      const a = Math.abs(acc);
      if (a > m) m = a;
    }
  }
  tp[i] = m;
}
// the loudest peaks, at least 0.5 s apart
const order = Array.from(tp.keys()).filter((i) => tp[i] > 0.05).sort((a, b) => tp[b] - tp[a]);
const picked = [];
for (const i of order) {
  if (picked.every((j) => Math.abs(i - j) > 0.5 * sr)) picked.push(i);
  if (picked.length >= TOP) break;
}
const songAt = (f) => {
  let s = 'none';
  for (const e of events) if (e.type === 'song' && e.f <= f) s = e.id + (e.section ? ':' + e.section : '');
  return s;
};
const db = (v) => 20 * Math.log10(Math.max(v, 1e-12));
console.log(`${path.basename(file)}: ${events.length ? events.length + ' events from ' + evFile : 'no event list'}`);
for (const i of picked) {
  const f = (i / sr) * 60;
  const near = {};
  for (const e of events) if (e.type !== 'song' && e.f <= f && e.f > f - 30) near[e.type] = (near[e.type] || 0) + 1;
  const list = Object.entries(near).map(([k, n]) => (n > 1 ? `${k} x${n}` : k));
  console.log(`${(i / sr).toFixed(3).padStart(8)} s  f${f.toFixed(0).padStart(5)}  ${db(tp[i]).toFixed(2)} dBTP  song ${songAt(f).padEnd(14)} ${list.join(', ')}`);
}
let max = 0;
for (const v of tp) if (v > max) max = v;
const L = H.loudness(file);
console.log(`file true peak: this estimate ${db(max).toFixed(2)} dBTP, ffmpeg ebur128 ${L.TP} dBTP; integrated ${L.I} LUFS`);
