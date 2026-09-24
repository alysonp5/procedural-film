// Shot 01 'title' — T 0–2.0 s (dur 2.0), 60 fps, 120 bpm (beat 30 f, 8th 15 f). Opens the film; hard cut
// out at T 2.0 into shot 02, which starts on this same level screen (same sky, clouds, hill, bush and
// Claw'd at x 24), so pressing START simply drops the title layer and pops the HUD on.
//
// An attract screen in the console grammar: the title plaque over the live level, no HUD. Layers,
// back to front:
//   1. level plate: sky, clouds (60, 18) and (180, 30), hill at x 24, bush at x 130, ground strip
//   2. Claw'd idle at x 24, feet y 103 (shot 02's frame-0 pose)
//   3. the title plaque (lib.titlePlaque, scale 3): CLAUDE / QUEST on a raised brick-orange board with
//      a pale bevel top/left, a dark edge bottom/right and four rivets, x 45–194, y 4–57. It falls in
//      under constant gravity and lands on the T 0.5 title-jingle hit with a 2 px bump.
//   4. from the landing: '©2026 CLAWD SOFT' right-aligned under the plaque (y 61), the menu
//      1 PLAYER GAME (y 71) / 2 PLAYER GAME (y 80) with a mini-mushroom cursor blinking beside
//      1 PLAYER on 8ths, and TOP- 000000 (y 89)
//   5. sparkle pops on the plaque's top-left (T 1.0) and top-right (T 1.5) corners, flickering out
//
// Every colour is a lib.pal key; nothing is blended (no alpha): pops flicker, the console way.
(function () {
  'use strict';

  const ID = 'title';

  // plaque geometry (game px): scale-3 lines, pad 4, gap 3 -> 150 x 54, centred on x 120
  const LINES = ['CLAUDE', 'QUEST'];
  const PLAQUE = { scale: 3, pad: 4, gap: 3 };
  const PCX = 120, PY_REST = 4, PH = 54, PW = 150;
  const PX0 = PCX - PW / 2; // 45
  const LAND = 0.5; // T 0.5 title-jingle hit
  const DROP = PY_REST + PH + 1; // starts fully above the frame
  const G = (2 * DROP) / (LAND * LAND); // constant gravity that covers DROP from rest in LAND s
  const BUMP_S = 8 / 60; // 8-frame landing bump
  const BUMP_H = 2;

  // menu (game px); glyphs are 7 tall in 8-px cells
  const COPY_Y = 61, MENU_Y1 = 71, MENU_Y2 = 80, TOP_Y = 89;
  const MENU_TXT1 = '1 PLAYER GAME', MENU_TXT2 = '2 PLAYER GAME', TOP_TXT = 'TOP- 000000', COPY_TXT = '©2026 CLAWD SOFT';

  // the menu cursor: a 5x5 mini sparkle-mushroom (cap, spots, stem)
  const CURSOR = ['.CCC.', 'CSCSC', 'CCCCC', '.MMM.', '.MMM.'];

  function glyph(ctx, L, rows, gx, gy, colours) {
    for (let y = 0; y < rows.length; y++) {
      for (let x = 0; x < rows[y].length; x++) {
        const c = colours[rows[y][x]];
        if (c) L.px(ctx, gx + x, gy + y, 1, 1, c);
      }
    }
  }

  FILM.scene({
    id: ID,
    draw(ctx, tIn, info) {
      const L = info.lib, P = L.pal, N = FILM.nes;
      const t = L.clamp(tIn, 0, info.dur);
      const f = N.frameOf(t); // shot-local frame (60 fps)
      const GY = L.GROUND_Y;

      // 1. level plate (shot 02's opening screen, camX 0)
      L.px(ctx, 0, 0, L.VW, L.VH, P.sky);
      L.sprite(ctx, 'cloud', 60, 18);
      L.sprite(ctx, 'cloud', 180, 30);
      L.sprite(ctx, 'hill', 24, GY - 10);
      L.sprite(ctx, 'bush', 130, GY - 7);
      L.groundStrip(ctx, -16, L.VW + 16, 0);

      // 2. Claw'd, standing where shot 02 starts him
      L.sprite(ctx, 'clawdIdle', 24, GY - 12);

      // 3. the plaque falls in (y = y0 + g t^2 / 2), lands on T 0.5 and bumps 2 px
      let py;
      if (t < LAND) py = PY_REST - DROP + 0.5 * G * t * t;
      else if (t < LAND + BUMP_S) py = N.arc(PY_REST, BUMP_H, (t - LAND) / BUMP_S);
      else py = PY_REST;
      py = Math.round(py);
      if (py > -PH) L.titlePlaque(ctx, PCX, py, LINES, PLAQUE);

      // 4. the rest of the attract screen appears with the landing
      if (t >= LAND) {
        L.pxtext(ctx, COPY_TXT, PX0 + PW, COPY_Y, { color: P.brickHi, align: 'right' }); // under the plaque's right edge
        const mx = PCX - Math.floor(L.pxtextWidth(MENU_TXT1, 1) / 2);
        L.pxtext(ctx, MENU_TXT1, mx, MENU_Y1, { color: P.hudWhite });
        L.pxtext(ctx, MENU_TXT2, mx, MENU_Y2, { color: P.hudWhite });
        L.pxtext(ctx, TOP_TXT, PCX, TOP_Y, { color: P.hudWhite, align: 'center' });

        // cursor blinks on 8ths (15 frames on, 15 off), on from the landing frame
        if (N.step(f - N.frameOf(LAND), 15, 2) === 0) {
          glyph(ctx, L, CURSOR, mx - 9, MENU_Y1 + 1, { C: P.clawdOrange, S: P.sparkle, M: P.pearlCream });
        }
      }

      // 5. sparkle pops on the plaque corners: 24 frames, steady for 12, then flickering on 2s
      const pops = [
        { at: 1.0, x: PX0 - 4, y: PY_REST - 4 },
        { at: 1.5, x: PX0 + PW - 4, y: PY_REST - 4 },
      ];
      for (const p of pops) {
        const k = f - N.frameOf(p.at);
        if (k < 0 || k >= 24) continue;
        if (k < 12 || N.step(k, 2, 2) === 0) L.sprite(ctx, 'sparkle', p.x, p.y);
      }
    },
  });
})();
