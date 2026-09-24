// game/30-draw.js : paints one snapshot (game/10-engine.js) into the console's 320x180 frame buffer.
// Every pixel is repainted each frame, only in lib.NES colours, through lib.sprite / lib.pxtext.
// Owner: game.
//
// Layers, back to front: backdrop (a flash may replace it for a frame); then, clipped below the HUD band
// (y >= 32) so nothing from the world ever enters it: scenery (clouds, hills, bushes, the castle flag, the
// castle); sprites that sit behind the tiles (a power-up rising out of its block, Claw'd inside a pipe,
// the boss sinking into the lava); tiles; bumped blocks; sprites; score pops; the castle's door and right
// wall redrawn over Claw'd as he walks in. Then the HUD and the title / lives / ending text.
(function () {
  'use strict';
  const FILM = (window.FILM = window.FILM || {});
  const CQ = FILM.__cq;
  const rowTop = CQ.rowTop;

  let L = null; // FILM.lib, resolved on first draw (lib.js loads before the game, but stay lazy)
  let N = null;
  let PALS = null;
  function libs() {
    if (L) return;
    L = FILM.lib;
    N = L.NES;
    // palette slots used by the snapshot: 1-4 the Claude spark cycle (the fourth is Claw'd's own),
    // 5 and 6 the underground bugs (the overworld bug's black legs would vanish on black)
    const SP = L.SPAL || {};
    const star = SP.clawdStar || [];
    PALS = [null, star[0], star[1], star[2], star[3], SP.bugU, SP.shellbugU];
  }

  const MANI = () => FILM.SPRITE_MANIFEST || {};
  const A = CQ.ANCHOR;
  // one reusable options object: lib.sprite reads it synchronously
  const O = { flip: false, flipV: false, pal: undefined };
  function spr(ctx, name, x, y, flags, pal) {
    if (flags & (A.FEET | A.RIGHT | A.LEFT)) {
      const m = MANI()[name];
      const w = m ? m.w : 16, h = m ? m.h : 16;
      y -= h;
      if (flags & A.FEET) x -= w >> 1;
      else if (flags & A.RIGHT) x -= w;
    }
    O.flip = !!(flags & 1);
    O.flipV = !!(flags & 2);
    O.pal = pal ? PALS[pal] || undefined : undefined;
    L.sprite(ctx, name, x, y, O);
  }

  // ------------------------------------------------------------------------------------------
  // Scenery (overworld): the level's own hand-placed list (def.scenery), checked against the map once:
  // a hill or bush is dropped if any column under it lacks ground or holds a pipe, block or the pole
  // ------------------------------------------------------------------------------------------
  const sceneryCache = new Map();
  const POLE_CODES = ['|'.charCodeAt(0), '!'.charCodeAt(0)];
  function scenery(lv) {
    if (sceneryCache.has(lv.idx)) return sceneryCache.get(lv.idx);
    const out = [];
    const orig = lv.orig;
    const w = lv.w;
    const at = (tx, ty) => (tx < 0 || tx >= w || ty < 0 || ty > 11 ? 46 : orig[ty * w + tx]);
    const M = MANI();
    for (const [name, col, cy] of lv.def.scenery || []) {
      const m = M[name] || { w: 32, h: 16 };
      const x = Math.round(col * 16);
      if (name.startsWith('cloud')) {
        out.push([name, x, cy, 0]);
        continue;
      }
      let ok = true;
      for (let c = Math.floor(x / 16); c <= Math.floor((x + m.w - 1) / 16) && ok; c++) {
        if (CQ.SOLID[at(c, 10)] !== 1) ok = false;
        for (let r = 7; r <= 9 && ok; r++) if (CQ.SOLID[at(c, r)] === 1 || POLE_CODES.indexOf(at(c, r)) >= 0) ok = false;
      }
      if (ok) out.push([name, x, 148 - m.h, name.startsWith('hill') ? 1 : 2]);
    }
    // clouds, then hills, then bushes in front
    out.sort((p, q) => p[3] - q[3]);
    sceneryCache.set(lv.idx, out);
    return out;
  }

  // ------------------------------------------------------------------------------------------
  // Tiles
  // ------------------------------------------------------------------------------------------
  const TILE = {};
  function tileTable(kind) {
    if (TILE[kind]) return TILE[kind];
    const t = new Array(128).fill(null);
    const set = (ch, name) => (t[ch.charCodeAt(0)] = name);
    const names = CQ.TILE_NAMES[kind];
    for (const ch in names) set(ch, names[ch]);
    set('[', 't_pipeTL'); set(']', 't_pipeTR'); set('{', 't_pipeL'); set('}', 't_pipeR');
    set('h', 't_pipeHT'); set('H', 't_pipeHB'); set('-', 't_pipeHBodyT'); set('_', 't_pipeHBodyB');
    set('j', 't_pipeJoinT'); set('J', 't_pipeJoinB');
    set('!', 't_poleTop'); set('|', 't_pole'); set('%', 't_chain'); set('l', 't_lava');
    set('?', '?'); set('M', '?'); set('o', 'o'); set('L', 'L');
    TILE[kind] = t;
    return t;
  }

  // the tile code of cell i as it was when the snapshot was taken (chg = length of the change log then)
  function histOf(lv) {
    if (lv.histLen === lv.changes.length) return lv.hist;
    const h = new Map();
    const c = lv.changes;
    for (let k = 0; k < c.length; k += 2) {
      let a = h.get(c[k]);
      if (!a) h.set(c[k], (a = []));
      a.push(k, c[k + 1]);
    }
    lv.hist = h;
    lv.histLen = c.length;
    return h;
  }
  function codeAt(lv, hist, i, chg) {
    const a = hist.get(i);
    if (!a) return lv.orig[i];
    let code = lv.orig[i];
    for (let k = 0; k < a.length; k += 2) {
      if (a[k] < chg) code = a[k + 1];
      else break;
    }
    return code;
  }

  // the ? block shimmer on the console's 48-frame cadence (lib.shimmer)
  const qName = (f) => 't_q' + (1 + L.shimmer(f));

  function drawTiles(ctx, s, f) {
    const lv = s.lv;
    const tab = tileTable(lv.def.kind);
    const hist = histOf(lv);
    const cam = s.cam;
    const tx0 = Math.max(0, Math.floor(cam / 16)), tx1 = Math.min(lv.w - 1, Math.floor((cam + 319) / 16));
    const hide = s.hide;
    const q = qName(f);
    const lava = (s.lt >> 4) & 1 ? 't_lavaTop2' : 't_lavaTop1';
    const coin = 'coin' + (1 + ((f >> 3) & 3));
    for (let ty = 0; ty < 12; ty++) {
      const y = rowTop(ty);
      for (let tx = tx0; tx <= tx1; tx++) {
        const i = ty * lv.w + tx;
        const code = codeAt(lv, hist, i, s.chg);
        const name = tab[code];
        if (!name) continue;
        if (hide && hide.indexOf(i) >= 0) continue;
        const x = tx * 16 - cam;
        if (name === '?') L.sprite(ctx, q, x, y);
        else if (name === 'o') L.sprite(ctx, coin, x + 4, y + 1);
        else if (name === 'L') L.sprite(ctx, lava, x, y);
        else L.sprite(ctx, name, x, y);
      }
    }
  }

  // ------------------------------------------------------------------------------------------
  // HUD and text
  // ------------------------------------------------------------------------------------------
  // Text layers (the HUD, the title, the lives screen, the ending) are painted once per distinct
  // content into their own transparent canvas and blitted: pixel text is thousands of 1-px fills.
  // Each layer is a pure function of its key, so the cache never changes what a frame shows.
  const layers = new Map();
  function layer(ctx, id, key, h, paint) {
    let e = layers.get(id);
    if (!e) {
      const c = FILM.makeCanvas(320, h);
      e = { c, g: c.getContext('2d'), key: null };
      e.g.imageSmoothingEnabled = false;
      layers.set(id, e);
    }
    if (e.key !== key) {
      e.g.clearRect(0, 0, 320, h);
      paint(e.g);
      e.key = key;
    }
    ctx.drawImage(e.c, 0, 0);
  }
  function hud(ctx, s, f) {
    const shim = L.shimmer(f);
    const time = s.time >= 0 ? s.time : null;
    layer(ctx, 'hud', s.score + '|' + s.coins + '|' + s.world + '|' + time + '|' + shim, L.HUD_H || 32, (g) =>
      L.hud(g, { score: s.score, coins: s.coins, world: s.world, time, frame: f })
    );
  }

  // The title: the Claude-Code-style welcome box, the menu with its ▶ cursor, the high score.
  function titleText(ctx, s) {
    // after START the cursor flickers while the console gets ready
    const blink = s.title.started && (s.title.mt >> 2) & 1 ? 1 : 0;
    layer(ctx, 'title', s.top + '|' + blink, 180, (g) => {
      const white = N[0x30];
      L.titleBox(g, 160, 38, { text: 'CLAUDE QUEST', lines: ['©1986 CLAWD SOFT'] });
      if (!blink) L.pxtext(g, '▶', 110, 94, { color: N[0x26] });
      L.pxtext(g, 'NEW QUEST', 124, 94, { color: white });
      L.pxtext(g, 'CONTINUE', 124, 106, { color: white });
      L.pxtext(g, 'HI-SCORE ' + String(s.top).padStart(6, '0'), 160, 122, { color: white, align: 'center' });
    });
  }

  function livesText(ctx, s) {
    layer(ctx, 'lives', s.world + '|' + s.lives, 180, (g) => {
      const white = N[0x30];
      L.pxtext(g, 'WORLD ' + s.world, 160, 68, { color: white, align: 'center' });
      L.sprite(g, 'clawdS_idle', 132, 86);
      L.pxtext(g, '×', 158, 91, { color: white });
      L.pxtext(g, String(s.lives), 176, 91, { color: white });
    });
  }

  // The ending: Pearl's line centred in her teal, then the completion summary as a left-aligned block
  // (✻ in salmon, ✓ in green), typed on a character a frame; PUSH START TO SHIP IT blinks under it.
  // Everything sits between the HUD band and the heads of Claw'd and Pearl (y 124).
  const END_Y = [42, 62, 74, 86, 98];
  const END_PUSH_Y = 114;
  function endingText(ctx, s) {
    const e = s.end;
    layer(ctx, 'ending', e.lines.join('/') + '|' + e.chars.join(',') + '|' + e.push, 180, (g) => {
      const white = N[0x30];
      const lines = e.lines;
      if (e.chars[0] > 0) {
        const x = 160 - Math.floor(L.pxtextWidth(lines[0]) / 2);
        L.pxtext(g, lines[0].slice(0, e.chars[0]), x, END_Y[0], { color: N[0x3c] });
      }
      let bw = 0;
      for (let i = 1; i < lines.length; i++) bw = Math.max(bw, L.pxtextWidth(lines[i]));
      const bx = 160 - Math.floor(bw / 2);
      for (let i = 1; i < lines.length; i++) {
        const n = e.chars[i];
        if (n <= 0) continue;
        const mark = lines[i][0];
        L.pxtext(g, mark, bx, END_Y[i], { color: mark === '✻' ? N[0x26] : N[0x2a] });
        if (n > 1) L.pxtext(g, lines[i].slice(1, n), bx + 8, END_Y[i], { color: white });
      }
      if (e.push === 1) L.pxtext(g, 'PUSH START TO SHIP IT', 160, END_PUSH_Y, { color: N[0x28], align: 'center' });
    });
  }

  // ------------------------------------------------------------------------------------------
  // The frame
  // ------------------------------------------------------------------------------------------
  const CASTLE_Y = 68; // the castle stands on the ground (80 tall, bottom at y 148)
  const CASTLE_TIP = [68, 16]; // the right turret's tip, where the castle flag's staff stands
  // film: true for the film's frames (FILM.game.draw), false for a live console (FILM.game.create)
  function drawSnap(ctx, s, f, film) {
    libs();
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.imageSmoothingEnabled = false;
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
    const TL = FILM.TIMELINE;
    const off = film && TL && TL.crt && TL.crt.powerOff;
    // the film's set is dark after its power-off; a live console never is
    if (s.m === 3 || (off && f >= off[1])) {
      ctx.fillStyle = N[0x0f];
      ctx.fillRect(0, 0, 320, 180);
      if (s.m === 3) L.pxtext(ctx, 'GAME OVER', 160, 86, { color: N[0x30], align: 'center' });
      ctx.restore();
      return;
    }
    if (s.m === 1) {
      ctx.fillStyle = N[0x0f];
      ctx.fillRect(0, 0, 320, 180);
      hud(ctx, s, f);
      livesText(ctx, s);
      ctx.restore();
      return;
    }
    const lv = s.lv;
    const kind = lv.def.kind;
    const cam = s.cam;
    ctx.fillStyle = s.flash ? N[s.flash] : kind === 'over' ? N[0x22] : N[0x0f];
    ctx.fillRect(0, 0, 320, 180);
    // the world, clipped below the HUD band
    const HB = L.HUD_H || 32;
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, HB, 320, 180 - HB);
    ctx.clip();
    for (const [name, x, y] of scenery(lv)) {
      const sx = x - cam;
      const m = MANI()[name];
      if (sx > 320 || sx + (m ? m.w : 80) < 0) continue;
      L.sprite(ctx, name, sx, y);
    }
    const cx = lv.def.castle ? lv.def.castle * 16 - cam : null;
    const castleOn = cx !== null && cx < 320 && cx > -96;
    if (castleOn) {
      if (s.cflag > 0) {
        // the flag climbs out of the turret's tip
        const tipY = CASTLE_Y + CASTLE_TIP[1];
        ctx.save();
        ctx.beginPath();
        ctx.rect(cx + CASTLE_TIP[0], HB, 16, tipY - HB);
        ctx.clip();
        L.sprite(ctx, 'castleFlag', cx + CASTLE_TIP[0], tipY - s.cflag);
        ctx.restore();
      }
      L.sprite(ctx, 'castle', cx, CASTLE_Y);
    }
    const spr16 = s.spr;
    const NAMES = CQ.NAMES;
    // sprites behind the tiles
    for (let k = 0; k < spr16.length; k += 5) {
      const fl = spr16[k + 3];
      if (fl & 4 && spr16[k] < 1000) spr(ctx, NAMES[spr16[k]], spr16[k + 1] - cam, spr16[k + 2], fl, spr16[k + 4]);
    }
    drawTiles(ctx, s, f);
    // bumped blocks, then the sprites and score pops (a pop's x is its centre)
    for (let k = 0; k < spr16.length; k += 5) {
      const fl = spr16[k + 3];
      if (fl & 16) L.sprite(ctx, NAMES[spr16[k]], spr16[k + 1] - cam, spr16[k + 2]);
    }
    for (let k = 0; k < spr16.length; k += 5) {
      const n = spr16[k];
      const fl = spr16[k + 3];
      if (n >= 1000) L.scoreText(ctx, CQ.POPS[n - 1000], spr16[k + 1] - cam, spr16[k + 2], { align: 'center' });
      else if (!(fl & 20)) spr(ctx, NAMES[n], spr16[k + 1] - cam, spr16[k + 2], fl, spr16[k + 4]);
    }
    // walking into the castle: its door and the wall right of it cover him
    if (castleOn && s.door >= 0) {
      ctx.save();
      ctx.beginPath();
      ctx.rect(s.door - cam, CASTLE_Y, cx + 80 - (s.door - cam), 80);
      ctx.clip();
      L.sprite(ctx, 'castle', cx, CASTLE_Y);
      ctx.restore();
    }
    ctx.restore();
    hud(ctx, s, f);
    if (s.m === 0 && s.title) titleText(ctx, s);
    if (s.end) endingText(ctx, s);
    ctx.restore();
  }
  CQ.drawSnap = drawSnap;

  // Warm-up: build every sprite drawing the film will blit (each name, mirror, flip and palette it
  // appears in, every tile and scenery piece) on an off-screen canvas once, before the first frame,
  // so no frame pays for building one mid-film. Only lib's own caches change; no pixel does.
  function warm(states) {
    libs();
    const c = FILM.makeCanvas(64, 64);
    const g = c.getContext('2d');
    const seen = new Set();
    const NAMES = CQ.NAMES;
    for (const st of states) {
      const sp = st.spr;
      if (!sp) continue;
      for (let k = 0; k < sp.length; k += 5) {
        const n = sp[k];
        if (n >= 1000) continue;
        const key = n * 4096 + (sp[k + 3] & 3) * 256 + sp[k + 4];
        if (seen.has(key)) continue;
        seen.add(key);
        spr(g, NAMES[n], 0, 0, sp[k + 3] & 3, sp[k + 4]);
      }
    }
    const M = MANI();
    for (const name in M) L.sprite(g, name, 0, 0);
    return seen.size;
  }
  CQ.warm = warm;
})();
