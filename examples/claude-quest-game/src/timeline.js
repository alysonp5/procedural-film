/*
 * timeline.js — claude-quest v2. One continuous shot: the whole film is one played game on one TV.
 * 1920x1080 output, 60 fps (the console's refresh). The game draws a native 320x180 frame
 * (FILM.native()), src/crt.js presents it. Owner: game (keep `duration` equal to the simulation's
 * length in frames / 60 — tools/check.cjs verifies it). Beat and song frames: docs/story.md.
 *
 * crt: TV power windows in GLOBAL FRAMES. powerOn [f0, f1]: the set is off at f0 and the picture has
 * settled by f1. powerOff [f0, f1]: the picture collapses from f0 and is a dark screen by f1. After
 * powerOff ends the screen stays dark to the last frame (150 frames, for the closing caption on the
 * dark glass), so the loop restarts on a dark set. The ending song starts at frame 3101 (the first
 * ending text); the power-off starts 256 frames later.
 */
(function () {
  'use strict';
  const FILM = (window.FILM = window.FILM || {});
  const FRAMES = 3627;
  FILM.TIMELINE = {
    title: 'claude-quest',
    bpm: 112.5, // the score counts in 60 Hz frames (8 frames a 16th); kept for the tools' grid warnings
    duration: FRAMES / 60,
    fps: 60,
    width: 1920,
    height: 1080,
    crt: { powerOn: [0, 120], powerOff: [3357, 3477] },
    shots: [
      { id: 'game', file: '01-game.js', start: 0, end: FRAMES / 60, mode: 'none', title: 'Claude Quest',
        brief: 'The TV powers on, the cartridge plays: title, lives screen, World 1-1, the castle, the rescue; the TV powers off.' },
    ],
    cues: [],
  };
})();
