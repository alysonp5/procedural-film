/*
 * 13-slide.js — shot 13 'slide' (T 28.0–30.0, dur 2.0 s, 120 frames at 60 fps)
 *
 * The flag slide. Claw'd (Super, scale 2) hangs on the flagpole, slides down as the flag
 * comes down with him, the '+5000' score pop fires and the HUD jumps 002500 → 007500;
 * he hops off to the right and runs toward the castle while two firework bursts celebrate
 * in the sky. Camera FIXED at camX 1704 (storyboard G3): pole at screen 144, castle door
 * at screen ~226.
 *
 * Layers, back to front:
 *   1. sky fill
 *   2. cloud (world 1880, 18 → screen 176; nudged right from the brief's world 1800 —
 *      see deviations)
 *   3. castle (world 1912 → screen 208, base y 103)
 *   4. flagpole: 2-px pipeGreen pole y 40–103 at world 1848 (screen 144), sparkle ball
 *      on top, triangular flag sliding y 44 → 88
 *   5. ground strip across the visible range
 *   6. Claw'd — clawdPole slide → clawdIdle stand → clawdJump hop → run1/run2 (scale 2;
 *      drawn after the pole so he hugs it / passes in front of it)
 *   7. FX: '+5000' pxtext pop (T 28.75), firework bursts (T 29.0 orange / T 29.5 cream)
 *   8. HUD — G1 row 13: score 002500 → 007500 at T 28.75, ×06, TIME 140 → 120
 *
 * Beat grid (shot-local):
 *   0.00–0.75  slide down the pole, hero top y 48 → 81 (feet 70 → 103), flag 44 → 88,
 *              both steady linear slides
 *   0.75       '+5000' pops at the pole top (rises 8 px over 0.5 s, then vanishes);
 *              HUD score jumps to 007500; he stands at the pole base
 *   1.00       hops off right (clawdJump, h 12, 0.5 s of air, drifts +8 px); firework 1
 *   1.50       lands, runs right at 72 px/s (run cycle on the global frame); firework 2
 *   2.00       holds the final pose: mid-run at world-x 1860 (screen 156)
 *
 * Deviations forced by the fixed geometry (beats and look unchanged):
 *   - The slide ends at hero-top y 81, not the brief's 79: clawdPole is 11 rows (22 game
 *     px at scale 2), so top 81 is what puts his feet exactly on the ground top (103),
 *     which is the brief's hard constraint ('feet reach 103').
 *   - He hangs LEFT of the pole (left edge world 1816, SMB's Mario-left / flag-right
 *     layout): with his body right of the pole, the right-flying flag (screen 146–154)
 *     would slide through his torso for most of the descent. This also keeps the flag
 *     visible for the whole slide and reads exactly like SMB's flagpole dismount.
 *   - He ends at world-x ≈ 1860, not the brief's '≈ 1790': the pole is at world 1848 and
 *     he hops RIGHT toward the castle, covering ~44 px (8 px hop drift + 36 px run). 1790
 *     is LEFT of the pole he just slid down — geometrically impossible for this shot;
 *     treated as a typo. NOTE for the shot-14 agent: storyboard shot 14's 'world-x 1790 →
 *     1938' carries the same slip — shot 13 hands off at 1860, mid-run pose.
 *   - The cloud sits at world 1880 (screen 176), not (1800, 18): firework 2 bursts
 *     beside it, and the cream sparkle sprite on the white cloud would be invisible
 *     there. The firework beats are fixed; the cloud is scenery, so the cloud moved.
 *   - The fireworks burst at screen (60, 40) and (100, 38), not ~(100, 22): radius 18 from
 *     y 22 puts the top sparkles inside the HUD rows (1–15) and over the score and ×06 counter.
 *     These centres keep every spark at y ≥ 16, clear of the HUD; the '~' position stood.
 *
 * Determinism: everything derives from t (clamped to [0, dur]) and info.T; the shot has
 * no random choices, so no seeds.
 *
 * NES motion (60 fps): the slide and the run move in whole game pixels each frame; bursts and
 * the pop never blend (sparkles flicker out, the pop vanishes).
 */
(function () {
  'use strict';

  const ID = 'slide';
  const N = FILM.nes;

  // beats (shot-local seconds)
  const B_POP = 0.75; // T 28.75 — slide ends, '+5000' pops, HUD score jumps
  const B_HOP = 1.0;  // T 29.0  — hops off right; firework 1
  const B_LAND = 1.5; // T 29.5  — lands and runs; firework 2
  const HOP_A = 0.5;  // 30 frames of air
  const HOP_H = 12;   // hop apex height (game px)
  const HOP_DX = 8;   // rightward drift during the hop
  const RUN_V = 72;   // run speed, px/s

  // world layout (storyboard G3 + shot 13 composition); camera fixed
  const CAM = 1704;
  const GY = 103;             // ground top face (lib.GROUND_Y)
  const POLE_X = 1848;        // flagpole, 2 px wide, y 40–103
  const POLE_TOP = 40;
  const CASTLE_X = 1912;      // 32×30 castle, base y 103
  const CLOUD_X = 1880;       // nudged right (see header)
  const CLOUD_Y = 18;
  const HERO_X = 1816;        // hero left edge on the pole: body left, flush to the pole
  const RUN_X0 = HERO_X + HOP_DX; // where the hop lands and the run starts

  // slide endpoints: hero top y 48 → 81 (feet 70 → 103); flag top y 44 → 88
  const SLIDE_Y0 = 48, SLIDE_Y1 = 81;
  const FLAG_Y0 = 44, FLAG_Y1 = 88;

  // sprite heights at scale 2 (clawdPole 11 rows, clawdJump 10, idle/run 12)
  const H_POLE = 22, H_JUMP = 20, H_RUN = 24;

  FILM.scene({
    id: ID,
    draw(ctx, tIn, info) {
      const L = info.lib, P = L.pal;
      const t = L.clamp(tIn, 0, info.dur);
      const T = info.T;
      const sx = (wx) => wx - CAM;

      // --- hero state ---------------------------------------------------------
      let hx = HERO_X, heroTop;
      let spr;
      if (t < B_POP) {
        // the slide: steady linear descent, feet 70 → 103
        const u = t / B_POP;
        spr = 'clawdPole';
        heroTop = SLIDE_Y0 + (SLIDE_Y1 - SLIDE_Y0) * u;
      } else if (t < B_HOP) {
        // stands at the pole base for a beat-half before the hop
        spr = 'clawdIdle';
        heroTop = GY - H_RUN;
      } else if (t < B_LAND) {
        // hops off to the right: 30-frame parabola, h 12, drifts +8 px
        const u = (t - B_HOP) / HOP_A;
        spr = 'clawdJump';
        hx = HERO_X + HOP_DX * u;
        heroTop = GY - 4 * HOP_H * u * (1 - u) - H_JUMP;
      } else {
        // lands and runs right toward the castle at 72 px/s
        spr = N.runPose(info.frame, RUN_V);
        hx = RUN_X0 + RUN_V * (t - B_LAND);
        heroTop = GY - H_RUN;
      }

      // ------------------------------------------------ 1. sky
      L.px(ctx, 0, 0, L.VW, L.VH, P.sky);

      // ------------------------------------------------ 2. cloud
      L.sprite(ctx, 'cloud', sx(CLOUD_X), CLOUD_Y);

      // ------------------------------------------------ 3. castle
      L.sprite(ctx, 'castle', sx(CASTLE_X), GY - 30);

      // ------------------------------------------------ 4. flagpole + sliding flag
      L.px(ctx, sx(POLE_X), POLE_TOP, 2, GY - POLE_TOP, P.pipeGreen);
      L.sprite(ctx, 'sparkle', sx(POLE_X) - 3, POLE_TOP - 8); // ball on the pole top
      const flagY = t < B_POP ? FLAG_Y0 + (FLAG_Y1 - FLAG_Y0) * (t / B_POP) : FLAG_Y1;
      L.sprite(ctx, 'flag', sx(POLE_X) + 2, flagY); // pennant flying right

      // ------------------------------------------------ 5. ground
      L.groundStrip(ctx, CAM - 16, CAM + L.VW + 16, CAM);

      // ------------------------------------------------ 6. Claw'd (in front of the pole)
      L.sprite(ctx, spr, sx(hx), heroTop, { scale: 2 });

      // ------------------------------------------------ 7. FX
      // '+5000' pops at the pole top on T 28.75: rises 8 px over 30 frames, then vanishes
      if (t >= B_POP && t < B_POP + 0.5) {
        const rise = Math.floor(8 * L.seg(t, B_POP, B_POP + 0.5));
        L.pxtext(ctx, '+5000', sx(POLE_X) + 1, 26 - rise, { align: 'center', color: P.hudWhite });
      }
      // fireworks: 8-sparkle radial bursts at 45° steps, out to r 18 over 25 frames: steady
      // for the first 12, then flickering out on 2-frame beats (no fades on the console);
      // burst 1 is fireOrange (small hard px squares — the sparkle sprite is fixed cream),
      // burst 2 draws the sparkle sprite itself
      const BURST_S = 25 / 60;
      const burst = (bx, by, bt, orange) => {
        const k = N.frameOf(t - bt); // frames since the pop
        if (t < bt || t >= bt + BURST_S) return;
        if (k >= 12 && N.step(k, 2, 2) === 1) return;
        const r = 18 * L.seg(t, bt, bt + BURST_S, 'outQuad');
        if (k < 8) L.px(ctx, bx - 1, by - 1, 3, 3, orange ? P.fireYellow : P.sparkle); // core flash
        for (let i = 0; i < 8; i++) {
          const ang = (i * Math.PI) / 4;
          const fx = bx + Math.cos(ang) * r, fy = by + Math.sin(ang) * r;
          if (orange) L.px(ctx, fx - 1, fy - 1, 2, 2, P.fireOrange);
          else L.sprite(ctx, 'sparkle', fx - 4, fy - 4);
        }
      };
      burst(60, 40, B_HOP, true);   // T 29.0 — orange burst (top spark y 21)
      burst(100, 38, B_LAND, false); // T 29.5 — cream sparkle burst (top sparkle y 16)

      // ------------------------------------------------ 8. HUD (G1 row 13)
      L.hud(ctx, {
        score: t >= B_POP ? 7500 : 2500,
        coins: 6,
        world: '1-1',
        time: 400 - Math.floor((T - 2.0) * 10 + 1e-4),
      });
    },
  });
})();
