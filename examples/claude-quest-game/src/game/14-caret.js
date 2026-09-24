// game/14-caret.js : Claw'd Code's carets, the bouncing `>` he throws with B. Owner: P2.
// docs/game-spec.md 6.7 (X7); boss hits go through src/game/12-foes.js (X2).
//
// One system behind the engine seam (docs/game-spec.md 2.4), called only for live worlds. The carets
// live on W.carets (reset on every area entry) as plain records; cloneWorld deep-copies them.
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
  const { Q, BUTTONS, rowTop, rowOf, solidAt, emit } = K;
  const FLAG = CQ.FLAG;

  const MAX_CARETS = 2;
  const THROW_POSE = (CQ.TIMING && CQ.TIMING.THROW_POSE) || 8;
  const VX = Q(0x3800); // 3.5 px a frame
  const VY0 = 1, GRAV = Q(0x400), VY_MAX = 4;
  const BOUNCE = -Q(0x2c00); // -2.75: a 13.75 px hop
  const LIFE = 150;
  const POOF_STEP = 4, POOF_FRAMES = 3 * POOF_STEP; // poof1..3, 4 frames each
  const SPIN_STEP = 3; // caret1..4, a quarter turn every 3 frames
  const ZAP_SCORE = 200;

  // the top of an enemy's hitbox (the engine's rule): a live kind's own, the bug 14, the shell-bug 10, its shell 9
  function enemyTop(e) {
    const kind = CQ.KINDS[e.kind];
    return e.y - (kind ? kind.top : e.kind === 'shellbug' ? 10 : e.kind === 'shell' ? 9 : 14);
  }
  const hits = (c, l, r, t, b) => c.x + 3 > l && c.x - 3 < r && c.y + 3 > t && c.y - 3 < b;

  function fly(c) {
    return c.st === 'fly';
  }
  function poof(W, c, loud) {
    c.st = 'poof';
    c.t = 0;
    if (loud) emit(W, 'poof');
  }

  function throwCaret(W, p) {
    const face = p.face < 0 ? -1 : 1;
    W.carets.push({ st: 'fly', x: p.x + 8 + face * 10, y: p.y - 16, vx: VX * face, vy: VY0, t: 0 });
    p.throwT = THROW_POSE;
    emit(W, 'throw');
  }

  // a caret knocks an enemy out: the dead fall, a bug counted (a shell was counted when stomped), 200
  function zap(W, e, dir) {
    if (e.kind !== 'shell') W.stats.bugs++;
    e.st = 'dead';
    e.vy = -3;
    e.vx = 0.75 * dir;
    e.t = 0;
    K.addScore(W, ZAP_SCORE);
    K.pop(W, K.popOf(String(ZAP_SCORE)), e.x + 8, e.y - 24);
    emit(W, 'zap', { kind: e.kind });
  }

  function stepCaret(W, lv, c) {
    c.t++;
    if (c.st === 'poof') {
      if (c.t >= POOF_FRAMES) c.gone = true;
      return;
    }
    if (c.t > LIFE) {
      c.gone = true;
      return;
    }
    const dir = c.vx < 0 ? -1 : 1;
    c.x += c.vx;
    // a wall ahead of the centre
    if (solidAt(lv, c.x + dir * 3, c.y)) {
      c.x = dir > 0 ? Math.floor((c.x + 3) / 16) * 16 - 4 : Math.floor((c.x - 3) / 16) * 16 + 20;
      poof(W, c, true);
      return;
    }
    c.vy = Math.min(VY_MAX, c.vy + GRAV);
    const y0 = c.y;
    c.y += c.vy;
    if (c.vy > 0 && solidAt(lv, c.x, c.y + 4)) {
      const top = rowTop(rowOf(c.y + 4));
      if (top >= y0 + 4 - 1) {
        c.y = top - 4;
        c.vy = BOUNCE;
      }
    } else if (c.vy < 0 && solidAt(lv, c.x, c.y - 4)) {
      poof(W, c, true);
      return;
    }
    if (c.x < W.cam - 16 || c.x > W.cam + 336 || c.y > 200) {
      c.gone = true;
      return;
    }
    // an enemy: any live kind walking or in its shell
    for (const e of lv.ents) {
      if (e.st !== 'walk' && e.st !== 'shell') continue;
      if (!hits(c, e.x + 2, e.x + 14, enemyTop(e), e.y)) continue;
      zap(W, e, dir);
      c.gone = true;
      return;
    }
    // the boss: a hit, or a poof off it while it still flickers from the last one
    const b = lv.boss;
    if (b && CQ.foes && CQ.foes.fighting(b)) {
      const box = CQ.foes.bossBox(b);
      if (hits(c, box.l, box.r, box.t, box.b)) {
        if (CQ.foes.hitBoss(W, lv)) c.gone = true;
        else poof(W, c, true);
      }
    }
  }

  // registered once, by name (a second load of this file replaces it rather than doubling every hook)
  register({
    name: 'caret',
    enter(W, lv) {
      W.carets = [];
      // the pose is counted down only in play: a pipe or a door taken mid-throw must not carry it over
      if (W.p) W.p.throwT = 0;
    },
    input(W, lv, p, btn, pressed) {
      if (p.throwT > 0) p.throwT--;
      if (!(pressed & BUTTONS.B) || !p.code || !p.big || p.st !== 'play') return;
      if (!W.carets) W.carets = [];
      if (W.carets.filter(fly).length >= MAX_CARETS) return;
      throwCaret(W, p);
    },
    step(W, lv) {
      const list = W.carets;
      if (!list || !list.length) return;
      for (const c of list) if (!c.gone) stepCaret(W, lv, c);
      if (list.some((c) => c.gone)) W.carets = list.filter((c) => !c.gone);
    },
    sprites(W, lv, out) {
      const list = W.carets;
      if (!list) return;
      for (const c of list) {
        const x = Math.floor(c.x) - 4, y = Math.floor(c.y) - 4;
        if (c.st === 'poof') out.push(CQ.ni('poof' + (1 + Math.min(2, Math.floor(c.t / POOF_STEP)))), x, y, 0, 0);
        else out.push(CQ.ni('caret' + (1 + (Math.floor(c.t / SPIN_STEP) & 3))), x, y, c.vx < 0 ? FLAG.FLIP : 0, 0);
      }
    },
    cloneWorld(src, dst) {
      if (src.carets) dst.carets = src.carets.map((c) => Object.assign({}, c));
    },
  });
})();
