// stems.cjs : one WAV per song, an SFX reel and the TV foley alone, rendered by the film's own code (Node host).
//   node tools/audio/stems.cjs [--out /tmp/cq2/audio] [--sr 48000]
// Songs that loop are rendered for their intro plus two passes of the loop, so the seam is audible;
// the fanfare plays once and rings out. The reel spaces every effect (and its variants) 0.9 s apart
// and prints where each one starts. Each file gets integrated loudness and true peak (ffmpeg ebur128).
'use strict';
const path = require('path');
const fs = require('fs');
const H = require('./host.cjs');

const args = process.argv.slice(2);
const opt = (k, d) => {
  const i = args.indexOf('--' + k);
  return i >= 0 ? args[i + 1] : d;
};
const OUT = opt('out', H.OUT);
const SR = Number(opt('sr', 48000));
fs.mkdirSync(OUT, { recursive: true });
const FILM = H.load({ foley: false });
const info = FILM.audio.info();

const rows = [];
for (const id of FILM.audio.songs) {
  const s = info.songs[id];
  const frames = s.loopFrame == null ? s.frames + 60 : s.frames + (s.frames - s.loopFrame);
  const data = FILM.audio.synth(SR, { events: [{ f: 0, type: 'song', id }], samples: Math.round((frames / 60) * SR), foley: false });
  const file = H.writeWav(path.join(OUT, `song-${id}.wav`), data, SR);
  const L = H.loudness(file);
  rows.push(`${id.padEnd(12)} ${(frames / 60).toFixed(2).padStart(6)} s  speed ${s.speed} frames/row  loop at frame ${s.loopFrame == null ? '-' : s.loopFrame}  ${L.I} LUFS  TP ${L.TP} dBTP  -> ${file}`);
}

const reel = [
  ['start'], ['jump', { big: false }], ['jump', { big: true }], ['stomp', { combo: 1 }], ['stomp', { combo: 2 }], ['stomp', { combo: 3 }], ['stomp', { combo: 4 }],
  ['kick', { combo: 1 }], ['kick', { combo: 3 }], ['kick', { combo: 5 }], ['coin'], ['bump'], ['brick'], ['sprout'], ['powerup'], ['oneup'], ['pipe'],
  ['flagpole', { height: 5000, frames: 70 }], ['flagpole', { height: 400, frames: 40 }], ['tally', { n: 0 }], ['tally', { n: 1 }], ['firework'], ['fireball'],
  ['hop'], ['roar'], ['axe'], ['bridge', { i: 0 }], ['bridge', { i: 8 }], ['bossfall'], ['text', { line: 'YOU DID IT, CLAW\'D!', every: 1 }], ['text', { chars: 12, every: 3 }],
];
const events = [];
const index = [];
let f = 30;
for (const [type, data] of reel) {
  events.push(Object.assign({ f, type }, data || {}));
  index.push(`${(f / 60).toFixed(2).padStart(6)} s  ${type}${data ? ' ' + JSON.stringify(data) : ''}`);
  f += type === 'bossfall' || type === 'roar' ? 80 : type === 'flagpole' ? (data.frames || 62) + 20 : 54;
}
const reelData = FILM.audio.synth(SR, { events, samples: Math.round(((f + 30) / 60) * SR), foley: false });
const reelFile = H.writeWav(path.join(OUT, 'sfx-reel.wav'), reelData, SR);
fs.writeFileSync(path.join(OUT, 'sfx-reel.txt'), index.join('\n') + '\n');
const L = H.loudness(reelFile);

// the TV alone: the film's length with a silent console, so only src/foley.js sounds
const FT = H.load();
const tv = FT.audio.synth(SR, { events: [] });
const tvFile = H.writeWav(path.join(OUT, 'tv-foley.wav'), tv, SR);
let tvPeak = 0;
for (const x of tv) tvPeak = Math.max(tvPeak, Math.abs(x));
const crt = FT.TIMELINE.crt || {};

console.log(`DMC ROM: ${info.dmcRomBytes} bytes at $C000 (${Object.entries(info.dmc).map(([k, v]) => `${k} ${v}`).join(', ')})`);
console.log(rows.join('\n'));
console.log(`sfx reel     ${(f / 60 + 0.5).toFixed(2).padStart(6)} s  ${reel.length} effects  ${L.I} LUFS  TP ${L.TP} dBTP  -> ${reelFile} (index: sfx-reel.txt)`);
console.log(`tv foley     power-on frames ${JSON.stringify(crt.powerOn)}, power-off ${JSON.stringify(crt.powerOff)}, sample peak ${(20 * Math.log10(tvPeak)).toFixed(1)} dBFS -> ${tvFile}`);
