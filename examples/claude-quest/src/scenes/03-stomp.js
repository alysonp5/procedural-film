// Shot 03 — stomp · T 4.5–6.5 (dur 2.0 s) · mode none · hard cut in/out, mid-run both sides.
//
// Layers, back to front:
//   1 sky fill            4 ground strip          7 "+100" score pop
//   2 clouds (world)      5 bug1/2 → bugFlat      8 HUD
//   3 bush (world)        6 Claw'd (run1/2, jump)
//
// Continuity contracts (storyboard G1/G2/G4 + brief):
//   hero world-x 168 → 312 at 72 px/s; camX = heroWorldX − 64 from frame 0 (hero pinned at
//   screen x 64), snapped to a whole game pixel every 60 Hz frame. Jump at local 0.25 (h 20,
//   0.75 s of air), lands ON the bug at world-x 240 at local 1.0 (T 5.5); bounce h 8, 0.5 s,
//   lands local 1.5 and keeps running. Both arcs are constant-gravity parabolas.
//   HUD: score 000000 → 000100 at the stomp, coins ×00, time = 400 − floor((T − 2)·10).
//   Note: the brief's bug formula and its "meet at world-x 240" disagree by 24 px; the
//   storyboard ("the bug walks into his landing point: they meet at world-x 240 at T 5.5")
//   wins on position+time, so the bug walks bugX = 264 − 24·t and is under the hero at t 1.0.
(function () {
  'use strict';

  const ID = 'stomp';
  const LIB = FILM.lib;
  const clamp = LIB.clamp;
  const N = FILM.nes;

  // Beat constants, shot-local seconds.
  const B_JUMP = 0.25; // T 4.75 takeoff
  const B_STOMP = 1.0; // T 5.5  stomp lands on the bug
  const B_LAND = 1.5; // T 6.0  bounce ends, run resumes
  const JUMP_AIR = 0.75; // s (45 frames)
  const BOUNCE_AIR = 0.5; // s (30 frames)
  const JUMP_H = 20;
  const BOUNCE_H = 8;
  const GROUND = LIB.GROUND_Y; // 103
  const MEET_X = 240; // world-x of the stomp (hero and bug both here at local 1.0)
  const RISE_F = 0.5; // +100 rises 8 px over 0.5 s
  const HOLD_F = 0.25; // then holds an 8th and vanishes (the console has no fades)
  const RUN_V = 72;

  // Art-bible jump parabola: apex h, progress u in [0,1] → feet y.
  const arc = (h, u) => GROUND - 4 * h * u * (1 - u);

  // "+100" in the pixel font, centred on cx (game px).
  function scorePop(ctx, L, color, cx, gy) {
    L.pxtext(ctx, '+100', Math.round(cx), Math.round(gy), { color, align: 'center' });
  }

  FILM.scene({
    id: ID,
    draw(ctx, tIn, info) {
      const L = info.lib, P = L.pal;
      const t = clamp(tIn, 0, info.dur);

      // --- world state (all game px) -----------------------------------------
      const heroX = Math.round(168 + RUN_V * t); // hero world-x (left edge), whole px; 168 → 312
      const camX = heroX - 64; // hero pinned at screen x 64; 104 → 248
      const bugX = 264 - 24 * t; // walks left at 24 px/s; equals MEET_X at t = B_STOMP
      const stomped = t >= B_STOMP;
      const score = stomped ? 100 : 0;
      const time = 400 - Math.floor((info.T - 2.0) * 10);

      // Hero feet y + pose. Run drawings step on the global frame index so the cycle
      // continues seamlessly across the cuts with shots 02 and 04.
      let feet = GROUND, pose;
      if (t < B_JUMP) {
        pose = N.runPose(info.frame, RUN_V);
      } else if (t < B_STOMP) {
        feet = arc(JUMP_H, (t - B_JUMP) / JUMP_AIR);
        pose = 'clawdJump';
      } else if (t < B_LAND) {
        feet = arc(BOUNCE_H, (t - B_STOMP) / BOUNCE_AIR);
        pose = 'clawdJump';
      } else {
        pose = N.runPose(info.frame, RUN_V);
      }

      // --- 1 sky ---------------------------------------------------------------
      L.px(ctx, 0, 0, L.VW, L.VH, P.sky);

      // --- 2 clouds (world-anchored, scroll with the camera) --------------------
      L.sprite(ctx, 'cloud', 250 - camX, 22);
      L.sprite(ctx, 'cloud', 340 - camX, 16);

      // --- 3 bush ---------------------------------------------------------------
      L.sprite(ctx, 'bush', 260 - camX, GROUND - 7);

      // --- 4 ground -------------------------------------------------------------
      L.groundStrip(ctx, camX, camX + L.VW, camX);

      // --- 5 the bug: walking left, feet swapping every 8 frames; flattened at the stomp
      if (stomped) {
        L.sprite(ctx, 'bugFlat', MEET_X - camX, GROUND - 4);
      } else {
        const bugPose = N.step(info.frame, 8, 2) ? 'bug2' : 'bug1';
        L.sprite(ctx, bugPose, Math.round(bugX) - camX, GROUND - 9);
      }

      // --- 6 Claw'd ---------------------------------------------------------------
      L.sprite(ctx, pose, heroX - camX, feet - (pose === 'clawdJump' ? 10 : 12));

      // --- 7 "+100" pop: above the stomp, rises 8 px over 0.5 s, holds, then vanishes
      // y0 84: the hero bounces straight up from the bug faster than the pop rises, so
      // the text starts just over his head (head top 93 at t 1.0, 85 at the bounce apex)
      // and stays clear of his sprite for its whole life instead of covering his face.
      if (stomped) {
        const age = t - B_STOMP;
        const rise = Math.floor(clamp(age / RISE_F) * 8);
        if (age < RISE_F + HOLD_F) scorePop(ctx, L, P.hudWhite, MEET_X + 6 - camX, 84 - rise);
      }

      // --- 8 HUD ------------------------------------------------------------------
      L.hud(ctx, { score, coins: 0, world: '1-1', time });
    },
  });
})();
