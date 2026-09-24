// game/13-platforms.js : lifts (horizontal, vertical, falling), springs and lava embers. Owner: P2.
// docs/game-spec.md 6.3 (X3), 6.4 (X4) and 6.5 (X5).
//
// One system behind the engine seam (docs/game-spec.md 2.4), called only for live worlds. Lift and
// ember positions are pure functions of the level clock lv.t (a falling lift is the one exception: it
// falls from its first contact), so a paused, cloned or replayed world always agrees.
// p.ride is an index into lv.lifts (or -1), never an object, so the engine's flat copy of the player stays
// correct in cloneWorld.
(function () {
  'use strict';
  const FILM = (window.FILM = window.FILM || {});
  const CQ = (FILM.__cq = FILM.__cq || {});
  const register = (sys) => {
    const i = CQ.systems.findIndex((q) => q.name === sys.name);
    if (i >= 0) CQ.systems[i] = sys;
    else CQ.systems.push(sys);
  };
  const K = CQ.K;
  const { Q, PH, BUTTONS, rowTop, rowOf, cell, solidAt, bodyL, bodyR, bodyH } = K;
  const FLAG = CQ.FLAG;

  const FALL_DELAY = 20; // a falling lift shakes this many frames after its first contact
  const FALL_ACC = Q(0x100), FALL_MAX = 2;
  const GONE_Y = 200;

  const flat = (o) => Object.assign({}, o);
  const mod = (a, m) => ((a % m) + m) % m;
  // the back-and-forth offset of a lift at level clock t: 0 .. D .. 0 over 2D steps
  function swing(t, speed, phase, D) {
    if (!(D > 0)) return 0;
    const o = mod(Math.floor(t * speed) + (phase | 0), 2 * D);
    return o < D ? o : 2 * D - o;
  }

  // ------------------------------------------------------------------------------------------
  // X3 lifts
  // ------------------------------------------------------------------------------------------
  function makeLift(d) {
    const w = Math.max(1, d.w | 0 || 3);
    const L = { k: d.k, tx: d.tx, w, x: d.tx * 16, y: 0, dx: 0, dy: 0 };
    if (d.k === 'h') Object.assign(L, { y0: d.y, x1: d.x1, speed: d.speed != null ? d.speed : 1, phase: d.phase | 0 });
    else if (d.k === 'v') Object.assign(L, { y0: d.y0, y1: d.y1, speed: d.speed != null ? d.speed : 0.5, phase: d.phase | 0 });
    else Object.assign(L, { k: 'fall', y0: d.y, st: 'still', t: 0, vy: 0 });
    place(L, 0);
    L.dx = 0;
    L.dy = 0;
    return L;
  }
  // put a lift where it is at level clock t (h and v); a falling lift runs its own state
  function place(L, t) {
    if (L.k === 'h') {
      L.x = L.tx * 16 + swing(t, L.speed, L.phase, L.x1 - L.tx * 16);
      L.y = L.y0;
    } else if (L.k === 'v') {
      L.x = L.tx * 16;
      L.y = L.y1 - swing(t, L.speed, L.phase, L.y1 - L.y0);
    } else if (t === 0) {
      L.x = L.tx * 16;
      L.y = L.y0;
    }
  }
  function advanceFall(W, L) {
    if (L.st === 'shake') {
      if (++L.t > FALL_DELAY) L.st = 'fall';
    }
    if (L.st === 'fall') {
      L.vy = Math.min(FALL_MAX, L.vy + FALL_ACC);
      L.y += L.vy;
      if (L.y > GONE_Y) L.st = 'gone';
    }
  }
  const alive = (L) => L.k !== 'fall' || L.st !== 'gone';
  // his feet over the lift's top face (the same foot probes the engine uses on tiles)
  const over = (p, L) => bodyR(p) - 1 >= L.x && bodyL(p) + 1 <= L.x + L.w * 16 - 1;
  const onTile = (lv, p) => solidAt(lv, bodyL(p) + 1, p.y) || solidAt(lv, bodyR(p) - 1, p.y);

  // a rider now stands on lift i: a falling lift starts to crumble on its first contact
  function board(W, lv, p, i) {
    const L = lv.lifts[i];
    p.ride = i;
    if (L.k === 'fall' && L.st === 'still') {
      L.st = 'shake';
      L.t = 0;
      K.emit(W, 'crumble');
    }
  }

  function preLifts(W, lv, p) {
    const lifts = lv.lifts;
    for (const L of lifts) {
      const x = L.x, y = L.y;
      if (L.k === 'fall') advanceFall(W, L);
      else place(L, lv.t);
      L.dx = L.x - x;
      L.dy = L.y - y;
    }
    if (p.ride >= 0) {
      const L = lifts[p.ride];
      // the ride ends with a jump, a scripted state, a gone lift, or when a tile took his feet
      if (!L || !alive(L) || p.st !== 'play' || !p.ground || onTile(lv, p)) p.ride = -1;
      else {
        if (L.dx) K.nudgeX(W, lv, p, L.dx);
        p.y = L.y;
      }
      return;
    }
    // a lift rising through the feet of a player standing beside it picks him up
    if (p.st === 'play' && p.ground) {
      for (let i = 0; i < lifts.length; i++) {
        const L = lifts[i];
        if (!alive(L) || L.dy >= 0) continue;
        if (L.y - L.dy >= p.y && L.y < p.y && over(p, L)) {
          p.y = L.y;
          board(W, lv, p, i);
          return;
        }
      }
    }
  }

  // moveY, grounded with no tile under the feet: the lift he rides (or one level with his feet) holds him
  function supportLift(W, lv, p) {
    const lifts = lv.lifts;
    if (p.ride >= 0) {
      const L = lifts[p.ride];
      if (L && alive(L) && over(p, L) && Math.abs(p.y - L.y) <= 1) {
        p.y = L.y;
        return true;
      }
      p.ride = -1; // walked off the span: the engine starts the fall (and coyote time)
      return false;
    }
    for (let i = 0; i < lifts.length; i++) {
      const L = lifts[i];
      if (alive(L) && over(p, L) && Math.abs(p.y - L.y) <= 1) {
        p.y = L.y;
        board(W, lv, p, i);
        return true;
      }
    }
    return false;
  }

  // moveY, falling, no tile landing: the top face is one-way. y0 is where his feet were last frame.
  function landLift(W, lv, p, y0) {
    if (p.vy < 0) return false;
    let best = -1;
    for (let i = 0; i < lv.lifts.length; i++) {
      const L = lv.lifts[i];
      if (!alive(L)) continue;
      const top = L.y;
      if (y0 <= top - L.dy && p.y >= top && over(p, L) && (best < 0 || top < lv.lifts[best].y)) best = i;
    }
    if (best < 0) return false;
    p.y = lv.lifts[best].y;
    board(W, lv, p, best);
    return true;
  }

  function liftName(lv) {
    const k = lv.def.kind;
    return k === 'under' ? 'liftU' : k === 'castle' ? 'liftC' : 'lift';
  }

  // ------------------------------------------------------------------------------------------
  // X4 springs (the S tile)
  // ------------------------------------------------------------------------------------------
  const SPRING = 'S'.charCodeAt(0);
  const SPRING_HELD = { vy: -5, gHold: Q(0x240), gFall: Q(0x900) }; // rise 86.4 px in 35 frames
  const SPRING_FREE = { vy: -4, gFall: Q(0x700) }; // rise 16.3 px
  const SPRING_ANIM = 3; // spring2 for 3 frames, spring3 for 3, then spring1

  function springAt(lv, p) {
    const ty = rowOf(p.y);
    for (const x of [bodyL(p) + 1, bodyR(p) - 1]) {
      const tx = Math.floor(x / 16);
      if (cell(lv, tx, ty) === SPRING) return { tx, ty };
    }
    return null;
  }
  function launch(W, lv, p, btn, at) {
    const held = (btn & BUTTONS.A) !== 0;
    const run = (btn & BUTTONS.B) !== 0 || Math.abs(p.vx) > PH.maxWalk;
    if (held) {
      p.vy = SPRING_HELD.vy;
      p.gHold = SPRING_HELD.gHold;
      p.gFall = SPRING_HELD.gFall;
      p.jumping = true;
    } else {
      p.vy = SPRING_FREE.vy;
      p.gHold = SPRING_HELD.gHold;
      p.gFall = SPRING_FREE.gFall;
      p.jumping = false;
    }
    p.ground = false;
    p.jumped = true; // the jump pose, and no coyote jump in mid-air
    p.skid = false;
    p.airMax = run ? PH.maxRun : PH.maxWalk;
    p.coyote = 0;
    p.buf = 0;
    p.ride = -1;
    const s = lv.springs.find((q) => q.tx === at.tx && q.ty === at.ty);
    if (s) s.t0 = lv.t;
    K.emit(W, 'spring', { held });
  }

  // ------------------------------------------------------------------------------------------
  // X5 embers
  // ------------------------------------------------------------------------------------------
  const EMBER_REST = 164; // feet line at rest, behind the lava surface
  const EMBER_VY = -5, EMBER_G = Q(0x300); // rise 64.2 px, back in about 54 frames
  const EMBER_BEHIND = 152; // drawn behind the tiles while its feet are below this line
  // The tell: for EMBER_TELL frames before every leap the lava at its column glows white-hot and boils
  // (two bubbles), and for the last EMBER_PEEK frames the ember's head shows above the surface. Drawn
  // only; the ember cannot hurt until it leaps. A pure function of lv.t, like the leap itself.
  const EMBER_TELL = 36, EMBER_PEEK = 12;
  // frames until the next leap (period when it leaps this frame)
  const emberDue = (lv, e) => e.period - mod(lv.t + e.phase, e.period);

  function stepEmbers(W, lv) {
    const p = W.p;
    for (const e of lv.embers) {
      if (e.period > 0 && mod(lv.t + e.phase, e.period) === 0) {
        e.up = true;
        e.y = EMBER_REST;
        e.vy = e.v0;
        if (e.x > W.cam - 16 && e.x < W.cam + 320) K.emit(W, 'ember');
      } else if (e.up) {
        e.vy += EMBER_G;
        e.y += e.vy;
        if (e.vy > 0 && e.y >= EMBER_REST) {
          e.y = EMBER_REST;
          e.vy = 0;
          e.up = false;
        }
      }
      if (!e.up || p.st !== 'play' || p.star !== 0 || p.inv !== 0) continue;
      // hitbox x+3..x+13, y-13..y-3 (y is the feet)
      if (bodyR(p) + 1 > e.x + 3 && bodyL(p) < e.x + 13 && p.y > e.y - 13 && p.y - bodyH(p) < e.y - 3) K.hurt(W, false, 'fire');
    }
  }

  // ------------------------------------------------------------------------------------------
  // the system
  // ------------------------------------------------------------------------------------------
  // registered once, by name (a second load of this file replaces it rather than doubling every hook)
  register({
    name: 'platforms',
    spawn: {
      // the spring stays in the grid as a solid tile; the system draws it and fires it
      S(lv, tx, ty) {
        (lv.springs || (lv.springs = [])).push({ tx, ty, t0: -100 });
        return 'S';
      },
    },
    build(lv, def) {
      lv.lifts = (def.lifts || []).map(makeLift);
      if (!lv.springs) lv.springs = [];
      // d.vy (optional): this ember's leap speed, for a lower leap than the standard -5
      lv.embers = (def.embers || []).map((d) => ({ tx: d.tx, x: d.tx * 16, period: d.period | 0, phase: d.phase | 0, v0: d.vy != null ? d.vy : EMBER_VY, y: EMBER_REST, vy: 0, up: false }));
      // the columns whose lava only boils as an ember's tell (the engine's ambient bubbles skip them)
      lv.emberCols = lv.embers.map((e) => e.tx);
    },
    enter(W, lv) {
      if (W.p) W.p.ride = -1;
    },
    pre(W, lv, p) {
      if (lv.lifts.length) preLifts(W, lv, p);
    },
    support(W, lv, p) {
      return lv.lifts.length > 0 && supportLift(W, lv, p);
    },
    land(W, lv, p, y0) {
      return lv.lifts.length > 0 && landLift(W, lv, p, y0);
    },
    grounded(W, lv, p, btn) {
      if (!lv.springs.length || p.ride >= 0 || p.st !== 'play') return;
      const at = springAt(lv, p);
      if (at) launch(W, lv, p, btn, at);
    },
    step(W, lv) {
      if (lv.embers.length) stepEmbers(W, lv);
    },
    sprites(W, lv, out, vf) {
      const lo = W.cam - 48, hi = W.cam + 336;
      if (lv.lifts.length) {
        const n = CQ.ni(liftName(lv));
        for (const L of lv.lifts) {
          if (!alive(L)) continue;
          // a falling lift shakes 1 px either way while it crumbles (drawn only: his feet stay put)
          const sx = L.k === 'fall' && L.st === 'shake' && L.t > 0 ? (L.t & 1 ? 1 : -1) : 0;
          const x = Math.floor(L.x) + sx, y = Math.floor(L.y);
          for (let i = 0; i < L.w; i++) if (x + i * 16 > lo && x + i * 16 < hi) out.push(n, x + i * 16, y, 0, 0);
        }
      }
      for (const s of lv.springs) {
        const x = s.tx * 16;
        if (x < lo || x > hi) continue;
        const age = lv.t - s.t0;
        const name = age >= 0 && age < SPRING_ANIM ? 'spring2' : age >= SPRING_ANIM && age < 2 * SPRING_ANIM ? 'spring3' : 'spring1';
        out.push(CQ.ni(name), x, rowTop(s.ty), 0, 0);
      }
      for (const e of lv.embers) {
        if (e.x < lo || e.x > hi) continue;
        if (!e.up) {
          const due = e.period > 0 ? emberDue(lv, e) : e.period + 1;
          if (due > EMBER_TELL) continue;
          // the tell: the surface at its column glows white-hot (the lava tile's own wave drawing), two
          // bubbles boil on it, and for the last frames the ember's head rises into view behind the surface
          const k = EMBER_TELL - due; // 0 .. EMBER_TELL - 1
          const surf = rowTop(10);
          out.push(CQ.ni((lv.t >> 4) & 1 ? 't_lavaGlow2' : 't_lavaGlow1'), e.x, surf, 0, 0);
          if (due <= EMBER_PEEK) {
            const peek = Math.min(8, ((EMBER_PEEK - due) >> 1) + 3); // 3 .. 8 px of it above its rest line
            out.push(CQ.ni('ember' + (1 + ((vf >> 2) & 1))), e.x, EMBER_REST - peek - 16, FLAG.BEHIND, 0);
            continue;
          }
          for (const [dx, off] of [[2, 0], [7, 5]]) {
            const b = (k + off) % 10;
            out.push(CQ.ni(b < 6 ? 'bubble1' : 'bubble2'), e.x + dx, surf - 4 - (b >> 1), 0, 0);
          }
          continue;
        }
        let flags = e.vy > 0 ? FLAG.FLIPV : 0;
        if (e.y > EMBER_BEHIND) flags |= FLAG.BEHIND;
        out.push(CQ.ni('ember' + (1 + ((vf >> 2) & 1))), e.x, Math.floor(e.y) - 16, flags, 0);
      }
    },
    cloneLevel(src, dst) {
      dst.lifts = src.lifts.map(flat);
      dst.springs = src.springs.map(flat);
      dst.embers = src.embers.map(flat);
    },
  });
  CQ.platforms = Object.freeze({ swing, EMBER_REST, EMBER_TELL, FALL_DELAY, emberDue });
})();
