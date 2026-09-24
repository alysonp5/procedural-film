// game/40-api.js : FILM.game, the public face of the engine (docs/v2-architecture.md 4.1). Owner: game.
//
//   FILM.game.BUTTONS            { A: 1, B: 2, SELECT: 4, START: 8, UP: 16, DOWN: 32, LEFT: 64, RIGHT: 128 }
//   FILM.game.create(opts)       a live console: { step(buttons) -> events[], state(), draw(nativeCtx), frame }
//   FILM.game.sim()              the film, run once from frame 0 on the recorded tape and cached:
//                                { length, states[], events[], tape (Uint8Array of buttons per frame) }
//   FILM.game.draw(ctx, f)       paint film frame f (clamped to 0..length-1) into the 320x180 native buffer
//   FILM.game.events()           sim().events, sorted by f
//   FILM.game.tape()             sim().tape
//   FILM.game.record()           re-run the tape program: { length, fp, rle } for game/21-recorded.js
//
// The film and live play share one step function (game/10-engine.js). A film state keeps the buttons
// held on that frame (states[f].btn) for an input-display overlay.
(function () {
  'use strict';
  const FILM = (window.FILM = window.FILM || {});
  const CQ = FILM.__cq;

  let SIM = null;
  function filmLength() {
    const TL = FILM.TIMELINE;
    if (TL && TL.duration > 0) return Math.round(TL.duration * (TL.fps || 60));
    return CQ.DEFAULT_LENGTH || 3840;
  }

  // One pass of the console over `length` frames; input(W, f) gives each frame's buttons.
  function run(length, input) {
    const W = CQ.newWorld({});
    const states = new Array(length);
    const events = [];
    const tape = new Uint8Array(length);
    for (let f = 0; f < length; f++) {
      const b = input(W, f);
      tape[f] = b;
      const ev = CQ.step(W, b);
      for (let i = 0; i < ev.length; i++) events.push(ev[i]);
      states[f] = CQ.snapshot(W);
    }
    return { length, states, events, tape, built: W.built, score: W.score };
  }

  // The fingerprint of a run: every event's frame and type, and the final score (FNV-1a).
  function fingerprint(S) {
    let h = 0x811c9dc5 | 0;
    const mix = (str) => {
      for (let i = 0; i < str.length; i++) h = Math.imul(h ^ str.charCodeAt(i), 0x01000193);
    };
    for (const e of S.events) mix(e.f + e.type + ';');
    mix('score' + S.score);
    return (h >>> 0).toString(16).padStart(8, '0');
  }

  // run-length tape: "bb:n" pairs (buttons in hex, count in base 36), comma separated
  function encode(tape) {
    const out = [];
    for (let i = 0; i < tape.length; ) {
      let j = i;
      while (j < tape.length && tape[j] === tape[i]) j++;
      out.push(tape[i].toString(16).padStart(2, '0') + ':' + (j - i).toString(36));
      i = j;
    }
    return out.join(',');
  }
  function decode(rle, length) {
    const tape = new Uint8Array(length);
    let f = 0;
    for (const run of rle.split(',')) {
      const [b, n] = run.split(':');
      const v = parseInt(b, 16);
      for (let k = parseInt(n, 36); k > 0 && f < length; k--) tape[f++] = v;
    }
    return f === length ? tape : null;
  }

  // The film plays the recorded tape (game/21-recorded.js). If the engine has moved on since the
  // recording (the fingerprint differs), the tape program is played live instead: same film, slower.
  function sim() {
    if (SIM) return SIM;
    const length = filmLength();
    const rec = CQ.RECORDED;
    if (rec && rec.length === length) {
      const tape = decode(rec.rle, length);
      if (tape) {
        const S = run(length, (W, f) => tape[f]);
        if (fingerprint(S) === rec.fp) {
          S.source = 'recorded';
          SIM = S;
          return SIM;
        }
      }
    }
    const bot = CQ.makeBot(CQ.program());
    SIM = run(length, (W) => bot(W));
    SIM.source = 'program';
    return SIM;
  }

  // A fresh recording from the tape program (for regenerating game/21-recorded.js).
  function record() {
    const S = run(filmLength(), ((bot) => (W) => bot(W))(CQ.makeBot(CQ.program())));
    return { length: S.length, fp: fingerprint(S), rle: encode(S.tape) };
  }

  let warmed = false;
  function draw(ctx, f) {
    const S = sim();
    if (!warmed) {
      warmed = true;
      CQ.warm(S.states);
    }
    f = Math.max(0, Math.min(S.length - 1, Math.floor(Number(f) || 0)));
    CQ.drawSnap(ctx, S.states[f], f, true); // film frames go dark after the power-off
  }

  function create(opts) {
    const W = CQ.newWorld(Object.assign({}, opts, { live: true }));
    return {
      step(buttons) {
        return CQ.step(W, buttons | 0);
      },
      state() {
        return W;
      },
      snapshot() {
        return CQ.snapshot(W);
      },
      draw(ctx) {
        const s = CQ.snapshot(W);
        CQ.drawSnap(ctx, s, s.f, false); // a live console never goes dark on the film's clock
      },
      get frame() {
        return W.f;
      },
    };
  }

  FILM.game = Object.freeze({
    BUTTONS: CQ.BUTTONS,
    create,
    sim,
    draw,
    events: () => sim().events,
    tape: () => sim().tape,
    record,
  });
})();
