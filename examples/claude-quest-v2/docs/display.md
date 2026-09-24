# Display: the TV (`src/crt.js`) and the tools

Owner: crt. The contract is `docs/v2-architecture.md` sections 4.3 and 8.4; this file is how it is built and how to use it.
The HTML player and the playable mode belong to the player agent: see `docs/playable.md`.

## 1. API

```js
FILM.crt.present(srcCanvas, outCtx, { frame, T, overlays })  // fill outCtx.canvas (any size) with the TV;
                                                             // overlays: false skips the proof layers once
FILM.crt.mode        // 'crt' (default) | 'clean' (FILM.presentNearest: whole-pixel nearest-neighbour, no layers)
FILM.crt.overlays    // { input: true, caption: true }: the baked proof layers (section 4)
FILM.crt.backend     // 'webgl2' | 'webgl' | 'cpu' | 'nearest'; null until the first present
FILM.crt.renderer    // the rasteriser behind it, e.g. "ANGLE (... SwiftShader driver)" in the tool browser
FILM.crt.force       // set before the first present to test a fallback: 'webgl' | 'cpu' | 'nearest'
FILM.crt.power(f)    // pure: what the TV is doing at global frame f ({ stage, lit, snow, roll, line, led, ... })
FILM.crt.camera(f)   // pure: { t, zoom, cx, cy }; t 1 = the tube fills the frame, 0 = the wide shot of the set
FILM.crt.marks()     // the power sequences' key frames (section 3)
FILM.crt.inputWindows()  // [[f0, f1], ...] the frames the input display shows
FILM.crt.captionWindow() // [f0, f1] the closing caption, or null when the film leaves no room for it
FILM.crt.settledFrame()  // a frame with the TV on and the tube filling the frame (live play presents with it)
FILM.crt.caption     // the caption's three lines
FILM.crt.params      // tunables (section 5); set before a render, never per frame
FILM.crt.reset()     // drop the GL state (tools: a cold start, or another backend)
FILM.crt.lutInfo()   // { hueDeg, satGain } of the fitted composite decoder
```

`src/scenes/01-game.js` calls `present(FILM.native().canvas, ctx, { frame: f })` every frame.

**Determinism rule.** A present is a pure function of the 320x180 source pixels and the frame index.
Nothing carries over between presents: the power state, the camera, the room's light (the picture's average colour this frame), the input display and the caption are all recomputed from `f`.
Every GL target is fully rewritten before it is read, every uniform is set every frame, and every cache is keyed on its true inputs (the palette table, the lookup table's parameters, the simulation object).
Noise (snow, jitter, grain, the static dither) is hashed from pixel position and frame.
Root cause of the round-2 red: Chrome rasterises a 2D canvas differently once another canvas has been drawn into it.
A clean-mode present does that (`drawImage` of the frame buffer), and the input pad drawn on `FILM.ctx` afterwards hashed differently (±1 on blends, more on anti-aliased edges).
So no vector drawing ever touches the output any more.
Each proof layer is drawn on a private scratch canvas and blended into the output's pixels in integer arithmetic (a CPU-backed output, the tools).
A GPU-backed output (the player) gets `drawImage` of the scratch canvas instead.
Proof: `node tools/check.cjs --det 60` passes on a frozen snapshot.
A repro draws each target cold, then again after a clean-mode draw, the caption and the dot first, a reverse sweep and a forward sweep; every target hashes identically.

Backends are tried in order: WebGL2, then WebGL1 (needs `OES_texture_float`), then a CPU approximation, then nearest.
WebGL1 runs the same shaders through a GLSL ES 1.00 header.

## 2. The pipeline

1. **Index.**
   Every native pixel is an NES colour, so it maps back to its palette index.
   `#000000` maps to `$0F` (never `$0D`, blacker than black) and `#FCFCFC` to `$20`.
2. **Composite decode.**
   The signal is synthesised from each index the way the 2C02 PPU does it (NESdev wiki, "NTSC video"): a 12-phase square wave between the per-level voltages, 8 samples a pixel, a 4-sample phase shift each scanline.
   The TV decodes it with a 12-sample luma box plus a sharpness peak, and demodulates I/Q through a 36-sample Hann low-pass.
   The linear chain is folded into a 36 x 192 float lookup table, so the decode shader sums nine neighbouring pixels into a 1280x180 texture.
   A least-squares complex gain fits the demodulator to lib.NES (118.6 deg, x0.758), and a per-index DC correction makes flat areas decode to exactly their lib.NES colour.
   `artifacts` (0.35) blends the raw signal's edges (the NES zipper, cross-colour) with band-limited luma and chroma.
   Round 2 narrows the band-limited luma to a gaussian (sigma 2.3 samples) and cuts the glow from 10% to 7%, which tightens the 1:1 softness.
   The frame phase is fixed, so artifacts never crawl.
3. **Glow.**
   A linear 320x180 copy blurred (sigma 1.3 px) for the glow, and an 80x45 copy blurred (sigma 2.6) for the halation.
4. **The camera and the set.**
   `FILM.crt.camera(f)` maps each output pixel into the room (units: half the tube's height).
   The wide shot (`params.wide`, zoom 0.44) shows a procedural 1980s set, drawn smooth rather than in pixels:
   - a walnut-veneer cabinet with grain, a moulded plastic bezel whose inner lip catches the glass's light, and the curved glass;
   - a control panel with a ticked channel dial and a volume knob (aluminium skirts, specular from the screen), a power button, a red pilot light and a speaker grille;
   - a maker's badge, on a lacquered sideboard in a dark room with striped wallpaper.
   The only light is the screen's.
   Each frame, `emitLight` averages the picture's colour in linear light (left half, right half, bottom half) from the palette-index histogram, through what the tube is doing: snow, the squeeze, the line and the dot.
   That light falls on the wall (a bounce halo around the set), the bezel lip, the knobs and a pool on the tabletop in front of the set.
   A faint cool window light keeps the set readable while the screen is dark.
   The tube shader is compiled twice: the room variant runs only in the set shots.
   With the tube filling the frame only the bezel's corners show, and the two variants agree exactly there, so the push-in lands without a pop.
   The room variant's code alone would cost SwiftShader about 20 ms per 1080p frame, even untaken.
5. **Tube** (one pass per output pixel):
   - Barrel curvature with a small fit margin: the whole 320x180 frame stays visible and the corners fall away into the bezel.
   - One native row is one scanline, a gaussian beam per colour channel, sigma 0.15 to 0.40 of the pitch by brightness.
     It is box-filtered analytically over each output pixel, so it anti-aliases at any size and at any camera zoom.
   - Red and blue misconverge by up to 0.18 native px at the edges.
   - A gentle aperture grille (0.2), 1 px per 1080 output lines, which fades out with the camera in the set shots.
   - Glow, halation, vignette, the glass (the unlit phosphor black, the lit black level, a soft window reflection), then a lens falloff in the wide shot.
   - Linear light throughout (gamma 2.4 in, 2.2 out), with a static dither only where 8-bit steps would band.
6. **Into `outCtx`.**
   A GPU-backed output takes `drawImage(glCanvas)` in the same call.
   A CPU-backed output (the tools mount `FILM.ctx` with `willReadFrequently`) takes `readPixels` plus `putImageData`.
   Then the proof layers (section 4).

## 3. Power sequences and the camera

Windows come from `FILM.TIMELINE.crt` in global frames.
The key frames are laid out for a 150-frame power-on and a 120-frame power-off; other window lengths stretch them.
`FILM.crt.marks()` for `powerOn [0, 120]` and a power-off starting at `P`:

| mark | frame | what the viewer sees |
|---|---|---|
| powerOn.start | 0 | the wide shot: a dark room, the set lit only by a faint window, its glass dark |
| powerOn.click | 16 | the click; the pilot light comes on |
| powerOn.line | 18 | a bright horizontal beam line on the glass |
| (21) | | the camera starts pushing in (smootherstep), the raster opens into full snow and the snow lights the room |
| powerOn.opened | 32 | snow over a rolling picture; the room's light follows the picture's colour |
| (26 to 53) | | the picture locks in under thinning snow, the colour killer lets go, degauss wobble |
| powerOn.locked | 80 | vertical hold locked; the title is readable |
| powerOn.settled | 120 | the tube fills the frame; gameplay stays full-frame from here |
| powerOff.start | P | the raster collapses; the pilot light goes out; the camera starts pulling back |
| powerOff.line / dot | P+7 / P+15 | the line, then the dot, now small inside the set |
| powerOff.afterglow | P+19 | the dot fades in the set in the dark room; the pull-back ends at P+66 |
| powerOff.dark | P+84 | the dark set, exactly the opening frame's picture, so the loop is seamless |
| caption | P+90 to the end | the closing caption fades up on the dark glass and out before the loop |

The caption needs the film to end at least 30 frames after `P + 90` (it scales its fades).
About 150 frames after `powerOff[1]` gives it a clean 2 s.
The TV foley should land on these marks: the click, the high-voltage whine from `line`, the degauss thump, and the collapse at `powerOff.start`.

## 4. The proof layers

Both are drawn crisp after the TV, on a private scratch canvas and blended in integer arithmetic (section 1, the determinism rule).

- **Input display**, bottom right, TAS-video style.
  A small pad on a dark plate (D-pad, SELECT, START, B, A), lit from `FILM.game.sim().states[f].btn`, with a frame counter and `PAD 1`.
  `FILM.crt.inputWindows()` gives one window per stretch of play (mode 2) in one world, from its first playable frame to its goal: the `flagpole` event, or in the castle `axe`, then `bridge`, then `bossfall`.
  A window also ends 45 frames after the stretch's last pressed button (a scripted walk shows no pad) and 16 frames before the power-off.
  It fades in over 12 frames and out over 16.
  Its box stays above y = H - 80 px, inside the check's safe area.
- **Closing caption**, centred on the dark glass of the wide shot: `EVERY FRAME WAS PLAYED` / `BY A GAME ENGINE` / `FROM RECORDED CONTROLLER INPUT · NOTHING IS KEYFRAMED`.

The HTML player owns its own chrome input display (key I, `docs/playable.md`).
While the player's own overlay is showing, the player should set `FILM.crt.overlays.input = false`, so the film's baked pad does not double it, and restore it after.
Live play shows the live controller, not the film's tape.
It should present with `FILM.crt.present(FILM.native().canvas, ctx, { frame: FILM.crt.settledFrame(), overlays: false })`.
Its equivalent through the player API should give the TV a lit, full-frame state whatever film frame was paused on.

## 5. Tunables (`FILM.crt.params`)

| param | default | effect |
|---|---|---|
| gammaIn / gammaOut | 2.4 / 2.2 | tube gamma / display gamma |
| sigmaMin / sigmaMax | 0.15 / 0.40 | beam sigma (line pitches) of a dark / full-brightness line |
| maskK, maskW | 0.2, 0 | grille strength; stripe px (0 = 1 px per 1080 lines) |
| brightness | 1.06 | overall gain (the grille loss is compensated separately) |
| glow, halo | 0.07, 0.045 | glow share and halation |
| curv, fit | [0.028, 0.042], [1.014, 1.022] | barrel curvature; margin inside the glass |
| vignette, refl, conv | 0.2, 1, 0.18 | edge falloff, glass reflection, misconvergence (native px) |
| sharp, lumaSigma, chroma, artifacts | 0.3, 2.3, 36, 0.35 | sharpness peak, band-limited luma (samples), chroma low-pass (samples), composite artifact strength |
| phase | 0 | frame phase of the composite signal (0, 4 or 8) |
| wide | [0.44, 0.4, 0.3] | the wide shot: zoom, centre x, centre y (room units) |
| room | 1.8 | exposure of the room lit by the screen |

## 6. Tools

- **WebGL in the tool browser** (`tools/common.cjs`): SwiftShader is pinned, so any machine renders and hashes the same pixels.
  `FILM_GL=gpu` uses the platform GPU for fast previews and timing; determinism then holds within that backend.
- **`tools/check.cjs`**
  - 3 scans `crt.js`, `manifest.js`, `foley.js`, `game/*.js` and `play.js` for banned calls.
  - 4 checks `FILM.TIMELINE.duration * 60 === FILM.game.sim().length`.
  - 5 measures flatness on `FILM.native()` while the TV shows it, and on the TV output while the set is off.
  - 8 audits every pixel of `FILM.native()`.
  - 10 bans audio nodes in `music.js` only.
  - **11 display** fails unless the backend is `webgl2`.
    It checks the camera (the wide shot at the power-on start, the full tube mid-film) and the dark set before and after.
    It checks the line, the dot, scanline modulation mid-film, and that the input display is drawn inside its window and absent outside it.
    It checks the closing caption and a clean mode of only console colours.
  - 2 determinism adds 11 TV power frames; `--det N` adds N more.
- **`tools/render.cjs`**
  - `--scale 2` gives 4K and `--clean` renders with the TV off.
  - Every `--workers N` streams PNG frames in order into one ffmpeg (no frames on disk).
  - `--silent` does not load `music.js`.
  - `--phone [path]` also writes a 1280x720 x264 crf 24 sharing copy, capped to 30 MB or less (default `<out>-phone.mp4`).
  - Audio (A6): AAC through AudioToolbox (`-c:a aac_at -b:a 192k`, stereo) when ffmpeg has it, else the native encoder with `-ac 1`.
- **`tools/finish.cjs`**: the same audio encoder choice for the master and its phone transcode.
- **`tools/snap.cjs`**: `--clean`, and `--scale 2` for 4K stills.

## 7. Numbers (measured 2026-09-23 on a laptop under load)

| what | 1920x1080 | 3840x2160 |
|---|---|---|
| `present`, SwiftShader, gameplay (full tube) | 40 ms (round 1: 38 ms) | 137 to 220 ms |
| `present`, SwiftShader, the set shots | 43 to 50 ms | 180 to 190 ms |
| `present`, GPU (Metal via ANGLE), any shot, synchronous readback | 4.5 to 5.6 ms | 13.6 to 16.4 ms |
| PNG encode + transfer per frame (tools) | 66 to 72 ms | 200 to 260 ms |
| playing on the GPU (round 1 measure) | rAF 60 Hz, 1.35 ms main thread per draw | |
