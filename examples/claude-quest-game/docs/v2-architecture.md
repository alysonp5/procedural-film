# Claude Quest v2 — architecture and build contract

v1 (`../claude-quest/`, rendered at `exports/v1-nes-floor.mp4`) is the floor. v2 is a different kind of film:
**a real NES-style game, actually played, shown on a real-feeling CRT TV.**
Every agent re-reads this file before it starts and whenever it is unsure. Where this file and older docs
(`CONTRACT.md`, `art-bible.md`, `storyboard.md` — all v1) disagree, this file wins.

## 1. The concept

The film is the attract-mode demo of a lost 1986 cartridge called CLAUDE QUEST, played on a CRT TV.

1. The TV powers on: dark glass, the click, a bright line opens into a snowy picture that rolls and settles.
2. The title screen. The menu cursor sits on 1 PLAYER GAME. START is pressed (the start chime).
3. The black lives screen: WORLD 1-1, Claw'd × 3 (two silent seconds, exactly like the console).
4. World 1-1, **genuinely played by a simulated game engine from a recorded controller tape** (like a TAS or
   an NES demo mode). Everything moves by real physics: sub-pixel velocities, acceleration, skids, jump arcs
   that depend on run speed, enemies that walk off ledges.
5. The castle: WORLD 1-4 lives screen, a firebar, lava, the Big Bug boss on the bridge, the axe, the bridge
   collapsing segment by segment, the boss falling into the lava.
6. Princess Pearl. The ending text. PUSH START TO SHIP IT blinks.
7. The TV powers off: the picture collapses to a line, then a dot that fades. Dark glass. The loop restarts.

The HTML player (`dist/claude-quest.html`) plays the film, and a viewer can **press Enter to take the
controller and play the level themselves** (phase 3; the engine must allow it from day one).

## 2. Hard rules (carried from v1, still enforced by tools/check.cjs)

1. **No media.** The shipped HTML has no images, audio files, fonts, base64, `data:` URLs, `fetch`, `new Image`.
   Every pixel and sample is computed.
2. **Deterministic.** `FILM.renderFrame(T)` draws the same pixels for the same T in any order, cold or warm.
   No `Math.random`, `Date`, `performance.now` in drawing or audio code; randomness from `FILM.lib.rng(seed)`.
3. **Stateless per frame.** A frame may not depend on the previous frame having been drawn. A cache is allowed
   only as a pure function of its inputs — the whole game simulation is such a cache: run once from frame 0
   with the tape, keep every frame's state, look frames up.
4. Output 1920×1080 at 60 fps (4K with `--scale 2`). Plain browser JS, no framework, no npm in the shipped file.
5. **NES truth inside the game.** The native frame buffer uses only `lib.NES` colours; character sprites have
   3 colours + transparent; tiles 3 colours + the shared backdrop. The CRT stage (src/crt.js) is the only thing
   allowed to produce non-palette colours, because it simulates the TV, not the console.
6. **Copyright.** Nothing copies Nintendo. No Mario/Goomba/Koopa/Bowser/Peach bitmaps or traced tiles, no SMB
   melodies, no SMB sound-effect note sequences, no verbatim SMB text ("our princess is in another castle",
   "your quest is over", "thank you Mario"). The grammar, physics feel, structure and idioms of 1985 platformers
   are fair game; the specific expression is ours.

## 3. The frame pipeline

```
tape ──► game engine (src/game) ──► state[f] ──► game.draw(nativeCtx, f) ──► native 320x180 buffer
                                    events[] ──► music.js (APU driver) + foley.js ──► audio buffer
native buffer ──► FILM.crt.present(native, outCtx, {frame f}) ──► 1920x1080 / 3840x2160 output
```

- `FILM.native()` (core.js) returns `{ canvas, ctx, w: 320, h: 180 }`: the console's frame buffer, one canvas
  px per game px. The game repaints every pixel of it every frame.
- `src/scenes/01-game.js` is the glue: `FILM.game.draw(nb.ctx, f)` then `FILM.crt.present(nb.canvas, ctx, {frame, T})`,
  with fallbacks (test card / `FILM.presentNearest`) until those exist. f = global frame index at 60 fps.
- `lib.PX = 1`, `lib.VW = 320`, `lib.VH = 180`. All game geometry is in native px.
- Load order (tools/common.cjs): core.js, lib.js, manifest.js, crt.js, game/*.js (sorted), foley.js,
  timeline.js, scenes/*.js, music.js, player.js.

## 4. Interfaces

### 4.1 Game — `FILM.game` (owner: game agent; files `src/game/*.js`, `src/scenes/*`, `src/timeline.js`)

```js
FILM.game.BUTTONS = { A: 1, B: 2, SELECT: 4, START: 8, UP: 16, DOWN: 32, LEFT: 64, RIGHT: 128 };
FILM.game.create(opts)   // a live engine instance: { step(buttons) -> events[], state(), draw(nativeCtx), frame }
FILM.game.sim()          // cached pure run of the film: { length, states[], events[] } (tape-driven, from frame 0)
FILM.game.draw(ctx, f)   // draw film frame f (clamped to [0, length-1]) into the native buffer
FILM.game.events()       // sim().events — sorted by f
```

The film's length in frames equals `FILM.TIMELINE.duration * 60`; the game agent keeps timeline.js in sync
(target 60–70 s; `crt.powerOn` / `crt.powerOff` windows in frames also live in timeline.js).

### 4.2 Events — the sound contract (game emits, audio consumes)

Every event: `{ f, type, ...data }`, f = global frame at which the sound starts (the frame the thing happens).

| type | data | when |
|---|---|---|
| `song` | `id` | a song starts (replacing the current one) at f. ids: `title`, `overworld`, `underground`, `star`, `flag` (course-clear fanfare), `castle`, `rescue`, `ending`, `none` (silence) |
| `start` | | START pressed on the title |
| `jump` | `big` | player leaves the ground by jumping |
| `stomp` | `combo` (1..) | player lands on an enemy |
| `kick` | `combo` | an enemy is knocked out by a shell / the star / a bumped block |
| `coin` | | a coin is collected (field or popped from a block) |
| `bump` | | the head hits a solid block or a brick while small |
| `brick` | | a brick breaks (big player) |
| `sprout` | | a power-up rises out of a block |
| `powerup` | | the player collects the mushroom (grow) |
| `oneup` | | an extra life |
| `pipe` | | the player enters or leaves a pipe |
| `flagpole` | `height` | the player grabs the pole (slide starts) |
| `tally` | `n` | one tick of the time→score tally (one event per tick) |
| `firework` | | a firework bursts |
| `fireball` | | (optional) a firebar/boss fireball whoosh |
| `bridge` | `i` | one bridge segment collapses |
| `bossfall` | | the boss starts falling |
| `text` | | a line of the ending text appears |

### 4.3 Display — `FILM.crt` (owner: crt agent; files `src/crt.js`, `src/core.js`, `src/player.js`, `tools/*.cjs`)

```js
FILM.crt.present(srcCanvas, outCtx, { frame, T })  // fill outCtx.canvas (any size) with the TV image
FILM.crt.mode       // 'crt' (default) | 'clean' (nearest-neighbour, for comparison and the player toggle)
FILM.crt.backend    // 'webgl2' | 'webgl' | 'cpu' | 'nearest' — tools assert the real path ran
```

Power windows come from `FILM.TIMELINE.crt` (global frames). Deterministic: a pure function of (source pixels, frame).

### 4.4 Audio — `FILM.audio` (owner: audio agent; files `src/music.js`, `src/foley.js`, `tools/audio/*`)

`FILM.audio.render(ctx, { start = 0, dest })` keeps its v1 signature: it synthesises the whole film from
`FILM.game.events()` (NES 2A03 emulation, songs + SFX taking over channels like a real sound driver) plus
the TV foley from `FILM.TIMELINE.crt` (src/foley.js — the only non-NES sound: the TV itself), and schedules it.
Phase 3 adds a live API for the playable mode.

### 4.5 Sprites — `src/manifest.js` + `src/lib.js` (owner: art agent)

`src/manifest.js` lists every sprite name the game uses with its size. Undrawn names blit a magenta placeholder
of that size, so the game builds before the art lands. Character sprites use legend keys `1 2 3` so the game
can palette-swap them: `lib.sprite(ctx, name, x, y, { pal: [c1, c2, c3], flip, flipV, frame })`.
New names may be added to the manifest by the game agent (tell the art agent via your report) or the art agent.

## 5. Ownership (one owner per file; never edit another owner's file)

| Owner | Files |
|---|---|
| game | `src/game/*.js`, `src/scenes/*.js`, `src/timeline.js`, `docs/story.md` |
| art | `src/lib.js`, `src/manifest.js` (append-only for others' requests), `docs/art-bible.md` |
| crt | `src/crt.js`, `src/core.js`, `src/player.js`, `tools/*.cjs` (except `tools/audio/`), `docs/display.md` |
| audio | `src/music.js`, `src/foley.js`, `tools/audio/*`, `docs/sound.md` |
| coordinator | this file, `exports/`, `dist/` |

If you need something in another owner's file, write the request in your final report; the coordinator relays it.

## 6. Story beats and copy (the game agent's script; frame targets are targets, not law)

| ~frames | beat |
|---|---|
| 0–150 | TV power-on over the title screen |
| 150–420 | title: plaque CLAUDE QUEST, ©1986 CLAWD SOFT, cursor on 1 PLAYER GAME, TOP- 000000; START at ~360 |
| 420–540 | black lives screen: WORLD 1-1, Claw'd × 3, HUD on top |
| 540–~2600 | World 1-1, continuous and played: first bug stomp · ? block coin · mushroom sprouts, slides, is caught → the grow flicker · big Claw'd breaks bricks (fragments arc) · pipes of rising height · a pit · a hidden block releases the **Claude spark** (the star) → invincible palette-cycling run through a pack of bugs, star song · a shell-bug stomp + kick combo if time allows (100·200·400·…·1UP) · pipe down into a coin room · out through a sideways pipe · the staircase · a high flagpole jump (5000) · slide · walk into the castle · castle flag rises · time tally · fireworks |
| ~2600–2720 | lives screen: WORLD 1-4 |
| ~2720–3450 | the castle: grey bricks, lava, a rotating firebar, the Big Bug on the bridge hops and roars, Claw'd jumps past it, touches the axe, the bridge collapses (one segment every few frames, one `bridge` event each), the boss falls, Claw'd walks to Pearl |
| ~3450–3690 | ending text (typed on, one `text` event per line): `THANK YOU CLAW'D!` / `EVERY BUG IS SQUASHED` / `AND ALL TESTS PASS.` then `PUSH START TO SHIP IT` blinking |
| 3690–3810 | TV power-off; dark to the end (the loop restarts on a dark set) |

HUD (top 32 native px, SMB layout): `CLAW'D` over the score, coin icon ×NN, `WORLD` over `1-1`, `TIME` over
the count (ticks every 24 frames like the console). Screen: 20 tiles wide, 16 px tiles; ground two tiles tall
at the bottom; about eight tiles of air between the ground and the HUD.

## 7. Verification (everyone)

- `node tools/check.cjs` stays green for your area (tell the coordinator about reds in another owner's area).
- Look at your output: `node tools/snap.cjs --samples 24 --sheet --out .frames/<you>` and read the PNGs.
- Audio: render and measure with `tools/audio/*` (see each tool's header).
- A claim without evidence is not done: paste the command and its output in your report.

## 8. Round 2 — the review fixes and the timing contract (coordinator, after the first full render)

Two fresh critics graded the first render 6/10 (picture) and 6/10 (sound). Their findings
were F1–F20 (picture) and A1–A15 (sound); the reports themselves were scratch files and are not kept.
The headline problems: (1) it reads as a Super Mario Bros reskin — the 1-1 beat order, the title menu text,
the mushroom, a Koopa-like shell bug, a Peach-like princess, the SMB castle, the axe, "THANK YOU ___!";
(2) pacing: play starts at 9 s and the last 11 s barely move; (3) the big moments are undersold; (4) the music
is cut mid-phrase at every payoff (fanfare, rescue, ending) because picture and score were timed independently.

### 8.1 Identity — ours, not Nintendo's (supersedes anything above that conflicts)
- **Level**: re-author World 1-1 and the coin room so no stretch follows SMB 1-1's signature order (lone first
  ? block → brick-?-brick-?-brick row with a ? above; pipes rising 2-3-4-4 in a row; the hidden block after the
  pipes; the triangle of three ? blocks; twin stair pyramids with a pit; the 8-step staircase into the flagpole).
  Genre idioms stay (pipes, ? blocks, bricks, pits, a flagpole goal, a castle). The rhythm and order are ours.
- **Grow item**: a floppy disk (1986! "save your context") instead of a mushroom. Sprite name stays `mushroom`.
- **Shell bug**: a low crawling beetle (not an upright Koopa); its shell after the stomp.
- **Princess Pearl**: teal/white gown, silver tiara, dark hair — nothing like Peach.
- **Axe → the ENTER key**: a big glowing keycap with ⏎ on it. Claw'd presses Enter; the bridge falls.
  Sprite names stay `axe1..3`; the event type stays `bridge`, plus a new `axe` event on the press.
- **Castle**: a new silhouette (not SMB's two-tier block castle).
- **Title**: a Claude-Code-welcome-box plaque (rounded salmon border, a ✻ spark, CLAUDE QUEST), `©1986 CLAWD SOFT`,
  menu `▶ NEW QUEST` / `  CONTINUE`, `HI-SCORE 000000`. No "1 PLAYER GAME / 2 PLAYER GAME / TOP-".
- **Ending**: Pearl's line `YOU DID IT, CLAW'D!`, then a Claude-Code-style completion summary typed at 1 frame
  per character with real counts from the sim: `✻ QUEST COMPLETE` / `✓ NN BUGS SQUASHED` / `✓ NN COINS` /
  `✓ ALL TESTS PASS`, then `PUSH START TO SHIP IT` blinking. (The 8x8 font gains ✻ and ✓.)

### 8.2 The timing contract (game guarantees the frames; audio composes to them)
| moment | rule |
|---|---|
| power-on | `crt.powerOn` = [0, 120]; title readable by ~150 |
| START | pressed ~190–220; lives screen ~90 frames; first playable frame by ~330 (5.5 s) |
| pipe entry | emit `song none` on the pipe-entry frame (the console silences the music) |
| overworld resumes | `song` events carry `section`: `'intro'` (first start only), `'A'` (hook), `'B'`. After the star: `B`. After the coin room: `A`. The audio maps sections to rows. |
| flagpole | the `flagpole` event carries `frames` = the slide length; the slide SFX lasts exactly that. The `flag` fanfare starts when he lands at the pole's foot and lasts **168 frames**; the tally starts only after it ends. |
| boss | new events `hop` (boss hop), `roar` (boss roar), `axe` (Claw'd presses the Enter key). `bossfall` SFX lasts **64 frames**; `rescue` starts no earlier than 64 frames after `bossfall`. |
| rescue | at least **288 frames** (2 bars at 9 frames/16th) before `ending`. Claw'd runs to Pearl in bar 1; the meeting (heart, both hop) in bar 2. |
| ending | the `ending` song is a **256-frame** tag that lands on the tonic; it starts with the first `text` event; `crt.powerOff` starts ≥ 256 frames after `ending` starts, and the tonic rings into the power-off. |
| dead air | no stretch of ≥ 20 frames without motion during play; the lives screens are the only silences. |
| length | target 58–62 s total. |

### 8.3 New events (add to §4.2)
`hop`, `roar`, `axe` (above); `song.section`; `flagpole.frames`; `text.every` (= 1 now).

### 8.4 The "really played" proof (crt)
An NES-controller input display (TAS-video style) in the bottom-right corner during gameplay, fed by
`FILM.game.sim().states[f].btn`, plus a closing caption on the dark glass after the power-off. The TV set itself
is seen (bezel, glass, the room lit by the screen) during the power-on push-in and the power-off pull-out.
