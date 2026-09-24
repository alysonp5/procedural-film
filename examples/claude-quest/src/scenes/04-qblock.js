// ============================================================================
// Shot 04 — qblock (T 6.5–9.0, dur 2.5 s, mode none, hard cut mid-run)
//
// Claw'd runs on (world-x 312 → 492, screen anchor 64), jumps at T 7.25 and
// head-bumps the floating ? block at T 7.5: the block hops 4 px and turns
// used, a coin spins out of its top, HUD coins ×00→×01, score 000100→000300
// with a floating "+200". He lands at T 8.25 and runs on.
//
// Layers, back to front:
//   1. sky fill
//   2. cloud (world 450, 16)
//   3. bush (world-x 500, on the ground line)
//   4. ground strip
//   5. Claw'd (run cycle / tucked jump; drawn BEHIND the block row so the
//      bump occludes his head)
//   6. block row y 67–83: brick (368) / Q→used (384, hops) / brick (400)
//   7. coin pop (spins through the 4 coin drawings every 3 frames, rises 12 px over 0.5 s, vanishes)
//   8. "+200" pxtext (rises 8 px over 0.5 s, then vanishes)
//   9. HUD (G1: score 000100→000300, ×00→×01, TIME 355 ticking −10/s)
//
// NES motion (60 fps): camX snaps to a whole game pixel every frame; the ? block shimmers on
// its own palette cadence (lib.qFrame: 24 frames lit, then 8/8/8 through the glint); the coin
// spins on lib.coinSpin at 20 drawings/s (3 frames each); nothing is blended.
// ============================================================================
(function () {
  'use strict';
  const ID = 'qblock';

  const N = FILM.nes;

  // Beat grid, shot-local seconds (global T in comments).
  const TAKEOFF = 0.75; // T 7.25 — jump takeoff, on the beat
  const BUMP = 1.0;     // T 7.5  — head-bump: block hop, coin, ×01, +200
  const LAND = 1.75;    // T 8.25 — lands, run resumes
  const JUMP_H = 30;    // apex px (storyboard G4)
  const AIR = 1.0;      // 60 frames airborne

  const SPEED = 72;     // run speed, game px/s (1.2 px a frame at 60 fps)
  const START_WX = 312; // hero world-x at t 0 (storyboard G2)
  const ANCHOR = 64;    // hero screen-x anchor in run shots

  const BLOCK_Y = 67;                    // block row tops (row spans y 67–83)
  const BRICK_A_WX = 368, Q_WX = 384, BRICK_B_WX = 400;

  const HOP_T = 0.25;   // block hop: 4 px up and back over 15 frames
  const POP_T = 0.5;    // coin pop / +200: 30 frames
  const COIN_FPS = 20;  // popped coin: a new spin drawing every 3 frames

  FILM.scene({
    id: ID,
    draw(ctx, tIn, info) {
      const L = info.lib, P = L.pal;
      const t = L.clamp(tIn, 0, info.dur);

      // Continuity: mid-run, camera locked to the hero's screen anchor.
      const heroWx = Math.round(START_WX + SPEED * t); // whole game px
      const camX = heroWx - ANCHOR;

      // Jump parabola (art bible 7.2): u runs 0..1 takeoff→land; outside the
      // jump the clamp pins u to 0/1, which puts the feet back on the ground.
      const u = L.clamp((t - TAKEOFF) / AIR);
      const feetY = 103 - 4 * JUMP_H * u * (1 - u);
      const airborne = t > TAKEOFF && t < LAND;

      const bumped = t >= BUMP - 1e-6; // tileUsed from the bump frame on

      // 1. sky ----------------------------------------------------------------
      L.px(ctx, 0, 0, L.VW, L.VH, P.sky);

      // 2. cloud (world-anchored, drifts left with the scroll) -----------------
      L.sprite(ctx, 'cloud', 450 - camX, 16);

      // 3. bush on the ground line --------------------------------------------
      L.sprite(ctx, 'bush', 500 - camX, 103 - 7);

      // 4. ground strip across the visible range -------------------------------
      L.groundStrip(ctx, camX - 16, camX + L.VW + 16, camX);

      // 5. Claw'd — run cycle on the ground (FILM.nes.runPose), clawdJump airborne
      if (airborne) {
        L.sprite(ctx, 'clawdJump', ANCHOR, feetY - 10); // jump sprite is 16×10
      } else {
        L.sprite(ctx, N.runPose(info.frame, SPEED), ANCHOR, 103 - 12);
      }

      // 6. Block row, drawn OVER the hero so the rise reads as a head-bump. ----
      //    The Q block hops 4 px up and back over 15 frames from the bump.
      let qHop = 0;
      if (bumped && t < BUMP + HOP_T) qHop = -4 * Math.sin((Math.PI * (t - BUMP)) / HOP_T);
      L.sprite(ctx, 'tileBrick', BRICK_A_WX - camX, BLOCK_Y);
      if (bumped) {
        L.sprite(ctx, 'tileUsed', Q_WX - camX, BLOCK_Y + qHop);
      } else {
        // tileQ's '?' counters are transparent pixels; back them with sky so
        // the hero rising behind the block doesn't peek through the glyph.
        L.px(ctx, Q_WX - camX, BLOCK_Y, 16, 16, P.sky);
        L.sprite(ctx, 'tileQ', Q_WX - camX, BLOCK_Y, { frame: L.qFrame(info.T) });
      }
      L.sprite(ctx, 'tileBrick', BRICK_B_WX - camX, BLOCK_Y);

      // 7. Coin pop — out of the block top (y 67−14=53), rises 12 px and falls
      //    back over 30 frames, spinning a drawing every 3 frames.
      const cu = (t - BUMP) / POP_T;
      if (cu >= 0 && cu < 1) {
        const coin = L.coinSpin(t - BUMP, COIN_FPS);
        L.sprite(ctx, coin, Q_WX + 4 - camX, 53 - 4 * 12 * cu * (1 - cu));
      }

      // 8. "+200" — pops above the block (clear of the coin's 12 px arc),
      //    rises 8 px over 30 frames and vanishes (score pops never fade on the console).
      const su = (t - BUMP) / POP_T;
      if (su >= 0 && su < 1) {
        L.pxtext(ctx, '+200', Q_WX + 8 - camX, 40 - Math.floor(8 * su), {
          align: 'center',
          color: P.hudWhite,
        });
      }

      // 9. HUD — storyboard G1: 000100 ×00 at start; +200 and ×01 on the bump.
      L.hud(ctx, {
        score: bumped ? 300 : 100,
        coins: bumped ? 1 : 0,
        time: 400 - Math.floor((info.T - 2.0) * 10),
      });
    },
  });
})();
