// Shot 16 — thanks (T 35.0–38.0, dur 3.0 s, 180 frames at 60 fps) · mode none · hard cut in/out.
// The rescue celebration in the throne room (same castle-interior room as shot 15,
// screen-fixed). "THANK YOU CLAW'D!" types on, the +10000 rescue bonus pops and the
// score rolls to 017500, sparkle bursts frame the pair while Claw'd (Super) and
// Princess Pearl trade joy hops on alternating 8ths.
//
// Layers, back to front:
//    1. caveBlack fill
//    2. wall pillars: tileBlockCastle stacks at x 32 and x 200, y 55–103 (kept below the text lines)
//    3. floor: tileGroundCastle rows y 103 and y 119, full width
//    4. torch flames on the pillar tops — 2-shape flicker, 8 frames a shape, alternating phase
//       (fireOrange 4×6 blob + fireYellow 2×3 core)
//    5. Claw'd (Super, scale 2, centre x 96) and Princess Pearl (centre x 128), feet y 103,
//       apex-locked joy hops h 6, 20-frame parabolas, Pearl offset 0.25 s (they take turns)
//    6. sparkle bursts: 6-sparkle radials at T 36.5 (70,60), T 37.0 (170,55), T 37.5 (120,48),
//       flying out 14 px over 20 frames, flickering out over the last 10 (no fades on the console)
//    7. "+10000" pxtext pop above the pair at T 36.0 — rises 8 px over 30 frames, holds, vanishes
//    8. text: "THANK YOU CLAW'D!" scale 1 centred x 120, y 27 (types on local 0–0.5 s);
//       "THE PRINCESS IS SAVED!" scale 1 centred x 120, y 39 (types on local 0.5–1.0 s) —
//       the 8x8 console font, one line each, like the game's own castle message
//    9. HUD (G1: score 007500 → 017500 at T 36.0, ×06, TIME HELD at 70)
//
// Notes for reviewers:
//   - Hop windows are ±10 frames around the apex, apexes locked to the beat grid (Claw'd on
//     beats 0/0.5/1.0/…, Pearl on the 8ths 0.25/0.75/…), so frame 0 opens with Claw'd at
//     the top of his hop and Pearl lifts off 5 frames later — the bounce is already running.
//   - Pillar tops sit at y 55 so the flames (y 49–54) sit below the second text line (y 39–45):
//     at 175 px it is wider than the gap between the pillars.
//   - The font now has a '+' glyph (lib FONT), so the pop is one pxtext call, not the
//     hand-drawn plus used in shots 03/05 (which predate the glyph).
(function () {
  'use strict';

  const ID = 'thanks';
  const N = FILM.nes;
  const BEAT_F = 30; // frames per beat at 60 fps

  // Beat constants, shot-local seconds.
  const B_POP = 1.0; // T 36.0  "+10000" pop; HUD score rolls 007500 → 017500
  const BURSTS = [1.5, 2.0, 2.5]; // T 36.5 / 37.0 / 37.5 sparkle bursts
  const BURST_AT = [
    [70, 60],
    [170, 55],
    [120, 48],
  ];

  const FEET = 103; // floor top face (lib.GROUND_Y)
  const HOP_H = 6; // joy-hop apex height (game px)
  const HOP_AIR = 1 / 3; // 20-frame parabola
  const BURST_S = 1 / 3; // 20 frames
  const HOP_HALF = HOP_AIR / 2;

  const L1 = "THANK YOU CLAW'D!"; // 17 glyphs: scale-1 width 135, centred at x 120
  const L2 = 'THE PRINCESS IS SAVED!'; // 22 glyphs: scale-1 width 175, centred at x 120
  const PILLAR_TOP = 55;

  // Apex-locked hop: airborne inside ±10 frames of an apex; apexes every beat (0.5 s)
  // starting at `phase`. Returns feet y (game px). Deterministic from t alone.
  function hopFeet(t, phase) {
    const k = Math.round((t - phase) / 0.5);
    const dt = t - (phase + k * 0.5);
    if (Math.abs(dt) > HOP_HALF) return FEET;
    const u = (dt + HOP_HALF) / HOP_AIR;
    return FEET - 4 * HOP_H * u * (1 - u);
  }

  FILM.scene({
    id: ID,
    draw(ctx, tIn, info) {
      const L = info.lib,
        P = L.pal;
      const t = L.clamp(tIn, 0, info.dur);
      const f = N.frameOf(t); // shot-local frame

      // ------------------------------------------------ 1. caveBlack hall
      L.px(ctx, 0, 0, L.VW, L.VH, P.caveBlack);

      // ------------------------------------------------ 2. wall pillars (x 32, x 200)
      for (const px of [32, 200]) {
        for (let y = PILLAR_TOP; y < FEET; y += 16) L.sprite(ctx, 'tileBlockCastle', px, y);
      }

      // ------------------------------------------------ 3. floor (rows y 103 / 119)
      for (let x = 0; x < L.VW; x += 16) {
        L.sprite(ctx, 'tileGroundCastle', x, FEET);
        L.sprite(ctx, 'tileGroundCastle', x, FEET + 16);
      }

      // ------------------------------------------------ 4. torch flames (2 shapes, 8 frames each)
      // Alternating phase between the two torches; the 2-px tip leans on the off frame.
      for (let i = 0; i < 2; i++) {
        const cx = [40, 208][i]; // pillar centres (32+8, 200+8)
        const base = PILLAR_TOP; // flame base sits on the pillar top
        const ph = N.step(info.frame + 8 * i, 8, 2);
        L.px(ctx, cx - 2, base - 5, 4, 5, P.fireOrange); // 4-wide body, y 50–54
        L.px(ctx, cx - 1 + ph, base - 6, 2, 1, P.fireOrange); // leaning tip, y 49
        L.px(ctx, cx - 1, base - 3, 2, 3, P.fireYellow); // 2×3 core, y 52–54
      }

      // ------------------------------------------------ 5. the pair
      // Claw'd: Super (scale 2, 32×24 / jump 32×20), centre x 96 → left edge 80.
      const cf = hopFeet(t, 0);
      const cAir = cf < FEET - 0.01;
      const cPose = cAir ? 'clawdJump' : 'clawdIdle';
      L.sprite(ctx, cPose, 96 - 16, cf - (cAir ? 20 : 24), { scale: 2 });

      // Princess Pearl: 14×14, centre x 128 → left edge 121; offset 0.25 s so they take turns.
      const pf = hopFeet(t, 0.25);
      L.sprite(ctx, pf < FEET - 0.01 ? 'princessWave' : 'princess', 128 - 7, pf - 14);

      // ------------------------------------------------ 6. sparkle bursts
      for (let i = 0; i < 3; i++) {
        if (t < BURSTS[i] || t >= BURSTS[i] + BURST_S) continue;
        const k = N.frameOf(t - BURSTS[i]); // frames since the burst
        if (k >= 10 && N.step(k, 2, 2) === 1) continue; // flicker out
        const bx = BURST_AT[i][0],
          by = BURST_AT[i][1];
        const r = 14 * L.seg(t, BURSTS[i], BURSTS[i] + BURST_S, 'outQuad');
        for (let j = 0; j < 6; j++) {
          const ang = (j * Math.PI) / 3 + Math.PI / 6; // 6-way radial, 30° offset
          L.sprite(ctx, 'sparkle', bx + Math.cos(ang) * r - 4, by + Math.sin(ang) * r - 4);
        }
      }

      // ------------------------------------------------ 7. "+10000" pop (T 36.0)
      // Centred x 112 (midpoint of the pair), starts above his hop-apex head (top 73),
      // rises 8 px over 30 frames, holds 15, then vanishes.
      if (t >= B_POP) {
        const k = N.frameOf(t - B_POP);
        if (k < 45) {
          const rise = Math.floor(8 * L.clamp(k / 30));
          L.pxtext(ctx, '+10000', 112 - Math.floor(L.pxtextWidth('+10000', 1) / 2), 66 - rise, {
            color: P.hudWhite,
          });
        }
      }

      // ------------------------------------------------ 8. text (fixed-slot type-on)
      // The full string's centred slot is computed first; only the first n glyphs draw,
      // so letters never recentre. First glyph of L1 is on at frame 0; each line
      // completes exactly on its beat (f 30 for L1, f 60 for L2).
      const typeOn = (str, n, cx, gy, scale) => {
        if (n <= 0) return;
        const gx = cx - Math.floor(L.pxtextWidth(str, scale) / 2);
        L.pxtext(ctx, str.slice(0, n), gx, gy, { scale, color: P.hudWhite });
      };
      const n1 = Math.min(L1.length, 1 + Math.floor((f * (L1.length - 1)) / BEAT_F));
      typeOn(L1, n1, 120, 27, 1);
      const n2 = f < BEAT_F ? 0 : Math.min(L2.length, 1 + Math.floor(((f - BEAT_F) * (L2.length - 1)) / BEAT_F));
      typeOn(L2, n2, 120, 39, 1);

      // ------------------------------------------------ 9. HUD (G1: ×06, TIME held at 70)
      L.hud(ctx, { score: t >= B_POP ? 17500 : 7500, coins: 6, world: '1-1', time: 70 });
    },
  });
})();
