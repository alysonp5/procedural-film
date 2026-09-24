// foley.js : the TV set itself, the one sound in the film that is not the console. Owner: audio.
// Contract: docs/v2-architecture.md section 4.4; design notes: docs/sound.md.
//
// FILM.foley.apply(buf, sr) works on the film's mono soundtrack buffer (sample 0 = global time 0):
//   1 the speaker  the console's sound reaches the room through the TV, so it is multiplied by the set's
//                  speaker gain: silent while the set is off, warming up after the power switch, dying
//                  away over the caption after it is switched off.
//   2 the set      adds the TV's own sounds at the power windows in FILM.TIMELINE.crt (global frames), each
//                  on the picture's own key frame (FILM.crt.marks()):
//                  power-on   the switch click, the tube's thunk, the degauss "bwoom" riding a 60 Hz hum,
//                             a burst of static that fades as the picture settles, and the flyback's faint
//                             15.734 kHz whine fading in (it stays, very quietly, while the set is on)
//                  power-off  the switch click, the collapse "zhip", a static tick, the whine running down
//                  The set's switching sounds reach us with a small room's early reflections (the
//                  console's sound and the whine do not).
// Every sample is a pure function of its index and the timeline; noise comes from FILM.lib.rng with
// fixed seeds, so the buffer is deterministic and any seek hears the same samples.
(function () {
  'use strict';
  const root = typeof window !== 'undefined' ? window : globalThis;
  const FILM = root.FILM;
  const lib = FILM.lib;
  const TAU = Math.PI * 2;
  const FPS = 60;
  const LINE_HZ = 15734.26; // NTSC horizontal rate: the flyback transformer sings at it

  const smooth = (a, b, t) => {
    const x = Math.max(0, Math.min(1, (t - a) / (b - a)));
    return x * x * (3 - 2 * x);
  };
  // The picture's key frames (FILM.crt.marks(): the switch click, the line opening, the degauss, the lock;
  // the collapse's squeeze, dot and afterglow), so every sound lands on what the tube shows. Without the
  // display loaded they are derived from FILM.TIMELINE.crt in crt.js's own proportions.
  function windows() {
    const c = (FILM.TIMELINE && FILM.TIMELINE.crt) || {};
    const on = Array.isArray(c.powerOn) ? c.powerOn : null;
    const off = Array.isArray(c.powerOff) ? c.powerOff : null;
    const m = FILM.crt && typeof FILM.crt.marks === 'function' ? FILM.crt.marks() : {};
    const w = { on: null, off: null };
    if (on) {
      const k = (on[1] - on[0]) / 150;
      const at = (x) => on[0] + Math.round(x * k);
      const mo = m.powerOn || {};
      w.on = { start: on[0], click: mo.click != null ? mo.click : at(20), line: mo.line != null ? mo.line : at(22), open: mo.open != null ? mo.open : at(27), deg: at(44), locked: mo.locked != null ? mo.locked : at(100), settled: on[1] };
    }
    if (off) {
      const k = (off[1] - off[0]) / 120;
      const at = (x) => off[0] + Math.round(x * k);
      const mf = m.powerOff || {};
      w.off = { start: off[0], squeeze: mf.line != null ? mf.line : at(7), dot: mf.dot != null ? mf.dot : at(15), afterglow: mf.afterglow != null ? mf.afterglow : at(19), end: off[1] };
    }
    return w;
  }

  // The speaker gain at global time t: 0 until the switch clicks, up between 0.1 and 0.5 s after it as the
  // audio stage warms (the console is already playing), then 1 until the set is switched off. Then the
  // sound dies with the supply: an exponential decay (time constant 0.35 s) that is inaudible by the
  // time the caption leaves the dark glass, closed to exact silence between 1.6 and 2.0 s.
  const OFF_TAU = 0.35;
  const OFF_END = 2.0;
  function speaker(t, w) {
    let g = 1;
    if (w.on) {
      const t0 = w.on.click / FPS;
      g = smooth(t0 + 0.1, t0 + 0.5, t);
    }
    if (w.off) {
      const u = t - w.off.start / FPS;
      if (u >= 0) g *= Math.exp(-u / OFF_TAU) * (1 - smooth(OFF_END - 0.4, OFF_END, u));
    }
    return g;
  }

  // Add fn(t, i) to buf over [t0, t1) seconds.
  function add(buf, sr, t0, t1, fn) {
    const i0 = Math.max(0, Math.round(t0 * sr));
    const i1 = Math.min(buf.length, Math.round(t1 * sr));
    for (let i = i0; i < i1; i++) buf[i] += fn(i / sr - t0, i);
  }
  // A one-pole filter pair, for coloured noise.
  function bandNoise(seed, lo, hi, sr) {
    const r = lib.rng(seed);
    const aH = Math.exp((-TAU * lo) / sr);
    const aL = 1 - Math.exp((-TAU * hi) / sr);
    let hp = 0;
    let px = 0;
    let lp = 0;
    return () => {
      const x = r() * 2 - 1;
      hp = aH * (hp + x - px);
      px = x;
      lp += aL * (hp - lp);
      return lp;
    };
  }

  // The power switch: a latch's bright double tick and the small thump of the speaker cone.
  function click(buf, sr, t, seed, bright, level) {
    const g = level == null ? 1 : level;
    const n = bandNoise(seed, 1800, 9000, sr);
    add(buf, sr, t, t + 0.05, (u) => {
      const tick = Math.exp(-u / 0.0022) * (0.11 * Math.sin(TAU * 2350 * bright * u) + 0.07 * Math.sin(TAU * 4130 * bright * u + 1) + 0.9 * n());
      const cone = 0.06 * Math.exp(-u / 0.012) * Math.sin(TAU * 58 * u);
      return g * (tick + cone);
    });
    const n2 = bandNoise(seed + ':latch', 2500, 11000, sr);
    add(buf, sr, t + 0.038, t + 0.06, (u) => g * Math.exp(-u / 0.0015) * (0.05 * Math.sin(TAU * 3100 * bright * u) + 0.45 * n2()));
  }

  function powerOn(buf, sr, w) {
    const t0 = w.on.click / FPS; // the switch, on the frame the picture's power sequence starts
    const settle = Math.max(t0 + 1, w.on.settled / FPS);
    const degPeak = Math.max(0.12, (w.on.deg - w.on.click) / FPS); // the swell peaks with the picture's degauss wobble
    click(buf, sr, t0, 'foley-on-click', 1, 0.7);
    // the tube's thunk: the high voltage coming up, felt more than heard
    add(buf, sr, t0 + 0.05, t0 + 0.45, (u) => Math.exp(-u / 0.075) * (0.16 * Math.sin(TAU * (62 - 14 * Math.min(1, u / 0.2)) * u) + 0.05 * Math.sin(TAU * 131 * u + 0.4)) * smooth(0, 0.004, u));
    // the degauss: the coil's field, a buzzing 60 Hz swell that throbs and dies as its thermistor heats
    const hum = (u) => {
      const s = Math.sin(TAU * 60 * u) + 0.55 * Math.sin(TAU * 120 * u + 0.7) + 0.35 * Math.sin(TAU * 180 * u + 1.9) + 0.22 * Math.sin(TAU * 240 * u + 0.2) + 0.12 * Math.sin(TAU * 360 * u + 2.4);
      return Math.tanh(1.4 * s);
    };
    add(buf, sr, t0 + 0.09, t0 + 0.09 + degPeak + 1.6, (u) => {
      const env = smooth(0, degPeak, u) * Math.exp(-Math.max(0, u - degPeak) / 0.42) * (1 + 0.22 * Math.sin(TAU * 6.5 * u));
      const bwoom = Math.sin(TAU * (96 - 30 * Math.min(1, u / 0.6)) * u);
      return env * (0.1 * hum(u) + 0.09 * bwoom);
    });
    // static: the tuner's hiss while the picture rolls and settles, with crackles in the first second
    const hiss = bandNoise('foley-on-hiss', 900, 7500, sr);
    const tLine = w.on.open / FPS; // the snow comes as the picture opens
    const tLock = w.on.locked / FPS;
    add(buf, sr, tLine, settle + 0.2, (u, i) => {
      const t = i / sr;
      const fade = 1 - smooth(tLine + 0.4, Math.max(tLine + 0.8, tLock), t);
      return 0.13 * smooth(0, 0.08, u) * fade * fade * hiss();
    });
    const cr = lib.rng('foley-on-crackle');
    for (let k = 0; k < 26; k++) {
      const tc = tLine + 0.03 + cr() * Math.max(0.4, tLock - tLine - 0.2);
      const a = 0.04 + 0.1 * cr();
      const f = 2200 + 3000 * cr();
      add(buf, sr, tc, tc + 0.004, (u) => a * Math.exp(-u / 0.0006) * Math.sin(TAU * f * u));
    }
  }

  function powerOff(buf, sr, w) {
    const t1 = w.off.start / FPS;
    click(buf, sr, t1, 'foley-off-click', 0.92, 0.7);
    // the collapse: the deflection dies and the high voltage bleeds off, a zip falling from the squeeze
    // to the dot
    const zn = bandNoise('foley-off-zhip', 600, 6000, sr);
    const tz = w.off.squeeze / FPS - 0.02;
    const fall = Math.max(0.03, (w.off.dot - w.off.squeeze) / FPS / 3);
    let ph = 0;
    add(buf, sr, tz, tz + 0.26, (u) => {
      const hz = 180 + 2300 * Math.exp(-u / fall);
      ph += (TAU * hz) / sr;
      const tone = Math.sin(ph) + 0.33 * Math.sin(3 * ph) + 0.2 * Math.sin(5 * ph);
      return smooth(0, 0.006, u) * Math.exp(-u / 0.07) * (0.08 * tone + 0.05 * zn());
    });
    // the static tick of the discharge on the glass, a moment later
    const tr = lib.rng('foley-off-tick');
    const tt = w.off.afterglow / FPS + 0.1;
    for (let k = 0; k < 3; k++) {
      const tc = tt + k * 0.011 + tr() * 0.004;
      const a = 0.12 - k * 0.035;
      add(buf, sr, tc, tc + 0.005, (u) => a * Math.exp(-u / 0.0007) * Math.sin(TAU * (2600 + 900 * k) * u));
    }
  }

  // The flyback whine, very faint: fades in with the set, runs down in pitch and level at power-off.
  function whine(buf, sr, w) {
    if (sr < 36000) return; // cannot be represented below this rate
    const tOn = w.on ? w.on.click / FPS + 0.25 : 0;
    const tOff = w.off ? w.off.start / FPS : buf.length / sr;
    const A = 0.0032;
    const i0 = Math.max(0, Math.round(tOn * sr));
    const i1 = Math.min(buf.length, Math.round((tOff + 1.2) * sr));
    const iRamp = Math.round((tOn + 2.2) * sr);
    const iOff = Math.round(tOff * sr);
    // a rotating phasor (renormalised every 1024 samples) instead of a sine per sample
    let c = 1;
    let s = 0;
    let om = (TAU * LINE_HZ) / sr;
    let cw = Math.cos(om);
    let sw = Math.sin(om);
    for (let i = i0; i < i1; i++) {
      let a = A;
      if (i < iRamp) a *= smooth(tOn, tOn + 2.2, i / sr);
      if (i >= iOff) {
        const u = (i - iOff) / sr;
        a *= Math.exp(-u / 0.3);
        om = (TAU * LINE_HZ * (1 - 0.05 * (1 - Math.exp(-u / 0.25)))) / sr;
        cw = Math.cos(om);
        sw = Math.sin(om);
      }
      const c2 = c * cw - s * sw;
      s = s * cw + c * sw;
      c = c2;
      if ((i & 1023) === 0) {
        const m = 1 / Math.sqrt(c * c + s * s);
        c *= m;
        s *= m;
      }
      buf[i] += a * s;
    }
  }

  // The room the set stands in: the set's own sounds reach the microphone with a handful of early
  // reflections (walls, the floor, a sofa), each dulled by a one-pole low-pass. Seven taps, 7 to 55 ms,
  // no tail: a small living room, heard, not a reverb. Only the set's switching sounds pass through it (not the whine); the console's
  // sound is the chip as it was recorded.
  const ROOM = [[0.0071, 0.2], [0.0113, 0.15], [0.0172, 0.11], [0.0239, 0.08], [0.0317, 0.06], [0.0419, 0.04], [0.0553, 0.025]];
  function room(src, buf, sr, t0, t1) {
    const taps = ROOM.map(([d, g]) => [Math.round(d * sr), g]);
    const a = 1 - Math.exp((-TAU * 4500) / sr);
    let lp = 0;
    const i1 = Math.min(src.length, Math.round(t1 * sr));
    for (let i = Math.max(0, Math.round(t0 * sr)); i < i1; i++) {
      let r = 0;
      for (let k = 0; k < taps.length; k++) {
        const j = i - taps[k][0];
        if (j >= 0) r += taps[k][1] * src[j];
      }
      lp += a * (r - lp);
      buf[i] += src[i] + lp;
    }
  }

  FILM.foley = {
    speaker: (t) => speaker(t, windows()),
    apply(buf, sr) {
      const w = windows();
      for (let i = 0; i < buf.length; i++) {
        const t = i / sr;
        // only the ramps need the curve; elsewhere the gain is exactly 0 or 1
        if (w.on && t < w.on.click / FPS + 0.6) buf[i] *= speaker(t, w);
        else if (w.off && t >= w.off.start / FPS) buf[i] *= speaker(t, w);
      }
      // the set's switching sounds, heard in the room (only the power windows carry them); the whine is a
      // pure 15.7 kHz tone that reflections would only comb, so it goes straight in
      const set = new Float32Array(buf.length);
      if (w.on) {
        powerOn(set, sr, w);
        room(set, buf, sr, w.on.start / FPS, Math.max(w.on.settled / FPS, w.on.click / FPS + 2.2) + 0.5);
      }
      if (w.off) {
        powerOff(set, sr, w);
        room(set, buf, sr, w.off.start / FPS, w.off.start / FPS + 1.5);
      }
      whine(buf, sr, w);
      return buf;
    },
  };
})();
