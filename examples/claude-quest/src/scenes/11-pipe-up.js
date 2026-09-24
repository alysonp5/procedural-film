// Shot 11 — pipe-up: Back to daylight (T 24.0–26.0, dur 2.0 s, transitionIn fade 0.25
// handled by core as an NES palette fade; frame 0 is a fully drawn pose). 60 fps: the camera
// and every sprite sit on whole game pixels each frame.
//
// Layers, back to front:
//   1. sky fill — daylight again after the cave
//   2. hills at world-x 1700 / 1780 (base y 103) and a cloud at (1750, 20)
//   3. far landmarks: the flagpole at world-x 1848 (pipeGreen pole y 40–103, sparkle
//      tip, flag at y 44) and the castle at world-x 1912 (base y 103) — they enter
//      frame right as the camera moves
//   4. groundStrip across the visible range
//   5. the 2-tile pipe at world-x 1650 (rim top y 71) and Super Claw'd (scale 2) —
//      their draw order swaps at the hop, see below
//   6. HUD — G1 row 11: score 002500, ×06, TIME 180 ticking down to 160
//
// Pipe-occlusion note: the brief's sandwich (body rows, hero, rim over him) cannot
// fully hide a 24-px-tall Super Claw'd behind a 16-px rim — his legs would sit on top
// of the pipe body at t 0. So during the rise and stand (t < 1.0) he is drawn BEFORE
// the whole pipe: body rows and rim both occlude him, frame 0 fully hidden, and the
// rim still occludes his middle as he slides up. From the hop on (t ≥ 1.0) the pipe
// draws first and he runs in front. At the swap instant he stands exactly on the rim
// with zero pixel overlap, so the order change never shows.
//
// Camera note: the hero anchors at screen x 64 once running (camX = heroX − 64).
// A pure follow ends at camX 1658 with the castle (world-x 1912) at screen 254 —
// off-frame, while the storyboard wants it "entering frame at the end". So a +36 px
// look-ahead eases in over the last beat (t 1.5–2.0; a one-beat camera ease, art
// bible §7.2): final frame has the hero at screen 28, the flagpole at 154 and the
// castle's left 22 px on screen at 218. camX is snapped to a whole game pixel after the ease.
//
// Determinism: everything derives from t (clamped to [0, dur]) and info.T; no seeds
// needed — the shot has no random choices.

(function () {
  'use strict';

  const ID = 'pipe-up';
  const N = FILM.nes;

  // World layout (storyboard G2/G3 + shot 11 composition)
  const PIPE_X = 1650; // 2-tile pipe; hero rises out of it and resumes the surface run here
  const PIPE_TOP = 71; // rim top y
  const HILL1_X = 1700;
  const HILL2_X = 1780;
  const CLOUD_X = 1750;
  const POLE_X = 1848; // flagpole, 2 px wide, y 40–103
  const CASTLE_X = 1912; // 32×30 castle, base y 103
  const GY = 103; // ground top face (lib.GROUND_Y)
  const ANCHOR = 64; // hero screen-x anchor in run shots

  // Beats (shot-local seconds)
  const RISE_END = 0.75; // T 24.75 — standing on the rim
  const HOP_T = 1.0; // T 25.0 — hops off right
  const HOP_A = 0.5; // 30 frames of air
  const LAND_T = HOP_T + HOP_A; // t 1.5 — lands on the ground, runs on
  const HOP_H = 20; // hop bump height (storyboard G4-style parabola)
  const HOP_DX = 36; // 72 px/s × 0.5 s
  const RUN_V = 72; // run speed, px/s
  const CAM_LEAD = 36; // end-of-shot camera look-ahead (see header)

  FILM.scene({
    id: ID,
    draw(ctx, tIn, info) {
      const L = info.lib, P = L.pal;
      const t = L.clamp(tIn, 0, info.dur);

      // --- hero state ---------------------------------------------------------
      let heroX, feetY, spr;
      if (t < HOP_T) {
        // Rise + stand: a steady upward slide, feet 95 (fully inside the pipe, top
        // level with the rim) → 71 (standing on the rim); holds the rim until the hop.
        const u = L.clamp(t / RISE_END);
        heroX = PIPE_X;
        feetY = 95 - 24 * u;
        spr = 'clawdIdle';
      } else if (t < LAND_T) {
        // Hop off right: 30-frame parabola from the rim (y 71) down to the ground
        // (y 103), moving right at run speed.
        const u = (t - HOP_T) / HOP_A;
        heroX = PIPE_X + HOP_DX * u;
        feetY = L.lerp(PIPE_TOP, GY, u) - 4 * HOP_H * u * (1 - u);
        spr = 'clawdJump';
      } else {
        // Run right at 72 px/s.
        heroX = PIPE_X + HOP_DX + RUN_V * (t - LAND_T);
        feetY = GY;
        spr = N.runPose(info.frame, RUN_V);
      }
      const sprH = spr === 'clawdJump' ? 20 : 24; // scale-2 sprite heights (10/12 rows)
      const heroGY = feetY - sprH;

      // --- camera ---------------------------------------------------------------
      // Follows once the hero passes the anchor (he starts on it: camX 1586); the
      // look-ahead eases in over the last beat so the castle enters frame right.
      const lead = CAM_LEAD * L.seg(t, LAND_T, info.dur, 'inOutQuad');
      heroX = Math.round(heroX); // whole game px
      const camX = Math.round(heroX - ANCHOR + lead); // whole game px

      // 1. sky ------------------------------------------------------------------
      L.px(ctx, 0, 0, L.VW, L.VH, P.sky);

      // 2. hills + cloud ---------------------------------------------------------
      L.sprite(ctx, 'hill', HILL1_X - camX, GY - 10);
      L.sprite(ctx, 'hill', HILL2_X - camX, GY - 10);
      L.sprite(ctx, 'cloud', CLOUD_X - camX, 20);

      // 3. far landmarks: flagpole + castle ---------------------------------------
      L.px(ctx, POLE_X - camX, 40, 2, GY - 40, P.pipeGreen);
      L.sprite(ctx, 'sparkle', POLE_X - 3 - camX, 40 - 8); // ball on the pole top
      L.sprite(ctx, 'flag', POLE_X + 2 - camX, 44); // pennant flying right
      L.sprite(ctx, 'castle', CASTLE_X - camX, GY - 30);

      // 4. ground ------------------------------------------------------------------
      L.groundStrip(ctx, camX - 16, camX + L.VW + 16, camX);

      // 5. pipe + hero (order swap at the hop — see header) -------------------------
      const hero = () => L.sprite(ctx, spr, heroX - camX, heroGY, { scale: 2 });
      if (t < HOP_T) {
        hero(); // behind the whole pipe: fully hidden at t 0, rim occludes on the way up
        L.pipe(ctx, PIPE_X - camX, PIPE_TOP, 2);
      } else {
        L.pipe(ctx, PIPE_X - camX, PIPE_TOP, 2);
        hero(); // clear of the pipe, runs in front of the world
      }

      // 6. HUD -----------------------------------------------------------------------
      L.hud(ctx, { score: 2500, coins: 6, time: 400 - Math.floor((info.T - 2.0) * 10) });
    },
  });
})();
