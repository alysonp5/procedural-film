// music.js : the score and sound design of Claude Quest, played on an emulated NES 2A03 APU.
// Owner: music. Contract: docs/CONTRACT.md, section Audio.
//
// FILM.audio.render(ctx, { start = 0, dest = ctx.destination }) plays the whole piece, music and
// effects, from global time `start` into any BaseAudioContext.
//
// How it works, in the order the sound is made:
//   1 compose()  writes an original score and the effect cues as per-frame register states for the
//                four APU channels (pulse 1, pulse 2, triangle, noise), one state per 1/60 s driver
//                frame, the way a 1985 sound driver updates the chip once per video frame. An effect
//                takes over its channel for its length; the music voice on that channel is silent
//                meanwhile and resumes on the frame the effect ends.
//   2 synth()    emulates the chip from those states: 11-bit pulse timers with the four duty
//                sequences and the hardware sweep unit, the 32-step triangle with its linear counter,
//                the 15-bit noise LFSR in long and short mode with the NTSC period table, the
//                non-linear NES mixer, and the console's output filters (high-pass 90 Hz and 440 Hz,
//                low-pass 14 kHz). Channels are integrated exactly over each sub-sample at 4x the
//                output rate and decimated by a windowed-sinc filter, which band-limits the square
//                edges without softening them.
//   3 render()   plays the finished mono buffer (copied to both channels) through one
//                AudioBufferSourceNode. The buffer is always computed from time 0, so any `start`
//                hears exactly the same samples at the same global times.
//
// No reverb, delay, compressor or panning: what leaves here is the chip, times one flat gain set by
// measurement (tools/audio) so the master sits near -14 LUFS with true peak under -1 dBFS.
// Deterministic: the only randomness is FILM.lib.rng, seeded per effect.
(function () {
  'use strict';
  const FILM = window.FILM;
  const lib = FILM.lib;
  const TAU = Math.PI * 2;

  // ---------------------------------------------------------------- hardware constants
  const CPU = 1789773; // NTSC 2A03 clock, Hz
  const FPS = 60; // driver frames per second
  const SUB = 4; // integration sub-samples per output sample
  const GAIN = 2.78; // flat master gain, set by measurement
  const DUTY = [
    [0, 1, 0, 0, 0, 0, 0, 0], // 12.5 %
    [0, 1, 1, 0, 0, 0, 0, 0], // 25 %
    [0, 1, 1, 1, 1, 0, 0, 0], // 50 %
    [1, 0, 0, 1, 1, 1, 1, 1], // 75 %
  ];
  const TRI = [];
  for (let i = 15; i >= 0; i--) TRI.push(i);
  for (let i = 0; i <= 15; i++) TRI.push(i);
  const NOISE = [4, 8, 16, 32, 64, 96, 128, 160, 202, 254, 380, 508, 762, 1016, 2034, 4068];

  // ---------------------------------------------------------------- pitch
  const SEMI = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
  function midi(n) {
    if (typeof n === 'number') return n;
    const m = /^([A-G])(#|b)?(-?\d)$/.exec(n);
    if (!m) throw new Error('music.js: bad note ' + n);
    return 12 * (Number(m[3]) + 1) + SEMI[m[1]] + (m[2] === '#' ? 1 : m[2] === 'b' ? -1 : 0);
  }
  const mhz = (m) => 440 * Math.pow(2, (midi(m) - 69) / 12);
  const clampT = (t) => Math.max(0, Math.min(2047, t));
  const ptimer = (hz) => clampT(Math.round(CPU / (16 * hz) - 1)); // pulse: f = CPU / (16 (t + 1))
  const ttimer = (hz) => clampT(Math.round(CPU / (32 * hz) - 1)); // triangle: f = CPU / (32 (t + 1))

  // ---------------------------------------------------------------- instruments (music voices)
  // A pulse instrument turns (frame k of a note, note length in frames, midi) into a register state.
  // vols: the first frames' volumes; after them the volume steps down by 1 every `every` frames to
  // `floor`. The last frame of a note of 3+ frames is silent, so repeated notes articulate.
  function pulseInst(duty, vols, floor, every, o) {
    const opt = o || {};
    return {
      ch: 'p',
      frame(k, len, m) {
        const gate = opt.gate ? opt.gate(len) : len >= 3 ? len - 1 : len;
        const t = ptimer(mhz(m));
        if (k >= gate) return { v: 0, d: duty, t };
        let v = k < vols.length ? vols[k] : Math.max(floor, vols[vols.length - 1] - Math.floor((k - vols.length + 1) / every));
        v = Math.max(0, Math.min(15, v));
        let dt = 0;
        if (opt.vib && k >= opt.vib[0]) dt = Math.round(opt.vib[1] * Math.sin((TAU * (k - opt.vib[0])) / opt.vib[2]));
        return { v, d: duty, t: t + dt };
      },
    };
  }
  function triInst(gateOf, vib) {
    return {
      ch: 't',
      frame(k, len, m) {
        const g = Math.max(1, Math.min(len, gateOf(len)));
        if (k >= g) return null;
        let dt = 0;
        if (vib && k >= vib[0]) dt = Math.round(vib[1] * Math.sin((TAU * (k - vib[0])) / vib[2]));
        return { t: ttimer(mhz(m)) + dt, gate: g, k };
      },
    };
  }
  // Noise drums: [period index, volume, short mode] per frame.
  function drum(rows) {
    return {
      ch: 'n',
      frame(k) {
        const r = rows[k];
        return r ? { i: r[0], v: r[1], m: r[2] || 0 } : null;
      },
    };
  }
  const INST = {
    lead: pulseInst(2, [12, 11, 10, 9], 6, 6),
    leadHi: pulseInst(1, [10, 10, 9, 8], 5, 6),
    dbl: pulseInst(2, [9, 8, 8, 7], 5, 6),
    harm: pulseInst(1, [8, 7, 7, 6], 4, 8),
    stab: pulseInst(2, [9, 7, 5, 3, 2, 1], 0, 2),
    cave: pulseInst(2, [10, 8, 6, 4, 2, 1], 0, 2),
    brass: pulseInst(2, [13, 13, 12, 12, 11], 9, 8, { vib: [14, 1, 6] }),
    brass2: pulseInst(1, [9, 9, 8, 8, 7], 6, 8),
    oom: pulseInst(2, [11, 9, 7, 5, 4, 3, 2, 1], 0, 3),
    pah: pulseInst(0, [7, 6, 5, 4, 3, 2, 1], 0, 3),
    bass: triInst((len) => Math.max(3, Math.round(len * 0.7))),
    hold: triInst((len) => len - 1),
    triLead: triInst((len) => len - 2, [16, 1, 6]),
  };
  const DRUMS = {
    K: drum([[10, 13], [11, 9], [12, 5], [12, 2]]),
    S: drum([[6, 12], [6, 9], [7, 7], [7, 5], [8, 3], [8, 2], [8, 1]]),
    H: drum([[1, 7], [1, 3], [1, 1]]),
    h: drum([[1, 4], [1, 1]]),
    C: drum(Array.from({ length: 22 }, (_, k) => [3, Math.max(0, Math.round(11 - k / 2))])),
    D: drum([[2, 6, 1], [2, 3, 1], [2, 1, 1]]),
  };

  // ---------------------------------------------------------------- effects (per-frame programs)
  const SIL = () => ({ v: 0, d: 2 });
  const lerp = (a, b, f) => a + (b - a) * f;
  // A pulse tone: hz for n frames. o.d duty, o.v [from, to] volume, o.bend pitch ratio per frame,
  // o.vib [depth ratio, period frames], o.wob alternating +/- ratio each frame.
  function pt(hz, n, o) {
    const out = [];
    let f = hz;
    const v = o.v || [12, 12];
    for (let k = 0; k < n; k++) {
      let ff = f;
      if (o.vib) ff *= 1 + o.vib[0] * Math.sin((TAU * k) / o.vib[1]);
      if (o.wob) ff *= k & 1 ? 1 - o.wob : 1 + o.wob;
      out.push({ v: Math.round(lerp(v[0], v[1], n > 1 ? k / (n - 1) : 0)), d: o.d == null ? 2 : o.d, t: ptimer(ff), trig: k === 0 && o.trig !== false });
      f *= o.bend || 1;
    }
    return out;
  }
  // A pulse tone driven by the hardware sweep unit: the driver writes the timer once, the sweep
  // divider (period p half-frames) shifts it by t >> s every clock, down (neg) or up in period.
  function psw(hz, n, o) {
    const out = [];
    const v = o.v || [12, 12];
    const sw = { p: o.p || 0, n: !!o.neg, s: o.s };
    for (let k = 0; k < n; k++) {
      const st = { v: Math.round(lerp(v[0], v[1], n > 1 ? k / (n - 1) : 0)), d: o.d == null ? 2 : o.d, sw };
      if (k === 0) Object.assign(st, { t: ptimer(hz), trig: true });
      out.push(st);
    }
    return out;
  }
  const gap = (n) => Array.from({ length: n }, SIL);
  const cat = (...a) => [].concat(...a);
  // Two notes alternating every frame: the driver's arpeggio trick for a shimmering chord.
  function trill(a, b, n, o) {
    const out = [];
    const v = o.v || [12, 0];
    for (let k = 0; k < n; k++) out.push({ v: Math.round(lerp(v[0], v[1], k / Math.max(1, n - 1))), d: o.d == null ? 1 : o.d, t: ptimer(mhz(k & 1 ? b : a)), trig: k === 0 });
    return out;
  }
  const nz = (rows) => rows.map((r) => ({ i: r[0], v: r[1], m: r[2] || 0 }));
  function tthud(hz, n, ratio) {
    const out = [];
    for (let k = 0; k < n; k++) out.push({ t: ttimer(hz * Math.pow(ratio, k)), gate: n, k, trig: k === 0 });
    return out;
  }
  // The coin: a short grace note, then the fifth above it rings and decays.
  const coin = (note, ring) => cat(pt(mhz(note), 3, { d: 1, v: [12, 12] }), pt(mhz(midi(note) + 7), ring || 22, { d: 1, v: [13, 0] }));
  // A bubble glug: a short upward chirp, then a breath of silence.
  const glug = (hz) => cat(pt(hz, 5, { d: 2, v: [12, 7], bend: 1.07 }), gap(3));
  const squish = () => nz([[5, 15], [6, 13], [7, 10], [8, 7], [9, 4], [10, 2]]);

  // ---------------------------------------------------------------- the score
  // Returns per-frame register states for the four channels. Times are global seconds; one
  // sixteenth is 1/4 beat of FILM.TIMELINE.bpm (0.125 s at 120 bpm). Every note lands on the frame
  // nearest its time, so an off-frame sixteenth alternates 8- and 7-frame lengths like a real driver.
  function compose(F) {
    const bpm = (FILM.TIMELINE && FILM.TIMELINE.bpm) || 120;
    const S16 = 15 / bpm;
    const fr = (t) => Math.round(t * FPS);
    const notes = [];
    const sfx = [];

    function parse(str) {
      return str
        .trim()
        .split(/\s+/)
        .map((tok) => {
          const [a, b] = tok.split(':');
          return { m: a === 'r' ? null : midi(a), n: b ? Number(b) : 1 };
        });
    }
    // One voice's line from t0; `expect` (sixteenths) guards against miscounted bars.
    function line(ch, t0, str, inst, expect, tr) {
      let p = 0;
      for (const tok of parse(str)) {
        if (tok.m !== null) notes.push({ ch, f0: fr(t0 + p * S16), f1: fr(t0 + (p + tok.n) * S16), m: tok.m + (tr || 0), inst });
        p += tok.n;
      }
      if (expect != null && p !== expect) throw new Error(`music.js: line at ${t0}s is ${p} sixteenths, expected ${expect}`);
      return p;
    }
    // Drums: one character per sixteenth; a hit rings until the next hit or its table ends.
    function drums(t0, pat) {
      for (let p = 0; p < pat.length; p++) {
        const c = pat[p];
        if (c === '.') continue;
        let q = p + 1;
        while (q < pat.length && pat[q] === '.') q++;
        notes.push({ ch: 'n', f0: fr(t0 + p * S16), f1: fr(t0 + q * S16), m: 0, inst: DRUMS[c] });
      }
    }
    const fx = (ch, t, frames) => sfx.push({ ch, f0: fr(t), frames });

    // Chords: pitch classes, and the triangle bass root (kept in the G2..F#3 pocket).
    const CH = {
      C: [[0, 4, 7], 48],
      F: [[5, 9, 0], 53],
      Dm: [[2, 5, 9], 50],
      G: [[7, 11, 2], 43],
      G7: [[7, 11, 2, 5], 43],
      Em: [[4, 7, 11], 52],
      A7: [[9, 1, 4, 7], 45],
    };
    // Bouncing bass for one half bar: root, root pickup, fifth, then a chromatic step into the next
    // root (or the octave when the chord holds).
    function bassHalf(t0, ch, next) {
      const r = CH[ch][1];
      const nx = CH[next][1];
      const x = nx !== r ? nx - 1 : r + 12;
      notes.push({ ch: 't', f0: fr(t0), f1: fr(t0 + 3 * S16), m: r, inst: INST.bass });
      notes.push({ ch: 't', f0: fr(t0 + 3 * S16), f1: fr(t0 + 4 * S16), m: r, inst: INST.bass });
      notes.push({ ch: 't', f0: fr(t0 + 4 * S16), f1: fr(t0 + 6 * S16), m: r + 7, inst: INST.bass });
      notes.push({ ch: 't', f0: fr(t0 + 6 * S16), f1: fr(t0 + 8 * S16), m: x, inst: INST.bass });
    }
    // Offbeat calypso stabs on pulse 2: the chord's third on 2 and 10, its fifth on 6 and 14, placed
    // between E4 and D5.
    function stabs(t0, halves, from, to) {
      for (let p = from || 0; p < (to || 16); p++) {
        if (p % 4 !== 2) continue;
        const pcs = CH[halves[p < 8 ? 0 : halves.length - 1]][0];
        const pc = p % 8 === 2 ? pcs[1] : pcs[2];
        let m = 64;
        while (((m % 12) + 12) % 12 !== pc) m++;
        notes.push({ ch: 'p2', f0: fr(t0 + p * S16), f1: fr(t0 + (p + 1) * S16), m, inst: INST.stab });
      }
    }
    // Harmony a chord tone below the lead: the nearest chord tone at least a minor third down.
    function thirds(t0, str, halves) {
      let p = 0;
      for (const tok of parse(str)) {
        if (tok.m !== null) {
          const pcs = CH[halves[p < 8 ? 0 : halves.length - 1]][0];
          let h = tok.m - 3;
          while (!pcs.includes(((h % 12) + 12) % 12)) h--;
          notes.push({ ch: 'p2', f0: fr(t0 + p * S16), f1: fr(t0 + (p + tok.n) * S16), m: h, inst: INST.harm });
        }
        p += tok.n;
      }
    }
    const RUNDRUM = 'K.H.S.HhK.HKS.Hh';

    // ---- 0.5 title jingle: a climbing C major arpeggio onto a held C6, pickup into the run
    line('p1', 0.5, 'C5 E5 G5 C6:7 G5 B5', INST.lead, 12);
    line('p2', 0.5, 'G4 C5 E5 G5:7 r:2', INST.harm, 12);
    line('t', 0.5, 'C3:10 G2:2', INST.hold, 12);
    drums(0.5, 'C.........SS');

    // ---- 2.0 to 20.5 the run theme (overworld): intro vamp, phrase A (4 bars), phrase B (4 bars)
    const RUN = [
      ['C6 r G5 r r:2 E5 r r:4 D5 E5 F5 F#5', ['C']], // intro, 2 s
      ['G5:2 E5 G5 r A5 G5:2 r E5 C5:2 D5 E5 r D5', ['C']], // A1, 4 s
      ['A5:2 F5 A5 r C6 A5:2 r F5 D5:2 E5 F5 r G5', ['F']], // A2, 6 s
      ['A5 G5 F5 D5 r:2 F5 E5 D5:2 B4 D5 r G5:3', ['Dm', 'G']], // A3, 8 s
      ['E5:2 D5 C5:3 r G4 C5 D5 E5 r G5 r:3', ['C']], // A4, 10 s
      ['C6:2 A5 C6 r D6 C6 A5 r F5 G5:2 A5:3 r', ['F']], // B1, 12 s
      ['B5:2 G5 E5 r B5 A5:2 r C#6 A5 E5 G5:2 A5 G5', ['Em', 'A7']], // B2, 14 s
      ['D5 F5 A5 D6:2 C6 A5 r B5:2 G5 F5 D5:2 B4 r', ['Dm', 'G7']], // B3, 16 s
      ['C5 E5 G5 C6:3 r G5 A5 B5 C6 r C6 r:3', ['C']], // B4, 18 s
    ];
    for (let b = 0; b < RUN.length; b++) {
      const t0 = 2 + b * 16 * S16;
      const [mel, halves] = RUN[b];
      line('p1', t0, mel, INST.lead, 16);
      if (b >= 5) thirds(t0, mel, halves);
      else stabs(t0, halves);
      const nextBar = RUN[b + 1] ? RUN[b + 1][1][0] : 'C';
      const h2 = halves[halves.length - 1];
      bassHalf(t0, halves[0], h2);
      bassHalf(t0 + 8 * S16, h2, nextBar);
      drums(t0, b === 0 ? 'K.H.S.HhK.H.SSSS' : RUNDRUM);
    }
    // 20.0 tail, then the pipe cuts the theme at 20.5
    line('p1', 20, 'C6 r G5 r', INST.lead, 4);
    line('t', 20, 'C3:2 G2:2', INST.bass, 4);
    drums(20, 'K.H.');

    // ---- 21.0 to 24.0 underground: low staccato riff with chromatic turns, dripping noise
    line('p1', 21, 'A3 r r E4 r D#4 E4 r A3 r r G4 r F#4 F4 r A3 r C4 r B3 r A#3 r', INST.cave, 24);
    line('t', 21, 'A2:2 r:3 E3:2 r A2:2 r:3 E3:2 r A2:2 r:2 F3:2 E3:2', INST.bass, 24);
    drums(21, 'K..D...DK..D...DK..D.D.D');

    // ---- 24.5 pickup and drum fill, 25.0 the theme resumes an octave up, doubled below
    line('p1', 24.5, 'D6 E6 F6 F#6', INST.leadHi, 4);
    line('t', 24.5, 'G2:2 B2:2', INST.bass, 4);
    drums(24.5, 'SSSS');
    const A1 = RUN[1][0];
    const A2 = 'A5:2 F5 A5 r C6';
    line('p1', 25, A1, INST.leadHi, 16, 12);
    line('p1', 27, A2, INST.leadHi, 6, 12);
    line('p2', 25, A1, INST.dbl, 16);
    line('p2', 27, A2, INST.dbl, 6);
    bassHalf(25, 'C', 'C');
    bassHalf(26, 'C', 'F');
    line('t', 27, 'F3:3 F3 C4:2', INST.bass, 6);
    drums(25, 'K.HKS.HhK.H.S.HhK.H.S.');

    // ---- 28.75 course clear: a rising major-ninth flourish in parallel thirds
    line('p1', 28.75, 'G4 C5 E5 G5 B5 D6 D6 E6:3', INST.brass, 10);
    line('p2', 28.75, 'r:2 C5 E5 G5 B5 G5 C6:3', INST.brass2, 10);
    line('t', 28.75, 'C3:3 G2:2 C3:5', INST.hold, 10);

    // ---- 30.0 castle: the brass figure C5 F5 A5 C6, then darkens through Db to C before the door
    line('p1', 30, 'C5 F5 A5 C6:4 r Ab5 G5 F5 E5:2 r:3', INST.brass, 16);
    line('p2', 30, 'A4 C5 F5 A5:4 r F5 Eb5 Db5 C5:2 r:3', INST.brass2, 16);
    line('t', 30, 'F2:8 Db3:3 C3:3 r:2', INST.hold, 16);
    drums(30, 'K...S...S.SSK...');

    // ---- 32.0 throne-room waltz in 3/4: triangle lead, pulse oom and pah
    line('t', 32, 'A4:4 C5:2 F5:4 E5:2 D5:4 C5:2 A4:2 G4:2 A4:2', INST.triLead, 24);
    line('p1', 32, 'F3:4 r:8 Bb3:4 r:4 C4:4', INST.oom, 24);
    line('p2', 32, 'r:4 A4:4 C5:4 r:4 D5:4 E5:4', INST.pah, 24);

    // ---- 35.0 victory: the title jingle's rhythm up a fourth, then a bouncing line home to V of C
    line('p1', 35, 'F5 A5 C6 F6:3 r E6 D6 C6 D6:2 Bb5 F5 A5:2 C6 F5 r D5 F5 G5 B5 D6', INST.lead, 24);
    line('p2', 35, 'r:2 A4 r:3 C5 r:3 D5 r:3 C5 r:3 F4 r:3 B4 r', INST.stab, 24);
    line('t', 35, 'F3:3 F3 C3:2 A2:2 Bb2:2 D3:2 F3:2 A2:2 D3:2 A2:2 G2:2 B2:2', INST.bass, 24);
    drums(35, 'C.H.S.HhK.HKS.HhK.HKS.SS');

    // ---- 38.0 end card: the title jingle again, a last C chord, silence by the loop seam
    line('p1', 38, 'C5 E5 G5 C6:5 G5 E5 C6:2 r:4', INST.lead, 16);
    line('p2', 38, 'G4 C5 E5 G5:5 E5 C5 G5:2 r:4', INST.harm, 16);
    line('t', 38, 'C3:8 G2:2 C3:4 r:2', INST.hold, 16);
    drums(38, 'C.........K.....');

    // ---------------------------------------------------------------- effects on the cues
    const R = (seed) => lib.rng(lib.hash('claude-quest-sfx', seed));
    // 1.0, 1.5 sparkle pings: a two-note shimmer high above the jingle
    fx('p2', 1.0, trill('B6', 'E7', 14, { v: [12, 0], d: 1 }));
    fx('p2', 1.5, trill('C#7', 'F#7', 14, { v: [12, 0], d: 1 }));
    // 3.5 bug waddle: two low plodding notes
    fx('p2', 3.5, cat(pt(mhz('D4'), 5, { d: 2, v: [11, 3] }), gap(3), pt(mhz('A3'), 5, { d: 2, v: [11, 3] })));
    // 5.5 stomp: noise squish, a hardware-sweep drop (300 Hz down to about 80), then the +100 blip
    const stomp = (t, blip) => {
      fx('n', t, squish());
      fx('p2', t, cat(psw(300, 6, { d: 2, v: [13, 5], s: 3, p: 0, neg: false }), gap(2), blip ? pt(mhz('E6'), 5, { d: 0, v: [10, 2] }) : []));
    };
    stomp(5.5, true);
    // 7.5 block bump: noise thud and a triangle knock, the coin rising out of it
    fx('n', 7.5, nz([[12, 15], [12, 10], [13, 6], [13, 2]]));
    fx('t', 7.5, tthud(120, 5, 0.88));
    fx('p2', 7.5 + 3 / FPS, coin('C6'));
    // jumps: an upward hardware sweep (period shrinking by t >> s each half-frame)
    const jump = (t, hz, n, s) => fx('p2', t, psw(hz, n, { d: 1, v: [12, 2], s, p: 0, neg: true }));
    jump(9.5, 294, 11, 4);
    // 10.0 mushroom emerge: a wobbling slide 200 to 900 Hz over 18 frames
    fx('p2', 10.0, cat(pt(200, 18, { d: 2, v: [10, 8], bend: Math.pow(900 / 200, 1 / 17), wob: 0.06 }), pt(900, 3, { d: 2, v: [6, 1], trig: false })));
    // 11.0 power-up: a straight major arpeggio three frames a note, then a C7/E7 shimmer
    fx('p2', 11.0, cat(...['C5', 'E5', 'G5', 'C6', 'E6', 'G6', 'C7'].map((n) => pt(mhz(n), 3, { d: 1, v: [12, 11] })), trill('C7', 'E7', 14, { v: [11, 0], d: 1 })));
    jump(12.25, 220, 18, 5); // long jump
    // 13.25 land thud
    fx('n', 13.25, nz([[11, 14], [12, 9], [13, 4], [13, 1]]));
    // 14.0 to 15.5 stair hops: short bright boips climbing 300, 380, 460, 540 Hz
    [300, 380, 460, 540].forEach((hz, i) => fx('p2', 14 + i * 0.5, pt(hz, 6, { d: 2, v: [11, 3], bend: 1.12 })));
    stomp(17.0, false);
    // 17.5 shell kick tok
    fx('p2', 17.5, cat(pt(800, 1, { d: 0, v: [13, 13] }), pt(600, 3, { d: 0, v: [9, 3], trig: false })));
    fx('n', 17.5, nz([[2, 11, 1], [2, 5, 1]]));
    // 18.0, 18.5 combo hits G5, B5 with a driver echo
    const combo = (t, n) => fx('p2', t, cat(pt(mhz(n), 4, { d: 2, v: [13, 9] }), gap(2), pt(mhz(n), 4, { d: 2, v: [5, 2] })));
    combo(18.0, 'G5');
    combo(18.5, 'B5');
    jump(19.25, 294, 11, 4);
    // 20.5 pipe down: three glugs 400, 300, 200 Hz
    fx('p2', 20.5, cat(glug(400), glug(300), glug(200)));
    // 21.5 to 23.5 five coins, each a step higher; the last with a hop on pulse 1
    ['C6', 'D6', 'E6', 'F6', 'G6'].forEach((n, i) => fx('p2', 21.5 + i * 0.5, coin(n, 20)));
    fx('p1', 23.5, psw(392, 7, { d: 1, v: [9, 2], s: 3, p: 0, neg: true }));
    // 24.0 pipe rise: glugs climbing 200, 300, 400 Hz
    fx('p2', 24.0, cat(glug(200), glug(300), glug(400)));
    jump(27.0, 220, 20, 5); // big jump
    // 27.75 pole grab zang: C5 and E5 stabbed together, a crash under them
    fx('p1', 27.75, pt(mhz('C5'), 15, { d: 2, v: [15, 0] }));
    fx('p2', 27.75, pt(mhz('E5'), 15, { d: 2, v: [13, 0] }));
    fx('n', 27.75, nz([[3, 12], [3, 9], [4, 6], [4, 4], [4, 2], [4, 1]]));
    // 28.0 slide whistle down 900 to 300 Hz over 0.7 s
    fx('p2', 28.0, pt(900, 42, { d: 2, v: [11, 7], bend: Math.pow(300 / 900, 1 / 41), vib: [0.03, 4] }));
    // 28.75 +5000 tally: a quick pentatonic climb two frames a note
    fx('p2', 28.75, cat(...['G5', 'A5', 'C6', 'D6', 'E6', 'G6', 'A6', 'C7'].map((n) => pt(mhz(n), 2, { d: 0, v: [10, 10] }))));
    // 29.0, 29.5 fireworks: a sharp pop and a rumbling tail
    const firework = (t) => fx('n', t, nz([[2, 15], [3, 13]].concat(Array.from({ length: 16 }, (_, k) => [9 + (k >> 2), Math.max(0, 12 - k)]))));
    firework(29.0);
    firework(29.5);
    // 31.75 door clunk: a low noise hit and a triangle drop
    fx('n', 31.75, nz([[11, 15], [12, 12], [13, 8], [14, 5], [14, 3], [14, 1]]));
    fx('t', 31.75, tthud(90, 6, 0.9));
    // 33.0 "!" pling
    fx('p2', 33.0, cat(pt(mhz('F6'), 1, { d: 1, v: [12, 12] }), pt(mhz('F7'), 11, { d: 1, v: [12, 0], trig: false })));
    // 34.0 three heart pops, rising
    fx('p2', 34.0, cat(...['C6', 'E6', 'G6'].map((n) => cat(pt(mhz(n), 4, { d: 0, v: [11, 6], bend: 1.13 }), gap(4)))));
    // 36.0 +10000 bonus cascade: F-major triads pouring upward, then a held top note
    fx('p2', 36.0, cat(...[['F6', 'A6', 'C7'], ['F6', 'A6', 'C7'], ['A6', 'C7', 'F7']].map((tri, j) => cat(...tri.map((n) => pt(mhz(n), 2, { d: 0, v: [11 - j, 11 - j] })))), pt(mhz('F7'), 10, { d: 0, v: [9, 0] })));
    // 37.0, 37.5 sparkle bursts: seeded random high pentatonic notes, one per frame
    const burst = (t) => {
      const r = R(t);
      const set = ['C7', 'D7', 'E7', 'G7', 'A7', 'C8'];
      fx('p2', t, Array.from({ length: 12 }, (_, k) => ({ v: Math.round(12 - k), d: 0, t: ptimer(mhz(r.pick(set))), trig: k === 0 })));
      fx('n', t, nz([[0, 6, 1], [0, 4, 1], [0, 2, 1], [0, 1, 1]]));
    };
    burst(37.0);
    burst(37.5);
    // 39.5 final coin, ringing out before the loop seam
    fx('p2', 39.5, coin('C6', 26));

    // ---------------------------------------------------------------- paint frames
    const CHS = { p1: [], p2: [], t: [], n: [] };
    for (const k of Object.keys(CHS)) CHS[k] = new Array(F).fill(null);
    notes.sort((a, b) => a.f0 - b.f0);
    for (const nt of notes) {
      const arr = CHS[nt.ch];
      const len = nt.f1 - nt.f0;
      for (let k = 0; k < len; k++) {
        const f = nt.f0 + k;
        if (f < 0 || f >= F) continue;
        const st = nt.inst.frame(k, len, nt.m);
        if (!st) {
          arr[f] = nt.ch === 't' ? null : { v: 0, d: 2, mus: true };
          continue;
        }
        st.mus = true;
        if (k === 0) st.trig = true;
        arr[f] = st;
      }
    }
    sfx.sort((a, b) => a.f0 - b.f0);
    for (const s of sfx) {
      const arr = CHS[s.ch];
      for (let k = 0; k < s.frames.length; k++) {
        const f = s.f0 + k;
        if (f >= 0 && f < F) arr[f] = Object.assign({}, s.frames[k]);
      }
    }
    // The music voice resumes on the frame an effect ends: a fresh trigger (and, for the triangle,
    // the rest of its gate).
    for (const s of sfx) {
      const arr = CHS[s.ch];
      const f = s.f0 + s.frames.length;
      const st = f < F ? arr[f] : null;
      if (st && st.mus && !st.trig) arr[f] = Object.assign({}, st, s.ch === 't' ? { trig: true, gate: st.gate - st.k } : { trig: true });
    }
    return CHS;
  }

  // ---------------------------------------------------------------- the APU
  function synth(sr) {
    const DUR = (FILM.TIMELINE && FILM.TIMELINE.duration) || FILM.DURATION || 40;
    const F = Math.ceil(DUR * FPS);
    const S = compose(F);
    const RS = sr * SUB; // integration rate
    const cps = CPU / RS; // CPU cycles per sub-sample
    const nOut = Math.round(DUR * sr);
    const HALF = 23;
    const NS = nOut * SUB + HALF + 1;
    const sub = new Float32Array(NS);

    const mkPulse = (i) => ({ i, v: 0, d: 2, t: 0, per: 2, cnt: 2, pos: 0, swEn: false, swP: 0, swN: true, swS: 0, div: 0, reload: false, mute: true });
    const P = [mkPulse(0), mkPulse(1)];
    const T = { t: 0, per: 1, cnt: 1, pos: 0, lin: 0 };
    const N = { v: 0, per: 4, cnt: 4, lfsr: 1, mode: 0 };

    const target = (c) => (c.swN ? c.t - (c.t >> c.swS) - (c.i === 0 ? 1 : 0) : c.t + (c.t >> c.swS));
    const remute = (c) => {
      c.mute = c.t < 8 || (!c.swN && target(c) > 0x7ff);
    };
    function applyPulse(c, s) {
      if (!s) {
        c.v = 0;
        c.swEn = false;
        c.swN = true;
        c.swS = 0;
        return;
      }
      c.v = s.v;
      c.d = s.d;
      if (s.sw) {
        if (s.trig) {
          c.swEn = true;
          c.swP = s.sw.p;
          c.swN = s.sw.n;
          c.swS = s.sw.s;
          c.reload = true;
        }
      } else {
        // the driver's default sweep write: disabled, negate set, so low notes are never muted
        c.swEn = false;
        c.swN = true;
        c.swS = 0;
      }
      if (s.t !== undefined) {
        c.t = s.t;
        c.per = 2 * (c.t + 1);
      }
      if (s.trig) {
        c.pos = 0;
        c.cnt = c.per;
      }
      remute(c);
    }
    function applyFrame(f) {
      applyPulse(P[0], f < F ? S.p1[f] : null);
      applyPulse(P[1], f < F ? S.p2[f] : null);
      const t = f < F ? S.t[f] : null;
      if (t) {
        if (t.t !== undefined) {
          T.t = t.t;
          T.per = T.t + 1;
        }
        if (t.trig) T.lin = t.gate * 4;
      }
      const n = f < F ? S.n[f] : null;
      if (n && n.v > 0) {
        N.v = n.v;
        N.per = NOISE[n.i];
        N.mode = n.m;
      } else N.v = 0;
    }
    function quarter(q) {
      if (T.lin > 0) T.lin--;
      if (q & 1) {
        // half frame: the sweep units
        for (const c of P) {
          if (c.div === 0 && c.swEn && c.swS > 0 && !c.mute) {
            c.t = Math.max(0, target(c));
            c.per = 2 * (c.t + 1);
            remute(c);
          }
          if (c.div === 0 || c.reload) {
            c.div = c.swP;
            c.reload = false;
          } else c.div--;
        }
      }
    }
    function pulseAvg(c) {
      if (c.v === 0 || c.mute) return 0;
      const seq = DUTY[c.d];
      let rem = cps;
      let acc = 0;
      let out = seq[c.pos];
      while (c.cnt <= rem) {
        acc += out * c.cnt;
        rem -= c.cnt;
        c.pos = (c.pos + 1) & 7;
        out = seq[c.pos];
        c.cnt = c.per;
      }
      acc += out * rem;
      c.cnt -= rem;
      return (c.v * acc) / cps;
    }
    function triAvg() {
      if (T.lin === 0 || T.t < 2) return TRI[T.pos]; // halted: the sequencer holds its step
      let rem = cps;
      let acc = 0;
      let out = TRI[T.pos];
      while (T.cnt <= rem) {
        acc += out * T.cnt;
        rem -= T.cnt;
        T.pos = (T.pos + 1) & 31;
        out = TRI[T.pos];
        T.cnt = T.per;
      }
      acc += out * rem;
      T.cnt -= rem;
      return acc / cps;
    }
    function noiseAvg() {
      let rem = cps;
      let acc = 0;
      let out = N.lfsr & 1 ? 0 : 1;
      const tap = N.mode ? 6 : 1;
      while (N.cnt <= rem) {
        acc += out * N.cnt;
        rem -= N.cnt;
        const fb = (N.lfsr ^ (N.lfsr >> tap)) & 1;
        N.lfsr = (N.lfsr >> 1) | (fb << 14);
        out = N.lfsr & 1 ? 0 : 1;
        N.cnt = N.per;
      }
      acc += out * rem;
      N.cnt -= rem;
      return (N.v * acc) / cps;
    }

    // console output filters, first order, at the integration rate
    const dt = 1 / RS;
    const hpA = (fc) => {
      const rc = 1 / (TAU * fc);
      return rc / (rc + dt);
    };
    const a1 = hpA(90);
    const a2 = hpA(440);
    const lrc = 1 / (TAU * 14000);
    const b3 = dt / (lrc + dt);
    let x1 = 0;
    let y1 = 0;
    let x2 = 0;
    let y2 = 0;
    let y3 = 0;
    let primed = false;

    let q = 0;
    let nextQ = 0;
    for (let s = 0; s < NS; s++) {
      while (s >= nextQ) {
        if ((q & 3) === 0) applyFrame(q >> 2);
        quarter(q);
        q++;
        nextQ = Math.round((q * RS) / (FPS * 4));
      }
      const ps = pulseAvg(P[0]) + pulseAvg(P[1]);
      const po = ps > 0 ? 95.88 / (8128 / ps + 100) : 0;
      const tn = triAvg() / 8227 + noiseAvg() / 12241;
      const to = tn > 0 ? 159.79 / (1 / tn + 100) : 0;
      const x = po + to;
      if (!primed) {
        x1 = x; // the console has been on: no step into the first sample
        primed = true;
      }
      y1 = a1 * (y1 + x - x1);
      x1 = x;
      y2 = a2 * (y2 + y1 - x2);
      x2 = y1;
      y3 += b3 * (y2 - y3);
      sub[s] = y3;
    }

    // decimate: windowed-sinc (Blackman) low-pass, zero phase, so timing is untouched
    const fc = Math.min(20000, 0.45 * sr) / RS;
    const h = new Float64Array(2 * HALF + 1);
    let hs = 0;
    for (let k = -HALF; k <= HALF; k++) {
      const x = k === 0 ? 2 * fc : Math.sin(TAU * fc * k) / (Math.PI * k);
      const w = 0.42 + 0.5 * Math.cos((Math.PI * k) / (HALF + 1)) + 0.08 * Math.cos((TAU * k) / (HALF + 1));
      h[k + HALF] = x * w;
      hs += x * w;
    }
    for (let k = 0; k < h.length; k++) h[k] *= GAIN / hs;
    const out = new Float32Array(nOut);
    for (let i = 0; i < nOut; i++) {
      const c = i * SUB;
      let acc = 0;
      const k0 = Math.max(-HALF, -c);
      for (let k = k0; k <= HALF; k++) acc += h[k + HALF] * sub[c + k];
      out[i] = acc;
    }
    return out;
  }

  const cache = {};
  FILM.audio = {
    render(ctx, opts) {
      const o = opts || {};
      const start = Math.max(0, Number(o.start) || 0);
      const dest = o.dest || ctx.destination;
      const base = ctx.currentTime;
      const sr = ctx.sampleRate;
      const data = cache[sr] || (cache[sr] = synth(sr));
      if (start >= data.length / sr) return;
      const buf = ctx.createBuffer(2, data.length, sr);
      buf.getChannelData(0).set(data);
      buf.getChannelData(1).set(data);
      const src = ctx.createBufferSource();
      src.buffer = buf;
      src.connect(dest);
      // A live context keeps running while the chip is emulated: start late by that much, on time.
      const late = Math.max(0, ctx.currentTime - base);
      src.start(base + late, start + late);
    },
  };
})();
