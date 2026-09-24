# Claude Quest v2: the story, beat by beat

Owner: game.
The audio agent composes against the frames on this page.
Every frame number is a global frame at 60 fps (frame 0 is the TV's first frame).
The numbers come from the simulation itself (`FILM.game.sim()`), so they change only when `src/game/*.js` changes.
After such a change, read the frames again from `FILM.game.events()` and update this page.

The film is 3627 frames (60.45 s), set in `src/timeline.js`.
The TV powers on over frames 0 to 120 and off over frames 3357 to 3477, then stays dark for 150 frames (the closing caption) to frame 3626.

## 1. Beats

| frame | beat |
|---|---|
| 0 | The cartridge boots into the title screen under the TV's power-on. Song `title`. |
| 0 to 199 | Title: the Claude-Code-style welcome box (salmon border, ✻, CLAUDE QUEST, ©1986 CLAWD SOFT inside it) over the first screen of World 1-1, the menu `▶ NEW QUEST` / `CONTINUE`, `HI-SCORE 000000`, the HUD with no time. Claw'd stands at the start, blinking. |
| 200 | START is pressed. Event `start`, song `none`. The ▶ cursor flickers for 20 frames. |
| 220 to 309 | Black lives screen: WORLD 1-1, Claw'd × 3, HUD on top. Silent. |
| 310 | World 1-1 begins, the first playable frame. Song `overworld` section `intro`. A bug is already walking in. |
| 375, 401 | A running hop and the first stomp (100), on the open first screen. |
| 465 to 500 | A running leap over the first pit through its arc of five coins (`coin` at 475, 481, 487, 493, 500). |
| 541 | Over the low left pipe into the floppy gateway (two low pipes, a brick lintel between them). |
| 623, 632 | He knocks the floppy block in the lintel: the floppy disk sprouts. |
| 632 to 727 | It rises onto the lintel and slides off its end while Claw'd walks out under the open sky to meet it. |
| 728 | He catches it as it drops: event `powerup`, 1000 (the pop appears above his head after the pause). The world freezes for the grow flicker (small, mid, big) until frame 787. |
| 789 | Big: up onto the gateway's far pipe and off it. |
| 863 to 912 | The brick canopy: three bricks smashed on the run (`brick` 872, 892, 912), each tossing up the coin that sat on it (`coin` on the same frames). |
| 961, 973 | Past the canopy he leaps at empty air: a hidden block appears and the Claude spark sprouts. He brakes in the air and turns to it. |
| 1007, 1030 | A full leap to the top of the spark's arc: he catches it at frame 1030, 720 frames after the overworld song started (the hook's cadence). Song `star`, 1000, a 2-frame white flash (1030, 1031). |
| 1030 to 1298 | The invincible run, Claw'd palette-cycling (white, gold, magenta, his own): eight bugs knocked out in one chain (`kick` combo 1 to 8 at 1080, 1093, 1112, 1163, 1178, 1244, 1257, 1269), the brick shelf smashed overhead (`brick` 1151, 1171), a pit leapt at 1207. |
| 1299 | The star runs out. Song `overworld` section `B`. |
| 1335 to 1359 | A ? block on the run (coin 1344), the last bug stomped on the way down (1351), the bounce into the second ? block (coin 1359). |
| 1372 | Up onto the pipe. |
| 1394 | DOWN: he sinks into the pipe. Events `pipe` and song `none` on the same frame. |
| 1432 | The coin room: he drops in through the gap in the ceiling. Song `underground`. |
| 1499 to 1537 | One running leap over the hump of floor blocks through its arc of eight coins (`coin` 1501 to 1537). |
| 1550 | Into the sideways pipe. Events `pipe` and song `none`. |
| 1582 | He rises out of the exit pipe (the shortcut skips a stretch). Event `pipe`, song `overworld` section `A`. |
| 1615 to 1701 | Off the pipe onto the shell-bug: stomp (100, 1654) and the shell booted at once (`kick` combo 1, 1655); it bowls over three bugs (`kick` combo 1, 2, 3 at 1673, 1682, 1701). |
| 1744, 1777 | Up the two floating platforms. |
| 1805, 1821 | A short hop from the high platform to the very top of the flagpole. Event `flagpole` height 5000 frames 21, song `none`. |
| 1821 to 1842 | The slide: Claw'd and the flag come down together and arrive on the same frame (21 frames); the 5000 rises up the pole. |
| 1842 | He is at the pole's foot: song `flag` (the course-clear fanfare, 168 frames, to 2009). |
| 1842 to 1873 | He swings round the pole and hops off. |
| 1873 to 1956 | He walks into the castle; its door and right wall cover him as he goes (hidden at 1956). |
| 1961 to 2005 | The castle flag climbs out of the right turret. |
| 2010 to 2044 | The fanfare is over: the time tally, 35 `tally` events, one a frame, 10 time units (500 points) each. |
| 2045, 2061, 2077 | Then three big fireworks (a top-of-the-pole grab earns them), 500 each, a 1-frame pale-sky flash on each burst. |
| 2112 to 2201 | Black lives screen: WORLD 1-4. Song `none`. |
| 2202 | World 1-4, the castle. Song `castle`. |
| 2318 | Over the first lava pit (bubbles rise and pop in every pit). |
| 2318 to 2410 | Down the firebar hall under the stepped ceiling, under the first firebar as it swings up (a fireball passes within 1 px at 2373). |
| 2425 | A quick hop over the second pit from its lip, on the run. |
| 2425 to 2558 | The second firebar turns the other way and faster; he waits a moment, runs under it with a fireball passing 4 px from him at 2532 (the planned close call), and jumps up the step to the bridge (2540). |
| 2587 | The Big Bug hops. Event `hop`. |
| 2627 | Claw'd clears the Big Bug in one bound. |
| 2647 | The Big Bug roars. Event `roar`. |
| 2689 | He presses the ENTER key, standing on its platform. Events `axe` and song `none`. The camera holds on the bridge; the chain goes first. |
| 2701 to 2745 | The bridge collapses from the key end, one segment every 4 frames: 12 `bridge` events, i = 0 to 11. Claw'd turns to watch; the Big Bug looks down. |
| 2749 | The Big Bug falls. Event `bossfall` (64 frames). It splashes into the lava at 2773 (two splashes, a 1-frame dark-red flash) and sinks behind the surface. |
| 2813 | Song `rescue`. The camera lets go; Claw'd runs to Pearl, down off the key's platform into her room (banners, torches), easing to a walk. Pearl waves him in from 2853. |
| 2947 | He stops beside her. |
| 2957 | Bar 2 of the rescue song: a heart rises between them and they hop together. |
| 2985 | They hop together again; Claw'd lands in the victory pose, claws up. |
| 3101 | Song `ending` (a 256-frame tag), and Pearl's line types on at one frame a character. Event `text` i=0 `YOU DID IT, CLAW'D!` |
| 3150 | Event `text` i=1 `✻ QUEST COMPLETE` |
| 3176 | Event `text` i=2 `✓ 15 BUGS SQUASHED` (the run's own count, the boss included) |
| 3204 | Event `text` i=3 `✓ 18 COINS` (the run's own count) |
| 3224 | Event `text` i=4 `✓ ALL TESTS PASS` |
| 3264 | PUSH START TO SHIP IT starts blinking (32 frames on, 16 off). No event. |
| 3357 to 3477 | The TV powers off (256 frames after the ending song starts). |
| 3477 to 3626 | Dark glass and the closing caption (150 frames), the loop's seam. |

The rescue song runs 288 frames (2813 to 3100) before the ending song takes over: bar 1 is the run to Pearl, bar 2 the meeting.

## 2. Song changes

| frame | song |
|---|---|
| 0 | `title` |
| 200 | `none` (START; stays silent through the lives screen) |
| 310 | `overworld` section `intro` |
| 1030 | `star` (overworld + 720) |
| 1299 | `overworld` section `B` |
| 1394 | `none` (into the pipe) |
| 1432 | `underground` |
| 1550 | `none` (into the sideways pipe) |
| 1582 | `overworld` section `A` |
| 1821 | `none` (the flagpole grab) |
| 1842 | `flag` (at the pole's foot, the slide's last frame; 168 frames, then the tally at 2010) |
| 2112 | `none` (lives screen 1-4) |
| 2202 | `castle` |
| 2689 | `none` (the ENTER key) |
| 2813 | `rescue` (64 frames after `bossfall`) |
| 3101 | `ending` (with the first `text`) |

## 3. Events

| type | count | first | last | data |
|---|---|---|---|---|
| song | 16 | 0 | 3101 | `id`; `section` (`intro`, `A`, `B`) on overworld songs |
| start | 1 | 200 | 200 | |
| jump | 24 | 375 | 2627 | `big` |
| stomp | 3 | 401 | 1654 | `combo`: the chain since Claw'd last stood on the ground |
| kick | 12 | 1080 | 1701 | `combo`: the star's chain, or the shell's own chain; the player booting a shell is also `kick` combo 1 |
| coin | 18 | 475 | 1537 | |
| sprout | 2 | 632 | 973 | |
| powerup | 1 | 728 | 728 | |
| brick | 5 | 872 | 1171 | |
| pipe | 3 | 1394 | 1582 | enter down, enter sideways, rise out |
| flagpole | 1 | 1821 | 1821 | `height`: the points for the grab (5000); `frames`: the slide's length (21) |
| tally | 35 | 2010 | 2044 | `n`: time left after the tick |
| firework | 3 | 2045 | 2077 | |
| hop | 1 | 2587 | 2587 | the Big Bug leaves the bridge |
| roar | 1 | 2647 | 2647 | the Big Bug's 30-frame roar starts |
| axe | 1 | 2689 | 2689 | Claw'd presses the ENTER key |
| bridge | 12 | 2701 | 2745 | `i`: 0 at the key end |
| bossfall | 1 | 2749 | 2749 | |
| text | 5 | 3101 | 3224 | `i`, `line`, `every` (frames per character, 1) |

`bump` and `oneup` exist in the engine but do not occur in the film: a `bump` fires when Claw'd heads a solid block (or a brick while small), a `oneup` on the 100th coin or an 11-long chain.
The optional `fireball` is not emitted.

## 4. The timing contract (docs/v2-architecture.md 8.2), as the film meets it

| rule | film |
|---|---|
| `crt.powerOn` = [0, 120] | [0, 120] |
| START ~190-220, lives ~90 frames, first play by ~330 | START 200, lives 220 to 309, play at 310 |
| `song none` on the pipe-entry frame | 1394 and 1550 |
| overworld sections: `intro` first, `B` after the star, `A` after the coin room | 310 `intro`, 1299 `B`, 1582 `A` |
| the star lands on the hook's cadence | `star` at 1030 = `intro` + 720 |
| `flagpole.frames` = the slide | 21, and the flag reaches the bottom 21 frames after the grab |
| `flag` at the pole's foot, 168 frames, tally after | 1842 (the slide's end, no gap); first tally 2010; fireworks after the tally |
| `hop`, `roar`, `axe` events | 2587, 2647, 2689 |
| `rescue` ≥ 64 frames after `bossfall` | 2749 to 2813: 64 |
| ≥ 288 frames of rescue before `ending` | 2813 to 3101: 288 |
| `ending` with the first `text`; `crt.powerOff` ≥ 256 frames later | 3101; power-off from 3357 (256) |
| `text.every` = 1 | 1 |
| no ≥ 20-frame stretch without motion in play | none (checked over every play frame, torches and bubbles not counted as motion) |
| 58 to 62 s | 60.45 s |

## 5. The maps

The maps are ASCII in `src/game/00-levels.js`, written as screens joined left to right.
Tiles are 16 px; row r has its top at y = 16r - 12, so the ground rows r10 and r11 fill y 148 to 180 and r3 (y 36 to 52) is the first row below the 32 px HUD band.
Rows r0 to r2 stay empty in every map, and the draw pass clips everything from the world at y 32, so nothing enters the HUD band.

| char | tile |
|---|---|
| `.` | air |
| `#` | ground (overworld), floor block (castle) |
| `B` | brick; breaks when Claw'd is big |
| `?` | ? block with a coin |
| `M` | ? block with the floppy disk (the grow item; sprite `mushroom`) |
| `*` | hidden block with the Claude spark (solid only from below) |
| `U` | spent block (set by the engine) |
| `X` | hard block |
| `[` `]` | pipe rim, left and right |
| `{` `}` | pipe body, left and right |
| `!` `\|` | flagpole ball and pole |
| `o` | coin |
| `g` `k` | bug, shell-bug (spawn points) |
| `W` `G` | underground wall brick, underground floor |
| `h` `H` | sideways pipe mouth, top and bottom |
| `-` `_` | sideways pipe body, top and bottom |
| `j` `J` | where the sideways pipe joins the vertical one |
| `w` | castle wall brick |
| `L` `l` | lava surface, lava |
| `=` | bridge segment |
| `%` | the chain |
| `A` | the ENTER key (the axe's role; sprites `axe1` to `axe3`) |
| `f` | a block carrying a firebar |
| `p` | Princess Pearl |

World 1-1 is 192 tiles, in set pieces of our own: the open first screen and its bug (0 to 19); an arc of five coins over a pit (20 to 35); the floppy gateway, two low pipes (39 to 40, 51 to 52) with a brick lintel between them holding the floppy block (36 to 57); the brick canopy with a coin on each brick and, past its end, the hidden spark block (58 to 81); the star run with three bug packs, a brick shelf and a short pit (82 to 121); a quiet stretch with two ? blocks, a bug and the pipe down (122 to 137); the stretch the coin room skips and the pipe back up (138 to 149); the shell-bug and its three bugs (150 to 167); two floating platforms climbing to the flagpole (179) and the castle (185 to 189).
The coin room is one screen: a hump of floor blocks under an arc of eight coins.
World 1-4 is 88 tiles: the entry platform under a stepped ceiling, the first lava pit, the hall with the first firebar, the second pit, the second firebar (the other way, faster), the step up, the bridge (52 to 63), the chain, the ENTER key on its platform (64 to 66) and Pearl's room (67 to 87), open to the dark above, with two banners and wall torches.

1-1's scenery is a hand-placed list in the level definition: the title screen keeps its clouds clear of the welcome box and its big hill away from Claw'd, no hill or bush stands behind or under a pipe, a pit, the pole or the castle, and no dark hill sits behind the floppy catch.
The draw pass drops any hill or bush whose ground is missing or blocked, so a map edit cannot put one behind a pipe.

## 6. How the tape is authored

The film is one console program driven by one controller tape, from power-on to power-off.
The tape is not typed frame by frame.
`src/game/20-tape.js` holds a short program of a player's intentions ("run to x", "stop here", "jump when the jump works"), and a bot plays it against the live engine, reading the same state a player sees.

The precise moments come from a planner.
At each frame it copies the world (`cloneWorld`), plays "press A now, hold it n frames, then these buttons" forward on the copy, and presses A for real only when the copy reaches the goal: a stomp, all the coins of an arc, a landing on a pipe, catching the spark, the top of the flagpole, clearing the Big Bug.
A run-up variant plays "run to x, then jump" and is how the second firebar is passed: the plan is accepted only if a fireball comes within 5 px of Claw'd without touching him (the close call).
The spark catch is planned to an exact frame: the leap is taken only if the `star` song would start 720 frames after the overworld song.
Every plan obeys two style rules: the top of Claw'd's drawing stays at y 32 or lower (under the HUD band), and a jump that loses its speed against a wall is rejected.

The program's output is recorded in `src/game/21-recorded.js`: 3627 frames of buttons, run-length coded, with a fingerprint of the run they produce.
`FILM.game.sim()` replays the recording (about 20 to 30 ms); if the engine has changed since and the fingerprint no longer matches, it plays the program live instead (about 200 ms), so the film cannot desync.
`FILM.game.record()` regenerates the recording's data.
Every frame's buttons are in `FILM.game.tape()` and `states[f].btn` (for the input display).

Live play (`FILM.game.create()`) runs the same `step()` with a person's buttons, from the title screen.
Deaths (with the `clawdS_dead` pose), the lives screens, a game over and a restart from the ending (START) all work there.
A live console never goes dark on the film's power-off clock: only the film's own frames (`FILM.game.draw`) are black after `crt.powerOff[1]`.
