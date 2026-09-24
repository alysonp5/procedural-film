// Shot 10 — cave: "Underground" (T 21.0–24.0, dur 3.0 s; transitionIn fade 0.25 handled by core as
// an NES palette fade, frame 0 is fully drawn). A separate cave room: hero world-x starts at 24 (G2).
// 60 fps: camX snaps to a whole game pixel every frame; coins spin on their own 8-frame cadence
// (lib.coinSpin at 7.5 drawings/s).
// Layers, back to front:
//   1. caveBlack fill
//   2. cave-brick ceiling, 2 tiles deep (tileBrickCave, y 0–31), world-locked
//   3. cave ground strip (tileGroundCave, rows y 103 and 119), world-locked
//   4. five coins in a low arc + 8-frame collect sparkles
//   5. one patrolling bug (world-x ~300, walking left at 24 px/s)
//   6. Super Claw'd (scale 2, run cycle on the global frame; hop over the bug at local 2.5)
//   7. HUD (screen-fixed)
(function () {
  'use strict';
  const ID = 'cave';
  const N = FILM.nes;

  // World layout (storyboard G1/G2 + shot 10)
  const RUN = 72; // run speed, game px/s (1.2 px a frame at 60 fps)
  const HERO_X0 = 24; // cave room: hero world-x at t 0
  const GROUND_TOP = 103; // lib.GROUND_Y
  const ANCHOR = 64; // hero screen-x anchor once running

  // Five coins, a shallow arc; collected exactly on beats T 21.5–23.5 (local 0.5–2.5).
  const COINS = [
    { x: 60, y: 71 },
    { x: 96, y: 63 },
    { x: 132, y: 55 },
    { x: 168, y: 63 },
    { x: 204, y: 71 },
  ];
  const B_COIN = [0.5, 1.0, 1.5, 2.0, 2.5]; // local beats: T 21.5, 22.0, 22.5, 23.0, 23.5
  const SPARKLE_S = 8 / 60; // collect pop: sparkle sprite for 8 frames

  // Bug patrol
  const BUG_X0 = 300; // world-x at t 0
  const BUG_V = 24; // walks left, game px/s

  // The hop over the bug: local 2.5 (T 23.5), h 24, 0.5 s of air, lands as the shot ends.
  const B_HOP = 2.5; // T 23.5
  const HOP_H = 24;
  const HOP_A = 0.5; // s (30 frames)

  // HUD state (G1 row 10): start 002000 / ×01; +100 and +1 coin on each of the five beats.
  const SCORE0 = 2000;
  const COINS0 = 1;

  const COIN_FPS = 7.5; // a new spin drawing every 8 frames

  FILM.scene({
    id: ID,
    draw(ctx, tIn, info) {
      const L = info.lib, P = L.pal;
      const t = L.clamp(tIn, 0, info.dur);

      // Hero on the world: runs the whole shot (keeps speed through the hop).
      const heroWX = Math.round(HERO_X0 + RUN * t); // whole game px
      const camX = Math.max(0, heroWX - ANCHOR);
      const heroSX = heroWX - camX;

      // Hop parabola (art bible 7.2): y(u) = y0 - 4*h*u*(1-u), u over A frames.
      const hopping = t >= B_HOP && t < B_HOP + HOP_A;
      let feetY = GROUND_TOP;
      if (hopping) {
        const u = (t - B_HOP) / HOP_A;
        feetY = GROUND_TOP - 4 * HOP_H * u * (1 - u);
      }

      // 1. Underground plate: flat caveBlack.
      L.px(ctx, 0, 0, L.VW, L.VH, P.caveBlack);

      // 2 + 3. Ceiling (2 tiles deep, y 0–31) and cave ground (rows y 103/119) across the
      // visible world range. L.groundStrip always uses tileGround, so lay tileGroundCave by hand.
      const ti0 = Math.floor(camX / 16);
      const ti1 = Math.ceil((camX + L.VW) / 16);
      for (let ti = ti0; ti <= ti1; ti++) {
        const gx = ti * 16 - camX;
        if (gx < -16 || gx > L.VW) continue;
        L.sprite(ctx, 'tileBrickCave', gx, 0);
        L.sprite(ctx, 'tileBrickCave', gx, 16);
        L.sprite(ctx, 'tileGroundCave', gx, GROUND_TOP);
        L.sprite(ctx, 'tileGroundCave', gx, GROUND_TOP + 16);
      }

      // 4. Coins: spin, 8 frames a drawing, keyed to global T; on the collect beat each vanishes
      // with an 8-frame sparkle pop at its spot.
      const coinName = L.coinSpin(info.T, COIN_FPS);
      let collected = 0;
      for (let i = 0; i < COINS.length; i++) {
        const c = COINS[i];
        const beat = B_COIN[i];
        if (t >= beat) collected++;
        const sx = c.x - camX;
        if (sx < -16 || sx > L.VW + 8) continue;
        if (t < beat) {
          L.sprite(ctx, coinName, sx, c.y);
        } else if (t < beat + SPARKLE_S) {
          L.sprite(ctx, 'sparkle', sx, c.y + 3); // 8×8 sparkle centred on the coin's middle
        }
      }

      // 5. The patrolling bug, walking left with a 2-frame step.
      const bugSX = Math.round(BUG_X0 - BUG_V * t) - camX;
      if (bugSX > -16 && bugSX < L.VW + 8) {
        L.sprite(ctx, N.step(info.frame, 8, 2) ? 'bug2' : 'bug1', bugSX, GROUND_TOP - 9);
      }

      // 6. Super Claw'd: run cycle, clawdJump while airborne, scale 2 (32×24 / 32×20).
      if (hopping) {
        L.sprite(ctx, 'clawdJump', heroSX, feetY - 20, { scale: 2 });
      } else {
        L.sprite(ctx, N.runPose(info.frame, RUN), heroSX, GROUND_TOP - 24, { scale: 2 });
      }

      // 7. HUD (G1): score 002000 → 002500, coins ×01 → ×06, TIME 210 ticking −10/s from T 2.0.
      L.hud(ctx, {
        score: SCORE0 + 100 * collected,
        coins: COINS0 + collected,
        time: 400 - Math.floor((info.T - 2.0) * 10 + 1e-6),
      });
    },
  });
})();
