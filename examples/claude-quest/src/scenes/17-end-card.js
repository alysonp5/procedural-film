// Shot 17 — end-card (T 38.0–40.0, dur 2.0 s, 120 frames at 60 fps)
// The title card (shot 01) revisited so the film loops: the same attract screen over the level —
// plaque, level plate, no HUD — with the princess beside Claw'd and the run's score on the TOP line.
// Layers, back to front:
//   1. level plate: sky, clouds (60, 18) and (180, 30), hill at x 24, bush at x 130, ground strip
//   2. the title plaque (lib.titlePlaque, scale 3, x 45–194, y 4–57), already landed: the cut on T 38.0
//      is the title-jingle reprise
//   3. "GAME COMPLETE" types on local 0.5–1.0 at y 61 (where the © line sits on the title)
//   4. "PRESS START TO PLAY AGAIN" (y 71) blinks on 8ths from local 1.0; "TOP- 017500" (y 81)
//   5. Claw'd (clawdIdle, x 168) and Princess Pearl (x 196), feet on the ground (y 103), a 1 px bob
//      every 8th (15 frames), anti-phase; she waves every other half second
//   6. one heart in the gap between them — rises 6 px per 1 s loop, flickers out at the top
// Nothing blends: every pixel is a palette colour on whole game pixels.
(function () {
  'use strict';
  const ID = 'end-card';

  const LINES = ['CLAUDE', 'QUEST'];
  const PLAQUE = { scale: 3, pad: 4, gap: 3 }; // same plaque as shot 01
  const SUB = 'GAME COMPLETE'; // 13 glyphs, 103 px
  const AGAIN = 'PRESS START TO PLAY AGAIN'; // 25 glyphs, 199 px
  const TOP = 'TOP- 017500'; // the score the run ended on (shot 16)
  const CLAWD_X = 168, PEARL_X = 196;

  FILM.scene({
    id: ID,
    draw(ctx, tIn, info) {
      const L = info.lib,
        P = L.pal,
        N = FILM.nes;
      const t = L.clamp(tIn, 0, info.dur);
      const f = N.frameOf(t); // shot-local frame (60 fps)
      const GY = L.GROUND_Y;

      // 1. level plate (the title's)
      L.px(ctx, 0, 0, L.VW, L.VH, P.sky);
      L.sprite(ctx, 'cloud', 60, 18);
      L.sprite(ctx, 'cloud', 180, 30);
      L.sprite(ctx, 'hill', 24, GY - 10);
      L.sprite(ctx, 'bush', 130, GY - 7);
      L.groundStrip(ctx, -16, L.VW + 16, 0);

      // 2. the plaque
      L.titlePlaque(ctx, 120, 4, LINES, PLAQUE);

      // 3. GAME COMPLETE: fixed-slot type-on (letters never recentre), T 0.5–1.0,
      //    first glyph on the beat frame
      const nSub = L.clamp(Math.floor(((f - 30 + 1) * SUB.length) / 30), 0, SUB.length);
      if (nSub > 0) {
        const gx = 120 - Math.floor(L.pxtextWidth(SUB, 1) / 2);
        L.pxtext(ctx, SUB.slice(0, nSub), gx, 61, { color: P.brickHi });
      }

      // 4. PRESS START TO PLAY AGAIN: on/off every 8th (15 frames) from t 1.0; the TOP line holds
      if (t >= 1.0 && N.step(f - 60, 15, 2) === 0) {
        L.pxtext(ctx, AGAIN, 120, 71, { align: 'center', color: P.hudWhite });
      }
      L.pxtext(ctx, TOP, 120, 81, { align: 'center', color: P.hudWhite });

      // 5. the couple: 1 px bob every 8th, anti-phase so they take turns — a little dance
      const bobC = N.step(f, 15, 2) === 1 ? -1 : 0;
      L.sprite(ctx, 'clawdIdle', CLAWD_X, GY - 12 + bobC);
      const pName = Math.floor(t * 2 + 1e-6) % 2 === 1 ? 'princessWave' : 'princess';
      L.sprite(ctx, pName, PEARL_X, GY - 14 - 1 - bobC);

      // 6. the heart: 1 s loop in the gap between them (x 186–193); rises 6 px from y 84 and
      //    flickers out (2 frames on, 2 off) over the top of its climb
      const u = t - Math.floor(t);
      const shown = u < 0.55 || (u < 0.85 && N.step(f, 2, 2) === 0);
      if (shown) L.sprite(ctx, 'heart', 186 + Math.round(Math.sin(u * Math.PI * 2)), 84 - 6 * u);
    },
  });
})();
