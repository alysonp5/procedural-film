// sfxlevel.cjs : is each sound effect heard over the music under it? For every effect event the effects
// alone and the music alone are rendered (the film's driver with song or effect events muted), K-weighted
// (BS.1770), and their loudness compared over the effect's first 10 frames (the attack the ear locks on).
//   node tools/audio/sfxlevel.cjs [--events events.json | --mock]
// Prints, per effect type, the median effect loudness, the music's in the same windows and the margin.
// The effect "takes over" a channel, so the music figure includes the voice it silenced.
'use strict';
const H = require('./host.cjs');
const args = process.argv.slice(2);
const ei = args.indexOf('--events');
const SR = 48000;
function kweight(x) {
  const bq = (b, a) => {
    const y = new Float64Array(x.length);
    let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
    for (let i = 0; i < x.length; i++) {
      const v = b[0] * x[i] + b[1] * x1 + b[2] * x2 - a[1] * y1 - a[2] * y2;
      x2 = x1;
      x1 = x[i];
      y2 = y1;
      y1 = v;
      y[i] = v;
    }
    x = y;
  };
  bq([1.53512485958697, -2.69169618940638, 1.19839281085285], [1, -1.69065929318241, 0.73248077421585]);
  bq([1, -2, 1], [1, -1.99004745483398, 0.99007225036621]);
  return x;
}
const lufs = (y, a, b) => {
  let e = 0;
  for (let i = a; i < b; i++) e += y[i] * y[i];
  return -0.691 + 10 * Math.log10(e / Math.max(1, b - a) + 1e-20) + 3.01; // + 3 dB: mono heard on both channels
};
(async () => {
  const { events, source } = await H.events({ mock: args.includes('--mock'), file: ei >= 0 ? args[ei + 1] : null });
  const FILM = H.load({ foley: false });
  const sfx = kweight(FILM.audio.synth(SR, { events, foley: false, mute: { music: true } }));
  const mus = kweight(FILM.audio.synth(SR, { events, foley: false, mute: { sfx: true } }));
  const by = {};
  const seen = new Set();
  for (const e of events) {
    if (e.type === 'song' || seen.has(e.f + e.type)) continue;
    seen.add(e.f + e.type);
    const a = Math.round((e.f / 60) * SR);
    const b = Math.min(sfx.length, a + Math.round((10 / 60) * SR));
    if (b <= a) continue;
    (by[e.type] = by[e.type] || []).push([lufs(sfx, a, b), lufs(mus, a, b)]);
  }
  const med = (xs) => xs.slice().sort((p, q) => p - q)[xs.length >> 1];
  console.log(`events: ${source}; loudness over each effect's first 10 frames (K-weighted)`);
  for (const [t, rows] of Object.entries(by)) {
    const s = med(rows.map((r) => r[0]));
    const m = med(rows.map((r) => r[1]));
    console.log(`${t.padEnd(10)} n=${String(rows.length).padStart(3)}  effect ${s.toFixed(1).padStart(6)} LUFS  music ${m.toFixed(1).padStart(6)}  margin ${(s - m >= 0 ? '+' : '') + (s - m).toFixed(1)} LU`);
  }
})().catch((e) => {
  console.error(e.stack || e.message);
  process.exit(1);
});
