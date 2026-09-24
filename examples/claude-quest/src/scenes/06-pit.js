/*
 * 06-pit.js — shot 06 'pit' (T 11.5–13.5, dur 2.0 s, 120 frames at 60 fps)
 *
 * The long jump over the pit. Super Claw'd (the same sprites at scale 2, 32×24 game px,
 * feet at y 103) runs in from shot 05, hits a 2-tile gap in the ground (world-x 752–784:
 * a caveBlack void with brickDeep inner lips), and clears it with one jump — the storyboard's
 * h-30, 1.0 s constant-gravity arc — landing on the far side and running on toward the staircase (shot 07).
 *
 * Layers, back to front:
 *   1. sky fill
 *   2. world scenery: cloud (world 760, y 16), bush (world-x 820, base y 103) — far side
 *   3. the pit: caveBlack void y 103–135 with a 1-px brickDeep inner lip on each edge
 *   4. ground strips: …→752 and 784→… (two strips; the gap is tiles 47–48)
 *   5. Super Claw'd: run cycle on the ground (FILM.nes.runPose), clawdJump while airborne
 *   6. HUD (G1: score 001300, coins ×01, TIME 400 − floor((T − 2.0)·10) = 305 at start)
 *
 * Continuity contracts honoured:
 *   hero world-x = 672 + 72·t   (G2: in from shot 05 at 672, out to shot 07 at 816)
 *   camX = heroWx − 64          (hero pinned at screen x 64; camera scrolls right only,
 *                               snapped to a whole game pixel every 60 Hz frame)
 *   takeoff local 0.75 (T 12.25), G4 arc h 30 / 1.0 s of air (u = elapsed/1.0 s, feet
 *   y = 103 − 4·30·u·(1−u)), horizontal speed 72 px/s throughout; lands local 1.75
 *   (T 13.25) at world-x 798 — 14 px past the pit's right edge — and resumes the run.
 *
 * Notes for reviewers:
 *   - groundStrip's end is ceil-inclusive, so the left strip is passed wxTo = 736:
 *     its last tile (46) spans world [736,752) and the ground stops exactly at 752.
 *   - Takeoff world-x is 726, so 26 of his 32 px are still on the lip when he leaves the
 *     ground — jumping from the very edge, as the fixed (world-x, beat) pair forces.
 *   - The run cycle keys off the global frame index (like shot 03) so the step continues
 *     seamlessly across the cuts with shots 05 and 07.
 */
(function () {
  'use strict';
  const ID = 'pit';
  const LIB = FILM.lib;
  const N = FILM.nes;
  const RUN_V = 72;

  // beat constants, shot-local seconds
  const B_JUMP = 0.75; // T 12.25 takeoff
  const B_LAND = 1.75; // T 13.25 landing past the pit
  const JUMP_AIR = 1.0; // s (60 frames)
  const JUMP_H = 30; // apex px (G4)

  // world constants (game px)
  const FEET = LIB.GROUND_Y; // 103, the ground's top face
  const PIT_L = 752; // gap left edge (world-x)
  const PIT_R = 784; // gap right edge — a 2-tile hole (tiles 47 and 48)
  const SCALE = 2; // Super Claw'd

  FILM.scene({
    id: ID,
    draw(ctx, tIn, info) {
      const L = info.lib, P = L.pal;
      const t = L.clamp(tIn, 0, info.dur);

      // hero + camera (he never stops moving right at 72 px/s)
      const heroWx = Math.round(672 + RUN_V * t); // left edge, whole game px; 672 → 816
      const camX = heroWx - 64; // 608 → 752; hero pinned at screen x 64
      const sx = (wx) => wx - camX;

      // ------------------------------------------------ 1. sky
      L.px(ctx, 0, 0, L.VW, L.VH, P.sky);

      // ------------------------------------------------ 2. scenery (world-locked)
      L.sprite(ctx, 'cloud', sx(760), 16);
      L.sprite(ctx, 'bush', sx(820), FEET - 7);

      // ------------------------------------------------ 3. the pit
      // The void: black from the ground's top face to the frame bottom (the two missing
      // ground-tile rows), with a 1-px brickDeep inner lip on each edge.
      const pitX = sx(PIT_L);
      const pitH = L.VH - FEET; // 32
      L.px(ctx, pitX, FEET, PIT_R - PIT_L, pitH, P.caveBlack);
      L.px(ctx, pitX, FEET, 1, pitH, P.brickDeep); // left inner lip
      L.px(ctx, sx(PIT_R) - 1, FEET, 1, pitH, P.brickDeep); // right inner lip

      // ------------------------------------------------ 4. ground (two strips, gap 752–784)
      L.groundStrip(ctx, camX - 16, PIT_L - 16, camX); // last tile [736,752)
      L.groundStrip(ctx, PIT_R, camX + L.VW + 16, camX); // first tile [784,800)

      // ------------------------------------------------ 5. Super Claw'd
      const airborne = t >= B_JUMP && t < B_LAND;
      let feetY = FEET, pose;
      if (airborne) {
        const u = (t - B_JUMP) / JUMP_AIR; // 0..1 over the 60-frame arc
        feetY = FEET - 4 * JUMP_H * u * (1 - u);
        pose = 'clawdJump';
      } else {
        pose = N.runPose(info.frame, RUN_V);
      }
      const hh = (pose === 'clawdJump' ? 10 : 12) * SCALE;
      L.sprite(ctx, pose, sx(heroWx), feetY - hh, { scale: SCALE });

      // ------------------------------------------------ 6. HUD
      L.hud(ctx, {
        score: 1300,
        coins: 1,
        world: '1-1',
        time: 400 - Math.floor((info.T - 2.0) * 10 + 1e-4),
      });
    },
  });
})();
