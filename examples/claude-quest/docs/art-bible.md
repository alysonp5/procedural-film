# Art bible: CLAUDE QUEST

The visual rules every scene follows.
Where this file and a scene brief disagree on a colour, weight or rule, this file wins.
Where this file and `docs/storyboard.md` disagree on a position or a time, the storyboard wins.

This film replaces the hand-inked house style with a **pixel-art platformer** look (the brief's
reference: Super Mario Bros gameplay, NES era). Sections 1–9 below are the new house style.
The engine, gate, beat grid and workflow are unchanged.

## 1. Frame

The canvas is 1920 px wide and 1080 px tall at 24 fps (landscape, set in `FILM.TIMELINE`).
Everything is drawn on a **virtual pixel grid**: 240 × 135 game pixels, one game pixel = 8 logical px
(`lib.PX = 8`). Every sprite, block and text blit snaps to whole game pixels (`lib.sprite`,
`lib.px`, `lib.pxtext` already round; scene math should work in game px).
No antialiasing, no smoothing, no gradients, no rotated or fractional-scaled sprites.
The origin is the top-left corner and y grows downward, in game pixels unless noted.

### 1.1 Safe area

Landscape video on YouTube/X: the HUD (score / coins / world / time) always occupies game rows
y 1–15 (two rows of the 8 × 8 font, section 10.5). Must-read content (the hero, enemies, text cards, the princess) stays inside
x 8–232, y 16–100 game px. The ground's top face is `lib.GROUND_Y = 103`.
Scenery may bleed to all edges.

### 1.2 Composition for a wide frame

This is a side-scrolling game screen: the hero anchors at screen x ≈ 64 game px (27%) in run shots,
and the world scrolls left past him. Static shots (title, throne room, end card) centre on x = 120.
Never letterbox, never draw a fake screen border: the frame IS the game screen.

## 2. Palette

The screen shows only colours from the NES 2C02 master palette, as FCEUX displays it.
`lib.NES` holds all 64 entries, indexed `$00`–`$3F`.
Every value in `FILM.lib.pal` is one of those entries, and `tools/check.cjs` checks that every pixel of every sampled frame is too.
Scenes never use hex literals, and the source scan flags them.
Fills are flat.
Shading comes from each sprite's own colours, never from overlays, gradients or alpha blends.
An alpha fade mixes two NES colours into a colour the NES cannot show, so hold alpha at 0 or 1 and use a frame change or a hard cut instead.

Each `pal` value was snapped to its nearest NES entry (CIELAB distance), with these deliberate choices where the console grammar reads better than the nearest match:

- `bushGreen` `$29`: bushes are light green over the darker hill green.
- `qAmber` `$27`: the ? block is the classic orange, kept separate from coin gold `$28`.
- `brickHi` `$36`: the pale pink lip on ground and brick.
- `brickLine`, `pipeDeep`, `usedDeep` and `bugDeep` `$0F`: console outlines and mortar are black.
- `pearlPink` `$25` and `pearlDeep` `$15`: a stronger dress than the nearest pale pink `$35`.
- `usedBlock`, `blockBrown`, `castleBrick` and `clawdDeep` `$17`: they share one brown, like a shared console palette.

The pre-pixel house colours (paper, stripe, wash, blueprint and overlay keys) also sit on their nearest NES entry.
This film never draws them.

| Name | Hex | NES | Use |
|---|---|---|---|
| sky | #5C94FC | $22 | Overworld sky |
| cloudWhite | #FCFCFC | $30 | Cloud body, flag cloth |
| cloudShade | #A8E4FC | $31 | Cloud inner curves |
| bushGreen | #80D010 | $29 | Bush body, hill and pipe highlights, castle pennant |
| hillGreen | #00A800 | $1A | Hill body, bush inner lines |
| leafDeep | #005000 | $0A | Spare dark green |
| pipeGreen | #00A800 | $1A | Pipe body, flagpole shade side |
| pipeLight | #80D010 | $29 | Pipe highlight strip, flagpole |
| pipeDeep | #000000 | $0F | Pipe outline and shade bands |
| brickMain | #C84C0C | $17 | Ground stone, brick face, title plaque |
| brickDeep | #7C0800 | $07 | Pit lips, ? block dark shimmer frame, used-block inner edge |
| brickLine | #000000 | $0F | Mortar, cracks, stone shadow |
| brickHi | #FCBCB0 | $36 | Ground and brick lip, block bevel, plaque text |
| blockBrown | #C84C0C | $17 | Hard stair block face |
| blockDeep | #402C00 | $08 | Hard stair block shadow bevel |
| qAmber | #FC9838 | $27 | ? block body, frame 0 |
| qDeep | #C84C0C | $17 | ? block body, frame 1 |
| qHi | #FCE4A0 | $38 | ? block bevel and '?' mark |
| usedBlock | #C84C0C | $17 | Spent block face |
| usedDeep | #000000 | $0F | Spent block outline and rivets |
| coinGold | #F0BC3C | $28 | Coin face |
| coinDeep | #887000 | $18 | Coin rim |
| clawdOrange | #FC7460 | $26 | Claw'd body, mushroom cap, flag spark |
| clawdDeep | #C84C0C | $17 | Claw'd shade, underside and feet |
| clawdLight | #FCBCB0 | $36 | Spare Claw'd highlight (unused by the sprites) |
| inkDark | #000000 | $0F | Eyes, outlines |
| bugBrown | #7C0800 | $07 | Bug body |
| bugDeep | #000000 | $0F | Bug outline, antennae, legs |
| eyeWhite | #FCFCFC | $30 | Bug eyes |
| shellGreen | #00A800 | $1A | Shell bug dome |
| shellDeep | #005000 | $0A | Spare shell shade |
| bellyCream | #FCD8A8 | $37 | Shell rim, shell bug head and feet |
| pearlCream | #FCD8A8 | $37 | Princess face and hands, mushroom spots and stalk |
| pearlPink | #FC74B4 | $25 | Princess dress |
| pearlDeep | #E40058 | $15 | Spare dress shade |
| crownGold | #F0BC3C | $28 | Crown |
| castleBrick | #C84C0C | $17 | Castle wall; castle-interior tile light |
| castleDeep | #7C0800 | $07 | Castle-interior tile body, wall sconces |
| doorBlack | #000000 | $0F | Door and window voids |
| hudWhite | #FCFCFC | $30 | HUD and card text |
| fireOrange | #FC9838 | $27 | Torch flame, fireworks |
| fireYellow | #F0BC3C | $28 | Flame core, fireworks, sparkle arms |
| sparkle | #FCFCFC | $30 | Sparkle core, coin shine |
| caveBrick | #0070EC | $11 | Underground stone and brick face |
| caveDeep | #24188C | $01 | Spare underground dark |
| caveBlack | #000000 | $0F | Underground and castle-interior sky, underground mortar |
| caveHi | #3CBCFC | $21 | Underground lip (added) |
| heartRed | #E40058 | $15 | Hearts |

## 3. Sprites and tiles

There are no strokes.
Every form comes from a sprite map in `lib.SPRITES_DEF`, drawn through `lib.sprite`, or from a `lib.px` block in a `pal` colour.
Do not call `inkPath`, `hatch`, `stipple`, `wash`, `blueprint`, `paper` or `stripes`, which belong to the old house style.

NES sprite rules, enforced by `tools/check.cjs`:

1. A sprite map uses at most 3 colours plus transparent (`.`).
   A map with `legends` (the ? block, the HUD coin) meets that limit in every frame.
2. Shapes are built on 8 × 8 tiles grouped into 16 × 16 metatiles: blocks, pipes and ground are 16 × 16.
3. Outlines are black `$0F` where the console grammar has them: clouds, bushes, hills, pipes, bugs, the shell bug, the mushroom and the castle mortar.
   Claw'd has no outline, so his flat coral block reads like the mascot.
4. A detail that needs a fourth colour uses a transparent pixel instead.
   Princess Pearl's eyes and dress folds are holes, so she must stand in front of a black plate (the castle interior and the end card).

Tile grammar. All pixels are original drawings.
None is traced from a Nintendo bitmap.

- Ground (`tileGround`, plus the added `tileGroundB`): one rounded stone per tile, with a pale lip on the top and left, black shadow on the right and bottom, dark corners, and a hairline crack.
  `lib.groundStrip` mixes the two stones per column from a fixed hash.
- Brick (`tileBrick`): bevelled courses with a pale top and left edge on every brick and black mortar.
- ? block (`tileQ`): rounded corners, pale top and left bevel, black bottom and right edge, four rivets, and a pale '?' with a black drop shadow.
  Three shimmer frames cycle the body colour (`qAmber` → `qDeep` → `brickDeep`).
  Pick the frame with `lib.qFrame(t)`.
- Spent block (`tileUsed`): flat face, black outline, four rivets, dark inner edge, no mark.
- Hard stair block (`tileBlock`): a mitred bevel (pale top and left, dark bottom and right) around a sunken centre panel.
- Pipes (`lib.pipe`): a 32-wide rim over a 28-wide body, so the rim overhangs 2 px on each side.
  Left to right the columns are outline, light strip, body, dithered black shade bands, outline.
- Clouds, bushes and hills: lobed shapes with a black outline.
  Clouds have light-blue inner curves, bushes darker-green inner lines, and hills a light-green highlight inside the upper-left edge plus black speckles.
- Castle: a crenellated tower over a crenellated base, brick courses with black mortar, brick surrounds around two tower windows and two base slits, an arched door (cols 13–18), and a green pennant on a pole (cols 15–22, rows 0–4).
- Flagpole (`lib.flagpole`): a 2-px pole (light green left column, green right column), a 4 × 4 outlined ball on top, and a hard block at its foot.

## 4. Tone

Flat fills only.
Shading is baked into the sprite maps.
The engine's grain post is off for every shot (timeline `mode: 'none'`).

## 5. Screens (the three plates)

- **Overworld** (default): `sky` fill, clouds, hills and bushes, the ground strip, the HUD.
- **Underground**: `caveBlack` fill, `tileGroundCave` and `tileBrickCave` (`caveHi` lip, `caveBrick` face, black mortar), the HUD.
- **Castle interior**: `caveBlack` fill, `tileGroundCastle` and `tileBlockCastle` (`castleBrick` over `castleDeep`, black shadow), torch flames (`fireOrange` and `fireYellow`, 2-frame flicker), the HUD.

## 6. Overlays

None.
The HUD (`lib.hud`) is the only persistent chrome.
All on-screen text is pixel text through `lib.pxtext`, and `lib.text` is banned in this film.

## 7. Motion

### 7.1 Sprite animation on twos

Character frames step on a held clock, never per render frame.
Use `lib.clawdRun(t)` for the 3-frame run cycle (`clawdRun1` → `clawdRun2` → `clawdRun3` at 12 fps).
A scene that still alternates `clawdRun1` and `clawdRun2` at 8 Hz reads as a two-step shuffle, which is acceptable.
Use `lib.coinSpin(t)` for the 4-frame coin spin (`coin1` face → `coin2` → `coin3` edge → `coin4`).
Use `lib.qFrame(t)` for the ? block shimmer.
It uses the console's 0.8 s cycle: frame 0 for 0.4 s, then frames 1, 2, 1 for 2/15 s each.
The HUD coin blinks on the same cadence by itself.
Bug walks and torch flicker keep 2-frame cycles at 8 Hz (`Math.floor(t * 8) % 2`).

### 7.2 Scroll and physics run at full 24 fps

- Run speed: **3 game px per frame** (72 px/s). Camera scrolls right only.
- Jumps are parabolas: given apex height `h` (game px) and airtime `A` (frames), with
  `u = elapsedFrames / A`: `y(u) = y0 - 4 * h * u * (1 - u)`. Take off and land ON beat frames;
  pick (h, A) from the storyboard — A is always a multiple of 6 frames (an 8th note = 3 frames,
  a beat = 12).
- Stomps, coin pops, hits and landings land exactly on beats or 8ths (the beat is 0.5 s = 12 frames).
- Camera may ease over at most one beat; sprite motion never eases longer than that.

### 7.3 Determinism

Seed every random choice from `lib.hash(shotId, ...)` through `lib.rng`.
A scene draws from `t` alone and never depends on a previous frame.
Clamp `t` past duration to the final pose (transitions ask for it).

## 8. Continuity (replaces match cuts)

Cuts are hard and land on the beat; gameplay flows across them through three devices:

1. **The HUD state table** in the storyboard (score / coins / time per shot) — copy it exactly.
2. **The world layout** per shot in the storyboard: ground, pipes, blocks and props with world-x
   positions in game px. Consecutive run shots continue the same world-x where the storyboard says so.
3. **Pose continuity**: if a cut lands mid-run, both sides show a run pose; mid-jump, a jump pose.

## 9. Title cards and text

The font is an original bold face drawn for this film.
Each glyph is 7 × 7 ink with 2-px strokes, sitting in an 8 × 8 cell.
`lib.pxtext` advances 8 × scale game px per glyph.
A string is `(8 × n − 1) × scale` wide (`lib.pxtextWidth`) and 7 × scale tall (`lib.PXTEXT_H`).
Glyphs cover A–Z, 0–9, `- ! ? . , : ' " > < + / × © ♥ ★` and space.
`o.shadow` adds a 1-px drop shadow down and to the right.

Widths that fit the must-read box (x 8–232, 224 px):

- Scale 1 fits 28 glyphs.
- Scale 2 fits 14 glyphs.
- Scale 3 fits 9 glyphs.

"CLAUDE QUEST" (12 glyphs) therefore runs at scale 2 at most (191 px).
At scale 3 it is 285 px and overflows the 240-px frame.

Title plaques use `lib.titlePlaque(ctx, cx, y, text, o)`.
The plate is brick orange with a pale bevel on the top and left, a black edge on the bottom and right, and four rivets.
Its text is `brickHi` with a black shadow, at scale 2 by default, and `text` may be an array of lines.
Card text elsewhere is `hudWhite`.
The end card centres its title on x = 120 game px.

## 10. Subject reference

Sources checked 21 Sep 2026: `.tmp/research/notes.md` (the four reference images, colour-sampled).

### 10.1 Claw'd (the hero): `clawdIdle`, `clawdRun1`–`clawdRun3`, `clawdJump`, `clawdPole`

He is 16 × 12 game px, or 16 × 10 when jumping (tucked) and 16 × 11 on the pole.
He is a wide coral `$26` block with TWO square black eyes in the upper half and two straight side arms.
He has FOUR stubby legs with `clawdDeep` feet, and a `clawdDeep` right edge and underside for volume.
The run cycle lifts legs 1+3 and then 2+4, with a passing frame (`clawdRun2`) that drops the body 1 px.
The jump pose raises both arms and splays the legs.
The pole pose grips with both arms and all four feet at his right.
He faces right by default (`flip: true` faces left, used only in shot 15).
Super Claw'd (after the mushroom, shots 06–16) is the SAME sprite at `scale: 2`, 32 × 24 game px.

### 10.2 Princess Pearl: `princess`, `princessWave`

She is 14 × 14 game px: a cream face with the same square eyes, a pink bell dress and a gold crown, in 3 colours.
Her eyes and dress folds are transparent, so she is always drawn over a black plate.
She waves (`princessWave`, right hand raised) after the rescue.

### 10.3 Enemies: `bug1`/`bug2` (12 × 9), `bugFlat` (12 × 4), `shellbug1/2` (14 × 12), `shell` (14 × 7)

The bug is an original six-legged beetle with two antennae, a maroon body, a black outline and white eyes with black pupils.
It walks left at 1 game px per frame with a 2-frame leg step.
A stomp flattens it (`bugFlat`) with a score pop.
The shell bug is a green-domed crawler with a cream head on the left (it walks left).
A stomp tucks it into `shell`, and a kicked shell slides at 4 px/frame.

### 10.4 Level furniture

Ground is 2 tiles tall, top at y = 103, laid with `lib.groundStrip`.
Bricks, ? blocks and solid blocks are 16 × 16 tiles (`tileBrick`, `tileQ` with `frame: lib.qFrame(t)`, `tileUsed`, `tileBlock`).
Pipes are 2 tiles wide with the rim on top, drawn with `lib.pipe(gx, gyTop, hTiles)`.
Coins are 8 × 14 (`coin1`–`coin4`).
Clouds (24 × 9), bushes (20 × 7), hills (24 × 10) and the added `hillBig` (48 × 20) sit on the ground line or float at y 16–40.
The castle sprite is 32 × 30, with the pennant on top and a black arched door at cols 13–18.
Flagpole: `lib.flagpole(ctx, gx, gyTop, gyBase)` draws the pole, the `poleBall` and a hard block at the foot, and `flag` (8 × 5, a white banner with a coral spark) flies right of the pole.
Scenes that still draw the pole with `lib.px` and a `sparkle` ball stay valid.

### 10.5 The HUD

`lib.hud(ctx, { score, coins, world, time })` draws the whole bar, so never hand-roll it.
It has two text rows at y 1 and y 9 (ink rows 1–15, `lib.HUD_ROWS`).
The 8 × 8 font needs 15 rows for two lines, so the band grows from rows 2–13 to rows 1–15, and the must-read box still starts at y 16.
The label "CLAW'D" sits over a 6-digit score at x 16.
The blinking coin sits at x 80 with "×NN" at x 88.
"WORLD" sits at x 136 with the world centred under it.
"TIME" sits at x 192 with the countdown right-aligned under it.
Time ticks down 10 per second from 400 at T = 2.0 s (storyboard table).
Keep clouds below y 16 or clear of the HUD columns, because white text on a white cloud disappears.

### 10.6 Mistakes to avoid

- Claw'd has FOUR legs and TWO straight side arms: never 2 legs, never arms akimbo.
- His eyes are black SQUARES: never white, never round.
- Claw'd is coral `clawdOrange` `$26`, never Mario red.
  The princess is pink and cream, never coral.
- The ground is TWO tiles tall with its top face at y = 103, never a single floating row.
- The camera only ever scrolls RIGHT, and the world never moves right-to-left relative to the hero.
- Sprites never rotate, never scale fractionally and never blur (smoothing stays off).
- The sky is one flat `sky` fill: no gradient, no grain, no vignette.
- All text is `lib.pxtext`, never `lib.text` and never system fonts.
- Only `lib.NES` colours: no hex literals, no `lib.mix`, and no alpha blends held on screen.
- No sprite map with a fourth colour.
  Use a transparent pixel or a second sprite instead.
- The HUD always shows the shot's table values: scores never decrease, and coins never reset mid-level.
