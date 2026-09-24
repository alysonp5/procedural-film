/*
 * instrument.js : the shared pieces of an instrument-mode film, drawn once here so every shot draws
 * them identically. Loaded after lib.js, photos.js and clips.js, before the scenes. Square frame.
 *
 *   plate(ctx, id, o)          a photo, centred, width = frame * o.zoom; o.fx/o.fy pick the point of
 *                              the image at the centre; o.ox/o.oy offset; o.rot; o.alpha
 *   clip(ctx, id, t, o)        the same, for a clip frame at clip time t (declare it in def.clips!)
 *   view(ctx, inner, o)        the look through an instrument: inner(ctx) draws the image, clipped to
 *                              the aperture; o.kind 'eyepiece' (black ridged barrel) or 'porthole'
 *                              (brass ring, bolts, ship's wall, glass glint); o.cx, o.cy, o.r;
 *                              o.depth widens the barrel as the camera backs out (eyepiece)
 *   sequence(list, t)          which item of a flicker list [{ f: frames, ... }] shows at shot time t
 *   stack(key, layers, o)      a tall vertical pan canvas from full-width photos, each feathered
 *                              into the one above: layers [{ id, y }], o.feather (px), o.height
 *   pan(ctx, canvas, y, o)     draw the window at y; o.blur px blurs over a sharp copy (no dark edges);
 *                              o.settle { id, alpha } fades the bare bottom plate in for the clip handover
 *   spark(ctx, cx, cy, r)      the Claude spark
 *   wordmark(ctx, text, o)     centred serif title; o.size, o.alpha, o.spark, o.y
 *
 * Everything is a pure function of its arguments: no state between frames.
 */
(function () {
  'use strict';

  const FILM = window.FILM;
  const L = FILM.lib;
  const TAU = Math.PI * 2;
  const W = 1080;
  const clamp = (v, a = 0, b = 1) => (v < a ? a : v > b ? b : v);

  function drawCentered(ctx, img, iw, ih, o) {
    const zoom = o.zoom != null ? o.zoom : 1;
    const w = W * zoom;
    const h = (w * ih) / iw;
    ctx.save();
    ctx.globalAlpha *= o.alpha != null ? o.alpha : 1;
    ctx.translate(540 + (o.ox || 0), 540 + (o.oy || 0));
    if (o.rot) ctx.rotate(o.rot);
    ctx.imageSmoothingQuality = 'high';
    const fx = o.fx != null ? o.fx : 0.5;
    const fy = o.fy != null ? o.fy : 0.5;
    ctx.drawImage(img, -w * fx, -h * fy, w, h);
    ctx.restore();
  }

  function plate(ctx, id, o = {}) {
    const img = FILM.photo(id);
    const m = FILM.PHOTOS[id];
    if (img && m) drawCentered(ctx, img, m.w, m.h, o);
  }

  function clip(ctx, id, t, o = {}) {
    const img = FILM.clipFrame(id, t);
    const m = FILM.CLIPS[id];
    if (img && m) drawCentered(ctx, img, m.w, m.h, o);
  }

  // ---------------------------------------------------------------- the view
  function aperture(ctx, inner, cx, cy, r, glass) {
    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, TAU);
    ctx.clip();
    ctx.fillStyle = glass ? '#0b2a38' : '#e9e1cf';
    ctx.fillRect(0, 0, W, W);
    inner(ctx);
    const v = ctx.createRadialGradient(cx, cy, r * 0.55, cx, cy, r);
    v.addColorStop(0, 'rgba(0,0,0,0)');
    v.addColorStop(0.7, 'rgba(10,8,6,0.10)');
    v.addColorStop(0.92, 'rgba(10,8,6,0.38)');
    v.addColorStop(1, 'rgba(0,0,0,0.85)');
    ctx.fillStyle = v;
    ctx.fillRect(cx - r, cy - r, r * 2, r * 2);
    if (glass) {
      // thick glass: a cool cast, a curved glint top-left, a few seeded condensation beads
      ctx.fillStyle = 'rgba(40,90,110,0.07)';
      ctx.fillRect(cx - r, cy - r, r * 2, r * 2);
      ctx.save();
      ctx.lineCap = 'round';
      ctx.strokeStyle = 'rgba(255,255,255,0.10)';
      ctx.lineWidth = r * 0.06;
      ctx.beginPath();
      ctx.arc(cx, cy, r * 0.84, Math.PI * 1.08, Math.PI * 1.42);
      ctx.stroke();
      ctx.strokeStyle = 'rgba(255,255,255,0.06)';
      ctx.lineWidth = r * 0.025;
      ctx.beginPath();
      ctx.arc(cx, cy, r * 0.74, Math.PI * 1.12, Math.PI * 1.3);
      ctx.stroke();
      ctx.restore();
      for (let i = 0; i < 38; i++) {
        const a = ((L.hash('glass', i, 1) >>> 0) / 4294967296) * TAU;
        const d = Math.sqrt((L.hash('glass', i, 2) >>> 0) / 4294967296) * r * 0.95;
        const s = (1.2 + ((L.hash('glass', i, 3) >>> 0) / 4294967296) * 3.2) * (r / 482);
        const x = cx + Math.cos(a) * d;
        const y = cy + Math.sin(a) * d;
        ctx.fillStyle = 'rgba(0,0,0,0.12)';
        ctx.beginPath();
        ctx.arc(x + s * 0.3, y + s * 0.4, s, 0, TAU);
        ctx.fill();
        ctx.fillStyle = 'rgba(255,255,255,0.22)';
        ctx.beginPath();
        ctx.arc(x - s * 0.3, y - s * 0.3, s * 0.45, 0, TAU);
        ctx.fill();
      }
    }
    ctx.restore();
  }

  function eyepieceBody(ctx, cx, cy, r, depth) {
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, 0, W, W);
    ctx.arc(cx, cy, r, 0, TAU, true);
    ctx.clip('evenodd');
    ctx.fillStyle = '#060606';
    ctx.fillRect(0, 0, W, W);
    const R1 = r * (1.9 + depth * 1.4);
    const n = 34 + Math.round(depth * 40);
    for (let i = 0; i < n; i++) {
      const u = i / n;
      const lip = Math.exp(-Math.pow((u - 0.05) / 0.05, 2));
      const shoulder = Math.exp(-Math.pow((u - 0.42) / 0.1, 2));
      const a = 0.05 + 0.1 * lip + 0.09 * shoulder + (i % 2 ? 0.02 : 0);
      ctx.strokeStyle = `rgba(150,150,150,${a.toFixed(3)})`;
      ctx.lineWidth = 1.6 + u * 3;
      ctx.beginPath();
      ctx.ellipse(cx, cy + u * 6, r + 4 + u * (R1 - r), (r + 4 + u * (R1 - r)) * 0.995, 0, 0, TAU);
      ctx.stroke();
    }
    const sh = ctx.createLinearGradient(0, cy - R1, 0, cy + R1);
    sh.addColorStop(0, 'rgba(255,255,255,0.05)');
    sh.addColorStop(0.5, 'rgba(0,0,0,0)');
    sh.addColorStop(1, 'rgba(0,0,0,0.35)');
    ctx.fillStyle = sh;
    ctx.fillRect(0, 0, W, W);
    ctx.restore();
  }

  function portholeBody(ctx, cx, cy, r, o) {
    const ring = r * 0.3; // brass width
    const R = r + ring;
    ctx.save();
    // 1. the ship's wall: painted steel, lit from the top left, with a faint seam and rivets
    ctx.beginPath();
    ctx.rect(0, 0, W, W);
    ctx.arc(cx, cy, r, 0, TAU, true);
    ctx.clip('evenodd');
    const wall = ctx.createLinearGradient(0, 0, W, W);
    wall.addColorStop(0, o.wall0 || '#2f4a4f');
    wall.addColorStop(1, o.wall1 || '#132226');
    ctx.fillStyle = wall;
    ctx.fillRect(0, 0, W, W);
    ctx.fillStyle = 'rgba(0,0,0,0.25)';
    for (let i = 0; i < 9; i++) {
      for (const [x, y] of [[40 + i * 125, 36], [40 + i * 125, W - 36]]) {
        ctx.beginPath();
        ctx.arc(x + 1.5, y + 2, 7, 0, TAU);
        ctx.fill();
      }
    }
    ctx.fillStyle = 'rgba(255,255,255,0.10)';
    for (let i = 0; i < 9; i++) {
      for (const [x, y] of [[40 + i * 125, 36], [40 + i * 125, W - 36]]) {
        ctx.beginPath();
        ctx.arc(x - 1, y - 1, 5, 0, TAU);
        ctx.fill();
      }
    }
    // shadow cast by the ring onto the wall
    const cs = ctx.createRadialGradient(cx + r * 0.05, cy + r * 0.07, R * 0.96, cx + r * 0.05, cy + r * 0.07, R * 1.22);
    cs.addColorStop(0, 'rgba(0,0,0,0.55)');
    cs.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = cs;
    ctx.fillRect(0, 0, W, W);
    // 2. the brass ring: a metal ramp across the width, lit top left
    ctx.beginPath();
    ctx.arc(cx, cy, R, 0, TAU);
    ctx.arc(cx, cy, r, 0, TAU, true);
    const br = ctx.createRadialGradient(cx, cy, r, cx, cy, R);
    br.addColorStop(0, '#5a3c14');
    br.addColorStop(0.12, '#c99a45');
    br.addColorStop(0.35, '#e8c778');
    br.addColorStop(0.55, '#a8792f');
    br.addColorStop(0.8, '#d6ad5c');
    br.addColorStop(1, '#4a3010');
    ctx.fillStyle = br;
    ctx.fill('evenodd');
    // directional light over the ring
    const lg = ctx.createLinearGradient(cx - R, cy - R, cx + R, cy + R);
    lg.addColorStop(0, 'rgba(255,240,200,0.28)');
    lg.addColorStop(0.5, 'rgba(0,0,0,0)');
    lg.addColorStop(1, 'rgba(20,10,0,0.45)');
    ctx.fillStyle = lg;
    ctx.beginPath();
    ctx.arc(cx, cy, R, 0, TAU);
    ctx.arc(cx, cy, r, 0, TAU, true);
    ctx.fill('evenodd');
    // fine turned grooves
    for (let i = 1; i < 7; i++) {
      ctx.strokeStyle = i % 2 ? 'rgba(60,35,5,0.25)' : 'rgba(255,235,180,0.18)';
      ctx.lineWidth = 1.2 * (r / 482);
      ctx.beginPath();
      ctx.arc(cx, cy, r + (ring * i) / 7, 0, TAU);
      ctx.stroke();
    }
    // 3. eight domed bolts
    const br0 = ring * 0.14;
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * TAU + TAU / 16;
      const x = cx + Math.cos(a) * (r + ring * 0.55);
      const y = cy + Math.sin(a) * (r + ring * 0.55);
      ctx.fillStyle = 'rgba(30,15,0,0.5)';
      ctx.beginPath();
      ctx.arc(x + br0 * 0.2, y + br0 * 0.3, br0 * 1.05, 0, TAU);
      ctx.fill();
      const bg = ctx.createRadialGradient(x - br0 * 0.35, y - br0 * 0.4, br0 * 0.1, x, y, br0);
      bg.addColorStop(0, '#fff1c4');
      bg.addColorStop(0.35, '#d9b060');
      bg.addColorStop(1, '#5e3f12');
      ctx.fillStyle = bg;
      ctx.beginPath();
      ctx.arc(x, y, br0, 0, TAU);
      ctx.fill();
    }
    // 4. the inner lip: a dark gasket where brass meets glass
    ctx.strokeStyle = 'rgba(15,8,2,0.85)';
    ctx.lineWidth = 7 * (r / 482);
    ctx.beginPath();
    ctx.arc(cx, cy, r + 2, 0, TAU);
    ctx.stroke();
    ctx.restore();
  }

  function view(ctx, inner, o = {}) {
    const kind = o.kind || 'eyepiece';
    const cx = o.cx != null ? o.cx : 540;
    const cy = o.cy != null ? o.cy : 540;
    const r = o.r != null ? o.r : 482;
    ctx.save();
    ctx.fillStyle = '#050505';
    ctx.fillRect(0, 0, W, W);
    aperture(ctx, inner, cx, cy, r, kind === 'porthole');
    if (kind === 'porthole') portholeBody(ctx, cx, cy, r, o);
    else eyepieceBody(ctx, cx, cy, r, o.depth || 0);
    // soft aperture edge
    const e = ctx.createRadialGradient(cx, cy, r - 16, cx, cy, r + 10);
    e.addColorStop(0, 'rgba(0,0,0,0)');
    e.addColorStop(0.6, 'rgba(0,0,0,0.55)');
    e.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = e;
    ctx.beginPath();
    ctx.arc(cx, cy, r + 10, 0, TAU);
    ctx.arc(cx, cy, Math.max(0, r - 16), 0, TAU, true);
    ctx.fill('evenodd');
    ctx.restore();
  }

  // ---------------------------------------------------------------- timing
  /** list: [{ f, ... }] with f = frames shown; t: seconds since item 0. Returns { item, i, t, dur }. */
  function sequence(list, t) {
    let t0 = 0;
    for (let i = 0; i < list.length; i++) {
      const d = list[i].f / 24;
      if (t < t0 + d - 1e-6 || i === list.length - 1) return { item: list[i], i, t: Math.max(0, t - t0), dur: d };
      t0 += d;
    }
    return null;
  }

  // ---------------------------------------------------------------- tall pans
  function mk(w, h) {
    if (FILM.makeCanvas) return FILM.makeCanvas(w, h);
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    return c;
  }
  /** layers top to bottom: [{ id, y }]; every layer after the first fades in over its top o.feather px */
  function stack(key, layers, o = {}) {
    const feather = o.feather || 420;
    return L.cached('instrument-stack-' + key, () => {
      let H = 0;
      for (const ly of layers) {
        const m = FILM.PHOTOS[ly.id];
        H = Math.max(H, Math.ceil(ly.y + (W * m.h) / m.w));
      }
      const c = mk(W, o.height || H);
      const g = c.getContext('2d');
      g.imageSmoothingQuality = 'high';
      layers.forEach((ly, i) => {
        const img = FILM.photo(ly.id);
        const m = FILM.PHOTOS[ly.id];
        const h = (W * m.h) / m.w;
        if (i === 0) return g.drawImage(img, 0, ly.y, W, h);
        const tmp = mk(W, Math.ceil(h));
        const tg = tmp.getContext('2d');
        tg.imageSmoothingQuality = 'high';
        tg.drawImage(img, 0, 0, W, h);
        tg.globalCompositeOperation = 'destination-in';
        const gr = tg.createLinearGradient(0, 0, 0, feather);
        gr.addColorStop(0, 'rgba(0,0,0,0)');
        gr.addColorStop(1, 'rgba(0,0,0,1)');
        tg.fillStyle = gr;
        tg.fillRect(0, 0, W, h);
        g.drawImage(tmp, 0, ly.y);
      });
      return c;
    });
  }
  function pan(ctx, canvas, y, o = {}) {
    // sharp copy first, blurred copy over it: the blur pulls in picture at the edges, never black,
    // and the framing stays 1:1 for a clip handover
    ctx.drawImage(canvas, 0, y, W, W, 0, 0, W, W);
    if (o.blur > 0.01) {
      ctx.save();
      ctx.filter = `blur(${o.blur.toFixed(2)}px)`;
      ctx.drawImage(canvas, 0, y, W, W, 0, 0, W, W);
      ctx.restore();
    }
    // settle { id, alpha }: fade the bare bottom plate in over the window (under the same blur). The
    // stack's feather leaves the layer above showing through the plate's top; the handover clip was
    // generated from the bare plate, so the last frames must be the bare plate or the cut jumps.
    if (o.settle && o.settle.alpha > 0) {
      ctx.save();
      ctx.globalAlpha = clamp(o.settle.alpha);
      if (o.blur > 0.01) ctx.filter = `blur(${o.blur.toFixed(2)}px)`;
      plate(ctx, o.settle.id, {});
      ctx.restore();
    }
  }

  // ---------------------------------------------------------------- titles
  // The Claude spark, measured off Anthropic's own end card: 12 rays of even width with round ends,
  // at uneven angles (degrees counter-clockwise from 3 o'clock) and uneven lengths, meeting in a solid
  // centre. Tapered petals or a visible hub read as a daisy, not the mark.
  const RAYS = [
    [12, 0.97], [48, 0.98], [81, 0.95], [116, 1.0], [145, 0.96], [181, 0.92],
    [215, 0.93], [238, 0.96], [267, 0.95], [301, 0.92], [321, 0.99], [350, 0.97],
  ];
  function spark(ctx, cx, cy, r, color = '#ffffff') {
    ctx.save();
    ctx.translate(cx, cy);
    ctx.strokeStyle = color;
    ctx.fillStyle = color;
    ctx.lineCap = 'round';
    ctx.lineWidth = r * 0.19;
    const cap = ctx.lineWidth / 2;
    ctx.beginPath();
    for (const [deg, len] of RAYS) {
      const a = (deg * Math.PI) / 180;
      ctx.moveTo(0, 0);
      ctx.lineTo(Math.cos(a) * (r * len - cap), -Math.sin(a) * (r * len - cap));
    }
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(0, 0, r * 0.25, 0, TAU);
    ctx.fill();
    ctx.restore();
  }

  const SERIF = '"Charter", "Georgia", "Times New Roman", serif';
  function wordmark(ctx, text, o = {}) {
    const size = o.size || 104;
    const alpha = clamp(o.alpha != null ? o.alpha : 1);
    if (alpha <= 0) return;
    const cy = o.y != null ? o.y : 540;
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.font = `${o.weight || 400} ${size}px ${SERIF}`;
    ctx.textBaseline = 'alphabetic';
    const tw = ctx.measureText(text).width;
    const sr = o.spark ? size * 0.46 : 0;
    const gap = o.spark ? size * 0.16 : 0;
    const total = tw + (o.spark ? sr * 2 + gap : 0);
    const x0 = 540 - total / 2;
    const base = cy + size * 0.34;
    const tx = x0 + (o.spark ? sr * 2 + gap : 0);
    ctx.shadowColor = 'rgba(40,60,90,0.28)';
    ctx.shadowBlur = 18;
    ctx.fillStyle = o.color || '#ffffff';
    if (o.spark) spark(ctx, x0 + sr, cy + size * 0.02, sr, o.color || '#ffffff');
    ctx.textAlign = 'left';
    ctx.fillText(text, tx, base);
    // Charter regular reads light against a medium-weight reference: thicken by a hair
    ctx.shadowColor = 'rgba(0,0,0,0)';
    ctx.strokeStyle = o.color || '#ffffff';
    ctx.lineWidth = size * 0.016;
    ctx.lineJoin = 'round';
    ctx.strokeText(text, tx, base);
    ctx.restore();
  }

  FILM.instrument = Object.freeze({ plate, clip, view, sequence, stack, pan, spark, wordmark, clamp });
})();
