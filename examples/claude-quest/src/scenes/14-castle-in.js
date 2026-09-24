/*
 * 14 castle-in — T 30.0–32.0 (dur 2.0 s), mode none, hard cut in (mid-run).
 *
 * Super Claw'd runs the last stretch to the castle and disappears through the
 * door. Camera fixed at camX 1704 (G3): flagpole at screen 144, castle at
 * screen 208, door at screen ~221–227.
 *
 * World layout (game px; screen x = world-x − 1704):
 *   cloud     world (1780, 20) → screen 76
 *   flagpole  world-x 1848, pole y 40–103, sparkle ball on top; the flag is
 *             gone (taken down during shot 13's slide — bare pole, SMB-style)
 *   castle    world-x 1912, 32×30, base y 103 → screen (208, 73)
 *   door      sprite cols 13–18 + castle x → world 1925–1931, centre 1928
 *   hero      world-x 1860 + 72·t (left edge — G2/storyboard world-x semantics),
 *             feet y 103, scale 2 (32×24), run cycle keyed to the global frame (FILM.nes),
 *             whole game px each 60 Hz frame
 *
 * THE ENTRY — classic SMB draw-order swap. While the hero's centre is left of
 * the door's left jamb (centre < 1925) he draws AFTER the castle, running in
 * front of the wall, the black door visible between his legs in the last
 * in-front frames. Once his centre crosses the jamb — t = (1925 − 16 −
 * 1860)/72 = 49/72 ≈ 0.681 (T 30.681) — the order swaps: hero first, castle
 * over him, and since the keep's 32 px of wall and door void now cover him he
 * is simply not drawn any more: the doorway swallows him whole, SMB1-style.
 * (Drawing him behind the castle would leak his top rows through the
 * crenellation gaps for a frame — the verified-clean read is the instant
 * vanish.) He is inside well before T 31.75 (storyboard) and the frame holds
 * on the empty castle; the keep's pennant twitches once (1 px up, to the cut: 6 frames)
 * from local t 1.9 (T 31.9).
 *
 * Layers back to front:
 *   1 sky fill
 *   2 cloud (world 1780, 20)
 *   3 flagpole (bare) + sparkle ball
 *   4 ground strip (camX … camX + 240)
 *   5 hero + castle — draw order swapped at the door jamb (see above)
 *   6 pennant twitch overlay (castle pennant redrawn 1 px up from t 1.9)
 *   7 HUD (G1: score 007500, ×06, TIME 400 − floor((T − 2)·10) = 120 → 100)
 *
 * Determinism: everything derives from clamped t and info.T; no random choices.
 */
(function () {
  'use strict';

  const ID = 'castle-in';

  // World constants (game px)
  const CAM_X = 1704; // fixed camera (G3)
  const FEET = 103; // ground top face (lib.GROUND_Y)
  const HERO_W = 32; // Super Claw'd bounding box at scale 2
  const HERO_H = 24; // run sprite: 12 rows × 2
  const RUN_V = 72; // run speed, px/s
  const X_START = 1860; // hero left edge at t 0 (shot 13 hands off at world-x 1860)
  const CLOUD_X = 1780, CLOUD_Y = 20;
  const POLE_X = 1848; // flagpole (G3)
  const CASTLE_X = 1912; // castle left edge (G3)
  const CASTLE_TOP = FEET - 30; // 73 — castle sprite is 30 tall
  const DOOR_L = CASTLE_X + 13; // 1925 — door's left jamb (sprite cols 13–18)
  const TWITCH_T = 1.9; // T 31.9 — pennant jiggle starts
  const N = FILM.nes;

  FILM.scene({
    id: ID,
    draw(ctx, tIn, info) {
      const L = info.lib, P = L.pal;
      const t = L.clamp(tIn, 0, info.dur);

      // hero state: always mid-run, moving right at 72 px/s
      const heroWx = Math.round(X_START + RUN_V * t); // left edge, whole game px
      const heroCx = heroWx + HERO_W / 2;
      const inFront = heroCx < DOOR_L; // before the jamb: over the castle; after: behind it

      // ------------------------------------------------ 1. sky
      L.px(ctx, 0, 0, L.VW, L.VH, P.sky);

      // ------------------------------------------------ 2. cloud (world-locked)
      L.sprite(ctx, 'cloud', CLOUD_X - CAM_X, CLOUD_Y);

      // ------------------------------------------------ 3. flagpole (flag taken in shot 13)
      L.px(ctx, POLE_X - CAM_X, 40, 2, FEET - 40, P.pipeGreen);
      L.sprite(ctx, 'sparkle', POLE_X - 3 - CAM_X, 40 - 8); // ball on the pole top

      // ------------------------------------------------ 4. ground
      L.groundStrip(ctx, CAM_X, CAM_X + L.VW, CAM_X);

      // ------------------------------------------------ 5. hero + castle (order swap)
      // Once his centre is past the jamb he is inside: the castle covers his whole
      // span, so he is not drawn at all — nothing leaks through wall or crenels.
      const drawHero = () => {
        // run cycle keyed to the global frame like shot 06
        L.sprite(ctx, N.runPose(info.frame, RUN_V), heroWx - CAM_X, FEET - HERO_H, { scale: 2 });
      };
      L.sprite(ctx, 'castle', CASTLE_X - CAM_X, CASTLE_TOP);
      if (inFront) drawHero(); // before the jamb: hero runs in front of the castle

      // ------------------------------------------------ 6. pennant twitch (T 31.9 to the cut, 6 frames)
      // The pennant is baked into the castle sprite at local x 16–22, y 0–2 against
      // open sky; erase it and redraw one game px up.
      if (t >= TWITCH_T) {
        const px = CASTLE_X - CAM_X + 16, py = CASTLE_TOP;
        L.px(ctx, px, py, 7, 3, P.sky); // clear the baked pennant (sky behind it)
        L.px(ctx, px, py - 1, 7, 1, P.bushGreen); // row 0, shifted up 1 px
        L.px(ctx, px, py, 5, 1, P.bushGreen); // row 1
        L.px(ctx, px, py + 1, 3, 1, P.bushGreen); // row 2
      }

      // ------------------------------------------------ 7. HUD (G1 row 14)
      L.hud(ctx, {
        score: 7500,
        coins: 6,
        world: '1-1',
        time: 400 - Math.floor((info.T - 2.0) * 10 + 1e-4),
      });
    },
  });
})();
