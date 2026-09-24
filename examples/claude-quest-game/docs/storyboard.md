# Storyboard: CLAUDE QUEST

The plan every agent works from.

## Logline

Claw'd, the Claude Code mascot, plays through a Super-Mario-Bros-style World 1-1 — stomping bugs,
punching blocks, powering up on a sparkle mushroom, plumbing pipes and taking the flag — to rescue
Princess Pearl from the castle. Every pixel is drawn in JavaScript on a 240×135 game-pixel grid
(PX = 8 on a 1920×1080 canvas), scored by a synthesised chiptune.

## Numbers

- 120 bpm → beat 0.5 s = 12 frames → bar 2 s; 8th note = 6 frames, 16th = 3.
- 40 s = 20 bars of 4/4 = 960 frames at 24 fps, 1920×1080 (240×135 game px).
- 17 shots, 2–3 s each, every boundary on the beat grid. All shots `mode: 'none'` (no grain).

## Summary

| Order | Id | Start | End | Title |
|---|---|---|---|---|
| 01 | title | 0 | 2.0 | CLAUDE QUEST title card |
| 02 | start-run | 2.0 | 4.5 | World 1-1, HUD on, Claw'd runs |
| 03 | stomp | 4.5 | 6.5 | Stomp the bug |
| 04 | qblock | 6.5 | 9.0 | ? block → first coin |
| 05 | powerup | 9.0 | 11.5 | Sparkle mushroom → Super Claw'd |
| 06 | pit | 11.5 | 13.5 | Long jump over the pit |
| 07 | stairs | 13.5 | 16.0 | Block staircase, four hops up |
| 08 | shell | 16.0 | 18.5 | Shellbug stomp, shell combo |
| 09 | pipe-down | 18.5 | 21.0 | Down the pipe |
| 10 | cave | 21.0 | 24.0 | Underground coin run |
| 11 | pipe-up | 24.0 | 26.0 | Back to daylight, castle ahead |
| 12 | flagpole | 26.0 | 28.0 | The leap onto the flagpole |
| 13 | slide | 28.0 | 30.0 | Flag slide, +5000, fireworks |
| 14 | castle-in | 30.0 | 32.0 | Into the castle |
| 15 | throne | 32.0 | 35.0 | Princess Pearl found |
| 16 | thanks | 35.0 | 38.0 | THANK YOU CLAW'D! |
| 17 | end-card | 38.0 | 40.0 | Game complete / play again |

## Structure

- Act 1, bars 1–5 (0–10 s): title → run → stomp → coin → the mushroom appears.
- Act 2, bars 6–10 (10–20 s): power-up → pit → stairs → shell combo → pipe. The hinge lands on the
  midpoint downbeat (T 20): Claw'd vanishes into the pipe and the film drops underground.
- Act 3, bars 11–15 (20–30 s): cave → daylight → flagpole → slide → castle door.
- Act 4, bars 16–20 (30–40 s): the rescue — throne room, thanks, end card.
- No match cuts; continuity is the HUD state table, the world-x table and pose continuity (§8 of the
  art bible). The end card rhymes with the title card (same layout, princess added), so the film loops.
- Time device: the HUD TIME countdown (−10/s from 400) and the advancing score.

## Conventions

- `T` is global seconds, `t` is shot-local. All positions below are **game pixels** (240×135 grid).
- World-x is the level coordinate; screen x = world-x − camX. In run shots the hero anchors at
  screen x 64 and camX = heroWorldX − 64 once he reaches the anchor.
- Run speed 72 px/s (3 px/frame). Jump parabola: `y(u) = y0 − 4·h·u·(1−u)`, u = elapsed/air.
  Take-offs and landings sit on beats or 8ths.
- Hero feet rest at y = 103 (ground top) unless perched. Small Claw'd is 16×12, Super Claw'd is the
  same sprite at scale 2 (32×24, feet still at ground).
- Enemies walk left at 24 px/s (bugs), shells slide right at 96 px/s.
- Palette names and sprite names from `docs/art-bible.md`; every prop draws via `lib.sprite`.

## Shared geometry

### G1: HUD state per shot (copy exactly; score and coins never decrease)

| Shot | Score at start | Coins at start | TIME at start | Events (added during the shot) |
|---|---|---|---|---|
| 02 | 000000 | ×00 | 400 | — |
| 03 | 000000 | ×00 | 375 | +100 stomp at T 5.5 |
| 04 | 000100 | ×00 | 355 | coin ×01 and +200 at T 7.5 |
| 05 | 000300 | ×01 | 330 | +1000 power-up at T 11.0 |
| 06 | 001300 | ×01 | 305 | — |
| 07 | 001300 | ×01 | 285 | — |
| 08 | 001300 | ×01 | 260 | +100 T 17.0, +200 T 17.5... see shot |
| 09 | 002000 | ×01 | 235 | — |
| 10 | 002000 | ×01 | 210 | five coins on beats → ×06, +500 |
| 11 | 002500 | ×06 | 180 | — |
| 12 | 002500 | ×06 | 160 | — |
| 13 | 002500 | ×06 | 140 | +5000 at T 28.75 |
| 14 | 007500 | ×06 | 120 | — |
| 15 | 007500 | ×06 | 100 | — |
| 16 | 007500 | ×06 | 70 | +10000 bonus at T 36.0 |
| 17 | no HUD | | | |

TIME ticks down 10 per second within each shot from the table value. TIME display pauses inside the
castle (shots 15–16 hold at their start value — the game has ended).

### G2: Hero world-x at shot starts (run continuity, speed 72 px/s)

| Shot | 02 | 03 | 04 | 05 | 06 | 07 | 08 | 09 |
|---|---|---|---|---|---|---|---|---|
| world-x | 24 | 168 | 312 | 492 | 672 | 816 | 976 | 1156 |

Shots 02–09 are one continuous run. Shot 10 is a separate cave room (hero starts at cave world-x 24).
Shot 11 resumes the surface at world-x 1650 (the pipe carried him forward); 12 starts at 1722.

### G3: Fixed landmarks

- Shot 09 pipe: world-x 1300, 4 tiles tall (rim top y 39).
- Shot 12 flagpole: pole 2 px wide at world-x 1848, from y 40 (ball) to y 103; flag at pole top.
  Castle at world-x 1912 (32 wide), door at 1925–1930.
- Shots 13–14 camera fixed at camX 1704 (pole at screen 144, castle door at screen ~226).

### G4: Jump specs (h = apex px, A = air frames)

| Shot | takeoff (local t) | h | A | lands |
|---|---|---|---|---|
| 03 onto bug | 0.25 | 20 | 18 f | 1.0 (bounce h 8, A 12 f, lands 1.5) |
| 04 block | 0.75 | 30 | 24 f | 1.75 |
| 05 block | 0.5 | 30 | 24 f | 1.5 |
| 06 pit | 0.75 | 30 | 24 f | 1.75 |
| 07 stairs ×4 | 0.5, 1.0, 1.5, 2.0 | 28 | 12 f each | on next step top |
| 08 stomp | 0.5 | 22 | 12 f | on shellbug at 1.0, bounce A 12 f |
| 09 onto pipe | 0.75 | 68 | 24 f | on pipe rim 1.75 |
| 12 flagpole | 1.0 | 55 | — caught at apex 1.75 | on the pole |

## Shots

---

## 01 title: CLAUDE QUEST

T 0–2.0, mode none, hard cut in (film start).

### Composition

caveBlack screen. "CLAUDE QUEST" in pxtext scale 3, centred x 120, top y 36. Claw'd (`clawdIdle`)
centred at x 112, feet y 96. "PRESS START" scale 1 centred x 120, y 108, blinking. Two `sparkle`
sprites twinkle beside the title.

### Forms

Pixel text hudWhite; Claw'd idle sprite; sparkles (sparkle, fireYellow on alternate frames).

### Overlays

No HUD this shot.

### Motion

T 0–0.75: the title types on letter by letter, one letter per 16th. T 0.75: "PRESS START" appears and
blinks 2 Hz (on beats). T 1.0 and T 1.5: a sparkle pops beside the title (scale 1, 6-frame pop).
Claw'd holds idle, a 2-frame body bob on twos.

### Camera

Static.

### Enter and exit

Opens the film. Hard cut to shot 02 on the T 2.0 downbeat.

### Subject

The title-card layout of an NES game; Claw'd's exact sprite (art bible 10.1).

### Sound

T 0.5: title jingle — a bright square-wave arpeggio climbing C5–E5–G5–C6 in 16ths, sparkle ping at
T 1.0 and T 1.5 (high sine, 2 kHz, 80 ms).

---

## 02 start-run: World 1-1

T 2.0–4.5, mode none, hard cut.

### Composition

Overworld: `sky` fill, cloud at (60, 18) and (180, 30), hill at world-x 24 (base y 103), bush at
world-x 130, ground strip full width. HUD pops on. Claw'd stands at screen x 24. A bug enters from
the right edge late in the shot.

### Forms

`lib.groundStrip`, `cloud`, `hill`, `bush`, `clawdIdle`→`clawdRun1/2`, `bug1/2`.

### Overlays

HUD with G1 values (score 000000, ×00, TIME 400 ticking).

### Motion

T 2.0: HUD pops (3-frame pop). T 2.0–2.5: Claw'd idles. T 2.5: he breaks into a run (run1/run2 at
8 Hz), camera starts scrolling when he reaches screen x 64 (T ≈ 3.06). T 3.5: a bug walks in from the
right edge at 24 px/s.

### Camera

Static until T 3.06, then scrolls right at 72 px/s (camX = heroWorldX − 64).

### Enter and exit

Ends mid-run, hero at world-x 168 — shot 03 continues the same world.

### Subject

SMB 1-1's opening screen grammar (art bible 10.4–10.5).

### Sound

T 2.0: the run theme starts on the downbeat — a bouncy original chiptune melody, square lead +
triangle bass on 8ths, ~8 bars through shot 09. T 3.5: bug's little two-note waddle motif.

---

## 03 stomp

T 4.5–6.5, mode none, hard cut (mid-run).

### Composition

Same world, camX 104 at start. The bug from shot 02 walks left toward the hero. Cloud (140, 22),
bush at world-x 260.

### Motion

T 4.75 (local 0.25): Claw'd jumps (h 20, A 18 f), still moving right at 72 px/s. The bug walks into
his landing point: they meet at world-x 240 at T 5.5. T 5.5 (local 1.0): STOMP — the bug becomes
`bugFlat`, a "+100" pxtext pops above it (rises 8 px over 12 frames, fades), Claw'd bounces (h 8,
A 12 f) and lands T 6.0, still running.

### Camera

Scrolls right at 72 px/s throughout.

### Enter and exit

Hero entered running, leaves running; world-x 312 at the cut.

### Sound

T 5.5: stomp — a 100 ms noise squish with a 300→80 Hz pitch drop, plus the +100 blip (E6, 60 ms).

---

## 04 qblock

T 6.5–9.0, mode none, hard cut (mid-run).

### Composition

A floating row at y 67–83: `tileBrick` at world-x 368, `tileQ` at 384, `tileBrick` at 400.
Cloud (200, 16).

### Motion

T 7.25 (local 0.75): jump (h 30, A 24 f). T 7.5 (local 1.0): his head meets the ? block's underside
at apex — the block hops 4 px and back (6 frames), becomes `tileUsed`, a coin pops out of its top
(`coin1→2→3` spin, rises 12 px, 12 frames) and vanishes; HUD coins ×00→×01, score +200 with a
floating "+200". T 8.25: lands, keeps running.

### Sound

T 7.5: block bump (low 120 Hz thud) + coin pling (B5→E6 two-note, 120 ms).

---

## 05 powerup

T 9.0–11.5, mode none, hard cut.

### Composition

A second block row at y 67: `tileBrick` world-x 544, `tileQ` 560, `tileBrick` 576. Hill at
world-x 640.

### Motion

T 9.5 (local 0.5): jump. T 10.0 (local 1.0): head-bump — the sparkle mushroom (`mush`) rises out of
the block top over 12 frames, slides right at 24 px/s, drops to the ground at world-x ~620 and keeps
sliding. Claw'd lands T 9.5+1.0 = T 10.5 and runs after it. T 11.0 (local 2.0): he touches it —
POWER UP: 3-frame white flash on the hero, an 8-sparkle radial burst, and he grows to scale 2
(flicker small→big 3 times over 9 frames). HUD +1000.

### Sound

T 10.0: mushroom emerge (rising slide 200→900 Hz, 300 ms). T 11.0: power-up arpeggio —
C5–E5–G5–C6–E6 in 16ths with a shimmer.

---

## 06 pit

T 11.5–13.5, mode none, hard cut.

### Composition

The ground has a 2-tile gap from world-x 752 to 784 — a `caveBlack` void with `brickDeep` inner
walls. Super Claw'd (scale 2) runs toward it.

### Motion

T 12.25 (local 0.75): the long jump (h 30, A 24 f), `clawdJump` at scale 2, legs tucked.
T 13.25 (local 1.75): lands on the far side, runs on.

### Camera

Scrolls throughout; the pit crosses the frame's centre at the apex (T 12.75).

### Sound

T 12.25: jump whoosh (filtered noise sweep up). T 13.25: soft land thud.

---

## 07 stairs

T 13.5–16.0, mode none, hard cut.

### Composition

A staircase of `tileBlock` columns: 2-wide columns at world-x 880 (1 high), 912 (2 high), 944
(3 high), 976 (4 high), tops at y 87/71/55/39, then a plateau 1008–1040 at 4 high.

### Motion

Four hops on the beat: local 0.5, 1.0, 1.5, 2.0 (T 14.0–15.5), each h 28, A 12 f, landing on the next
step top exactly on the next beat. He stands on the plateau as the shot ends.

### Sound

T 14.0, 14.5, 15.0, 15.5: four rising hop "boips" (square, 300/380/460/540 Hz, 90 ms each).

---

## 08 shell

T 16.0–18.5, mode none, hard cut.

### Composition

Flat ground. A shellbug (`shellbug1/2`) enters from the right walking left; two bugs follow further
right. Bush at world-x 1080.

### Motion

T 16.5 (local 0.5): hop (h 22, A 12 f). T 17.0 (local 1.0): stomp — the shellbug becomes `shell`,
+100 pop. T 17.5 (local 1.5): Claw'd kicks it — the shell slides right at 96 px/s. Place bug2 and
bug3 walking left at 24 px/s so the shell meets them exactly at T 18.0 and T 18.5 (compute spawn
positions from those meeting times). Each hit: bug flips upside-down and falls off the bottom,
"+200" then "+400" pops.

### Sound

T 17.0 stomp, T 17.5 kick "tok" (woodblock 800 Hz), T 18.0 and T 18.5 combo hits (rising square
blips G5, B5).

---

## 09 pipe-down

T 18.5–21.0, mode none, hard cut.

### Composition

A tall pipe at world-x 1300, 4 tiles (rim top y 39). Cloud (100, 20). The run theme's last bar.

### Motion

T 19.25 (local 0.75): jump (h 68, A 24 f) onto the rim, landing T 20.25 (local 1.75). He stands
(idle, one beat). T 20.5 (local 2.0): he sinks straight down 26 px over 0.5 s, disappearing behind
the pipe rim (draw the rim OVER the hero). Shot ends on the empty pipe.

### Sound

T 19.25: jump. T 20.5: pipe entry — three descending glugs (400→300→200 Hz) as the music cuts.

---

## 10 cave

T 21.0–24.0, mode none, hard cut (or 6-frame fade from the pipe shot), underground plate.

### Composition

caveBlack sky, a `tileGroundCave` strip (the cave ground tile), a cave-brick ceiling 2 tiles deep
across the top (y 0–31), cave brick walls. Five coins in a rising arc at world-x 60/96/132/168/204,
y 71 down to 55 and back. One bug patrols at world-x ~300. Hero starts at screen x 24 running
(he is Super).

### Motion

He runs and collects: each coin vanishes with a 3-frame sparkle as he reaches it — exactly on beats
T 21.5, 22.0, 22.5, 23.0, 23.5 (coin counter ×02…×06, +100 each). T 23.5: he hops the patrolling bug
(h 24, A 12 f) and runs on as the shot ends.

### Sound

The cave theme: a sparse minor square-bass groove. Five coin plings on the five beats, ascending.

---

## 11 pipe-up

T 24.0–26.0, mode none, hard cut to daylight.

### Composition

Overworld again. A 2-tile pipe at world-x 1650 (rim top y 71). Far right, small with distance: the
castle silhouette and flagpole (world-x 1912/1848, entering frame at the end). Hills at 1700, 1780.

### Motion

T 24.0–24.75: Claw'd rises out of the pipe (the reverse of shot 09's sink, 0.75 s). T 25.0: hops off
(h 20, A 12 f) and runs right; the camera scrolls and the castle grows on the horizon.

### Sound

T 24.0: rising glug (200→400 Hz). T 25.0: the run theme resumes, brighter (doubled an octave up).

---

## 12 flagpole

T 26.0–28.0, mode none, hard cut.

### Composition

The flagpole at world-x 1848 (pole from y 40 to ground, ball on top, triangular `flag` flying right
at y 44). The castle at 1912.

### Motion

Claw'd sprints. T 27.0 (local 1.0): THE jump (h 55, A 36 f) — a soaring arc. T 27.75 (local 1.75):
at apex he touches the pole at y 48 and grabs on (`clawdPole`); the flag twitches.

### Sound

T 27.0: big jump whoosh. T 27.75: pole grab — a bright "zang" (square chord stab C5+E5).

---

## 13 slide

T 28.0–30.0, mode none, hard cut. Camera fixed at camX 1704 (G3).

### Composition

The pole at screen 144, castle at 1912 (screen ~208). Sky, one cloud.

### Motion

T 28.0–28.75: he slides down the pole (y 48 → 91) as the flag slides with him. T 28.75: "+5000"
pops, HUD score jumps to 007500. T 29.0: he hops off right (h 12, A 12 f). T 29.0 and 29.5: two
firework bursts in the sky (8-sparkle radials, fireOrange then fireYellow). He lands and runs toward
the castle.

### Sound

T 28.0: slide whistle down (900→300 Hz, 0.7 s). T 28.75: score tally arpeggio. T 29.0/29.5: two
firework pops (filtered noise bursts with a sine tail).

---

## 14 castle-in

T 30.0–32.0, mode none, hard cut. Camera fixed at camX 1704.

### Composition

The castle fills the right half; its pennant flies. Claw'd runs in from the left.

### Motion

T 30.0–31.5: he runs the last 148 px to the door (world-x 1790 → 1938). At the door (screen ~226)
he passes BEHIND the castle wall (draw order swap) and vanishes inside by T 31.75. Hold on the empty
castle; the pennant twitches once.

### Sound

T 30.0: castle fanfare — a short triumphant square-brass figure (C5–F5–A5–C6). T 31.75: door "clunk".

---

## 15 throne

T 32.0–35.0, mode none, fade in 0.25. Castle interior plate.

### Composition

caveBlack hall; `castleBrick` floor at y 103–135 with `castleDeep` seams; two wall pillars with
torch flames (`fireOrange`/`fireYellow`, 2-frame flicker) at x 40 and x 200. Princess Pearl stands on
a 3-step castle-brick pedestal at x 170, feet y 91. Claw'd (Super) enters from the left.

### Motion

T 32.5: he sees her — a "!" pops above his head. He walks to x 140 by T 33.5. She hops twice
(T 33.5, 34.0, h 8, A 8 f). T 34.0–35.0: three hearts rise between them (heart sprite, drifting up
12 px with a sine wobble, fading). She waves (`princessWave`).

### Sound

T 32.0: a warm waltz (3/4 feel over the grid, soft triangle lead). T 33.0: "!" pling. T 34.0: three
heart pops, rising pitch.

---

## 16 thanks

T 35.0–38.0, mode none, hard cut.

### Composition

Same throne room. "THANK YOU CLAW'D!" pxtext scale 2 centred x 120, y 28. Below it, T 36.0:
"THE PRINCESS IS SAVED!" scale 1 centred, y 44. Hero and princess side by side on the floor.

### Motion

The text types on over 0.5 s each line. Both characters bounce on beats (small hops). T 36.0:
"+10000" and the score rolls to 017500. T 36.5, 37.0, 37.5: sparkle bursts frame the pair.

### Sound

T 35.0: victory fanfare (the title jingle's rhythm, up a fourth). T 36.0: bonus tally cascade.
T 37.0–37.5: sparkles.

---

## 17 end-card

T 38.0–40.0, mode none, hard cut.

### Composition

caveBlack card — the title layout revisited: "CLAUDE QUEST" scale 3 centred y 32; "GAME COMPLETE"
scale 1 y 58; "PRESS START TO PLAY AGAIN" scale 1 y 72, blinking 2 Hz; Claw'd at x 96 and Princess
Pearl at x 128, feet y 96, one heart floating above them.

### Motion

Text types on over the first second; the heart rises 6 px and resets each second; both sprites bob.

### Sound

T 38.0: the title jingle reprised once, then a final coin ping at T 39.5 that rings out.

---

## Appendix: from doc to code — `src/timeline.js`

The timeline is the storyboard as data; `cues` collects every Sound entry above (kinds: hit, sfx,
cut, swell) at the exact grid times.
