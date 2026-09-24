# Claude Quest v2 — sound

Owner: audio.
Files: `src/music.js` (driver, score, APU), `src/foley.js` (the TV), `tools/audio/*`, this file.
Contract: `docs/v2-architecture.md` sections 4.2 (events), 4.4 (API) and 8.2 (the timing contract, round 2).

## 1. How the sound is made

The film's soundtrack is built the way a 1986 cartridge built it, then heard through the TV.

1. **Events.** `FILM.game.events()` is the only input.
   The film never falls back to a mock; with no game loaded the console is silent and only the TV sounds.
2. **The driver** runs once per 60 Hz frame (`makeDriver` in music.js).
   A `song` event starts that song on its frame, replacing the current one; `none` is silence.
   Its optional `section` starts the song at a named row (the overworld: `intro`, `A` the hook, `B` the bridge).
   Every other event starts a sound effect.
   The driver advances the song one tick, lets effects take over their channels, and writes the result as APU register writes (`$4000`–`$4017`).
3. **The APU** (`makeApu`) emulates the 2A03 sound unit from those writes and nothing else.
4. **The TV** (`src/foley.js`) multiplies the console's output by the set's speaker gain and adds the set's own sounds.

The whole film is one mono buffer computed from frame 0, copied to both channels and played by one `AudioBufferSourceNode`.
There is no reverb, delay, compressor, panner or any node after the source (`tools/check.cjs` check 10 enforces it for music.js).

## 2. The driver

- **Register discipline.** Music uses constant-volume mode with software envelopes written every frame.
  `$4003`/`$4007` (which restart a pulse's duty phase) are written only on a new note or when the timer's high byte changes, so vibrato never clicks.
  `$4001`/`$4005` hold `$08` (sweep off, negate on) so the sweep unit's muting quirk never silences a low note; effects that use the hardware sweep write their own value and the driver restores `$08` when they end.
- **Triangle.** A note writes `$4008 = $FF` and `$400B`; a rest writes `$4008 = $80`, so the linear counter stops the triangle at the next quarter frame.
- **Noise.** `$400C` (constant volume), `$400E` (period, mode), `$400F` on a new hit.
- **DMC.** A drum writes `$4010` (rate), `$4012` (address), `$4013` (length), then `$4015 = $0F` and `$4015 = $1F`, which restarts the sample even if one is playing.
  A song change stops the DMC and writes `$4011 = 40`: a drum cut mid-sample can no longer leave the DAC (and with it the triangle's and noise's loudness, through the non-linear mixer) off its rest level into the next song.
- **Effects take over channels.** Each effect is a per-frame program for one or more of pulse 1, pulse 2, triangle and noise.
  A new effect takes a channel when its priority is at least the one playing there (newest wins on a tie), except that of two equal effects starting on the same frame the first keeps the channel, so both are heard wherever their channels differ.
  While an effect holds a channel, the song's voice there keeps time silently; on the frame the effect ends the voice comes back mid-note with a fresh trigger, in time.
  A song started at a section retriggers every voice on its first frame the same way, so a note already sounding at that row is heard.
- **Songs** are compiled from a text notation (one string per channel, lengths in 16th-note rows, `speed` frames per row, `|` marks the loop point).
  The compiler checks every channel of a song has the same length and loop point, and throws otherwise.

## 3. The APU

- Pulse ×2: 11-bit timer, the four duty sequences, envelope unit, sweep unit (with the `$7FF` and `< 8` muting rules), length counter.
- Triangle: 32-step sequencer, linear counter, length counter; a halted triangle holds its step, as the chip does.
- Noise: 15-bit LFSR, long and short mode, the 16 NTSC periods, envelope, length counter.
- DMC: 1-bit delta playback from a 16 KB ROM image at `$C000`, the 16 NTSC rates, the sample buffer, shift register and silence flag.
  The output level is 7 bits and moves ±2 per bit.
- Frame counter: 4-step mode, quarter and half frames at 240 Hz, locked to the driver frame.
- Mixer: the console's non-linear DAC formulas (`95.88 / (8128 / pulses + 100)` and `159.79 / (1 / (t/8227 + n/12241 + d/22638) + 100)`), so a loud DMC level really does duck the triangle and noise.
- Output: first-order high-pass 90 Hz and 440 Hz and low-pass 14 kHz, as the console's output stage.
- Channels are integrated exactly over each sub-sample at 4× the output rate and decimated by a 47-tap Blackman-windowed sinc, zero phase.

### The DMC drum ROM

| sample | synthesis | bytes | played as |
|---|---|---|---|
| `kick` | a sine falling 216 → 46 Hz under a 42 ms decay, a 2 ms click | 465 | `K` rate 15; `L` rate 13 (a deep boom) |
| `snare` | 188 Hz + 335 Hz tone, seeded noise, 45 ms decay | 561 | `S` rate 15 |
| `timpD` | membrane partials 1, 1.5, 1.98 at D3, felt-mallet noise | 1505 | `D` rate 15 (D3), `A` rate 14 (A2) |
| `timpC` | the same at C3 | 1505 | `C` rate 15 (C3), `G` rate 14 (G2) |

Total 4160 bytes, 64-byte aligned from `$C000`, lengths 16n+1 as the hardware requires.
Each drum is synthesised at its playback rate and delta-encoded greedily.
The encoder pairs every 1 with a 0 and never asks for a step the DAC would clamp, so a sample always returns the DAC to its rest level (40, as the reset code left `$4011`) and the drums never drift the DC level.
Rates 15 and 14 are a fourth apart, so one timpani sample gives a tonic and the fifth below it.

## 4. The score

All melodies are original, written for this film.
Tempo counts in frames: `speed` frames per 16th note.

| id | key | speed | length | loop | character |
|---|---|---|---|---|---|
| `title` | D major | 6 (150 bpm) | 4 bars | whole | the hook stated as a bright attract-mode jingle |
| `overworld` | D major | 6 (150 bpm) | 8-row intro + 16 bars | back to the hook | the earworm: hook A, A′ (the 8-bar period completes in 768 frames), then B through G, A, F#m, Bm and a stop-time turnaround. Sections: `intro` row 0, `A` row 8, `B` row 136 |
| `underground` | E, phrygian colour | 8 (112.5 bpm) | 4 bars | whole | staccato riff doubled by the triangle, a driver echo three rows late, water drips |
| `star` | A mixolydian | 5 (180 bpm) | 4 bars | whole | driving A–G–D–E sequence, arpeggio shimmer, octave bass, four-on-the-floor |
| `flag` | D major | 4 (225 bpm) | **168 frames** (42 rows) | none | rising brass fanfare, a turn and the tonic, which dies away inside its own note by frame 165 |
| `castle` | C minor | 6 (150 bpm) | 1 intro + 4 bars | from bar 2 | triangle tritone ostinato under a quiet C5 pedal, then diminished arpeggios, a chromatic lament, timpani C–G |
| `rescue` | D major | 9 (100 bpm) | **288 frames** (2 bars) | whole | Claw'd runs in bar 1; in bar 2 they meet and the line cadences on the tonic (frame 216) with a timpani |
| `ending` | D major | 8 (112.5 bpm) | **256-frame tag**, then the tonic rings to frame 704 | none | the hook's first bar, a turn through G minor, the tonic D lands on frame 192 with a timpani and rings into the power-off |
| `ending-full` | D major | 9 (100 bpm) | 8 bars | whole | the long ending for the playable mode: the hook slow and tender, turning to G minor before it comes home |

The hook, bar 1 (D major): `D5:2 F#5 A5:3 F#5:2 B5:3 A5 F#5:2 E5:2` (lengths in 16ths).
It opens the title, the overworld (after its 8-row intro) and the ending.
`node tools/audio/melody.cjs` decodes every song's first bars back from the driver's register writes.

## 5. Sound effects

| event | channels | pri | frames | sound |
|---|---|---|---|---|
| `start` | p1 + p2 | 6 | 41 | A5–C#6–E6 climbing onto a ringing A6, echoed two frames late below |
| `jump` | p2 | 2 | 12 / 15 | 25 % duty, held at volume 15 for 4 frames, then the hardware sweep carries it up from 440 Hz (small) or 330 Hz (big) |
| `stomp` | p2 + noise | 3 | 6–12 | noise squish, a falling sweep; from combo 2 a blip, both two semitones higher per combo link |
| `kick` | p2 + noise + triangle | 2 | 9 | a bright tick and a falling tok at volume 15 and a hard triangle knock (which still sounds when a stomp holds the other two), two semitones higher per combo link |
| `coin` | p2 | 2 | 26 | G5, D6, then G6 ringing out, gliding without a phase reset |
| `bump` | triangle + noise | 2 | 6 | a triangle knock and a low thud |
| `brick` | triangle + noise | 3 | 26 | a crack, then a seeded crumble |
| `sprout` | p2 | 2 | 26 | a wobbling rise 175 → 700 Hz |
| `powerup` | p1 | 4 | 36 | an A-major pentatonic zigzag up two octaves, then an A6/C#7 shimmer |
| `oneup` | p2 | 4 | 31 | D6, D6, A6, F#6, D7 ringing |
| `pipe` | p1 + noise | 4 | 30 | a slurp: a 12.5 % tone sliding down two octaves, a noise swell |
| `flagpole` | p1 + p2 + noise | 5 | **`frames`** | the grab clang, then a slide whistle from a pitch set by `height` down to 170 Hz, lasting exactly the slide |
| `tally` | p2 | 1 | 3 | one tick a frame at E6, loud and soft (8 / 4) alternating into a ratchet |
| `firework` | triangle + noise | 3 | 26 | a crack and a rumbling tail over a falling triangle boom |
| `fireball` | noise | 0 | 12 | a short whoosh; the lowest priority, so a louder effect on the noise channel masks it |
| `hop` | triangle + p2 + noise | 3 | 10 | the boss lands: a triangle drop from 150 Hz, a falling sweep thud and a low crunch, pitched to pass the console's 440 Hz output filter |
| `roar` | p1 + noise | 4 | 44 | a growl (a low 12.5 % tone wobbling every frame, sagging) over a swelling, trembling low noise; the castle melody pauses for it |
| `axe` | noise + triangle + p2 | 5 | 28 | the ENTER key: the keycap's metallic clack as it bottoms out, the thock of its return, then the terminal's confirm, A5 rising to E6 |
| `bridge` | triangle + noise | 2 | 9 | a crumble and a knock, a little lower each segment `i` |
| `bossfall` | p1 + noise | 5 | **64** | a wobbling fall 760 → 55 Hz, rumble underneath |
| `text` | noise | 1 | 1 per key | long-mode noise, a key per character of `line`, silent at spaces; at `every` 1 (the ending types a character a frame) loud and soft keys alternate into a teleprinter's rattle; at 2+ each key is a two-frame tick |

`flagpole.height` is 0..1 up the pole, or the grab's score (100 at the foot to 5000 at the top); `flagpole.frames` is the slide's length (default 62).
`text` also accepts `chars` when there is no `line`; `every` defaults to 1.

## 6. The TV (src/foley.js)

`FILM.foley.apply(buf, sr)` works in place on the film buffer, from `FILM.TIMELINE.crt` (global frames).
Every sound lands on the picture's own key frame from `FILM.crt.marks()` (the switch click, the picture opening, the degauss wobble, the lock; the squeeze, the dot, the afterglow); without the display loaded they are derived from the timeline in crt.js's proportions.
With `powerOn` = [0, 120]: click f16, line f18, open f22, lock f80; at power-off P: squeeze P+7, dot P+15.

- **Speaker.** Silent while the set is off, up between 0.1 and 0.5 s after the switch clicks as the audio stage warms (the console is already playing).
  At power-off the console's sound dies with the supply: an exponential decay (time constant 0.35 s, −45 dB after 1 s), closed to exact silence between 1.6 and 2.0 s, so the ending's tonic fades out naturally under the caption on the dark glass and the loop restarts on silence.
  The console keeps playing throughout; only what reaches the room changes.
- **Power-on.** At the click: the switch (a latch double tick and the speaker cone's thump) and the tube's thunk. The degauss swell (a buzzing 60 Hz hum with harmonics and a sagging "bwoom", throbbing at 6.5 Hz) peaks with the picture's degauss wobble and dies over 1.5 s. Band-limited static starts as the picture opens and fades out by the lock, with 26 seeded crackles. The flyback whine at 15.734 kHz fades in to about −50 dBFS and stays while the set is on.
- **Power-off.** The switch click; the collapse "zhip" (a buzzy tone falling 2.5 kHz → 180 Hz with hiss) from the squeeze to the dot; a three-crack static tick just after the afterglow; the whine sagging 5 % in pitch as it dies.

- **The room.** The set's switching sounds (click, thunk, degauss, static, zhip, tick) reach us through a small living room: seven early reflections, 7 to 55 ms, dulled by a 4.5 kHz one-pole low-pass, no tail. It is computed into the buffer (no audio node) and only over the two power windows; the console's sound and the whine stay dry.

All noise is `FILM.lib.rng` with fixed seeds; every sample is a function of its index.

## 7. The mix

- One flat `GAIN` in music.js, set by measurement with `tools/audio/loudness.cjs`: 2.87.
- Measured on the settled round-2 game run (145 events, frames 0..3311, 21-recorded.js of 01:43), in Chromium: −14.0 LUFS integrated, true peak −2.0 dBTP, LRA 4.0 LU.
  The loudest moments are kick combos in the star and the hook (`peaks.cjs`).
- If the game's timing changes a lot, re-run `loudness.cjs`; it prints the GAIN that hits −14 and the true peak at that gain.

## 8. API

```js
FILM.audio.render(ctx, { start = 0, dest = ctx.destination })
// Synthesises the film (cached per sample rate) and schedules it from global time `start`.
// Seek-exact: the buffer always starts at frame 0 and plays from an offset.

FILM.audio.live(audioCtx, { dest, song, volume, bufferSize = 1024 }) -> {
  song(id),        // start a song on the next driver frame
  event(ev),       // queue one event, e.g. { type: 'jump', big: true }; `f` is ignored
  events(list),    // queue what FILM.game.create().step(buttons) returned this frame
  frame,           // driver frames made so far
  volume,          // get / set, 1 = the film's level
  stop(),          // disconnect
  node,            // the ScriptProcessorNode
}

FILM.audio.synth(sampleRate, { events, samples, foley, mute, log })  // the raw mono buffer (tools)
FILM.audio.songs, FILM.audio.sfx, FILM.audio.info()                  // ids, event types, ROM and song facts
FILM.foley.apply(buf, sampleRate), FILM.foley.speaker(t)
```

### The playable mode (phase 3)

`live()` runs the same driver and APU as the film, generating as it plays.
Events queued from the game loop sound on the next driver frame the generator makes; the generator works at most 1024 sub-samples (5.3 ms at 48 kHz) ahead of the block being filled, so an event lands within that plus one ScriptProcessor block (21 ms) of being queued.
It uses a `ScriptProcessorNode` because an `AudioWorklet` needs a module URL, and the shipped file may not create one (`createObjectURL`, `data:` and external scripts are all banned by the media check).
The generator costs about 1 % of a core.
Suggested use in the player:

```js
const snd = FILM.audio.live(ctx, { song: 'title' });
function tick(buttons) {
  const ev = console.step(buttons); // FILM.game.create()
  snd.events(ev);                   // song changes and effects together, in order
}
```

`tools/audio/live.cjs` proves the live stream equals the offline render sample for sample, and that it keeps 60 driver frames per second in a real AudioContext.

## 9. Tools (all under tools/audio/, outputs in /tmp/cq2/audio/)

| command | what it proves or makes |
|---|---|
| `node tools/audio/render-audio.cjs [--mock \| --events saved.json]` | the film through Chromium's real path to `score.wav`, render time, loudness, true peak |
| `node tools/audio/stems.cjs` | `song-<id>.wav` for every song, `sfx-reel.wav` (+ index), `tv-foley.wav` |
| `node tools/audio/align.cjs [--mock \| --events saved.json]` | every effect starts within 1 frame of its event (difference test); a priority-0 effect masked by a louder one on every channel it asks for is reported, not failed |
| `node tools/audio/seek.cjs` | seek from 30 s equals the full render's tail; two fresh pages and the Node host render identical bytes |
| `node tools/audio/loudness.cjs [--events saved.json]` | integrated loudness and true peak, and the GAIN for −14 LUFS |
| `node tools/audio/live.cjs` | the live API: sample-equal to offline, real time in Chromium |
| `node tools/audio/melody.cjs [--ch p1] [song]` | each song's melody decoded from the register writes |
| `node tools/audio/events.cjs [--mock]` | what the driver is fed: counts, the song timeline, unhandled types |
| `node tools/audio/peaks.cjs [wav] [--events saved.json]` | the loudest true peaks (4× oversampled over every sample, 0.5 s apart), the song and effects around each, and ffmpeg's true peak as the reference |
| `node tools/audio/drums.cjs [song]` | the DMC drums lift the 60–400 Hz band when they hit (level after vs before) |
| `node tools/audio/contract.cjs [--events saved.json]` | section 8.2 from the register writes: flagpole = `frames`, bossfall 64, fanfare complete inside 168, rescue and ending cadences; with events, the promised gaps and that no effect takes the melody during a payoff |
| `node tools/audio/sfxlevel.cjs [--events saved.json]` | each effect's loudness against the music under it (K-weighted, first 10 frames) |

`tools/audio/host.cjs` runs the film's own audio files in Node; `seek.cjs` proves it renders the same bytes as Chromium.
`tools/audio/mock-events.js` is a stand-in event list for tools only.
While the game is still changing, `events.cjs` saves the current list to `/tmp/cq2/audio/events.json`; pass a saved copy with `--events` to verify against one fixed run.

## 10. Originality

No melody, bass line or effect note sequence is taken or paraphrased from any Nintendo game.
The idioms are the era's: off-beat comping, bouncing octave bass, arpeggio shimmer, driver echo, hardware-sweep jumps, DMC drums.
First bars as the driver plays them (`melody.cjs`), and how each differs from the Super Mario Bros. theme in the same role:

| song | first bars (pulse 1, lengths in 16ths) | how it differs |
|---|---|---|
| `overworld` | intro `D6 r A5 r F#5 r D5 r:5 A4 B4 C#5 r`; hook `D5:2 F#5 A5:3 F#5:2 B5:3 A5 F#5:2 E5:2` / `D5:3 C#5 B4:4 r:2 A4 B4 D5:2 E5:2` / `F#5:2 G5 A5:3 G5:2 F#5:2 E5 D5 E5:2 G5:2` | D major, opens on the tonic and climbs the triad with the fifth tied across the beat, then leaps to the sixth; SMB's overworld is C major and opens with a repeated-note figure and a drop to the low dominant, which this never does |
| `title` | the hook bar, then `G5:2 B5 D6:3 B5:2 E6:3 D6 B5:2 A5:2` / `G5:2 F#5 E5:3 G5:2 F#5:4 E5:2 C#5:2` / `D5:2 r:2 A4 D5 F#5 A5 D6:4 r:4` | SMB's title screen has no music |
| `underground` | `E4 r:2 B4 r:2 D5 r C5 r:2 G4 r A4 r:2` / `E4 r:2 B4 r:2 F5 r E5 r:2 D5 r B4 r:2` / `A4 r:2 E5 r:2 G5 r F5 r:2 C5 r D5 r:2` / `B4 r:2 F5 r:2 E5 r D#5 r:2 B4 r A#4 r:2` | a single-note riff in E with a phrygian F and a tritone turn; SMB's underground is built from octave-leap note pairs, a device not used here |
| `star` | `E6:2 C#6 A5 E6:2 F#6 E6 r:2 C#6:2 A5 B5 C#6 E6` / `D6:2 B5 G5 D6:2 E6 D6 r:2 B5:2 G5 A5 B5 D6` / … | a falling-triad sequence moving A–G–D–E; SMB's starman is a syncopated repeated-note figure |
| `castle` | `r:16` (ostinato alone) / `G5:12 G#5:4` / `G5:8 F#5:8` / `F5:12 D#5:4` / `D5:8 B4:8` | a slow chromatic lament over a triangle tritone ostinato; SMB's castle theme is fast semitone tremolo figures in every voice |
| `flag` | `D5 r F#5 r A5:3 D6 r:2 A5 D6 F#6:4` / `G6:3 F#6 E6:2 D6:2 E6:3 F#6 G6:2 A6:2` / `F#6 D6 A5 D6:7` | plain 16ths up one D major triad, a stepwise climb to A6 and home; SMB's course clear climbs triplet arpeggios through three different major chords |
| `rescue` | `B5:6 A5:2 G5:4 F#5:2 E5:2` / `A5:4 G5:2 E5:2 D5:8` | a slow descending song line cadencing on the tonic; not modelled on any SMB cue |
| `ending` | `D5:2 F#5 A5:3 F#5:2 B5:3 A5 F#5:2 E5:2` / `G5:3 A#5:3 A5:2 D5` held | our own hook's first bar, a G-minor turn and the tonic |

Effects: the coin is G5, D6, then G6 ringing (SMB's is two notes a fourth apart); the 1-up is D6 D6 A6 F#6 D7; the power-up is an A-major pentatonic zigzag; the flagpole is a continuous slide-whistle glide (SMB's steps down a scale); the pipe is one slurping glide with a noise swell.
Hardware sweeps (jump, stomp) are a chip function, not a note sequence; the pitches and rates are ours.
