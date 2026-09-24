// game/21-recorded.js : the recorded controller tape of the film. GENERATED from the tape program in
// game/20-tape.js by FILM.game.record(); do not edit by hand. Owner: game.
// 3627 frames, run-length coded as "buttons(hex):count(base 36)" pairs. fp is the fingerprint of the
// run it produces (every event's frame and type, and the final score): if the engine changes and the
// replay no longer matches, FILM.game.sim() plays the tape program live instead, so the film never
// desyncs. Regenerate after any change to src/game/*.js: FILM.game.record() in a page that loads the
// film returns { length, fp, rle } for the object below.
(function () {
  'use strict';
  const FILM = (window.FILM = window.FILM || {});
  const CQ = (FILM.__cq = FILM.__cq || {});
  CQ.RECORDED = {
    length: 3627,
    fp: 'cb881de9',
    rle:
    '00:5k,08:3,00:30,82:1s,83:8,82:2a,83:i,82:1m,83:g,82:o,80:1,00:4,40:6,00:1,40:b,80:a,00:9,01:8,' +
    '00:g,80:1t,40:a,00:1v,83:6,82:1w,83:2,82:j,83:2,82:i,83:2,82:1j,83:6,40:h,82:1,40:k,80:2,81:k,' +
    '80:m,82:2m,83:2,82:i,83:2,82:16,83:g,82:34,83:2,82:z,81:8,80:d,00:1,20:1,00:1d,82:1j,83:o,82:p,' +
    '80:3,00:1k,82:8,83:c,80:1b,82:1y,83:g,82:h,83:a,82:i,83:2,82:f,00:al,82:37,83:a,82:2p,83:4,82:k,' +
    '00:1,40:k,00:a,82:1o,83:6,82:d,80:1w,83:8,82:1j,00:q1',
  };
})();
