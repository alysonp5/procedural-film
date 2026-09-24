// Shot 12 — flagpole: The leap onto the flagpole (T 26.0–28.0, dur 2.0 s, mode none,
// hard cut in from shot 11; frame 0 is a fully drawn mid-run pose, the last frame
// holds him hanging on the pole).
//
// Layers, back to front:
//   1. sky fill — overworld plate
//   2. cloud at world (1880, 16)
//   3. the flagpole at world-x 1848: 2-px pipeGreen pole y 40–103 (L.px), sparkle
//      ball on top at y 38, triangular `flag` flying right at y 44 — and the castle
//      at world-x 1912 (32×30, base y 103)
//   4. groundStrip across the visible range
//   5. Super Claw'd (scale 2) — runs, leaps, grabs; always in front of the pole
//   6. HUD — G1 row 12: score 002500, ×06, TIME 160 ticking down to 140
//
// Camera: shot 11 ended at camX 1694 (a +36 px look-ahead over the anchor). Here the
// lead dissolves LINEARLY over the first beat (36 px over 0.5 s = 72 px/s, exactly
// the run speed), so camX holds 1694 while the hero crosses screen 28 → 64 — the
// "ease to the anchor" happens in the framing, with zero leftward camera motion.
// From t 0.5 the camera anchor-follows (camX = runX − 64) — and is capped at 1704,
// the fixed camera of shots 13–14 (pole at screen x 144, storyboard G3). The cap
// bites at t ≈ 0.64, so the leap and the grab play against a parked, SMB-end-level
// frame, and the shot ends exactly on the continuity contract. camX is therefore
// monotonic (right-only, art bible §10.6); a literal follow to the grab (camX 1784)
// would have forced an 80-px leftward whip into the cut, which that rule bans.
//
// The grab: takeoff at world-x 1794 on the T 27.0 beat; the pole is 54 px ahead and
// he travels 72 px/s, so he reaches it 0.75 s later (T 27.75, an 8th) exactly at the
// apex of the h 55, A 36 f parabola (u = 0.5 → feet y = 103 − 55 = 48, storyboard
// G4). That frame he becomes clawdPole at world-x 1846 — the pole (1848–1850) sits
// 2 px inside his left silhouette, the feet side against it — and the flag twitches
// 1 px for 8 frames. Then everything holds: frozen grip, parked camera.
//
// NES motion (60 fps): camX and the hero sit on whole game pixels each frame; the leap is a
// constant-gravity parabola; the run cycle steps on the global frame index.
//
// Determinism: everything derives from t (clamped to [0, dur]) and info.T; no seeds
// needed — the shot has no random choices.

(function () {
  'use strict';

  const ID = 'flagpole';
  const N = FILM.nes;

  // World layout (storyboard G2/G3 + shot 12 composition)
  const RUN_X0 = 1722; // hero world-x at t 0 (G2)
  const RUN_V = 72; // run speed, px/s (1.2 px a frame at 60 fps)
  const ANCHOR = 64; // hero screen-x anchor in run shots
  const CAM_START = 1694; // shot 11's final camX (+36 px look-ahead)
  const CAM_LEAD = CAM_START - (RUN_X0 - ANCHOR); // 36 — dissolves over beat 1
  const CAM_END = 1704; // fixed camera of shots 13–14 (pole at screen 144, G3)
  const POLE_X = 1848; // flagpole, 2 px wide, y 40–103
  const BALL_Y = 32; // sparkle ball on the pole top (sprite bottom flush at y 40 — matches shots 11 and 13)
  const FLAG_Y = 44; // triangular flag, flying right
  const CASTLE_X = 1912; // 32×30 castle, base y 103
  const CLOUD_X = 1880;
  const CLOUD_Y = 16;
  const GY = 103; // ground top face (lib.GROUND_Y)

  // Beats (shot-local seconds)
  const B_JUMP = 1.0; // T 27.0 — THE BIG JUMP takes off at world-x 1794
  const B_GRAB = 1.75; // T 27.75 — pole grab at the apex (an 8th note)
  const AIR = 1.5; // 1.5 s of air (G4), 90 frames
  const JUMP_H = 55; // apex height (G4)
  const TAKEOFF_X = RUN_X0 + RUN_V * B_JUMP; // 1794
  const GRAB_X = 1846; // frozen grip: sprite left edge, feet side against the pole
  const GRAB_FEET = GY - JUMP_H; // 48 — apex height
  const JIG_S = 8 / 60; // flag twitch: 1 px for 8 frames from the grab

  FILM.scene({
    id: ID,
    draw(ctx, tIn, info) {
      const L = info.lib, P = L.pal;
      const t = L.clamp(tIn, 0, info.dur);

      // --- hero state ---------------------------------------------------------
      let heroX, feetY, spr, sprH;
      if (t < B_JUMP) {
        // Run right at 72 px/s, run cycle on the global frame.
        heroX = RUN_X0 + RUN_V * t;
        feetY = GY;
        spr = N.runPose(info.frame, RUN_V);
        sprH = 24; // 12 rows at scale 2
      } else if (t < B_GRAB) {
        // The soaring parabola: h 55, 1.5 s of air, apex (u = 0.5) exactly at the pole.
        const u = (t - B_JUMP) / AIR;
        heroX = TAKEOFF_X + RUN_V * (t - B_JUMP);
        feetY = GY - 4 * JUMP_H * u * (1 - u);
        spr = 'clawdJump';
        sprH = 20; // 10 rows at scale 2
      } else {
        // Frozen on the pole, feet y 48, feet side against it.
        heroX = GRAB_X;
        feetY = GRAB_FEET;
        spr = 'clawdPole';
        sprH = 22; // 11 rows at scale 2
      }

      // --- camera ---------------------------------------------------------------
      // Beat 1: the +36 lead dissolves linearly at run speed — camX parks at 1694
      // while the hero settles onto the anchor. Then anchor-follow, capped at 1704
      // (monotonic, right-only; see header). Nominal run-x drives the camera even
      // after the hero freezes, so the cap logic never sees the grab pose.
      const runX = RUN_X0 + RUN_V * t;
      const lead = CAM_LEAD * (1 - L.clamp(t / 0.5));
      const camX = Math.round(Math.min(runX - ANCHOR + lead, CAM_END)); // whole game px
      heroX = Math.round(heroX);

      // 1. sky ------------------------------------------------------------------
      L.px(ctx, 0, 0, L.VW, L.VH, P.sky);

      // 2. cloud -----------------------------------------------------------------
      L.sprite(ctx, 'cloud', CLOUD_X - camX, CLOUD_Y);

      // 3. flagpole + castle -------------------------------------------------------
      const jig = t >= B_GRAB && t < B_GRAB + JIG_S ? 1 : 0;
      L.px(ctx, POLE_X - camX, 40, 2, GY - 40, P.pipeGreen);
      L.sprite(ctx, 'sparkle', POLE_X - 3 - camX, BALL_Y); // ball mounted on the pole top
      L.sprite(ctx, 'flag', POLE_X + 2 - camX, FLAG_Y + jig); // pennant flying right; twitches on the grab
      L.sprite(ctx, 'castle', CASTLE_X - camX, GY - 30);

      // 4. ground ------------------------------------------------------------------
      L.groundStrip(ctx, camX - 16, camX + L.VW + 16, camX);

      // 5. hero ----------------------------------------------------------------------
      L.sprite(ctx, spr, heroX - camX, feetY - sprH, { scale: 2 });

      // 6. HUD -----------------------------------------------------------------------
      L.hud(ctx, { score: 2500, coins: 6, time: 400 - Math.floor((info.T - 2.0) * 10) });
    },
  });
})();
