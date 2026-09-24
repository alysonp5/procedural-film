// 07 stairs — T 13.5–16.0 (dur 2.5 s), mode none, hard cut in/out (mid-run).
//
// Super Claw'd hops up a tileBlock staircase on the beat: four hops at local 0.5 / 1.0 / 1.5 /
// 2.0 (T 14.0–15.5), each h 28 over 0.5 s (30 frames), landing on the next column's top just
// before the next beat; he ends standing on the plateau deck. The camera scrolls right at 72 px/s
// with the hero anchored at screen x 64 (camX = hero world-x − 64, a whole game pixel each frame).
//
// Layers, back to front:
//   1. sky fill
//   2. scenery: cloud (world 950, 18 — below the HUD rows 1–15), hill (world-x 1120, base on the ground line)
//   3. ground strip (runs the full width, underneath the staircase)
//   4. staircase: tileBlock columns at world-x 880 / 912 / 944 / 976 plus plateau 1008–1040,
//      every column 2 tiles wide and filled from its top down to the ground's top face
//   5. Super Claw'd (scale 2, 32×24): run frames on surfaces, clawdJump airborne, idle at the end
//   6. HUD (G1: score 001300, ×01, TIME 285 at T 13.5 ticking 10/s)
(function () {
  'use strict';
  const ID = 'stairs';

  // Run continuity (G2): world-x = 816 + 72·t; 1.2 game px a frame at 60 fps.
  const RUN_V = 72; // game px/s
  const X0 = 816; // world-x at local t 0 (T 13.5)
  const GROUND = 103; // lib.GROUND_Y: the ground strip's top face
  const N = FILM.nes;

  // Staircase: 2-tile-wide tileBlock columns (tiles are 16 game px), filled from the column top
  // down to the ground's top face. Tops: 1/2/3/4 tiles high, then the plateau at 4 high.
  const COLS = [
    { x: 880, top: 87 }, // 1 high
    { x: 912, top: 71 }, // 2 high
    { x: 944, top: 55 }, // 3 high
    { x: 976, top: 39 }, // 4 high
    { x: 1008, top: 39 }, // plateau, 4 high (runs to world-x 1040)
  ];

  // Four hops (G4): take off on the beats, h 28, air 0.5 s (30 frames), from each surface to the
  // next column's top. The last hop is h 19: at h 28 its apex (feet 27) puts the 20-px jump sprite's
  // top at y 7, inside the HUD rows 1–15; h 19 peaks with his head at y 16, clear of them.
  const HOP_AIR = 0.5; // 30 frames at 60 fps
  const HOPS = [
    { b: 0.5, y0: 103, y1: 87, h: 28 }, // T 14.0: ground -> step 1
    { b: 1.0, y0: 87, y1: 71, h: 28 }, //  T 14.5: step 1 -> step 2
    { b: 1.5, y0: 71, y1: 55, h: 28 }, //  T 15.0: step 2 -> step 3
    { b: 2.0, y0: 55, y1: 39, h: 19 }, //  T 15.5: step 3 -> step 4 / plateau deck
  ];
  // An h parabola lands back at its own start height at u = 1, so a step UP (a 16 px rise) is
  // cut short where y(u) meets the step top: 4·h·u·(1−u) = 16 → u = (1 + √(1 − 16/h)) / 2 (the
  // descending root: ≈ 0.8273 at h 28, ≈ 0.6987 at h 19). It keeps him airborne until he is
  // actually over the next column (touchdowns at world-x ≈ 882 / 918 / 954 / 985 — inside their
  // columns at 880–912 / 912–944 / 944–976 / 976–1008), before each next beat's takeoff; from
  // u_land on he stands on the step top. The ascending root would hover him 16 px above the lower
  // surface short of the column, so it is never used.
  const uLand = (h) => (1 + Math.sqrt(1 - 16 / h)) / 2;
  const T_STOP = HOPS[3].b + uLand(HOPS[3].h) * HOP_AIR; // ≈ 2.349: final touchdown — he stops and stands

  // Hero pose at local t: { x (world-x of the sprite's left edge), y (feet), airborne, idle }.
  function heroAt(t) {
    const x = Math.round(X0 + RUN_V * Math.min(t, T_STOP)); // whole game px; frozen once he stands on the plateau deck
    let y = GROUND;
    let airborne = false;
    let idle = false;
    for (let i = 0; i < HOPS.length; i++) {
      const hp = HOPS[i];
      if (t < hp.b) break; // standing on the previous surface, waiting for the beat
      const u = (t - hp.b) / HOP_AIR;
      if (u < uLand(hp.h)) {
        y = N.arc(hp.y0, hp.h, u); // the storyboard parabola (constant gravity)
        airborne = true;
        break;
      }
      y = hp.y1; // touched down on the next column's top
      if (i === HOPS.length - 1) idle = true;
    }
    return { x, y, airborne, idle };
  }

  FILM.scene({
    id: ID,
    draw(ctx, tIn, info) {
      const L = info.lib;
      const P = L.pal;
      const t = L.clamp(tIn, 0, info.dur); // transitions may ask past dur: hold the final pose

      const hero = heroAt(t);
      const camX = hero.x - 64; // hero anchors at screen x 64 (run-shot convention)

      // 1. sky
      L.px(ctx, 0, 0, 240, 135, P.sky);

      // 2. scenery (world-locked, scrolls with the camera)
      L.sprite(ctx, 'cloud', 950 - camX, 18);
      L.sprite(ctx, 'hill', 1120 - camX, GROUND - 10); // hill sprite is 24×10, base on the ground

      // 3. ground strip, full width (the staircase sits on it)
      L.groundStrip(ctx, camX - 16, camX + 240 + 16, camX);

      // 4. staircase + plateau: 2-tile-wide columns, filled from each top down to the ground
      for (const c of COLS) {
        for (let w = 0; w < 2; w++) {
          const gx = c.x + w * 16 - camX;
          if (gx < -16 || gx > 240) continue;
          for (let gy = c.top; gy < GROUND; gy += 16) L.sprite(ctx, 'tileBlock', gx, gy);
        }
      }

      // 5. Super Claw'd (scale 2): feet on the current surface, jump sprite only while airborne
      const SC = 2;
      let name;
      let hgt; // sprite heights at scale 2: clawdJump is 10 rows, the stand/run frames are 12
      if (hero.airborne) {
        name = 'clawdJump';
        hgt = 10 * SC;
      } else if (hero.idle) {
        name = 'clawdIdle';
        hgt = 12 * SC;
      } else {
        name = N.runPose(info.frame, RUN_V); // run cycle on the global frame (FILM.nes)
        hgt = 12 * SC;
      }
      L.sprite(ctx, name, hero.x - camX, hero.y - hgt, { scale: SC });

      // 6. HUD (G1): score 001300, ×01, TIME 285 at T 13.5, ticking 10 per second
      L.hud(ctx, { score: 1300, coins: 1, world: '1-1', time: 400 - Math.floor((info.T - 2.0) * 10) });
    },
  });
})();
