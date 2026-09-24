/*
 * 09 pipe-down — T 18.5–21.0 (dur 2.5 s), mode none, hard cut in (mid-run).
 *
 * Super Claw'd (scale 2, 32x24) runs in at world-x 1156 + 72t (screen x 64,
 * camX = world-x - 64), jumps at T 19.25 onto the tall pipe at world-x 1300
 * (4 tiles, rim top y 39), lands on the rim at T 20.25, stands one beat, then
 * sinks straight down into the pipe T 20.5–21.0. Shot ends on the empty pipe.
 *
 * Layers back to front:
 *   1 sky fill     2 cloud (world 1250,20)   3 bush (world-x 1200)
 *   4 groundStrip  5 hero (run/jump/idle)    6 pipe OVER the hero (occludes sink)
 *   7 HUD (G1: 002000, x01, TIME 235 -> 210)
 *
 * The jump: h 66 parabola y(u) = 103 - 264*u*(1-u) (constant gravity); its
 * descending branch crosses the rim top (y 39) at u = U_CUT ~ 0.5870. The arc
 * is stretched so that cut lands exactly on the T 20.25 beat — apex feet y 37
 * (66 px above takeoff), head at y 17, clear of the HUD rows 1–15 — then the
 * feet hold at 39.
 * Horizontally he glides 1210 -> 1300 so the 32-px-wide sprite lands flush on
 * the 2-tile rim. The sink is 26 px over 0.5 s, linear, one whole game px at a time (a
 * step every ~1.15 frames at 60 fps, the console's pipe crawl); the hero is drawn
 * first and the whole pipe re-blitted over him, so the rim occludes him and
 * no legs dangle below the rim tile (sprite is 24 tall, sink is 26 deep).
 *
 * NES motion: camX snaps to a whole game pixel every 60 Hz frame, so the scroll and the hero
 * move together in 1-2 px steps.
 */
(function () {
  'use strict';

  const ID = 'pipe-down';
  const N = FILM.nes;

  // Beats (local t; global T in comments)
  const B_JUMP = 0.75; // T 19.25 — takeoff
  const B_LAND = 1.75; // T 20.25 — lands on the rim
  const B_SINK = 2.0;  // T 20.5  — starts sliding down the pipe
  const SINK_DUR = 0.5;
  const SINK_PX = 26;

  // World geometry (game px)
  const X_START = 1156;  // hero world-x at t 0 (G2)
  const RUN_V = 72;      // run speed, px/s
  const X_TAKE = X_START + RUN_V * B_JUMP; // 1210 — world-x at takeoff
  const PIPE_WX = 1300;  // pipe left edge (G3)
  const X_LAND = PIPE_WX; // lands flush: sprite is 32 wide, pipe is 2 tiles
  const PIPE_TOP = 39;   // rim top y (G3)
  const PIPE_H = 4;      // tiles tall, rim included
  const GROUND = 103;    // ground top face (lib.GROUND_Y)
  const FEET_RUN = GROUND;

  // Jump parabola: y(u) = FEET_RUN - 4*H*u*(1-u), cut where it descends to the
  // rim: 103 - 264u(1-u) = 39  ->  u = (1 + sqrt(1 - 64/66)) / 2
  const JUMP_H = 66;
  const U_CUT = (1 + Math.sqrt(1 - 64 / JUMP_H)) / 2; // ~0.5870

  // Sprite heights at scale 2 (rows x 2)
  const H_RUN = 24;  // clawdRun1/2, clawdIdle: 12 rows
  const H_JUMP = 20; // clawdJump: 10 rows

  FILM.scene({
    id: ID,
    draw(ctx, tIn, info) {
      const L = info.lib, P = L.pal;
      const t = L.clamp(tIn, 0, info.dur);
      const T = info.T;

      // --- hero world-x and camera (hero pinned at screen x 64) ---
      let wx;
      if (t <= B_JUMP) wx = X_START + RUN_V * t;
      else if (t <= B_LAND) wx = L.lerp(X_TAKE, X_LAND, L.seg(t, B_JUMP, B_LAND));
      else wx = X_LAND;
      const camX = Math.round(wx) - 64; // whole game px
      const heroSX = Math.round(wx) - camX; // 64

      // 1 sky
      L.px(ctx, 0, 0, L.VW, L.VH, P.sky);

      // 2 cloud (scrolls with the world)
      L.sprite(ctx, 'cloud', 1250 - camX, 20);

      // 3 bush (background dressing on the ground line)
      L.sprite(ctx, 'bush', 1200 - camX, GROUND - 7);

      // 4 ground
      L.groundStrip(ctx, camX, camX + L.VW, camX);

      // 5 hero
      if (t < B_JUMP) {
        // mid-run from frame 0: run cycle on the global frame, feet on the ground
        L.sprite(ctx, N.runPose(info.frame, RUN_V), heroSX, FEET_RUN - H_RUN, { scale: 2 });
      } else if (t < B_LAND) {
        // the h 66 arc, cut at the rim top and remapped to land on B_LAND
        const u = L.seg(t, B_JUMP, B_LAND) * U_CUT;
        const feet = FEET_RUN - 4 * JUMP_H * u * (1 - u);
        L.sprite(ctx, 'clawdJump', heroSX, feet - H_JUMP, { scale: 2 });
      } else {
        // standing on the rim, then the steady slide down into the pipe
        const sink = Math.floor(SINK_PX * L.seg(t, B_SINK, B_SINK + SINK_DUR)); // linear, whole px
        L.sprite(ctx, 'clawdIdle', heroSX, PIPE_TOP - H_RUN + sink, { scale: 2 });
      }

      // 6 pipe OVER the hero: the rim occludes him as he sinks; by t 2.46 he is
      // fully behind it and the shot ends on the empty pipe
      L.pipe(ctx, PIPE_WX - camX, PIPE_TOP, PIPE_H);

      // 7 HUD (G1: score 002000, coins x01, TIME 235 at T 18.5 ticking -10/s)
      L.hud(ctx, {
        score: 2000,
        coins: 1,
        world: '1-1',
        time: 400 - Math.floor((T - 2.0) * 10),
      });
    },
  });
})();
