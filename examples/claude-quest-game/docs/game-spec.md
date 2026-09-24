# CLAUDE QUEST: game build spec

Version 1, 2026-09-23.
Synthesised from three designs (content, systems, platform) and three judges' scores.
Every path below is relative to the project root.
This file is the single contract for the seven work packages in section 14.
Where this spec and a design disagree, this spec wins.
Numbers were checked against the engine as it stands today (the film replays with fingerprint `cb881de9`).

## 0. Reading guide

Codes: R rulings, D decisions, F level rules, E engine, X entities, V events, A art, S sound, U shell, W web, T tests, P packages.
"Live" means `W.live === true` (the game).
"Film" means `W.live === false` (the film, the attract demo, the tools).
Distances are native 320x180 pixels, time is 60 Hz frames, and `Q(v) = v / 4096`.
Tile row r has its top at `rowTop(r) = 16r - 12`; the ground rows 10 and 11 fill y 148 to 180; the HUD band is y 0 to 31.

## 1. Rulings and decisions

### 1.1 Rulings (fixed by the coordinator)

- R1 The game lives in `claude-quest-game`. The film project `claude-quest-v2` is never touched.
- R2 World 1 has four levels: 1-1 is the film's 1-1 layout unchanged (so the recorded tape plays as the attract demo) with the coin room as its bonus; 1-2 underground; 1-3 an athletic sky level with moving platforms; 1-4 the castle as a full level ending in the Big Bug, the ENTER-key bridge, Pearl's rescue and the stats ending.
- R3 Assists (coyote time, jump buffer, head-corner correction) are on by default with an NES ACCURATE option. The film and attract path always runs NES-accurate.
- R4 Content: two new enemies, a third power form that throws bouncing projectiles, lives, death, game over, continue, a mid-level checkpoint, pause with a jingle, a clear card per level, 1-UP.
- R5 Shell: title menu NEW QUEST / CONTINUE / OPTIONS; options for CRT, feel, volume, input display, reduced flashing; hi-score, settings and progress in localStorage; an attract demo after idling on the title; keyboard, gamepad and touch; remappable keys; pause on tab hidden; audio unlock on first input; exact 60 Hz stepping on 120/144 Hz displays; CRT with graceful fallback.
- R6 Inside the game everything stays NES-truthful (only `lib.NES` colours in the native buffer, 3-colour character sprites, 320x180, 60 Hz, 2A03 sound) and original (no Nintendo sprites, melodies, SFX note sequences or text). The SMB visual grammar (sky, clouds, pipes, bricks, ? blocks) stays.
- R7 Deploy to a new Vercel project (never overwrite one) as a static site: `index.html` is the self-contained game, plus og image, favicon, share meta, and the film player as `film.html`.
- R8 Proof before shipping: a bot completes every level, determinism checks pass, and Playwright e2e runs against the deployed URL.

### 1.2 Decisions

- D1 One flag gates the game: `W.live`. Every new rule, event, song, mode and mechanic runs only when it is true. There is no `W.rules`.
- D2 Game levels live in a new keyed table `CQ.GAME_DEFS` in `src/game/01-world1.js`. `CQ.LEVEL_DEFS` and `src/game/00-levels.js` are never edited; 1-1 and its coin room reuse the film's row arrays by reference.
- D3 The content base is the content design's World 1 (THE STACK, THE CLOUD, THE KERNEL), revised here: the 1-2 ceiling is closed, the 1-3 spring sits on a low tower and its launch stays below the HUD band, lift ranges are camera-safe, and items sprouted in sky levels do not walk.
- D4 Per-object overrides (firebars, lifts, embers) are keyed by tile position, never by map order.
- D5 Assists: coyote 5 frames, jump buffer 6 frames with A still held on landing, head-corner correction up to 4 px that never applies to hidden blocks. Speeds and arcs never change.
- D6 One damage rule in both feel modes: a hit on big or code Claw'd drops him to small.
- D7 The projectile is the caret (`>`). "Token" means the collectible ✻ medal only.
- D8 Menus (title, options, controls, pause menu) are pure state machines in the shell. The engine keeps only gameplay modes: pause, game over and continue, clear, credits.
- D9 The engine never touches storage. The shell derives every save from gameplay events.
- D10 The game page script `src/shell.js` forks the proven parts of `src/play.js` (key merge, latch, gamepad poll, touch pad, live sound) and moves the fixed-step clock into the pure module `src/game/45-clock.js`. `play.js` and `player.js` stay unchanged as the film page.
- D11 Pause freezes the song inside the audio driver and lets effects play. External pauses (P, Esc, hidden tab, blur, pad disconnect) inject START into the input stream so they stay replayable.
- D12 Hurry-up at 100 time units: a 90-frame jingle, then a faster variant of the level song derived automatically (speed minus 1).
- D13 Level proofs run in both feel modes, with the planner's `o.free: true`.
- D14 The Content-Security-Policy travels as a `<meta>` tag with one sha256 hash per inline script. Share meta is injected after the media scan from a fixed template; the scanner gets no exemption.
- D15 Deploy creates one new Vercel project named `claude-quest` (fallback `claude-quest-game`) and aborts if both exist.

### 1.3 Rejected (do not build)

`W.rules`; appending game levels to `CQ.LEVEL_DEFS`; lift or firebar parameters by map order; a `{ }` brace projectile; "token" as the projectile name; a from-scratch shell replacing `play.js`; iOS `audioSession = 'playback'`; rumble, wake lock, RUN AUTO, a pad layout switch, the add-to-home-screen hint, CRT auto-degrade, orientation lock; `user-scalable=no`; WebKit e2e as a ship gate (optional after the owner approves the browser download); spring launches that put Claw'd's head in the HUD band; items that walk off sky towers; a damage ladder that depends on the feel mode; a 240-frame game over; hand-composed fast variants of every song; an allow-list door in `scanForbidden`; options and remap as engine modes; exporting engine internals wholesale.

## 2. Architecture

### 2.1 Two paths, one `step()`

`CQ.newWorld(opts)` builds a world. `FILM.game.create(opts)` always passes `live: true`. `FILM.game.sim()`, `FILM.game.demo()` and the film pass `live: false`.
Film code paths may be refactored only if the film proofs in 2.2 stay green on every engine commit.
New code in `src/game/1x-*.js` is reached only through the seam in 2.4, and the engine calls the seam only when `W.live` is true.

### 2.2 Film invariance contract

These checks must hold after every change to any `src/game/*.js` file (`tools/proof/film.cjs`, owned by P1):

| Check | Value |
|---|---|
| `fingerprint(sim())` (40-api.js: FNV-1a over every event's `f + type + ';'`, then `'score' + score`) | `cb881de9`, `source === 'recorded'` |
| `sim().length` | 3627 |
| `FILM_SNAP`, the snapshot-stream hash defined below | `8c597014` |
| `record()` (the tape program replayed by the bot) | `fp === 'cb881de9'` and `rle === CQ.RECORDED.rle` |

`FILM_SNAP` (computed today from the untouched engine):

```js
// FNV-1a over one line per film frame, frames 0..3626 of FILM.game.sim().states
function fnv(h, s) { for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 0x01000193); return h; }
function sprStr(spr) {            // names resolved, so interning order never matters
  const out = [];
  for (let k = 0; k < spr.length; k += 5) {
    const n = spr[k];
    const name = n >= 1000 ? 'pop:' + CQ.POPS[n - 1000] : CQ.NAMES[n];
    out.push(name + ',' + spr[k + 1] + ',' + spr[k + 2] + ',' + spr[k + 3] + ',' + spr[k + 4]);
  }
  return out.join(';');
}
function frameStr(s) {
  return [s.m, s.f, s.btn, s.score, s.coins, s.lives, s.top, s.world, s.time, s.lv ? s.lv.def.id : '-', s.chg, s.cam,
    s.lt, s.cflag, s.flagY, s.flash, s.door, (s.hide || []).join('.'), sprStr(s.spr || []),
    s.title ? s.title.started + ':' + s.title.mt : '-',
    s.end ? s.end.lines.join('/') + ':' + s.end.chars.join('.') + ':' + s.end.push : '-'].join('|');
}
let h = 0x811c9dc5 | 0;
for (let f = 0; f < S.length; f++) h = fnv(h, frameStr(S.states[f]) + '\n');
// (h >>> 0).toString(16).padStart(8, '0') === '8c597014'
```

The film's audio must also stay byte-identical (10.4), and `node tools/check.cjs` (gates 1 to 11) stays green on the film build.

### 2.3 Files, owners and load order

`tools/common.cjs` loads `src/game/*.js` in sorted order, so the numeric prefixes are the load order.

| File | Status | Owner | Role |
|---|---|---|---|
| `src/game/00-levels.js` | frozen | none | film levels (`CQ.LEVEL_DEFS`) |
| `src/game/01-world1.js` | new | P3 | `CQ.GAME_DEFS`, `CQ.GAME_ORDER`, the World 1 maps |
| `src/game/10-engine.js` | edit | P1 | engine, routing, modes, feel, items, checkpoint, seam |
| `src/game/12-foes.js` | new | P2 | moth, hover moth, spike beetle, boss upgrade |
| `src/game/13-platforms.js` | new | P2 | lifts, springs, embers |
| `src/game/14-caret.js` | new | P2 | Claw'd Code's carets |
| `src/game/15-tokens.js` | new | P2 | tokens |
| `src/game/20-tape.js` | edit (one export) | P1 | film tape program; exports `CQ.goals` |
| `src/game/21-recorded.js` | frozen | none | the recorded tape |
| `src/game/30-draw.js` | edit | P4 | snapshot painter |
| `src/game/40-api.js` | edit | P1 | `FILM.game` |
| `src/game/45-clock.js` | new | P6 | pure fixed-step clock |
| `src/game/50-menu.js` | new | P6 | pure menu state machines and painters |
| `src/lib.js`, `src/manifest.js` | edit | P4 | sprites, palettes, glyphs |
| `src/music.js` | edit | P5 | songs, effects, driver pause |
| `src/crt.js` | edit | P6 | GL context-loss recovery |
| `src/shell.js` | new | P6 | the game page |
| `src/core.js`, `src/timeline.js`, `src/player.js`, `src/play.js`, `src/foley.js`, `src/scenes/*` | frozen | none | film page |

Build contents (P7):
- Game page `web/index.html`: `core, lib, manifest, crt, game/*.js (sorted), timeline, music, shell`.
- Film page `web/film.html`: today's build (`node tools/build.cjs`), which now also carries the new `src/game` files.

Every new `src` file must pass the existing media scan (no `url(`, `.src =`, `data:`, `base64`, `fetch(`, `import(`, `new Image`, `<link`, `@font-face`, quoted media file names) and check 3 (no `Math.random`, `Date`, `performance.now`, crypto randomness; the word `Date` is banned even inside strings).

### 2.4 The engine seam (P1 exposes, P2 implements)

`10-engine.js` exports a small kit and three registries. Nothing else from the engine is public to the 1x modules.

```js
CQ.K = Object.freeze({
  Q, PH, BUTTONS, rowTop, rowOf, cell, solidAt, headAt, setCell,
  bodyL, bodyR, bodyH, drawH,          // drawH(p) = 24 big, 16 small
  emit, setSong, addScore, pop, popOf, // popOf('200') -> index into CQ.POPS
  comboPoints, hurt,                   // hurt(W, fatal, cause)
  nudgeX,                              // nudgeX(W, lv, p, dx): move p by dx with moveX's wall and camera rules; p.vx unchanged
});
CQ.KINDS = {};    // enemy kinds, filled by 12-foes.js
CQ.systems = [];  // systems, filled by 12..15
CQ.PAL = { STAR1: 1, BUG_U: 5, SHELLBUG_U: 6, CODE: 7, LIFE: 8, BOSS_HIT: 9, MOTH_U: 10, SPIKE_U: 11, FRAG_U: 12 };
CQ.FLAG = { FLIP: 1, FLIPV: 2, BEHIND: 4, BUMP: 16, FEET: 32, RIGHT: 64, LEFT: 128, FLICKER: 256 };
```

The existing `CQ.PAL_BUG_U`, `CQ.PAL_SHELLBUG_U` and `CQ.ANCHOR` stay.

Enemy kind interface (E-KIND). The engine owns spawn, activation at `cam + 328`, despawn, the `dead` fall, star kills, moving-shell kills, bump-from-below knocks (not for fliers), and player contact. A kind supplies:

```js
CQ.KINDS[kind] = {        // kind is 'moth', 'hover' or 'spike'
  top: 12,                 // hitbox is x+2..x+14 by y-top..y
  flier: true,             // no tiles, no gravity, skipped by walker turn-around pairs (moving shells still hit it)
  spiky: false,            // any contact hurts (cause 'spike'), stomps included, unless star
  move(W, lv, e) {},       // replaces walker(lv, e); e.t already incremented
  onStomp(W, lv, e, p) {}, // called by stomp() after p.combo++ and the stomp event; the engine then bounces the player
  sprite(W, lv, e, vf) {}, // returns [name, drawHeight, flags, pal]
};
```

System interface (E-SYS). Every hook is optional. The engine calls them in array order, only for live worlds.

| Hook | Called | Contract |
|---|---|---|
| `spawn[ch](lv, tx, ty, def, W)` | `buildLevel`, per map cell whose char has a spawn entry | returns the char left in the grid (default `'.'`) |
| `build(lv, def, W)` | end of `buildLevel` | read `def` lists (lifts, embers, tokens) keyed by tile |
| `enter(W, lv)` | after `startLevel`, `enterArea`, `exitArea` | reset per-area state on `W` |
| `pre(W, lv, p)` | each unfrozen play frame, before `controlPlayer` | move platforms, carry the rider |
| `support(W, lv, p)` | `moveY` when grounded and no tile is under the feet | `true` keeps him grounded |
| `land(W, lv, p, y0)` | `moveY`, falling, no tile landing this frame | may set `p.y` and return `true`; the engine then calls `land(p)` |
| `grounded(W, lv, p, btn)` | after `moveY` when `p.ground` | springs |
| `input(W, lv, p, btn, pressed)` | after `controlPlayer` when `p.st === 'play'` | fire carets |
| `step(W, lv)` | each unfrozen play frame, after `stepBoss` and before `stepParts` | carets, embers, spit, tokens, boss upgrade (a roar started this frame reads `b.roar === 29`) |
| `sprites(W, lv, out, vf)` | `snapshot`, before the player | push `ni(name), x, y, flags, pal` |
| `cloneLevel(src, dst)`, `cloneWorld(src, dst)` | `cloneLevel`, `cloneWorld` | deep-copy everything the system added |

Engine-side boss fields that P2 may set (defaults keep the film unchanged): `b.hopEvery` (120), `b.dead` (false), `b.hitT` (0), `b.flip` (false). P2 changes walking speed by scaling `b.vx` once; `stepBoss` keeps the magnitude when it turns.
P1 reads them: `stepBoss` hops at `b.t % b.hopEvery === 40`, skips contact damage when `b.dead`; the boss sprite gets pal 9 with FLICKER while `b.hitT > 0` and FLIPV when `b.flip`; `axeSeq` skips `bossfall` when `b.dead` and starts the rescue 16 frames after the last bridge tile instead of 64.
P1 also starts `def.bossSong` (live) on the frame the boss activates.
New player fields, initialised by P1 in `newPlayer`: `coyote` 0, `buf` 0, `code` (from `W.code`), `throwT` 0, `ride` -1. P2 resets `ride` to -1 in its `enter` hook. Hazards in P2 call `K.hurt` only when `p.star === 0 && p.inv === 0`.

### 2.5 Public API (P1, `src/game/40-api.js`)

```js
FILM.game.create(opts) -> {
  step(buttons) -> events[],     // one 60 Hz frame
  state() -> W,                  // read only
  snapshot() -> s,               // section 8
  draw(ctx, view),               // CQ.drawSnap(ctx, s, s.f, false, Object.assign({ now: true }, view))
  frame, mode, pausable,         // getters
}
// opts: start (level id, default '1-1'), feel ('modern' | 'nes', default 'modern'), top (hi-score seed),
//       shellMenu (bool), form ('small' | 'big' | 'code', proofs only), lives (proofs only). live is always true.
FILM.game.demo() -> { step() -> events[], draw(ctx, view), done, frame }   // U5
FILM.game.sim, draw, events, tape, record, BUTTONS                        // unchanged
```

`FILM.game` stays frozen.
`20-tape.js` adds one line, `CQ.goals = { onEvent, stomps, lands, landsPast, collects, then, closeCall, songIs }`, for the level proofs; the film program is unchanged.

### 2.6 Snapshot palette slots and flags

Sprite records stay `[nameIndex, x, y, flags, pal]` in an `Int16Array`.

| pal | Palette (`lib.SPAL`) | Used for |
|---|---|---|
| 0 | the sprite's own | everything |
| 1 to 4 | `clawdStar[0..3]` | star cycle |
| 5, 6 | `bugU`, `shellbugU` | enemies on black backdrops |
| 7 | `clawdCode` | Claw'd Code |
| 8 | `life` | the 1UP floppy (`mushroom` map) |
| 9 | `bossHit` | boss hit flicker |
| 10, 11 | `mothU`, `spikeU` | new enemies on black backdrops |
| 12 | `fragmentU` | brick fragments in `under` levels (live) |

New flag 256 (FLICKER): the draw pass shows `pal` on frames where `(vf >> 2) & 1` is 0 and the sprite's own palette otherwise; with reduced flashing it shows `pal` steadily.

## 3. Game state machine

### 3.1 Engine modes

| Mode | MODE_CODE | Enters | Leaves | Frames |
|---|---|---|---|---|
| `title` | 0 | boot, `showTitle` | START press | untimed |
| `title2` | 0 | START on the title | then `lives` | 20 |
| `lives` | 1 | `title2`, death, clear, continue | then `startLevel(W.pending)` | 90 |
| `play` | 2 | `startLevel` | death, clear, pause, pipes (stay in `play`) | untimed |
| `pause` | 4 (live) | START press while `pausable` | START press | untimed |
| `gameover` | 3 | lives reach 0 | film: `showTitle`; live: `continue` | 180 |
| `continue` | 5 (live) | after `gameover` | CONTINUE or END | untimed |
| `clear` | 6 (live) | after the goal fireworks | then `lives` for `def.next` | 150 |
| `credits` | 7 (live) | START after the ending text | START, or auto after the hold | 672-frame parade (START skips it), then the final card; START accepted 60 frames into the card; auto-return 3600 frames into the card |

Scripted player states inside `play` keep their film timings: grow freeze 60, pipe dark 12, flagpole slide `ceil((rowTop(9) - p.y) / 3)`, fanfare 168, time tally 10 units a frame, fireworks every 16, dead 180 (hop at 30), bridge 4 frames a tile, boss fall 64, rescue 288.

`pausable` = `W.live && W.mode === 'play' && p.st === 'play' && W.freeze === 0 && !W.goal && !W.seq && !W.ending`.

In `pause`, `step()` changes only `W.f`, `W.prev`, `W.btn`, `W.ev`, and on a START press sets `mode = 'play'` and emits `unpause`. `W.vf`, `W.mt`, `lv.t`, the timer, `W.flashN` and every clock hold.

`continue` inputs: UP, DOWN or SELECT press toggles `W.cont.sel` (emits `cursor`); A or START confirms.
CONTINUE: `lives = 3`, `score = 0`, `coins = 0`, `continues++`, checkpoint cleared, power small, emits `continue {id}`, then `lives` for the main level. Tokens collected in the run are kept.
END: emits `quit`, then `showTitle`.

### 3.2 Shell states

| State | Engine console | Input goes to | Leaves |
|---|---|---|---|
| `boot` | none | none | first frame drawn, then `title` |
| `title` | title console, stepped with 0 | `CQ.menu.step` (title) | NEW QUEST, CONTINUE, OPTIONS, idle 1080 frames to `demo` |
| `options` | unchanged underneath | `CQ.menu.step` (options) | BACK or B |
| `controls` | unchanged underneath | `CQ.menu.step` (controls), raw key capture while binding | BACK |
| `demo` | `FILM.game.demo()` | any button edge ends it (consumed) | `title` |
| `game` | game console | the console | engine enters `pause` (to `paused`), engine returns to `title` (to `title`) |
| `paused` | game console in `pause`, stepped with 0 | `CQ.menu.step` (pause); START resumes | RESUME, QUIT, OPTIONS |

NEW QUEST creates `create({ start: '1-1', feel, top, shellMenu: true })` and sends START on its first step.
CONTINUE creates the same with `start: save.reach`.
When the engine goes back to `title` by itself (END, credits), the shell adopts that console as the title console.

### 3.3 Flow

```
boot -> title --NEW QUEST / CONTINUE--> title2 (20) -> lives (90) -> play
play --START--> pause --START--> play
play --flag--> fanfare, tally, fireworks -> clear (150) -> lives -> next level
play --pipe--> sub-area (same clock) --side pipe--> parent at its pipeUp, or the exit yard
play --death--> dead (180) -> lives (90) -> play at the checkpoint or start
      \-> lives 0 -> gameover (180) -> continue --CONTINUE--> lives -> main level start
                                                 \--END--> title
1-4 --ENTER key--> bridge, boss fall, rescue (288) -> ending text -> START -> credits -> START -> title
title --idle 1080--> demo --any input / flagpole+180 / cap--> title
```

### 3.4 New timing constants

| Constant | Value | Where |
|---|---|---|
| `COYOTE_FRAMES` | 5 | E-feel |
| `BUFFER_FRAMES` | 6 | E-feel |
| `CORNER_PX` | 4 | E-feel |
| `CODE_FREEZE` | 30 | terminal pickup |
| `THROW_POSE` | 8 | caret throw pose |
| `HURRY_AT` | 100 time units | hurry |
| `HURRY_JINGLE` | 90 | hurry |
| `CLEAR_FRAMES` | 150 | clear card |
| `GAMEOVER_FRAMES` | 180 | unchanged |
| `CREDITS_ROLL` | 672 (seven bars of the `credits` song; fireworks on frames 96, 288, 480, 576) | credits |
| `CREDITS_HOLD` | 3600 | credits auto-return |
| `FALL_DELAY` | 20 | falling lifts |
| `ATTRACT_IDLE` | 1080 (18 s) | shell |
| `DEMO_AFTER_FLAG` | 180 | demo |
| `DEMO_CAP` | 2400 demo frames after the first play frame | demo |
| `REMAP_TIMEOUT` | 300 | shell |
| `TOAST_FRAMES` | 150 | shell |

## 4. World 1

### 4.1 Level rules (checked by `tools/levels-lint.cjs` and the bots)

Measured with the engine in NES-accurate mode, perfect last-frame takeoff, A held (tiles, edge to edge):

| Landing height change (tiles) | -5 | -4 | -3 | -2 | -1 | 0 | +1 | +2 | +3 | +4 | +5 |
|---|---|---|---|---|---|---|---|---|---|---|---|
| Walk-speed jump, max gap | 7 | 7 | 6 | 6 | 6 | 5 | 5 | 4 | 4 | 3 | none |
| Run-speed jump, max gap | 12 | 11 | 10 | 10 | 9 | 8 | 8 | 7 | 7 | 6 | none |

Apex rise: standing 62 px, walk 66.3 px, run 77.5 px. Air time: walk 57 frames (89 px), run 55 frames (141 px).

- F1 A required gap is at most walk-max minus 1; an optional or finale gap at most run-max minus 2. A jump off a lift counts as a walk-speed jump.
- F2 A required climb is at most 3 tiles; a 4-tile climb only on optional routes.
- F3 No standing surface (a solid tile top with air above, a lift top at its highest) has its top above y 68 (row 5 is the highest allowed), so big Claw'd standing anywhere keeps his whole drawing below the HUD band.
- F4 Every lift top stays at least 32 px below any solid tile over its path.
- F5 Every token and 1UP has a listed route (4.10).
- F6 A ceiling (row 3) has no opening within 6 columns of a standing surface whose top is in row 7 or above (row number 7 or less), so nobody can climb onto the ceiling and walk inside the HUD band.
- F7 A horizontal lift travels at most 112 px, so the forward-only camera (which trails the player by 120 px) never pushes a rider off.
- F8 A held spring launch peaks with his feet at y ≥ 56, so big Claw'd's drawing top stays at y ≥ 32.

### 4.2 Legend additions

| Char | Meaning | Solid | Drawn as |
|---|---|---|---|
| `N` | ? block holding a 1UP | yes | the ? shimmer |
| `+` | hidden 1UP block (head bumps only, like `*`) | head only | nothing until bumped |
| `C` | multi-coin brick | yes | the kind's brick |
| `S` | spring (stays in the grid as a solid tile) | yes | `spring1..3` sprite |
| `T` | server-rack tower cap (sky) | yes | `t_rackTop` |
| `R` | server-rack tower body (sky, background) | no | `t_rack` |
| `#` in sky | cloud walkway | yes | `t_cloudTop` |
| `B` in castle | breakable castle brick | yes | `t_brickC` |
| `m` | moth spawn | spawn | entity |
| `n` | hover moth spawn | spawn | entity |
| `s` | spike beetle spawn | spawn | entity |
| `t` | token spawn | spawn | entity |

`SOLID` gains `N C T S`; `headAt` also treats `+` as solid.
None of these characters appears in a film map.
Tokens in a map are numbered by column, left to right, starting at `def.tokenBase` (default 0).
In `01-world1.js`, `W12`, `W12B`, `W12X`, `W13` and `W14G` are the row arrays printed in 4.6 to 4.9, copied exactly (`tools/levels-lint.cjs` re-checks them); P3 may change geometry only within F1 to F8 and lists every change in its handoff.

### 4.3 `GAME_DEFS` schema

```js
{
  id, name,               // '1-2', 'THE STACK' (name is shown on the lives screen, the pause panel and the clear card)
  world, kind, rows, time, song, start, // as the film; kind adds 'sky'; start.drop: head starts at start.y, falling
  main,                   // the main level this area belongs to (default: id)
  next,                   // level id after the flagpole clear
  respawn,                // where a death in this area restarts (default: main)
  mid: { tx, row },       // checkpoint post column and the floor row it stands on
  pipeDown: { tx, to },   // DOWN on this pipe enters area `to` at its start
  pipeUp: { tx },         // where a returning side pipe lets him out
  pipeSide: { tx, row, to, at },  // RIGHT into this mouth; at: 'pipeUp' rises from the target's pipeUp
  pole, castle, scenery, bridge, axe, camLock, decor,  // as the film
  boss: { tx, range, hp },          // hp 5 in live play
  bossSong,               // song set when the boss activates
  firebars: [{ tx, ty, dir, phase, step, n }],  // keyed by the f block's cell
  lifts: [...],           // X3
  embers: [{ tx, period, phase }],
  tokens: [[tx, ty, bit]],// overlay tokens for maps that must stay byte-identical
  tokenBase,              // first token bit for 't' chars in this map
}
CQ.GAME_ORDER = ['1-1', '1-2', '1-3', '1-4'];  // main levels, for CONTINUE and progress
```

### 4.4 Routing (live)

| From | Trigger | To | Arrival |
|---|---|---|---|
| title2 | START | `W.startId` (default `'1-1'`) | lives screen, then start or checkpoint |
| 1-1 | pipe at 134 | `1-1b` (fresh) | drops from the ceiling gap |
| 1-1b | side pipe at 15 | `1-1` (the same level object) | rises from pipe 148 |
| 1-1 | flagpole | clear, then `1-2` | |
| 1-2 | pipe at 90 | `1-2b` (fresh) | drops from the ceiling gap |
| 1-2b | side pipe at 15 | `1-2` (the same level object) | rises from pipe 128 |
| 1-2 | side pipe at 200 | `1-2x` (fresh) | rises from pipe 2 |
| 1-2x | flagpole | clear (card says 1-2), then `1-3` | |
| 1-3 | flagpole | clear, then `1-4` | |
| 1-4 | ENTER key | rescue, ending, credits | |
| any area | death | `def.respawn` or `main` | checkpoint if passed, else start |

`W.areas` holds at most the current area and, inside a sub-area entered by a down pipe, its parent. A side pipe to a new area drops the parent.
A pipe transition keeps the running clock (the film's behaviour); a sub-area's `time` field is unused.
Songs on arrival: the area's `song`, with section `'A'` for `over` kinds (the film's exit-bonus rule).

### 4.5 1-1 HELLO, WORLD (the film's map, unchanged)

```js
'1-1': Object.assign({}, CQ.LEVEL_DEFS[0], {
  name: 'HELLO, WORLD', main: '1-1', next: '1-2',
  pipeDown: { tx: 134, to: '1-1b' },
  mid: { tx: 80, row: 10 },                 // before the star run
  tokens: [[66, 3, 0], [176, 3, 1]],        // over the brick canopy; over the high platform
}),
'1-1b': Object.assign({}, CQ.LEVEL_DEFS[1], {
  id: '1-1b', name: 'HELLO, WORLD', main: '1-1', respawn: '1-1',
  pipeSide: { tx: 15, row: 8, to: '1-1', at: 'pipeUp' },
  tokens: [[10, 4, 2]],                     // over the hump
}),
```

Rows and scenery are the film's arrays by reference; no character of the film maps changes.
Everything else is the film's 1-1: floppy gateway, hidden spark at 76, star run, the coin room, shell bowling, flagpole, castle.

### 4.6 1-2 THE STACK (underground, 204 tiles)

| Cols | Beat | Content |
|---|---|---|
| 0-19 | Drop-in hall | He drops through the ceiling gap (cols 1-2). `?M?` at 12-14 (row 6), a bug at 17. |
| 20-39 | Stack columns | Brick columns 2, 3 and 4 tiles high (24, 28-29, 33) rising like a call stack; climb h3 then hop h4. Bugs at 26, 31, 37. Coins cap the columns. |
| 40-55 | Spike trench (teach) | The spike beetle is trapped between walls at 42 and 47; the 4-tile hop over it passes 4 coins. A second beetle patrols 48-55 under a `?` at 51. |
| 56-79 | Twin corridors | Step at 56 up to a brick deck (58-73, row 7). Upper route: coins, hidden 1UP `+` at 67 (row 5), token at 72 (row 4). Lower route: three bugs and the multi-coin brick `C` at 71. Big Claw'd can break the deck. |
| 80-99 | Checkpoint | Checkpoint at 82. `??` at 86-87. Pipe down at 90-91 to the cellar. Shell-bug at 97 (the ammunition). |
| 100-127 | Shell alley (test) | `B?B` at 107-109, coins at 104-106. Bug line 110-116, a shell-bug at 120, bugs at 124 and 126. A moth drifts in at head height (118). The shell rebounds off the pipe at 128 (twist). |
| 128-151 | Island hop | Pipe back up from the cellar at 128. Three 3-wide islands over 3-wide pits; a spike beetle sentry walks the middle island (143-145). Coins over the first pit. |
| 152-175 | The elevator | Pit 152-163 crossed on two vertical lifts in opposite phase; the token at 162 (row 4) is taken by a hop off V2 at its top; landing ledge 164-175 (top y 100). |
| 176-203 | Exit hall | `?` at 183 and 186, bugs at 181 and 184, the sideways exit pipe (mouth 200) and a vertical pipe up through the ceiling. |

```js
//      0         1         2         3         4         5         6         7         8         9         0         1         2         3         4         5         6         7         8         9         0   
//      012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123
/* 0*/ '............................................................................................................................................................................................................',
/* 1*/ '............................................................................................................................................................................................................',
/* 2*/ '............................................................................................................................................................................................................',
/* 3*/ 'W..WWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWW{}',
/* 4*/ 'W...............................ooo.....................................t.........................................................................................t.......................................{}',
/* 5*/ 'W...........................oo.............oooo.............ooooo..+.ooo..................................................................................................................................{}',
/* 6*/ 'W...........?M?.........o........W.................?..................................??...................B?B.........................................................................?..?...............{}',
/* 7*/ 'W...........................WW...W........................BBBBBBBBBBBBBCBB............................................m...............ooo...........................WWWWWWWWWWWW..........................{}',
/* 8*/ 'W.......................W...WW...W........W....W........W.................................[]............ooo.....................[]..................................WWWWWWWWWWWW........................h-j}',
/* 9*/ 'W................g......W.g.WW.g.W...g....W..s.W.....s..W.....g.g.g.......................{}.....k............g.g.g.g...k...g.g.{}..............s...................WWWWWWWWWWWW.....g..g...............H_J}',
/*10*/ '######################################################################################################################################...###...###...###............########################################',
/*11*/ '######################################################################################################################################...###...###...###............########################################',
```

```js
'1-2': { id: '1-2', name: 'THE STACK', world: '1-2', kind: 'under', rows: W12, time: 400, song: 'underground',
  start: { x: 20, y: 36, drop: true }, mid: { tx: 82, row: 10 },
  pipeDown: { tx: 90, to: '1-2b' }, pipeUp: { tx: 128 },
  pipeSide: { tx: 200, row: 8, to: '1-2x', at: 'pipeUp' },
  lifts: [
    { k: 'v', tx: 153, w: 3, y0: 100, y1: 148, speed: 0.5, phase: 0 },   // V1
    { k: 'v', tx: 158, w: 3, y0: 84, y1: 132, speed: 0.5, phase: 48 },   // V2, opposite phase
  ] },
```

### 4.7 1-2b STACK OVERFLOW and 1-2x the exit yard

The cellar holds 15 coins in a 5x3 block and a token over the `GG` step; it leaves by the same side-pipe profile as the coin room.

```js
//      0         1
//      01234567890123456789
/* 0*/ '....................',
/* 1*/ '....................',
/* 2*/ '....................',
/* 3*/ 'W..WWWWWWWWWWWWWW{}W',
/* 4*/ 'W...........t....{}W',
/* 5*/ 'W....ooooo.......{}W',
/* 6*/ 'W....ooooo.......{}W',
/* 7*/ 'W....ooooo.GG....{}W',
/* 8*/ 'W..........GG..h-j}W',
/* 9*/ 'W..........GG..H_J}W',
/*10*/ 'GGGGGGGGGGGGGGGGGGGG',
/*11*/ 'GGGGGGGGGGGGGGGGGGGG',
```

```js
'1-2b': { id: '1-2b', name: 'THE STACK', world: '1-2', kind: 'under', rows: W12B, time: 0, song: 'underground',
  main: '1-2', respawn: '1-2', start: { x: 20, y: 36, drop: true },
  pipeSide: { tx: 15, row: 8, to: '1-2', at: 'pipeUp' }, tokenBase: 2 },
```

The exit yard: he rises from a pipe into daylight, climbs a five-step stair to a 4-wide top (row 5, y 68) and jumps 3 tiles to the pole; a jump off the top reaches the 5000 grab.

```js
//      0         1         2         3
//      012345678901234567890123456789012345
/* 0*/ '....................................',
/* 1*/ '....................................',
/* 2*/ '....................................',
/* 3*/ '....................!...............',
/* 4*/ '....................|...............',
/* 5*/ '.............XXXX...|...............',
/* 6*/ '............XXXXX...|...............',
/* 7*/ '...........XXXXXX...|...............',
/* 8*/ '..[]......XXXXXXX...|...............',
/* 9*/ '..{}.....XXXXXXXX...X...............',
/*10*/ '####################################',
/*11*/ '####################################',
```

```js
'1-2x': { id: '1-2x', name: 'THE STACK', world: '1-2', kind: 'over', rows: W12X, time: 0, song: 'overworld',
  main: '1-2', respawn: '1-2', next: '1-3', pipeUp: { tx: 2 }, pole: 20, castle: 26,
  scenery: [['cloud2', 5, 44], ['cloud1', 27, 40], ['bush2', 22]] },
```

### 4.8 1-3 THE CLOUD (sky, 191 tiles, bottomless)

Literal cloud computing: server-rack towers (`T` cap, `R` body) over a light sky (`$21`), cloud walkways at the start and goal, clouds drifting behind (scenery only, y 40 to 64 so they never read as platforms).
Items that sprout in a `sky` level stay where they sprouted (X6).

| Cols | Beat | Content |
|---|---|---|
| 0-26 | First steps | Start cloud 0-10; towers T1 (14-17, cap row 8) and T2 (21-23, cap row 6) with coin rows. |
| 27-50 | The spring (secret) | Low tower T3 (27-32, top y 148) with a bug, the spring at 33 flush with it, long low tower T4 (34-48). A held-A bounce from the spring (rise 86 px) lands on the cloud bank at 37-42 (row 5): 5 coins and a token. Nothing else reaches the bank: T3 and T4 are 80 px below it and H1 starts 8 tiles away. |
| 51-61 | Drift lift | H1 (row 8, x 816 to 928) to T6. |
| 62-80 | Moth gap | T6 (62-65), a moth flying in at 67; T7 (68-70, cap row 6); a hover moth over the gap at 72; T8 (74-77). |
| 81-89 | Checkpoint rack | T9 (81-88), checkpoint at 82, `?M?` at 84-86, a shell-bug at 87. |
| 90-110 | Falling packets | Four falling lifts at 90, 94, 98, 102 on alternating heights (132, 116), a coin over each; T10 (107-110) with the 1UP block `N` at 108. Running without a pause crosses them. |
| 111-126 | Twin elevators (twist) | V1 (112-114) and V2 (117-119) in opposite phase up to high tower T11 (122-125, cap row 5); token at 125 (row 3). |
| 127-139 | Tower bowling | T12 (128-136): a shell-bug at 129, bugs at 133 and 135. Kick the shell to clear the tower. |
| 140-167 | Moth swarm (finale) | T13 (140-147); H2 (row 8, x 2384 to 2480) under three moths (149, 153, 157); token at 153 (row 4); T14 (159-163) with a spike beetle sentry. |
| 168-190 | Goal | A 4-tile drop to the goal cloud, a 3-step stair (173-175), the pole at 180, the castle at 186. |

```js
//      0         1         2         3         4         5         6         7         8         9         0         1         2         3         4         5         6         7         8         9
//      01234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890
/* 0*/ '...............................................................................................................................................................................................',
/* 1*/ '...............................................................................................................................................................................................',
/* 2*/ '...............................................................................................................................................................................................',
/* 3*/ '.............................................................................................................................t......................................................!..........',
/* 4*/ '.....................ooo.............ooooot..........................................................................................................m...t..........................|..........',
/* 5*/ '.....................................######........................m......................................................TTTT...............................m......................|..........',
/* 6*/ '..............oooo...TTT............................................TTT.n...........?M?....o...o...o...o....N.............RRRR...........................m.......s..................|..........',
/* 7*/ '.....................RRR............................................RRR...................................................RRRR...k...g.g.......................TTTTT...........X....|..........',
/* 8*/ '..............TTTT...RRR......................................TTTT..RRR...TTTT.........k..................................RRRR..TTTTTTTTT......................RRRRR..........XX....|..........',
/* 9*/ '..............RRRR...RRR......g...............................RRRR..RRR...RRRR...TTTTTTTT..................TTTT...........RRRR..RRRRRRRRR...TTTTTTTT...........RRRRR.........XXX....X..........',
/*10*/ '###########...RRRR...RRR...TTTTTTSTTTTTTTTTTTTTTT.............RRRR..RRR...RRRR...RRRRRRRR..................RRRR...........RRRR..RRRRRRRRR...RRRRRRRR...........RRRRR....#######################',
/*11*/ '###########...RRRR...RRR...RRRRRRTRRRRRRRRRRRRRRR.............RRRR..RRR...RRRR...RRRRRRRR..................RRRR...........RRRR..RRRRRRRRR...RRRRRRRR...........RRRRR....#######################',
```

```js
'1-3': { id: '1-3', name: 'THE CLOUD', world: '1-3', kind: 'sky', rows: W13, time: 400, song: 'sky', next: '1-4',
  start: { x: 40, y: 148 }, mid: { tx: 82, row: 9 }, pole: 180, castle: 186,
  lifts: [
    { k: 'h', tx: 51, y: 116, w: 3, x1: 928, speed: 1, phase: 0 },       // H1, 112 px
    { k: 'fall', tx: 90, y: 132, w: 3 }, { k: 'fall', tx: 94, y: 116, w: 3 },
    { k: 'fall', tx: 98, y: 132, w: 3 }, { k: 'fall', tx: 102, y: 116, w: 3 },
    { k: 'v', tx: 112, w: 3, y0: 84, y1: 132, speed: 0.5, phase: 0 },   // V1
    { k: 'v', tx: 117, w: 3, y0: 68, y1: 116, speed: 0.5, phase: 48 },  // V2, opposite phase
    { k: 'h', tx: 149, y: 116, w: 3, x1: 2480, speed: 1, phase: 0 },    // H2, 96 px
  ],
  scenery: [['cloud3', 2, 40], ['cloud1', 16, 56], ['cloud2', 30, 44], ['cloud3', 54, 64], ['cloud1', 78, 40],
    ['cloud2', 96, 52], ['cloud3', 118, 44], ['cloud1', 138, 60], ['cloud2', 160, 40], ['cloud3', 176, 52], ['bush3', 1]] },
```

### 4.9 1-4 THE KERNEL (castle, 176 tiles)

Cols 0-47 are the film's 1-4 entrance, copied cell for cell (entry platform, pit 18-20, hall firebar at 27, pit 36-37, firebar at 44).

| Cols | Beat | Content |
|---|---|---|
| 0-47 | The gate | The film's entrance; live play adds an ember in each pit. |
| 48-63 | Compile hall | A 10-ball floor firebar (radius 72 px, 160-frame turn) on a 1-tile block at 55 that must be hopped; a short ceiling bar at 61 turning the other way. |
| 64-79 | Lava lake | A 14-tile lake; a drift lift (row 8, x 1056 to 1168) with embers at 69 and 75 half a period apart; token at 72 (row 5), taken from the lift. |
| 80-95 | Safe room | Checkpoint at 82, `M?` at 85-86 (the terminal when big), hidden 1UP `+` at 91, two torches. |
| 96-119 | Spike gallery | Low ceiling (48 px of headroom), spike beetles at 100, 108, 114. Breakable bricks at 104-105 hide a pocket with 3 coins and a token at 105 (row 5): big only. |
| 120-135 | Ember pillars | Three 3-wide lava pools with an ember each (40-frame stagger), two 2-wide pillars (top y 116); token at 130 (row 5). |
| 136-175 | The bridge | Step up, a 14-tile bridge (140-153) over lava, the Big Bug pacing 142-151, the chain at 153, the ENTER key at 156, Pearl's room 157-175 with Pearl at 169. |

```js
//      0         1         2         3         4         5         6         7         8         9         0         1         2         3         4         5         6         7
//      01234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789012345
/* 0*/ '................................................................................................................................................................................',
/* 1*/ '................................................................................................................................................................................',
/* 2*/ '................................................................................................................................................................................',
/* 3*/ 'wwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwww..................ww',
/* 4*/ 'wwwwwwwwwwwwwwwwwwwwwwww..........wwwwww........wwwwwwwwwwwwwwww................................wwwwwwwwoowwwwwwwwwwwwww......................................................ww',
/* 5*/ '..........wwwwwwww..................ww.......................f..........t.......................wwwwwwwwotwwwwwwwwwwwwww..........t...........................................ww',
/* 6*/ '...........................f................f........................................M?....+....wwwwwwwwBBwwwwwwwwwwwwww......................................................ww',
/* 7*/ '#####....................................................................................................................................................%..A.................ww',
/* 8*/ '#####........................................................................................................................##...##....####==============###.................ww',
/* 9*/ '#####..................................................f............................................s.......s.....s..........##...##....####..............###............p....ww',
/*10*/ '##################LLL###############LL############################LLLLLLLLLLLLLL##########################################LLL##LLL##LLL#####LLLLLLLLLLLLLL######################',
/*11*/ '##################lll###############ll############################llllllllllllll##########################################lll##lll##lll#####llllllllllllll######################',
```

```js
'1-4': { id: '1-4', name: 'THE KERNEL', world: '1-4', kind: 'castle', rows: W14G, time: 400, song: 'castle',
  start: { x: 24, y: 100 }, mid: { tx: 82, row: 10 },
  bridge: [140, 153], axe: 156, boss: { tx: 150, range: [142, 151], hp: 5 }, bossSong: 'boss', camLock: 2208,
  firebars: [
    { tx: 27, ty: 6, dir: 1, phase: 0, step: 4 }, { tx: 44, ty: 6, dir: -1, phase: 24, step: 3 },   // the film's two
    { tx: 55, ty: 9, n: 10, dir: -1, phase: 8, step: 5 }, { tx: 61, ty: 5, dir: 1, phase: 16, step: 3 },
  ],
  lifts: [{ k: 'h', tx: 66, y: 116, w: 3, x1: 1168, speed: 1, phase: 0 }],
  embers: [
    { tx: 19, period: 180, phase: 90 }, { tx: 36, period: 180, phase: 0 },
    { tx: 69, period: 150, phase: 0 }, { tx: 75, period: 150, phase: 75 },
    { tx: 123, period: 120, phase: 0 }, { tx: 128, period: 120, phase: 40 }, { tx: 133, period: 120, phase: 80 },
  ],
  decor: [
    { n: 'torch', x: 196, y: 100 }, { n: 'torch', x: 548, y: 92 }, { n: 'torch', x: 1348, y: 100 }, { n: 'torch', x: 1508, y: 100 },
    { n: 'banner', x: 2548, y: 44 }, { n: 'banner', x: 2764, y: 44 }, { n: 'torch', x: 2578, y: 100 }, { n: 'torch', x: 2758, y: 100 },
  ] },
```

The boss fight (live only):
1. The boss song starts when the boss activates (it comes within `cam + 320`).
2. The Big Bug keeps its pace (turn every 64), hop and roar (`t % 150 === 100`). On each roar it also spits one arcing fireball (X2).
3. Five caret hits kill it (X2); at 2 HP or less it enrages.
4. Pressing the ENTER key still runs the chain and the bridge collapse; if the boss is already dead there is no boss fall and the rescue starts 16 frames after the last bridge tile.
5. Small or big Claw'd without carets wins the classic way: past the boss to the key.

### 4.10 Tokens, checkpoints and secrets

| Level | Token bit 0 | Token bit 1 | Token bit 2 | Other secrets |
|---|---|---|---|---|
| 1-1 | (66, 3) jump from the brick canopy top | (176, 3) jump from the high platform | 1-1b (10, 4) jump from the hump | hidden spark at 76; the coin-room pipe |
| 1-2 | (72, 4) upper corridor, hop from the deck | (162, 4) hop off V2 at its top | 1-2b (12, 4) hop from the `GG` step | hidden 1UP (67, 5) from the deck; multi-coin `C` (71, 7) from below; the cellar pipe at 90 |
| 1-3 | (42, 4) walk the cloud bank (spring only) | (125, 3) hop on T11 | (153, 4) hop off H2 under the moths | 1UP `N` (108, 6); the pole's 5000 grab from the stair |
| 1-4 | (72, 5) hop off the lake lift | (105, 5) break the bricks when big, jump into the pocket | (130, 5) hop on the second pillar | hidden 1UP (91, 6); the 5-caret boss kill (5000) |

A collected token stays collected for the rest of the run (deaths and continues included) and never respawns.
All 12 need big Claw'd in the 1-4 spike gallery; the pause panel and the clear card show which tokens are missing.
Checkpoints: 1-1 (80, row 10), 1-2 (82, row 10), 1-3 (82, row 9), 1-4 (82, row 10).

### 4.11 Pacing and counts

| Level | Taught safely | Tested | Twist | Finale | Clean run |
|---|---|---|---|---|---|
| 1-1 | run, stomp, power-up, star | pits, bug packs | pipe shortcut | flagpole | 100 s |
| 1-2 | spike beetle (trapped) | twin corridors, island sentry | shell rebounds off the pipe | elevator, exit yard | 120 s |
| 1-3 | lifts (safe floor under the first) | moth gap, falling packets | twin elevators | moth swarm | 130 s |
| 1-4 | embers, the long firebar | lava-lake lift | spike gallery under a low ceiling | the boss (5 carets or the key) | 150 s |

Enemies: 1-2 has 15 bugs, 2 shell-bugs, 3 spike beetles, 1 moth. 1-3 has 3 bugs, 2 shell-bugs, 4 moths, 1 hover moth, 1 spike beetle, 8 lifts, 1 spring. 1-4 has 3 spike beetles, 4 firebars, 7 embers, 1 lift and the boss.
Loose coins: 1-2 24, 1-2b 15, 1-3 16, 1-4 3.

## 5. Physics and feel

### 5.1 Unchanged

The `PH` table, skid, air control, fall cap 4, stomp bounce, enemy speeds, the forward-only camera and every film timing stay as they are in both feel modes.

### 5.2 Assists (live, `W.feel === 'modern'`; `W.assist = W.live && W.feel === 'modern'`)

- E-coyote. When `moveY` finds the ground gone without a jump (the walked-off branch), set `p.coyote = 5`. It counts down once per airborne frame. An A press while `!p.ground && p.coyote > 0 && !p.jumped` performs a ground jump: the jump row from the current `|vx|`, `airMax` from the run state, the `jump` event. Any jump, landing or stomp clears it. Riding off a lift's end also sets it.
- E-buffer. An A press while airborne with no coyote jump sets `p.buf = 6`. It counts down every frame. On a grounded frame, `W.assist && p.buf > 0 && (btn & A)` counts as an A press. Releasing A before landing cancels it (the held test fails), so jump height stays variable. A jump, a stomp bounce, pause entry and death clear it.
- E-corner. In `moveY`'s head check with `vy <= -1`: if the centre probe is clear and exactly one edge probe hits, and the hit cell is not `*` or `+`, compute the shift that clears that edge (`(col + 1) * 16 - lx` to the right for a left hit, `-(rx - col * 16 + 1)` for a right hit). If `|shift| <= 4` and after the shift all three head probes are clear and moveX's wall probes are clear, apply the shift, skip the bump and keep `vy`. Otherwise bump as normal.

Proofs for both feel modes are required (T2); an assist may open a route but no route may depend on one.

### 5.3 NES ACCURATE

`W.feel === 'nes'` runs today's code exactly. The film and the attract demo always run with `W.live === false`, so no assist can ever touch them.
FEEL is chosen on the title's OPTIONS screen and is fixed for a run (the pause menu's OPTIONS hides the row), so a run is fully described by its create options and its button tape.

## 6. Entities (live only)

P1 builds X6 (items and blocks), X9 (checkpoint) and 6.10 inside the engine, plus the spawn of `m`, `n` and `s` enemies.
P2 builds X1 to X5, X7 and X8 behind the seam in 2.4.

### 6.1 X1 enemies

| Kind (char) | Hitbox | Motion | Contact | Killed by | Score |
|---|---|---|---|---|---|
| `moth` (`m`) | x+2..x+14, y-12..y | `vx = -0.75` (`Q(0xC00)`), `y = y0 + SIN64[e.t & 63]` (±16 px, 64 frames); passes through tiles; no gravity | side contact hurts (cause `enemy`); a stomp kills it | stomp (combo), caret, star, moving shell | combo; 200 by caret |
| `hover` (`n`) | same | x fixed; `y = y0 + 2 * SIN64[(lv.t >> 1) & 63]` (±32 px, 128 frames, locked to `lv.t` so the bot can time it); faces the player | same | same | same |
| `spike` (`s`) | x+2..x+14, y-12..y | edge walker at 0.5: turns at walls and never walks off a ledge (turns when the cell under its leading foot is not solid) | any contact hurts (cause `spike`), stomps included, unless star | caret, star, moving shell, a block bumped under it | 200 by caret; combo otherwise |

`y0` is the spawn cell's feet line `rowTop(r) + 16`. A stomped moth enters the `dead` fall with `vy = 0`, counts a bug and scores the stomp combo.
Palettes: `moth` [$37 cream wings, $17 rust body, $0F]; `mothU` [$37, $17, $0C]; `spike` [$13 violet shell, $30 white spikes, $0F]; `spikeU` [$13, $30, $0C]. Kinds use the U palette in `under` and `castle` levels.
The moth is an original design; the credits caption it THE FIRST BUG. 1947.

```js
const SIN64 = [0,2,3,5,6,8,9,10,11,12,13,14,15,15,16,16,16,16,16,15,15,14,13,12,11,10,9,8,6,5,3,2,
  0,-2,-3,-5,-6,-8,-9,-10,-11,-12,-13,-14,-15,-15,-16,-16,-16,-16,-16,-15,-15,-14,-13,-12,-11,-10,-9,-8,-6,-5,-3,-2];
// = Math.round(16 * Math.sin(2 * Math.PI * i / 64)); stored as a literal, never computed at run time
```

### 6.2 X2 the Big Bug upgrade

- `b.hp = def.boss.hp` (5). Only carets hurt it. A hit: `hp--`, emits `bosshit {hp}`, `b.hitT = 16` (pal 9 with FLICKER while `hitT > 0`); carets that touch it while `hitT > 0` poof without damage.
- Enrage at `hp <= 2`: `b.vx` scaled once to magnitude 0.75, `b.hopEvery = 90`.
- Spit on each roar: one fireball from the mouth at `(b.x + (face > 0 ? 24 : 0), b.y - 20)`, aimed: `|vx|` (0.5 to 2.5, in 1/16 px, toward the player) puts its first landing on the bridge's top face at the player's centre, or its bounce's landing when the first would need more than 2.5; `vy = -2`, gravity 0.125, one bounce on a solid top (`vy = -2` again), gone on the second contact, in lava, or off screen. At most 2 in flight. Contact hurts (cause `fire`) unless star or `p.inv`. Carets pass through spit. Emits `spit`. Drawn with `fireball1..4`.
- Lingering (playtest 2): after 90 frames of the player's centre short of the bridge's near end, `b.x1` shrinks with the boss to `x0 + 32`, so it walks up to the near end and paces there; the frame he is on the bridge it has its whole range again. Standing still on the step is hit within 5 s.
- At `hp === 0`: emits `bossdefeat`, adds 5000 with the `5000` pop, counts a bug, sets `b.dead = true`, `b.fall = true`, `b.vy = -3`, `b.flip = true`; the existing fall path sinks it into the lava. The song goes to `none`.

### 6.3 X3 lifts

Sprite `lift` segments (16x8), one per tile of width, name by level kind: `lift` (sky), `liftU` (under), `liftC` (castle).
The top face is one-way: he lands when falling (`vy >= 0`), his feet last frame were at or above the lift's previous top (`y0 <= top - dy`), his feet now are at or below its top, and his body overlaps the lift horizontally.

| Kind | Definition | Position (a pure function of `lv.t` except `fall`) |
|---|---|---|
| `h` | `{ tx, y, w, x1, speed, phase }` | `D = x1 - tx*16`, `o = (floor(lv.t*speed) + phase) mod 2D`, `u = o < D ? o : 2D - o`, `x = tx*16 + u`, top `y` |
| `v` | `{ tx, w, y0, y1, speed, phase }` | `D = y1 - y0`, same `u`, `x = tx*16`, top `y = y1 - u` |
| `fall` | `{ tx, y, w }` | still until first contact; then 20 frames of shake (x ±1 alternating); then `vy += Q(0x100)` to 2; gone below y 200; emits `crumble` at the shake |

Carry: `pre` moves every lift, stores `dx, dy`, and moves the rider with `K.nudgeX(W, lv, p, dx)` and `p.y = top`.
`p.ride` is an index into `lv.lifts` (or -1), never an object, so `cloneWorld`'s flat copy stays correct.
Walking off the span ends the ride and starts coyote. A jump ends the ride. Enemies, items and carets ignore lifts.

### 6.4 X4 springs

`S` is a solid tile; the spring system draws it and triggers it.
On any frame after `moveY` where he is grounded and a foot probe's cell is `S`: launch.
- A held: `vy = -5`, `jumping = true`, `gHold = Q(0x240)`, `gFall = Q(0x900)`; rise 86.4 px in 35 frames. From the 1-3 spring (top y 148) the apex puts his feet at y 61.6, so big Claw'd's drawing top stays at 37.6 (F8).
- A not held: `vy = -4`, `jumping = false`, `gFall = Q(0x700)`; rise 16.3 px.
- Horizontal speed is kept; `airMax` is set from the run state like a jump. `p.coyote` and `p.buf` clear.
- The sprite shows `spring2` for 3 frames, `spring3` for 3, then `spring1`. Emits `spring {held}`.

### 6.5 X5 embers

`{ tx, period, phase, vy? }`: rest y (feet) 164, hidden behind the lava surface.
A leap starts when `(lv.t + phase) % period === 0`: `vy = -5` (or the ember's own `vy`), gravity `Q(0x300)` (rise 64.2 px, back in about 54 frames).
The tell (drawn only): for the 36 frames before every leap the lava surface at its column glows white-hot (`t_lavaGlow1/2`, the lava top's own waves), two `bubble1/2` boil on it, and for the last 12 its head rises into view behind the surface; the engine's ambient bubbles skip ember columns (live), so a bubble there always means a leap.
Hitbox x+3..x+13, y-13..y-3; contact hurts (cause `fire`) unless star or `p.inv`.
Sprite `ember1`/`ember2` alternating every 4 frames, flipped vertically while falling, flag BEHIND while its feet are below y 152. Emits `ember` at a leap only if `cam - 16 < x < cam + 320`.

### 6.6 X6 items and blocks

| Block | Bump result |
|---|---|
| `?` | coin (unchanged) |
| `M` | floppy (`mushroom`) when small; `terminal` when big (live) |
| `N` | `life` item (the 1UP floppy) |
| `+` | hidden until bumped; `life` item |
| `C` | multi-coin brick: the first bump starts a 240-frame window on `lv.t`; every bump gives one coin (200); it turns into `U` on the bump that gives the 10th coin, or on the first bump after the window ends (that bump still pays); big Claw'd does not break it; state `lv.multi[cellIndex] = { t0, n }` |
| `B` | unchanged (breaks when big), castle included |

| Item | Motion | Pickup |
|---|---|---|
| `mushroom` | walks (unchanged) | grow (unchanged); 1000 when big |
| `life` | walks like the floppy; drawn as `mushroom` with pal 8 | `lives = min(99, lives + 1)`, emits `oneup`, `1UP` pop |
| `terminal` | sprouts (32 frames) then stays on the block | 1000 and the `1000` pop; small: acts as the floppy; big: `CODE_FREEZE` (30 frames, the world holds like the grow freeze, Claw'd shows pal 7 with FLICKER), then `p.code = W.code = true`, emits `powerup {form: 'code'}` |
| any item in a `sky` level | stays where it sprouted | as above |

### 6.7 X7 Claw'd Code and the caret

- Code Claw'd is big Claw'd drawn with pal 7 (`clawdCode` [$30 white body, $26 salmon shade, $0F outline]); the star cycle overrides it.
- Throw: a B press (`pressed & B`) while `p.code`, `p.st === 'play'` and fewer than 2 carets exist. B held still runs. Pose `clawdB_throw` for 8 frames (`p.throwT`). Emits `throw`.
- Spawn: caret centre at `(p.x + 8 + face * 10, p.y - 16)`; `vx = 3.5 * face` (`Q(0x3800)`), `vy = 1`.
- Motion: `x += vx`; a solid tile ahead of the centre ends it with a `poof` (emits `poof`). `vy = min(4, vy + 0.25)`; `y += vy`; landing on a solid top bounces with `vy = -2.75` (`Q(0x2C00)`, a 13.75 px hop); a solid tile above while rising poofs it. Gone after 150 frames or off screen (x outside `cam - 16 .. cam + 336`, y over 200).
- Enemy hit (any live kind in `walk` or `shell`): the enemy enters the `dead` fall (`vy = -3`, `vx = 0.75 * dir`), counts a bug (not for a shell), scores a flat 200 with its pop, emits `zap {kind}`; the caret is gone.
- Boss hit: X2.
- A hit on big or code Claw'd drops him to small with 120 invincible frames (D6). `M` while code gives another terminal (1000).
- Code carries across levels like big (`W.code`); death clears it.
- Sprites: `caret1..4` (8x8, a turning chevron, every 3 frames), `poof1..3` (8x8, 4 frames each).

### 6.8 X8 tokens

Spawned from `t` chars and `def.tokens`; skipped if `W.tokens[main] & (1 << bit)`.
Collected when his body overlaps `x+2..x+14, y+2..y+14` of the cell: `W.tokens[main] |= 1 << bit`, 1000 with the `1000` pop, emits `token {id: main, n: bit}`.
Sprite `token1..4` (16x16 spinning ✻ medal), frame `(vf >> 3) & 3`.

### 6.9 X9 checkpoint

The post stands at `(tx * 16, rowTop(row) - 32)`, sprites `ckpt_off` and `ckpt_on` (16x32).
It activates when `p.st === 'play'` in the main level and `bodyL(p) >= tx * 16`: `W.mid = { id: main, tx, row }`, emits `checkpoint {id}`.
A respawn with an active checkpoint builds the level fresh, puts his feet at `(tx * 16, rowTop(row))`, sets `W.cam = clamp(x + 8 - 128, 0, cap)`, removes enemies with `x < x_player + 64`, and gives full time and small power.
A clear or a continue clears the checkpoint.

### 6.10 Scoring and lives

| Action | Points |
|---|---|
| Stomp chain, star chain, shell chain | `COMBO` table, 1UP past 10 (unchanged) |
| Caret kill | 200 |
| Boss by carets | 5000 |
| Coin (any source) | 200; 100 coins give a 1UP (unchanged) |
| Brick break | 50 (unchanged) |
| Floppy, terminal, token | 1000 each |
| Flagpole, time tally, fireworks | unchanged |
| 1UP item | a life, no points |

Lives start at 3 and cap at 99. `W.top` is seeded from `opts.top` (the saved hi-score).

## 7. Events

Existing events keep their names and payloads on both paths: `song {id, section?}`, `start`, `coin`, `oneup`, `jump {big}`, `pipe`, `bump`, `brick`, `sprout`, `kick {combo}`, `stomp {combo}`, `powerup`, `hop`, `roar`, `axe`, `bridge {i}`, `bossfall`, `flagpole {height, frames}`, `tally {n}`, `firework`, `text {i, line, every}`.

New events (live only):

| Event | Data | Emitted by | Sound |
|---|---|---|---|
| `levelstart` | `{id, lives, checkpoint}` | `startLevel` | none (the level song starts) |
| `pause`, `unpause` | none | pause mode | driver pause and the jingle (S3) |
| `hurt` | `{cause}` | shrink on a hit (replaces the film's `pipe` for the shrink) | same program as `pipe` |
| `die` | `{cause}` enemy, spike, fire, boss, pit, lava, time | `die()` | the `death` song |
| `lifelost` | `{lives}` (after the decrement) | end of the dead state | none |
| `gameover` | none | entering `gameover` | the `gameover` song |
| `cursor` | none | continue screen | effect |
| `continue` | `{id}` | CONTINUE | effect (as `select`) |
| `quit` | none | END | none |
| `checkpoint` | `{id}` | checkpoint | effect |
| `token` | `{id, n}` | token pickup | effect |
| `clear` | `{id, score, time, tokens}` (`time` = time left at the grab) | entering `clear` | none |
| `hurry` | none | time reaches 100 | the `hurry` song |
| `complete` | `{score, tokens, retries}` | the rescue's text start | none |
| `credits` | none | entering `credits` | none |
| `throw` | none | caret fired | effect |
| `zap` | `{kind}` | caret kill | effect |
| `poof` | none | caret on a wall | effect |
| `bosshit` | `{hp}` | caret on the boss | effect |
| `bossdefeat` | none | boss at 0 HP | effect |
| `spit` | none | boss roar spit | effect |
| `ember` | none | ember leap on screen | effect |
| `spring` | `{held}` | spring launch | effect |
| `crumble` | none | falling lift starts shaking | effect |
| `powerup` | `{form: 'code'}` added for the terminal | terminal pickup | unchanged program |

Shell-only sound cues (sent straight to the audio queue, never engine events): `cursor`, `select`, `back`.

## 8. Snapshot contract (P1 produces, P4 and P6 read)

Existing fields keep their meaning. `s.f` becomes `W.vf - 1`, where `W.vf` is a visual clock that advances every step except in `pause`; in the film `W.vf === W.f`, so film snapshots are unchanged. Every animation clock inside `snapshot()` (blink, star cycle, torches, sparks, firebar balls, lava bubbles, the ENTER key, Pearl's wave) reads `W.vf`.

| Field | Type | Meaning |
|---|---|---|
| `m` | number | MODE_CODE (3.1) |
| `live` | bool | `W.live` |
| `shell` | bool | `W.shellMenu`: the shell draws the title menu and the pause panel |
| `pausable` | bool | 3.1 |
| `lid`, `main`, `name` | string | current area id, its main level id, its name |
| `lives` | number | lives |
| `tokens` | number | bitmask for the current main level |
| `tokenTotal` | number | tokens collected in the run (0 to 12) |
| `clear` | object or null | mode 6: `{id, name, tokens, coins, time, score}`; `coins` counts coins since the level started |
| `cont` | object or null | mode 5: `{sel}` (0 CONTINUE, 1 END) |
| `credits` | object or null | mode 7: `{t, score, top, tokens, perfect}` |
| `end.lines` | array | live: 7 lines (9.4) |
| `spr` | Int16Array | also carries checkpoint posts, new enemy kinds (via `KINDS.sprite`), `terminal` and `life` items, every system's sprites, the throw pose, pal 7, 8, 9, 12 and flag 256 |

Mode 4 snapshots carry the full play record (the frozen world). Modes 5, 6 and 7 carry an empty `spr`.

## 9. Art (P4)

### 9.1 New sprites

Character sprites use only keys `1 2 3 .` with the legend `slots(SPAL.x)`; every map is an original drawing at exactly its manifest size.

| Name | Size | Palette (slot 1, 2, 3) | Drawing |
|---|---|---|---|
| `moth1`, `moth2` | 16x16 | `moth` $37, $17, $0F | wide cream wings up / down over a rust body; faces left |
| `spike_walk1`, `spike_walk2` | 16x16 | `spike` $13, $30, $0F | a low violet beetle with three white spikes on its back; legs swap |
| `terminal` | 16x16 | `terminal` $26, $30, $0F | a tiny salmon-framed monitor showing a white `>_` on black |
| `caret1..caret4` | 8x8 | `caret` $30, $26, $0F | a white `>` chevron with a salmon core, turned 0, 90, 180, 270 degrees |
| `poof1..poof3` | 8x8 | `poof` $30, $10, $0F | a puff growing and thinning |
| `token1..token4` | 16x16 | `token` $26, $30, $17 | a ✻ medal: full face, narrow, edge, narrow mirrored |
| `ember1`, `ember2` | 16x16 | `fireball` (existing) | a rising flame drop, no eyes |
| `spring1..spring3` | 16x16 | `spring` $26, $30, $0F | rest; compressed to 8 px; extended |
| `ckpt_off`, `ckpt_on` | 16x32 | `ckptOff` $10, $00, $0F; `ckpt` $26, $30, $0F | a post topped by a commit node; `on` flies a white flag with a ✓ |
| `clawdB_throw` | 24x24 | `clawd` | big Claw'd, one nub thrust forward (built with `sB`) |
| `lift`, `liftU`, `liftC` | 16x8 | tile legends: sky $26, $30, $0F; under $21, $31, $0F; castle $10, $30, $0F | a progress-bar segment with a bright top edge |

New tiles (16x16, up to 3 colours plus the backdrop):

| Name | Colours | Drawing |
|---|---|---|
| `t_rackTop` | $10, $30, $0F | a server's top plate with a vent line |
| `t_rack` | $00, $26, $0F | rack units with salmon status lights |
| `t_cloudTop` | $30, $31, $0F | a walkable cloud block, clearly outlined so it never reads as background |

New palettes in `lib.SPAL` (frozen): `clawdCode` [$30, $26, $0F], `life` [$1A, $30, $0F], `bossHit` [$30, $30, $0F], `moth`, `mothU`, `spike`, `spikeU`, `terminal`, `caret`, `poof`, `token`, `spring`, `ckpt`, `ckptOff`.
No palette is added to the star cycle; no star step is green.

### 9.2 Tile tables

`CQ.TILE_NAMES` (engine, P1) gains:
- over: `C` `t_brick`
- under: `C` `t_brickU`
- castle: `B` `t_brickC`, `C` `t_brickC`
- sky: `#` `t_cloudTop`, `B` `t_brick`, `C` `t_brick`, `U` `t_used`, `X` `t_stair`, `T` `t_rackTop`, `R` `t_rack`

`tileTable` (draw, P4) maps `N` to the ? shimmer and draws nothing for `S` and `+`.

### 9.3 Draw changes (`src/game/30-draw.js`)

- `CQ.drawSnap(ctx, s, f, film, view)` gains `view = { now, reducedFlash }`. The film calls it without `view`, unchanged.
- `view.now`: `drawTiles` reads `lv.grid` directly instead of `histOf` (live consoles and the demo draw the snapshot they just took).
- Backdrop: over $22, sky $21, under and castle $0F. A flash replaces it only without `view.reducedFlash`.
- `view.reducedFlash`: ignores `s.flash`; recomputes star pals 1..4 as `1 + (floor(s.f / 8) % 4)`; FLICKER sprites show their `pal` steadily.
- PALS gains slots 7 to 12 (2.6).
- The scenery cache is keyed by `lv.def` (the object), not `lv.idx`.
- Title: with `s.shell`, draw only the title box and `©1986 CLAWD SOFT`; without it, today's menu lines.
- Lives screen: `WORLD 1-2` at y 60, the level name at y 72 (white), Claw'd and `× 3` at y 88. The layer key includes the name.
- Mode 4 (pause): draw the frozen play frame; without `s.shell`, add `PAUSED` centred at y 86 with a $0F shadow.
- Mode 5 (continue): black; `GAME OVER` centred at y 70; `CONTINUE` at (136, 94) and `END` at (136, 106) in white; the ▶ cursor in salmon at x 120 on the selected row.
- Mode 6 (clear): black; `✓ 1-2 CLEAR` centred at y 56 (✓ in green $2A); the name at y 70; the token row `✻ ✻ ✻` at y 88 (collected salmon $26, missing grey $00); `SCORE 012345` at y 108; `TIME 123` at y 120.
- Mode 7 (credits, revised after playtest 2): black; `✻ THE CAST ✻` at y 28; a castle floor (`t_groundC`) at y 148 and 164. The cast parades right in single file at 1 px a frame, the leader's left edge at `x = -16 + t`, each 56 px behind the one before, so the last steps off at `t = 672`: `CLAW'D` (`clawdB_run1..3`), `PRINCESS PEARL` (`pearl`/`pearl_wave` every 16 frames, bobbing 1 px), `BUG` (`bug_walk1/2`), `SHELL BUG` (`shellbug_walk1/2`), `MOTH` (`moth1/2`, flying 14 px up, bobbing on SIN64), `SPIKE BEETLE` (`spike_walk1/2`), `BIG BUG` (`boss_walk1/2`); walkers face right (enemy drawings flipped), each name over its head in two alternating rows (y 100, 88). Four fireworks burst on the engine's `firework` frames (96, 288, 480, 576) and eight `cursor` sparks twinkle. From `t = 672` the final card: `✻ CLAUDE QUEST` y 56, `SESSION COMPLETE` y 72, `SCORE 012345` y 92, `HI-SCORE 012345` y 104, `TOKENS 09/12` y 116, `✻ PERFECT ✻` y 128 in gold $28 only at 12/12, `PUSH START` y 150 blinking (32 on, 16 off) from `t = 732`.
- Ending text: with 7 lines, `END_Y = [40, 56, 66, 76, 86, 96, 106]` and the push line at y 116; 5 lines keep today's layout.
- Exports: `CQ.layer` (the existing `layer(ctx, id, key, h, paint)`) and `CQ.warmStep(n)`, which builds the next `n` manifest names with every palette slot they can take (Claw'd names: 0, 1-4, 7; enemies: 0, 5, 6, 10, 11; `mushroom`: 0, 8; boss names: 0, 9; fragments: 0, 12) and returns `true` when all are built.

### 9.4 Copy (every glyph exists in `lib.FONT`)

Level names: `HELLO, WORLD`, `THE STACK`, `THE CLOUD`, `THE KERNEL`.
Live ending lines: `YOU DID IT, CLAW'D!`, `✻ QUEST COMPLETE`, `✓ N BUGS SQUASHED`, `✓ N COINS`, `✓ N/12 TOKENS`, `✓ N RETRIES` (`✓ NO RETRIES` at 0, retries = lives lost), `✓ ALL TESTS PASS`; then `PUSH START TO SHIP IT`.
Menu copy is in U4. Key labels use only A-Z and 0-9 (U3).

## 10. Sound (P5)

All melodies and effect note sequences are original (docs/sound.md section 10); nothing may paraphrase a Nintendo cue.

### 10.1 S1 songs

| Id | Loop | Length | Mood and constraints |
|---|---|---|---|
| `death` | no | 144 frames | a short falling phrase in D minor landing on the tonic; must end inside the 180-frame dead state |
| `gameover` | no | at most 176 frames | slow, resigned, D minor, ends on an open fifth |
| `sky` | yes, sections A and B | about 24 s | airy and bright in A major: pulse-2 arpeggios, a vibrato lead, a walking triangle bass, light hats, sparse DMC |
| `boss` | yes | about 16 s | driving C minor, DMC kick on every beat, triangle ostinato; the lead sits mostly on pulse 2 so the roar (pulse 1) never hollows it |
| `hurry` | no | exactly 90 frames | three rising stabs and a held note |
| `overworldFast`, `undergroundFast`, `skyFast`, `castleFast`, `bossFast` | as the source | derived | `fast(id)`: the same definition at speed minus 1; sections scale |

The engine requests `ending-full` (it loops) for the live ending text. The credits start `credits` (no loop, speed 6): seven bars of the ending tune as a march under the parade (672 frames), the D major tonic on the card's first frame (section `card`, where a START skip starts it), ringing down to silence by frame 1056.
Star end resumes the fast variant when `W.hurried`.

### 10.2 S2 effects

| Id | pri | Channels | Frames | Character |
|---|---|---|---|---|
| `pause` | 6 | p1, p2 | 20 | the pause jingle: two bright notes up, the second ringing |
| `unpause` | 6 | p1 | 8 | a single blip |
| `hurt` | 4 | as `pipe` | 30 | alias of the `pipe` program |
| `checkpoint` | 3 | p2 | 24 | a rising arpeggio |
| `token` | 3 | p2 | 20 | a sparkling two-note trill |
| `throw` | 1 | p2 | 8 | a short upward sweep |
| `zap` | 2 | n, t | 10 | a crunch |
| `poof` | 0 | n | 4 | a puff |
| `bosshit` | 3 | n, t | 16 | a heavy thud; pulse 1 stays free |
| `bossdefeat` | 5 | p2, n | 64 | a long falling roar |
| `spit` | 1 | n | 12 | a hiss |
| `ember` | 0 | n | 8 | a sizzle |
| `spring` | 2 | p2 | 12 (held), 6 (not) | a boing sweep |
| `crumble` | 1 | n | 10 | a rattle |
| `cursor` | 1 | p2 | 3 | a menu tick |
| `select`, `continue` | 2 | p2 | 10 | a menu confirm |
| `back` | 1 | p2 | 6 | a menu back |

Effects never use the DMC.

### 10.3 S3 driver pause

`makeDriver.frame` handles two event types:
- `pause`: `paused = true`; the song frame `sf` stops advancing; song voices output silence (pulse volume 0, `$4008 = $80`, noise 0, DMC stopped with `$4015 = $0F`); effects keep running, so the `pause` jingle plays.
- `unpause`: `paused = false`; song voices come back with `trig: true` on the same `sf`, so the song resumes on the same bar.
- A `song` event always clears `paused`.

`FILM.audio.live(actx, opts)` gains nothing else; the shell sends `cursor`, `select`, `back` through `snd.event({ type })`.

### 10.4 S4 film audio invariance

`FILM.audio.synth(48000)` over the film's events must hash byte-identically before and after P5's change (the film emits none of the new events and no existing song or effect changes).
Re-run `tools/audio/loudness.cjs` over the events of the full proof tape (T2): true peak stays under -1 dBTP; GAIN stays 2.87.

## 11. Shell (P6)

### 11.1 Page and boot

`src/shell.js` runs only on the game page (it is not in the film build). It builds the DOM itself: a black page, the TV canvas centred at 16:9 inside the viewport minus `env(safe-area-inset-*)` and the chrome row, a 28 px chrome row under it (help line, toasts, the sound prompt, the input display slot), the touch pad when needed, and a visually hidden `role="status" aria-live="polite"` region.
Boot sequence:
1. Read the save (U9).
2. Mount the canvas with `FILM.mount(canvas, { scale })`, `scale = min(2560, cssWidth * devicePixelRatio) / 1920`.
3. `title = FILM.game.create({ shellMenu: true, top: save.hi, feel: save.settings.feel })`; step it once with 0; draw it and the title menu; present clean with `FILM.presentNearest`.
4. From the next frame present through `FILM.crt.present(native, FILM.ctx, { frame: FILM.crt.settledFrame(), overlays: false })` when CRT is on (the shader compiles after the first paint).
5. While on the title, call `CQ.warmStep(24)` once per animation frame until it returns true.
6. No AudioContext exists until the first gesture (U6). The page never calls `FILM.game.sim()` or `FILM.audio.render()`.

### 11.2 U1 clock (`src/game/45-clock.js`)

```js
CQ.clock = {
  STEP_MS: 1000 / 60, TOL_MS: 2, MAX_CATCHUP: 5, MAX_GAP_MS: 250,
  make: () => ({ acc: 0, last: null }),
  advance(c, stamp) -> steps,   // play.js 523-537, moved verbatim: first call returns 1; a gap over 250 ms counts as one step; the backlog over 5 steps is dropped
};
```

The shell draws once per animation frame and only when `steps > 0` (or the output size or mode changed). Timing comes only from the rAF stamp.

### 11.3 U2 input

- Merge per step (play.js 484-497 rules): `mask = keys | touch | pad | latch`, minus buttons held when a console was taken (`suppress`), opposite directions cancel, a press shorter than a frame still lands through `latch`.
- Keyboard: `e.repeat` is ignored; mapped keys call `preventDefault`; Meta, Ctrl and Alt combinations pass through.
- Default bindings, two slots each: UP [ArrowUp, KeyW], DOWN [ArrowDown, KeyS], LEFT [ArrowLeft, KeyA], RIGHT [ArrowRight, KeyD], A [KeyZ, KeyK], B [KeyX, KeyJ], START [Enter, NumpadEnter], SELECT [ShiftLeft, ShiftRight].
- Fixed keys (never bindable): P and Escape pause or resume, F fullscreen, C CRT or clean, M mute, I input display.
- Gamepad (standard mapping, polled every animation frame): D-pad 12-15 and the left stick (dead zone 0.5), A = buttons 1 and 3, B = buttons 0 and 2, START 9, SELECT 8. `gamepadconnected` shows `PAD CONNECTED` for 150 frames; a disconnect during play pauses.
- Touch (built when `(pointer: coarse)` or `?touch=1`): fork of play.js `bindTouch` and its CSS, without the FILM pill; an 8-way D-pad with a 10% dead radius and slide-between; B and A circles with A up and to the right; SELECT, START, PAUSE and FULL pills; an AB zone (a finger within 20 px of the midpoint between A and B presses both); every hit target at least 56 px; `touch-action: none` on the pad and the TV; padding from `env(safe-area-inset-left/right/bottom)`; in landscape the pad sits in the side margins and overlays the TV at 35% opacity when a margin is under 140 px. The pad hides on the first keyboard or gamepad input and returns on the next touch.

### 11.4 U3 remapping

The CONTROLS screen lists UP, DOWN, LEFT, RIGHT, A (JUMP), B (RUN/THROW), START, SELECT, RESET DEFAULTS, BACK; each action row shows its two slots.
LEFT and RIGHT pick a slot; A starts binding and shows `PRESS A KEY`; the next keydown binds (Escape or 300 frames cancels).
A code already bound to another slot swaps with the slot being replaced, so no key is ever bound twice. Fixed keys and modifier-only keys are refused.
Labels come from a table (ArrowUp `UP`, ArrowDown `DOWN`, ArrowLeft `LEFT`, ArrowRight `RIGHT`, Space `SPACE`, Enter `ENTER`, NumpadEnter `NENTER`, ShiftLeft `LSHIFT`, ShiftRight `RSHIFT`, `KeyZ` `Z`, `Digit1` `1`, `Numpad1` `NUM1`); any other code is stripped of `Key`/`Digit`, uppercased, reduced to A-Z and 0-9, and cut to 6 characters.
Gamepad and touch mappings are fixed.

### 11.5 U4 menus (`src/game/50-menu.js`)

`CQ.menu.step(state, pressed, env) -> { state, action }` is pure (no DOM, no storage, no clocks; `env` carries the save and whether the menu was opened from pause); `CQ.menu.draw(g, state, snap, save)` paints into the native buffer with `lib.pxtext`, `lib.sprite` and `lib.titleBox` in NES colours only, cached through `CQ.layer`.
UP/DOWN move (SELECT cycles), LEFT/RIGHT change values, A or START confirms, B backs out; every move plays `cursor`, every confirm `select`, every back `back`.

| Menu | Items | Layout |
|---|---|---|
| title | `NEW QUEST`; `CONTINUE 1-3` (grey $00 and skipped when `save.reach` is `1-1`); `OPTIONS`; `HI-SCORE 012345` | over the engine's title frame: ▶ at x 110, items at x 124, y 94, 106, 118; hi-score centred at y 136 |
| options (from title) | `FEEL` MODERN / NES ACCURATE; `DISPLAY` CRT / CLEAN; `VOLUME` `< 8 >` (0-10); `INPUT DISPLAY` OFF / ON; `FLASHING` FULL / REDUCED; `CONTROLS`; `ERASE SAVE`; `BACK` | black; `OPTIONS` centred at y 24 in salmon; rows from y 44 every 12; labels at x 40, values at x 192, ▶ at x 28; `A SELECT  B BACK` in grey at y 164 |
| options (from pause) | the same without `FEEL` and `ERASE SAVE` | same |
| erase confirm | `ERASE SAVE?` `NO` / `YES`, cursor on NO | centred panel |
| pause | `RESUME`, `OPTIONS`, `QUIT` | a $0F panel x 80..240, y 52..148 with a salmon border; `PAUSED` y 60; name y 74 ($10); token row y 88; items at x 120, y 104, 116, 128 |
| quit confirm | `QUIT?` `NO` / `YES`, cursor on NO | same panel |

Actions: `{type: 'new'}`, `{type: 'continue', level}`, `{type: 'resume'}`, `{type: 'quit'}`, `{type: 'set', key, value}`, `{type: 'bind', action, slot}`, `{type: 'erase'}`, `{type: 'demo'}` (the title's idle counter reached 1080 frames without a button edge).
Menus have no time limits.

### 11.6 U5 attract demo

`FILM.game.demo()` (P1) returns `{ step(), draw(ctx, view), done, frame }`: a film-rules world (`newWorld({})`) fed `decode(CQ.RECORDED.rle, 3627)`, stepped headless until the first frame in mode `play` (film frame 310), then one tape frame per `step()`. `done` becomes true 180 frames after the tape's first `flagpole` event (film frame 1821, so frame 2001) or 2400 frames after play began.
The shell draws it with `view.now`, blinks `DEMO` centred at y 40 (32 frames on, 32 off, $30 with a $0F shadow), sends no demo events to audio (it sends `song none` on entry and re-sends the title song on exit), never records a score, and ends it on any button edge (the press is consumed: the shell waits for all buttons to be released before the menu accepts input).

### 11.7 U6 audio

- The AudioContext (`latencyHint: 'interactive'`) is created on the first `pointerdown`, `touchend` or `keydown`; then `snd = FILM.audio.live(actx, { dest: gain, bufferSize })` with `bufferSize` 1024 on a fine pointer and 2048 on a coarse one.
- The shell remembers the last `song` event any console emitted and sends it to `snd` when sound starts, so the title song plays even though the console emitted it before the gesture.
- Gamepad input is not a user gesture; while no context runs, the chrome shows `PRESS A KEY OR TAP FOR SOUND`.
- Volume: gain `(vol / 10) ** 2`; M toggles mute; both persist. No node is added after the source except that gain.

### 11.8 U7 pause, visibility, focus

- START in `game` reaches the engine as a normal button. P, Escape, `visibilitychange` to hidden, `blur`, and a gamepad disconnect raise a pause request: the shell adds START to the next step only if `snap.pausable`, sending one frame without START first when START is already held, so the press edge exists in the tape.
- Hidden: suspend the context; visible: resume it; the game stays paused until the player resumes. No catch-up after a gap (U1).
- `blur` also clears held keys.

### 11.9 U8 display

- CRT is the default. `crt.js` already falls back webgl2, webgl, cpu, nearest.
- Context loss (P6 edits `crt.js`): with `FILM.crt.recover = true` (set by the shell; default false keeps the film behaviour) a lost context presents clean for that frame and waits for `webglcontextrestored`, then `crt.reset()` rebuilds GL; it never forces `cpu` for the rest of the session.
- C toggles `FILM.crt.mode` between `crt` and `clean`; the choice persists.
- Fit and remount on resize, fullscreen change and orientation change.
- Fullscreen: F, a double click on the TV, or the FULL pill calls `document.documentElement.requestFullscreen()`; the pill hides when `document.fullscreenEnabled` is false (iPhone Safari).

### 11.10 U9 persistence (`localStorage['claude-quest.save.v1']`)

```json
{ "v": 1, "hi": 0, "reach": "1-1", "cleared": false,
  "tokens": { "1-1": 0, "1-2": 0, "1-3": 0, "1-4": 0 },
  "settings": { "feel": "modern", "crt": "on", "vol": 8, "mute": false, "input": false, "flash": "full",
    "keys": { "UP": ["ArrowUp", "KeyW"], "DOWN": ["ArrowDown", "KeyS"], "LEFT": ["ArrowLeft", "KeyA"], "RIGHT": ["ArrowRight", "KeyD"],
              "A": ["KeyZ", "KeyK"], "B": ["KeyX", "KeyJ"], "START": ["Enter", "NumpadEnter"], "SELECT": ["ShiftLeft", "ShiftRight"] } } }
```

- Default `flash` is `reduced` when `matchMedia('(prefers-reduced-motion: reduce)')` matches.
- Validation is per field: a bad field takes its default; an unknown `v` or unparseable JSON resets the save. No timestamps.
- Writes: a settings change; `levelstart` of a main level (`reach` = the furthest by `GAME_ORDER`); `token` and `clear` (OR into `tokens`); `gameover`, `quit`, `complete` and `pagehide` (`hi`); `complete` (`cleared`); ERASE SAVE.
- Every access sits in try/catch; on failure the save lives in memory for the session and the options screen shows `SAVE OFF`.

### 11.11 U10 accessibility

- The canvas has `role="img"` and `aria-label="Claude Quest game screen"`.
- The live region announces at most once a second: menu items (`New quest`, `Continue, world 1-3`), option changes (`Feel, modern`), and `World 1-2, The Stack, 3 lives` (`levelstart`), `Paused`, `2 lives left`, `Game over. Continue or end`, `Checkpoint`, `Token`, `World 1-2 clear`, `Hurry`, `Quest complete`.
- Reduced flashing (9.3) removes every backdrop flash and slows the star cycle; the full mode keeps the film's limit of at most 3 full-screen flashes per second.
- Remapping, pause anywhere, and untimed menus cover one-handed and motor needs. Pinch zoom is not blocked.

### 11.12 U11 input display

Option `INPUT DISPLAY` shows a small NES controller in the chrome's right slot, lit by the mask sent on each step (fork of play.js `#nes`).

### 11.13 U12 stats and proof hooks

`FILM.shell.stats`: frozen getters `state`, `mode`, `levelId`, `steps`, `rafs`, `rate` (steps per second over the last second), `backend`, `audio`, `save` (`ok` or `off`), `buttons`, `frame`.
With `?proof=1` only, `FILM.shell.proof`: `feed(tape)` creates a game console from `tape.opts` exactly as NEW QUEST would, plays `tape.rle` from its first step, then hands control back to live input; `fast(n)` runs `n` steps per animation frame (1 to 16); `idle(frames)` advances the title idle counter; `snap()` returns `{m, lid, x, y, st, score, lives, tokens, top}`; `pixels()` returns the native buffer as a plain RGBA array. The hooks only feed controller bytes, so they can do nothing a player cannot.

## 12. Web build and Vercel (P7)

### 12.1 W1 targets

- `node tools/build.cjs --game --out web/index.html`: `sources({ game: true })` in the order of 2.3.
- `node tools/build.cjs --out web/film.html`: today's film page.
- `node tools/site.cjs --site https://<project>.vercel.app`: runs both builds, adds the head blocks (W3), renders the images (W4), writes `web/vercel.json`, and checks the size budget (T9). Each deploy replaces the whole site, so `web/` always holds every file below.

```
web/index.html            the game
web/film.html             the film (served at /film)
web/og.png                1200x630
web/favicon.ico           16, 32, 48 (PNG payloads)
web/apple-touch-icon.png  180x180
web/vercel.json
```

### 12.2 W2 game page head (build.cjs `--game`)

```html
<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<!-- W3: CSP meta goes here -->
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<title>CLAUDE QUEST</title>
<meta name="description" content="An NES-style platformer starring Claw'd: four levels, one Big Bug and one ENTER key. Plays in the browser with a keyboard, a gamepad or touch.">
<meta name="theme-color" content="#000000">
<meta name="color-scheme" content="dark">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-title" content="CLAUDE QUEST">
<!-- W3: share meta goes here -->
<style>html,body{margin:0;height:100%;background:#000}</style>
</head>
<body>
<noscript>CLAUDE QUEST needs JavaScript.</noscript>
<!-- one <script> per source file, as today -->
</body>
</html>
```

The media scan (`scanForbidden`) runs on this HTML exactly as build.cjs writes it; it must report zero hits.

### 12.3 W3 CSP and share meta (site.cjs)

- For each page, compute `sha256` (base64) of every inline script's exact text and insert, right after `<meta charset>`:
  `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'sha256-...' ...; style-src 'unsafe-inline'; img-src 'self'; base-uri 'none'; form-action 'none'">`
- Insert the share block for the game page from a fixed template whose only variable is `SITE`, validated against `^https://[a-z0-9-]+\.vercel\.app$`:

```html
<meta property="og:type" content="website">
<meta property="og:title" content="CLAUDE QUEST">
<meta property="og:description" content="An NES-style platformer starring Claw'd. Play it in your browser.">
<meta property="og:url" content="SITE/">
<meta property="og:image" content="SITE/og.png">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta property="og:image:alt" content="The Claude Quest title screen: Claw'd on a pixel hillside under the CLAUDE QUEST title box">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:image" content="SITE/og.png">
```

- site.cjs asserts the final page equals the scanned page plus exactly these two inserted blocks. No `<link>` is added: browsers fetch `/favicon.ico` and `/apple-touch-icon.png` by convention.

### 12.4 W4 images (Playwright plus `tools/png.cjs`, deterministic)

- `og.png`: `web/index.html?proof=1&clean=1`, the title console at `mt = 60` with the title menu drawn, read with `FILM.shell.proof.pixels()`, scaled 3x nearest to 960x540 and centred on a 1200x630 $0F canvas.
- `favicon.ico`: `clawdS_idle` at 1x, 2x and 3x (16, 32, 48) on transparent, read with `FILM.lib.spriteCanvas`; an ICO container written by hand with PNG payloads.
- `apple-touch-icon.png`: `clawdB_idle` at 6x (144 px) centred on a 180x180 $0F canvas.
- `tools/png.cjs` writes PNG with `zlib.deflateSync` and CRC32; no new dependencies.

### 12.5 W5 `web/vercel.json`

```json
{ "cleanUrls": true, "trailingSlash": false,
  "headers": [
    { "source": "/(.*)", "headers": [
      { "key": "Content-Security-Policy", "value": "frame-ancestors 'none'" },
      { "key": "X-Content-Type-Options", "value": "nosniff" },
      { "key": "Referrer-Policy", "value": "no-referrer" },
      { "key": "Permissions-Policy", "value": "camera=(), microphone=(), geolocation=()" },
      { "key": "Cross-Origin-Opener-Policy", "value": "same-origin" } ] },
    { "source": "/", "headers": [ { "key": "Cache-Control", "value": "public, max-age=0, must-revalidate" } ] },
    { "source": "/(og.png|favicon.ico|apple-touch-icon.png)", "headers": [ { "key": "Cache-Control", "value": "public, max-age=86400" } ] } ] }
```

### 12.6 W6 deploy (`tools/deploy.cjs`, the Vercel CLI on `PATH`, or `VERCEL_BIN`)

1. `vercel project ls` (read only); pick `claude-quest`, else `claude-quest-game`; abort if both exist.
2. `node tools/site.cjs --site https://<name>.vercel.app`; every gate in T10 up to the local e2e is green.
3. `vercel project add <name>` must succeed (it fails on an existing name, which is the no-overwrite guarantee).
4. `vercel link --yes --project <name> --cwd <abs>/web`, then `vercel deploy --prod --yes --cwd <abs>/web`. Never `cd X &&`. Print each command's own last output line, not only its exit code.
5. The production URL returns 200 without authentication (Deployment Protection covers previews only), then the e2e suite runs against it.
6. Hand the owner the URL and the controls: arrows or WASD move, Z jumps, X runs and throws, Enter starts and pauses, F fullscreen, C CRT, M mute; on a phone, the on-screen pad.

The user's request authorises creating one new Vercel project and deploying to it. A custom domain, any change to another project, or the WebKit browser download needs a fresh yes.

## 13. Test plan

### 13.1 T1 film integrity (P1, `tools/proof/film.cjs`)

The four values in 2.2 on every engine commit, plus `node tools/check.cjs` on the film build and P5's film audio hash.

### 13.2 T2 level proofs (P3, `tools/proof/levels.cjs` and `tools/proof/programs/`)

- One program per level id (`1-1`, `1-2` including 1-2x, `1-3`, `1-4`) built from `CQ.moves` and `CQ.goals`, with `o.free: true` on every planner move and a fresh program per run (moves hold closure state).
- Start: `create({ start: id, feel })` plus one START press. Run for both `feel: 'nes'` and `feel: 'modern'`.
- Frame cap `def.time * 24 + 600`; assert no `die` event and the exit event: `flagpole` (1-1, 1-2x, 1-3) or `axe` then `complete` (1-4). On failure print the frame, `p.x`, `p.y`, `p.st` and the stuck move.
- Save tapes to `tools/proof/tapes/<id>.<feel>.json` as `{ opts, rle, frames, fp }`: `opts` are the `create` options, `rle` starts at the console's first step (the START press included), `fp` is the film's fingerprint function over the run. Default mode replays the tapes and asserts `fp`; `--replan` re-plans after a level edit.
- Secrets: `perfect.<feel>` collects all 12 tokens in one run from `1-1` (it gets big before the 1-4 spike gallery); separate programs prove both 1UP blocks, the multi-coin brick, both pipes, and the 5-caret boss kill.
- `tools/proof/full.cjs`: one run title to credits per feel mode; writes `tapes/full.<feel>.json` for T8.

### 13.3 T3 scenario proofs

P1 `tools/proof/engine-scenarios.cjs` (fixture defs in `tools/proof/fixtures/engine-defs.cjs`):

| Id | Assert |
|---|---|
| EN1 | 300 frames of pause leave `stateHash(W)` (every field except `f`, `prev`, `btn`, `ev`) unchanged; `unpause` resumes on the next frame |
| EN2 | pause is refused in pipes, on the pole, during the grow freeze, the axe sequence and death |
| EN3 | coyote: modern jumps 4 frames after walking off a ledge; nes does not |
| EN4 | buffer: A pressed 5 frames before landing and held jumps on the first grounded frame (modern); released early, no jump; nes no jump |
| EN5 | corner: a 3 px graze of a brick edge passes (modern) and bumps (nes); a 3 px graze of `*` or `+` bumps in both |
| EN6 | death after the checkpoint: `die`, `lifelost`, `levelstart {checkpoint: true}`, x = `mid.tx * 16`, enemies before x + 64 gone, tokens kept |
| EN7 | game over then CONTINUE: 3 lives, score 0, main level start, `continue` event; END returns to title |
| EN8 | routing: 1-1 to 1-1b and back rises from pipe 148 on the same level object; 1-2 to 1-2b and back rises from 128; 1-2 exit reaches 1-2x; a death in 1-2b restarts 1-2 |
| EN9 | hurry at 100: `hurry`, the `hurry` song, then `<song>Fast` 90 frames later; star end resumes the fast variant |
| EN10 | multi-coin `C`: at most 10 coins inside 240 frames, then `U`; never breaks |
| EN11 | `N` and `+` sprout `life`; pickup gives a life and `oneup`; sky-level items never move |
| EN12 | terminal when big, floppy when small; code freeze 30 frames; a hit drops code to small in both feel modes |
| EN13 | memory: 50 deaths in a row keep `W.areas` at 1 or 2 entries and `W.built` unchanged in live play |
| EN14 | clear card 150 frames, then the lives screen for `next`; credits: the `credits` song, fireworks on 96, 288, 480, 576, the card at 672; START in the parade skips to the card (song section `card`); START accepted from 60 frames into the card; auto-return at 672 + 3600 |

P2 `tools/proof/mech-scenarios.cjs` (fixture defs in `tools/proof/fixtures/mech-defs.cjs`):

| Id | Assert |
|---|---|
| MC1 | lift carry follows `dx, dy`; landing only from above; walking off ends the ride and starts coyote; a 112 px h-lift cycle never pushes the rider off |
| MC2 | falling lift: `crumble`, 20 frames of shake, then the fall; gone below y 200 |
| MC3 | spring held from a top at y 148: apex feet at y 61.6, big drawing top at y 37.6 (F8); not held: a 16.3 px rise |
| MC4 | ember leap frames follow `(lv.t + phase) % period`; contact hurts with cause `fire` |
| MC5 | moth y follows SIN64; stomp kills with the combo; hover moth position is a function of `lv.t` only |
| MC6 | spike beetle never leaves a 3-wide island; a stomp on it hurts (cause `spike`) |
| MC7 | carets: at most 2; bounce 13.75 px; a wall poofs; every kind dies to one caret for 200 |
| MC8 | boss: 5 carets give `bossdefeat` and 5000; enrage at 2 HP; spit on each roar, at most 2, aimed (each lands within 6 px of where he stood); lingering brings it to the bridge's near end; parked off the bridge he is hit within 300 frames; after the defeat the ENTER key skips `bossfall` and the rescue starts 16 frames after the last tile |
| MC9 | tokens: pickup sets the bit and emits `token`; a rebuilt level after a death does not respawn it |
| MC10 | clone parity for every system: clone at a frame, step original and clone 240 frames with the same buttons, identical `stateHash` |

### 13.4 T4 determinism (P7, `tools/proof/determinism.cjs`)

Every tape in `tools/proof/tapes` replayed twice gives identical snapshot-stream hashes (the 2.2 serialisation over live snapshots). Clone parity: every 120th frame of every tape, clone, step both 240 frames, compare `stateHash`.

### 13.5 T5 clock (P6, `tools/proof/clock.cjs`)

Synthetic rAF stamp streams at 50, 59.94, 60, 75, 90, 120, 144, 165 and 240 Hz with ±0.5 ms jitter, 60 s each: 3600 ± 2 steps; no animation frame runs more than `ceil(60 / hz) + 1` steps; a 1 s gap produces exactly 1 step.
Menus: `tools/proof/menu.cjs` drives `CQ.menu.step` through every screen and asserts actions, skipping of disabled items, swap-on-rebind and the idle-to-demo action at 1080 frames.

### 13.6 T6 static gates

- `node tools/check.cjs` (film build), gates 1 to 11 green; gate 3 also covers `src/shell.js` (P7 adds it to the list).
- `node tools/levels-lint.cjs` (P3): 12 equal-width rows; rows 0 to 2 empty; only legal characters; F3, F6, F7, F8; castle column at most width minus 5; checkpoint posts on solid floor; token bits unique per main level (3 each, 12 total); the envelope rules F1 and F2 on the listed required jumps.
- `node tools/art-check.cjs` (P4): every manifest name has an `SP` map of exactly its size; no magenta placeholder remains; every map has at most 3 opaque colours and character maps use only `1 2 3 .`; every name in 9.1 exists.
- `node tools/audio/game-audio.cjs` (P5): every sound-bearing event in section 7 has an effect or song; new songs compile; fast variants exist with speed minus 1; a paused driver holds `sf` and `unpause` resumes it; the film synth hash is unchanged.

### 13.7 T7 game page gates (P7, `tools/game-check.cjs`)

- G1 media scan of the built game page is empty and the head blocks match W3.
- G2 pixel audit: in clean mode, feed every tape with `fast(8)` and sample every 30th frame, plus every title, options, controls, pause, continue, clear, credits and demo screen; every pixel of `FILM.native()` is a `lib.NES` colour.
- G3 zero console errors and zero CSP violations while playing the full tape; `CQ.NAMES.length < 1000` afterwards.
- G4 budgets (T9).

### 13.8 T8 e2e (P7, `tools/e2e/run.cjs <url>`)

Chromium desktop 1280x720 and Chromium with Pixel 7 emulation (touch, mobile). WebKit iPhone runs only after the owner approves the browser download. First against `tools/e2e/serve.cjs` (serves `web/` with the `vercel.json` headers), then against the production URL.

| Id | Test |
|---|---|
| PW1 | zero console errors; the only requests are the document and `/favicon.ico`; the CSP meta is present with no violations |
| PW2 | the title is presented within the budget; `stats.state === 'title'` |
| PW3 | Enter: NEW QUEST reaches `play` within 3 s; holding RIGHT for 120 frames moves Claw'd right; Z emits `jump` |
| PW4 | after the first key, `stats.audio === 'running'` and the audio frame advances |
| PW5 | START pauses (`lv.t` holds for 120 frames) and resumes; a hidden page pauses |
| PW6 | `feed(full.modern)` with `fast(8)` reaches the credits; after a reload `HI-SCORE` equals the run's score and CONTINUE is enabled |
| PW7 | touch: tapping START starts; holding the right sector moves; the AB zone gives mask 3 |
| PW8 | a stubbed standard gamepad: button 9 starts; a disconnect pauses |
| PW9 | C toggles clean; `WEBGL_lose_context` falls back to clean; restoring brings webgl2 back |
| PW10 | `idle(1080)` shows DEMO; any key returns to the title without starting a game |
| PW11 | remap A to KeyL, reload, L jumps; FLASHING REDUCED shows no backdrop flash across a star pickup |
| PW12 | `/film` loads and powers on after a click |
| PW13 | `/og.png` is 200 `image/png` 1200x630; `/favicon.ico` is 200; og and twitter meta point at the production host |
| PW14 | 60 ± 0.5 steps per second over 10 s |

### 13.9 T9 performance budgets

| Budget | Limit |
|---|---|
| `web/index.html` size | fail above 900 KB raw or 240 KB brotli; warn above 750 KB or 200 KB (today's film page: 504 KB raw, 129 KB brotli) |
| First title pixels | 1000 ms desktop Chromium; 2500 ms at 4x CPU throttle |
| Step + snapshot + drawSnap (native buffer, clean) | p95 4 ms, p99 8 ms over the 1-3 tape on desktop |
| Step rate | 60 ± 0.5 steps per second |
| Memory | JS heap after 10 full-tape replays within 20% of the heap after the first |

### 13.10 T10 release gate order

film.cjs, check.cjs, levels-lint, art-check, game-audio, engine-scenarios, mech-scenarios, levels (replay), full, determinism, clock, menu, the project-name check, site.cjs, game-check, local e2e, project add and deploy, production e2e.

## 14. Work packages

Each package owns its files outright; no file has two owners. A package may read anything.
Frozen files (no package edits them): `src/core.js`, `src/timeline.js`, `src/player.js`, `src/play.js`, `src/foley.js`, `src/scenes/*`, `src/game/00-levels.js`, `src/game/21-recorded.js`, `docs/*` except this spec, and everything in `claude-quest-v2`.
Integration order: P1, P4, P5 (no dependencies), then P2, then P3 and P6, then P7.

| Package | Owns | Depends on |
|---|---|---|
| P1 engine-core | `src/game/10-engine.js`, `src/game/20-tape.js`, `src/game/40-api.js`, `tools/proof/harness.cjs`, `tools/proof/film.cjs`, `tools/proof/engine-scenarios.cjs`, `tools/proof/fixtures/engine-defs.cjs` | none |
| P2 mechanics | `src/game/12-foes.js`, `src/game/13-platforms.js`, `src/game/14-caret.js`, `src/game/15-tokens.js`, `tools/proof/mech-scenarios.cjs`, `tools/proof/fixtures/mech-defs.cjs` | P1 |
| P3 levels | `src/game/01-world1.js`, `tools/levels-lint.cjs`, `tools/proof/levels.cjs`, `tools/proof/full.cjs`, `tools/proof/programs/*`, `tools/proof/tapes/*` | P1, P2 |
| P4 art | `src/lib.js`, `src/manifest.js`, `src/game/30-draw.js`, `tools/art-check.cjs` | none |
| P5 audio | `src/music.js`, `tools/audio/game-audio.cjs` | none |
| P6 shell | `src/shell.js`, `src/game/45-clock.js`, `src/game/50-menu.js`, `src/crt.js`, `tools/proof/clock.cjs`, `tools/proof/menu.cjs` | P1, P4, P5 |
| P7 release | `tools/build.cjs`, `tools/common.cjs`, `tools/check.cjs`, `tools/site.cjs`, `tools/png.cjs`, `tools/deploy.cjs`, `tools/game-check.cjs`, `tools/proof/determinism.cjs`, `tools/e2e/*`, `web/*` | P1, P2, P3, P4, P5, P6 |

`tools/proof/harness.cjs` (P1) is the shared Node loader every proof uses: `load({ defs })` runs `src/manifest.js`, `src/timeline.js` and every `src/game/*.js` in a vm and merges fixture defs into `CQ.GAME_DEFS`; it also exports `world(opts)`, `startAt(id, opts)`, `run(W, input, frames)`, `encode`, `decode`, `fingerprint`, `snapHash`, `stateHash`. P1 ships it first so P2, P3 and P7 can build on it.

### 14.1 Acceptance per package

- P1: `film.cjs` green (2.2) after every commit; EN1 to EN14 green; the seam (2.4), the API (2.5), the palette slots and flags (2.6), the modes (3.1), the snapshot fields (8) and every P1 event in section 7 exist as written; `FILM.game.demo()` is done at film frame 2001; `node tools/check.cjs` green on the film build.
- P2: MC1 to MC10 green on fixture defs; `film.cjs` still green with P2's files loaded; no hook runs for a film world.
- P3: `levels-lint` green; the maps equal the rows in 4.6 to 4.9 or every change is listed; all four level programs finish in both feel modes with no death inside the frame cap; the perfect run and the secret programs pass; `full.cjs` writes `full.nes` and `full.modern`.
- P4: `art-check` green; check gates 7 to 9 green; the native-buffer hash of every 30th film frame equals a baseline P4 captures before its first edit; every draw item in 9.3 renders from a hand-built snapshot fixture.
- P5: `game-audio` green; the film synth hash is unchanged; loudness within 10.4; check gate 10 green.
- P6: `clock.cjs` and `menu.cjs` green; the game page boots to the title and plays 1-1 with keyboard, touch and a gamepad; check 3 finds nothing in `shell.js`; with `crt.recover` false, check gate 11 stays green.
- P7: both build targets, `site.cjs` output (W1 to W5), G1 to G4, `determinism.cjs`, PW1 to PW14 locally then on production (WebKit only after approval), the deploy steps in W6, and the URL handed to the owner.

## 15. Open questions

- Q1 The Vercel project name: `claude-quest` is the first choice; confirm or name another before P7 deploys.
- Q2 WebKit e2e needs a Playwright browser download; P7 reads its size and source from `npx playwright install --dry-run webkit` and asks the owner before running it. Until then, iPhone coverage is Chromium mobile emulation only.

### 15.1 Coordinator answers (2026-09-23)

- Q1 answered: the project name is `claude-quest`. `claude-quest-game` stays the fallback only if `claude-quest` exists by deploy time. The coordinator runs the deploy itself after the local gates pass; P7 writes `tools/deploy.cjs` and proves it with a dry run but does not deploy.
- Q2 answered: no WebKit download. Phone coverage is Chromium mobile emulation (Pixel 7 and an iPhone-sized viewport).
