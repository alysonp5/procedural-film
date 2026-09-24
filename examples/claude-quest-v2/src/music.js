// music.js : the sound of CLAUDE QUEST (1986), a sound driver and an emulated NES 2A03 APU.
// Owner: audio. Contract: docs/v2-architecture.md sections 4.2 and 4.4; design notes: docs/sound.md.
//
// FILM.audio.render(ctx, { start = 0, dest = ctx.destination }) plays the whole film, music, effects and
// the TV foley, from global time `start` into any BaseAudioContext.
// FILM.audio.live(audioCtx, { dest }) runs the same driver and chip in real time for the playable mode.
//
// The sound is made the way a 1986 cartridge made it:
//   1 the driver   runs once per 60 Hz frame. It reads the frame's game events (FILM.game.events(): a
//                  `song` event starts a song, every other event starts a sound effect), advances the
//                  song sequencer one tick, lets an effect take over its channel for its length (the
//                  song's voice there keeps time silently and resumes on the frame the effect ends), and
//                  writes the result as APU register writes ($4000-$4017), keeping a shadow of the pulse
//                  high bytes so $4003/$4007 are only rewritten on a new note (no phase-reset clicks).
//   2 the APU      emulates the chip from those writes: two pulses (duty sequencer, envelope, sweep unit
//                  with its muting quirk, length counter), the triangle (linear counter, 32 steps), the
//                  noise LFSR (long and short mode, NTSC periods), and the DMC (1-bit delta playback of
//                  sample bytes from $C000 at the 16 NTSC rates). The drum samples are synthesised and
//                  delta-encoded below, the way a composer's tool would have packed them into the ROM.
//                  The channels are integrated exactly at 4x the output rate, mixed by the console's
//                  non-linear DAC formulas, filtered like the console output (high-pass 90 Hz and 440 Hz,
//                  low-pass 14 kHz) and decimated by a zero-phase windowed sinc.
//   3 the TV       src/foley.js (FILM.foley) turns the TV's speaker on and off with the picture and adds
//                  the set's own sounds (switch, degauss, static, flyback whine). The only non-NES sound.
//
// No reverb, delay, compressor or panning: the buffer is the chip times one flat gain (measured to
// -14 LUFS, true peak under -1 dBTP), mono in both channels. Deterministic: the only randomness is
// FILM.lib.rng with fixed seeds. The buffer is always computed from frame 0, so any `start` hears the
// same samples at the same global times.
(function () {
  'use strict';
  const root = typeof window !== 'undefined' ? window : globalThis;
  const FILM = root.FILM;
  const lib = FILM.lib;
  const TAU = Math.PI * 2;

  // ---------------------------------------------------------------- hardware constants
  const CPU = 1789773; // NTSC 2A03 clock, Hz
  const FPS = 60; // driver frames per second (the film's frame rate)
  const SUB = 4; // integration sub-samples per output sample
  const HALF = 23; // decimation filter half length, in sub-samples
  const GAIN = 2.87; // flat master gain, set by measurement (tools/audio/loudness.cjs): -14 LUFS
  const DUTY = [
    [0, 1, 0, 0, 0, 0, 0, 0], // 12.5 %
    [0, 1, 1, 0, 0, 0, 0, 0], // 25 %
    [0, 1, 1, 1, 1, 0, 0, 0], // 50 %
    [1, 0, 0, 1, 1, 1, 1, 1], // 25 % negated
  ];
  const TRI = [];
  for (let i = 15; i >= 0; i--) TRI.push(i);
  for (let i = 0; i <= 15; i++) TRI.push(i);
  const NOISE = [4, 8, 16, 32, 64, 96, 128, 160, 202, 254, 380, 508, 762, 1016, 2034, 4068];
  const DMC_RATE = [428, 380, 340, 320, 286, 254, 226, 214, 190, 160, 142, 128, 106, 84, 72, 54];
  const LENGTH = [10, 254, 20, 2, 40, 4, 80, 6, 160, 8, 60, 10, 14, 12, 26, 14, 12, 16, 24, 18, 48, 20, 96, 22, 192, 24, 72, 26, 16, 28, 32, 30];
  const DMC_LEVEL0 = 40; // $4011 as the game's reset code left it, long before the TV came on

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

  // ---------------------------------------------------------------- DMC samples (the ROM at $C000)
  // Each drum is synthesised at its playback rate and delta-encoded greedily (a 1 bit steps the 7-bit DAC
  // up by 2, a 0 steps it down by 2). Every sample holds as many 1s as 0s, so it returns the DAC to the
  // level it started from and the drums never drift the channel's DC level.
  const DMC_MEM = new Uint8Array(0x4000);
  const DMC = {}; // name -> { a: $4012 value, l: $4013 value, bytes }
  const dmcHz = (rate) => CPU / DMC_RATE[rate];
  function dmcEncode(wave) {
    const L0 = DMC_LEVEL0;
    const need = wave.length + 64; // the wave, then at least 64 bits to settle home
    const nBytes = Math.ceil((need / 8 - 1) / 16) * 16 + 1; // lengths are 16 n + 1 bytes
    const bits = nBytes * 8;
    const out = new Uint8Array(nBytes);
    let level = L0;
    for (let i = 0; i < bits; i++) {
      let bit;
      if (i < wave.length) {
        const target = L0 + wave[i];
        bit = level < target ? 1 : level > target ? 0 : i & 1;
      } else {
        const off = level - L0; // settle: walk home, then hover up-down so the last bit lands on L0
        bit = off < 0 ? 1 : off > 0 ? 0 : 1;
      }
      if (!bit && level < 2) bit = 1; // never ask for a step the DAC would clamp: the 1s and 0s stay paired
      else if (bit && level > 125) bit = 0;
      if (bit) {
        if (level <= 125) level += 2;
        out[i >> 3] |= 1 << (i & 7); // bits play LSB first
      } else if (level >= 2) level -= 2;
    }
    if (level !== L0) throw new Error('music.js: DMC sample does not return to its level');
    return out;
  }
  function dmcSynth(rate, seconds, fn) {
    const sr = dmcHz(rate);
    const n = Math.round(seconds * sr);
    const w = new Float64Array(n);
    let ph = 0;
    for (let i = 0; i < n; i++) {
      const t = i / sr;
      const r = fn(t, ph);
      w[i] = r.x;
      ph += (TAU * (r.hz || 0)) / sr;
    }
    return w;
  }
  (function buildDmc() {
    const noise = lib.rng('claude-quest-dmc');
    const kick = dmcSynth(15, 0.11, (t, ph) => {
      const env = t < 0.0008 ? t / 0.0008 : Math.exp(-(t - 0.0008) / 0.042);
      const click = t < 0.002 ? (noise() * 2 - 1) * 12 * (1 - t / 0.002) : 0;
      return { x: 28 * env * Math.sin(ph) + click, hz: 46 + 170 * Math.exp(-t / 0.016) };
    });
    const snare = dmcSynth(15, 0.13, (t, ph) => {
      const tone = 9 * Math.exp(-t / 0.028) * (Math.sin(ph) + 0.6 * Math.sin(ph * 1.78));
      const hiss = 17 * Math.exp(-t / 0.045) * (noise() * 2 - 1);
      return { x: tone + hiss, hz: 188 };
    });
    // Timpani: a membrane's inharmonic partials under a felt mallet. Tuned so rate 15 plays the root and
    // rate 14 (0.75x) the fifth below it: a tonic-dominant pair from one sample, as real carts did.
    const timp = (root) =>
      dmcSynth(15, 0.36, (t, ph) => {
        const env = t < 0.004 ? t / 0.004 : 1;
        const x = Math.sin(ph) * Math.exp(-t / 0.3) + 0.45 * Math.sin(ph * 1.5 + 0.3) * Math.exp(-t / 0.16) + 0.22 * Math.sin(ph * 1.98 + 1.1) * Math.exp(-t / 0.09);
        const mallet = t < 0.005 ? (noise() * 2 - 1) * 8 * (1 - t / 0.005) : 0;
        return { x: 24 * env * x + mallet, hz: root };
      });
    let addr = 0;
    for (const [name, wave] of [['kick', kick], ['snare', snare], ['timpD', timp(mhz('D3'))], ['timpC', timp(mhz('C3'))]]) {
      const bytes = dmcEncode(wave);
      DMC_MEM.set(bytes, addr);
      DMC[name] = { a: addr >> 6, l: (bytes.length - 1) >> 4, bytes: bytes.length };
      addr = Math.ceil((addr + bytes.length) / 64) * 64;
    }
    DMC.romBytes = addr;
  })();

  // ---------------------------------------------------------------- the APU
  // A register-level 2A03 sound unit. write(addr, value) as the CPU would; quarter(q) is the frame
  // counter's quarter-frame clock (4-step mode); fill(ring, s0, n) integrates n sub-samples.
  function makeApu(sr) {
    const RS = sr * SUB;
    const cps = CPU / RS; // CPU cycles per sub-sample
    const pulse = (i) => ({ i, duty: 0, halt: false, cv: true, vol: 0, envStart: false, envDiv: 0, decay: 0, swEn: false, swP: 0, swN: false, swS: 0, swDiv: 0, swReload: false, t: 0, per: 2, cnt: 2, pos: 0, len: 0, on: false, mute: true });
    const P = [pulse(0), pulse(1)];
    const T = { ctrl: false, linR: 0, lin: 0, linFlag: false, t: 0, cnt: 1, pos: 0, len: 0, on: false };
    const N = { halt: false, cv: true, vol: 0, envStart: false, envDiv: 0, decay: 0, mode: 0, per: 4, cnt: 4, lfsr: 1, len: 0, on: false };
    const D = { loop: false, rate: DMC_RATE[0], cnt: DMC_RATE[0], level: DMC_LEVEL0, addr: 0xc000, length: 1, cur: 0xc000, left: 0, buf: -1, shift: 0, bits: 8, silent: true, on: false };

    const target = (c) => {
      const ch = c.t >> c.swS;
      return c.swN ? c.t - ch - (c.i === 0 ? 1 : 0) : c.t + ch;
    };
    const remute = (c) => {
      c.mute = c.t < 8 || (!c.swN && target(c) > 0x7ff);
      c.per = 2 * (c.t + 1);
    };
    function dmcFetch() {
      if (D.buf < 0 && D.left > 0) {
        D.buf = DMC_MEM[D.cur - 0xc000];
        D.cur = D.cur === 0xffff ? 0x8000 : D.cur + 1;
        D.left--;
        if (D.left === 0 && D.loop) {
          D.cur = D.addr;
          D.left = D.length;
        }
      }
    }
    function write(a, v) {
      if (a < 0x4008) {
        const c = P[(a - 0x4000) >> 2];
        switch (a & 3) {
          case 0:
            c.duty = v >> 6;
            c.halt = !!(v & 0x20);
            c.cv = !!(v & 0x10);
            c.vol = v & 15;
            break;
          case 1:
            c.swEn = !!(v & 0x80);
            c.swP = (v >> 4) & 7;
            c.swN = !!(v & 8);
            c.swS = v & 7;
            c.swReload = true;
            remute(c);
            break;
          case 2:
            c.t = (c.t & 0x700) | v;
            remute(c);
            break;
          default:
            c.t = (c.t & 0xff) | ((v & 7) << 8);
            if (c.on) c.len = LENGTH[v >> 3];
            c.pos = 0; // $4003 restarts the duty sequencer: the phase reset drivers avoid mid-note
            c.envStart = true;
            remute(c);
        }
        return;
      }
      switch (a) {
        case 0x4008:
          T.ctrl = !!(v & 0x80);
          T.linR = v & 0x7f;
          break;
        case 0x400a:
          T.t = (T.t & 0x700) | v;
          break;
        case 0x400b:
          T.t = (T.t & 0xff) | ((v & 7) << 8);
          if (T.on) T.len = LENGTH[v >> 3];
          T.linFlag = true;
          break;
        case 0x400c:
          N.halt = !!(v & 0x20);
          N.cv = !!(v & 0x10);
          N.vol = v & 15;
          break;
        case 0x400e:
          N.mode = v >> 7;
          N.per = NOISE[v & 15];
          break;
        case 0x400f:
          if (N.on) N.len = LENGTH[v >> 3];
          N.envStart = true;
          break;
        case 0x4010:
          D.loop = !!(v & 0x40);
          D.rate = DMC_RATE[v & 15];
          break;
        case 0x4011:
          D.level = v & 0x7f;
          break;
        case 0x4012:
          D.addr = 0xc000 + v * 64;
          break;
        case 0x4013:
          D.length = v * 16 + 1;
          break;
        case 0x4015:
          P[0].on = !!(v & 1);
          P[1].on = !!(v & 2);
          T.on = !!(v & 4);
          N.on = !!(v & 8);
          if (!P[0].on) P[0].len = 0;
          if (!P[1].on) P[1].len = 0;
          if (!T.on) T.len = 0;
          if (!N.on) N.len = 0;
          if (v & 0x10) {
            if (D.left === 0) {
              D.cur = D.addr;
              D.left = D.length;
            }
            dmcFetch();
          } else D.left = 0;
          break;
        default:
      }
    }
    function env(c) {
      if (c.envStart) {
        c.envStart = false;
        c.decay = 15;
        c.envDiv = c.vol;
      } else if (c.envDiv === 0) {
        c.envDiv = c.vol;
        if (c.decay > 0) c.decay--;
        else if (c.halt) c.decay = 15;
      } else c.envDiv--;
    }
    function quarter(q) {
      env(P[0]);
      env(P[1]);
      env(N);
      if (T.linFlag) T.lin = T.linR;
      else if (T.lin > 0) T.lin--;
      if (!T.ctrl) T.linFlag = false;
      if (q & 1) {
        for (const c of P) {
          if (c.len > 0 && !c.halt) c.len--;
          if (c.swDiv === 0 && c.swEn && c.swS > 0 && !c.mute) {
            c.t = Math.max(0, target(c));
            remute(c);
          }
          if (c.swDiv === 0 || c.swReload) {
            c.swDiv = c.swP;
            c.swReload = false;
          } else c.swDiv--;
        }
        if (T.len > 0 && !T.ctrl) T.len--;
        if (N.len > 0 && !N.halt) N.len--;
      }
    }

    // Between two boundaries (a driver frame's register writes, a frame-counter clock) every channel's
    // parameters are constant, so each channel runs as its own tight loop over the stretch, then one loop
    // mixes and filters. Each channel's output is integrated exactly over every sub-sample.
    const QMAX = Math.ceil(RS / (FPS * 4)) + 2; // the longest stretch: one quarter frame
    const sp = new Float64Array(QMAX); // pulse 1 + pulse 2
    const stn = new Float64Array(QMAX); // triangle / 8227 + noise / 12241 + DMC / 22638
    function runPulse(c, n) {
      if (c.mute) return; // silenced by the sweep unit's muting: the timer's phase is not modelled
      const lvl = c.len > 0 ? (c.cv ? c.vol : c.decay) : 0;
      const seq = DUTY[c.duty];
      const per = c.per;
      const scale = lvl / cps;
      let cnt = c.cnt;
      let pos = c.pos;
      for (let i = 0; i < n; i++) {
        let rem = cps;
        let acc = 0;
        let o = seq[pos];
        while (cnt <= rem) {
          acc += o * cnt;
          rem -= cnt;
          pos = (pos + 1) & 7;
          o = seq[pos];
          cnt = per;
        }
        acc += o * rem;
        cnt -= rem;
        sp[i] += acc * scale;
      }
      c.cnt = cnt;
      c.pos = pos;
    }
    function runTri(n) {
      if (T.lin === 0 || T.len === 0 || T.t < 2) {
        const v = TRI[T.pos] / 8227; // halted: the sequencer holds its step
        for (let i = 0; i < n; i++) stn[i] += v;
        return;
      }
      const per = T.t + 1;
      const scale = 1 / (cps * 8227);
      let cnt = T.cnt;
      let pos = T.pos;
      for (let i = 0; i < n; i++) {
        let rem = cps;
        let acc = 0;
        let o = TRI[pos];
        while (cnt <= rem) {
          acc += o * cnt;
          rem -= cnt;
          pos = (pos + 1) & 31;
          o = TRI[pos];
          cnt = per;
        }
        acc += o * rem;
        cnt -= rem;
        stn[i] += acc * scale;
      }
      T.cnt = cnt;
      T.pos = pos;
    }
    function runNoise(n) {
      const lvl = N.len > 0 ? (N.cv ? N.vol : N.decay) : 0;
      if (lvl === 0) return; // silent: the shift register is not clocked
      const per = N.per;
      const tap = N.mode ? 6 : 1;
      const scale = lvl / (cps * 12241);
      let cnt = N.cnt;
      let lfsr = N.lfsr;
      for (let i = 0; i < n; i++) {
        let rem = cps;
        let acc = 0;
        let o = lfsr & 1 ? 0 : 1;
        while (cnt <= rem) {
          acc += o * cnt;
          rem -= cnt;
          lfsr = (lfsr >> 1) | (((lfsr ^ (lfsr >> tap)) & 1) << 14);
          o = lfsr & 1 ? 0 : 1;
          cnt = per;
        }
        acc += o * rem;
        cnt -= rem;
        stn[i] += acc * scale;
      }
      N.cnt = cnt;
      N.lfsr = lfsr;
    }
    function runDmc(n) {
      const scale = 1 / (cps * 22638);
      for (let i = 0; i < n; i++) {
        let rem = cps;
        let acc = 0;
        while (D.cnt <= rem) {
          acc += D.level * D.cnt;
          rem -= D.cnt;
          if (!D.silent) {
            if (D.shift & 1) {
              if (D.level <= 125) D.level += 2;
            } else if (D.level >= 2) D.level -= 2;
          }
          D.shift >>= 1;
          if (--D.bits === 0) {
            D.bits = 8;
            if (D.buf < 0) D.silent = true;
            else {
              D.silent = false;
              D.shift = D.buf;
              D.buf = -1;
              dmcFetch();
            }
          }
          D.cnt = D.rate;
        }
        acc += D.level * rem;
        D.cnt -= rem;
        stn[i] += acc * scale;
      }
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
    const F = { x1: 0, y1: 0, x2: 0, y2: 0, y3: 0, primed: false };
    function fill(ring, s0, n) {
      sp.fill(0, 0, n);
      stn.fill(0, 0, n);
      runPulse(P[0], n);
      runPulse(P[1], n);
      runTri(n);
      runNoise(n);
      runDmc(n);
      let { x1, y1, x2, y2, y3 } = F;
      if (!F.primed) {
        const ps = sp[0];
        const tn = stn[0];
        x1 = (ps > 0 ? 95.88 / (8128 / ps + 100) : 0) + (tn > 0 ? 159.79 / (1 / tn + 100) : 0); // the console has been on for a while: no step into the first sample
        F.primed = true;
      }
      for (let i = 0; i < n; i++) {
        const ps = sp[i];
        const tn = stn[i];
        const x = (ps > 0 ? 95.88 / (8128 / ps + 100) : 0) + (tn > 0 ? 159.79 / (1 / tn + 100) : 0);
        y1 = a1 * (y1 + x - x1);
        x1 = x;
        y2 = a2 * (y2 + y1 - x2);
        x2 = y1;
        y3 += b3 * (y2 - y3);
        ring[(s0 + i) & 2047] = y3;
      }
      Object.assign(F, { x1, y1, x2, y2, y3 });
    }
    return { write, quarter, fill, RS };
  }

  // The decimation filter: a Blackman-windowed sinc, zero phase, unity gain at DC.
  const firCache = {};
  function fir(sr) {
    if (firCache[sr]) return firCache[sr];
    const RS = sr * SUB;
    const fc = Math.min(20000, 0.45 * sr) / RS;
    const h = new Float64Array(2 * HALF + 1);
    let hs = 0;
    for (let k = -HALF; k <= HALF; k++) {
      const x = k === 0 ? 2 * fc : Math.sin(TAU * fc * k) / (Math.PI * k);
      const w = 0.42 + 0.5 * Math.cos((Math.PI * k) / (HALF + 1)) + 0.08 * Math.cos((TAU * k) / (HALF + 1));
      h[k + HALF] = x * w;
      hs += x * w;
    }
    for (let k = 0; k < h.length; k++) h[k] /= hs;
    return (firCache[sr] = h);
  }

  // The engine: the driver (feed) and the APU on one sample clock. feed(f) returns frame f's register
  // writes as a flat [addr, value, addr, value, ...] list; out(j) returns output sample j. Output j is
  // centred on sub-sample 4 j, so it waits for 23 sub-samples past it: a live stream lags 6 samples.
  // The ring holds 2048 sub-samples: the 47-tap span plus up to 1047 generated ahead.
  function makeEngine(sr, feed) {
    const apu = makeApu(sr);
    const RS = apu.RS;
    const h = fir(sr);
    const RING = 2048; // sub-samples kept: the filter's span plus the chunk generated ahead
    const ring = new Float32Array(RING);
    let s = 0;
    let f = 0;
    let fAt = 0;
    let q = 0;
    let qAt = 0;
    function genTo(end) {
      while (s < end) {
        if (s === fAt) {
          const w = feed(f);
          for (let i = 0; i < w.length; i += 2) apu.write(w[i], w[i + 1]);
          f++;
          fAt = Math.round((f * RS) / FPS);
        }
        if (s === qAt) {
          apu.quarter(q);
          q++;
          qAt = Math.round((q * RS) / (FPS * 4));
        }
        const stop = Math.min(end, fAt, qAt);
        apu.fill(ring, s, stop - s);
        s = stop;
      }
    }
    // chunks of 1024 sub-samples: the register writes still land on their exact sub-sample
    function out(j) {
      const c = j * SUB;
      if (s < c + HALF + 1) genTo(c + HALF + 1 + 1024);
      let acc = h[HALF] * ring[c & 2047];
      for (let k = 1; k <= HALF; k++) acc += h[HALF + k] * (ring[(c + k) & 2047] + ring[(c - k) & 2047]);
      return acc;
    }
    return { out, frame: () => f };
  }

  // ---------------------------------------------------------------- instruments (music voices)
  // A pulse instrument maps (frame k of a note, note length in frames, midi) to a voice state { v, d, t }
  // or null (silent). env: the first frames' volumes; then `sus`, falling by 1 every `fall` frames to
  // `floor` (fall 0 holds). duty: a per-frame duty list whose last entry holds. vib: [delay frames,
  // depth cents, period frames]. gate(len): frames sounded; by default a note of 3+ frames drops its
  // last frame so repeated notes articulate, the way the drivers of the day did.
  function pulseInst(o) {
    return {
      frame(k, len, m) {
        const gate = o.gate ? o.gate(len) : len >= 3 ? len - 1 : len;
        if (k >= gate) return null;
        let v;
        if (k < o.env.length) v = o.env[k];
        else if (o.fall) v = Math.max(o.floor || 0, o.sus - Math.floor((k - o.env.length) / o.fall));
        else v = o.sus;
        let hz = mhz(m);
        if (o.vib && k >= o.vib[0]) hz *= Math.pow(2, (o.vib[1] / 1200) * Math.sin((TAU * (k - o.vib[0])) / o.vib[2]));
        return { v, d: o.duty[Math.min(k, o.duty.length - 1)], t: ptimer(hz) };
      },
    };
  }
  function triInst(gateOf, vib) {
    return {
      frame(k, len, m) {
        if (k >= Math.max(1, Math.min(len, gateOf(len)))) return null;
        let hz = mhz(m);
        if (vib && k >= vib[0]) hz *= Math.pow(2, (vib[1] / 1200) * Math.sin((TAU * (k - vib[0])) / vib[2]));
        return { t: ttimer(hz) };
      },
    };
  }
  const INST = {
    lead: pulseInst({ duty: [1, 2], env: [13, 12, 11, 10], sus: 9, fall: 10, floor: 6, vib: [20, 9, 6] }),
    leadHi: pulseInst({ duty: [1], env: [11, 11, 10, 9], sus: 8, fall: 8, floor: 5, vib: [16, 8, 5] }),
    star: pulseInst({ duty: [2, 1], env: [13, 12, 11], sus: 10, fall: 6, floor: 6 }),
    harm: pulseInst({ duty: [1], env: [9, 8, 8, 7], sus: 6, fall: 10, floor: 4 }),
    stab: pulseInst({ duty: [1], env: [9, 8, 6, 4, 3, 2, 1], sus: 0 }),
    shim: pulseInst({ duty: [0], env: [8, 7, 5, 4], sus: 3 }),
    cave: pulseInst({ duty: [2], env: [14, 13, 11, 9, 7, 5, 3, 2], sus: 1 }),
    echo: pulseInst({ duty: [0], env: [7, 7, 6, 5, 4, 3, 2, 1], sus: 0 }),
    brass: pulseInst({ duty: [2], env: [12, 11, 10, 10, 9], sus: 8, fall: 12, floor: 6, vib: [14, 12, 6] }),
    brass2: pulseInst({ duty: [1], env: [8, 8, 7, 7, 6], sus: 6, fall: 12, floor: 4 }),
    // the fanfare's last chord: it dies away inside its own note, so the fanfare ends complete
    brassEnd: pulseInst({ duty: [2], env: [12, 11, 10, 10, 9, 9, 8, 8, 7, 7, 6, 6, 5, 5, 4, 4, 3, 3, 3, 2, 2, 2, 1, 1, 1], sus: 0, vib: [10, 10, 6], gate: (len) => len }),
    brass2End: pulseInst({ duty: [1], env: [8, 8, 7, 7, 6, 6, 5, 5, 4, 4, 4, 3, 3, 3, 2, 2, 2, 1, 1, 1], sus: 0, gate: (len) => len }),
    pedal: pulseInst({ duty: [1], env: [3, 4, 5, 5], sus: 5, fall: 0, vib: [8, 10, 11], gate: (len) => len }),
    dim: pulseInst({ duty: [0], env: [7, 6, 4, 3, 2], sus: 1 }),
    sing: pulseInst({ duty: [2], env: [7, 9, 10, 11, 11, 10], sus: 10, fall: 18, floor: 6, vib: [18, 14, 7], gate: (len) => len - 1 }),
    soft: pulseInst({ duty: [0], env: [7, 6, 6, 5], sus: 5, fall: 14, floor: 3 }),
    // the ending's last chord: it sings, then sinks slowly to a whisper and holds there
    singEnd: pulseInst({ duty: [2], env: [9, 10, 11, 11, 10], sus: 10, fall: 40, floor: 3, vib: [18, 14, 7], gate: (len) => len }),
    softEnd: pulseInst({ duty: [0], env: [7, 6, 6, 5], sus: 5, fall: 60, floor: 2, gate: (len) => len }),
    bass: triInst((len) => Math.max(3, Math.round(len * 0.7))),
    hold: triInst((len) => len - 1),
    ring: triInst((len) => len),
  };
  // Noise drums: [period index, volume, short mode] per frame. DMC drums: a sample at a rate.
  const NDRUM = {
    h: [[1, 6], [1, 3], [1, 1]],
    o: [[1, 7], [1, 6], [1, 5], [1, 4], [1, 3], [1, 2], [1, 2], [1, 1]],
    c: [[4, 6, 1], [4, 2, 1]],
    x: Array.from({ length: 30 }, (_, k) => [3, Math.max(1, Math.round(11 - k / 3))]),
  };
  const DDRUM = {
    K: { dmc: 'kick', rate: 15 },
    S: { dmc: 'snare', rate: 15 },
    L: { dmc: 'kick', rate: 13 }, // the kick slowed down: a deep boom
    D: { dmc: 'timpD', rate: 15 }, // D3
    A: { dmc: 'timpD', rate: 14 }, // A2, the fifth below
    C: { dmc: 'timpC', rate: 15 }, // C3
    G: { dmc: 'timpC', rate: 14 }, // G2
  };

  // ---------------------------------------------------------------- the notation
  // One string per channel, one token per event, lengths in rows (16ths): `F#5:3` a note, `r:2` a rest,
  // `-:2` ties onto the note before, `@lead` picks the instrument, `T+12` transposes, `[ ... ]4` repeats,
  // `|` marks where the song loops back to. Noise tokens are NDRUM keys, DMC tokens DDRUM keys.
  function tokens(str) {
    let s = str;
    const re = /\[([^[\]]*)\](\d+)/;
    while (re.test(s)) s = s.replace(re, (_, body, n) => Array(Number(n)).fill(body).join(' '));
    return s.trim().split(/\s+/).filter(Boolean);
  }
  function channel(str, kind, name) {
    let inst = kind === 't' ? INST.bass : INST.lead;
    let tr = 0;
    let row = 0;
    let loop = null;
    const notes = [];
    for (const tok of tokens(str)) {
      if (tok === '|') {
        loop = row;
        continue;
      }
      if (tok[0] === '@') {
        inst = INST[tok.slice(1)];
        if (!inst) throw new Error(`music.js: ${name}: no instrument ${tok}`);
        continue;
      }
      if (/^T[+-]?\d+$/.test(tok)) {
        tr = Number(tok.slice(1));
        continue;
      }
      const [a, b] = tok.split(':');
      const n = b ? Number(b) : 1;
      if (!(n > 0)) throw new Error(`music.js: ${name}: bad length in ${tok}`);
      if (a === 'r') {
        row += n;
        continue;
      }
      if (a === '-') {
        const last = notes[notes.length - 1];
        if (!last || last.r1 !== row) throw new Error(`music.js: ${name}: tie with no note before it`);
        last.r1 += n;
        row += n;
        continue;
      }
      let ins = inst;
      let m = 0;
      if (kind === 'n') ins = NDRUM[a] && { rows: NDRUM[a] };
      else if (kind === 'd') ins = DDRUM[a];
      else m = midi(a) + tr;
      if (!ins) throw new Error(`music.js: ${name}: unknown token ${tok}`);
      notes.push({ r0: row, r1: row + n, m, inst: ins });
      row += n;
    }
    return { notes, rows: row, loop };
  }
  const CHANS = ['p1', 'p2', 't', 'n', 'd'];
  function compile(id, def) {
    const out = { id, speed: def.speed, ch: {} };
    let rows = null;
    let loop;
    for (const ch of CHANS) {
      if (def[ch] == null) continue;
      const c = channel(def[ch], ch === 'p1' || ch === 'p2' ? 'p' : ch, `${id}.${ch}`);
      if (rows === null) {
        rows = c.rows;
        loop = c.loop;
      } else if (c.rows !== rows || c.loop !== loop) {
        throw new Error(`music.js: ${id}.${ch} is ${c.rows} rows looping at ${c.loop}; the song is ${rows} rows looping at ${loop}`);
      }
      out.ch[ch] = c.notes.map((nt) => ({ f0: nt.r0 * def.speed, f1: nt.r1 * def.speed, m: nt.m, inst: nt.inst }));
    }
    for (const ch of CHANS) out.ch[ch] = out.ch[ch] || [];
    out.rows = rows;
    out.sections = {};
    for (const k of Object.keys(def.sections || {})) out.sections[k] = def.sections[k] * def.speed;
    out.L = rows * def.speed;
    out.LF = def.loop === false ? null : (loop || 0) * def.speed;
    return out;
  }
  // The song's voice on each channel at song frame sf: a pulse { v, d, t }, a triangle { t }, a noise
  // { v, i, m }, a DMC trigger { dmc, rate }, or null; `trig` on a note's first frame.
  function voiceAt(song, ch, sf) {
    if (sf >= song.L) {
      if (song.LF == null) return null;
      sf = song.LF + ((sf - song.LF) % (song.L - song.LF));
    }
    const list = song.ch[ch];
    let lo = 0;
    let hi = list.length - 1;
    let at = -1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (list[mid].f0 <= sf) {
        at = mid;
        lo = mid + 1;
      } else hi = mid - 1;
    }
    if (at < 0) return null;
    const nt = list[at];
    if (sf >= nt.f1) return null;
    const k = sf - nt.f0;
    if (ch === 'd') return k === 0 ? nt.inst : null;
    let st;
    if (ch === 'n') {
      const r = nt.inst.rows[k];
      st = r ? { v: r[1], i: r[0], m: r[2] || 0 } : null;
    } else st = nt.inst.frame(k, nt.f1 - nt.f0, nt.m);
    if (st && k === 0) st.trig = true;
    return st;
  }

  // ---------------------------------------------------------------- the score
  // Original music, written for this film in the idiom of 1985-88 console platformers. Keys: the
  // overworld, title, star-free sections and the ending share D major so the hook can come home.
  const NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
  const nn = (m) => NAMES[((m % 12) + 12) % 12] + (Math.floor(m / 12) - 1);
  const CHORD = {
    D: [[2, 6, 9], 50],
    Bm: [[11, 2, 6], 47],
    G: [[7, 11, 2], 43],
    Gmaj7: [[7, 11, 2, 6], 43],
    Gm: [[7, 10, 2], 43],
    A: [[9, 1, 4], 45],
    A7: [[9, 1, 4, 7], 45],
    'F#m': [[6, 9, 1], 42],
    Em: [[4, 7, 11], 40],
    Em7: [[4, 7, 11, 2], 40],
  };
  const halves = (bar) => {
    const h = bar.split(' ');
    return [h[0], h[h.length - 1]];
  };
  // The bouncing bass: root, root, octave, fifth, and a chromatic step up into the next bar's root.
  function bassLine(chords) {
    return chords
      .map((bar, i) => {
        const [c1, c2] = halves(bar);
        const r1 = CHORD[c1][1];
        const r2 = CHORD[c2][1];
        const next = CHORD[halves(chords[(i + 1) % chords.length])[0]][1];
        const x = next !== r2 ? next - 1 : r2 + 7;
        return c1 === c2
          ? `${nn(r1)}:3 ${nn(r1)} ${nn(r1 + 12)}:2 ${nn(r1)}:2 ${nn(r1 + 7)}:3 ${nn(r1 + 7)} ${nn(r1 + 12)}:2 ${nn(x)}:2`
          : `${nn(r1)}:3 ${nn(r1)} ${nn(r1 + 12)}:2 ${nn(r1 + 7)}:2 ${nn(r2)}:3 ${nn(r2)} ${nn(r2 + 12)}:2 ${nn(x)}:2`;
      })
      .join(' ');
  }
  // Off-beat comping on pulse 2: "chk-a chk" on the and of each beat, the chord's third over its fifth,
  // voiced between D4 and C#5.
  function voice(pc, lo) {
    let m = lo;
    while (((m % 12) + 12) % 12 !== pc) m++;
    return nn(m);
  }
  function comp(chords) {
    return chords
      .map((bar) =>
        halves(bar)
          .map((c) => {
            const [pcs] = CHORD[c];
            const t = voice(pcs[1], 62);
            const f = voice(pcs[2], 62);
            return `r:2 ${t} ${f} r:2 ${t}:2`;
          })
          .join(' ')
      )
      .join(' ');
  }
  // Harmony under a lead: for each note, the nearest chord tone at least a minor third below it.
  function under(lead, chords) {
    return lead
      .map((bar, b) => {
        const [c1, c2] = halves(chords[b]);
        let p = 0;
        return tokens(bar)
          .map((tok) => {
            const [a, l] = tok.split(':');
            const n = l ? Number(l) : 1;
            const pcs = CHORD[p < 8 ? c1 : c2][0];
            p += n;
            if (a === 'r') return tok;
            let h = midi(a) - 3;
            while (!pcs.includes(((h % 12) + 12) % 12)) h--;
            return `${nn(h)}${l ? ':' + l : ''}`;
          })
          .join(' ');
      })
      .join(' ');
  }
  const bars = (list) => list.join(' ');

  // The hook. Bar 1 is the tune people hum: D  F#-A(held across the beat)  F#  B(held)-A  F#  E.
  const HOOK = [
    'D5:2 F#5 A5:3 F#5:2 B5:3 A5 F#5:2 E5:2', // D
    'D5:3 C#5 B4:4 r:2 A4 B4 D5:2 E5:2', // Bm
    'F#5:2 G5 A5:3 G5:2 F#5:2 E5 D5 E5:2 G5:2', // G
    'A5:6 r:2 E5 F#5 E5:2 C#5:2 A4:2', // A
  ];
  const OW = {
    lead: HOOK.concat([
      HOOK[0], // D
      'D5:3 C#5 B4:4 r:2 B4 C#5 D5:2 F#5:2', // Bm
      'G5:2 A5 B5:3 A5:2 G5:2 F#5 E5:3 C#5:2', // G | A
      'D5:2 r A4 D5:2 r:2 F#5 r A5:2 r:4', // D
      'B5:4 A5:2 G5:2 D5:4 E5:2 G5:2', // G
      'A5:3 G5 F#5:2 E5:2 C#5:6 r:2', // A
      'A5:4 F#5:2 C#5:2 E5:4 F#5:2 A5:2', // F#m
      'B5:3 A5 F#5:2 D5:2 B4:6 r:2', // Bm
      'D6:4 B5:2 G5:2 A5:3 B5 A5:2 G5:2', // G
      'F#5:2 E5:2 C#5:2 A4:2 B4:2 C#5:2 E5:2 G5:2', // A
      'F#5:3 E5 D5:2 E5:2 G5:3 F#5 E5:2 C#5:2', // Em7 | A7
      'A5:2 r:2 A5 r A5:2 r:4 E5 F#5 E5 C#5', // A, stop-time
    ]),
    chords: ['D', 'Bm', 'G', 'A', 'D', 'Bm', 'G A', 'D', 'G', 'A', 'F#m', 'Bm', 'G', 'A', 'Em7 A7', 'A'],
  };
  const CAVE = ['E3 r r B3 r r D4 r C4 r r G3 r A3 r r', 'E3 r r B3 r r F4 r E4 r r D4 r B3 r r', 'A3 r r E4 r r G4 r F4 r r C4 r D4 r r', 'B3 r r F4 r r E4 r D#4 r r B3 r A#3 r r'];
  const GROOVE = 'K:4 S:2 K:2 K:4 S:4';
  const HATS = 'h:2 h:2 h:2 h:2 h:2 h:2 o:2 h:2';
  const SONG_DEFS = {
    title: {
      speed: 6,
      p1: '@leadHi ' + bars([HOOK[0], 'G5:2 B5 D6:3 B5:2 E6:3 D6 B5:2 A5:2', 'G5:2 F#5 E5:3 G5:2 F#5:4 E5:2 C#5:2', 'D5:2 r:2 A4 D5 F#5 A5 D6:4 r:4']),
      p2: '@stab ' + comp(['D', 'G', 'Em A', 'D']),
      t: '@bass ' + bassLine(['D', 'G', 'Em A', 'D']),
      n: `[${HATS}]4`,
      d: `[K:4 S:4 K:4 S:4]3 K:4 S:4 K:2 S S S:4`,
    },
    // speed 6: the 8-bar hook period (A + A') completes in 768 frames. Sections (song.section): 'intro'
    // from the top, 'A' the hook, 'B' the bridge; the loop returns to the hook.
    overworld: {
      speed: 6,
      sections: { intro: 0, A: 8, B: 136 },
      p1: '@lead D6 r A5 r F#5 A4 B4 C#5 | ' + bars(OW.lead),
      p2: '@stab r:2 F#4 A4 r:2 F#4:2 | ' + comp(OW.chords.slice(0, 8)) + ' @harm ' + under(OW.lead.slice(8, 15), OW.chords.slice(8, 15)) + ' @stab C#5:2 r:2 C#5 r C#5:2 r:8',
      t: '@bass D3:3 D3 D4:2 C#3:2 | ' + bassLine(OW.chords.slice(0, 15)) + ' A2:2 r:2 A2 r A2:2 r:2 E2:2 A2 B2 C#3:2',
      n: `[h:2]4 | [${HATS}]7 h:2 h:2 h:2 h:2 o:2 o:2 o:2 o:2 [${HATS}]7 x:16`,
      d: `K:2 S:2 S S S S | [${GROOVE}]7 K:4 S:2 K:2 S:2 S:2 S S S S [${GROOVE}]7 K:4 K:2 K:4 S S S S S S`,
    },
    underground: {
      speed: 8,
      // a staccato riff in E with a phrygian F and a tritone turn home; the triangle doubles it low
      p1: '@cave T+12 ' + bars(CAVE),
      // the driver's echo: the riff again three rows late, an octave up and quiet
      p2: '@echo T+24 r:3 ' + bars(CAVE.slice(0, 3).concat([CAVE[3].split(' ').slice(0, 13).join(' ')])),
      t: '@bass ' + bars(CAVE),
      n: '[r:6 c r:5 c r:3]4',
      d: 'L:16 r:16 L:16 r:16',
    },
    star: {
      speed: 5,
      p1: '@star ' + bars(['E6:2 C#6 A5 E6:2 F#6 E6 r:2 C#6:2 A5 B5 C#6 E6', 'D6:2 B5 G5 D6:2 E6 D6 r:2 B5:2 G5 A5 B5 D6', 'A5:2 F#5 D5 A5:2 B5 A5 r:2 F#6:2 E6 D6 C#6 B5', 'B5:2 G#5 E5 B5:2 C#6 B5 r:2 E6 D6 C#6 B5 G#5 B5']),
      p2: '@shim [A4 C#5 E5 C#5]4 [G4 B4 D5 B4]4 [F#4 A4 D5 A4]4 [G#4 B4 E5 B4]4',
      t: '@bass [A2:2 A3:2]4 [G2:2 G3:2]4 [D3:2 D2:2]4 [E2:2 E3:2]4',
      n: '[h h o:2]16',
      d: '[K:4 S:4 K:2 K:2 S:4]4',
    },
    // exactly 168 frames (42 rows of 4), and complete: the last chord dies away inside its own note
    flag: {
      speed: 4,
      loop: false,
      p1: '@brass D5 r F#5 r A5:3 D6 r:2 A5 D6 F#6:4 G6:3 F#6 E6:2 D6:2 E6:3 F#6 G6:2 A6:2 F#6 D6 A5 @brassEnd D6:7',
      p2: '@brass2 A4 r D5 r F#5:3 A5 r:2 F#5 A5 D6:4 D6:3 D6 C#6:2 B5:2 C#6:3 D6 E6:2 E6:2 D6 A5 F#5 @brass2End A5:7',
      t: '@hold D3:6 A2:2 D3:8 G2:8 A2:8 A2:2 D3:6 r:2',
      n: '[h:2]16 x:10',
      d: 'K:4 S:4 K:4 S:4 K:4 S:4 K:4 S S S S D:10',
    },
    castle: {
      speed: 6,
      p1: '@pedal C5:16 | @brass G5:12 Ab5:4 G5:8 F#5:8 F5:12 Eb5:4 D5:8 B4:8', // a quiet pedal under the intro
      p2: '@dim r:16 | [C5 Eb5 F#5 Eb5]8 [B4 D5 F5 D5]4 [B4 D5 F5 Ab5]4',
      t: '@bass C3:2 C3:2 Eb3:2 C3:2 F#3:2 G3:2 Eb3:2 D3:2 | [C3:2 C3:2 Eb3:2 C3:2 F#3:2 G3:2 Eb3:2 D3:2]4',
      n: '[r:2 c:2]4 | [r:2 c:2]16',
      d: 'C:8 G:8 | [C:8 G:8]4',
    },
    // two bars (288 frames): Claw'd runs to Pearl in bar 1, they meet in bar 2 and the phrase comes home
    // to the tonic; it loops if the ending is later
    rescue: {
      speed: 9,
      p1: '@sing B5:6 A5:2 G5:4 F#5:2 E5:2 A5:4 G5:2 E5:2 D5:8',
      p2: '@soft G4:2 B4:2 D5:2 B4:2 E4:2 G4:2 B4:2 G4:2 A4:2 C#5:2 E5:2 G5:2 F#4:2 A4:2 D5:4',
      t: '@hold G2:8 E2:8 A2:8 D3:8',
      n: 'r:32',
      d: 'r:24 D:8',
    },
    // the film's ending: a tag. The hook's first bar, a turn through G minor, and the tonic lands on frame
    // 192 and rings into the power-off, which the game places 256+ frames after the tag starts: the chord
    // sinks to a whisper and holds for 16 s (to frame 1152), so no power-off time leaves dead air.
    ending: {
      speed: 8,
      loop: false,
      p1: '@sing ' + HOOK[0] + ' G5:3 A#5:3 A5:2 @singEnd D5:120',
      p2: '@soft ' + under([HOOK[0]], ['D']) + ' D5:3 D5:3 C#5:2 @softEnd F#4:120',
      t: '@hold D3:16 G2:6 A2:2 @ring D3:40 r:80',
      n: 'r:144',
      d: 'D:16 r:8 D:120',
    },
    // the long ending, eight bars that loop: for the playable mode, where nothing turns the set off
    'ending-full': {
      speed: 9,
      p1: '@sing ' + bars(HOOK.concat([HOOK[0], 'D5:3 E5 G5:4 r:2 G5 A5 B5:2 A5:2', 'G5:4 A#5:4 A5:4 G5:2 E5:2', 'D5:12 r:4'])),
      p2: '@soft ' + under(HOOK.concat([HOOK[0], 'D5:3 E5 G5:4 r:2 G5 A5 B5:2 A5:2', 'G5:4 A#5:4 A5:4 G5:2 E5:2', 'D5:12 r:4']), ['D', 'Bm', 'Gmaj7', 'A', 'D', 'G', 'Gm', 'D']),
      t: '@hold D3:16 B2:16 G2:16 A2:16 F#2:16 G2:16 G2:16 D3:16',
      n: 'r:128',
      d: 'D:16 r:96 D:16',
    },
  };
  const SONGS = {};
  for (const id of Object.keys(SONG_DEFS)) SONGS[id] = compile(id, SONG_DEFS[id]);

  // ---------------------------------------------------------------- effects (per-frame programs)
  // An effect is a list of voice states per channel, one per frame, in the same shape the song's voices
  // use. Every note sequence here is written for this film.
  const SIL = () => ({ v: 0, d: 2 });
  const gap = (n) => Array.from({ length: Math.max(0, n) }, SIL);
  const cat = (...a) => [].concat(...a);
  const lerp = (a, b, f) => a + (b - a) * f;
  // A pulse tone: hz for n frames. o.d duty, o.v [from, to] volume, o.bend pitch ratio per frame,
  // o.vib [depth ratio, period frames], o.wob alternating +/- ratio each frame, o.trig false to glide on.
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
  // A tone driven by the hardware sweep unit: the timer is written once, then the sweep shifts it by
  // t >> s every half frame, up in period (falling pitch) or, with neg, down (rising pitch). o.hold:
  // frames at the first volume before the fade.
  function psw(hz, n, o) {
    const out = [];
    const v = o.v || [12, 12];
    const sw = { p: o.p || 0, n: !!o.neg, s: o.s };
    const hold = o.hold || 0; // frames at full volume before the fade
    for (let k = 0; k < n; k++) {
      const u = k < hold ? 0 : n - 1 > hold ? (k - hold) / (n - 1 - hold) : 1;
      const st = { v: Math.round(lerp(v[0], v[1], u)), d: o.d == null ? 2 : o.d, sw };
      if (k === 0) Object.assign(st, { t: ptimer(hz), trig: true });
      out.push(st);
    }
    return out;
  }
  // Two notes alternating every frame: the driver's arpeggio trick for a shimmering interval.
  function trill(a, b, n, o) {
    const out = [];
    const v = o.v || [12, 0];
    for (let k = 0; k < n; k++) out.push({ v: Math.round(lerp(v[0], v[1], k / Math.max(1, n - 1))), d: o.d == null ? 1 : o.d, t: ptimer(mhz(k & 1 ? b : a)), trig: k === 0 });
    return out;
  }
  const nz = (rows) => rows.map((r, k) => ({ i: r[0], v: Math.max(0, Math.min(15, Math.round(r[1]))), m: r[2] || 0, trig: k === 0 }));
  // A triangle knock: a pitch falling by `ratio` each frame.
  function tthud(hz, n, ratio) {
    const out = [];
    for (let k = 0; k < n; k++) out.push({ t: ttimer(hz * Math.pow(ratio, k)), trig: k === 0 });
    return out;
  }
  const R = (...seed) => lib.rng(lib.hash('claude-quest-sfx', ...seed));
  const combo = (e) => Math.max(1, Math.min(9, Number(e.combo) || 1));
  // Each builder returns { pri, p1?, p2?, t?, n? }. A new effect takes a channel when its priority is at
  // least the one playing there. Big effects (start, powerup, pipe, flagpole, bossfall) take pulse 1.
  const SFX = {
    start: () => ({
      pri: 6,
      p1: cat(...['A5', 'C#6', 'E6'].map((n) => pt(mhz(n), 3, { d: 1, v: [12, 12] })), pt(mhz('A6'), 32, { d: 1, v: [13, 0], vib: [0.004, 6] })),
      p2: cat(gap(2), ...['E5', 'A5', 'C#6'].map((n) => pt(mhz(n), 3, { d: 2, v: [9, 9] })), pt(mhz('E6'), 30, { d: 2, v: [10, 0] })),
    }),
    // a jump is never dropped: it shares the coin's priority, so the newer of the two takes pulse 2.
    // 25 % duty, held at full volume for 4 frames so it cuts through the song, then the sweep carries it up
    jump: (e) => (e.big ? { pri: 2, p2: psw(330, 15, { d: 1, v: [15, 3], hold: 4, s: 5, neg: true }) } : { pri: 2, p2: psw(440, 12, { d: 1, v: [15, 3], hold: 4, s: 4, neg: true }) }),
    stomp: (e) => {
      const up = Math.pow(2, (2 * (combo(e) - 1)) / 12); // two semitones higher per link of the combo
      return {
        pri: 3,
        n: nz([[5, 11], [6, 12], [7, 10], [8, 7], [9, 4], [10, 2]]),
        p2: cat(psw(392 * up, 6, { d: 2, v: [12, 6], hold: 2, s: 3 }), gap(1), combo(e) > 1 ? pt(mhz('E6') * up, 5, { d: 1, v: [10, 2] }) : []),
      };
    },
    kick: (e) => {
      const up = Math.pow(2, (2 * (combo(e) - 1)) / 12);
      // the triangle's hard knock carries the kick even when a stomp (priority 3) still holds pulse 2 and
      // the noise, as when a shell is kicked the frame after it is stomped
      return { pri: 2, p2: cat(pt(1150 * up, 2, { d: 1, v: [14, 14] }), pt(700 * up, 7, { d: 1, v: [13, 3], bend: 0.93, trig: false })), n: nz([[3, 11, 1], [4, 9, 1], [5, 6], [6, 3], [7, 1]]), t: tthud(420 * up, 5, 0.85) };
    },
    coin: () => ({ pri: 2, p2: cat(pt(mhz('G5'), 2, { d: 1, v: [11, 11] }), pt(mhz('D6'), 2, { d: 1, v: [12, 12], trig: false }), pt(mhz('G6'), 22, { d: 1, v: [12, 0], trig: false })) }),
    bump: () => ({ pri: 2, t: tthud(140, 6, 0.86), n: nz([[12, 13], [12, 9], [13, 5], [13, 2]]) }),
    brick: (e) => {
      const r = R('brick', e.f | 0);
      const crumble = Array.from({ length: 24 }, (_, k) => [r.int(8, 11), 12 - k * 0.45]);
      return { pri: 3, n: nz([[3, 15], [4, 13]].concat(crumble)), t: tthud(100, 5, 0.88) };
    },
    sprout: () => ({ pri: 2, p2: cat(pt(175, 22, { d: 2, v: [10, 7], bend: Math.pow(4, 1 / 21), wob: 0.05 }), pt(700, 4, { d: 2, v: [6, 1], trig: false })) }),
    powerup: () => {
      const run = ['A4', 'E5', 'C#5', 'A5', 'E5', 'C#6', 'A5', 'E6', 'C#6', 'A6'];
      return { pri: 4, p1: cat(...run.map((n, i) => pt(mhz(n), 2, { d: 1, v: [12, 12], trig: i === 0 })), trill('A6', 'C#7', 16, { v: [11, 0], d: 1 })) };
    },
    oneup: () => ({
      pri: 4,
      p2: cat(pt(mhz('D6'), 3, { d: 1, v: [12, 10] }), gap(1), pt(mhz('D6'), 3, { d: 1, v: [12, 10] }), pt(mhz('A6'), 4, { d: 1, v: [12, 11] }), pt(mhz('F#6'), 4, { d: 1, v: [12, 11], trig: false }), pt(mhz('D7'), 16, { d: 1, v: [12, 0], trig: false })),
    }),
    pipe: () => ({
      pri: 4,
      p1: pt(520, 30, { d: 0, v: [12, 5], bend: Math.pow(0.25, 1 / 29), wob: 0.04 }),
      n: nz([[10, 2], [10, 4], [9, 6], [9, 8], [8, 9], [8, 8], [7, 6], [7, 4], [6, 2], [6, 1]]),
    }),
    flagpole: (e) => {
      // height: 0..1 up the pole, or the grab's score (100 at the foot .. 5000 at the top)
      let h = Number(e.height);
      if (!isFinite(h)) h = 1;
      if (h > 1) h = 0.2 + (0.8 * Math.log(Math.max(100, h) / 100)) / Math.log(50);
      h = Math.max(0, Math.min(1, h));
      const f0 = 480 + 520 * h;
      // the slide lasts exactly the pole's `frames` (the game's slide length), its last 6 a fade
      const n = Math.max(12, Math.round(Number(e.frames)) || 62);
      return {
        pri: 5,
        p1: cat(pt(f0, n - 6, { d: 2, v: [12, 8], bend: Math.pow(170 / f0, 1 / (n - 7)), vib: [0.025, 4] }), pt(170, 6, { d: 2, v: [7, 1], trig: false })),
        p2: cat(pt(mhz('F#6'), 2, { d: 1, v: [12, 12] }), pt(mhz('A6'), 14, { d: 1, v: [11, 0], trig: false })),
        n: nz([[3, 12], [3, 9], [4, 6], [4, 4], [4, 2], [4, 1]]),
      };
    },
    // one tick a frame while the clock counts down: loud and soft ticks alternate into a ratchet, and
    // the last one rings for two frames
    tally: (e) => ({ pri: 1, p2: cat(pt(mhz('E6'), 1, { d: 1, v: e.f & 1 ? [4, 4] : [8, 8] }), pt(mhz('E6'), 2, { d: 1, v: [3, 1], trig: false })) }),
    firework: () => ({ pri: 3, n: nz([[1, 15], [2, 14]].concat(Array.from({ length: 24 }, (_, k) => [11 + (k >> 3), 13 - k * 0.5]))), t: tthud(78, 9, 0.93) }),
    fireball: () => ({ pri: 0, n: nz([3, 5, 7, 8, 8, 7, 6, 5, 4, 3, 2, 1].map((v, k) => [Math.max(3, 8 - (k >> 1)), v])) }),
    bridge: (e) => {
      const i = e.i | 0;
      const r = R('bridge', i, e.f | 0);
      return { pri: 2, n: nz(Array.from({ length: 9 }, (_, k) => [r.int(9, 12), 13 - k * 1.4])), t: tthud(115 * Math.pow(0.975, i), 6, 0.86) };
    },
    bossfall: () => ({
      pri: 5,
      // exactly 64 frames: the rescue may start the frame after
      p1: cat(pt(760, 58, { d: 2, v: [13, 6], bend: Math.pow(55 / 760, 1 / 57), wob: 0.03 }), pt(55, 6, { d: 2, v: [6, 1], trig: false })),
      n: cat(gap(20), nz(Array.from({ length: 44 }, (_, k) => [13 + (k > 22 ? 1 : 0), 9 - k * 0.2]))),
    }),
    // a line of text typing on, one key per character (`line`, or `chars`), silent at spaces, long-mode
    // noise. At `every` 2+ frames a character each key is a two-frame tick; at 1 (the ending types a
    // character a frame) the keys alternate loud and soft, a teleprinter's rattle
    text: (e) => {
      const keys = typeof e.line === 'string' ? e.line.trim().split('').map((ch) => ch !== ' ') : new Array(Math.max(1, Math.min(40, e.chars | 0 || 1))).fill(true);
      const every = Math.max(1, e.every | 0 || 1);
      const prog = [];
      if (every === 1) keys.forEach((key, c) => prog.push(...(key ? nz([[3, c & 1 ? 4 : 8]]) : gap(1))));
      else keys.forEach((key, c) => prog.push(...(key ? nz([[3, 6], [4, 3]]) : gap(2)), ...(c < keys.length - 1 ? gap(every - 2) : [])));
      prog.push(...nz([[4, 2]]));
      return { pri: 1, n: prog };
    },
    // the boss lands: a heavy triangle drop from 150 Hz, a falling sweep thud on pulse 2 and a low crunch
    // (pitched high enough to pass the console's 440 Hz output filter, so the weight is heard)
    hop: () => ({ pri: 3, t: tthud(150, 10, 0.9), p2: psw(110, 7, { d: 0, v: [14, 3], hold: 2, s: 2 }), n: nz([[9, 15], [10, 13], [11, 10], [12, 7], [13, 4], [14, 2]]) }),
    // the boss roars: a growl on pulse 1 (a big effect: the castle's melody pauses for it, and jumps on
    // pulse 2 are never blocked), a low 12.5 % tone wobbling every frame and sagging in pitch, over a
    // swelling, trembling low noise
    roar: () => {
      const n = 44;
      const growl = [];
      for (let k = 0; k < n; k++) {
        const env = k < 6 ? 6 + k : k > n - 12 ? Math.max(1, Math.round(((n - k) * 11) / 12)) : 11;
        growl.push({ v: Math.max(1, env - (k & 1) * 3), d: 0, t: ptimer(118 * Math.pow(0.992, k) * (k & 1 ? 0.94 : 1.06)), trig: k === 0 });
      }
      const rumble = Array.from({ length: n }, (_, k) => [k & 2 ? 12 : 11, (k < 5 ? 4 + 2 * k : k > n - 10 ? (n - k) * 1.3 : 13) - (k & 1) * 3]);
      return { pri: 4, p1: growl, n: nz(rumble) };
    },
    // Claw'd presses the giant ENTER key: the keycap's clack as it bottoms out, the thock of its return,
    // then the terminal's confirm, a rising A5 to E6 blip
    axe: () => ({
      pri: 5,
      n: nz([[4, 14, 1], [6, 10], [8, 6], [10, 3], [10, 1], [15, 0], [15, 0], [5, 8, 1], [7, 4], [9, 1]]),
      t: tthud(190, 4, 0.78),
      p2: cat(gap(8), pt(mhz('A5'), 4, { d: 1, v: [12, 12] }), pt(mhz('E6'), 16, { d: 1, v: [12, 0], trig: false })),
    }),
  };

  // ---------------------------------------------------------------- the driver
  // One call per 60 Hz frame: frame(f, events) -> that frame's APU register writes, flat [addr, value, ...].
  function makeDriver(mute) {
    const mu = mute || {};
    let song = null;
    let sf = 0;
    let started = false;
    const fx = { p1: null, p2: null, t: null, n: null };
    const wasFx = { p1: false, p2: false, t: false, n: false };
    const hiShadow = [-1, -1];
    const swOn = [false, false];
    let triOn = false;
    let triHi = -1;
    function pulse(w, c, st) {
      const b = 0x4000 + 4 * c;
      if (!st || !(st.v > 0)) {
        w.push(b, 0x30); // constant volume 0, length halted
        if (swOn[c] && !(st && st.sw)) {
          w.push(b + 1, 0x08);
          swOn[c] = false;
        }
        return;
      }
      w.push(b, (st.d << 6) | 0x30 | st.v);
      if (st.sw) {
        if (st.trig) {
          w.push(b + 1, 0x80 | (st.sw.p << 4) | (st.sw.n ? 8 : 0) | st.sw.s);
          swOn[c] = true;
        }
      } else if (swOn[c]) {
        w.push(b + 1, 0x08); // sweep off, negate on: low notes are never muted by the sweep unit
        swOn[c] = false;
      }
      if (st.t !== undefined) {
        const hi = st.t >> 8;
        w.push(b + 2, st.t & 0xff);
        if (st.trig || hi !== hiShadow[c]) {
          w.push(b + 3, 0xf8 | hi); // restarts the phase: only on a new note or a new high byte
          hiShadow[c] = hi;
        }
      } else if (st.trig) hiShadow[c] = -1;
    }
    function tri(w, st) {
      if (!st) {
        if (triOn) w.push(0x4008, 0x80); // reload 0: the linear counter stops the triangle next quarter frame
        triOn = false;
        return;
      }
      if (!triOn) w.push(0x4008, 0xff);
      const hi = st.t >> 8;
      w.push(0x400a, st.t & 0xff);
      if (st.trig || hi !== triHi || !triOn) {
        w.push(0x400b, 0xf8 | hi);
        triHi = hi;
      }
      triOn = true;
    }
    function noise(w, st) {
      if (!st || !(st.v > 0)) {
        w.push(0x400c, 0x30);
        return;
      }
      w.push(0x400c, 0x30 | st.v, 0x400e, (st.m ? 0x80 : 0) | st.i);
      if (st.trig) w.push(0x400f, 0xf8);
    }
    function frame(f, evs) {
      const w = [];
      if (!started) {
        w.push(0x4015, 0x0f, 0x4001, 0x08, 0x4005, 0x08, 0x4000, 0x30, 0x4004, 0x30, 0x4008, 0x80, 0x400c, 0x30, 0x4010, 0x0f);
        started = true;
      }
      let dmcStop = false;
      let fresh = false;
      for (const ev of evs) {
        if (ev.type === 'song') {
          if (mu.music) continue;
          song = SONGS[ev.id] || null;
          // a section starts the song at that row (overworld: 'intro', 'A' the hook, 'B'); unknown: the top
          sf = song && ev.section && song.sections[ev.section] != null ? song.sections[ev.section] : 0;
          dmcStop = true;
          fresh = true;
          continue;
        }
        if (mu.sfx) continue;
        const make = SFX[ev.type];
        if (!make) continue;
        const prog = make(ev);
        for (const ch of ['p1', 'p2', 't', 'n']) {
          if (!prog[ch] || !prog[ch].length) continue;
          // a higher priority holds the channel; so does an equal one that started on this same frame
          // (a jump and a kick together: the jump keeps pulse 2, the kick sounds on its other channels)
          const cur = fx[ch];
          if (cur && (cur.pri > prog.pri || (cur.pri === prog.pri && cur.f === f))) continue;
          fx[ch] = { prog: prog[ch], k: 0, pri: prog.pri, f };
        }
      }
      for (const ch of ['p1', 'p2', 't', 'n']) {
        const a = fx[ch];
        let st;
        if (a) {
          st = a.prog[a.k];
          a.k++;
          if (a.k >= a.prog.length) fx[ch] = null;
        } else {
          st = song ? voiceAt(song, ch, sf) : null;
          // the song's voice comes back in time, with a fresh trigger so its registers are all rewritten;
          // a song started at a section may begin inside a note, which is triggered the same way
          if ((wasFx[ch] || fresh) && st) st = Object.assign({}, st, { trig: true });
        }
        wasFx[ch] = !!a;
        if (ch === 'p1') pulse(w, 0, st);
        else if (ch === 'p2') pulse(w, 1, st);
        else if (ch === 't') tri(w, st);
        else noise(w, st);
      }
      // a song change stops the DMC and puts its DAC back at the rest level, so a drum cut mid-sample
      // never leaves the channel's DC (and the triangle and noise volumes it sets) off for the next song
      if (dmcStop) w.push(0x4015, 0x0f, 0x4011, DMC_LEVEL0);
      const dv = song ? voiceAt(song, 'd', sf) : null;
      if (dv) {
        const smp = DMC[dv.dmc];
        w.push(0x4010, dv.rate, 0x4012, smp.a, 0x4013, smp.l, 0x4015, 0x0f, 0x4015, 0x1f);
      }
      if (song) sf++;
      return w;
    }
    return { frame };
  }

  // ---------------------------------------------------------------- rendering
  const NONE = [];
  function gameEvents() {
    const g = FILM.game;
    if (!g || typeof g.events !== 'function') return NONE; // no game engine loaded: the console is silent
    return g.events() || NONE;
  }
  function filmFrames() {
    const d = (FILM.TIMELINE && FILM.TIMELINE.duration) || FILM.DURATION || 0;
    return Math.round(d * FPS);
  }
  // The whole soundtrack as one mono buffer from global time 0.
  //   o.events   the event list (default FILM.game.events()); tools pass the mock here, the film never does
  //   o.samples  length (default the film's duration)
  //   o.foley    false to leave out the TV (FILM.foley)
  //   o.mute     { music: true } or { sfx: true }: drop song or effect events (tools)
  //   o.log      true: attach out.log = [[frame, [addr, value, ...]], ...], every register write
  function synth(sr, opts) {
    const o = opts || {};
    const events = o.events || gameEvents();
    const byF = new Map();
    for (const e of events) {
      const f = Math.max(0, Math.round(Number(e.f) || 0));
      if (!byF.has(f)) byF.set(f, []);
      byF.get(f).push(e);
    }
    const driver = makeDriver(o.mute);
    const log = o.log ? [] : null;
    const eng = makeEngine(sr, (f) => {
      const w = driver.frame(f, byF.get(f) || NONE);
      if (log && w.length) log.push([f, w]);
      return w;
    });
    const n = o.samples != null ? o.samples : Math.round((filmFrames() / FPS) * sr);
    const out = new Float32Array(n);
    for (let j = 0; j < n; j++) out[j] = eng.out(j) * GAIN;
    if (o.foley !== false && FILM.foley && typeof FILM.foley.apply === 'function') FILM.foley.apply(out, sr);
    if (log) out.log = log;
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
      // o.events: tools only (a mock list while the game is built); the film always hears its game
      const data = o.events ? synth(sr, { events: o.events }) : cache[sr] || (cache[sr] = synth(sr));
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
    // The playable mode: the same driver and chip, generated as it plays. Feed it what the game engine's
    // step() returns each frame; they sound on the next driver frame.
    live(actx, opts) {
      const o = opts || {};
      const queue = [];
      const driver = makeDriver();
      const eng = makeEngine(actx.sampleRate, (f) => driver.frame(f, queue.splice(0, queue.length)));
      let vol = o.volume == null ? 1 : Number(o.volume);
      let j = 0;
      const node = actx.createScriptProcessor(o.bufferSize || 1024, 1, 1);
      node.onaudioprocess = (e) => {
        const out = e.outputBuffer.getChannelData(0);
        for (let i = 0; i < out.length; i++) out[i] = eng.out(j++) * GAIN * vol;
      };
      node.connect(o.dest || actx.destination);
      if (o.song) queue.push({ type: 'song', id: o.song });
      return {
        node,
        song(id) {
          queue.push({ type: 'song', id });
        },
        event(ev) {
          if (ev) queue.push(ev);
        },
        events(list) {
          for (const ev of list || NONE) queue.push(ev);
        },
        get frame() {
          return eng.frame();
        },
        get volume() {
          return vol;
        },
        set volume(v) {
          vol = Number(v);
        },
        stop() {
          node.onaudioprocess = null;
          node.disconnect();
        },
      };
    },
    synth,
    // tools: an effect's program for an event, { pri, frames per channel }
    effect: (ev) => {
      const make = SFX[ev.type];
      if (!make) return null;
      const pr = make(ev);
      const out = { pri: pr.pri };
      for (const ch of ['p1', 'p2', 't', 'n']) if (pr[ch]) out[ch] = pr[ch].length;
      return out;
    },
    songs: Object.keys(SONGS),
    sfx: Object.keys(SFX),
    info: () => ({
      gain: GAIN,
      dmcRomBytes: DMC.romBytes,
      dmc: Object.fromEntries(['kick', 'snare', 'timpD', 'timpC'].map((k) => [k, DMC[k].bytes])),
      songs: Object.fromEntries(Object.keys(SONGS).map((k) => [k, { speed: SONGS[k].speed, rows: SONGS[k].rows, frames: SONGS[k].L, loopFrame: SONGS[k].LF, sections: Object.assign({}, SONGS[k].sections) }])),
    }),
  };
})();
