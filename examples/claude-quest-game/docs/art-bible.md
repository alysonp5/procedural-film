# Art bible: CLAUDE QUEST v2

The visual rules for the v2 cartridge.
`docs/v2-architecture.md` is the contract and wins where the two disagree.
Every name in `src/manifest.js` is drawn in `src/lib.js` at its declared size, and this file says how and why.
The v1 bible (240 x 135 grid, `PX = 8`, 24 fps) is retired.

## 1. Frame

The game draws into the console's native frame buffer: 320 x 180 game px, one canvas px per game px (`lib.PX = 1`, `lib.VW = 320`, `lib.VH = 180`).
The CRT stage scales it 6x to 1920 x 1080 (12x for 4K).
All art sizes and positions in this file are native px.
Tiles are 16 x 16, so the screen is 20 tiles wide.
The HUD owns the top 32 px (`lib.HUD_H`).
The ground is two tiles tall at the bottom, with its top face at `lib.GROUND_Y = 148`.
No antialiasing, no smoothing, no rotation and no fractional scaling: `lib.sprite` rounds every position to a whole pixel.

## 2. Colour

Only the 64 colours of `lib.NES` (the FCEUX NES palette, indexed `$00` to `$3F`) reach the frame buffer.
The CRT stage is the only thing allowed to make other colours.
Fills are flat, and shading lives inside each map's own colours.
Hold alpha at 0 or 1; a held half-alpha makes a colour the console cannot show.

### 2.1 The three-slot sprite rule

A character sprite is exactly three colour slots plus transparent, like an NES sprite palette.
Its map uses only the keys `1`, `2`, `3` and `.`, and its legend is its palette.
`lib.sprite(ctx, name, x, y, { pal: [c1, c2, c3] })` swaps the slots (a `null` entry keeps the sprite's own colour).
Slot meaning is fixed per character (section 4), so a swap such as the star cycle recolours every drawing the same way.
Character sprites: Claw'd (all sizes), the bugs, the shell, the boss, Pearl, the mushroom, the spark, coins, coin pops, HUD coins, fragments, fireworks, fireballs, the axe and the title cursor.

### 2.2 Tiles

A tile map uses up to three colours plus the backdrop (`.`, which shows the sky or the black behind it).
Tile keys are free letters, and area variants reuse one map with a different legend.

### 2.3 Palettes per area

| Area | Backdrop | Tile colours |
|---|---|---|
| Overworld | sky `$22` | ground, brick, stair: rust `$17`, pale lip `$36`, black `$0F`; ? block: amber `$27` with the mark `$38` / `$17` / `$07`; pipes and pole: green `$1A`, light `$29`, black; clouds: white `$30`, pale blue `$31`, black; bushes: light green `$29`, green `$1A`, black; hills: green `$1A`, light `$29`, black |
| Underground | black `$0F` | ground and brick: blue `$11`, light blue `$21`, black; pipes as overworld |
| Castle | black `$0F` | floor block and brick: grey `$00`, light grey `$10`, black; lava: red `$16`, orange `$27`, yellow `$38`; bridge: rust `$17`, orange `$27`, black; chain: light grey `$10`, white `$30`, grey `$00` |

### 2.4 Sprite palettes (`lib.SPAL`)

| Palette | Slot 1 | Slot 2 | Slot 3 |
|---|---|---|---|
| `clawd` | salmon `$26` body | rust `$17` shade and legs | black `$0F` eyes and outline |
| `clawdStar[0..3]` | `$30` / `$28` / `$24` / `$26` | `$26` / `$16` / `$14` / `$17` | black `$0F` in all four |
| `bug` | rust `$17` | cream `$37` | black `$0F` |
| `bugU` | teal `$1C` | pale cyan `$3C` | slate `$0C` |
| `shellbug` | jewel teal `$1C` | bright cyan `$2C` | black `$0F` |
| `shellbugU` | teal `$1C` | bright cyan `$2C` | slate `$0C` |
| `boss` | magenta `$14` | white `$30` | black `$0F` |
| `pearl` | teal `$1C` gown | white `$30` tiara, face, trim | navy `$0C` hair, eyes, sash |
| `mushroom` (the floppy disk) | salmon `$26` | white `$30` | black `$0F` |
| `spark` | orange `$27` | pale yellow `$38` | rust `$17` |
| `coin` | gold `$28` | white `$30` | olive `$18` |
| `hudcoin[0..2]` | `$28` / `$27` / `$17` | `$30` / `$28` / `$27` | `$18` / `$17` / `$07` |
| `fragment`, `fragmentU` | `$17`, `$11` | `$36`, `$21` | black `$0F` |
| `firework` | orange `$27` | white `$30` | red `$16` |
| `fireball` | orange `$27` | pale yellow `$38` | red `$16` |
| `axe` (the ENTER key) | salmon `$26` | white `$30` | black `$0F` |
| `cursor` | orange `$27` | pale yellow `$38` | rust `$17` |
| `lava` (splashes, bubbles) | orange `$27` | yellow `$38` | red `$16` |
| `heart` | rose `$15` | white `$30` | black `$0F` |
| `torch` | orange `$27` | yellow `$38` | rust `$17` |
| `banner` | salmon `$26` | white `$30` | rust `$17` |

Each sprite's own legend is its first palette, so `pal` is only needed for a swap.
The star cycle steps white-hot, gold, magenta, then his own colours; none is green, and his black outline stays in every step, so he never melts into a bush, the sky or the black castle.
`axe2` and `axe3` carry brighter legends of their own (orange and pale pink caps), so stepping `axe1..3` pulses the key's glow.
Underground enemies use the `U` palettes, whose slate slot 3 keeps legs and outlines visible on black.

## 3. The sprite API

- `lib.sprite(ctx, name, x, y, o)`: blit with the top-left at (x, y).
  `o.pal`, `o.flip` (horizontal), `o.flipV` (vertical, for a knocked-out enemy), `o.frame` (legend variant), `o.scale` (integer), `o.alpha`.
  Returns `{ w, h }`.
  Every (name, frame, palette, flip, flipV) builds one cached canvas once, and a plain blit is a single `drawImage`.
- `lib.spriteCanvas(name, frame, pal, flip, flipV)`: the cached canvas itself.
- `lib.SPRITES_DEF`: the maps; `lib.SPAL`: the sprite palettes.
- A manifest name with no map draws a magenta placeholder of its declared size.
- `lib.shimmer(f)`: the ? block and HUD coin shimmer drawing (0, 1, 2) at 60 Hz frame f, on a 48-frame cycle: 0 for 24 frames, then 1, 2, 1 for 8 each.
  `lib.qFrame(t)` is the same from seconds.
- `lib.scoreText(ctx, str, x, y, { color, align })` and `lib.scoreTextWidth(str)`: the score-pop face (section 6).
- `lib.hud(ctx, { score, coins, world, time, name, frame })`: the status bar (section 7).
- `lib.titleBox(ctx, cx, y, o)`: the title plaque in the style of the Claude Code welcome box (section 7.1). Returns `{ x, y, w, h }`.
- `lib.pxtext`, `lib.pxtextWidth`: the 8 x 8 font, now with `✻`, `✓` and `▶`. `lib.titlePlaque` (the v1 brick plate) is kept but no longer used by the title.
- Helpers: `lib.pipe(ctx, x, yTop, hTiles)`, `lib.flagpole(ctx, x, yTop, yBase)` (the pole is 2 px at x + 7), `lib.groundStrip(ctx, wxFrom, wxTo, camX, yTop, name)`.

## 4. The cast

All drawings are original, and the round-2 identity pass removed every Nintendo tell (section 8).
Facing: Claw'd faces right; enemies face left (they walk at the player); use `flip` for the other way.

### 4.1 Claw'd

The Claude Code mascot as the CLI draws him: a wide, squat salmon body, two black slit eyes set wide near the top, a nub arm on each side at the lower middle and four thin legs in a back pair and a front pair.
One builder (`clawd()` in lib.js, sizes in `CLAWD_SIZES`) draws every pose at every size, so the three sizes stay one character.
Slot 1 is the body.
Slot 2 is the rust shade: the right edge, the underside, a curve into the lower-right corner, the underside of each nub, and the legs.
Slot 3 is black: the eyes and a one-pixel outline round the body and nubs (a 4-neighbour outline, so the corners round off).
The legs hang below the outline in rust, so they stay visible on sky, bushes and black.

| Size | Box | Body (inside the outline) | Eyes | Nubs | Legs |
|---|---|---|---|---|---|
| Small `clawdS_*` | 16 x 16 | 10 x 7 (cols 3 to 12, rows 5 to 11) | 1 x 2 at cols 5 and 10 | 2 x 2 | 1 px, 4 long, at cols 4, 6 and 9, 11 |
| Grow `clawdM_grow` | 20 x 20 | 14 x 9 | 1 x 3 | 2 x 3 | 1 px, 4 long |
| Big `clawdB_*` | 24 x 24 | 16 x 11 (cols 4 to 19, rows 8 to 18) | 2 x 3 at cols 7 and 15 | 3 x 3, rounded tips | 2 px, 5 long, at cols 5, 8 and 14, 17 |

Every drawing stands with its feet on the bottom row, centred in its box.
The big form is a larger drawing with more detail, not the small one scaled: 2 x 3 eyes, fuller nubs and two-pixel legs.

Poses (small and big unless noted):

- `idle`: nubs level at the lower middle, all feet down.
- `blink`: `idle` with each eye shut to a one-pixel line; flash it for a few frames now and then while he stands.
- `run1` / `run2` / `run3`: the legs scuttle in pairs.
  In 1 the back pair pushes (feet trailing) while the front pair reaches forward off the ground; 2 is the passing drawing, with the body 1 px up and all four legs straight; in 3 the pairs swap.
  The nubs swing opposite each other, and on the big form the eyes glance 1 px forward.
  Play them in order, faster at speed.
- `jump`: legs splayed out front and back, both nubs up, eyes 1 px up.
- `skid`: the top of the body leans back a pixel, the back nub is flung up and all four legs brace forward.
  Drawn facing right; flip it to face the new direction on a turnaround.
- `pole1` / `pole2`: both nubs on his right side (the far one in shade) gripping the pole just past his right edge, swapping heights hand over hand for the slide.
  Place the sprite so the pole (`t_pole` columns 7 and 8) sits at sprite x + 16 (small) or x + 24 (big).
- `crouch` (big only): the body squashed to 16 x 9 in the lower 12 px, nubs tucked, legs 3.
- `victory` (big only): both nubs up in a cheer, happy caret eyes.
- `dead` (small only): knocked out, facing the viewer, X eyes, both nubs up, legs splayed.

### 4.2 The bug (`bug_walk1`, `bug_walk2`, `bug_flat`)

A round-backed beetle, 16 x 16: rust shell dome with a shine and three black spots, a cream rim, a rust head in front with an angry brow slanting down to the snout, a cream eye with the pupil forward, a cream fang and two antennae with knob tips.
Three black legs a side step in two drawings.
Stomped, it squashes to 16 x 6 with its eye shut (`bug_flat`, 16 x 8 box).
It is a beetle, never a mushroom shape.

### 4.3 The shell bug (`shellbug_walk1`, `shellbug_walk2`, `shell`)

A LOW crawling jewel beetle, 16 x 16: a long teal dome close to the ground with two seams across it, a bright cyan rim and shine, a small head at ground level with a cyan eye, a mandible and two antennae swept forward, and six short black legs that step in two drawings.
It never stands up.
Stomped, it pulls in its head and legs: `shell` is the segmented oval alone, sitting on the box floor.

### 4.4 The Big Bug (`boss_walk1`, `boss_walk2`, `boss_roar`, `boss_look`)

The castle boss, 32 x 32: a magenta horned beetle standing on two stout legs.
A white horn curls up off its snout and a small crest horn sits behind it.
A white eye with a black slit sits under a heavy brow, and white pincer mandibles hook together in front.
A domed wing-case shell carries a seam, a hard white shine and white spikes along its back.
The underside is plated, and two clawed forelegs reach forward.
The walk drawings swap the legs; the roar rears the head, opens the pincers wide around a fanged mouth and raises the claws.
`boss_look` is the hang before the fall: the head dips, the brow lifts, the pupil drops to the bridge and the jaws go slack.

### 4.5 Princess Pearl (`pearl`, `pearl_wave`)

16 x 24, facing the viewer: dark navy hair in a bun and a shoulder-length bob framing a pale porcelain face, a white tiara on top, a teal gown with a white V-neck and centre panel, long bell sleeves with white cuffs, a navy sash and a white hem.
`pearl_wave` raises her right hand above her head.
Her silhouette (bun, bob, column gown, long sleeves) shares nothing with a blonde princess in a pink bell dress.

### 4.6 Items and effects

- `mushroom`: the grow item is a 3.5-inch floppy disk ("save your context"): a salmon shell with a chamfered corner, a white metal shutter with its dark window, a white label carrying the salmon ✻ and a write-protect hole. The name is kept.
- `spark1..4`: the star power-up, the brand moment: a bold eight-ray asterisk-burst that fills its 16 x 16, fat orange rays tapering to round tips, a rust rim round the whole burst, a pale-yellow hot core and a glint.
  The four drawings trade length between the straight and the diagonal rays.
- `coin1..4` (8 x 14): face, three-quarter, edge, three-quarter back; gold, white shine, olive rim and an engraved line.
  `coinpop1..4` are the same spin without the engraving.
- `hudcoin1..3` (5 x 8): bright, mid and dim; the HUD blinks them with `lib.shimmer`.
- `fragment1`, `fragment2` (8 x 8): a chipped brick corner with its mortar; the second is the first turned a quarter.
  Use `SPAL.fragmentU` underground.
- `firework1..3` (16 x 16): the burst expands from a white-hot core with eight short rays, to eight sparks on trails at half radius, to a full ring of sixteen white-tipped sparks at the edge of the box with red embers inside.
- `fireball1..4` (8 x 8): a hot core with a flame lick that turns a quarter each drawing.
- `axe1..3`: the ENTER key that drops the bridge: a big salmon keycap with a white top face set back from its front edge, a bold black ⏎, a shadow on the floor, and a glint walking round its rim; the three drawings pulse the glow brighter. The names are kept.
- `cursor` (8 x 8): a tiny spark.
- `splash1..3` (16 x 16): lava splashing up when the boss falls in: the crown, the tall burst, the falling drops.
- `bubble1..2` (8 x 8): a glowing lava bubble rising, then popping into drops.
- `heart1..2` (8 x 8): a rose heart with a white glint rising at the rescue; the second twinkles.
- `torch1..2` (8 x 16): a wall torch, a flame on a rust cup and bracket, two flicker drawings.
- `banner` (16 x 32): a salmon banner on a rust rod for Pearl's room, white trim, a big white ✻, a swallowtail hem.

## 5. Tiles and scenery

- `t_ground`: irregular rounded fieldstones (four stones per tile, a toroidal Voronoi, so it tiles both ways) with a pale lip on each stone's top-left and black gaps; `t_groundU` is the same map in blue.
- `t_brick`: four courses of 8-wide bricks with a pale top lip and black mortar; `t_brickU` blue, `t_brickC` grey.
- `t_q1..3`: the ? block. The amber body never changes; the bevel and the mark shimmer pale, rust, maroon; black rivets and a black drop shadow under the mark.
- `t_used`: flat rust face, black rim and rivets, maroon inner shadow.
- `t_stair`: a two-step mitred bevel round a flat face with a sunken centre panel; `t_groundC` is the same block in grey (the castle floor).
- Pipes: a 32-wide rim (`t_pipeTL`, `t_pipeTR`) over a 28-wide body (`t_pipeL`, `t_pipeR`), so the rim overhangs 2 px a side.
  Columns: outline, light strip, body, dithered black shade bands, outline.
  The sideways pipe is the same profile turned a quarter, light on top, with the mouth facing left: `t_pipeHT` / `t_pipeHB` (mouth), `t_pipeHBodyT` / `t_pipeHBodyB` (body), and `t_pipeJoinT` / `t_pipeJoinB`, the vertical pipe's left body column with the sideways pipe running into it (use them in place of `t_pipeL` at those two rows).
- `t_pole`: a 2-px pole at columns 7 and 8; `t_poleTop`: the outlined green ball with a highlight, pole stub below.
- `flag`: a white pennant pointing left from the pole, carrying a salmon Claude spark.
- `castleFlag` (14 x 14): a salmon flag with a white spark on a black staff.
- `castle` (80 x 80): pale grey stone with Claude-salmon roofs: a tall central tower under a spire topped by the ✻, two round turrets (joints crowd toward their edges so the stone wraps round) with pointed roofs, a crenellated curtain wall, an arched window and a round window on the tower, slit windows on the turrets and an arched door at x 33 to 46.
  The castle flag can rise from the right turret's tip (x 68, y 15).
- Clouds and bushes: the same lobed maps, recoloured (the console trick, done on purpose).
  `bushN` is exactly the top 16 rows of `cloudN`, with light green in place of white and green in place of pale blue, so bushes and clouds always match.
  Widths: one bump 32, two 48, three 64.
- `hillS` (48 x 19), `hillB` (80 x 35): round-shouldered mounds, black outline, a light rim inside the upper-left edge, black spots.
- Castle: `t_lavaTop1` / `t_lavaTop2` (the surface wave half a period apart; alternate them), `t_lava` (the body), `t_bridge` (an iron girder deck on the top 7 rows with hanging links; the lower half is open so the lava glows through), `t_chain` (a diagonal chain, top-right to bottom-left).

## 6. Score pops

`lib.scoreText` draws the floating points in a 4 x 6 face with 1-px strokes, white by default.
Glyphs: 0 to 9, U and P, so every pop the game uses works: 100, 200, 400, 500, 800, 1000, 2000, 4000, 5000, 8000, 1UP.
A string is `5n - 1` px wide (`lib.scoreTextWidth`) and 6 px tall (`lib.SCORE_H`); `align: 'center'` centres it on x.

## 7. HUD

`lib.hud(ctx, { score, coins, world, time, name, frame })` lays the SMB-style bar across the top 32 px, two text rows at y 8 and y 16 (`lib.HUD_ROWS`), ink rows 8 to 22.

- The name (default `CLAW'D`) over a six-digit score at x 28.
- The blinking HUD coin at x 106 and `×NN` at x 114.
- `WORLD` at x 180 with the world centred under it.
- `TIME` at x 260 with the count right-aligned under it; `time: null` leaves it blank (title and lives screens).
- `frame` (the global 60 Hz frame) drives the coin blink, so the HUD is a pure function of its inputs.

The 8 x 8 font (`lib.pxtext`) is the v1 face: 7 x 7 bold glyphs in 8 x 8 cells, A to Z, 0 to 9 and `- ! ? . , : ' " > < + / × © ♥ ★`, plus `✻` (the spark), `✓` (the completion summary) and `▶` (the menu pointer).
At native size one line holds 40 glyphs across 320 px.

### 7.1 The title box

`lib.titleBox(ctx, cx, y, o)` draws the title plaque in the style of the Claude Code welcome box: a black panel inside a one-pixel salmon border with chamfered (rounded) corners, the salmon `✻` at the left and `CLAUDE QUEST` in white at scale 2 beside it, centred on x = cx with its top at y.
Options: `text`, `scale` (2), `pad` (6), `gap` (6), `fill` (`$0F`), `border` (`$26`), `color` (`$30`), `icon` (the ✻ colour, or `false`), `lines` (extra scale-1 lines under the title, in `subColor`, `$36`).
With the defaults it is 224 x 28 px, and it returns `{ x, y, w, h }` so the copyright line can hang off its right edge.

## 8. Mistakes to avoid

- Claw'd is wide and squat, with four thin legs in two pairs, two side nubs, two black slit eyes set wide and a black outline in every drawing; never round or white eyes, never Mario red, never a tall block.
- Big Claw'd is the same character redrawn larger (24 x 24), never the small sprite scaled.
- No star palette is green, and slot 3 stays black in every star step.
- No fourth colour in any map; a detail that needs one uses a transparent pixel or another slot.
- A character map uses only `1`, `2`, `3` and `.`, so palette swaps keep working.
- No Nintendo shapes. The walker is a beetle; the shell bug is a low crawler; the grow item is a floppy disk; the star is the Claude asterisk-burst; the princess has dark hair and a teal gown; the bridge switch is the ENTER key; the castle is a spired three-tower silhouette; the title is a Claude-Code-style box.
  A scratch script rendered each redesign beside the SMB original's traits (text only) and the flagged round-1 drawing.
- Enemies on black backdrops use their `U` palettes, never black legs on black.
