/*
 * 05-powerup.js — shot 05 'powerup' (T 9.0–11.5, dur 2.5 s, 150 frames at 60 fps)
 *
 * The sparkle-mushroom power-up. Claw'd runs in from the left (continuing shots 02–04),
 * jumps and head-bumps the middle ? block; the block hops and turns spent; the sparkle
 * mushroom rises out of its top, scoots right along the block row, drops to the ground
 * and keeps sliding; Claw'd lands, catches it at T 11.0 and powers up — white flash,
 * 8-sparkle radial burst, grow flicker — ending as Super Claw'd (scale 2), +1000.
 *
 * Layers, back to front:
 *   1. sky fill
 *   2. world scenery: cloud (world 560, 18), hill (world 640, base y 103)
 *   3. ground strip
 *   4. the mushroom (before the blocks: the block row masks its lower half during the emerge)
 *   5. block row at y 67–83: brick (544) / ?-block (560, hops and turns used) / brick (576)
 *   6. Claw'd (run / jump / grow-flicker / Super), feet anchored at y 103
 *   7. power-up FX: 8-sparkle radial burst, '+1000' pop (the white flash is the hero himself,
 *      drawn as a white silhouette on alternate 2-frame beats — the console never blends)
 *   8. HUD (G1: score 000300 → 001300 at T 11.0, coins ×01, TIME from 330)
 *
 * Continuity contracts honoured:
 *   hero world-x = 492 + 72·t  (G2: in from shot 04 at 492, out to shot 06 at 672)
 *   camX = world-x − 64        (hero anchors at screen x 64; camera scrolls right only)
 *   feet y = 103, blocks at 544/560/576 y 67–83, hill at 640, cloud at (560, 18)
 *   bump local 1.0 (T 10.0), land local 1.5 (T 10.5), touch local 2.0 (T 11.0)
 *
 * Notes for reviewers (deviations forced by the fixed geometry, all beats intact):
 *   - The jump is clipped to h 10 (same 1.0 s of air): at apex (local 1.0) the tucked sprite's
 *     head (feet 93 − 10 = 83) exactly kisses the block's underside (83). The storyboard's
 *     generic h-30 spec would put the hero's whole body inside the y 67–83 block row.
 *   - The mushroom slides at 120 px/s once loose (not 24): the hero never stops running
 *     (72 px/s, world-x 636 at T 11.0), so a slower mushroom can never reach the T 11.0
 *     touch point. Emerge timing/position and the ≈620 landing are exactly as briefed.
 *   - The grow flicker is 9 steps of 3 frames (3 flickers, ending BIG; 0.45 s at 60 fps).
 *
 * NES motion: camX snaps to a whole game pixel every 60 Hz frame; the ? block shimmers on its
 * own cadence; the burst and the '+1000' never fade (sparkles flicker out, the pop vanishes).
 */
(function () {
  'use strict';
  const ID = 'powerup';
  const N = FILM.nes;
  const RUN_V = 72;

  // beat constants, shot-local seconds
  const B_JUMP = 0.5;  // T 9.5  takeoff
  const B_BUMP = 1.0;  // T 10.0 head-bump; block hops; mushroom starts emerging
  const B_LAND = 1.5;  // T 10.5 hero lands; mushroom fully out and sliding
  const B_TOUCH = 2.0; // T 11.0 power-up

  // world constants
  const FEET = 103;        // ground top face (lib.GROUND_Y)
  const BLOCK_Y = 67;      // block row top (tiles are 16 tall: 67–83)
  const BX = [544, 560, 576];
  const MUSH_X = 561;      // centred on the ? block (560–576; mush is 14 wide)
  const ROW_RIGHT = 592;   // right edge of the block row
  const MUSH_SLIDE = 120;  // px/s once the mushroom is loose (see header notes)

  // grow flicker: 9 steps held 3 frames each, small/big alternating, 3 flickers, ends BIG (held after)
  const FLICKER = [1, 2, 2, 1, 2, 2, 1, 2, 2];
  const FLICKER_HOLD = 3;
  // the flash: white silhouette on frames 0-1 and 4-5 after the touch
  const FLASH_FRAMES = 8;
  const BURST_S = 1 / 3; // sparkle burst life (20 frames)
  const POP_S = 0.5; // '+1000' life (30 frames)

  // A sprite as a solid silhouette of one colour: its own pixels, recoloured through a cached
  // tiny canvas (a pure function of name + colour), blitted with smoothing off.
  const silhouettes = new Map();
  function silhouette(ctx, L, name, colour, gx, gy, scale) {
    const key = name + '|' + colour;
    let c = silhouettes.get(key);
    if (!c) {
      const src = L.spriteCanvas(name);
      c = document.createElement('canvas');
      c.width = src.width;
      c.height = src.height;
      const g = c.getContext('2d');
      g.drawImage(src, 0, 0);
      g.globalCompositeOperation = 'source-in';
      g.fillStyle = colour;
      g.fillRect(0, 0, c.width, c.height);
      silhouettes.set(key, c);
    }
    ctx.save();
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(c, Math.round(gx) * L.PX, Math.round(gy) * L.PX, c.width * scale * L.PX, c.height * scale * L.PX);
    ctx.restore();
  }

  FILM.scene({
    id: ID,
    draw(ctx, tIn, info) {
      const L = info.lib, P = L.pal;
      const t = L.clamp(tIn, 0, info.dur);
      const T = info.T;

      // hero + camera (hero never stops running right at 72 px/s)
      const heroWx = Math.round(492 + RUN_V * t); // whole game px
      const camX = heroWx - 64;
      const sx = (wx) => wx - camX;

      // ------------------------------------------------ 1. sky
      L.px(ctx, 0, 0, L.VW, L.VH, P.sky);

      // ------------------------------------------------ 2. scenery (world-locked)
      L.sprite(ctx, 'cloud', sx(560), 18);
      L.sprite(ctx, 'hill', sx(640), FEET - 10);

      // ------------------------------------------------ 3. ground
      L.groundStrip(ctx, camX - 16, camX + L.VW, camX);

      // ------------------------------------------------ 4. the sparkle mushroom
      if (t >= B_BUMP && t < B_TOUCH) {
        let mx = MUSH_X, mFeet;
        if (t <= B_LAND) {
          // rises out of the block top over 0.5 s: y-top 67 → 56 (feet 78 → 67)
          mFeet = 78 - 11 * L.seg(t, B_BUMP, B_LAND);
        } else {
          // slides right along the block top…
          mx = MUSH_X + MUSH_SLIDE * (t - B_LAND);
          const fallT0 = B_LAND + (ROW_RIGHT - MUSH_X) / MUSH_SLIDE; // left edge clears the row
          if (t <= fallT0) mFeet = BLOCK_Y;
          else mFeet = Math.min(FEET, BLOCK_Y + (FEET - BLOCK_Y) * L.seg(t, fallT0, fallT0 + 0.18, 'inQuad'));
        }
        L.sprite(ctx, 'mush', sx(mx), mFeet - 11);
      }

      // ------------------------------------------------ 5. block row
      const bumped = t >= B_BUMP;
      // the bumped block hops 4 px and back over 15 frames (0.25 s)
      const hk = (t - B_BUMP) / 0.25;
      const hop = bumped && hk <= 1 ? -4 * Math.sin(Math.PI * hk) : 0;
      L.sprite(ctx, 'tileBrick', sx(BX[0]), BLOCK_Y);
      if (bumped) L.sprite(ctx, 'tileUsed', sx(BX[1]), BLOCK_Y + hop);
      else L.sprite(ctx, 'tileQ', sx(BX[1]), BLOCK_Y, { frame: L.qFrame(info.T) }); // ? block cadence
      L.sprite(ctx, 'tileBrick', sx(BX[2]), BLOCK_Y);

      // ------------------------------------------------ 6. Claw'd
      const jumping = t >= B_JUMP && t < B_LAND;
      const u = L.clamp((t - B_JUMP) / (B_LAND - B_JUMP));
      const feetY = jumping ? FEET - 4 * 10 * u * (1 - u) : FEET; // clipped bump arc (see header)
      let scale = 1;
      const kTouch = t >= B_TOUCH ? N.frameOf(t - B_TOUCH) : -1; // frames since the touch
      if (kTouch >= 0) {
        const k = Math.floor(kTouch / FLICKER_HOLD);
        scale = k >= FLICKER.length ? 2 : FLICKER[k];
      }
      const pose = jumping ? 'clawdJump' : N.runPose(info.frame, RUN_V);
      const hh = (jumping ? 10 : 12) * scale;
      if (kTouch >= 0 && kTouch < FLASH_FRAMES && N.step(kTouch, 2, 2) === 0) {
        silhouette(ctx, L, pose, P.hudWhite, 64, feetY - hh, scale); // the power-up flash
      } else {
        L.sprite(ctx, pose, 64, feetY - hh, { scale });
      }

      // ------------------------------------------------ 7. power-up FX
      if (t >= B_TOUCH) {
        const k = kTouch; // frames since the touch
        // 8-sparkle radial burst at 45° steps, out to r 24 over 20 frames: steady for 10,
        // then flickering out on 2-frame beats; world-locked at the touch point, vertically
        // squashed so no sparkle dips underground
        if (t < B_TOUCH + BURST_S && (k < 10 || N.step(k, 2, 2) === 0)) {
          const s = L.seg(t, B_TOUCH, B_TOUCH + BURST_S, 'outQuad');
          const rx = 6 + 18 * s, ry = 4 + 10 * s;
          for (let i = 0; i < 8; i++) {
            const ang = i * Math.PI / 4;
            L.sprite(ctx, 'sparkle',
              sx(heroWxAt(B_TOUCH) + 10 + Math.cos(ang) * rx) - 4,
              89 + Math.sin(ang) * ry - 4);
          }
        }
        // '+1000' pops where the mushroom was grabbed, rises 8 px over 30 frames, then vanishes
        if (t < B_TOUCH + POP_S) {
          const rise = Math.floor(8 * L.seg(t, B_TOUCH, B_TOUCH + POP_S));
          L.pxtext(ctx, '+1000', sx(heroWxAt(B_TOUCH) + 10), 72 - rise, { color: P.hudWhite, align: 'center' });
        }
      }

      // ------------------------------------------------ 8. HUD
      L.hud(ctx, {
        score: t >= B_TOUCH ? 1300 : 300,
        coins: 1,
        world: '1-1',
        time: 400 - Math.floor((T - 2.0) * 10 + 1e-4),
      });
    },
  });

  // hero world-x at a given local time (for world-locked FX anchored to the touch moment)
  function heroWxAt(tt) { return Math.round(492 + RUN_V * tt); }
})();
