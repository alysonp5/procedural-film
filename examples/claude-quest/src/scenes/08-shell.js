// Shot 08 — shell · T 16.0–18.5 (dur 2.5 s) · mode none · hard cut in/out, mid-run both sides.
//
// Layers, back to front:
//   1 sky fill              4 bugs A/B (walk left → flipped fall)   7 score pops
//   2 cloud + bush (world)  5 shellbug → shell (walk / skid / slide)
//   3 ground strip          6 Super Claw'd (scale 2)                8 HUD
//
// Continuity contracts (storyboard G1/G2/G4 + brief):
//   hero world-x = 976 + 72·t (in from shot 07 at 976, out to shot 09 at 1156);
//   camX = heroX − 64 (hero pinned at screen x 64, a whole game pixel each 60 Hz frame);
//   feet y 103; Super scale 2.
//   Hop local 0.5 (h 22, 0.5 s of air) → STOMP local 1.0 (T 17.0): shellbug → shell, +100.
//   Bounce h 8, 0.5 s → land + KICK local 1.5 (T 17.5): shell slides right at 96 px/s.
//   Shell meets bug A at local 2.0 (T 18.0, +200) and bug B at local 2.25 (T 18.25,
//   +400 — placed half a beat before the cut so the pop reads). Each hit flips the bug
//   upside-down and it falls off the bottom under gravity over 1/3 s (20 frames).
//   HUD: 001300 → 001400 (1.0) → 001600 (2.0) → 002000 (2.25); ×01;
//   time = 400 − floor((info.T − 2.0)·10) → 260 at start, matching shot 09's 235.
//
// Geometry note for reviewers (the brief's literal numbers are impossible; two forced fixes):
//   - Shellbug starts at world-x 1090 (brief said 1072): at local 1.0 it is exactly under
//     the hero's right half, right edges flush (hero 1048–1080, shellbug 1066–1080). The
//     1072 start left-aligns it and parks the shell 68 px behind the kick.
//   - The stomp knocks the shell forward: it skids right at 100 px/s during the bounce,
//     arriving flush with the hero's nose (world 1116) the frame he lands (local 1.5).
//     Why this is forced: the hero (72 px/s) is always AHEAD of a shell launched from the
//     stomp point (96 px/s from 36 px behind), so any shell/bug meeting earlier than
//     t = 3.75 s happens inside the hero's sprite — the mandated 2.0/2.25 hits would show
//     the bugs dying inside his body (checked numerically: 42 px and 36 px deep). With the
//     skid, the kicked shell leaves from his nose and pulls away at 24 px/s: the bugs die
//     26 px and 32 px ahead of him and he never touches them. It reads as one motion:
//     stomp pops the shell out from under him → he lands nose-to-shell → kick.
(function () {
  'use strict';

  const ID = 'shell';
  const LIB = FILM.lib;
  const clamp = LIB.clamp;
  const N = FILM.nes;
  const RUN_V = 72;

  // Beat constants, shot-local seconds.
  const B_HOP = 0.5; // T 16.5  takeoff
  const B_STOMP = 1.0; // T 17.0  shellbug → shell, +100
  const B_KICK = 1.5; // T 17.5  hero lands; shell slides right at 96 px/s
  const B_HIT_A = 2.0; // T 18.0  shell meets bug A, +200
  const B_HIT_B = 2.25; // T 18.25 shell meets bug B, +400

  const HOP_H = 22;
  const BOUNCE_H = 8;
  const AIR = 0.5; // both arcs are 0.5 s (30 frames)
  const FEET = LIB.GROUND_Y; // 103

  // World layout (game px).
  const BUSH_X = 1080;
  const CLOUD_X = 1120, CLOUD_Y = 18;

  // The shell actor (see header note).
  const SB_START = 1090; // shellbug left edge at t 0; walks left at 24 px/s
  const SHELL_STOMP = SB_START - 24 * B_STOMP; // 1066: shell appears here at local 1.0
  const SHELL_KICK = 1116; // shell left edge at the kick = hero's nose at local 1.5
  const SKID_V = (SHELL_KICK - SHELL_STOMP) / (B_KICK - B_STOMP); // 100 px/s during the bounce
  const SHELL_V = 96; // px/s once kicked
  const HIT_A_X = SHELL_KICK + 14 + SHELL_V * (B_HIT_A - B_KICK); // 1178 = bug A left edge at death
  const HIT_B_X = SHELL_KICK + 14 + SHELL_V * (B_HIT_B - B_KICK); // 1202 = bug B left edge at death

  // The two bugs: left edge meets the shell's right edge exactly at the hit time.
  const BUG_V = 24; // px/s walking left
  const BUG_A_START = HIT_A_X + BUG_V * B_HIT_A; // 1226
  const BUG_B_START = HIT_B_X + BUG_V * B_HIT_B; // 1256
  const FALL_F = 1 / 3; // flipped bugs fall off the bottom over 20 frames

  // Score pops: pxtext scale 1 ('+' glyph exists), rises 8 px over 0.5 s, holds an 8th, vanishes.
  const POP_RISE = 0.5;
  const POP_HOLD = 0.25;

  // Art-bible jump parabola: apex h, progress u → feet y.
  const arc = (h, u) => FEET - 4 * h * u * (1 - u);

  function scorePop(ctx, L, P, str, worldCx, camX, y0, age) {
    if (age < 0 || age >= POP_RISE + POP_HOLD) return;
    const rise = Math.floor(clamp(age / POP_RISE) * 8);
    L.pxtext(ctx, str, worldCx - camX, y0 - rise, { color: P.hudWhite, align: 'center' });
  }

  // A bug flipped upside-down in place (its box [gy, gy+9] mirrored about its own centre),
  // pixels kept hard: integer translate, no smoothing, straight blit under a 1,-1 transform.
  function bugFlipped(ctx, L, pose, gx, feetY) {
    const gy = Math.round(feetY) - 9;
    ctx.save();
    ctx.translate(0, (2 * gy + 9) * LIB.PX);
    ctx.scale(1, -1);
    L.sprite(ctx, pose, gx, gy);
    ctx.restore();
  }

  FILM.scene({
    id: ID,
    draw(ctx, tIn, info) {
      const L = info.lib, P = L.pal;
      const t = clamp(tIn, 0, info.dur);
      const T = info.T;

      // --- world state ---------------------------------------------------------
      const heroX = Math.round(976 + RUN_V * t); // hero world-x (left edge), whole px; 976 → 1156
      const camX = heroX - 64; // hero pinned at screen x 64; 912 → 1092
      const sx = (wx) => wx - camX;
      const score = t >= B_HIT_B ? 2000 : t >= B_HIT_A ? 1600 : t >= B_STOMP ? 1400 : 1300;
      const time = 400 - Math.floor((T - 2.0) * 10 + 1e-4);

      // Hero feet y + pose. Run drawings step on the global frame index so the cycle
      // continues seamlessly across the cuts with shots 07 and 09.
      const runPose = N.runPose(info.frame, RUN_V);
      let feet = FEET, pose = runPose;
      if (t >= B_HOP && t < B_STOMP) {
        feet = arc(HOP_H, (t - B_HOP) / AIR);
        pose = 'clawdJump';
      } else if (t >= B_STOMP && t < B_KICK) {
        feet = arc(BOUNCE_H, (t - B_STOMP) / AIR);
        pose = 'clawdJump';
      }

      // --- 1 sky ----------------------------------------------------------------
      L.px(ctx, 0, 0, L.VW, L.VH, P.sky);

      // --- 2 cloud + bush (world-anchored) ---------------------------------------
      L.sprite(ctx, 'cloud', sx(CLOUD_X), CLOUD_Y);
      L.sprite(ctx, 'bush', sx(BUSH_X), FEET - 7);

      // --- 3 ground ---------------------------------------------------------------
      L.groundStrip(ctx, camX, camX + L.VW, camX);

      // --- 4 bugs A and B: walk left at 24 px/s until hit, then flip and fall ------
      const walkPose = N.step(info.frame, 8, 2) ? 'bug2' : 'bug1';
      for (const [startX, hitT] of [[BUG_A_START, B_HIT_A], [BUG_B_START, B_HIT_B]]) {
        if (t < hitT) {
          const bx = sx(startX - BUG_V * t);
          if (bx > -12 && bx < L.VW) L.sprite(ctx, walkPose, bx, FEET - 9);
        } else {
          const u = clamp((t - hitT) / FALL_F);
          if (u < 1) {
            // frozen at the hit point, on the walk frame it died in; gravity ease-in
            const hitX = startX - BUG_V * hitT;
            const deadPose = N.step(N.frameOf(16 + hitT), 8, 2) ? 'bug2' : 'bug1';
            bugFlipped(ctx, L, deadPose, sx(hitX), FEET + 48 * L.ease.inQuad(u));
          }
        }
      }

      // --- 5 shellbug → shell -----------------------------------------------------
      if (t < B_STOMP) {
        const sbPose = N.step(info.frame, 8, 2) ? 'shellbug2' : 'shellbug1';
        L.sprite(ctx, sbPose, sx(SB_START - 24 * t), FEET - 12);
      } else {
        const shellX =
          t < B_KICK ? SHELL_STOMP + SKID_V * (t - B_STOMP) : SHELL_KICK + SHELL_V * (t - B_KICK);
        L.sprite(ctx, 'shell', sx(shellX), FEET - 7);
      }

      // --- 6 Super Claw'd -----------------------------------------------------------
      const hh = (pose === 'clawdJump' ? 10 : 12) * 2;
      L.sprite(ctx, pose, sx(heroX), Math.round(feet) - hh, { scale: 2 });

      // --- 7 score pops: world-anchored at the hit points, rise 8 px, then fade -----
      // y0s keep every pop above Super Claw'd's head (top 79 standing, 71 at the bounce
      // apex) for its whole life: they are world-anchored and drift left across him.
      scorePop(ctx, L, P, '+100', SHELL_STOMP + 7, camX, 66, t - B_STOMP);
      scorePop(ctx, L, P, '+200', HIT_A_X + 6, camX, 80, t - B_HIT_A);
      scorePop(ctx, L, P, '+400', HIT_B_X + 6, camX, 68, t - B_HIT_B); // above +200 (both 31 px wide)

      // --- 8 HUD ----------------------------------------------------------------------
      L.hud(ctx, { score, coins: 1, world: '1-1', time });
    },
  });
})();
