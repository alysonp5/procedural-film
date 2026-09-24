// Shot 15 — throne (T 32.0–35.0, dur 3.0 s, 60 fps). transitionIn fade 0.25 handled by core as an
// NES palette fade. Positions are whole game pixels each frame; nothing blends (pops flicker out).
// Screen-fixed castle interior (no camera): Claw'd walks in from the left, sees Princess
// Pearl waiting on her pedestal, she hops with joy and waves, hearts rise between them.
//
// Layers, back to front:
//   1. caveBlack hall fill
//   2. floor — tileGroundCastle rows at y 103 and y 119, full width (16 px pitch)
//   3. wall pillars — tileBlockCastle, 2 tiles wide, at x 32 and x 200, y 39 → floor
//   4. torch flames on each pillar's inner face (2-shape flicker, 8 frames a shape, L.px)
//   5. pedestal — 3 ascending tileBlockCastle steps (tops y 99 / 95 / 91)
//   6. Princess Pearl — princess → princessWave, two 20-frame joy hops (h 8)
//   7. Claw'd (Super, scale 2) — walks in (run cycle on the global frame), stops at centre x 130, idle
//   8. "!" pxtext scale 2 pop above his head (local 1.0: 10-frame pop, hold, flickers out by 2.0)
//   9. three hearts rising between them (local 2.0 / 2.25 / 2.5, 14 px over 1 s, flickering out)
//  10. HUD — score 007500, ×06, TIME held at 100 (the game has ended — no tick-down)

(() => {
  'use strict';
  const ID = 'throne';
  const N = FILM.nes;

  FILM.scene({
    id: ID,
    draw(ctx, tIn, info) {
      const L = info.lib, P = L.pal;
      const t = L.clamp(tIn, 0, info.dur);

      // --- beat times (shot-local seconds; global = local + 32.0) ---
      const T_SEE = 1.0;    // T 33.0 — the "!" pops above his head
      const T_STOP = 1.5;   // T 33.5 — he reaches x 130 and stops; her first hop
      const T_HOP2 = 2.0;   // T 34.0 — her second hop, princessWave from here, hearts start
      const HOP_A = 1 / 3; // 20-frame parabola

      // --- hero state (needed by both his sprite and the "!") ---
      const HCX0 = -16;  // centre starts off-screen left: frame 0 hall is empty of hero
      const HCX1 = 130;  // centre stops here, idle, facing her
      const walking = t < T_STOP;
      const hcx = Math.round(walking ? L.lerp(HCX0, HCX1, t / T_STOP) : HCX1); // whole game px
      const hName = walking ? N.runPose(info.frame, (HCX1 - HCX0) / T_STOP) : 'clawdIdle';

      // 1. hall (the game screen is 240×135 game px)
      L.px(ctx, 0, 0, 240, 135, P.caveBlack);

      // 2. floor
      for (let x = 0; x < 240; x += 16) {
        L.sprite(ctx, 'tileGroundCastle', x, 103);
        L.sprite(ctx, 'tileGroundCastle', x, 119);
      }

      // 3. pillars (y 39 down to the floor: 4 rows of 2 tiles)
      for (const px0 of [32, 200]) {
        for (let ty = 39; ty < 103; ty += 16) {
          L.sprite(ctx, 'tileBlockCastle', px0, ty);
          L.sprite(ctx, 'tileBlockCastle', px0 + 16, ty);
        }
      }

      // 4. torches — 4×6 fireOrange blob + 2×3 fireYellow core, two flicker shapes, 8 frames each
      const flame = (fx, fy, f) => {
        const rows = f
          ? ['..O.', '.OO.', '.OOO', 'OOOO', 'OOO.', '.OO.']
          : ['.OO.', '.OO.', 'OOOO', 'OOOO', 'OOOO', '.OO.'];
        for (let y = 0; y < 6; y++)
          for (let x = 0; x < 4; x++)
            if (rows[y][x] === 'O') L.px(ctx, fx + x, fy + y, 1, 1, P.fireOrange);
        L.px(ctx, fx + 1, fy + (f ? 3 : 2), 2, 3, P.fireYellow); // core
        L.px(ctx, fx + 1, fy + 6, 2, 2, P.castleDeep);           // wall sconce
      };
      const tf = N.step(info.frame, 8, 2);
      flame(64, 68, tf);      // left pillar's inner face
      flame(196, 68, tf ^ 1); // right pillar's inner face, opposite phase

      // 5. pedestal — steps ascending toward her, tops y 99 / 95 / 91, each 2×1 tiles
      for (const step of [[138, 99], [154, 95], [170, 91]]) {
        L.sprite(ctx, 'tileBlockCastle', step[0], step[1]);
        L.sprite(ctx, 'tileBlockCastle', step[0] + 16, step[1]);
      }

      // 6. Princess Pearl — feet planted on the top step (feet y 91); hops at T 33.5 / 34.0
      const hop = (t0) => {
        const u = (t - t0) / HOP_A;
        return u >= 0 && u <= 1 ? 4 * 8 * u * (1 - u) : 0;
      };
      const pdy = Math.max(hop(T_STOP), hop(T_HOP2));
      L.sprite(ctx, t >= T_HOP2 ? 'princessWave' : 'princess', 163, 77 - pdy);

      // 7. Claw'd — Super (scale 2, 32×24), feet y 103, faces right (toward her)
      L.sprite(ctx, hName, hcx - 16, 79, { scale: 2 });

      // 8. "!" — 10-frame pop from local 1.0 (small, overshoot, settle), holds, then flickers
      //    out on 2-frame beats over the last 8th before 2.0
      if (t >= T_SEE && t < 2.0) {
        const d = N.frameOf(t - T_SEE); // frames since the pop started
        const shown = t < 1.75 || N.step(d, 2, 2) === 0;
        if (shown && d < 5) {
          L.pxtext(ctx, '!', hcx, 71, { scale: 1, align: 'center', color: P.hudWhite });
        } else if (shown) {
          L.pxtext(ctx, '!', hcx, d < 10 ? 65 : 66, { scale: 2, align: 'center', color: P.hudWhite });
        }
      }

      // 9. hearts — spawn x ≈ 148/156/152 at y 88, rise 14 px over 1 s, ±2 px sine wobble,
      //    flickering out (2 frames on, 2 off) over their last 0.4 s
      const HX = [148, 156, 152], HT = [2.0, 2.25, 2.5];
      for (let i = 0; i < 3; i++) {
        const u = (t - HT[i]) / 1.0;
        if (u < 0 || u >= 1) continue;
        if (u >= 0.6 && N.step(N.frameOf(t - HT[i]), 2, 2) === 1) continue;
        const hx = HX[i] + Math.sin(u * Math.PI * 2 + i * 2.1) * 2;
        L.sprite(ctx, 'heart', hx, 88 - 14 * u);
      }

      // 10. HUD — TIME held at 100 (inside the castle the countdown has stopped)
      L.hud(ctx, { score: 7500, coins: 6, world: '1-1', time: 100 });
    },
  });
})();
