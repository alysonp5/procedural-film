# Playable mode: a viewer takes the controller

Owner: player.
Files: `src/play.js` (the playable mode), `src/player.js` (the page, the film transport and the hooks), this file.
`tools/common.cjs` loads `src/play.js` straight after `src/player.js`.
Contracts: `docs/v2-architecture.md` 4.1 (`FILM.game.create`), `docs/display.md` section 4 (the player hooks), `docs/sound.md` section 8 (`FILM.audio.live`).

## 1. What the viewer sees

1. The page opens on film frame 0: the wide shot of the TV set in its dark room, the glass dark before the power-on.
   Under the picture, in the page chrome, `CLICK TO POWER ON` blinks (`TAP TO POWER ON` on a phone).
   Nothing plays and no AudioContext exists until that first gesture, because browsers only allow sound after one.
2. The first click or tap anywhere powers the TV on: the film plays from frame 0 with its sound.
   The chrome then shows the status (time, frame) on the left and the help line in the centre: `ENTER — play · C — CRT · I — inputs · F — fullscreen`.
3. At any moment ENTER takes the controller (on a phone the pad's START, on a gamepad its START).
   The film pauses and a fresh console (`FILM.game.create()`) starts at the title screen with the title song.
   The TV cuts straight to the tube filling the frame, lit and settled, even when ENTER comes during the power-on and its push-in.
   START begins World 1-1.
   The help line changes to the game's keys and the status reads `LIVE  f<frame>  <rate> steps/s`.
4. ESC (on a phone the pad's FILM pill) gives the controller back.
   The film resumes where it paused, or stays paused if it was paused.
   Taking the controller again always starts a new console at the title.

## 2. Controls

| action | keyboard | gamepad (standard mapping) | touch |
|---|---|---|---|
| take the controller | ENTER | START (9) | START |
| give it back | ESC | | FILM |
| move | arrows or WASD | D-pad (12 to 15) or left stick (dead zone 0.5) | D-pad, 8 ways |
| A (jump) | Z or K | right face (1) or top face (3) | A |
| B (run, fire) | X or J | bottom face (0) or left face (2) | B |
| START | ENTER | START (9) | START |
| SELECT | SHIFT | back / select (8) | SELECT |
| CRT or clean pixels | C | | |
| input display | I | | |
| fullscreen | F | | |
| mute | M | | |

The gamepad follows the NES layout: B sits left of A, so the bottom and left face buttons are B and the right and top ones are A, the way Nintendo's own NES collections map a modern pad.
A pad that reports a non-standard mapping still works when its buttons use the same indices; D-pads reported as a hat axis are not read.
Keys with Cmd, Ctrl or Alt held are left to the browser, so shortcuts such as reload still work in live mode.
SPACE does nothing in live mode, so it can never start the film under the game.

## 3. The input display (I)

An NES controller drawn in CSS sits in the chrome's right slot.
During the film its caption is TAPE and it lights the buttons the recorded tape held on the frame on screen (`FILM.game.sim().states[f].btn`), which shows the film is really being played.
In live mode its caption is YOU and it lights what the console saw on its last step.
It starts hidden and I toggles it in both modes.
The film bakes its own input display into the TV picture (`FILM.crt.overlays.input`, docs/display.md section 4).
While the chrome display shows, play.js sets `FILM.crt.overlays.input = false` so the two never double up, and hiding the chrome display puts back the value it found.
A paused film redraws at once to show the change.

## 4. The page layout

The page is a column: the TV canvas, the chrome row (40 px) under it, and on a phone held upright the touch pad under that.
`fit()` in player.js gives the TV the window height minus every in-flow element below it, so no chrome is ever drawn over the picture.
The canvas is still rendered at the display's device pixels and re-mounted on resize, rotation and fullscreen.
The film's 2 px progress bar is hidden in live mode.

Touch devices are detected by `(pointer: coarse)`; `?touch=1` or `?touch=0` forces the choice.
Held upright, the pad sits below the TV: D-pad left, SELECT, START and FILM in the middle, B and A right.
Held sideways, the pad leaves the page flow: the D-pad and the A and B buttons sit in the side margins a 16:9 TV leaves on a phone (about 110 px on an 844 x 390 screen), and SELECT, START and FILM sit in the chrome row.
Each finger is tracked by its pointer id.
A finger that lands on the D-pad keeps steering it from the pad's centre wherever it slides, and a finger on a button can roll onto the other button.
Phones get no C, I, F or M.

## 5. How it runs

### 5.1 The hooks

play.js uses only the player's hooks and never draws the film.

| hook | play.js uses it to |
|---|---|
| `FILM.player.onMount(api)` | build the input display and the touch pad once, before the first layout |
| `FILM.player.onKey(e, api)` | take the controller on ENTER, toggle I, and in live mode own every game key |
| `FILM.player.onFrame(stamp, api)` | poll gamepads every frame; in live mode step, draw and present, and return true |

While `onFrame` returns true the player marks the frame as owned: resize, C and M do not redraw the film, and clicks on the TV do not start the film under the game.
player.js gained these api members for the playable mode: `powered`, `muted`, `audioState`, `touch`, `chrome { root, status, help, slot }`, `relayout()` and `setHelp(text | null)`.
`api.present(frame, opts)` passes `opts` through to `FILM.crt.present`.

### 5.2 The 60 Hz step

The console steps from a fixed-timestep accumulator on the animation-frame timestamp.

- One step is 1000 / 60 ms.
  The accumulator runs a step while it holds at least one step minus 2 ms, so the jitter of a 60 Hz display never skips or doubles a step, and it subtracts a whole step each time, so the long-run rate is exactly 60 steps a second.
- A 120 Hz display steps on every other frame.
  A slow machine drawing 30 frames a second runs two steps a frame.
- Catch-up is capped at 5 steps (83 ms) per animation frame.
  Beyond that the backlog is dropped, so the game slows rather than jumps, and it never runs fast later to make up time.
  A gap over 250 ms (a hidden tab) counts as one step, and the live sound is suspended while the tab is hidden.
- The console is drawn once per animation frame that stepped, into `FILM.native()`, with `create().draw()`, and put on the TV with `api.present(FILM.crt.settledFrame(), { overlays: false })`.
  Every other film frame carries the film's camera and power state (the wide shot and the snow of the power-on), so live play always presents at the settled frame.
  `overlays: false` keeps the film's baked tape pad and closing caption off the live picture.
  A live console never goes dark on the film's clock: `create().draw()` skips the film's power-off blackout.

### 5.3 Inputs into a step

Each step sees keyboard, touch and gamepad buttons ORed together, plus every button pressed since the last step.
That latch means a tap shorter than one frame still reaches the console.
Buttons held at the moment the controller was taken (the gamepad or touch START that took it) are ignored until released, so that press does not also start the game.
Opposite directions pressed together cancel, as a real D-pad cannot press them.
Keyboard buttons clear when the window loses focus.

### 5.4 Sound

Live sound is `FILM.audio.live(ctx, { song: 'title', dest })`, the film's own driver and 2A03 emulation generated as it plays, fed each step's events (song changes included) with `snd.events(ev)`.
It has its own AudioContext with the `interactive` latency hint, made on the first ENTER and reused.
Leaving live mode stops the generator and suspends the context; entering again resumes it.
The film keeps its own context, closed while live mode runs.
A context that had to be made outside a gesture (a gamepad START, a touch-down) starts suspended in a strict browser, and the next gesture of any kind resumes it.
M mutes both through a gain node in front of the destination.

## 6. Tools

`FILM.player.live` gives read-only stats: `active`, `game` (the live console), `steps`, `frame`, `rafs`, `rate`, `buttons`, `overlay`, `audioState` and `sound` (driver frames generated).
None of the playable code runs with `?render=1`, so every tool page stays inert.

## 7. Verification (2026-09-23, Playwright Chromium)

`node tools/build.cjs --out dist/claude-quest.html` inlines 16 files (491.6 KB) and the media scan finds 0 patterns.
`node tools/check.cjs` ends `OK` (9 PASS, 2 WARN outside the player: timeline grid, software-GL frame cost); check 3 scans `src/play.js`.
A Playwright script (a scratch file, not kept) drives the built page with `--autoplay-policy=user-gesture-required` and passes 26 of 26 claims with no console or page errors.

| measurement | result |
|---|---|
| steps a second at the title, 5 s window, GPU | 59.96 (rAF 60.0, live driver 60.16 frames a second) |
| steps a second while playing, 11.6 s window, GPU | 59.97 |
| steps a second, GPU at 1848 x 1040 | 59.94 (59.9 drawn frames a second) |
| steps a second, SwiftShader at 1208 x 680 | 59.83 (24.8 drawn frames a second) |
| steps a second, SwiftShader at 1848 x 1040 | 58.33 (12.1 drawn frames a second, at the catch-up cap) |
| ENTER at film frame 36, camera 0.03 (the wide shot, snow) | the live title fills the tube: 68% sky over the top 60% of the output |
| scripted run: ENTER, START, hold RIGHT + X, Z held 300 ms of every 400 ms | Claw'd from x 40 to x 807 in World 1-1, one death |
| a live console past the power-off end (frame 3477) | the title in 11 colours at frame 3702 |

The scripted run is blind, so it can die: on the current level a search script finds no fixed jump rhythm that clears the first bug at every timing offset.
The claim is that the keys move Claw'd right, and the run reports how far.
A rate script measured the step rate against the drawn frame rate (`FILM_GL=swiftshader` for software GL).
