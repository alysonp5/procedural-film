// game/20-tape.js : the recorded controller tape, authored as a player's intentions. Owner: game.
//
// The tape is not typed frame by frame. It is a short program of moves ("run to x = 330",
// "jump holding A for 14 frames", "wait on the pipe until the bugs come") that a bot plays against
// the live engine, reading the same state a player sees. Each move holds some buttons until its
// condition is met; the buttons of every frame are recorded (FILM.game.tape()). The engine and the
// program are both deterministic, so the tape is a pure function of this file and game/10-engine.js.
// The film replays the recording of this program (game/21-recorded.js); after changing the program
// or the engine, regenerate it from FILM.game.record() (the replay falls back to this program if not).
(function () {
  'use strict';
  const FILM = (window.FILM = window.FILM || {});
  const CQ = (FILM.__cq = FILM.__cq || {});
  const { A, B, START, DOWN, LEFT, RIGHT } = CQ.BUTTONS;

  // A move: { until(W, t) -> done?, btn(W, t) -> buttons } with t = frames since the move began.
  function makeBot(program) {
    let pc = 0;
    let t = 0;
    return function bot(W) {
      while (pc < program.length) {
        const m = program[pc];
        if (m.until(W, t)) {
          pc++;
          t = 0;
          continue;
        }
        const b = m.btn(W, t);
        t++;
        return b;
      }
      return 0;
    };
  }
  CQ.makeBot = makeBot;

  const mv = (until, btn) => ({ until, btn: typeof btn === 'function' ? btn : () => btn });

  // The planner's eye: copy the world and play a button sequence forward on the copy, collecting
  // events. The real world is untouched (the copy shares nothing with it).
  // goal(copy, events, k) returns true (reached), false (this try failed) or null (keep playing).
  // Style rules every plan obeys: Claw'd's drawing stays below the HUD band (its top at y >= 32), and
  // an airborne Claw'd never scrapes a wall (a jump that loses its speed against a pipe side looks clumsy).
  const HEAD_MIN = 32;
  function lookahead(W, seq, horizon, goal, o) {
    const c = CQ.cloneWorld(W);
    for (let k = 0; k < horizon; k++) {
      const b = k < seq.length ? seq[k] : seq[seq.length - 1];
      const vx0 = c.p.vx;
      const air0 = !c.p.ground;
      const ev = CQ.step(c, b);
      const p = c.p;
      if (p.st === 'play' && !(o && o.free)) {
        if (CQ.drawTop(p) < HEAD_MIN) return false;
        if ((air0 || !p.ground) && vx0 !== 0 && p.vx === 0) return false;
      }
      const r = goal(c, ev, k);
      if (r === true) return true;
      if (r === false) return false;
    }
    return false;
  }
  CQ.lookahead = lookahead;
  const R = RIGHT, RB = RIGHT | B, L = LEFT, LB = LEFT | B;
  const M = {
    /** hold b for n frames */
    hold: (b, n) => mv((W, t) => t >= n, b),
    /** nothing until global frame f */
    at: (f) => mv((W) => W.f >= f, 0),
    /** nothing until the console is in mode m */
    mode: (m) => mv((W) => W.mode === m, 0),
    /** hold b until the player's x reaches x (moving right) */
    to: (x, b = RB) => mv((W) => W.p.x >= x, b),
    /** hold b until the player's x falls to x (moving left) */
    back: (x, b = L) => mv((W) => W.p.x <= x, b),
    /** hold b until pred(W) */
    until: (pred, b = 0) => mv((W, t) => pred(W, t), b),
    /** a fresh A press held n frames together with b (releases A for a frame first if it was down) */
    jump(b, n) {
      let start = -1;
      return mv(
        (W, t) => start >= 0 && t - start >= n,
        (W, t) => {
          if (start < 0) {
            if (W.prev & A) return b;
            start = t;
          }
          return b | A;
        }
      );
    },
    /** hold b until the player stands on something */
    land: (b = RB) => mv((W, t) => t > 0 && W.p.ground, b),
    /** hold b until the nearest live enemy ahead is within dx px of the player's front */
    near: (dx, b = RB) => mv((W) => gapAhead(W) <= dx, b),
    /** walk (or run, with B) to stand still at x: brake early enough to stop there, like a player lining up a jump */
    goto: (x, run = false) =>
      mv(
        (W, t) => (Math.abs(W.p.x - x) < 2 && W.p.vx === 0 && W.p.ground) || t > 240,
        (W) => {
          const p = W.p;
          const PH = CQ.PH;
          const dx = x - p.x;
          const v = p.vx;
          const dir = Math.sign(dx);
          if (Math.abs(dx) < 2) return 0;
          if (v * dir > 0) {
            const coast = (v * v) / (2 * PH.relDec);
            const skid = (v * v) / (2 * PH.skidDec);
            if (coast >= Math.abs(dx) - 1) {
              // friction alone would overshoot: skid when a skid stops just in time, coast until then
              if (skid >= Math.abs(dx) - 3 && Math.abs(v) > PH.skidTurn) return dir > 0 ? LEFT : RIGHT;
              return 0;
            }
          }
          return (dir > 0 ? RIGHT : LEFT) | (run ? B : 0);
        }
      ),
    /**
     * the planner's jump: hold b, and on the first frame where "press A now, hold it n frames, then
     * keep b" reaches goal(world, events) within the horizon, press A for real
     */
    // o.after: buttons once A is released (default b); o.mids: frames of b between releasing A and
    // switching to o.after (tried in order; default [0]); o.wait: buttons while no plan works yet
    planJump(b, ns, goal, o = {}) {
      ns = Array.isArray(ns) ? ns : [ns];
      const horizon = o.horizon || 90;
      const bAfter = o.after != null ? o.after : b;
      const bWait = o.wait != null ? o.wait : b;
      const mids = o.mids || [0];
      let start = -1;
      let plan = null;
      // the plan's buttons run to the end, then its last buttons are held until Claw'd lands (or
      // leaves play: the flagpole, the axe), exactly as the lookahead played them
      return mv(
        (W, t) => start >= 0 && t - start >= plan.length - 1 && (W.p.ground || W.p.st !== 'play'),
        (W, t) => {
          if (start >= 0) return plan[Math.min(t - start, plan.length - 1)];
          if (W.prev & A) return bWait;
          for (const tryN of ns) {
            for (const mid of mids) {
              const seq = [];
              for (let k = 0; k < tryN; k++) seq.push(b | A);
              for (let k = 0; k < mid; k++) seq.push(b);
              seq.push(bAfter);
              if (lookahead(W, seq, horizon, goal, o)) {
                // o.late: a showman's timing, jump only when waiting one more frame would fail
                if (o.late && lookahead(W, [bWait].concat(seq), horizon + 1, goal, o)) return bWait;
                start = t;
                plan = seq;
                return seq[0];
              }
            }
          }
          return bWait;
        }
      );
    },
    /**
     * a run-up and a jump: while waiting (o.wait), try "hold b until x >= xJump, then b|A for n frames,
     * then b" for each n; commit to the first that reaches goal, and play it through to the landing
     */
    planRunJump(b, xJump, ns, goal, o = {}) {
      const horizon = o.horizon || 120;
      const bWait = o.wait != null ? o.wait : 0;
      let start = -1;
      let plan = null;
      const runUp = (W) => {
        const c = CQ.cloneWorld(W);
        const pre = [];
        while (c.p.x < xJump && pre.length < 120) {
          pre.push(b);
          CQ.step(c, b);
          if (c.p.st !== 'play') return null;
        }
        return pre.length < 120 ? pre : null;
      };
      return mv(
        (W, t) => start >= 0 && t - start >= plan.length - 1 && (W.p.ground || W.p.st !== 'play'),
        (W, t) => {
          if (start >= 0) return plan[Math.min(t - start, plan.length - 1)];
          const pre = runUp(W);
          if (pre) {
            for (const n of ns) {
              const seq = pre.slice();
              for (let k = 0; k < n; k++) seq.push(b | A);
              seq.push(b);
              // the goal counts frames from the jump (negative during the run-up)
              const g = (c, ev, k) => goal(c, ev, k - pre.length);
              if (lookahead(W, seq, horizon + pre.length, g, o)) {
                start = t;
                plan = seq;
                return seq[0];
              }
            }
          }
          return bWait;
        }
      );
    },
    /** wait (holding bWait) until holding b from now reaches goal within the horizon, then hold b until it does */
    planGo(b, goal, o = {}) {
      const horizon = o.horizon || 120;
      const bWait = o.wait != null ? o.wait : 0;
      let go = false;
      return mv(
        (W, t) => go && goal(W, [], 99) === true,
        (W) => {
          if (!go && lookahead(W, [b], horizon, goal, o)) go = true;
          return go ? b : bWait;
        }
      );
    },
    /** skip move m when pred(W) already holds as it begins (the goal was reached some other way) */
    skipIf(pred, m) {
      let skip = null;
      return mv(
        (W, t) => {
          if (t === 0 && skip === null) skip = !!pred(W);
          return skip || m.until(W, t);
        },
        (W, t) => m.btn(W, t)
      );
    },
    /** skid or coast to a standstill */
    brake: () => mv((W, t) => W.p.vx === 0 && W.p.ground, (W) => (W.p.vx > 0 ? LEFT : W.p.vx < 0 ? RIGHT : 0)),
    /** hold b until the player's state is st */
    state: (st, b = 0) => mv((W) => W.p.st === st, b),
  };
  CQ.moves = M;

  function gapAhead(W) {
    let best = Infinity;
    for (const e of W.lv.ents) {
      if (e.st !== 'walk' && e.st !== 'shell') continue;
      const g = e.x - (W.p.x + 16);
      if (g > -8 && g < best) best = g;
    }
    return best;
  }
  CQ.gapAhead = gapAhead;

  // goals for the planner: an event (optionally tested) before the player is back on the ground
  const onEvent = (type, test) => (c, ev, k) => {
    for (const e of ev) if (e.type === type && (!test || test(e, c))) return true;
    if (c.p.st !== 'play') return false;
    return k > 2 && c.p.ground ? false : null;
  };
  const stomps = (n) => onEvent('stomp', (e) => e.combo >= n);
  // lands on its feet where test(copy) holds
  const lands = (test) => (c, ev, k) => (c.p.st !== 'play' ? false : k > 2 && c.p.ground ? !!test(c) : null);
  const songIs = (id) => onEvent('song', (e) => e.id === id);
  // g1, then g2 (state lives on the copy, so every lookahead starts fresh)
  const then = (g1, g2) => (c, ev, k) => {
    if (!c.__then) {
      const r = g1(c, ev, k);
      if (r === true) {
        c.__then = true;
        return null;
      }
      return r;
    }
    return g2(c, ev, k);
  };
  const landsPast = (x) => lands((c) => c.p.x > x);
  // lands where test(copy) holds having collected at least n coins on the way
  const collects = (n, test) => (c, ev, k) => {
    for (const e of ev) if (e.type === 'coin') c.__coins = (c.__coins || 0) + 1;
    if (c.p.st !== 'play') return false;
    return k > 2 && c.p.ground ? (c.__coins || 0) >= n && (!test || !!test(c)) : null;
  };
  const item = (W, k) => W.items.find((it) => it.k === k);
  // unhurt and still big (a plan that costs a hit is no plan)
  const whole = (c) => c.p.inv === 0 && c.p.big;
  // g, and on the way a fireball of firebar i came within maxD px of Claw'd's body without touching it
  // (the gap is measured with the engine's own hit test: a gap of 0 or less would be a hit)
  const closeCall = (i, maxD, g) => (c, ev, k) => {
    const p = c.p;
    const fb = c.lv.firebars[i];
    if (p.st === 'play' && fb) {
      const L = p.x + 8 - (p.big ? 10 : 5), R = p.x + 7 + (p.big ? 10 : 5), T = p.y - (p.big ? 22 : 16) + 3;
      for (const [bx, by] of CQ.firebarBalls(fb, c.lv.t)) {
        const d = Math.max(bx + 1 - R, L + 1 - (bx + 7), by + 1 - p.y, T - (by + 7));
        if (c.__near === undefined || d < c.__near) c.__near = d;
      }
    }
    const r = g(c, ev, k);
    return r === true ? c.__near !== undefined && c.__near > 0 && c.__near <= maxD : r;
  };

  // the planner's goals, for the game's level proofs (tools/proof/programs, docs/game-spec.md 2.5)
  CQ.goals = { onEvent, stomps, lands, landsPast, collects, then, closeCall, songIs };

  // The film's play. x values are the player's left edge in world px (tile * 16).
  // The star pickup lands where the overworld's hook cadences: STAR_AT frames after the song's first frame.
  const STAR_AT = 720;
  CQ.program = function program() {
    let intro = -1; // the frame the overworld song started (read off the world as play begins)
    return [
      // title: the cartridge boots into the attract screen; START on the menu
      M.at(200),
      M.hold(START, 3),
      M.mode('play'),
      mv((W) => ((intro = W.f - 1), true), 0),
      // World 1-1: the first bug, stomped on the open first screen
      M.planJump(RB, [2, 3, 4, 6, 8], stomps(1)),
      M.land(RB),
      // the coin arc over the pit, all five in one leap
      M.planJump(RB, [4, 6, 8, 10, 12, 14, 16, 18, 20], collects(5, (c) => c.p.x > 470), { horizon: 90 }),
      M.land(RB),
      // the floppy gateway: over the low pipe, under the floppy block (col 45)
      M.planJump(RB, [6, 8, 10, 12, 14, 16], lands((c) => c.p.x > 660 && c.p.x < 700)),
      M.land(R),
      M.goto(716),
      M.planJump(0, [6, 8, 10, 12], onEvent('sprout')),
      M.land(0),
      // it rises onto the lintel and slides off its end: be there, under the open sky, when it drops
      M.until((W) => W.freeze > 0, (W) => (W.p.x < 786 ? R : W.p.vx > 0 ? LEFT : 0)),
      M.until((W) => W.freeze === 0, 0),
      // big: up onto the gateway's far pipe and off the other side
      M.planJump(RB, [6, 8, 10, 12, 14, 16, 20, 24], lands((c) => c.p.y === 116 || c.p.x > 852), { horizon: 90 }),
      M.land(RB),
      // the brick canopy: bricks smashed on the run, each tossing up the coin on it
      M.planJump(RB, [2, 3, 4, 6], onEvent('brick'), { horizon: 30 }),
      M.land(RB),
      M.planJump(RB, [2, 3, 4, 6], onEvent('brick'), { horizon: 30 }),
      M.land(RB),
      M.planJump(RB, [2, 3, 4, 6], onEvent('brick'), { horizon: 30 }),
      M.land(RB),
      // past the canopy's end, a leap at nothing: the hidden block (col 76) and the Claude spark; he
      // brakes in the air, turns, and catches the spark at the top of a full leap as it arcs over him
      M.planJump(RB, [2, 3, 4, 6, 8], onEvent('sprout'), { horizon: 30, after: L }),
      M.land(RB),
      M.brake(),
      M.until((W) => item(W, 'spark') && item(W, 'spark').st === 'move', L),
      M.planJump(R, [16, 17, 18, 19, 20, 21, 22, 23, 24, 26, 28, 30], then(onEvent('song', (e) => e.id === 'star' && e.f === intro + STAR_AT), lands(() => true)), { horizon: 120, wait: R }),
      M.land(RB),
      // the star run: through the bug packs, smashing the brick shelf overhead, over the pit
      M.to(1500, RB),
      M.planJump(RB, [2, 3, 4], onEvent('brick'), { horizon: 30 }),
      M.land(RB),
      M.planJump(RB, [2, 3, 4], onEvent('brick'), { horizon: 30 }),
      M.land(RB),
      M.planJump(RB, [4, 6, 8, 10, 12, 14, 16], landsPast(1766), { horizon: 60 }),
      M.land(RB),
      // the quiet stretch: a ? block on the run, the last bug stomped on the way down and the bounce
      // into the second ? block; onto the pipe, and down it
      M.planJump(RB, [2, 3, 4, 6], then(onEvent('coin'), stomps(1)), { horizon: 40 }),
      M.land(RB),
      M.planJump(R, [4, 6, 8, 10, 12, 14, 16], lands((c) => c.p.y === 116 && c.p.x > 2140 && c.p.x < 2164), { horizon: 80 }),
      M.land(0),
      M.until((W) => W.p.st !== 'play', DOWN),
      // the coin room: down out of the ceiling, over the hump through the arc of coins, out by the side pipe
      M.until((W) => W.li === 1 && W.p.y > 84, 0),
      M.land(RB),
      M.planJump(RB, [16, 18, 20, 22, 23, 24, 25, 26], collects(8, (c) => c.p.y === 148 && c.p.x > 192), { horizon: 90 }),
      M.land(RB),
      M.until((W) => W.p.st !== 'play', R),
      M.until((W) => W.li === 0 && W.p.st === 'play', 0),
      // the shell-bug: stomped off the pipe, and the shell booted into the three bugs behind it
      M.planJump(RB, [2, 4, 6, 8, 10, 12], then(stomps(1), onEvent('kick')), { horizon: 120, after: R }),
      M.until((W) => W.p.ground, R),
      // up the two floating platforms, and a hop to the very top of the flagpole
      M.planJump(RB, [4, 6, 8, 10, 12, 14, 16], lands((c) => c.p.y === 116 && c.p.x > 2730), { horizon: 80 }),
      M.land(RB),
      M.planJump(RB, [4, 6, 8, 10, 12, 14, 16], lands((c) => c.p.y === 84 && c.p.x > 2800), { horizon: 80 }),
      M.land(RB),
      M.planJump(RB, [1, 2, 3, 4, 5, 6, 8], onEvent('flagpole', (e) => e.height === 5000), { horizon: 60 }),
      // WORLD 1-4
      M.mode('lives'),
      M.mode('play'),
      M.to(90, RB),
      M.land(RB),
      // the first lava pit
      M.planJump(RB, [6, 8, 10, 12, 14], (c, ev, k) => (whole(c) ? landsPast(340)(c, ev, k) : false)),
      M.land(RB),
      // the first firebar: run under it through a gap
      M.planGo(RB, (c) => (c.p.st !== 'play' || !whole(c) ? false : c.p.x > 500 ? true : null), { horizon: 90, wait: 0 }),
      // the second pit, a quick hop from its lip on the run, landing short of the second firebar's reach
      M.planJump(RB, [1, 2, 3, 4], (c, ev, k) => (whole(c) ? lands((q) => q.p.x > 596 && q.p.x < 636)(c, ev, k) : false), { horizon: 60, wait: RB }),
      M.land(0),
      M.brake(),
      // the second firebar, turning the other way and faster: up onto the step past it, with a fireball
      // brushing by close enough to feel
      M.planRunJump(RB, 724, [4, 6, 8, 10, 12, 14, 16], closeCall(1, 5, (c, ev, k) => (whole(c) ? lands((q) => q.p.y === 116 && q.p.x > 770)(c, ev, k) : false)), { horizon: 120, wait: 0 }),
      M.land(RB),
      // the Big Bug: over it in one bound, along the bridge, and press the ENTER key
      M.planJump(RB, [6, 8, 10, 12, 14, 16, 18, 20, 24], (c, ev, k) => {
        if (c.p.st === 'axe') return true;
        if (c.p.st !== 'play' || !whole(c)) return false;
        return null;
      }, { horizon: 150, wait: R }),
      M.state('axe', RB),
      M.until(() => false, 0),
    ];
  };
})();
