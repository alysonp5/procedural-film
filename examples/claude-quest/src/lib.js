/*
 * lib.js : FILM.lib, the shared drawing library.
 *
 * Everything here is a pure function of its arguments plus FILM.lib.T (the global time
 * core sets before each shot draws, used only for the 12 fps line boil).
 * Randomness comes from rng(seed) and hash(...). Caches are keyed by every input.
 *
 * Shape inputs ("clip") accepted by hatch, crossHatch, stipple and hexLattice:
 *   - an array of points [[x,y], ...] or [{x,y}, ...]      (fast: exact spans, natural ends)
 *   - an array of polygons [[[x,y],...], [[x,y],...]]      (even-odd, so inner polygons are holes)
 *   - a function (ctx) => { ctx.moveTo...; ctx.arc... }     (hard clip; pass opts.bounds for speed)
 *   - a Path2D                                             (hard clip; pass opts.bounds for speed)
 *   - null                                                 (no clip; opts.bounds or the whole frame)
 * Bounds are { x, y, w, h } or [x, y, w, h] in the current (logical) coordinates.
 *
 * Angles are radians. Sizes are logical pixels on the 1080x1920 frame.
 */
(function () {
  'use strict';

  const FILM = (window.FILM = window.FILM || {});
  const lib = (FILM.lib = {});
  const W = () => FILM.W || 1080;
  const H = () => FILM.H || 1920;
  const TAU = Math.PI * 2;

  lib.TAU = TAU;
  // global time of the frame being drawn; core sets it before each shot draws, scenes can only read it
  Object.defineProperty(lib, 'T', { get: () => FILM.frameT || 0, enumerable: true });

  // ===========================================================================
  // Numbers
  // ===========================================================================

  const clamp = (v, lo = 0, hi = 1) => (v < lo ? lo : v > hi ? hi : v);
  const lerp = (a, b, t) => a + (b - a) * t;
  const invLerp = (a, b, v) => (b === a ? 0 : (v - a) / (b - a));
  const smoothstep = (e0, e1, x) => {
    const t = clamp(invLerp(e0, e1, x));
    return t * t * (3 - 2 * t);
  };
  lib.clamp = clamp;
  lib.lerp = lerp;
  lib.invLerp = invLerp;
  lib.smoothstep = smoothstep;

  // ===========================================================================
  // Easing (inputs are clamped to 0..1)
  // ===========================================================================

  const c01 = (p) => (p < 0 ? 0 : p > 1 ? 1 : p);
  const B1 = 1.70158;
  const B2 = B1 * 1.525;
  const ease = {
    linear: (p) => c01(p),
    inQuad: (p) => ((p = c01(p)), p * p),
    outQuad: (p) => ((p = c01(p)), 1 - (1 - p) * (1 - p)),
    inOutQuad: (p) => ((p = c01(p)), p < 0.5 ? 2 * p * p : 1 - Math.pow(-2 * p + 2, 2) / 2),
    inCubic: (p) => ((p = c01(p)), p * p * p),
    outCubic: (p) => ((p = c01(p)), 1 - Math.pow(1 - p, 3)),
    inOutCubic: (p) => ((p = c01(p)), p < 0.5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2),
    inQuart: (p) => ((p = c01(p)), p * p * p * p),
    outQuart: (p) => ((p = c01(p)), 1 - Math.pow(1 - p, 4)),
    inOutQuart: (p) => ((p = c01(p)), p < 0.5 ? 8 * p * p * p * p : 1 - Math.pow(-2 * p + 2, 4) / 2),
    inQuint: (p) => ((p = c01(p)), p * p * p * p * p),
    outQuint: (p) => ((p = c01(p)), 1 - Math.pow(1 - p, 5)),
    inOutQuint: (p) => ((p = c01(p)), p < 0.5 ? 16 * p * p * p * p * p : 1 - Math.pow(-2 * p + 2, 5) / 2),
    inSine: (p) => ((p = c01(p)), 1 - Math.cos((p * Math.PI) / 2)),
    outSine: (p) => ((p = c01(p)), Math.sin((p * Math.PI) / 2)),
    inOutSine: (p) => ((p = c01(p)), -(Math.cos(Math.PI * p) - 1) / 2),
    inExpo: (p) => ((p = c01(p)), p === 0 ? 0 : Math.pow(2, 10 * p - 10)),
    outExpo: (p) => ((p = c01(p)), p === 1 ? 1 : 1 - Math.pow(2, -10 * p)),
    inOutExpo: (p) => ((p = c01(p)), p === 0 ? 0 : p === 1 ? 1 : p < 0.5 ? Math.pow(2, 20 * p - 10) / 2 : (2 - Math.pow(2, -20 * p + 10)) / 2),
    inCirc: (p) => ((p = c01(p)), 1 - Math.sqrt(1 - p * p)),
    outCirc: (p) => ((p = c01(p)), Math.sqrt(1 - Math.pow(p - 1, 2))),
    inOutCirc: (p) => ((p = c01(p)), p < 0.5 ? (1 - Math.sqrt(1 - Math.pow(2 * p, 2))) / 2 : (Math.sqrt(1 - Math.pow(-2 * p + 2, 2)) + 1) / 2),
    inBack: (p) => ((p = c01(p)), (B1 + 1) * p * p * p - B1 * p * p),
    outBack: (p) => ((p = c01(p)), 1 + (B1 + 1) * Math.pow(p - 1, 3) + B1 * Math.pow(p - 1, 2)),
    inOutBack: (p) => ((p = c01(p)), p < 0.5 ? (Math.pow(2 * p, 2) * ((B2 + 1) * 2 * p - B2)) / 2 : (Math.pow(2 * p - 2, 2) * ((B2 + 1) * (p * 2 - 2) + B2) + 2) / 2),
    outElastic: (p) => ((p = c01(p)), p === 0 ? 0 : p === 1 ? 1 : Math.pow(2, -10 * p) * Math.sin((p * 10 - 0.75) * (TAU / 3)) + 1),
    outBounce: (p) => {
      p = c01(p);
      const n = 7.5625, d = 2.75;
      if (p < 1 / d) return n * p * p;
      if (p < 2 / d) return n * (p -= 1.5 / d) * p + 0.75;
      if (p < 2.5 / d) return n * (p -= 2.25 / d) * p + 0.9375;
      return n * (p -= 2.625 / d) * p + 0.984375;
    },
    /** Snappy settle used for drawn-animation poses: fast out, tiny overshoot. */
    snap: (p) => ((p = c01(p)), 1 + 2.2 * Math.pow(p - 1, 3) + 1.2 * Math.pow(p - 1, 2)),
    /** Factory: hold-and-jump in n steps. */
    steps: (n) => (p) => Math.min(1, Math.floor(c01(p) * n) / n),
  };
  lib.ease = ease;

  const easeFn = (e) => (typeof e === 'function' ? e : typeof e === 'string' && ease[e] ? ease[e] : ease.linear);

  /** mapRange(x, a0, a1, b0, b1, easing?) clamps x into [a0,a1] and maps to [b0,b1]. */
  lib.mapRange = (x, a0, a1, b0, b1, e) => b0 + (b1 - b0) * easeFn(e)(clamp(invLerp(a0, a1, x)));
  /** seg(t, t0, t1, easing?) : 0..1 progress of t through [t0,t1]. */
  lib.seg = (t, t0, t1, e) => easeFn(e)(clamp(invLerp(t0, t1, t)));

  // ===========================================================================
  // Hash, rng, noise
  // ===========================================================================

  const F64 = new Float64Array(1);
  const U32 = new Uint32Array(F64.buffer);
  function mix32(h) {
    h ^= h >>> 16;
    h = Math.imul(h, 0x7feb352d);
    h ^= h >>> 15;
    h = Math.imul(h, 0x846ca68b);
    h ^= h >>> 16;
    return h >>> 0;
  }
  /** hash(...values) : stable unsigned 32-bit int from numbers and strings. */
  function hash() {
    let h = 0x811c9dc5 ^ arguments.length;
    for (let a = 0; a < arguments.length; a++) {
      const v = arguments[a];
      if (typeof v === 'number') {
        if ((v | 0) === v) {
          h = mix32(h ^ Math.imul(v, 0x9e3779b1));
        } else {
          F64[0] = v;
          h = mix32(h ^ U32[0]);
          h = mix32(h ^ U32[1]);
        }
      } else {
        const s = String(v);
        for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 0x01000193);
        h = mix32(h ^ s.length);
      }
    }
    return h >>> 0;
  }
  lib.hash = hash;

  const seedInt = (s) => (typeof s === 'number' && (s | 0) === s ? s : hash(s) | 0);

  /** Fast stateless 3-int hash to [0,1). */
  function h3(a, b, c) {
    let h = Math.imul(a | 0, 0x27d4eb2d) ^ Math.imul(b | 0, 0x165667b1) ^ Math.imul(c | 0, 0x9e3779b1);
    h ^= h >>> 15;
    h = Math.imul(h, 0x85ebca6b);
    h ^= h >>> 13;
    h = Math.imul(h, 0xc2b2ae35);
    h ^= h >>> 16;
    return (h >>> 0) / 4294967296;
  }
  lib.h3 = h3;

  /** rng(seed) : function returning [0,1). Has .range(a,b) .int(a,b) .pick(arr) .sign() .chance(p) .gauss(). */
  function rng(seed) {
    let a = hash(seed === undefined ? 1 : seed) || 0x9e3779b9;
    const r = function () {
      a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    r.range = (lo, hi) => lo + (hi - lo) * r();
    r.int = (lo, hi) => lo + Math.floor((hi - lo + 1) * r());
    r.pick = (arr) => arr[Math.floor(r() * arr.length)];
    r.sign = () => (r() < 0.5 ? -1 : 1);
    r.chance = (p) => r() < p;
    r.gauss = () => {
      const u = 1 - r();
      const v = r();
      return Math.sqrt(-2 * Math.log(u)) * Math.cos(TAU * v);
    };
    return r;
  }
  lib.rng = rng;

  const fade5 = (f) => f * f * f * (f * (f * 6 - 15) + 10);

  /** noise1(x, seed) : smooth 1D gradient noise in [-1,1]. */
  function noise1(x, seed) {
    const s = seed === undefined ? 0 : seedInt(seed);
    const i = Math.floor(x);
    const f = x - i;
    const g0 = h3(i, 71, s) * 2 - 1;
    const g1 = h3(i + 1, 71, s) * 2 - 1;
    const v = lerp(g0 * f, g1 * (f - 1), fade5(f)) * 2;
    return v < -1 ? -1 : v > 1 ? 1 : v;
  }
  lib.noise1 = noise1;

  const GX = [1, -1, 1, -1, 1.4142, -1.4142, 0, 0];
  const GY = [1, 1, -1, -1, 0, 0, 1.4142, -1.4142];
  function grad(ix, iy, s, x, y) {
    const k = (h3(ix, iy, s) * 8) | 0;
    return GX[k] * x + GY[k] * y;
  }
  /** noise2(x, y, seed) : smooth 2D gradient noise in [-1,1]. */
  function noise2(x, y, seed) {
    const s = seed === undefined ? 0 : seedInt(seed);
    const ix = Math.floor(x);
    const iy = Math.floor(y);
    const fx = x - ix;
    const fy = y - iy;
    const u = fade5(fx);
    const v = fade5(fy);
    const n00 = grad(ix, iy, s, fx, fy);
    const n10 = grad(ix + 1, iy, s, fx - 1, fy);
    const n01 = grad(ix, iy + 1, s, fx, fy - 1);
    const n11 = grad(ix + 1, iy + 1, s, fx - 1, fy - 1);
    const r = lerp(lerp(n00, n10, u), lerp(n01, n11, u), v) * 1.1;
    return r < -1 ? -1 : r > 1 ? 1 : r;
  }
  lib.noise2 = noise2;

  lib.fbm1 = (x, seed, oct = 3) => {
    const s = seed === undefined ? 0 : seedInt(seed);
    let a = 0.5, f = 1, sum = 0, norm = 0;
    for (let o = 0; o < oct; o++) {
      sum += a * noise1(x * f, s + o * 101);
      norm += a;
      a *= 0.5;
      f *= 2.03;
    }
    return sum / norm;
  };
  lib.fbm2 = (x, y, seed, oct = 3) => {
    const s = seed === undefined ? 0 : seedInt(seed);
    let a = 0.5, f = 1, sum = 0, norm = 0;
    for (let o = 0; o < oct; o++) {
      sum += a * noise2(x * f, y * f, s + o * 101);
      norm += a;
      a *= 0.5;
      f *= 2.03;
    }
    return sum / norm;
  };

  // ===========================================================================
  // Animation clocks
  // ===========================================================================

  /** boil(T, fps=12) : index of the held drawing at global time T. Lines re-wobble when it changes. */
  lib.boil = (T, fps = 12) => Math.floor(T * fps + 1e-6);
  /** onTwos(t) : quantise time to 1/12 s so motion steps like drawn animation. */
  lib.onTwos = (t) => Math.floor(t * 12 + 1e-6) / 12;

  function boilIndex(o) {
    if (o.boil === false) return 0;
    if (typeof o.boil === 'number') return o.boil;
    return lib.boil(lib.T);
  }

  // ===========================================================================
  // Colour
  // ===========================================================================

  // Keys and values follow docs/art-bible.md section 2 (the published palette).
  const pal = {
    // 2.1 warm illustrated palette (paper plate)
    paper: '#FCD8A8', // $37 (was #EFE3C9)
    paperShade: '#FCD8A8', // $37 (was #E2D1B0)
    paperDeep: '#FCD8A8', // $37 (was #CDB58C)
    stripeCream: '#FCFCFC', // $30 (was #F2E7CF)
    stripeYellow: '#FCE4A0', // $38 (was #EFDCA3)
    stripeApricot: '#FCD8A8', // $37 (was #F0D9B5)
    stripeSage: '#FCFCFC', // $30 (was #DCE3CC)
    stripeSpring: '#FCFCFC', // $30 (was #E4EDD0)
    stripeSky: '#C4C4C4', // $3D (was #C9D3D2)
    ink: '#000000', // $0F (was #2A1C13)
    inkSoft: '#402C00', // $08 (was #5B4331)
    inkFaint: '#787878', // $2D (was #8A735C)
    tan: '#FCD8A8', // $37 (was #C8A47A)
    ochre: '#887000', // $18 (was #C38F2E)
    rose: '#FCBCB0', // $36 (was #C88C86)
    duskRose: '#FCBCB0', // $36 (was #E3B1A1)
    sage: '#BCBCBC', // $10 (was #94A47F)
    teal: '#008088', // $1C (was #3C8783)
    tealDeep: '#008088', // $1C (was #285F5D)
    sun: '#F0BC3C', // $28 (was #F1BF4A)
    nightSky: '#183C5C', // $0C (was #4E3F6E)
    night: '#183C5C', // $0C (was #2F2748)
    white: '#FCFCFC', // $30 (was #FBF6EA)
    orange: '#FC9838', // $27 (was #D8742B)
    leaf: '#009038', // $1B (was #6E8F4F)
    wood: '#887000', // $18 (was #A8784C)
    sunset: '#FCBCB0', // $36 (was #E79D8F)
    dusk: '#183C5C', // $0C (was #5A4878)
    red: '#A80010', // $05 (was #BF3F2C)
    // 2.2b photo-doodle house colours — the mode's own, used by src/props.js and src/cast.js.
    // A drawn film never reads them. A film's own cast colours go in the subject block below.
    paperMint: '#FCFCFC', // $30 (was #DCE7DC)
    paperPink: '#FCFCFC', // $30 (was #F2DCD8)
    paperButter: '#FCD8A8', // $37 (was #F1E5C2)
    paperSky: '#FCFCFC', // $30 (was #D7E3EE)
    paperCream: '#FCFCFC', // $30 (was #EEE5D4)
    paperLilac: '#C4C4C4', // $3D (was #DFD9EA)
    paperPeach: '#FCFCFC', // $30 (was #F2DDCA)
    paperSage: '#C4C4C4', // $3D (was #D9E0CE)
    paperNight: '#183C5C', // $0C (was #1C2340)
    doodleInk: '#000000', // $0F (was #26221D)
    chalk: '#FCFCFC', // $30 (was #F1EDE2)
    washYellow: '#F0BC3C', // $28 (was #F0C85F)
    washPink: '#FCBCB0', // $36 (was #EEA6A4)
    washBlue: '#C4D4FC', // $32 (was #9DC3DF)
    washGreen: '#A8F0BC', // $3A (was #A7C79A)
    washLilac: '#D4C8FC', // $33 (was #BFB2DC)
    washRed: '#FC7460', // $26 (was #D2685A)
    washCream: '#FCD8A8', // $37 (was #EFE1C2)
    washBrown: '#FCD8A8', // $37 (was #C09A6B)
    blush: '#FCBCB0', // $36 (was #EFA7A7)
    // 2.2 subject palette — claude-quest: the pixel platformer game palette.
    // Every colour on screen is one of these names; scenes never use hex literals.
    sky: '#5C94FC', // $22
    cloudWhite: '#FCFCFC', // $30
    cloudShade: '#A8E4FC', // $31
    bushGreen: '#80D010', // $29
    hillGreen: '#00A800', // $1A
    leafDeep: '#005000', // $0A
    pipeGreen: '#00A800', // $1A
    pipeLight: '#80D010', // $29
    pipeDeep: '#000000', // $0F
    brickMain: '#C84C0C', // $17
    brickDeep: '#7C0800', // $07
    brickLine: '#000000', // $0F
    brickHi: '#FCBCB0', // $36
    blockBrown: '#C84C0C', // $17
    blockDeep: '#402C00', // $08
    qAmber: '#FC9838', // $27
    qDeep: '#C84C0C', // $17
    qHi: '#FCE4A0', // $38
    usedBlock: '#C84C0C', // $17
    usedDeep: '#000000', // $0F
    coinGold: '#F0BC3C', // $28
    coinDeep: '#887000', // $18
    clawdOrange: '#FC7460', // $26
    clawdDeep: '#C84C0C', // $17
    clawdLight: '#FCBCB0', // $36
    inkDark: '#000000', // $0F
    bugBrown: '#7C0800', // $07
    bugDeep: '#000000', // $0F
    eyeWhite: '#FCFCFC', // $30
    shellGreen: '#00A800', // $1A
    shellDeep: '#005000', // $0A
    bellyCream: '#FCD8A8', // $37
    pearlCream: '#FCD8A8', // $37
    pearlPink: '#FC74B4', // $25
    pearlDeep: '#E40058', // $15
    crownGold: '#F0BC3C', // $28
    castleBrick: '#C84C0C', // $17
    castleDeep: '#7C0800', // $07
    doorBlack: '#000000', // $0F
    hudWhite: '#FCFCFC', // $30
    fireOrange: '#FC9838', // $27
    fireYellow: '#F0BC3C', // $28
    sparkle: '#FCFCFC', // $30
    caveBrick: '#0070EC', // $11
    caveDeep: '#24188C', // $01
    caveBlack: '#000000', // $0F
    caveHi: '#3CBCFC', // $21  (added: underground tile highlight)
    heartRed: '#E40058', // $15
    // Scene code reads them as lib.pal.<name>.
    // 2.3 cool schematic palette (blueprint plate)
    navy: '#183C5C', // $0C (was #0B1230)
    navyDeep: '#000000', // $0F (was #060A1C)
    navyLight: '#183C5C', // $0C (was #18234D)
    grid: '#183C5C', // $0C (was #3A4A86)
    lavender: '#D4C8FC', // $33 (was #C8C1EF)
    lineWhite: '#FCFCFC', // $30 (was #EEF0FF)
    paleBlue: '#C4D4FC', // $32 (was #9CC2EA)
    glow: '#FCFCFC', // $30 (was #FFF3DC)
    magenta: '#FC74B4', // $25 (was #FF3D98)
    // Subject identity tints — 1 to 3 per film, from art-bible 2.3, e.g. schemHero: '#F2A66A'.
    // Line or dot colours only, never fills; a schematic shot uses at most one besides magenta.
    // 2.4 overlay colours on illustrations
    annMagenta: '#FC74B4', // $25 (was #E43D8C)
    annBlue: '#5C94FC', // $22 (was #3B8EE0)
    annYellow: '#F0BC3C', // $28 (was #EAB530)
  };
  // earlier names kept as aliases
  pal.stripeA = pal.stripeCream;
  pal.stripeB = pal.stripeYellow;
  lib.pal = pal;

  /**
   * NES: the 64-entry NES 2C02 master palette as FCEUX shows it, indexed $00..$3F
   * ($22 #5C94FC sky, $17 #C84C0C, $27 #FC9838, $0F #000000, $30 #FCFCFC).
   * Every pal value above is one of these entries (art bible section 2); $0D/$0E/$0F and the
   * unused $xE/$xF columns are all black, $20 and $30 are both white.
   */
  const NES = Object.freeze([
    '#747474', '#24188C', '#0000A8', '#44009C', '#8C0074', '#A80010', '#A40000', '#7C0800',
    '#402C00', '#004400', '#005000', '#003C14', '#183C5C', '#000000', '#000000', '#000000',
    '#BCBCBC', '#0070EC', '#2038EC', '#8000F0', '#BC00BC', '#E40058', '#D82800', '#C84C0C',
    '#887000', '#009400', '#00A800', '#009038', '#008088', '#000000', '#000000', '#000000',
    '#FCFCFC', '#3CBCFC', '#5C94FC', '#CC88FC', '#F478FC', '#FC74B4', '#FC7460', '#FC9838',
    '#F0BC3C', '#80D010', '#4CDC48', '#58F898', '#00E8D8', '#787878', '#000000', '#000000',
    '#FCFCFC', '#A8E4FC', '#C4D4FC', '#D4C8FC', '#FCC4FC', '#FCC4D8', '#FCBCB0', '#FCD8A8',
    '#FCE4A0', '#E0FCA0', '#A8F0BC', '#B0FCCC', '#9CFCF0', '#C4C4C4', '#000000', '#000000',
  ]);
  lib.NES = NES;

  const rgbCache = {};
  function parseColor(c) {
    if (rgbCache[c]) return rgbCache[c];
    let r = 0, g = 0, b = 0;
    if (c[0] === '#') {
      let h = c.slice(1);
      if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
      const n = parseInt(h.slice(0, 6), 16);
      r = (n >> 16) & 255;
      g = (n >> 8) & 255;
      b = n & 255;
    } else {
      const m = c.match(/[\d.]+/g) || [0, 0, 0];
      r = +m[0];
      g = +m[1];
      b = +m[2];
    }
    return (rgbCache[c] = [r, g, b]);
  }
  lib.rgb = parseColor;
  /** rgba('#hex' or pal colour, alpha) : css string. */
  lib.rgba = (c, a = 1) => {
    const [r, g, b] = parseColor(c);
    return `rgba(${r},${g},${b},${a})`;
  };
  /** mix(colorA, colorB, t) : css string between two colours. */
  lib.mix = (a, b, t) => {
    const A = parseColor(a);
    const B = parseColor(b);
    return `rgb(${Math.round(lerp(A[0], B[0], t))},${Math.round(lerp(A[1], B[1], t))},${Math.round(lerp(A[2], B[2], t))})`;
  };

  // ===========================================================================
  // Geometry helpers
  // ===========================================================================

  const XY = (p) => (Array.isArray(p) ? p : [p.x, p.y]);

  lib.ellipsePts = (cx, cy, rx, ry = rx, n = 64, rot = 0) => {
    const out = [];
    const cr = Math.cos(rot), sr = Math.sin(rot);
    for (let i = 0; i < n; i++) {
      const a = (i / n) * TAU;
      const x = Math.cos(a) * rx, y = Math.sin(a) * ry;
      out.push([cx + x * cr - y * sr, cy + x * sr + y * cr]);
    }
    return out;
  };
  lib.rectPts = (x, y, w, h, stepPx = 24) => {
    const out = [];
    const edge = (x0, y0, x1, y1) => {
      const n = Math.max(1, Math.ceil(Math.hypot(x1 - x0, y1 - y0) / stepPx));
      for (let i = 0; i < n; i++) out.push([lerp(x0, x1, i / n), lerp(y0, y1, i / n)]);
    };
    edge(x, y, x + w, y);
    edge(x + w, y, x + w, y + h);
    edge(x + w, y + h, x, y + h);
    edge(x, y + h, x, y);
    return out;
  };
  lib.rrectPts = (x, y, w, h, r, stepPx = 24) => {
    r = Math.min(r, w / 2, h / 2);
    const out = [];
    const line = (x0, y0, x1, y1) => {
      const n = Math.max(1, Math.ceil(Math.hypot(x1 - x0, y1 - y0) / stepPx));
      for (let i = 0; i < n; i++) out.push([lerp(x0, x1, i / n), lerp(y0, y1, i / n)]);
    };
    const corner = (cx, cy, a0) => {
      const n = Math.max(2, Math.ceil((r * Math.PI) / 2 / (stepPx * 0.5)));
      for (let i = 0; i < n; i++) {
        const a = a0 + (i / n) * (Math.PI / 2);
        out.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r]);
      }
    };
    line(x + r, y, x + w - r, y);
    corner(x + w - r, y + r, -Math.PI / 2);
    line(x + w, y + r, x + w, y + h - r);
    corner(x + w - r, y + h - r, 0);
    line(x + w - r, y + h, x + r, y + h);
    corner(x + r, y + h - r, Math.PI / 2);
    line(x, y + h - r, x, y + r);
    corner(x + r, y + r, Math.PI);
    return out;
  };
  /** capsulePts(cx, cy, length, radius, rot, n) : a stadium shape along its rotated long axis. */
  lib.capsulePts = (cx, cy, len, r, rot = 0, n = 72) => {
    const out = [];
    const half = Math.max(0, len / 2 - r);
    const cr = Math.cos(rot), sr = Math.sin(rot);
    const k = Math.floor(n / 2);
    for (let i = 0; i <= k; i++) {
      const a = -Math.PI / 2 + (i / k) * Math.PI;
      const x = half + Math.cos(a) * r, y = Math.sin(a) * r;
      out.push([cx + x * cr - y * sr, cy + x * sr + y * cr]);
    }
    for (let i = 0; i <= k; i++) {
      const a = Math.PI / 2 + (i / k) * Math.PI;
      const x = -half + Math.cos(a) * r, y = Math.sin(a) * r;
      out.push([cx + x * cr - y * sr, cy + x * sr + y * cr]);
    }
    return out;
  };

  /** tracePath(ctx, pts, closed=true) : adds the polyline to the current path (no beginPath). */
  lib.tracePath = (ctx, pts, closed = true) => {
    for (let i = 0; i < pts.length; i++) {
      const p = XY(pts[i]);
      if (i === 0) ctx.moveTo(p[0], p[1]);
      else ctx.lineTo(p[0], p[1]);
    }
    if (closed) ctx.closePath();
  };

  /**
   * Centripetal Catmull-Rom resample (no overshoot or cusps where long and short segments meet).
   * Returns a flat [x0,y0,x1,y1,...] array (closed: no duplicate end).
   */
  function sampleFlat(P, closed, step, smooth) {
    const n = P.length;
    const out = [];
    const segs = closed ? n : n - 1;
    for (let i = 0; i < segs; i++) {
      const p1 = P[i];
      const p2 = P[(i + 1) % n];
      const d = Math.hypot(p2[0] - p1[0], p2[1] - p1[1]);
      const k = Math.max(1, Math.ceil(d / step));
      if (!smooth || n < 3) {
        for (let j = 0; j < k; j++) out.push(lerp(p1[0], p2[0], j / k), lerp(p1[1], p2[1], j / k));
        continue;
      }
      let p0, p3;
      if (closed) {
        p0 = P[(i - 1 + n) % n];
        p3 = P[(i + 2) % n];
      } else {
        p0 = i > 0 ? P[i - 1] : [2 * p1[0] - p2[0], 2 * p1[1] - p2[1]];
        p3 = i + 2 < n ? P[i + 2] : [2 * p2[0] - p1[0], 2 * p2[1] - p1[1]];
      }
      const t1 = Math.sqrt(Math.hypot(p1[0] - p0[0], p1[1] - p0[1])) || 1e-4;
      const t2 = t1 + (Math.sqrt(d) || 1e-4);
      const t3 = t2 + (Math.sqrt(Math.hypot(p3[0] - p2[0], p3[1] - p2[1])) || 1e-4);
      for (let j = 0; j < k; j++) {
        const t = t1 + (t2 - t1) * (j / k);
        const a1x = ((t1 - t) / t1) * p0[0] + (t / t1) * p1[0];
        const a1y = ((t1 - t) / t1) * p0[1] + (t / t1) * p1[1];
        const a2x = ((t2 - t) / (t2 - t1)) * p1[0] + ((t - t1) / (t2 - t1)) * p2[0];
        const a2y = ((t2 - t) / (t2 - t1)) * p1[1] + ((t - t1) / (t2 - t1)) * p2[1];
        const a3x = ((t3 - t) / (t3 - t2)) * p2[0] + ((t - t2) / (t3 - t2)) * p3[0];
        const a3y = ((t3 - t) / (t3 - t2)) * p2[1] + ((t - t2) / (t3 - t2)) * p3[1];
        const b1x = ((t2 - t) / t2) * a1x + (t / t2) * a2x;
        const b1y = ((t2 - t) / t2) * a1y + (t / t2) * a2y;
        const b2x = ((t3 - t) / (t3 - t1)) * a2x + ((t - t1) / (t3 - t1)) * a3x;
        const b2y = ((t3 - t) / (t3 - t1)) * a2y + ((t - t1) / (t3 - t1)) * a3y;
        out.push(((t2 - t) / (t2 - t1)) * b1x + ((t - t1) / (t2 - t1)) * b2x, ((t2 - t) / (t2 - t1)) * b1y + ((t - t1) / (t2 - t1)) * b2y);
      }
    }
    if (!closed) out.push(P[n - 1][0], P[n - 1][1]);
    return out;
  }

  /** smoothPts(pts, closed, step=6) : Catmull-Rom resampled points as [[x,y],...]. */
  lib.smoothPts = (pts, closed = true, step = 6) => {
    const f = sampleFlat(pts.map(XY), closed, step, true);
    const out = [];
    for (let i = 0; i < f.length; i += 2) out.push([f[i], f[i + 1]]);
    return out;
  };

  function toPolys(clip) {
    if (!Array.isArray(clip) || !clip.length) return null;
    const first = clip[0];
    if (Array.isArray(first) && typeof first[0] === 'number') return [clip];
    if (first && typeof first.x === 'number') return [clip.map(XY)];
    return clip.map((poly) => poly.map(XY));
  }

  /** polyContains(pointsOrPolys, x, y) : even-odd point-in-polygon. */
  function polysContain(polys, x, y) {
    let inside = false;
    for (let p = 0; p < polys.length; p++) {
      const poly = polys[p];
      for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
        const xi = poly[i][0], yi = poly[i][1], xj = poly[j][0], yj = poly[j][1];
        if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
      }
    }
    return inside;
  }
  lib.polyContains = (clip, x, y) => polysContain(toPolys(clip), x, y);

  function polysBounds(polys) {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const poly of polys) {
      for (const p of poly) {
        if (p[0] < x0) x0 = p[0];
        if (p[1] < y0) y0 = p[1];
        if (p[0] > x1) x1 = p[0];
        if (p[1] > y1) y1 = p[1];
      }
    }
    return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
  }
  lib.bounds = (pts) => polysBounds(toPolys(pts));

  function normBounds(b) {
    if (!b) return { x: 0, y: 0, w: W(), h: H() };
    if (Array.isArray(b)) return { x: b[0], y: b[1], w: b[2], h: b[3] };
    return b;
  }

  /** Resolves a clip argument into { polys, bounds, hard(ctx) }. */
  function shapeOf(clip, o) {
    const polys = toPolys(clip);
    if (polys) {
      const b = polysBounds(polys);
      const pad = o.pad != null ? o.pad : 0;
      return {
        polys,
        bounds: { x: b.x - pad, y: b.y - pad, w: b.w + 2 * pad, h: b.h + 2 * pad },
        apply(ctx) {
          ctx.beginPath();
          for (const poly of polys) lib.tracePath(ctx, poly, true);
          ctx.clip('evenodd');
        },
      };
    }
    const bounds = normBounds(o.bounds);
    if (typeof clip === 'function') {
      return { polys: null, bounds, apply(ctx) { ctx.beginPath(); clip(ctx); ctx.clip(o.fillRule || 'nonzero'); } };
    }
    if (typeof Path2D !== 'undefined' && clip instanceof Path2D) {
      return { polys: null, bounds, apply(ctx) { ctx.clip(clip, o.fillRule || 'nonzero'); } };
    }
    return { polys: null, bounds, apply: null };
  }

  // ===========================================================================
  // Canvas cache (pure: keyed by every input, LRU)
  // ===========================================================================

  // Sized from the timeline (read lazily: lib loads before timeline.js) so a looping player keeps
  // every shot's paper or blueprint plate warm and does not rebuild one at each shot change.
  const cache = new Map();
  function cacheMax() {
    const tl = FILM.TIMELINE;
    const shots = tl && Array.isArray(tl.shots) ? tl.shots.length : 0;
    return Math.max(24, shots * 2 + 8);
  }
  function cached(key, make) {
    if (cache.has(key)) {
      const v = cache.get(key);
      cache.delete(key);
      cache.set(key, v);
      return v;
    }
    const v = make();
    cache.set(key, v);
    const max = cacheMax();
    while (cache.size > max) cache.delete(cache.keys().next().value);
    return v;
  }
  function newCanvas(w, h) {
    if (FILM.makeCanvas) return FILM.makeCanvas(w, h);
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    return c;
  }
  lib.cached = cached;

  // ===========================================================================
  // Ink lines
  // ===========================================================================

  /*
   * One stroke pass over a resampled centreline (flat arrays X, Y with normals NX, NY and
   * arc length S). Builds a pressure-width ribbon out of quads so every overlap unions cleanly,
   * and fills it in one call.
   */
  function ribbon(ctx, X, Y, NX, NY, S, i0, i1, q) {
    const n = i1 - i0 + 1;
    if (n < 2) return null;
    const s0 = S[i0];
    const L = Math.max(1e-6, S[i1] - s0);
    const DX = new Float64Array(n);
    const DY = new Float64Array(n);
    const bs = q.boilSeed;
    const wf = q.wobbleFreq;
    for (let k = 0; k < n; k++) {
      const i = i0 + k;
      const s = S[i] - s0 + q.phase;
      let d =
        q.wobble * (0.72 * noise1(s * wf, q.seed) + 0.28 * noise1(s * wf * 3.3, q.seed + 1)) +
        q.tremble * noise1(s / 7.5, q.seed + 2) +
        q.boilAmp * noise1(s * wf * 2.2 + 0.37, bs) +
        q.tremble * 0.7 * noise1(s / 6.3, bs + 5) +
        q.offset;
      if (q.closeBlend > 0 && S[i1] - S[i] < q.closeBlend) {
        // pen returning to the start: pull toward the start's displacement, not all the way
        const u = 1 - (S[i1] - S[i]) / q.closeBlend;
        const s2 = s - q.loopLen;
        const d0 =
          q.wobble * (0.72 * noise1(s2 * wf, q.seed) + 0.28 * noise1(s2 * wf * 3.3, q.seed + 1)) +
          q.boilAmp * noise1(s2 * wf * 2.2 + 0.37, bs) +
          q.offset;
        d = lerp(d, d0, u * u * (3 - 2 * u) * 0.8);
      }
      DX[k] = X[i] + NX[i] * d;
      DY[k] = Y[i] + NY[i] * d;
    }
    // width profile
    const Wd = new Float64Array(n);
    const tIn = Math.min(q.taperIn, L * 0.45);
    const tOut = Math.min(q.taperOut, L * 0.45);
    for (let k = 0; k < n; k++) {
      const s = S[i0 + k] - s0;
      let w = q.width;
      if (tIn > 0 && s < tIn) w *= q.minW + (1 - q.minW) * Math.pow(s / tIn, 0.55);
      if (tOut > 0 && L - s < tOut) w *= q.minW + (1 - q.minW) * Math.pow((L - s) / tOut, 0.7);
      w *= 1 + q.widthJitter * (0.6 * noise1(s * 0.012 + 3.1, q.seed + 3) + 0.4 * noise1(s * 0.045, q.seed + 4));
      if (q.swell) w *= 1 + q.swell * Math.sin(Math.PI * clamp(s / L));
      if (q.pressure) w *= q.pressure(s / L);
      Wd[k] = Math.max(0.05, w) * 0.5;
    }
    // offset normals from the displaced line
    const LX = new Float64Array(n), LY = new Float64Array(n), RX = new Float64Array(n), RY = new Float64Array(n);
    for (let k = 0; k < n; k++) {
      const a = k > 0 ? k - 1 : k;
      const b = k < n - 1 ? k + 1 : k;
      let tx = DX[b] - DX[a], ty = DY[b] - DY[a];
      const tl = Math.hypot(tx, ty) || 1;
      tx /= tl;
      ty /= tl;
      const s = S[i0 + k];
      const wl = Math.max(0.03, Wd[k] + q.rough * noise1(s / 3.1, q.seed + 20));
      const wr = Math.max(0.03, Wd[k] + q.rough * noise1(s / 3.1, q.seed + 21));
      LX[k] = DX[k] - ty * wl;
      LY[k] = DY[k] + tx * wl;
      RX[k] = DX[k] + ty * wr;
      RY[k] = DY[k] - tx * wr;
    }
    ctx.beginPath();
    for (let k = 0; k < n - 1; k++) {
      ctx.moveTo(LX[k], LY[k]);
      ctx.lineTo(LX[k + 1], LY[k + 1]);
      ctx.lineTo(RX[k + 1], RY[k + 1]);
      ctx.lineTo(RX[k], RY[k]);
      ctx.closePath();
    }
    // soft round ends
    ctx.moveTo(DX[0] + Wd[0], DY[0]);
    ctx.arc(DX[0], DY[0], Wd[0], 0, TAU);
    ctx.moveTo(DX[n - 1] + Wd[n - 1], DY[n - 1]);
    ctx.arc(DX[n - 1], DY[n - 1], Wd[n - 1], 0, TAU);
    ctx.fill('nonzero');
    return { DX, DY };
  }

  function centreline(pts, closed, step, smooth, startFrac, overlapPx) {
    const P = pts.map(XY);
    let F = sampleFlat(P, closed, step, smooth);
    let m = F.length / 2;
    let loopLen = 0;
    if (closed && m > 2) {
      // rotate so the pen starts at a seeded place, then run past the start
      const st = Math.floor(startFrac * m) % m;
      const R = new Array(F.length);
      for (let k = 0; k < m; k++) {
        R[2 * k] = F[2 * ((k + st) % m)];
        R[2 * k + 1] = F[2 * ((k + st) % m) + 1];
      }
      for (let k = 0; k < m; k++) loopLen += Math.hypot(R[(2 * (k + 1)) % R.length] - R[2 * k], R[((2 * (k + 1)) % R.length) + 1] - R[2 * k + 1]);
      R.push(R[0], R[1]);
      let acc = 0;
      for (let k = 1; k <= m && acc < overlapPx; k++) {
        const x = R[2 * (k % m)], y = R[2 * (k % m) + 1];
        acc += Math.hypot(x - R[R.length - 2], y - R[R.length - 1]);
        R.push(x, y);
      }
      F = R;
      m = F.length / 2;
    }
    const X = new Float64Array(m), Y = new Float64Array(m), S = new Float64Array(m);
    for (let k = 0; k < m; k++) {
      X[k] = F[2 * k];
      Y[k] = F[2 * k + 1];
      if (k > 0) S[k] = S[k - 1] + Math.hypot(X[k] - X[k - 1], Y[k] - Y[k - 1]);
    }
    const NX = new Float64Array(m), NY = new Float64Array(m);
    for (let k = 0; k < m; k++) {
      const a = Math.max(0, k - 2), b = Math.min(m - 1, k + 2);
      let tx = X[b] - X[a], ty = Y[b] - Y[a];
      const tl = Math.hypot(tx, ty) || 1;
      NX[k] = -ty / tl;
      NY[k] = tx / tl;
    }
    return { X, Y, S, NX, NY, m, loopLen };
  }

  /**
   * inkPath(ctx, points, opts) : a hand-inked line or closed shape.
   *   closed      false
   *   width       3        nominal pen width (art bible: hero 5, secondary 3, detail 1.8)
   *   color       pal.ink
   *   alpha       1
   *   seed        1        give each drawn object its own seed so their wobbles differ
   *   smooth      true     Catmull-Rom through the points (false = straight segments)
   *   step        2.5      resample spacing in px
   *   wobble      2        low-frequency drift amplitude (px)
   *   wobbleFreq  1/150    drift frequency (cycles per px)
   *   tremble     0.4      high-frequency hand tremble (px)
   *   rough       0.22+0.07*width  ragged ink edge (px), each side independent
   *   boil        auto     drawing index (default lib.boil(lib.T)); false freezes the line
   *   boilAmp     0.7      how far the line moves between boil drawings (px)
   *   taper       [18,34]  px of taper at start and end (number = both)
   *   minWidth    0.14     width fraction at the very tips
   *   swell       0.2      extra width through the middle of an open stroke
   *   widthJitter 0.34     pressure variation (slow plus a faster drag)
   *   pressure    null     fn(u 0..1) => width multiplier
   *   overlap     14       closed shapes: how far the pen runs past its start (px)
   *   fill        null     closed shapes: fill colour under the line (uses the wobbled outline)
   *   fillAlpha   1
   *   draw        1        draw-on progress 0..1 along the stroke (0 draws nothing; a fill waits for 1)
   *   double      false    true or { offset, width, alpha, from, to, seed }: a second quick retrace
   *                        (defaults: 30 percent of the width, min 1.5 px at 5 px, 3 px clear of the line, alpha 0.4)
   */
  function inkPath(ctx, pts, o = {}) {
    if (!pts || pts.length < 2) return;
    const drawP = o.draw == null ? 1 : clamp(o.draw);
    if (drawP <= 0) return;
    const closed = !!o.closed;
    const seed = seedInt(o.seed === undefined ? 1 : o.seed);
    const width = o.width != null ? o.width : 3;
    const step = o.step || 2.5;
    const smooth = o.smooth !== false;
    const taper = o.taper != null ? o.taper : closed ? [10, 22] : [18, 34];
    const tIn = Array.isArray(taper) ? taper[0] : taper;
    const tOut = Array.isArray(taper) ? taper[1] : taper;
    const overlap = closed ? (o.overlap != null ? o.overlap : 14) : 0;
    const C = centreline(pts, closed, step, smooth, closed ? h3(seed, 11, 3) : 0, overlap);
    if (C.m < 2) return;
    const b = boilIndex(o);
    const q = {
      seed,
      width,
      wobble: o.wobble != null ? o.wobble : 2,
      wobbleFreq: o.wobbleFreq || 1 / 150,
      tremble: o.tremble != null ? o.tremble : 0.4,
      rough: o.rough != null ? o.rough : 0.22 + width * 0.07,
      boilAmp: o.boil === false ? 0 : o.boilAmp != null ? o.boilAmp : 0.7,
      boilSeed: (hash(seed, b) | 0) & 0x7fffffff,
      taperIn: tIn,
      taperOut: tOut,
      minW: o.minWidth != null ? o.minWidth : 0.14,
      swell: closed ? 0 : o.swell != null ? o.swell : 0.2,
      widthJitter: o.widthJitter != null ? o.widthJitter : 0.34,
      pressure: o.pressure || null,
      offset: 0,
      phase: 0,
      closeBlend: closed ? Math.min(60, C.loopLen * 0.25) + overlap : 0,
      loopLen: C.loopLen,
    };
    let iEnd = C.m - 1;
    if (drawP < 1) {
      // stop the pen partway along the centreline; a partial closed shape gets no fill and no
      // close-blend, and its tip is blunt rather than tapered to nothing
      const Lp = C.S[C.m - 1] * drawP;
      while (iEnd > 1 && C.S[iEnd] > Lp) iEnd--;
      q.closeBlend = 0;
      q.taperOut = Math.min(q.taperOut, 6);
    }
    ctx.save();
    const color = o.color || pal.ink;
    const alpha = o.alpha != null ? o.alpha : 1;
    if (closed && o.fill && drawP >= 1) {
      // fill follows the wobbled outline (without the overlap run)
      const F = ribbonLine(C, q, 0, Math.max(1, C.m - 1));
      ctx.beginPath();
      for (let k = 0; k < F.n; k++) {
        if (C.S[k] > C.loopLen) break;
        if (k === 0) ctx.moveTo(F.DX[k], F.DY[k]);
        else ctx.lineTo(F.DX[k], F.DY[k]);
      }
      ctx.closePath();
      ctx.globalAlpha *= o.fillAlpha != null ? o.fillAlpha : 1;
      ctx.fillStyle = o.fill;
      ctx.fill();
      ctx.restore();
      ctx.save();
    }
    ctx.globalAlpha *= alpha;
    ctx.fillStyle = color;
    ribbon(ctx, C.X, C.Y, C.NX, C.NY, C.S, 0, iEnd, q);
    if (o.double && drawP >= 1) {
      const d = o.double === true ? {} : o.double;
      const ds = seedInt(d.seed != null ? d.seed : seed + 977);
      const r = rng(ds);
      const L = C.S[C.m - 1];
      let f0 = d.from != null ? d.from : closed ? r.range(0, 0.35) : r.range(0.03, 0.18);
      let f1 = d.to != null ? d.to : closed ? f0 + r.range(0.45, 0.75) : r.range(0.72, 0.95);
      f1 = Math.min(1, f1);
      let i0 = 0, i1 = C.m - 1;
      while (i0 < C.m - 1 && C.S[i0] < f0 * L) i0++;
      while (i1 > i0 && C.S[i1] > f1 * L) i1--;
      const q2 = Object.assign({}, q, {
        seed: ds,
        width: d.width != null ? width * d.width : Math.max(1.2, width * 0.3),
        rough: 0.15 + (d.width != null ? width * d.width : Math.max(1.2, width * 0.3)) * 0.07,
        offset: d.offset != null ? d.offset : (width / 2 + 3) * (r() < 0.5 ? -1 : 1),
        wobble: q.wobble * 1.3,
        boilSeed: (hash(ds, b) | 0) & 0x7fffffff,
        taperIn: Math.max(tIn, 26),
        taperOut: Math.max(tOut, 40),
        closeBlend: 0,
        swell: 0.35,
      });
      ctx.globalAlpha *= d.alpha != null ? d.alpha : 0.4;
      ribbon(ctx, C.X, C.Y, C.NX, C.NY, C.S, i0, i1, q2);
    }
    ctx.restore();
  }

  // displaced centreline only (for fills)
  function ribbonLine(C, q, i0, i1) {
    const n = i1 - i0 + 1;
    const DX = new Float64Array(n), DY = new Float64Array(n);
    const wf = q.wobbleFreq;
    for (let k = 0; k < n; k++) {
      const i = i0 + k;
      const s = C.S[i];
      const d =
        q.wobble * (0.72 * noise1(s * wf, q.seed) + 0.28 * noise1(s * wf * 3.3, q.seed + 1)) +
        q.boilAmp * noise1(s * wf * 2.2 + 0.37, q.boilSeed);
      DX[k] = C.X[i] + C.NX[i] * d;
      DY[k] = C.Y[i] + C.NY[i] * d;
    }
    return { DX, DY, n };
  }

  lib.inkPath = inkPath;

  // ===========================================================================
  // Photo-doodle mode: watercolour wash, photo cut-outs, handwriting
  // Inert in a zero-asset film — nothing below is called unless a scene calls it.
  // ===========================================================================

  /**
   * wash(ctx, pts, opts) : a translucent watercolour fill that deliberately misses its outline.
   *   color      pal.washYellow or pal.sunYellow   alpha 0.55   seed 1
   *   offset     [4, 3]   px shift off the ink outline (the mis-registration is the look)
   *   spread     3        px of edge wobble   p 1   fade-in 0..1 (the wash arrives after its outline)
   *   edge       0.35     darker pigment rim strength (0 = none)
   */
  lib.wash = (ctx, pts, o = {}) => {
    const p = o.p == null ? 1 : clamp(o.p);
    if (p <= 0 || !pts || pts.length < 3) return;
    const seed = seedInt(o.seed == null ? 1 : o.seed);
    const off = o.offset || [4, 3];
    const spread = o.spread != null ? o.spread : 3;
    const color = o.color || pal.washYellow || pal.sunYellow || pal.ink;
    const sm = lib.smoothPts(pts, true, 5);
    const n = sm.length;
    let cx = 0, cy = 0;
    for (const q of sm) { cx += q[0]; cy += q[1]; }
    cx /= n; cy /= n;
    const ring = (amp, sd) => {
      ctx.beginPath();
      for (let i = 0; i < n; i++) {
        const [x, y] = sm[i];
        const dx = x - cx, dy = y - cy, dl = Math.hypot(dx, dy) || 1;
        const d = amp * noise1(i * 0.09, sd) + amp * 0.4 * noise1(i * 0.31, sd + 7);
        const X = x + off[0] + (dx / dl) * d, Y = y + off[1] + (dy / dl) * d;
        if (i === 0) ctx.moveTo(X, Y); else ctx.lineTo(X, Y);
      }
      ctx.closePath();
    };
    ctx.save();
    ctx.globalAlpha *= (o.alpha != null ? o.alpha : 0.55) * p;
    ctx.fillStyle = color;
    ring(spread, seed);
    ctx.fill();
    const edge = o.edge != null ? o.edge : 0.35;
    if (edge > 0) {
      ctx.globalAlpha *= edge;
      ctx.strokeStyle = color;
      ctx.lineWidth = 2.2;
      ctx.lineJoin = 'round';
      ring(spread * 1.2, seed + 3);
      ctx.stroke();
    }
    ctx.restore();
  };

  /**
   * photo(ctx, id, cx, baseY, opts) : a background-removed photograph standing on the paper, with a
   * soft contact shadow. Positioned by bottom-centre, so objects sit on a floor line.
   *   h (height px, default 620) or w   rot 0 (radians, about the base centre)   scale 1 (pop-in)
   *   shadow 0.38 (contact shadow alpha, 0 = none)   alpha 1
   * Returns { x, y, w, h } of the unscaled, unrotated placement — anchor doodles off this rather
   * than off guessed pixels. Returns null when the id is not in FILM.PHOTOS.
   *
   * One caution the gate will catch late: drawing the SAME photo at two different sizes in one page
   * can resample differently once the browser has a texture history for it, which reads as
   * non-determinism. If a film needs a photo at two sizes (an end-card grid of every shot), draw the
   * small one through an offscreen canvas at 1:1 instead of scaling it live.
   */
  lib.photo = (ctx, id, cx, baseY, o = {}) => {
    const F = typeof window !== 'undefined' ? window.FILM : globalThis.FILM;
    const img = F && F.photo ? F.photo(id) : null;
    const meta = F && F.PHOTOS ? F.PHOTOS[id] : null;
    if (!img || !meta) return null;
    const h = o.w != null ? (o.w * meta.h) / meta.w : o.h != null ? o.h : 620;
    const w = (h * meta.w) / meta.h;
    const box = { x: cx - w / 2, y: baseY - h, w, h };
    const sc = o.scale != null ? o.scale : 1;
    if (sc <= 0) return box;
    ctx.save();
    ctx.globalAlpha *= o.alpha != null ? o.alpha : 1;
    const sh = o.shadow != null ? o.shadow : 0.38;
    if (sh > 0) {
      const g = ctx.createRadialGradient(cx, baseY, 0, cx, baseY, w * 0.62 * sc);
      g.addColorStop(0, `rgba(48,36,24,${sh})`);
      g.addColorStop(0.55, `rgba(48,36,24,${sh * 0.42})`);
      g.addColorStop(1, 'rgba(48,36,24,0)');
      ctx.save();
      ctx.translate(cx, baseY);
      ctx.scale(1, 0.14);
      ctx.translate(-cx, -baseY);
      ctx.fillStyle = g;
      ctx.fillRect(cx - w, baseY - w, w * 2, w * 2);
      ctx.restore();
    }
    ctx.translate(cx, baseY);
    if (o.rot) ctx.rotate(o.rot);
    ctx.scale(sc, sc);
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(img, -w / 2, -h, w, h);
    ctx.restore();
    return box;
  };

  /**
   * hand(ctx, str, x, y, opts) : handwritten marker lettering in a system hand face (no font files),
   * revealed letter by letter with p. Weights above 700 fall out of the hand faces onto a geometric
   * fallback, so they are clamped.
   */
  lib.hand = (ctx, str, x, y, o = {}) => {
    const q = Object.assign({ size: 46, color: pal.ink }, o);
    q.family = HAND_STACK;
    q.weight = Math.min(700, Number(q.weight) || 400);
    return lib.text(ctx, str, x, y, q);
  };
  lib.inkLine = (ctx, x1, y1, x2, y2, o = {}) => inkPath(ctx, [[x1, y1], [x2, y2]], Object.assign({ smooth: false }, o));
  lib.inkCircle = (ctx, cx, cy, r, o = {}) =>
    inkPath(ctx, lib.ellipsePts(cx, cy, r, o.ry != null ? o.ry : r, Math.max(24, Math.ceil(r * 0.6)), o.rot || 0), Object.assign({ closed: true }, o));
  lib.inkLine = (ctx, x1, y1, x2, y2, o = {}) => inkPath(ctx, [[x1, y1], [x2, y2]], Object.assign({ smooth: false }, o));
  lib.inkCircle = (ctx, cx, cy, r, o = {}) =>
    inkPath(ctx, lib.ellipsePts(cx, cy, r, o.ry != null ? o.ry : r, Math.max(24, Math.ceil(r * 0.6)), o.rot || 0), Object.assign({ closed: true }, o));

  // ===========================================================================
  // Hatching
  // ===========================================================================

  /**
   * hatch(ctx, clip, opts) : parallel pen strokes that build tone inside a shape.
   *   angle        -PI/4    stroke direction (radians): 45 degrees rising left to right
   *   spacing      8        px between rows at full density (art bible: 12 light, 8 mid, 5 dark)
   *   width        1.4      pen width (art bible: 1.2 to 1.8)
   *   color        pal.ink
   *   alpha        0.9
   *   density      1        0..1, or fn(x, y) => 0..1. Rows drop out evenly as density falls and
   *                         stroke ends stagger along the tone edge, like a hand building shade.
   *   length       [16,64]  stroke length range (px)
   *   gap          [2,7]    px between strokes along a row
   *   inset        6        polygons: how far a stroke may stop short of the edge
   *   overshoot    3        polygons: how far a stroke may cross the edge
   *   angleJitter  0.052    per stroke (+-3 degrees)
   *   spacingJitter 0.3     fraction of spacing (+-15 percent)
   *   flow         0.05     slow angle drift across the rows (radians)
   *   bow          0.7      random sideways bow per stroke (px)
   *   bend         0        consistent bow (px), follows a rounded form
   *   taper        0.3      width at the flick end (fraction)
   *   edge         0.12     how ragged the tone edge is (threshold noise)
   *   boilAmp      0.45     endpoint shimmer per boil drawing (px)
   *   clip         false    polygons: also hard-clip to the polygon
   *   bounds       frame    area to fill when clip is a function, Path2D or null
   *   seed         7
   */
  const PHI = 0.6180339887498949;
  function hatch(ctx, clip, o = {}) {
    const shape = shapeOf(clip, o);
    const seed = seedInt(o.seed === undefined ? 7 : o.seed);
    const r = rng(seed);
    const angle = o.angle != null ? o.angle : -Math.PI / 4;
    const spacing = Math.max(0.8, o.spacing || 8);
    const width = o.width != null ? o.width : 1.4;
    const density = o.density != null ? o.density : 1;
    const densFn = typeof density === 'function' ? density : null;
    const len = o.length || [16, 64];
    const gap = o.gap || [2, 7];
    const inset = o.inset != null ? o.inset : 6;
    const over = o.overshoot != null ? o.overshoot : 3;
    const aJ = o.angleJitter != null ? o.angleJitter : 0.052;
    const sJ = o.spacingJitter != null ? o.spacingJitter : 0.3;
    const flow = o.flow != null ? o.flow : 0.05;
    const bow = o.bow != null ? o.bow : 0.7;
    const bend = o.bend || 0;
    const taper = o.taper != null ? o.taper : 0.3;
    const edgeN = o.edge != null ? o.edge : 0.12;
    const boilAmp = o.boil === false ? 0 : o.boilAmp != null ? o.boilAmp : 0.45;
    const bi = boilIndex(o);
    const minLen = Math.max(2, Math.min(len[0] * 0.35, 6));
    const probe = Math.max(3, Math.min(8, len[0] * 0.4));
    const phase = h3(seed, 3, 9);

    const dx = Math.cos(angle), dy = Math.sin(angle);
    const nx = -dy, ny = dx;
    const B = shape.bounds;
    const corners = [[B.x, B.y], [B.x + B.w, B.y], [B.x, B.y + B.h], [B.x + B.w, B.y + B.h]];
    let umin = Infinity, umax = -Infinity, vmin = Infinity, vmax = -Infinity;
    for (const c of corners) {
      const u = c[0] * dx + c[1] * dy, v = c[0] * nx + c[1] * ny;
      if (u < umin) umin = u;
      if (u > umax) umax = u;
      if (v < vmin) vmin = v;
      if (v > vmax) vmax = v;
    }

    let edges = null;
    if (shape.polys) {
      edges = [];
      for (const poly of shape.polys) {
        for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
          const a = poly[j], b = poly[i];
          edges.push(a[0] * dx + a[1] * dy, a[0] * nx + a[1] * ny, b[0] * dx + b[1] * dy, b[0] * nx + b[1] * ny);
        }
      }
    }

    const paths = [new Path2D(), new Path2D(), new Path2D()];
    const spans = [];
    const on = [];
    const xs = [];
    let strokeId = 0;

    const emit = (u, ue, v, row, dAt) => {
      const sl = ue - u;
      const um = (u + ue) / 2;
      const mx = um * dx + v * nx, my = um * dy + v * ny;
      const ja = aJ * (r() * 2 - 1) + (flow ? flow * noise1(row * 0.09, seed + 5) : 0);
      const bw = bend + bow * (r() * 2 - 1);
      const wv = width * lerp(0.78, 1.18, r()) * lerp(0.72, 1, dAt);
      const p = paths[(r() * 3) | 0];
      const sid = strokeId++;
      const ca = Math.cos(angle + ja), sa = Math.sin(angle + ja);
      const half = sl / 2;
      const jb0 = boilAmp ? (h3(sid, row, bi + seed) - 0.5) * 2 * boilAmp : 0;
      const jb1 = boilAmp ? (h3(row, sid, bi + seed + 9) - 0.5) * 2 * boilAmp : 0;
      const pnx = -sa, pny = ca;
      const x0 = mx - ca * half + pnx * jb0, y0 = my - sa * half + pny * jb0;
      const x1 = mx + ca * (half + jb1 * 0.6) + pnx * jb1, y1 = my + sa * (half + jb1 * 0.6) + pny * jb1;
      const w0 = wv * 0.42, w1 = wv * taper * 0.5, wm = wv * 0.5;
      const k = (w0 + w1) * 0.5;
      const cx = mx + pnx * bw * 2, cy = my + pny * bw * 2;
      p.moveTo(x0 + pnx * w0, y0 + pny * w0);
      p.quadraticCurveTo(cx + pnx * (wm * 2 - k), cy + pny * (wm * 2 - k), x1 + pnx * w1, y1 + pny * w1);
      p.lineTo(x1 - pnx * w1, y1 - pny * w1);
      p.quadraticCurveTo(cx - pnx * (wm * 2 - k), cy - pny * (wm * 2 - k), x0 - pnx * w0, y0 - pny * w0);
      p.closePath();
    };

    const breakUp = (a, b, v, row, dAt) => {
      let u = a;
      while (u < b - minLen) {
        let ue = Math.min(u + lerp(len[0], len[1], r()), b);
        if (b - ue < minLen) ue = b;
        if (ue - u >= minLen) emit(u, ue, v, row, dAt);
        u = ue + lerp(gap[0], gap[1], r());
      }
    };

    let row = 0;
    for (let v0 = vmin + spacing * r(); v0 <= vmax; v0 += spacing, row++) {
      const v = v0 + (r() - 0.5) * spacing * sJ;
      // evenly distributed per-row threshold: rows vanish uniformly as density falls
      const rowTh = ((row * PHI + phase) % 1) * 0.94 + 0.03;
      spans.length = 0;
      if (edges) {
        xs.length = 0;
        for (let e = 0; e < edges.length; e += 4) {
          const va = edges[e + 1], vb = edges[e + 3];
          if ((va > v) !== (vb > v)) xs.push(edges[e] + ((v - va) / (vb - va)) * (edges[e + 2] - edges[e]));
        }
        if (xs.length < 2) continue;
        xs.sort((p, q) => p - q);
        for (let k = 0; k + 1 < xs.length; k += 2) spans.push(xs[k], xs[k + 1]);
      } else {
        spans.push(umin, umax);
      }
      if (!densFn && density < rowTh) continue;
      const dConst = densFn ? 1 : clamp(density);
      for (let sp = 0; sp < spans.length; sp += 2) {
        let u0 = spans[sp], u1 = spans[sp + 1];
        if (edges) {
          u0 += lerp(-over, inset, r() * r());
          u1 -= lerp(-over, inset, r() * r());
        } else {
          u0 -= r() * len[1];
        }
        if (u1 - u0 < minLen) continue;
        if (!densFn) {
          breakUp(u0, u1, v, row, dConst);
          continue;
        }
        // walk the row; strokes live where density beats the (slightly noisy) row threshold
        on.length = 0;
        let start = null;
        let dSum = 0, dN = 0;
        for (let u = u0; ; u += probe) {
          const uu = Math.min(u, u1);
          const d = clamp(densFn(uu * dx + v * nx, uu * dy + v * ny));
          const th = rowTh + edgeN * noise1(uu * 0.02 + row * 7.31, seed + 11);
          if (d > th) {
            if (start === null) start = uu;
            dSum += d;
            dN++;
          } else if (start !== null) {
            on.push(start, uu, dSum / dN);
            start = null;
            dSum = dN = 0;
          }
          if (uu >= u1) break;
        }
        if (start !== null) on.push(start, u1, dSum / Math.max(1, dN));
        for (let k = 0; k < on.length; k += 3) {
          // soften where the tone edge cuts a stroke
          const a = on[k] === u0 ? on[k] : on[k] + (r() - 0.5) * probe;
          const b = on[k + 1] === u1 ? on[k + 1] : on[k + 1] + (r() - 0.5) * probe;
          breakUp(a, b, v, row, on[k + 2]);
        }
      }
    }

    ctx.save();
    if (shape.apply && (!shape.polys || o.clip)) shape.apply(ctx);
    ctx.fillStyle = o.color || pal.ink;
    const alpha = o.alpha != null ? o.alpha : 0.9;
    const A = [0.74, 0.88, 1];
    const base = ctx.globalAlpha;
    for (let k = 0; k < 3; k++) {
      ctx.globalAlpha = base * alpha * A[k];
      ctx.fill(paths[k]);
    }
    ctx.restore();
  }
  lib.hatch = hatch;

  /**
   * crossHatch(ctx, clip, opts) : layered hatching where each extra layer only covers darker tone.
   *   tone     1       0..1 overall darkness (with no density, 0.25 = one layer, 1 = four)
   *   layers   2 (4 when tone is given)  maximum layer count
   *   density  1 or fn(x,y) => 0..1: local darkness; layer i appears where density*tone*layers > i
   *   angle    -PI/4   first layer angle (45 degrees); later layers turn by opts.turn
   *   turn     [-PI/3, 0.3, -1.35]  offsets for layers 2..4: layer 2 at 105 degrees, 3 and 4 thicken 1 and 2
   *   crossSpacing  spacing*1.4  spacing of layers 2..4 (art bible: 5 px base, 7 px cross)
   *   ...all hatch options
   */
  function crossHatch(ctx, clip, o = {}) {
    const layers = o.layers || (o.tone != null ? 4 : 2);
    const tone = o.tone != null ? clamp(o.tone) : 1;
    const d = o.density != null ? o.density : 1;
    const base = o.angle != null ? o.angle : -Math.PI / 4;
    const turn = o.turn || [-Math.PI / 3, 0.3, -1.35];
    const seed = seedInt(o.seed === undefined ? 11 : o.seed);
    for (let i = 0; i < layers; i++) {
      let dens;
      if (typeof d === 'function') {
        dens = (x, y) => clamp(d(x, y) * tone * layers - i);
      } else {
        dens = clamp(d * tone * layers - i);
        if (dens <= 0) break;
      }
      hatch(
        ctx,
        clip,
        Object.assign({}, o, {
          angle: base + (i === 0 ? 0 : turn[(i - 1) % turn.length]),
          seed: seed + i * 7919,
          density: dens,
          spacing: i === 0 ? o.spacing || 8 : o.crossSpacing || (o.spacing || 8) * 1.4,
        })
      );
    }
  }
  lib.crossHatch = crossHatch;

  // ===========================================================================
  // Stipple
  // ===========================================================================

  /**
   * stipple(ctx, clip, opts) : seeded dots on a jittered hex grid.
   *   spacing  7.5      mean px between dots at density 1 (about 0.02 dots per px2)
   *   r        [1.0, 2.2] dot radius range (bigger where density is higher)
   *   density  1 or fn(x,y) => 0..1
   *   jitter   0.45     fraction of spacing
   *   color    pal.ink
   *   alpha    0.9
   *   boilAmp  0.35     px shimmer per boil drawing
   *   clip     true     polygons: skip dots outside; functions/Path2D always hard-clip
   *   seed     13
   */
  function stipple(ctx, clip, o = {}) {
    const shape = shapeOf(clip, o);
    const seed = seedInt(o.seed === undefined ? 13 : o.seed);
    const sp = Math.max(1, o.spacing || 7.5);
    const rr = o.r || [1.0, 2.2];
    const density = o.density != null ? o.density : 1;
    const densFn = typeof density === 'function' ? density : null;
    const jit = (o.jitter != null ? o.jitter : 0.45) * sp;
    const boilAmp = o.boil === false ? 0 : o.boilAmp != null ? o.boilAmp : 0.35;
    const bi = boilIndex(o);
    const B = shape.bounds;
    const rowH = sp * 0.866;
    const p = new Path2D();
    const i0 = Math.floor(B.y / rowH) - 1, i1 = Math.ceil((B.y + B.h) / rowH) + 1;
    const j0 = Math.floor(B.x / sp) - 1, j1 = Math.ceil((B.x + B.w) / sp) + 1;
    for (let i = i0; i <= i1; i++) {
      const off = i & 1 ? sp * 0.5 : 0;
      for (let j = j0; j <= j1; j++) {
        const a = h3(i, j, seed);
        const b = h3(j, i, seed + 1);
        const c = h3(i + 7, j - 3, seed + 2);
        let x = j * sp + off + (a - 0.5) * 2 * jit;
        let y = i * rowH + (b - 0.5) * 2 * jit;
        if (x < B.x || x > B.x + B.w || y < B.y || y > B.y + B.h) continue;
        const dAt = densFn ? clamp(densFn(x, y)) : density;
        if (c >= dAt) continue;
        if (shape.polys && !polysContain(shape.polys, x, y)) continue;
        if (boilAmp) {
          x += (h3(i, j, seed + bi * 31 + 5) - 0.5) * 2 * boilAmp;
          y += (h3(j, i, seed + bi * 37 + 6) - 0.5) * 2 * boilAmp;
        }
        const rad = lerp(rr[0], rr[1], clamp(h3(j, i, seed + 3) * 0.55 + dAt * 0.45));
        p.moveTo(x + rad, y);
        p.arc(x, y, rad, 0, TAU);
      }
    }
    ctx.save();
    if (shape.apply && !shape.polys) shape.apply(ctx);
    ctx.globalAlpha *= o.alpha != null ? o.alpha : 0.9;
    ctx.fillStyle = o.color || pal.ink;
    ctx.fill(p);
    ctx.restore();
  }
  lib.stipple = stipple;

  // ===========================================================================
  // Backgrounds: paper, blueprint, stripes
  // ===========================================================================

  function renderScale() {
    return FILM.S || 1;
  }

  /**
   * paper(ctx, opts) : cream paper with mottling, grain and fibres. Cached by size, seed and options.
   *   x, y, w, h   0, 0, 1080, 1920
   *   color        pal.paper
   *   seed         3
   *   grain        1      fine grain strength
   *   fibres       1      fibre count multiplier
   *   mottle       1      large soft blotches
   *   vignette     0.35   darkened edges
   */
  function paper(ctx, o = {}) {
    const x = o.x || 0, y = o.y || 0;
    const w = o.w || W(), h = o.h || H();
    const S = renderScale();
    const color = o.color || pal.paper;
    const seed = seedInt(o.seed === undefined ? 3 : o.seed);
    const grain = o.grain != null ? o.grain : 1;
    const fibres = o.fibres != null ? o.fibres : 1;
    const mottle = o.mottle != null ? o.mottle : 1;
    const vignette = o.vignette != null ? o.vignette : 0.35;
    const key = ['paper', w, h, S, color, seed, grain, fibres, mottle, vignette].join('|');
    const c = cached(key, () => makePaper(Math.max(1, Math.round(w * S)), Math.max(1, Math.round(h * S)), S, color, seed, grain, fibres, mottle, vignette));
    ctx.drawImage(c, x, y, w, h);
  }

  function makePaper(cw, ch, S, color, seed, grain, fibres, mottle, vignette) {
    const c = newCanvas(cw, ch);
    const g = c.getContext('2d');
    const [br, bg, bb] = parseColor(color);
    // mottling from a low-resolution noise field, upscaled smooth
    const mw = Math.max(4, Math.ceil(cw / 18)), mh = Math.max(4, Math.ceil(ch / 18));
    const mf = new Float32Array(mw * mh);
    for (let j = 0; j < mh; j++) {
      for (let i = 0; i < mw; i++) {
        mf[j * mw + i] = lib.fbm2(i * 0.11, j * 0.11, seed, 4) * 0.8 + noise2(i * 0.5, j * 0.5, seed + 9) * 0.2;
      }
    }
    const img = g.createImageData(cw, ch);
    const d = img.data;
    const fx = (mw - 1) / cw, fy = (mh - 1) / ch;
    const cxv = cw / 2, cyv = ch / 2;
    const vr = Math.hypot(cxv, cyv);
    for (let py = 0; py < ch; py++) {
      const my = py * fy;
      const jy = Math.floor(my), ty = my - jy;
      const jy1 = Math.min(mh - 1, jy + 1);
      for (let px = 0; px < cw; px++) {
        const mx = px * fx;
        const ix = Math.floor(mx), tx = mx - ix;
        const ix1 = Math.min(mw - 1, ix + 1);
        const m =
          lerp(lerp(mf[jy * mw + ix], mf[jy * mw + ix1], tx), lerp(mf[jy1 * mw + ix], mf[jy1 * mw + ix1], tx), ty);
        const n = h3(px, py, seed + 77);
        const n2 = h3(px >> 1, py >> 1, seed + 78);
        const gr = ((n - 0.5) * 0.6 + (n2 - 0.5) * 0.4) * 0.07 * grain;
        const dxv = (px - cxv) / vr, dyv = (py - cyv) / vr;
        const vig = vignette * Math.max(0, dxv * dxv + dyv * dyv - 0.35) * 0.18;
        const k = 1 + m * 0.055 * mottle + gr - vig;
        const i = (py * cw + px) * 4;
        // darker areas go slightly warmer, like aged paper
        d[i] = br * k;
        d[i + 1] = bg * (k - (1 - k) * 0.12);
        d[i + 2] = bb * (k - (1 - k) * 0.35);
        d[i + 3] = 255;
      }
    }
    g.putImageData(img, 0, 0);
    // fibres
    const r = rng(seed + 5);
    const count = Math.round(((cw * ch) / (S * S)) / 1500 * fibres);
    const dark = new Path2D(), light = new Path2D();
    for (let i = 0; i < count; i++) {
      const x = r() * cw, y = r() * ch;
      const L = r.range(5, 26) * S * (r() < 0.08 ? 2.5 : 1);
      const a = r() * TAU;
      const bend = r.range(-0.5, 0.5) * L;
      const p = r() < 0.55 ? dark : light;
      const ex = x + Math.cos(a) * L, ey = y + Math.sin(a) * L;
      p.moveTo(x, y);
      p.quadraticCurveTo((x + ex) / 2 - Math.sin(a) * bend, (y + ey) / 2 + Math.cos(a) * bend, ex, ey);
    }
    g.lineCap = 'round';
    g.lineWidth = 0.7 * S;
    g.strokeStyle = lib.rgba(pal.inkSoft, 0.07);
    g.stroke(dark);
    g.lineWidth = 1.1 * S;
    g.strokeStyle = 'rgba(255,252,242,0.22)';
    g.stroke(light);
    // specks and faint foxing spots
    const specks = new Path2D();
    for (let i = 0; i < count * 0.08; i++) {
      const x = r() * cw, y = r() * ch, rad = r.range(0.3, 1.1) * S;
      specks.moveTo(x + rad, y);
      specks.arc(x, y, rad, 0, TAU);
    }
    g.fillStyle = lib.rgba(pal.inkSoft, 0.22);
    g.fill(specks);
    for (let i = 0; i < 6 * mottle; i++) {
      const x = r() * cw, y = r() * ch, rad = r.range(30, 120) * S;
      const gr = g.createRadialGradient(x, y, 0, x, y, rad);
      gr.addColorStop(0, lib.rgba(pal.paperDeep, 0.07));
      gr.addColorStop(1, lib.rgba(pal.paperDeep, 0));
      g.fillStyle = gr;
      g.fillRect(x - rad, y - rad, rad * 2, rad * 2);
    }
    return c;
  }
  lib.paper = paper;

  /**
   * blueprint(ctx, opts) : navy plate with faint grid, big guide circles, long diagonals and noise.
   * Cached by size, seed and options.
   *   x, y, w, h   0, 0, 1080, 1920
   *   color        pal.navy
   *   seed         5
   *   grid         60      grid pitch (px); 0 turns the grid off
   *   major        5       every Nth grid line is stronger
   *   center       [0.5w, 0.44h]  centre of the guide circles
   *   circles      4
   *   diagonals    5
   *   noise        1
   *   marks        true    corner registration marks
   */
  function blueprint(ctx, o = {}) {
    const x = o.x || 0, y = o.y || 0;
    const w = o.w || W(), h = o.h || H();
    const S = renderScale();
    const opt = {
      color: o.color || pal.navy,
      seed: seedInt(o.seed === undefined ? 5 : o.seed),
      grid: o.grid != null ? o.grid : 60,
      major: o.major || 5,
      center: o.center || [w * 0.5, h * 0.44],
      circles: o.circles != null ? o.circles : 4,
      diagonals: o.diagonals != null ? o.diagonals : 5,
      noise: o.noise != null ? o.noise : 1,
      marks: o.marks !== false,
      line: o.line || pal.lavender,
    };
    const key = ['blueprint', w, h, S, JSON.stringify(opt)].join('|');
    const c = cached(key, () => makeBlueprint(w, h, S, opt));
    ctx.drawImage(c, x, y, w, h);
  }

  function makeBlueprint(w, h, S, o) {
    const cw = Math.max(1, Math.round(w * S)), ch = Math.max(1, Math.round(h * S));
    const c = newCanvas(cw, ch);
    const g = c.getContext('2d');
    const [br, bgc, bb] = parseColor(o.color);
    const [dr, dg, db] = parseColor(pal.navyDeep);
    const [lr, lg, lb] = parseColor(pal.navyLight);
    const img = g.createImageData(cw, ch);
    const d = img.data;
    const ccx = o.center[0] * S, ccy = o.center[1] * S;
    const R = Math.hypot(cw, ch) * 0.62;
    for (let py = 0; py < ch; py++) {
      for (let px = 0; px < cw; px++) {
        const rd = Math.min(1, Math.hypot(px - ccx, py - ccy) / R);
        // light centre falling to deep edges
        const t = rd * rd;
        let r = rd < 0.35 ? lerp(lr, br, rd / 0.35) : lerp(br, dr, (t - 0.1225) / 0.8775);
        let gg = rd < 0.35 ? lerp(lg, bgc, rd / 0.35) : lerp(bgc, dg, (t - 0.1225) / 0.8775);
        let b = rd < 0.35 ? lerp(lb, bb, rd / 0.35) : lerp(bb, db, (t - 0.1225) / 0.8775);
        const n = (h3(px, py, o.seed + 3) - 0.5) * 9 * o.noise + (h3(px >> 2, py >> 2, o.seed + 4) - 0.5) * 5 * o.noise;
        const i = (py * cw + px) * 4;
        d[i] = r + n * 0.8;
        d[i + 1] = gg + n * 0.85;
        d[i + 2] = b + n;
        d[i + 3] = 255;
      }
    }
    g.putImageData(img, 0, 0);
    g.scale(S, S);
    const r = rng(o.seed);
    const line = o.line;
    // grid
    if (o.grid > 0) {
      const minor = new Path2D(), major = new Path2D();
      let k = 0;
      for (let gx = (w / 2) % o.grid; gx <= w; gx += o.grid, k++) {
        const p = Math.round((gx - w / 2) / o.grid) % o.major === 0 ? major : minor;
        p.moveTo(gx, 0);
        p.lineTo(gx, h);
      }
      for (let gy = (h / 2) % o.grid; gy <= h; gy += o.grid) {
        const p = Math.round((gy - h / 2) / o.grid) % o.major === 0 ? major : minor;
        p.moveTo(0, gy);
        p.lineTo(w, gy);
      }
      g.lineWidth = 1;
      g.strokeStyle = lib.rgba(pal.grid, 0.3);
      g.stroke(minor);
      g.strokeStyle = lib.rgba(pal.grid, 0.5);
      g.stroke(major);
    }
    // long diagonals
    const [cx, cy] = o.center;
    for (let i = 0; i < o.diagonals; i++) {
      const a = r.range(0, Math.PI);
      const ox = cx + r.range(-0.35, 0.35) * w, oy = cy + r.range(-0.3, 0.3) * h;
      const L = Math.hypot(w, h);
      g.beginPath();
      g.moveTo(ox - Math.cos(a) * L, oy - Math.sin(a) * L);
      g.lineTo(ox + Math.cos(a) * L, oy + Math.sin(a) * L);
      g.lineWidth = r.range(0.8, 1.3);
      g.strokeStyle = lib.rgba(line, r.range(0.07, 0.14));
      if (r() < 0.35) g.setLineDash([r.range(6, 14), r.range(6, 12)]);
      else g.setLineDash([]);
      g.stroke();
    }
    g.setLineDash([]);
    // guide circles
    const minDim = Math.min(w, h);
    for (let i = 0; i < o.circles; i++) {
      const rad = minDim * (0.2 + i * 0.17) * r.range(0.95, 1.05);
      g.beginPath();
      g.arc(cx, cy, rad, 0, TAU);
      g.lineWidth = i === o.circles - 1 ? 1.4 : 1;
      g.strokeStyle = lib.rgba(line, i % 2 ? 0.1 : 0.16);
      if (i === 1) g.setLineDash([2, 7]);
      else g.setLineDash([]);
      g.stroke();
    }
    g.setLineDash([]);
    if (o.circles > 0) {
      const rad = minDim * (0.2 + (o.circles - 1) * 0.17);
      ticksImpl(g, cx, cy, { r: rad, n: 120, len: 7, major: 10, majorLen: 16, color: line, alpha: 0.2, width: 1 });
      // off-centre satellite circle
      const a = r.range(0, TAU);
      const sr = minDim * r.range(0.07, 0.12);
      g.beginPath();
      g.arc(cx + Math.cos(a) * rad, cy + Math.sin(a) * rad, sr, 0, TAU);
      g.lineWidth = 1;
      g.strokeStyle = lib.rgba(line, 0.14);
      g.stroke();
      // centre crosshair
      g.beginPath();
      g.moveTo(cx - 18, cy);
      g.lineTo(cx + 18, cy);
      g.moveTo(cx, cy - 18);
      g.lineTo(cx, cy + 18);
      g.strokeStyle = lib.rgba(line, 0.22);
      g.stroke();
    }
    // corner registration marks
    if (o.marks) {
      g.strokeStyle = lib.rgba(line, 0.32);
      g.lineWidth = 1.2;
      const m = 34, s = 22;
      for (const [mx, my, sx, sy] of [[m, m, 1, 1], [w - m, m, -1, 1], [m, h - m, 1, -1], [w - m, h - m, -1, -1]]) {
        g.beginPath();
        g.moveTo(mx, my + sy * s);
        g.lineTo(mx, my);
        g.lineTo(mx + sx * s, my);
        g.stroke();
      }
    }
    // faint scattered star specks
    const sp = new Path2D();
    for (let i = 0; i < (w * h) / 5000 * o.noise; i++) {
      const x = r() * w, y = r() * h, rad = r.range(0.4, 1.1);
      sp.moveTo(x + rad, y);
      sp.arc(x, y, rad, 0, TAU);
    }
    g.fillStyle = lib.rgba(pal.lineWhite, 0.22);
    g.fill(sp);
    return c;
  }
  lib.blueprint = blueprint;

  /**
   * stripes(ctx, opts) : the wide diagonal stripe background with softly irregular edges.
   *   colors   [pal.stripeCream, pal.stripeYellow]
   *   width    140     band width (px); both colours use it
   *   angle    -0.52   stripe direction (radians): 30 degrees rising left to right
   *   offset   0       scroll along the normal (animate this)
   *   wobble   1.4     edge irregularity (px)
   *   bounds   frame
   *   seed     21
   */
  function stripes(ctx, o = {}) {
    const B = normBounds(o.bounds);
    const cols = o.colors || [pal.stripeCream, pal.stripeYellow];
    const sw = o.width || 140;
    const angle = o.angle != null ? o.angle : -0.52;
    const offset = o.offset || 0;
    const wobble = o.wobble != null ? o.wobble : 1.4;
    const seed = seedInt(o.seed === undefined ? 21 : o.seed);
    const dx = Math.cos(angle), dy = Math.sin(angle);
    const nx = -dy, ny = dx;
    const cx = B.x + B.w / 2, cy = B.y + B.h / 2;
    const half = Math.hypot(B.w, B.h) / 2 + sw * 2;
    ctx.save();
    ctx.beginPath();
    ctx.rect(B.x, B.y, B.w, B.h);
    ctx.clip();
    ctx.fillStyle = cols[0];
    ctx.fillRect(B.x, B.y, B.w, B.h);
    const period = sw * cols.length;
    const shift = ((offset % period) + period) % period;
    const edge = (v, k, forward) => {
      const pts = [];
      const n = Math.ceil((half * 2) / 40);
      for (let i = 0; i <= n; i++) {
        const u = -half + (i / n) * half * 2;
        const vv = v + wobble * noise1(u * 0.012 + k * 3.7, seed) + wobble * 0.3 * noise1(u * 0.05, seed + k);
        pts.push([cx + dx * u + nx * vv, cy + dy * u + ny * vv]);
      }
      if (!forward) pts.reverse();
      return pts;
    };
    for (let ci = 1; ci < cols.length; ci++) {
      const p = new Path2D();
      const first = Math.floor((-half - shift) / period) - 1;
      const last = Math.ceil((half - shift) / period) + 1;
      for (let k = first; k <= last; k++) {
        const v0 = k * period + shift + sw * ci - half * 0;
        const a = edge(v0, k * 2 + ci, true);
        const b = edge(v0 + sw, k * 2 + ci + 1, false);
        a.forEach((pt, i) => (i === 0 ? p.moveTo(pt[0], pt[1]) : p.lineTo(pt[0], pt[1])));
        b.forEach((pt) => p.lineTo(pt[0], pt[1]));
        p.closePath();
      }
      ctx.fillStyle = cols[ci];
      ctx.fill(p);
    }
    ctx.restore();
  }
  lib.stripes = stripes;

  // ===========================================================================
  // Schematic helpers
  // ===========================================================================

  /**
   * hexLattice(ctx, clip, opts) : hexagonal cell lattice with shared, slightly irregular vertices.
   *   r         16       cell circumradius (px)
   *   pointy    true     pointy-top cells (false = flat-top)
   *   width     1
   *   color     pal.lavender
   *   alpha     0.35
   *   jitter    1.0      vertex irregularity (px), shared by neighbouring cells
   *   inset     0        >0 draws each cell as its own hexagon shrunk by this many px
   *   cellFn    null     fn(cx, cy, i, j) => false (skip) | true | { fill, alpha, stroke }
   *   dots      0        radius of a dot at each cell centre (0 = none)
   *   boilAmp   0.35
   *   clip      true     hard-clip to the shape
   *   bounds    frame    when clip is a function, Path2D or null
   *   seed      17
   */
  function hexLattice(ctx, clip, o = {}) {
    const shape = shapeOf(clip, Object.assign({ pad: (o.r || 16) * 2 }, o));
    const R = o.r || 16;
    const pointy = o.pointy !== false;
    const seed = seedInt(o.seed === undefined ? 17 : o.seed);
    const jitter = o.jitter != null ? o.jitter : 1.0;
    const boilAmp = o.boil === false ? 0 : o.boilAmp != null ? o.boilAmp : 0.35;
    const bi = boilIndex(o);
    const inset = o.inset || 0;
    const B = shape.bounds;
    const sq3 = Math.sqrt(3);
    const colW = pointy ? sq3 * R : 1.5 * R;
    const rowH = pointy ? 1.5 * R : sq3 * R;
    const vtx = (x, y) => {
      const kx = Math.round(x * 4), ky = Math.round(y * 4);
      const jx = (h3(kx, ky, seed) - 0.5) * 2 * jitter + (boilAmp ? (h3(kx, ky, seed + bi * 13 + 1) - 0.5) * 2 * boilAmp : 0);
      const jy = (h3(ky, kx, seed + 2) - 0.5) * 2 * jitter + (boilAmp ? (h3(ky, kx, seed + bi * 17 + 3) - 0.5) * 2 * boilAmp : 0);
      return [x + jx, y + jy];
    };
    const edges = new Path2D();
    const dots = new Path2D();
    const fills = [];
    const i0 = Math.floor(B.y / rowH) - 1, i1 = Math.ceil((B.y + B.h) / rowH) + 1;
    const j0 = Math.floor(B.x / colW) - 1, j1 = Math.ceil((B.x + B.w) / colW) + 1;
    for (let i = i0; i <= i1; i++) {
      for (let j = j0; j <= j1; j++) {
        let cx, cy;
        if (pointy) {
          cx = j * colW + (i & 1 ? colW / 2 : 0);
          cy = i * rowH;
        } else {
          cx = j * colW;
          cy = i * rowH + (j & 1 ? rowH / 2 : 0);
        }
        if (shape.polys && !polysContain(shape.polys, cx, cy)) {
          // keep cells that straddle the edge so the hard clip cuts them cleanly
          let near = false;
          for (let k = 0; k < 6 && !near; k++) {
            const a = (k / 6) * TAU + (pointy ? Math.PI / 6 : 0);
            near = polysContain(shape.polys, cx + Math.cos(a) * R, cy + Math.sin(a) * R);
          }
          if (!near) continue;
        }
        let cell = true;
        if (o.cellFn) {
          cell = o.cellFn(cx, cy, i, j);
          if (!cell) continue;
        }
        const V = [];
        for (let k = 0; k < 6; k++) {
          const a = (k / 6) * TAU + (pointy ? Math.PI / 6 : 0);
          V.push(vtx(cx + Math.cos(a) * R, cy + Math.sin(a) * R));
        }
        if (typeof cell === 'object' && cell.fill) fills.push([V, cell]);
        if (inset > 0) {
          for (let k = 0; k < 6; k++) {
            const v = V[k];
            const f = Math.max(0, 1 - inset / R);
            const x = cx + (v[0] - cx) * f, y = cy + (v[1] - cy) * f;
            if (k === 0) edges.moveTo(x, y);
            else edges.lineTo(x, y);
          }
          edges.closePath();
        } else {
          // three edges per cell so shared edges are drawn once
          const ks = pointy ? [5, 0, 1] : [0, 1, 2];
          for (const k of ks) {
            edges.moveTo(V[k][0], V[k][1]);
            edges.lineTo(V[(k + 1) % 6][0], V[(k + 1) % 6][1]);
          }
          // cells on the left/top border of the drawn set need their other edges
          if (o.cellFn || shape.polys) {
            for (const k of pointy ? [2, 3, 4] : [3, 4, 5]) {
              edges.moveTo(V[k][0], V[k][1]);
              edges.lineTo(V[(k + 1) % 6][0], V[(k + 1) % 6][1]);
            }
          }
        }
        if (o.dots) {
          dots.moveTo(cx + o.dots, cy);
          dots.arc(cx, cy, o.dots, 0, TAU);
        }
      }
    }
    ctx.save();
    if (shape.apply && o.clip !== false) shape.apply(ctx);
    const color = o.color || pal.lavender;
    const alpha = o.alpha != null ? o.alpha : 0.35;
    for (const [V, cell] of fills) {
      ctx.beginPath();
      lib.tracePath(ctx, V, true);
      ctx.globalAlpha = cell.alpha != null ? cell.alpha : 0.35;
      ctx.fillStyle = cell.fill;
      ctx.fill();
    }
    ctx.globalAlpha = alpha;
    ctx.lineWidth = o.width != null ? o.width : 1;
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    ctx.strokeStyle = color;
    ctx.stroke(edges);
    if (o.dots) {
      ctx.fillStyle = color;
      ctx.fill(dots);
    }
    ctx.restore();
  }
  lib.hexLattice = hexLattice;

  function needle(p, x0, y0, x1, y1, w0, w1) {
    const dx = x1 - x0, dy = y1 - y0;
    const L = Math.hypot(dx, dy) || 1;
    const nx = -dy / L, ny = dx / L;
    p.moveTo(x0 + nx * w0, y0 + ny * w0);
    p.lineTo(x1 + nx * w1, y1 + ny * w1);
    p.lineTo(x1 - nx * w1, y1 - ny * w1);
    p.lineTo(x0 - nx * w0, y0 - ny * w0);
    p.closePath();
  }

  /**
   * glowDot(ctx, x, y, r, opts) : soft glow, hot core and star rays (a nucleus, a spark, a star).
   *   color     pal.glow    glow colour
   *   core      '#ffffff'
   *   rays      8           ray count (0 = none); long and short alternate
   *   rayLen    3.4         ray length as a multiple of r
   *   rayWidth  0.22        ray base width as a multiple of r
   *   rot       0
   *   glow      4.5         glow radius as a multiple of r
   *   intensity 1
   *   twinkle   0.18        per boil drawing flicker
   *   additive  true        'lighter' blending (use false on paper)
   *   seed      19
   */
  function glowDot(ctx, x, y, r, o = {}) {
    const seed = seedInt(o.seed === undefined ? 19 : o.seed);
    const bi = boilIndex(o);
    const tw = o.twinkle != null ? o.twinkle : 0.18;
    const k = (o.intensity != null ? o.intensity : 1) * (1 - tw + tw * 2 * h3(bi, seed, 23));
    const color = o.color || pal.glow;
    const glowR = r * (o.glow != null ? o.glow : 4.5);
    ctx.save();
    if (o.additive !== false) ctx.globalCompositeOperation = 'lighter';
    const base = ctx.globalAlpha;
    const g = ctx.createRadialGradient(x, y, 0, x, y, glowR);
    g.addColorStop(0, lib.rgba(color, 0.55 * k));
    g.addColorStop(0.18, lib.rgba(color, 0.22 * k));
    g.addColorStop(0.5, lib.rgba(color, 0.06 * k));
    g.addColorStop(1, lib.rgba(color, 0));
    ctx.fillStyle = g;
    ctx.fillRect(x - glowR, y - glowR, glowR * 2, glowR * 2);
    const rays = o.rays != null ? o.rays : 8;
    if (rays > 0) {
      const p = new Path2D();
      const rot = o.rot || 0;
      const rl = r * (o.rayLen != null ? o.rayLen : 3.4);
      const rw = r * (o.rayWidth != null ? o.rayWidth : 0.22);
      for (let i = 0; i < rays; i++) {
        const a = rot + (i / rays) * TAU;
        const L = (i % 2 ? 0.52 : 1) * rl * (0.9 + 0.2 * h3(i, bi, seed));
        needle(p, x, y, x + Math.cos(a) * L, y + Math.sin(a) * L, rw, 0.05);
      }
      ctx.globalAlpha = base * Math.min(1, 0.85 * k);
      ctx.fillStyle = o.core || '#ffffff';
      ctx.fill(p);
    }
    ctx.globalAlpha = base * Math.min(1, k);
    const cg = ctx.createRadialGradient(x, y, 0, x, y, r);
    cg.addColorStop(0, o.core || '#ffffff');
    cg.addColorStop(0.55, lib.rgba(o.core || '#ffffff', 0.9));
    cg.addColorStop(1, lib.rgba(color, 0));
    ctx.fillStyle = cg;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, TAU);
    ctx.fill();
    ctx.restore();
  }
  lib.glowDot = glowDot;

  function ticksImpl(ctx, x, y, o) {
    const p = new Path2D();
    const pm = new Path2D();
    const n = o.n || 24;
    const len = o.len != null ? o.len : 12;
    const major = o.major || 0;
    const majorLen = o.majorLen != null ? o.majorLen : len * 1.8;
    const prog = o.p != null ? clamp(o.p) : 1;
    const count = Math.round(n * prog);
    if (o.kind === 'linear' || (o.r == null && o.length != null)) {
      const L = o.length || 300;
      const a = o.angle || 0;
      const dx = Math.cos(a), dy = Math.sin(a);
      const side = o.side || 1;
      const nx = -dy * side, ny = dx * side;
      for (let i = 0; i <= Math.round(n * prog); i++) {
        const u = (i / n) * L;
        const isMajor = major && i % major === 0;
        const l = isMajor ? majorLen : len;
        const tgt = isMajor ? pm : p;
        tgt.moveTo(x + dx * u, y + dy * u);
        tgt.lineTo(x + dx * u + nx * l, y + dy * u + ny * l);
      }
      if (o.baseline !== false) {
        pm.moveTo(x, y);
        pm.lineTo(x + dx * L * prog, y + dy * L * prog);
      }
    } else {
      const r = o.r != null ? o.r : 40;
      const a0 = (o.start || 0) + (o.rot || 0);
      const span = o.span != null ? o.span : TAU;
      const full = Math.abs(span - TAU) < 1e-6;
      const dir = o.inward ? -1 : 1;
      for (let i = 0; i < count; i++) {
        const a = a0 + (i / (full ? n : Math.max(1, n - 1))) * span;
        const isMajor = major && i % major === 0;
        const l = (isMajor ? majorLen : len) * dir;
        const tgt = isMajor ? pm : p;
        const c = Math.cos(a), s = Math.sin(a);
        tgt.moveTo(x + c * r, y + s * r);
        tgt.lineTo(x + c * (r + l), y + s * (r + l));
      }
    }
    ctx.save();
    ctx.lineCap = 'round';
    ctx.strokeStyle = o.color || pal.lineWhite;
    ctx.globalAlpha *= o.alpha != null ? o.alpha : 0.6;
    ctx.lineWidth = o.width != null ? o.width : 1.5;
    ctx.stroke(p);
    ctx.lineWidth = (o.width != null ? o.width : 1.5) * 1.35;
    ctx.stroke(pm);
    ctx.restore();
  }

  /**
   * ticks(ctx, x, y, opts) : radial ticks around a circle, or a linear ruler.
   * Radial (default):  r 40, n 24, len 12, start 0, span TAU, major 0, majorLen len*1.8, inward false, rot 0
   * Linear (kind 'linear' or length given): length 300, angle 0, n 24, len 12, major 0, side 1, baseline true
   * Both: color pal.lineWhite, alpha 0.6, width 1.5, p 1 (draw-on progress)
   */
  lib.ticks = (ctx, x, y, o = {}) => ticksImpl(ctx, x, y, o);

  function labelAt(ctx, str, x, y, o) {
    lib.text(ctx, str, x, y, {
      size: o.labelSize || 22,
      color: o.labelColor || o.color,
      alpha: o.alpha != null ? o.alpha : 0.9,
      align: o.labelAlign || 'center',
      baseline: 'middle',
      weight: 400,
      tracking: 1,
    });
  }

  /**
   * bracket(ctx, x1, y1, x2, y2, opts) : a measurement bracket between two points.
   *   style    'dim'    'dim' = dimension line with end bars and arrow ticks, 'square' = [ shape
   *   offset   0        perpendicular offset of the bracket from the measured points (px)
   *   cap      16       end bar length
   *   color    pal.lavender
   *   alpha    0.6
   *   width    1.5
   *   label    null     text at the middle
   *   p        1        draw-on progress
   */
  lib.bracket = (ctx, x1, y1, x2, y2, o = {}) => {
    const dx = x2 - x1, dy = y2 - y1;
    const L = Math.hypot(dx, dy) || 1;
    const ux = dx / L, uy = dy / L;
    const nx = -uy, ny = ux;
    const off = o.offset || 0;
    const cap = o.cap != null ? o.cap : 16;
    const prog = o.p != null ? clamp(o.p) : 1;
    const ax = x1 + nx * off, ay = y1 + ny * off;
    const bx = x2 + nx * off, by = y2 + ny * off;
    const mx = (ax + bx) / 2, my = (ay + by) / 2;
    const h = (L / 2) * prog;
    const p = new Path2D();
    const style = o.style || 'dim';
    const labelGap = o.label ? Math.min(h * 0.9, (String(o.label).length * (o.labelSize || 22)) * 0.34 + 10) : 0;
    const sx = mx - ux * h, sy = my - uy * h, ex = mx + ux * h, ey = my + uy * h;
    if (style === 'square') {
      const sgn = off >= 0 ? -1 : 1;
      p.moveTo(sx + nx * cap * sgn, sy + ny * cap * sgn);
      p.lineTo(sx, sy);
      p.lineTo(mx - ux * labelGap, my - uy * labelGap);
      p.moveTo(mx + ux * labelGap, my + uy * labelGap);
      p.lineTo(ex, ey);
      p.lineTo(ex + nx * cap * sgn, ey + ny * cap * sgn);
    } else {
      p.moveTo(sx, sy);
      p.lineTo(mx - ux * labelGap, my - uy * labelGap);
      p.moveTo(mx + ux * labelGap, my + uy * labelGap);
      p.lineTo(ex, ey);
      p.moveTo(sx - nx * cap * 0.5, sy - ny * cap * 0.5);
      p.lineTo(sx + nx * cap * 0.5, sy + ny * cap * 0.5);
      p.moveTo(ex - nx * cap * 0.5, ey - ny * cap * 0.5);
      p.lineTo(ex + nx * cap * 0.5, ey + ny * cap * 0.5);
      const ah = Math.min(9, h * 0.3);
      p.moveTo(sx + ux * ah + nx * ah * 0.5, sy + uy * ah + ny * ah * 0.5);
      p.lineTo(sx, sy);
      p.lineTo(sx + ux * ah - nx * ah * 0.5, sy + uy * ah - ny * ah * 0.5);
      p.moveTo(ex - ux * ah + nx * ah * 0.5, ey - uy * ah + ny * ah * 0.5);
      p.lineTo(ex, ey);
      p.lineTo(ex - ux * ah - nx * ah * 0.5, ey - uy * ah - ny * ah * 0.5);
      if (off) {
        // extension lines back to the measured points
        p.moveTo(x1 + nx * Math.sign(off) * 4, y1 + ny * Math.sign(off) * 4);
        p.lineTo(ax + nx * Math.sign(off) * cap * 0.6, ay + ny * Math.sign(off) * cap * 0.6);
        p.moveTo(x2 + nx * Math.sign(off) * 4, y2 + ny * Math.sign(off) * 4);
        p.lineTo(bx + nx * Math.sign(off) * cap * 0.6, by + ny * Math.sign(off) * cap * 0.6);
      }
    }
    ctx.save();
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.strokeStyle = o.color || pal.lavender;
    ctx.globalAlpha *= o.alpha != null ? o.alpha : 0.6;
    ctx.lineWidth = o.width != null ? o.width : 1.5;
    ctx.stroke(p);
    ctx.restore();
    if (o.label && prog > 0.6) {
      ctx.save();
      ctx.translate(mx, my);
      let a = Math.atan2(uy, ux);
      if (a > Math.PI / 2 || a < -Math.PI / 2) a += Math.PI;
      ctx.rotate(a);
      ctx.globalAlpha *= clamp((prog - 0.6) / 0.4);
      labelAt(ctx, o.label, 0, 0, Object.assign({ color: o.color || pal.lavender }, o));
      ctx.restore();
    }
  };

  /**
   * guideCircle(ctx, cx, cy, r, opts) : a faint construction circle.
   *   color pal.lavender, alpha 0.15, width 1.5, dash null ([on, off]),
   *   p 1 (draw-on progress), start -PI/2, cross 0 (centre crosshair half-size),
   *   quadrants 0 (tick length at the four quadrant points), ink false (hand-drawn via inkPath), seed
   */
  lib.guideCircle = (ctx, cx, cy, r, o = {}) => {
    const prog = o.p != null ? clamp(o.p) : 1;
    if (prog <= 0) return;
    const start = o.start != null ? o.start : -Math.PI / 2;
    const color = o.color || pal.lavender;
    const alpha = o.alpha != null ? o.alpha : 0.15;
    const width = o.width != null ? o.width : 1.5;
    ctx.save();
    if (o.ink) {
      const n = Math.max(12, Math.ceil(r * TAU * prog / 10));
      const pts = [];
      for (let i = 0; i <= n; i++) {
        const a = start + (i / n) * TAU * prog;
        pts.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r]);
      }
      inkPath(ctx, pts, { closed: prog >= 1, width: width * 1.4, color, alpha, seed: o.seed, taper: [6, 12], wobble: 1.2 });
    } else {
      ctx.beginPath();
      ctx.arc(cx, cy, r, start, start + TAU * prog);
      ctx.strokeStyle = color;
      ctx.globalAlpha *= alpha;
      ctx.lineWidth = width;
      ctx.lineCap = 'round';
      if (o.dash) ctx.setLineDash(o.dash);
      ctx.stroke();
      ctx.setLineDash([]);
    }
    if (o.cross || o.quadrants) {
      const p = new Path2D();
      if (o.cross) {
        p.moveTo(cx - o.cross, cy);
        p.lineTo(cx + o.cross, cy);
        p.moveTo(cx, cy - o.cross);
        p.lineTo(cx, cy + o.cross);
      }
      if (o.quadrants) {
        for (let k = 0; k < 4; k++) {
          const a = (k * Math.PI) / 2;
          const c = Math.cos(a), s = Math.sin(a);
          p.moveTo(cx + c * (r - o.quadrants), cy + s * (r - o.quadrants));
          p.lineTo(cx + c * (r + o.quadrants), cy + s * (r + o.quadrants));
        }
      }
      if (o.ink) {
        ctx.strokeStyle = color;
        ctx.globalAlpha *= alpha;
      }
      ctx.lineWidth = width;
      ctx.stroke(p);
    }
    ctx.restore();
  };

  /**
   * arcAnnotation(ctx, cx, cy, r, a0, a1, opts) : a thin coloured arc over an illustration
   * (flight paths, sound, attention), with an arrowhead and an origin dot.
   *   color pal.annMagenta, width 2, alpha 1, p 1 (draw-on progress), endTicks 8 (0 = none),
   *   arrow 0 (arrowhead size), dot 0 (origin dot radius), dash null, label null, labelOffset 26
   */
  lib.arcAnnotation = (ctx, cx, cy, r, a0, a1, o = {}) => {
    const prog = o.p != null ? clamp(o.p) : 1;
    if (prog <= 0) return;
    const color = o.color || pal.annMagenta;
    const width = o.width != null ? o.width : 2;
    const ae = a0 + (a1 - a0) * prog;
    const ccw = a1 < a0;
    ctx.save();
    ctx.globalAlpha *= o.alpha != null ? o.alpha : 1;
    ctx.strokeStyle = color;
    ctx.fillStyle = color;
    ctx.lineWidth = width;
    ctx.lineCap = 'round';
    if (o.dash) ctx.setLineDash(o.dash);
    ctx.beginPath();
    ctx.arc(cx, cy, r, a0, ae, ccw);
    ctx.stroke();
    ctx.setLineDash([]);
    const et = o.endTicks != null ? o.endTicks : 8;
    if (et) {
      ctx.beginPath();
      for (const a of prog >= 1 ? [a0, ae] : [a0]) {
        ctx.moveTo(cx + Math.cos(a) * (r - et / 2), cy + Math.sin(a) * (r - et / 2));
        ctx.lineTo(cx + Math.cos(a) * (r + et / 2), cy + Math.sin(a) * (r + et / 2));
      }
      ctx.stroke();
    }
    const dot = o.dot != null ? o.dot : 0;
    if (dot) {
      ctx.beginPath();
      ctx.arc(cx + Math.cos(a0) * r, cy + Math.sin(a0) * r, dot, 0, TAU);
      ctx.fill();
    }
    const ah = o.arrow != null ? o.arrow : 0;
    if (ah) {
      const ex = cx + Math.cos(ae) * r, ey = cy + Math.sin(ae) * r;
      const tdir = ae + (ccw ? -Math.PI / 2 : Math.PI / 2);
      const tx = Math.cos(tdir), ty = Math.sin(tdir);
      const nx = -ty, ny = tx;
      ctx.beginPath();
      ctx.moveTo(ex + tx * ah * 0.35, ey + ty * ah * 0.35);
      ctx.lineTo(ex - tx * ah * 0.75 + nx * ah * 0.45, ey - ty * ah * 0.75 + ny * ah * 0.45);
      ctx.lineTo(ex - tx * ah * 0.45, ey - ty * ah * 0.45);
      ctx.lineTo(ex - tx * ah * 0.75 - nx * ah * 0.45, ey - ty * ah * 0.75 - ny * ah * 0.45);
      ctx.closePath();
      ctx.fill();
    }
    if (o.label) {
      const am = (a0 + ae) / 2;
      const lo = o.labelOffset != null ? o.labelOffset : 26;
      lib.text(ctx, o.label, cx + Math.cos(am) * (r + lo), cy + Math.sin(am) * (r + lo), {
        size: o.labelSize || 24,
        color,
        align: 'center',
        baseline: 'middle',
        weight: 500,
      });
    }
    ctx.restore();
  };

  // ===========================================================================
  // Camera and text
  // ===========================================================================

  /**
   * camera(ctx, { x, y, zoom, rot }, fn) : draws fn(ctx) with world point (x, y) at the frame centre,
   * scaled by zoom and rotated by rot. Defaults: the frame centre, zoom 1, rot 0.
   */
  lib.camera = (ctx, cam, fn) => {
    const c = cam || {};
    const x = c.x != null ? c.x : W() / 2;
    const y = c.y != null ? c.y : H() / 2;
    ctx.save();
    ctx.translate(W() / 2, H() / 2);
    if (c.rot) ctx.rotate(c.rot);
    if (c.zoom != null && c.zoom !== 1) ctx.scale(c.zoom, c.zoom);
    ctx.translate(-x, -y);
    let out;
    try {
      out = fn(ctx);
    } finally {
      ctx.restore();
    }
    return out;
  };

  const FONT_STACK = '"SF Pro Rounded", ui-rounded, "Helvetica Neue", system-ui, -apple-system, "Segoe UI", Arial, sans-serif';

  /**
   * text(ctx, str, x, y, opts) : a thin single-line wordmark in the system sans-serif (no font files).
   *   size 42, weight 300, color pal.ink, alpha 1, align 'left', baseline 'alphabetic',
   *   tracking 0 (px number, or a css length such as '0.12em'; letterSpacing is an alias),
   *   family (system stack), p 1 (typewriter reveal fraction), italic false
   */
  const HAND_STACK = '"Chalkboard SE", "Marker Felt", "Comic Sans MS", cursive';
  lib.text = (ctx, str, x, y, o = {}) => {
    let s = String(str);
    if (o.p != null) s = s.slice(0, Math.round(s.length * clamp(o.p)));
    if (!s) return;
    ctx.save();
    ctx.font = `${o.italic ? 'italic ' : ''}${o.weight || 300} ${o.size || 42}px ${o.family || FONT_STACK}`;
    ctx.fillStyle = o.color || pal.ink;
    ctx.globalAlpha *= o.alpha != null ? o.alpha : 1;
    ctx.textAlign = o.align || 'left';
    ctx.textBaseline = o.baseline || 'alphabetic';
    if ('letterSpacing' in ctx) {
      const tr = o.letterSpacing != null ? o.letterSpacing : o.tracking;
      ctx.letterSpacing = typeof tr === 'string' ? tr : `${tr || 0}px`;
    }
    ctx.fillText(s, x, y);
    ctx.restore();
  };

  // ===========================================================================
  // Pixel kit (claude-quest)
  // ===========================================================================
  //
  // The whole film is drawn on a virtual low-resolution grid: VW x VH game pixels,
  // each game pixel a PX-by-PX block of logical pixels. Sprites are string maps drawn
  // once to tiny offscreen canvases and blitted with smoothing off, so edges stay hard.
  // Everything snaps to whole game pixels. Scenes use pal names, never hex.
  //
  // NES rules (art bible sections 2-4): every colour is a lib.NES entry, every sprite map uses
  // at most 3 colours plus transparent ('.'), shapes sit on 8x8 tiles / 16x16 metatiles.
  // All tiles and characters below are original drawings in the NES platformer grammar.

  const PX = 8;
  lib.PX = PX;
  lib.VW = 240; // virtual width in game px (240*8 = 1920)
  lib.VH = 135; // virtual height in game px (135*8 = 1080)
  lib.GROUND_Y = 103; // game px y of the ground's top face (2 ground tiles tall)

  /** px(ctx, gx, gy, gw, gh, color, alpha) : a solid block in game-pixel units. */
  lib.px = (ctx, gx, gy, gw, gh, color, alpha) => {
    ctx.save();
    if (alpha != null) ctx.globalAlpha *= alpha;
    ctx.fillStyle = color;
    ctx.fillRect(Math.round(gx) * PX, Math.round(gy) * PX, Math.round(gw) * PX, Math.round(gh) * PX);
    ctx.restore();
  };

  // Sprite maps: rows of equal-length strings; the legend maps a char to a pal hex.
  // '.' is always transparent. `legends` (instead of `l`) holds palette-cycle frames.
  const SP = {};
  lib.SPRITES_DEF = SP; // for tools/debugging

  // A tiny deterministic raster used to build the larger maps (tiles, hills, castle).
  function grid(w, h, fill = '.') {
    const g = [];
    for (let y = 0; y < h; y++) g.push(new Array(w).fill(fill));
    const m = {
      set(x, y, c) { if (x >= 0 && x < w && y >= 0 && y < h) g[y][x] = c; return m; },
      get(x, y) { return x >= 0 && x < w && y >= 0 && y < h ? g[y][x] : '.'; },
      rect(x0, y0, x1, y1, c) { for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) m.set(x, y, c); return m; },
      rows() { return g.map((r) => r.join('')); },
      w, h,
    };
    return m;
  }

  // ---------------------------------------------------------------------------
  // Claw'd (O body, o shade, k eyes). 16 wide; 3 colours.
  // ---------------------------------------------------------------------------
  const CLAWD = { O: pal.clawdOrange, o: pal.clawdDeep, k: pal.inkDark };
  const CLAWD_TOP = [
    '..OOOOOOOOOOOO..',
    '..OOOOOOOOOOOo..',
    '..OOkkOOOOkkOo..',
    '..OOkkOOOOkkOo..',
    'OOOOOOOOOOOOOOOO',
    'OOOOOOOOOOOOOOOo',
    'ooOOOOOOOOOOOooo',
    '..OOOOOOOOOOOo..',
    '..oooooooooooo..',
  ];
  SP.clawdIdle = {
    l: CLAWD,
    r: CLAWD_TOP.concat([
      '..OO.OO..OO.OO..',
      '..OO.OO..OO.OO..',
      '..oo.oo..oo.oo..',
    ]),
  };
  // Run cycle: run1 legs 1+3 planted / 2+4 lifted, run2 passing (body 1 px lower), run3 the reverse.
  SP.clawdRun1 = {
    l: CLAWD,
    r: CLAWD_TOP.concat([
      '..OO.OO..OO.OO..',
      '..OO.oo..OO.oo..',
      '..oo.....oo.....',
    ]),
  };
  SP.clawdRun2 = {
    l: CLAWD,
    r: ['................'].concat(CLAWD_TOP, [
      '..OO.OO..OO.OO..',
      '..oo.oo..oo.oo..',
    ]),
  };
  SP.clawdRun3 = {
    l: CLAWD,
    r: CLAWD_TOP.concat([
      '..OO.OO..OO.OO..',
      '..oo.OO..oo.OO..',
      '.....oo.....oo..',
    ]),
  };
  SP.clawdJump = {
    l: CLAWD,
    r: [
      'OO.OOOOOOOOOO.OO',
      'OO.OOOOOOOOOOoOO',
      'OOOOkkOOOOkkOoOo',
      '.OOOkkOOOOkkOoo.',
      '..OOOOOOOOOOOo..',
      '..OOOOOOOOOOOo..',
      '..OOOOOOOOOOOo..',
      '..oooooooooooo..',
      '.OO.OO....OO.OO.',
      '.oo.oo....oo.oo.',
    ],
  };
  // On the flagpole: the pole is at his right; both arms and all four feet grip it.
  SP.clawdPole = {
    l: CLAWD,
    r: [
      '..OOOOOOOOOOOO..',
      '..OOOOOOOOOOOoOO',
      '..OOkkOOOOkkOoOo',
      '..OOkkOOOOkkOo..',
      '..OOOOOOOOOOOo..',
      '..OOOOOOOOOOOOOO',
      '..OOOOOOOOOOOooo',
      '..OOOOOOOOOOOo..',
      '..oooooooooooo..',
      '.....OO.OO.OO.OO',
      '.....oo.oo.oo.oo',
    ],
  };

  // ---------------------------------------------------------------------------
  // Princess Pearl (M face, R dress, N crown). Eyes and dress folds are transparent, so she
  // must stand in front of a black plate (the castle interior and the end card are).
  // ---------------------------------------------------------------------------
  const PEARL = { M: pal.pearlCream, R: pal.pearlPink, N: pal.crownGold };
  SP.princess = {
    l: PEARL,
    r: [
      '....N.NN.N....',
      '....NNNNNN....',
      '...MMMMMMMM...',
      '..MMMMMMMMMM..',
      '..MMM.MM.MMM..',
      '..MMM.MM.MMM..',
      '..MMMMMMMMMM..',
      '...MMMMMMMM...',
      '....RRRRRR....',
      '..MRRRRRRRRM..',
      '..RRRRRRRRRR..',
      '.RRR.RRRR.RRR.',
      '.RRRRRRRRRRRR.',
      'RRRR.RRRR.RRRR',
    ],
  };
  SP.princessWave = {
    l: PEARL,
    r: [
      '....N.NN.N....',
      '....NNNNNN....',
      '...MMMMMMMM..M',
      '..MMMMMMMMMMMM',
      '..MMM.MM.MMMR.',
      '..MMM.MM.MMR..',
      '..MMMMMMMMMR..',
      '...MMMMMMMMR..',
      '....RRRRRRR...',
      '..MRRRRRRRR...',
      '..RRRRRRRRRR..',
      '.RRR.RRRR.RRR.',
      '.RRRRRRRRRRRR.',
      'RRRR.RRRR.RRRR',
    ],
  };

  // ---------------------------------------------------------------------------
  // Enemies. The bug is an original six-legged beetle with antennae (E body, k outline, i eyes).
  // ---------------------------------------------------------------------------
  const BUG = { E: pal.bugBrown, k: pal.bugDeep, i: pal.eyeWhite };
  const BUG_TOP = [
    '.k........k.',
    '..k.kkkk.k..',
    '..kkEEEEkk..',
    '.kEiiEEiiEk.',
    '.kEikEEkiEk.',
    'kEEEEEEEEEEk',
    'kEEkEEEEkEEk',
  ];
  SP.bug1 = { l: BUG, r: BUG_TOP.concat(['.kkkkkkkkkk.', 'k.k..kk..k.k']) };
  SP.bug2 = { l: BUG, r: BUG_TOP.concat(['.kkkkkkkkkk.', '.k.kk..kk.k.']) };
  SP.bugFlat = {
    l: BUG,
    r: [
      '.kkkkkkkkkk.',
      'kEkiEEEEikEk',
      'kEEEEEEEEEEk',
      'kkkkkkkkkkkk',
    ],
  };
  // Shell bug: a green-domed bug that walks left (S shell, Y belly/head, k outline).
  const SHELL = { S: pal.shellGreen, Y: pal.bellyCream, k: pal.inkDark };
  const SHELLBUG_TOP = [
    '..kkk.........',
    '.kYYYk........',
    '.kYkYk........',
    '.kYYYkkkkkk...',
    '..kYkkSSkSSk..',
    '..kkSSSkSSSSk.',
    '..kSkSSSSkSSk.',
    '.kSSSkSSkSSSSk',
    '.kYYYYYYYYYYYk',
  ];
  SP.shellbug1 = { l: SHELL, r: SHELLBUG_TOP.concat(['..kkkkkkkkkkk.', '..kYYk...kYYk.', '..kkkk...kkkk.']) };
  SP.shellbug2 = { l: SHELL, r: SHELLBUG_TOP.concat(['..kkkkkkkkkkk.', '...kYYk.kYYk..', '...kkkk.kkkk..']) };
  SP.shell = {
    l: SHELL,
    r: [
      '....kkkkkk....',
      '..kkSSkSSSkk..',
      '.kSSSSkSSSSSk.',
      '.kSkSSSSkSSSk.',
      'kSSSkSSkSSSSSk',
      'kYYYYYYYYYYYYk',
      '.kkkkkkkkkkkk.',
    ],
  };

  // ---------------------------------------------------------------------------
  // Tiles (16x16 metatiles, 3 colours each)
  // ---------------------------------------------------------------------------

  // Ground: rounded stones with cracks. H highlight (top/left lip), B stone, K crack/shadow.
  SP.tileGround = {
    l: { H: pal.brickHi, B: pal.brickMain, K: pal.brickLine },
    r: [
      'KHHHHHHHHHHHHHHK',
      'HHBBBBBBBBBBBBBK',
      'HBBBBBBBBBBBBBBK',
      'HBBBBBBBBBBKBBBK',
      'HBBBBBBBBBBKHBBK',
      'HBBBBBBBBBKBBBBK',
      'HBBBBBBBKKBBBBBK',
      'HBBBBBKKBHBBBBBK',
      'HBBBKKBBBBBBBBBK',
      'HBBKBHBBBBBBBBBK',
      'HBBKBBBBBBBBBBBK',
      'HBBBBBBBBBBBBBBK',
      'HBBBBBBBBBBBKHBK',
      'HBBBBBBBBBBBBBBK',
      'HBBBBBBBBBBBBBKK',
      'KKKKKKKKKKKKKKKK',
    ],
  };
  // Addition: a second ground stone (crack the other way) that lib.groundStrip mixes in.
  SP.tileGroundB = {
    l: SP.tileGround.l,
    r: [
      'KHHHHHHHHHHHHHHK',
      'HHBBBBBBBBBBBBBK',
      'HBBBBBBBBBBBBBBK',
      'HBBBKHBBBBBBBBBK',
      'HBBBBBBBBBBBBBBK',
      'HBBBBBBBBBBBBBBK',
      'HBBBBKBBBBBBBBBK',
      'HBBBBBKHBBBBBBBK',
      'HBBBBBBKKBBBBBBK',
      'HBBBBBBBBKKBBBBK',
      'HBBBBBBBBBBKHBBK',
      'HBBBBBBBBBBBKBBK',
      'HBBBBBBBBBBBKBBK',
      'HBBBBBBBBBBBBBBK',
      'HBBBBBBBBBBBBBKK',
      'KKKKKKKKKKKKKKKK',
    ],
  };
  // Bricks: bevelled courses, black mortar, top and left highlight on every brick.
  SP.tileBrick = {
    l: { H: pal.brickHi, B: pal.brickMain, K: pal.brickLine },
    r: [
      'HHHHHHHKHHHHHHHK',
      'HBBBBBBKHBBBBBBK',
      'HBBBBBBKHBBBBBBK',
      'KKKKKKKKKKKKKKKK',
      'HHHKHHHHHHHKHHHH',
      'BBBKHBBBBBBKHBBB',
      'BBBKHBBBBBBKHBBB',
      'KKKKKKKKKKKKKKKK',
      'HHHHHHHKHHHHHHHK',
      'HBBBBBBKHBBBBBBK',
      'HBBBBBBKHBBBBBBK',
      'KKKKKKKKKKKKKKKK',
      'HHHKHHHHHHHKHHHH',
      'BBBKHBBBBBBKHBBB',
      'BBBKHBBBBBBKHBBB',
      'KKKKKKKKKKKKKKKK',
    ],
  };
  // Question block: rounded corners, light top/left bevel, dark bottom/right edge, four rivets,
  // a '?' with a drop shadow. Q is the light (bevel and mark), A the body, k the dark.
  // Frames 0..2 keep the amber body and cycle the mark and bevel (light -> deep -> dark);
  // pick the frame with lib.qFrame(t).
  function blockFrame(m, light, dark) {
    for (let x = 1; x < 15; x++) { m.set(x, 0, light); m.set(x, 15, dark); }
    for (let y = 1; y < 15; y++) { m.set(0, y, light); m.set(15, y, dark); }
    for (const [x, y] of [[0, 0], [15, 0], [0, 15], [15, 15]]) m.set(x, y, '.');
    m.set(14, 15, dark).set(15, 14, dark);
    for (const [x, y] of [[2, 2], [13, 2], [2, 13], [13, 13]]) m.set(x, y, dark);
  }
  SP.tileQ = {
    legends: [
      { A: pal.qAmber, Q: pal.qHi, k: pal.inkDark },
      { A: pal.qAmber, Q: pal.qDeep, k: pal.inkDark },
      { A: pal.qAmber, Q: pal.brickDeep, k: pal.inkDark },
    ],
    l: null,
    r: (function () {
      const m = grid(16, 16, 'A');
      blockFrame(m, 'Q', 'k');
      const mark = [
        '.QQQQ.',
        'QQ..QQ',
        'QQ..QQ',
        '...QQ.',
        '..QQ..',
        '..QQ..',
        '......',
        '..QQ..',
      ];
      const ox = 5, oy = 4;
      for (let y = 0; y < mark.length; y++) for (let x = 0; x < 6; x++) {
        if (mark[y][x] !== 'Q') continue;
        if (m.get(ox + x + 1, oy + y + 1) === 'A') m.set(ox + x + 1, oy + y + 1, 'k');
      }
      for (let y = 0; y < mark.length; y++) for (let x = 0; x < 6; x++) if (mark[y][x] === 'Q') m.set(ox + x, oy + y, 'Q');
      return m.rows();
    })(),
  };
  // Cave variants: same maps, underground colours.
  SP.tileGroundCave = { l: { H: pal.caveHi, B: pal.caveBrick, K: pal.caveBlack }, r: SP.tileGround.r };
  SP.tileBrickCave = { l: { H: pal.caveHi, B: pal.caveBrick, K: pal.caveBlack }, r: SP.tileBrick.r };
  // Spent block: flat, outlined, four rivets, no mark.
  SP.tileUsed = {
    l: { U: pal.usedBlock, u: pal.usedDeep, h: pal.brickDeep },
    r: (function () {
      const m = grid(16, 16, 'U');
      blockFrame(m, 'u', 'u');
      for (let x = 1; x < 15; x++) m.set(x, 14, 'h');
      for (let y = 1; y < 14; y++) m.set(14, y, 'h');
      return m.rows();
    })(),
  };
  // Hard stair block: a raised pyramid bevel with a sunken centre panel.
  function hardBlock() {
    const m = grid(16, 16, 'U');
    for (let x = 0; x < 16; x++) { m.set(x, 0, 'H'); m.set(x, 15, 'u'); m.set(x, 14, 'u'); }
    for (let y = 0; y < 16; y++) { m.set(0, y, 'H'); m.set(15, y, 'u'); m.set(14, y, 'u'); }
    m.set(15, 0, 'U'); m.set(0, 15, 'U'); m.set(14, 1, 'U'); m.set(1, 14, 'U'); // mitred corners
    for (let r = 1; r < 3; r++) { m.set(r, r, 'H'); m.set(15 - r, 15 - r, 'u'); } // bevel diagonals
    for (let x = 4; x < 12; x++) { m.set(x, 4, 'u'); m.set(x, 11, 'H'); }
    for (let y = 4; y < 12; y++) { m.set(4, y, 'u'); m.set(11, y, 'H'); }
    m.set(11, 4, 'U'); m.set(4, 11, 'U');
    return m.rows();
  }
  SP.tileBlock = { l: { H: pal.brickHi, U: pal.blockBrown, u: pal.blockDeep }, r: hardBlock() };
  // Castle-interior variants: same maps, castle colours.
  SP.tileBlockCastle = { l: { H: pal.castleBrick, U: pal.castleDeep, u: pal.inkDark }, r: SP.tileBlock.r };
  SP.tileGroundCastle = { l: { H: pal.castleBrick, B: pal.castleDeep, K: pal.caveBlack }, r: SP.tileGround.r };

  // ---------------------------------------------------------------------------
  // Coins (C gold, c rim, h shine). 4-frame spin: coin1 face, coin2 turning, coin3 edge,
  // coin4 turning back (lib.coinSpin(t) picks the name).
  // ---------------------------------------------------------------------------
  const COIN = { C: pal.coinGold, c: pal.coinDeep, h: pal.sparkle };
  SP.coin1 = {
    l: COIN,
    r: [
      '..cccc..',
      '.cCCCCc.',
      'cCChCCCc',
      'cChCCCCc',
      'cChCCcCc',
      'cChCCcCc',
      'cChCCcCc',
      'cChCCcCc',
      'cChCCcCc',
      'cChCCcCc',
      'cCCCCCCc',
      'cCCCCCCc',
      '.cCCCCc.',
      '..cccc..',
    ],
  };
  SP.coin2 = {
    l: COIN,
    r: [
      '...cc...',
      '..cCCc..',
      '.cChCCc.',
      '.cChCCc.',
      '.cChCcc.',
      '.cChCcc.',
      '.cChCcc.',
      '.cChCcc.',
      '.cChCcc.',
      '.cChCcc.',
      '.cCCCCc.',
      '.cCCCCc.',
      '..cCCc..',
      '...cc...',
    ],
  };
  SP.coin3 = {
    l: COIN,
    r: [
      '...cc...',
      '...hc...',
      '...hc...',
      '...hc...',
      '...hc...',
      '...hc...',
      '...hc...',
      '...hc...',
      '...hc...',
      '...hc...',
      '...hc...',
      '...hc...',
      '...hc...',
      '...cc...',
    ],
  };
  SP.coin4 = {
    l: COIN,
    r: [
      '...cc...',
      '..cCCc..',
      '.cCChCc.',
      '.cCChCc.',
      '.ccChCc.',
      '.ccChCc.',
      '.ccChCc.',
      '.ccChCc.',
      '.ccChCc.',
      '.ccChCc.',
      '.cCCCCc.',
      '.cCCCCc.',
      '..cCCc..',
      '...cc...',
    ],
  };
  // HUD coin; frame 1 dims it (the HUD coin blinks by palette, like the NES).
  SP.coinSm = {
    legends: [
      { C: pal.coinGold, c: pal.coinDeep, h: pal.sparkle },
      { C: pal.coinDeep, c: pal.brickDeep, h: pal.coinGold },
    ],
    l: null,
    r: ['.cccc.', 'cCChCc', 'cChCCc', 'cChCCc', 'cChCCc', 'cCCCCc', '.cccc.', '......'],
  };

  // ---------------------------------------------------------------------------
  // Pipes: a 32-wide rim over a 28-wide body (2 px of rim overhang each side).
  // Column profile, left to right: outline, highlight strip, body, dithered shade bands, outline.
  // ---------------------------------------------------------------------------
  const PIPE = { L: pal.pipeLight, P: pal.pipeGreen, k: pal.pipeDeep };
  const PIPE_RIM = 'kPLLPLLLLLLPPPPPPPPPPPPkPkPkkPkk';
  const PIPE_BODY = '..kPLLPLLLLPPPPPPPPPPkPkPkkPk..';
  function pipeRows(profile, top) {
    const rows = [];
    for (let y = 0; y < 16; y++) {
      if (top && (y === 0 || y === 15)) rows.push('k'.repeat(32));
      else if (top && y === 1) rows.push('k' + 'L'.repeat(22) + 'PkPkPkkPk'.slice(0, 9));
      else rows.push(profile.padEnd(32, '.'));
    }
    return rows;
  }
  const RIM_ROWS = pipeRows(PIPE_RIM, true);
  const BODY_ROWS = pipeRows(PIPE_BODY + '.', false);
  SP.pipeTopL = { l: PIPE, r: RIM_ROWS.map((r) => r.slice(0, 16)) };
  SP.pipeTopR = { l: PIPE, r: RIM_ROWS.map((r) => r.slice(16, 32)) };
  SP.pipeBodyL = { l: PIPE, r: BODY_ROWS.map((r) => r.slice(0, 16)) };
  SP.pipeBodyR = { l: PIPE, r: BODY_ROWS.map((r) => r.slice(16, 32)) };

  // ---------------------------------------------------------------------------
  // Scenery: black outlines, lobed shapes, inner highlight curves.
  // ---------------------------------------------------------------------------
  SP.cloud = {
    l: { W: pal.cloudWhite, s: pal.cloudShade, k: pal.inkDark },
    r: [
      '.........kkkk...........',
      '....kkk.kWWWWk..kkk.....',
      '...kWWWkWWWWWWkkWWWk....',
      '..kWWWWWWWWWWWWWWWWWkk..',
      '.kWWWWWWWWWWWWWWWWWWWWk.',
      'kWWWsWWWWWWsWWWWWWsWWWWk',
      'kWWWWsWWWWsWWWWWWsWWWWWk',
      '.kWWWWssssWWWWssssWWWWk.',
      '..kkkkkkkkkkkkkkkkkkkk..',
    ],
  };
  SP.bush = {
    l: { G: pal.bushGreen, g: pal.hillGreen, k: pal.inkDark },
    r: [
      '.....kkk.....kkk....',
      '...kkGGGk..kkGGGk...',
      '..kGGGGGGkkGGGGGGk..',
      '.kGGGgGGGGGGGgGGGGk.',
      'kGGGGGgGGGGGGGgGGGGk',
      'kGGgGGGGGGgGGGGGGgGk',
      'kGGGGGGGGGGGGGGGGGGk',
    ],
  };
  SP.hill = {
    l: { G: pal.hillGreen, h: pal.bushGreen, k: pal.inkDark },
    r: [
      '..........kkkk..........',
      '........kkhhGGkk........',
      '.......khhGGGGGGk.......',
      '......khGGkGGGGGGk......',
      '.....khGGGkGGGkGGGk.....',
      '....khGGGGGGGGkGGGGk....',
      '...khGGkGGGGGGGGGGGGk...',
      '..khGGGkGGGGGkGGGGGGGk..',
      '.kGGGGGGGGGGGkGGGGGGGGk.',
      'kGGGGGGGGGGGGGGGGGGGGGGk',
    ],
  };
  // Addition: a big 48 x 20 hill for backdrops (base on the ground line).
  SP.hillBig = {
    l: { G: pal.hillGreen, h: pal.bushGreen, k: pal.inkDark },
    r: (function () {
      const Wd = 48, Hd = 20, m = grid(Wd, Hd);
      const cx = (Wd - 1) / 2;
      const inside = (x, y) => {
        const dy = (Hd - 0.5 - y) / (Hd + 0.5);
        const hw = (Wd / 2) * Math.sqrt(Math.max(0, 1 - dy * dy * dy * 0.98));
        return Math.abs(x - cx) <= hw - 0.5 && y > 0;
      };
      for (let y = 0; y < Hd; y++) for (let x = 0; x < Wd; x++) if (inside(x, y)) m.set(x, y, 'G');
      for (let y = 0; y < Hd; y++) for (let x = 0; x < Wd; x++) {
        if (m.get(x, y) !== 'G') continue;
        const edge = m.get(x - 1, y) === '.' || m.get(x + 1, y) === '.' || m.get(x, y - 1) === '.';
        if (edge) m.set(x, y, 'k');
      }
      // highlight just inside the upper-left edge
      for (let y = 1; y < 12; y++) for (let x = 0; x < cx; x++) {
        if (m.get(x, y) === 'G' && (m.get(x - 1, y) === 'k' || m.get(x, y - 1) === 'k')) { m.set(x, y, 'h'); break; }
      }
      // speckles: short vertical dashes on a fixed scatter
      for (const [x, y] of [[20, 5], [27, 7], [16, 10], [31, 11], [23, 13], [11, 15], [36, 15], [28, 16], [18, 17]]) {
        if (m.get(x, y) === 'G' && m.get(x, y + 1) === 'G') { m.set(x, y, 'k'); m.set(x, y + 1, 'k'); }
      }
      return m.rows();
    })(),
  };

  // Power-up: the sparkle mushroom (Claude coral cap, cream spots and stalk, black outline).
  SP.mush = {
    l: { O: pal.clawdOrange, M: pal.pearlCream, k: pal.inkDark },
    r: [
      '....kkkkkk....',
      '..kkOOMMOOkk..',
      '.kOOOMMMMOOOk.',
      '.kMOOOMMOOOMk.',
      'kMMMOOOOOOMMMk',
      'kMMOOOOOOOOMMk',
      'kOOOOOOOOOOOOk',
      '.kkMMMMMMMMkk.',
      '..kMMkMMkMMk..',
      '..kMMMMMMMMk..',
      '...kkkkkkkk...',
    ],
  };
  SP.sparkle = {
    l: { X: pal.sparkle, Y: pal.fireYellow },
    r: [
      '...Y....',
      '...Y....',
      '..YXY...',
      'YYXXXYY.',
      '..YXY...',
      '...Y....',
      '...Y....',
      '........',
    ],
  };
  SP.heart = {
    l: { X: pal.heartRed, h: pal.sparkle },
    r: ['.XX..XX.', 'XhXXXXXX', 'XhXXXXXX', 'XXXXXXXX', '.XXXXXX.', '..XXXX..', '...XX...', '........'],
  };
  // Flagpole pennant: a white banner with a coral spark, flying right of the pole.
  SP.flag = {
    l: { W: pal.cloudWhite, O: pal.clawdOrange, k: pal.inkDark },
    r: [
      'WWWWWWWW',
      'WOWOWWW.',
      'WWOWWW..',
      'WOWOW...',
      'WWW.....',
    ],
  };
  // Addition: the flagpole's top ball, 4 x 4 (lib.flagpole draws pole + ball + base).
  SP.poleBall = {
    l: { G: pal.pipeGreen, L: pal.pipeLight, k: pal.inkDark },
    r: ['.kk.', 'kLGk', 'kGGk', '.kk.'],
  };

  // The keep: built programmatically (deterministic) into a sprite map, 32 x 30 game px.
  // Brick wall with black mortar, crenellated base and tower, arched windows, arched door
  // (cols 13-18, rows 19-29), a pennant on a pole (cols 15-22, rows 0-4). 3 colours.
  SP.castle = (function () {
    const Wd = 32, Hd = 30;
    const m = grid(Wd, Hd);
    const brick = (x0, y0, x1, y1) => {
      for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
        const course = Math.floor((y - y0) / 3);
        const row = (y - y0) % 3;
        const off = course % 2 ? 4 : 0;
        const joint = (x - x0 + off) % 8 === 7;
        m.set(x, y, row === 2 || joint ? 'k' : 'D');
      }
    };
    // pennant and pole
    for (let y = 0; y <= 4; y++) m.set(15, y, 'k');
    for (let x = 16; x <= 22; x++) m.set(x, 0, 'G');
    for (let x = 16; x <= 20; x++) m.set(x, 1, 'G');
    for (let x = 16; x <= 18; x++) m.set(x, 2, 'G');
    // tower: cols 8-23, rows 8-15, merlons rows 5-7
    brick(8, 8, 23, 15);
    for (const x0 of [8, 14, 20]) m.rect(x0, 5, x0 + 3, 7, 'D').rect(x0, 7, x0 + 3, 7, 'k');
    // base: cols 0-31, rows 17-29, merlons rows 14-16 either side of the tower
    brick(0, 17, 31, 29);
    for (const x0 of [0, 5, 24, 29]) m.rect(x0, 14, x0 + 2, 16, 'D').rect(x0, 16, x0 + 2, 16, 'k');
    m.rect(8, 16, 23, 16, 'k');
    // brick surrounds (no mortar) so the black openings read against the black mortar
    for (const wx of [11, 19]) m.rect(wx - 1, 9, wx + 2, 14, 'D');
    for (const wx of [4, 26]) m.rect(wx - 1, 19, wx + 2, 24, 'D');
    m.rect(12, 20, 19, 29, 'D').rect(13, 19, 18, 19, 'D').rect(14, 18, 17, 18, 'D');
    for (const wx of [11, 19]) m.rect(wx, 10, wx + 1, 13, 'n');
    // arched door (cols 13-18) and two slit windows
    for (let y = 21; y < Hd; y++) m.rect(13, y, 18, y, 'n');
    m.rect(14, 20, 17, 20, 'n');
    m.rect(15, 19, 16, 19, 'n');
    for (const wx of [4, 26]) m.rect(wx, 20, wx + 1, 23, 'n');
    return { l: { D: pal.castleBrick, k: pal.inkDark, n: pal.doorBlack, G: pal.bushGreen }, r: m.rows() };
  })();

  // Sprites blit through tiny 1:1 canvases, cached forever (they are pure functions of the def).
  const spriteCanvases = new Map();
  function spriteCanvas(name, frame) {
    const key = frame == null ? name : name + '|' + frame;
    let c = spriteCanvases.get(key);
    if (c) return c;
    const def = SP[name];
    if (!def) throw new Error('unknown sprite: ' + name);
    const legend = def.legends ? def.legends[(frame || 0) % def.legends.length] : def.l;
    const rows = def.r;
    const w = Math.max.apply(null, rows.map((r) => r.length));
    const h = rows.length;
    c = newCanvas(w, h);
    const g = c.getContext('2d');
    for (let y = 0; y < h; y++) {
      const row = rows[y];
      for (let x = 0; x < row.length; x++) {
        const col = legend[row[x]];
        if (!col) continue;
        g.fillStyle = col;
        g.fillRect(x, y, 1, 1);
      }
    }
    c.__gw = w;
    c.__gh = h;
    spriteCanvases.set(key, c);
    return c;
  }
  lib.spriteCanvas = spriteCanvas;

  /**
   * sprite(ctx, name, gx, gy, o) : blit a named sprite with its top-left at game px (gx, gy).
   *   o.flip mirrors horizontally, o.scale multiplies the game-px size (integer, crisp),
   *   o.frame picks a legend variant (the ?-block shimmer), o.alpha fades.
   *   Positions snap to whole game pixels. Returns the drawn size { w, h } in game px.
   */
  lib.sprite = (ctx, name, gx, gy, o = {}) => {
    const img = spriteCanvas(name, o.frame);
    const sc = o.scale || 1;
    const w = img.__gw * sc * PX;
    const h = img.__gh * sc * PX;
    const x = Math.round(gx) * PX;
    const y = Math.round(gy) * PX;
    ctx.save();
    ctx.imageSmoothingEnabled = false;
    if (o.alpha != null) ctx.globalAlpha *= o.alpha;
    if (o.flip) {
      ctx.translate(x + w, y);
      ctx.scale(-1, 1);
      ctx.drawImage(img, 0, 0, w, h);
    } else {
      ctx.drawImage(img, x, y, w, h);
    }
    ctx.restore();
    return { w: img.__gw * sc, h: img.__gh * sc };
  };

  // ---------------------------------------------------------------------------
  // Animation pickers (NES-like cadences, pure functions of time)
  // ---------------------------------------------------------------------------

  /**
   * qFrame(t) : ?-block shimmer frame 0..2. The cycle is 0.8 s: bright for 0.4 s, then
   * 1, 2, 1 for 2/15 s each (the NES 24-8-8-8 frame cadence at 60 Hz).
   */
  lib.qFrame = (t) => {
    const f = Math.floor((((t % 0.8) + 0.8) % 0.8) * 60 + 1e-6); // 0..47 in 60 Hz ticks
    return f < 24 ? 0 : f < 32 ? 1 : f < 40 ? 2 : 1;
  };
  /** coinSpin(t, fps = 12) : sprite name of the 4-frame coin spin (coin1 face -> coin2 -> coin3 edge -> coin4). */
  lib.coinSpin = (t, fps = 12) => ['coin1', 'coin2', 'coin3', 'coin4'][((Math.floor(t * fps + 1e-6) % 4) + 4) % 4];
  /** clawdRun(t, fps = 12) : sprite name of the 3-frame run cycle (clawdRun1 -> 2 -> 3). */
  lib.clawdRun = (t, fps = 12) => ['clawdRun1', 'clawdRun2', 'clawdRun3'][((Math.floor(t * fps + 1e-6) % 3) + 3) % 3];

  // ---------------------------------------------------------------------------
  // Pixel font (8x8 cells, 7x7 bold glyphs with 2-px strokes) and HUD
  // ---------------------------------------------------------------------------

  const FONT = {
    A: ['..###..', '.##.##.', '##...##', '##...##', '#######', '##...##', '##...##'],
    B: ['######.', '##...##', '##...##', '######.', '##...##', '##...##', '######.'],
    C: ['.#####.', '##...##', '##.....', '##.....', '##.....', '##...##', '.#####.'],
    D: ['#####..', '##..##.', '##...##', '##...##', '##...##', '##..##.', '#####..'],
    E: ['#######', '##.....', '##.....', '######.', '##.....', '##.....', '#######'],
    F: ['#######', '##.....', '##.....', '######.', '##.....', '##.....', '##.....'],
    G: ['.#####.', '##.....', '##.....', '##..###', '##...##', '##...##', '.######'],
    H: ['##...##', '##...##', '##...##', '#######', '##...##', '##...##', '##...##'],
    I: ['######.', '..##...', '..##...', '..##...', '..##...', '..##...', '######.'],
    J: ['..#####', '....##.', '....##.', '....##.', '##..##.', '##..##.', '.####..'],
    K: ['##...##', '##..##.', '##.##..', '####...', '#####..', '##..##.', '##...##'],
    L: ['##.....', '##.....', '##.....', '##.....', '##.....', '##.....', '#######'],
    M: ['##...##', '###.###', '#######', '#######', '##.#.##', '##...##', '##...##'],
    N: ['##...##', '###..##', '####.##', '##.####', '##..###', '##...##', '##...##'],
    O: ['.#####.', '##...##', '##...##', '##...##', '##...##', '##...##', '.#####.'],
    P: ['######.', '##...##', '##...##', '######.', '##.....', '##.....', '##.....'],
    Q: ['.#####.', '##...##', '##...##', '##...##', '##.####', '##..##.', '.###.##'],
    R: ['######.', '##...##', '##...##', '######.', '##.##..', '##..##.', '##...##'],
    S: ['.#####.', '##...##', '##.....', '.#####.', '.....##', '##...##', '.#####.'],
    T: ['######.', '..##...', '..##...', '..##...', '..##...', '..##...', '..##...'],
    U: ['##...##', '##...##', '##...##', '##...##', '##...##', '##...##', '.#####.'],
    V: ['##...##', '##...##', '##...##', '###.###', '.#####.', '..###..', '...#...'],
    W: ['##...##', '##...##', '##.#.##', '#######', '#######', '###.###', '##...##'],
    X: ['##...##', '###.###', '.#####.', '..###..', '.#####.', '###.###', '##...##'],
    Y: ['##..##.', '##..##.', '##..##.', '.####..', '..##...', '..##...', '..##...'],
    Z: ['#######', '....###', '...###.', '..###..', '.###...', '###....', '#######'],
    0: ['.####..', '##..##.', '##..##.', '##..##.', '##..##.', '##..##.', '.####..'],
    1: ['..##...', '.###...', '..##...', '..##...', '..##...', '..##...', '######.'],
    2: ['.#####.', '##...##', '.....##', '..####.', '.###...', '##.....', '#######'],
    3: ['#######', '....##.', '...##..', '..####.', '.....##', '##...##', '.#####.'],
    4: ['...###.', '..####.', '.##.##.', '##..##.', '#######', '....##.', '....##.'],
    5: ['######.', '##.....', '######.', '.....##', '.....##', '##...##', '.#####.'],
    6: ['..####.', '.##....', '##.....', '######.', '##...##', '##...##', '.#####.'],
    7: ['#######', '##...##', '....##.', '...##..', '..##...', '..##...', '..##...'],
    8: ['.#####.', '##...##', '##...##', '.#####.', '##...##', '##...##', '.#####.'],
    9: ['.#####.', '##...##', '##...##', '.######', '.....##', '....##.', '.####..'],
    '-': ['.......', '.......', '.......', '######.', '######.', '.......', '.......'],
    '!': ['..##...', '..##...', '..##...', '..##...', '..##...', '.......', '..##...'],
    '?': ['.#####.', '##...##', '....##.', '...##..', '..##...', '.......', '..##...'],
    '.': ['.......', '.......', '.......', '.......', '.......', '..##...', '..##...'],
    ',': ['.......', '.......', '.......', '.......', '..##...', '..##...', '.##....'],
    ':': ['.......', '..##...', '..##...', '.......', '..##...', '..##...', '.......'],
    "'": ['..##...', '..##...', '.##....', '.......', '.......', '.......', '.......'],
    '"': ['.##.##.', '.##.##.', '.#..#..', '.......', '.......', '.......', '.......'],
    '>': ['.##....', '..##...', '...##..', '....##.', '...##..', '..##...', '.##....'],
    '<': ['....##.', '...##..', '..##...', '.##....', '..##...', '...##..', '....##.'],
    '+': ['.......', '..##...', '..##...', '######.', '######.', '..##...', '..##...'],
    '/': ['.....##', '....##.', '...##..', '..##...', '.##....', '##.....', '.......'],
    '×': ['.......', '##...##', '.##.##.', '..###..', '.##.##.', '##...##', '.......'],
    '©': ['.#####.', '#.....#', '#.###.#', '#.#...#', '#.###.#', '#.....#', '.#####.'],
    '♥': ['.##.##.', '#######', '#######', '#######', '.#####.', '..###..', '...#...'],
    '★': ['...#...', '..###..', '#######', '.#####.', '..###..', '.##.##.', '##...##'],
    ' ': ['.......', '.......', '.......', '.......', '.......', '.......', '.......'],
  };
  lib.FONT = FONT;
  const GLYPH = 7; // ink size; each glyph sits in an 8 x 8 cell (1 blank column and row)
  const CELL = 8;

  /** pxtextWidth(str, scale) : width of a pixel-text string in game px (8 per glyph, minus the last gap). */
  lib.pxtextWidth = (str, scale = 1) => {
    const s = String(str).toUpperCase();
    return s.length ? (s.length * CELL - 1) * scale : 0;
  };
  lib.PXTEXT_H = GLYPH; // glyph ink height in game px at scale 1

  /**
   * pxtext(ctx, str, gx, gy, o) : pixel text, top-left at game px (gx, gy).
   *   o.color (a pal hex), o.scale (integer), o.align 'left'|'center'|'right', o.alpha,
   *   o.shadow (a pal hex: a 1-game-px drop shadow down-right, drawn first).
   *   Glyphs are 7x7 ink in 8x8 cells: advance 8 * scale, ink height 7 * scale.
   *   Returns the width in game px.
   */
  lib.pxtext = (ctx, str, gx, gy, o = {}) => {
    const s = String(str).toUpperCase();
    const scale = o.scale || 1;
    let x = Math.round(gx);
    const y = Math.round(gy);
    const wdt = lib.pxtextWidth(s, scale);
    if (o.align === 'center') x -= Math.floor(wdt / 2);
    else if (o.align === 'right') x -= wdt;
    ctx.save();
    if (o.alpha != null) ctx.globalAlpha *= o.alpha;
    const pass = (dx, dy, color) => {
      ctx.fillStyle = color;
      for (let i = 0; i < s.length; i++) {
        const gl = FONT[s[i]] || FONT[' '];
        const x0 = x + i * CELL * scale + dx;
        for (let r = 0; r < GLYPH; r++) {
          const row = gl[r];
          for (let c = 0; c < GLYPH; c++) {
            if (row[c] === '#') ctx.fillRect((x0 + c * scale) * PX, (y + dy + r * scale) * PX, scale * PX, scale * PX);
          }
        }
      }
    };
    if (o.shadow) pass(1, 1, o.shadow);
    pass(0, 0, o.color || pal.hudWhite);
    ctx.restore();
    return wdt;
  };

  /**
   * hud(ctx, o) : the status bar, two text rows at y 1 and y 9 (ink rows 1-15). o = { score, coins, world, time, label }.
   * Layout in game px, after the NES arrangement: label over a 6-digit score at x 16, blinking coin +
   * "×NN" at x 80, "WORLD" over the world at x 136, "TIME" over the countdown at x 192.
   */
  lib.HUD_ROWS = [1, 15];
  lib.hud = (ctx, o = {}) => {
    const score = String(Math.max(0, Math.round(o.score || 0))).padStart(6, '0');
    const coins = '×' + String(Math.max(0, Math.round(o.coins || 0))).padStart(2, '0');
    const time = String(Math.max(0, Math.round(o.time != null ? o.time : 400))).padStart(3, '0');
    const world = String(o.world || '1-1');
    const label = o.label || "CLAW'D";
    const c = pal.hudWhite;
    const blink = lib.qFrame(lib.T); // the HUD coin dims on the ? block's cadence
    lib.pxtext(ctx, label, 16, 1, { color: c });
    lib.pxtext(ctx, score, 16, 9, { color: c });
    lib.sprite(ctx, 'coinSm', 80, 9, { frame: blink === 2 ? 1 : 0 });
    lib.pxtext(ctx, coins, 88, 9, { color: c });
    lib.pxtext(ctx, 'WORLD', 136, 1, { color: c });
    lib.pxtext(ctx, world, 136 + Math.floor((lib.pxtextWidth('WORLD') - lib.pxtextWidth(world)) / 2), 9, { color: c });
    lib.pxtext(ctx, 'TIME', 192, 1, { color: c });
    lib.pxtext(ctx, time, 192 + lib.pxtextWidth('TIME') - lib.pxtextWidth(time), 9, { color: c });
  };

  /**
   * titlePlaque(ctx, cx, y, text, o) : an NES-style title plaque centred on game x cx, top at y.
   *   text is a string or an array of lines. o.scale (default 2), o.pad (default 5 game px),
   *   o.gap (line gap, default 3 * scale). Brick-orange plate, pale bevel top/left, black edge
   *   bottom/right, four rivets, pale text with a black drop shadow. 3 colours.
   *   Returns { x, y, w, h } in game px. At scale 2 a line holds up to 13 glyphs inside x 8-232.
   */
  lib.titlePlaque = (ctx, cx, y, text, o = {}) => {
    const lines = (Array.isArray(text) ? text : [text]).map(String);
    const scale = o.scale || 2;
    const pad = o.pad != null ? o.pad : 5;
    const gap = o.gap != null ? o.gap : 3 * scale;
    const tw = Math.max.apply(null, lines.map((l) => lib.pxtextWidth(l, scale)));
    const w = tw + 2 * pad + 1;
    const h = lines.length * GLYPH * scale + (lines.length - 1) * gap + 2 * pad + 1;
    const x = Math.round(cx - w / 2);
    const Y = Math.round(y);
    const hi = pal.brickHi, body = pal.brickMain, dk = pal.inkDark;
    lib.px(ctx, x, Y, w, h, body);
    lib.px(ctx, x, Y, w - 1, 1, hi);
    lib.px(ctx, x, Y, 1, h - 1, hi);
    lib.px(ctx, x + 1, Y + h - 1, w - 1, 1, dk);
    lib.px(ctx, x + w - 1, Y + 1, 1, h - 1, dk);
    for (const [rx, ry] of [[2, 2], [w - 3, 2], [2, h - 3], [w - 3, h - 3]]) lib.px(ctx, x + rx, Y + ry, 1, 1, dk);
    let ty = Y + pad;
    for (const line of lines) {
      lib.pxtext(ctx, line, Math.round(cx), ty, { scale, align: 'center', color: hi, shadow: dk });
      ty += GLYPH * scale + gap;
    }
    return { x, y: Y, w, h };
  };

  /** pipe(ctx, gx, gyTop, hTiles) : a 2-tile-wide pipe; hTiles counts the rim tile too. */
  lib.pipe = (ctx, gx, gyTop, hTiles) => {
    for (let i = 1; i < hTiles; i++) {
      lib.sprite(ctx, 'pipeBodyL', gx, gyTop + i * 16);
      lib.sprite(ctx, 'pipeBodyR', gx + 16, gyTop + i * 16);
    }
    lib.sprite(ctx, 'pipeTopL', gx, gyTop);
    lib.sprite(ctx, 'pipeTopR', gx + 16, gyTop);
  };

  /**
   * flagpole(ctx, gx, gyTop, gyBase, o) : the goal pole, 2 px wide at game x gx..gx+1, from the
   * ball (4 x 4, top at gyTop - 4) down to gyBase, standing on a hard block whose top is gyBase
   * (the block is 16 x 16, centred under the pole). o.base false skips the block.
   */
  lib.flagpole = (ctx, gx, gyTop, gyBase, o = {}) => {
    const x = Math.round(gx);
    lib.px(ctx, x, gyTop, 2, gyBase - gyTop, pal.pipeLight);
    lib.px(ctx, x + 1, gyTop, 1, gyBase - gyTop, pal.pipeGreen);
    lib.sprite(ctx, 'poleBall', x - 1, gyTop - 4);
    if (o.base !== false) lib.sprite(ctx, 'tileBlock', x - 7, gyBase);
  };

  /** groundStrip(ctx, wxFrom, wxTo, camX, gyTop) : ground tiles for world-x range, offset by camX. */
  lib.groundStrip = (ctx, wxFrom, wxTo, camX, gyTop = lib.GROUND_Y) => {
    const t0 = Math.floor(wxFrom / 16);
    const t1 = Math.ceil(wxTo / 16);
    for (let t = t0; t <= t1; t++) {
      const gx = t * 16 - camX;
      if (gx < -16 || gx > lib.VW) continue;
      // a fixed per-column mix of the two stones, so the strip never reads as wallpaper
      lib.sprite(ctx, h3(t, 1, 5) < 0.5 ? 'tileGround' : 'tileGroundB', gx, gyTop);
      lib.sprite(ctx, h3(t, 2, 5) < 0.5 ? 'tileGround' : 'tileGroundB', gx, gyTop + 16);
    }
  };


  // A scene that changed lib, lib.pal or lib.ease would leak into every shot drawn after it, in
  // whatever order frames happen to be drawn (and differently in each render worker). So all of
  // it is frozen:
  //   - lib itself is a plain frozen object: a write throws in strict code and is ignored in
  //     non-strict code, so nothing leaks, and reading lib.fn in a hot loop stays at full speed.
  //   - pal and ease are also wrapped so a write throws even from non-strict scene code (core
  //     records it as a draw error, tools/check.cjs reports it). The wrapper makes each read about
  //     20 ns slower, so hoist colours out of per-point loops (const ink = P.ink). Code inside lib
  //     uses the raw objects and pays nothing.
  function readOnly(target, name) {
    const fail = (verb, prop) => {
      throw new TypeError(
        `${name} is read-only: a scene cannot ${verb} '${String(prop)}' (it would leak into other shots). ` +
          `Make a local copy instead, for example const P = Object.assign({}, FILM.lib.pal, { ink: '#000' }).`
      );
    };
    return new Proxy(Object.freeze(target), {
      set: (t, prop) => fail('set', prop),
      defineProperty: (t, prop) => fail('define', prop),
      deleteProperty: (t, prop) => fail('delete', prop),
      setPrototypeOf: () => fail('change the prototype of', name),
    });
  }
  for (const key of Object.keys(ease)) Object.freeze(ease[key]);
  lib.pal = readOnly(pal, 'FILM.lib.pal');
  lib.ease = readOnly(ease, 'FILM.lib.ease');
  for (const key of Object.keys(lib)) {
    const v = Object.getOwnPropertyDescriptor(lib, key).value;
    if (typeof v === 'function') Object.freeze(v);
  }
  Object.defineProperty(FILM, 'lib', { value: Object.freeze(lib), writable: false, enumerable: true, configurable: false });
})();
