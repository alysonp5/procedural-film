// manifest.js : every sprite name the v2 game draws, with its size in game px (native 320x180 frame).
// Owner: art (src/lib.js draws them). The game codes against these names from day one: a name listed
// here but not yet drawn in lib.js blits a magenta placeholder of this size (see lib spriteCanvas).
//
// Character sprites follow the NES sprite rule: exactly three colour slots, legend keys '1' '2' '3'
// ('.' transparent), so the game can palette-swap them (star power, fireball flash) with
// lib.sprite(ctx, name, x, y, { pal: [c1, c2, c3] }). Tiles may use up to four colours (a background
// palette: 3 + the shared backdrop), legend keys free.
//
// Sizes are w x h in game px. 'frames' lists how many drawings a name has when it is a sequence
// (name1 .. nameN are separate entries below).
(function () {
  'use strict';
  const FILM = (window.FILM = window.FILM || {});
  const M = {};
  const add = (name, w, h, note) => (M[name] = { w, h, note: note || '' });

  // --- Claw'd, small (16x16) ---
  add('clawdS_idle', 16, 16, 'standing');
  add('clawdS_blink', 16, 16, 'standing, eyes shut (idle life)');
  for (let i = 1; i <= 3; i++) add('clawdS_run' + i, 16, 16, 'run cycle drawing ' + i);
  add('clawdS_jump', 16, 16, 'airborne, legs splayed, both nubs up');
  add('clawdS_skid', 16, 16, 'braking, leaning back on braced legs');
  add('clawdS_pole1', 16, 16, 'gripping the flagpole');
  add('clawdS_pole2', 16, 16, 'flagpole slide second drawing');
  // --- Claw'd, growing (the power-up flicker between small, mid and big) ---
  add('clawdM_grow', 20, 20, 'mid-size drawing used only in the grow flicker (feet at the bottom, centred)');
  // --- Claw'd, big (24x24: the wide, squat mascot, feet at the bottom, centred in the box) ---
  add('clawdB_idle', 24, 24, 'standing');
  add('clawdB_blink', 24, 24, 'standing, eyes shut (idle life)');
  for (let i = 1; i <= 3; i++) add('clawdB_run' + i, 24, 24, 'run cycle drawing ' + i);
  add('clawdB_jump', 24, 24, 'airborne, legs splayed, both nubs up');
  add('clawdB_skid', 24, 24, 'braking, leaning back on braced legs');
  add('clawdB_crouch', 24, 24, 'ducking (drawn in the lower 12 px)');
  add('clawdB_pole1', 24, 24, 'gripping the flagpole');
  add('clawdB_pole2', 24, 24, 'flagpole slide second drawing');
  add('clawdB_victory', 24, 24, 'both nubs up, happy eyes, facing the princess');

  // --- enemies ---
  add('bug_walk1', 16, 16, 'the walking bug (goomba role), drawing 1');
  add('bug_walk2', 16, 16, 'drawing 2 (legs swapped)');
  add('bug_flat', 16, 8, 'stomped flat');
  add('shellbug_walk1', 16, 16, 'the shelled beetle, a LOW CRAWLER (not an upright Koopa), drawing 1 (round 2)');
  add('shellbug_walk2', 16, 16, 'drawing 2');
  add('shell', 16, 16, 'the empty shell');
  add('boss_walk1', 32, 32, 'the Big Bug boss on the castle bridge, drawing 1');
  add('boss_walk2', 32, 32, 'drawing 2');
  add('boss_roar', 32, 32, 'mouth open (hop / roar)');

  // --- the princess ---
  add('pearl', 16, 24, 'Princess Pearl standing: dark bob and bun, white tiara, teal gown (round 2)');
  add('pearl_wave', 16, 24, 'waving');

  // --- items ---
  add('mushroom', 16, 16, 'the grow power-up: a 3.5" floppy disk with the ✻ on its label (round 2; name kept)');
  for (let i = 1; i <= 4; i++) add('spark' + i, 16, 16, 'the Claude spark star power-up (a pixel asterisk-burst), twinkle ' + i);
  for (let i = 1; i <= 4; i++) add('coin' + i, 8, 14, 'field coin spin ' + i);
  for (let i = 1; i <= 4; i++) add('coinpop' + i, 8, 14, 'coin popping out of a block, spin ' + i);
  for (let i = 1; i <= 3; i++) add('hudcoin' + i, 5, 8, 'HUD coin blink ' + i);
  add('fragment1', 8, 8, 'brick fragment');
  add('fragment2', 8, 8, 'brick fragment, rotated drawing');
  for (let i = 1; i <= 3; i++) add('firework' + i, 16, 16, 'firework burst stage ' + i);
  for (let i = 1; i <= 4; i++) add('fireball' + i, 8, 8, 'firebar fireball, spin ' + i);
  for (let i = 1; i <= 3; i++) add('axe' + i, 16, 16, 'the ENTER key that drops the bridge, glow shimmer ' + i + ' (round 2; name kept)');
  add('cursor', 8, 8, 'title menu cursor (a tiny spark)');

  // --- overworld tiles (16x16) ---
  add('t_ground', 16, 16, 'overworld ground');
  add('t_brick', 16, 16, 'breakable brick');
  for (let i = 1; i <= 3; i++) add('t_q' + i, 16, 16, '? block shimmer ' + i);
  add('t_used', 16, 16, 'spent block');
  add('t_stair', 16, 16, 'hard stair block');
  add('t_pipeTL', 16, 16, 'vertical pipe, top-left rim');
  add('t_pipeTR', 16, 16, 'vertical pipe, top-right rim');
  add('t_pipeL', 16, 16, 'vertical pipe body left');
  add('t_pipeR', 16, 16, 'vertical pipe body right');
  add('t_pole', 16, 16, 'flagpole segment (thin pole centred)');
  add('t_poleTop', 16, 16, 'flagpole ball top');
  add('flag', 16, 16, 'the flag on the pole');
  add('castleFlag', 14, 14, 'the small flag that rises on the castle');
  add('castle', 80, 80, 'the end-of-level castle: grey stone, three towers, a spire topped by the ✻ (5x5 tiles; door at x 33-46)');
  add('cloud1', 32, 24, 'one-bump cloud');
  add('cloud2', 48, 24, 'two-bump cloud');
  add('cloud3', 64, 24, 'three-bump cloud');
  add('bush1', 32, 16, 'one-bump bush');
  add('bush2', 48, 16, 'two-bump bush');
  add('bush3', 64, 16, 'three-bump bush');
  add('hillS', 48, 19, 'small hill');
  add('hillB', 80, 35, 'big hill');

  // --- underground tiles (blue set) ---
  add('t_groundU', 16, 16, 'underground floor');
  add('t_brickU', 16, 16, 'underground brick wall/ceiling');
  add('t_pipeHT', 16, 16, 'sideways pipe mouth, top half');
  add('t_pipeHB', 16, 16, 'sideways pipe mouth, bottom half');
  add('t_pipeHBodyT', 16, 16, 'sideways pipe body, top');
  add('t_pipeHBodyB', 16, 16, 'sideways pipe body, bottom');
  add('t_pipeJoinT', 16, 16, 'where the sideways pipe meets the vertical one, top');
  add('t_pipeJoinB', 16, 16, 'join, bottom');

  // --- castle tiles (grey set) ---
  add('t_groundC', 16, 16, 'castle floor block');
  add('t_brickC', 16, 16, 'castle wall brick');
  add('t_lavaTop1', 16, 16, 'lava surface, wave drawing 1');
  add('t_lavaTop2', 16, 16, 'lava surface, wave drawing 2');
  add('t_lava', 16, 16, 'lava body');
  add('t_bridge', 16, 16, 'bridge segment (the collapsing one)');
  add('t_chain', 16, 16, 'the chain holding the bridge by the ENTER key');

  // --- round 2 additions (coordinator, from the critics' findings) ---
  add('clawdS_dead', 16, 16, 'live-play death pose (small)');
  add('boss_look', 32, 32, 'the boss looking down as the bridge goes (the hang before the fall)');
  for (let i = 1; i <= 3; i++) add('splash' + i, 16, 16, 'lava splash stage ' + i);
  for (let i = 1; i <= 2; i++) add('bubble' + i, 8, 8, 'lava bubble ' + i);
  for (let i = 1; i <= 2; i++) add('heart' + i, 8, 8, 'rising heart at the rescue, twinkle ' + i);
  for (let i = 1; i <= 2; i++) add('torch' + i, 8, 16, 'wall torch flame ' + i + ' (castle and Pearl\'s room)');
  add('banner', 16, 32, 'a hanging Claude-spark banner for Pearl\'s room');

  // --- the game (docs/game-spec.md 9.1) ---
  for (let i = 1; i <= 2; i++) add('moth' + i, 16, 16, 'the moth (the first bug, 1947): wings ' + (i === 1 ? 'up' : 'down') + '; faces left');
  for (let i = 1; i <= 2; i++) add('spike_walk' + i, 16, 16, 'the spike beetle: a low violet beetle with three white spikes, drawing ' + i);
  add('terminal', 16, 16, 'the Claw\'d Code power-up: a salmon-framed monitor showing >_');
  for (let i = 1; i <= 4; i++) add('caret' + i, 8, 8, 'the thrown caret (>), turned ' + (i - 1) * 90 + ' degrees');
  for (let i = 1; i <= 3; i++) add('poof' + i, 8, 8, 'a caret\'s poof, stage ' + i);
  for (let i = 1; i <= 4; i++) add('token' + i, 16, 16, 'the ✻ token medal spinning: ' + ['face', 'narrow', 'edge', 'narrow mirrored'][i - 1]);
  for (let i = 1; i <= 2; i++) add('ember' + i, 16, 16, 'an ember leaping out of the lava, flicker ' + i);
  for (let i = 1; i <= 2; i++) add('t_lavaGlow' + i, 16, 16, 'the ember tell: the lava surface at its column, white-hot, wave drawing ' + i);
  for (let i = 1; i <= 3; i++) add('spring' + i, 16, 16, 'the spring: ' + ['rest', 'compressed', 'extended'][i - 1]);
  add('ckpt_off', 16, 32, 'the checkpoint post topped by a commit node, unlit');
  add('ckpt_on', 16, 32, 'the checkpoint post flying a white flag with a ✓');
  add('clawdB_throw', 24, 24, 'big Claw\'d throwing a caret, one nub thrust forward');
  add('lift', 16, 8, 'a lift segment (sky)');
  add('liftU', 16, 8, 'a lift segment (underground)');
  add('liftC', 16, 8, 'a lift segment (castle)');
  add('t_rackTop', 16, 16, 'sky: a server-rack tower cap (solid)');
  add('t_rack', 16, 16, 'sky: server-rack units with status lights (background)');
  add('t_cloudTop', 16, 16, 'sky: a walkable cloud block');

  FILM.SPRITE_MANIFEST = M;
})();
