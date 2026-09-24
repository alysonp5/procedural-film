// game/12-foes.js : the new enemies (moth, hover moth, spike beetle) and the Big Bug upgrade (hit points,
// the hit flicker, enrage, the roar spit, the defeat). Owner: P2. docs/game-spec.md 6.1 and 6.2.
//
// Everything here is reached through the engine seam (docs/game-spec.md 2.4): enemy kinds in CQ.KINDS,
// the boss upgrade as a system in CQ.systems. The engine calls both only for live worlds (W.live), so
// the film never sees any of it. Every number is an exact dyadic constant; no trig at run time.
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
  const { Q, PH, rowTop, rowOf, cell, solidAt, bodyL, bodyR, bodyH } = K;
  const PAL = CQ.PAL, FLAG = CQ.FLAG;

  // Math.round(16 * sin(2 pi i / 64)), stored as a literal (never computed at run time)
  const SIN64 = [0, 2, 3, 5, 6, 8, 9, 10, 11, 12, 13, 14, 15, 15, 16, 16, 16, 16, 16, 15, 15, 14, 13, 12, 11, 10, 9, 8, 6, 5, 3, 2,
    0, -2, -3, -5, -6, -8, -9, -10, -11, -12, -13, -14, -15, -15, -16, -16, -16, -16, -16, -15, -15, -14, -13, -12, -11, -10, -9, -8, -6, -5, -3, -2];
  CQ.SIN64 = SIN64;

  const MOTH_VX = -Q(0xc00); // -0.75 px a frame
  const SPIKE_VX = PH.enemyWalk; // 0.5
  const dark = (lv) => lv.def.kind === 'under' || lv.def.kind === 'castle';

  // a stomped moth: the dead fall straight down (vy 0), a bug counted, the stomp combo scored
  function mothStomp(W, lv, e, p) {
    e.st = 'dead';
    e.vy = 0;
    e.vx = 0;
    e.t = 0;
    W.stats.bugs++;
    K.comboPoints(W, p.combo, e.x + 8, e.y - 24);
  }

  // moth: flies left at 0.75 px a frame through the tiles, bobbing 16 px round its spawn line
  CQ.KINDS.moth = {
    top: 12,
    flier: true,
    spiky: false,
    move(W, lv, e) {
      e.vx = MOTH_VX;
      e.x += e.vx;
      e.y = e.y0 + SIN64[e.t & 63];
    },
    onStomp: mothStomp,
    sprite(W, lv, e) {
      const name = e.st === 'dead' ? 'moth1' : (e.t >> 2) & 1 ? 'moth2' : 'moth1';
      return [name, 16, 0, dark(lv) ? PAL.MOTH_U : 0];
    },
  };

  // hover moth: fixed x, bobbing 32 px on the level clock (so a bot can time it), facing the player
  CQ.KINDS.hover = {
    top: 12,
    flier: true,
    spiky: false,
    move(W, lv, e) {
      e.vx = 0;
      e.y = e.y0 + 2 * SIN64[(lv.t >> 1) & 63];
    },
    onStomp: mothStomp,
    sprite(W, lv, e) {
      const name = e.st === 'dead' ? 'moth1' : (lv.t >> 2) & 1 ? 'moth2' : 'moth1';
      // the drawing faces left; mirrored while the player is to its right
      const right = W.p && W.p.x + 8 > e.x + 8;
      return [name, 16, right && e.st !== 'dead' ? FLAG.FLIP : 0, dark(lv) ? PAL.MOTH_U : 0];
    },
  };

  // spike beetle: an edge walker at 0.5 that turns at walls and at ledges (never walks off one); its
  // spikes hurt from every side, stomps included (the engine's spiky rule)
  CQ.KINDS.spike = {
    top: 12,
    flier: false,
    spiky: true,
    move(W, lv, e) {
      if (e.vx === 0) e.vx = -SPIKE_VX;
      if (!e.ground) {
        // spawned in the air (or its floor knocked away): fall like a walker
        e.vy = Math.min(PH.maxFall, e.vy + PH.enemyGrav);
        const y0 = e.y;
        e.y += e.vy;
        if (solidAt(lv, e.x + 4, e.y) || solidAt(lv, e.x + 11, e.y)) {
          const top = rowTop(rowOf(e.y));
          if (top >= y0 - 1) {
            e.y = top;
            e.vy = 0;
            e.ground = true;
          }
        }
        return;
      }
      e.x += e.vx;
      const yy = e.y - 8;
      if (e.vx > 0 && solidAt(lv, e.x + 14, yy)) {
        e.x = Math.floor((e.x + 14) / 16) * 16 - 15;
        e.vx = -e.vx;
        return;
      }
      if (e.vx < 0 && solidAt(lv, e.x + 1, yy)) {
        e.x = Math.floor((e.x + 1) / 16) * 16 + 15;
        e.vx = -e.vx;
        return;
      }
      // the leading foot over air: step back and turn round
      const lead = e.vx > 0 ? e.x + 14 : e.x + 2;
      if (!solidAt(lv, lead, e.y)) {
        e.x -= e.vx;
        e.vx = -e.vx;
        // nothing under either foot any more (the floor went): fall
        if (!solidAt(lv, e.x + 2, e.y) && !solidAt(lv, e.x + 14, e.y)) {
          e.ground = false;
          e.vy = 0;
        }
      }
    },
    // never reached (spiky contact hurts before any stomp), kept so a stomp could never leave it standing
    onStomp(W, lv, e, p) {
      K.hurt(W, false, 'spike');
    },
    sprite(W, lv, e) {
      const name = e.st === 'dead' ? 'spike_walk1' : (e.t >> 3) & 1 ? 'spike_walk2' : 'spike_walk1';
      return [name, 16, e.vx > 0 ? FLAG.FLIP : 0, dark(lv) ? PAL.SPIKE_U : 0];
    },
  };

  // ------------------------------------------------------------------------------------------
  // X2 the Big Bug upgrade
  // ------------------------------------------------------------------------------------------
  const HIT_FRAMES = 16;
  const ENRAGE_HP = 2, ENRAGE_VX = Q(0xc00), ENRAGE_HOP = 90;
  const SPIT_MAX = 2, SPIT_VY = -2, SPIT_G = Q(0x200);
  // The spit is aimed: its speed (0.5 to 2.5 px a frame, in 1/16 px) puts its first landing on the bridge's
  // top face where Claw'd stands, or, when that would take more than the top speed, its bounce's landing.
  // So standing still anywhere in reach gets him hit; a hop over it or a step aside does not.
  const SPIT_VMIN = Q(0x800), SPIT_VMAX = Q(0x2800);
  // Lingering: after LINGER frames of Claw'd off the bridge (on the step before it, say), the Big Bug walks
  // up to the bridge's near end and paces its first HOLD_W px there, until he sets foot on the bridge.
  const LINGER = 90, HOLD_W = 32;
  const LAVA_T = 'L'.charCodeAt(0), LAVA = 'l'.charCodeAt(0);

  const fighting = (b) => !!b && b.active && !b.dead && !b.fall && !b.gone;

  // frames of a spit's flight from y0 down to the bridge's top face (floor, in s.y), and of one bounce there
  function flight(y0, floor) {
    let y = y0, vy = SPIT_VY, n = 0;
    while (n < 240) {
      vy = Math.min(PH.maxFall, vy + SPIT_G);
      y += vy;
      n++;
      if (vy > 0 && y >= floor) break;
    }
    return n;
  }
  function spitVx(W, lv, x0, y0, face) {
    const floor = rowTop(8) - 8;
    const n1 = flight(y0, floor), n2 = flight(floor, floor);
    const d = Math.abs(W.p.x + 8 - (x0 + 4));
    let v = d / n1;
    if (v > SPIT_VMAX) v = d / (n1 + n2);
    v = Math.max(SPIT_VMIN, Math.min(SPIT_VMAX, v));
    return (face * Math.round(v * 16)) / 16;
  }

  // a caret on the boss (called by src/game/14-caret.js). Returns false while the hit flicker runs (the
  // caret poofs without damage), true when the hit counted.
  function hitBoss(W, lv) {
    const b = lv.boss;
    if (!fighting(b) || b.hitT > 0) return false;
    b.hp--;
    b.hitT = HIT_FRAMES;
    K.emit(W, 'bosshit', { hp: b.hp });
    if (b.hp <= ENRAGE_HP && !b.enraged) {
      b.enraged = true;
      b.vx = (b.vx < 0 ? -1 : 1) * ENRAGE_VX;
      b.hopEvery = ENRAGE_HOP;
    }
    if (b.hp <= 0) {
      b.hp = 0;
      K.emit(W, 'bossdefeat');
      K.addScore(W, 5000);
      K.pop(W, K.popOf('5000'), b.x + 16, b.y - 40);
      W.stats.bugs++;
      b.dead = true;
      b.fall = true;
      b.air = false;
      b.vy = -3;
      b.flip = true;
      b.roar = 0;
      K.setSong(W, 'none');
    }
    return true;
  }
  // the boss's body box (the engine's contact box), for the carets
  function bossBox(b) {
    return { l: b.x + 4, r: b.x + 28, t: b.y - 28, b: b.y };
  }
  CQ.foes = Object.freeze({ hitBoss, bossBox, fighting, SIN64 });

  function stepSpit(W, lv) {
    const list = lv.spit;
    const p = W.p;
    for (const s of list) {
      if (s.gone) continue;
      s.t++;
      s.vy = Math.min(PH.maxFall, s.vy + SPIT_G);
      s.x += s.vx;
      // a wall ahead ends it
      if (solidAt(lv, s.x + (s.vx > 0 ? 7 : 0), s.y + 4)) {
        s.gone = true;
        continue;
      }
      const y0 = s.y;
      s.y += s.vy;
      if (s.vy > 0 && (solidAt(lv, s.x + 2, s.y + 8) || solidAt(lv, s.x + 5, s.y + 8))) {
        const top = rowTop(rowOf(s.y + 8));
        if (top >= y0 + 8 - 1) {
          // a solid top: the first contact bounces, the second ends it
          if (++s.hits >= 2) {
            s.gone = true;
            continue;
          }
          s.y = top - 8;
          s.vy = SPIT_VY;
        }
      }
      const c = cell(lv, Math.floor((s.x + 4) / 16), rowOf(s.y + 6));
      if (c === LAVA_T || c === LAVA || s.y > 200 || s.x < W.cam - 16 || s.x > W.cam + 336) {
        s.gone = true;
        continue;
      }
      if (p.st === 'play' && p.star === 0 && p.inv === 0) {
        if (bodyR(p) > s.x + 1 && bodyL(p) + 1 < s.x + 7 && p.y > s.y + 1 && p.y - bodyH(p) + 3 < s.y + 7) {
          s.gone = true;
          K.hurt(W, false, 'fire');
        }
      }
    }
    if (list.some((s) => s.gone)) lv.spit = list.filter((s) => !s.gone);
  }

  // registered once, by name (a second load of this file replaces it rather than doubling every hook)
  register({
    name: 'foes',
    build(lv, def) {
      if (lv.boss) {
        lv.spit = [];
        lv.boss.xFar = lv.boss.x1; // the far end of its stretch (x1 shrinks while he lingers)
        lv.boss.linger = 0;
        lv.boss.nearX = def.bridge ? def.bridge[0] * 16 : lv.boss.x0; // the bridge's near end
      }
    },
    step(W, lv) {
      const b = lv.boss;
      if (!b) return;
      if (b.hitT > 0) b.hitT--;
      const p = W.p;
      if (fighting(b) && p.st === 'play') {
        // off the bridge (his middle short of its near end): it comes to meet him; on it: its whole stretch
        b.linger = p.x + 8 < b.nearX ? b.linger + 1 : 0;
        b.x1 = b.linger >= LINGER ? Math.max(b.x0 + HOLD_W, Math.min(b.x1, b.x)) : b.xFar;
      }
      // a roar that started this frame (stepBoss set 30 and counted it down once): one spit, aimed
      if (fighting(b) && b.roar === 29 && b.spat !== b.t) {
        b.spat = b.t;
        if (lv.spit.length < SPIT_MAX) {
          const face = b.face > 0 ? 1 : -1;
          const x = b.x + (face > 0 ? 24 : 0), y = b.y - 20;
          lv.spit.push({ x, y, vx: spitVx(W, lv, x, y, face), vy: SPIT_VY, t: 0, hits: 0, gone: false });
          K.emit(W, 'spit');
        }
      }
      if (lv.spit.length) stepSpit(W, lv);
      // beaten: the level's (boss) song stays silent, even when a star or the hurry jingle ends
      if (b.dead && W.bgm && (W.song === W.bgm || W.song === W.bgm + 'Fast')) K.setSong(W, 'none');
    },
    sprites(W, lv, out, vf) {
      if (!lv.spit) return;
      const k = 1 + ((vf >> 2) & 3);
      for (const s of lv.spit) out.push(CQ.ni('fireball' + k), Math.floor(s.x), Math.floor(s.y), 0, 0);
    },
    cloneLevel(src, dst) {
      if (src.spit) dst.spit = src.spit.map((s) => Object.assign({}, s));
    },
  });
})();
