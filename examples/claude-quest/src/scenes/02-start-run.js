/*
 * 02-start-run.js — shot 02 'start-run', T 2.0–4.5 (dur 2.5 s; beat 0.5 s = 30 frames at 60 fps).
 * World 1-1's opening screen grammar: the HUD pops on, Claw'd idles, breaks into a run,
 * the camera starts scrolling once he anchors at screen x 64, and a bug walks in from the
 * right edge. Ends mid-run at hero world-x 168 (camX 104) — shot 03 continues this world.
 *
 * Layers, back to front:
 *   1. sky — flat pal.sky fill
 *   2. clouds at world (60, 18) and (180, 30)
 *   3. hill at world-x 24, bush at world-x 130 (feet on the ground line y 103)
 *   4. ground strip across the visible world range (camX−16 .. camX+256)
 *   5. bug — enters at local t 1.5 (T 3.5), walking left at 24 px/s, bug1/bug2 every 8 frames
 *   6. Claw'd — idle to local t 0.5 (T 2.5), then run1/run2 (FILM.nes.runPose), feet y 103
 *   7. HUD — screen-fixed, 3-step pop from t 0 (3 frames a step), TIME = 400 − floor((T − 2.0) · 10)
 *
 * NES motion: the camera and every sprite sit on whole game pixels each 60 Hz frame. camX is
 * snapped once and every world object is drawn at its world-x minus that integer camX, so the
 * scene scrolls 1 or 2 px a frame (72 px/s = 1.2 px/frame) with nothing jittering against it.
 */
(function () {
  'use strict';
  const ID = 'start-run';

  // Geometry and timing (storyboard Conventions, G1, G2; game px).
  const RUN_V = 72; // hero run speed: 1.2 px a frame at 60 fps
  const BUG_V = 24; // bug walk speed, leftward
  const T_RUN = 0.5; // local t the hero breaks into a run (T 2.5)
  const T_BUG = 1.5; // local t the bug enters (T 3.5)
  const HERO_X0 = 24; // hero world-x at t 0 (G2)
  const ANCHOR_X = 64; // hero anchors at screen x 64 once the camera scrolls (T ≈ 3.06)
  const BUG_X0 = 264; // bug world-x at T_BUG: 240 + 24 · (shot time remaining at T 3.5)
  const GROUND_Y = 103; // ground top face (lib.GROUND_Y)

  // HUD pop: three steps of scale about the bar's centre, each held 3 frames, then hold at 1.
  const HUD_POP = [0.72, 1.08, 1];
  const HUD_POP_HOLD = 3;

  // Scratch strip the HUD is drawn into during its pop, so the scale blit keeps hard
  // nearest-neighbour edges (no smoothing, ever). Redrawn every pop frame — t-dependent.
  let hudStrip = null;
  function hudScratch(PX) {
    if (!hudStrip) {
      hudStrip = document.createElement('canvas');
      hudStrip.width = 240 * PX; // full game width
      hudStrip.height = 16 * PX; // HUD band: game rows 0–15
    }
    return hudStrip;
  }

  FILM.scene({
    id: ID,
    draw(ctx, tIn, info) {
      const L = info.lib;
      const P = L.pal;
      const N = FILM.nes;
      const t = L.clamp(tIn, 0, info.dur);

      // --- continuity ---------------------------------------------------------
      // Hero world-x: stands at 24 until T_RUN, then runs right at 72 px/s → 168 at t 2.5.
      const heroWX = HERO_X0 + RUN_V * Math.max(0, t - T_RUN);
      // Camera: static until he reaches the anchor, then camX = heroWorldX − 64.
      const camX = Math.max(0, Math.round(heroWX) - ANCHOR_X); // snapped: a whole game pixel
      const heroSX = Math.round(heroWX) - camX;
      const running = t >= T_RUN;
      const heroSprite = running ? N.runPose(info.frame, RUN_V) : 'clawdIdle';

      // --- 1. sky --------------------------------------------------------------
      L.px(ctx, 0, 0, L.VW, L.VH, P.sky);

      // --- 2. clouds (world-locked) --------------------------------------------
      L.sprite(ctx, 'cloud', 60 - camX, 18);
      L.sprite(ctx, 'cloud', 180 - camX, 30);

      // --- 3. hill + bush, feet on the ground line ------------------------------
      L.sprite(ctx, 'hill', 24 - camX, GROUND_Y - 10);
      L.sprite(ctx, 'bush', 130 - camX, GROUND_Y - 7);

      // --- 4. ground across the visible world range -----------------------------
      L.groundStrip(ctx, camX - 16, camX + 256, camX);

      // --- 5. the bug walks in from the right edge at T 3.5 ----------------------
      if (t >= T_BUG) {
        const bugWX = BUG_X0 - BUG_V * (t - T_BUG); // 240 at shot end
        const bugSprite = N.step(info.frame, 8, 2) ? 'bug2' : 'bug1';
        L.sprite(ctx, bugSprite, bugWX - camX, GROUND_Y - 9);
      }

      // --- 6. Claw'd --------------------------------------------------------------
      L.sprite(ctx, heroSprite, heroSX, GROUND_Y - 12);

      // --- 7. HUD (screen-fixed; pops on over frames 0–2, G1: 000000 ×00 TIME 400) ---
      const time = 400 - Math.floor((info.T - 2.0) * 10);
      const f = Math.floor(N.frameOf(t) / HUD_POP_HOLD); // pop step
      if (f < HUD_POP.length) {
        const s = HUD_POP[f];
        const c = hudScratch(L.PX);
        const g = c.getContext('2d');
        g.clearRect(0, 0, c.width, c.height);
        L.hud(g, { score: 0, coins: 0, world: '1-1', time });
        const cx = 120 * L.PX;
        const cy = 8 * L.PX; // pop centre: middle of the HUD band
        ctx.save();
        ctx.imageSmoothingEnabled = false;
        ctx.translate(cx, cy);
        ctx.scale(s, s);
        ctx.drawImage(c, -cx, -cy);
        ctx.restore();
      } else {
        L.hud(ctx, { score: 0, coins: 0, world: '1-1', time });
      }
    },
  });
})();
