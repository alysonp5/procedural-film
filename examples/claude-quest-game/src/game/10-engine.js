// game/10-engine.js : the Claude Quest console program. One step function runs everything the
// cartridge does in a 60 Hz frame: the title, the lives screens, the levels (SMB-grade platformer
// physics on a 16 px tile grid), the flagpole and castle sequences, the boss and the ending.
// The film (a recorded controller tape, game/20-tape.js) and live play (FILM.game.create) both drive
// this same step(). Owner: game.
//
// Units: game px in the native 320x180 frame; velocities in px per frame. The SMB-style constants
// are written in 1/4096 px (Q(0x1900) = 1.5625 px/f), all exactly representable, so the simulation
// is bit-exact in any JS engine. No Math.random: nothing here is random.
//
// A world W is plain data. step(W, buttons) advances it one frame and returns that frame's events
// (docs/v2-architecture.md 4.2). snapshot(W) returns the compact record game/30-draw.js paints.
//
// Two paths, one step (docs/game-spec.md 2): W.live is false for the film, the attract demo and the
// tools, and true for the game (FILM.game.create). Every game rule (pause, continue, the clear card,
// the credits, the assists, checkpoints, hurry, the new blocks and items, the seam to the 1x modules)
// runs only when W.live is true, so the film replays bit for bit (tools/proof/film.cjs).
// Film levels are CQ.LEVEL_DEFS by index; game levels are CQ.GAME_DEFS by id (src/game/01-world1.js).
(function () {
  'use strict';
  const FILM = (window.FILM = window.FILM || {});
  const CQ = (FILM.__cq = FILM.__cq || {});

  const BUTTONS = Object.freeze({ A: 1, B: 2, SELECT: 4, START: 8, UP: 16, DOWN: 32, LEFT: 64, RIGHT: 128 });
  const { A, B, SELECT, START, UP, DOWN, LEFT, RIGHT } = BUTTONS;
  CQ.BUTTONS = BUTTONS;

  // ------------------------------------------------------------------------------------------
  // Physics constants (after the 1985 platformer's own tables)
  // ------------------------------------------------------------------------------------------
  const Q = (v) => v / 4096;
  const PH = {
    minWalk: Q(0x130), walkAcc: Q(0x098), runAcc: Q(0x0e4), relDec: Q(0x0d0), skidDec: Q(0x1a0),
    maxWalk: Q(0x1900), maxRun: Q(0x2900), skidTurn: Q(0x900), maxFall: 4,
    // [horizontal speed below which this row applies, jump velocity, gravity while A is held and rising, gravity otherwise]
    jumps: [
      [Q(0x1000), -4, Q(0x200), Q(0x700)],
      [Q(0x24ff), -4, Q(0x1e0), Q(0x600)],
      [Infinity, -5, Q(0x280), Q(0x900)],
    ],
    stompVy: -4,
    enemyWalk: 0.5, shellSpeed: 3, itemSpeed: 1, enemyGrav: 0.25,
  };
  CQ.PH = PH;

  const TIMER_FRAMES = 24; // the HUD clock ticks once every 24 frames
  const GROW_FRAMES = 60; // the power-up pause
  const STAR_FRAMES = 270; // the Claude spark's invincibility (4.5 s)
  const STAR_SLOW = 90; // the last frames of the star flash slower
  const TALLY_STEP = 10; // time units per tally tick (one tick a frame)
  const TITLE2_FRAMES = 20; // after START the cursor flickers this long
  const LIVES_FRAMES = 90; // the black lives screen
  const PIPE_DARK = 12; // frames between vanishing into a pipe and the next room
  const FANFARE = 168; // the course-clear fanfare: from landing at the pole's foot to the first tally tick
  const TALLY_HOLD = 5; // frames after the last tally tick before the lives screen
  const POP_LIFE = 48; // a score pop's life in frames
  const COMBO = [100, 200, 400, 500, 800, 1000, 2000, 4000, 5000, 8000];
  const POPS = ['100', '200', '400', '500', '800', '1000', '2000', '4000', '5000', '8000', '1UP', '50'];
  CQ.POPS = POPS;
  // backdrop flashes (NES colour index shown instead of the level's backdrop for a frame or two)
  const FLASH_WHITE = 0x30, FLASH_PALE = 0x31, FLASH_LAVA = 0x06;
  // the grow flicker: S small, M mid, L large, 5 frames each
  const GROW_SEQ = 'SMSMSMLSMLML';
  const BUMP_DY = [-3, -5, -6, -6, -5, -3, -2, -1];

  // live play only (docs/game-spec.md 3.4)
  const COYOTE_FRAMES = 5; // a jump still counts this many airborne frames after walking off a ledge
  const BUFFER_FRAMES = 6; // an A press this early before landing jumps on the first grounded frame (A held)
  const CORNER_PX = 4; // a head graze of a block edge up to this many px slides past it
  const CODE_FREEZE = 30; // the terminal pickup's hold
  const HURRY_AT = 100; // time units left when the hurry jingle plays
  const HURRY_JINGLE = 90; // the jingle's frames, then the fast song
  const CLEAR_FRAMES = 150; // the clear card
  const GAMEOVER_FRAMES = 180;
  const DEAD_FRAMES = 180;
  // the cast parades across for seven bars of the credits song (src/music.js `credits`, speed 6: 96
  // frames a bar), then the final card lands with its tonic chord; START skips the parade to the card
  const CREDITS_ROLL = 672;
  const CREDITS_WAIT = 60; // START leaves the card from this long after it appears
  const CREDITS_HOLD = 3600; // the final card returns to the title by itself after this long
  const CREDITS_FIREWORKS = Object.freeze([96, 288, 480, 576]); // a burst on the downbeats of bars 2, 4, 6 and 7
  const LIVES_START = 3, LIVES_MAX = 99, TOKENS_MAX = 12, MULTI_WINDOW = 240, MULTI_MAX = 10;
  CQ.TIMING = Object.freeze({
    COYOTE_FRAMES, BUFFER_FRAMES, CORNER_PX, CODE_FREEZE, THROW_POSE: 8, HURRY_AT, HURRY_JINGLE, CLEAR_FRAMES,
    GAMEOVER_FRAMES, DEAD_FRAMES, CREDITS_ROLL, CREDITS_WAIT, CREDITS_HOLD, CREDITS_FIREWORKS, LIVES_FRAMES: 90, TITLE2_FRAMES: 20,
    LIVES_START, LIVES_MAX, TOKENS_MAX, MULTI_WINDOW, MULTI_MAX,
  });

  // ------------------------------------------------------------------------------------------
  // Tiles
  // ------------------------------------------------------------------------------------------
  const C = (ch) => ch.charCodeAt(0);
  const SOLID = new Uint8Array(128);
  // N (1UP block), C (multi-coin brick), T (rack top) and S (spring) never appear in a film map
  for (const ch of '#BX?MU[]{}hH-_jJWGw=fNCTS') SOLID[C(ch)] = 1;
  const DOT = C('.'), HID = C('*'), COIN = C('o'), USED = C('U'), BRICK = C('B'), QB = C('?'), MB = C('M');
  const LAVA_T = C('L'), LAVA = C('l'), CHAIN = C('%'), WALL = C('#');
  const PLUS = C('+'), MULTI = C('C'), LIFE_B = C('N');
  CQ.SOLID = SOLID;

  const rowTop = (r) => r * 16 - 12;
  const rowOf = (y) => Math.floor((y + 12) / 16);
  CQ.rowTop = rowTop;
  CQ.rowOf = rowOf;

  // ------------------------------------------------------------------------------------------
  // Level definitions: the film's by index, the game's by id
  // ------------------------------------------------------------------------------------------
  // A live key missing from CQ.GAME_DEFS falls back to the film's table (by index, or by id), so a build
  // without src/game/01-world1.js still plays the film's 1-1 live instead of failing.
  function defOf(W, key) {
    if (!W.live) return CQ.LEVEL_DEFS[key];
    const d = (CQ.GAME_DEFS && CQ.GAME_DEFS[key]) || (typeof key === 'number' ? CQ.LEVEL_DEFS[key] : CQ.LEVEL_DEFS.find((q) => q.id === key));
    if (!d) throw new Error(`Claude Quest: no level '${key}' in CQ.GAME_DEFS`);
    return d;
  }
  const mainOf = (def) => def.main || def.id;
  // the level the title screen shows: World 1-1's first screen (the film's, until the game's exists)
  function titleDef(W) {
    const G = CQ.GAME_DEFS || {};
    return G['1-1'] || G[W.startId] || CQ.LEVEL_DEFS[0];
  }
  CQ.mainOf = mainOf;

  // Claw'd's body: centred on x + 8, 10 x 16 small, 20 x 22 big (big Claw'd is a wide, squat 24 x 24
  // drawing). y is the feet. bodyL / bodyR are the first and last pixel columns of the body.
  const HALF_W = (p) => (p.big ? 10 : 5);
  const bodyH = (p) => (p.big ? 22 : 16);
  const bodyL = (p) => p.x + 8 - HALF_W(p);
  const bodyR = (p) => p.x + 7 + HALF_W(p);
  const DRAW_H = (p) => (p.big ? 24 : 16); // the drawing's height, for pipes and the HUD rule
  CQ.drawTop = (p) => p.y - DRAW_H(p);

  function cell(lv, tx, ty) {
    if (ty < 0 || ty > 11) return DOT;
    if (tx < 0 || tx >= lv.w) return WALL; // the ends of a level are walls
    return lv.grid[ty * lv.w + tx];
  }
  const solidAt = (lv, x, y) => SOLID[cell(lv, Math.floor(x / 16), rowOf(y))] === 1;
  // hidden blocks (* and +) stop a head, never a body
  const headAt = (lv, x, y) => {
    const c = cell(lv, Math.floor(x / 16), rowOf(y));
    return SOLID[c] === 1 || c === HID || c === PLUS;
  };
  function setCell(lv, tx, ty, ch) {
    const i = ty * lv.w + tx;
    const code = typeof ch === 'number' ? ch : C(ch);
    if (lv.grid[i] === code) return;
    lv.grid[i] = code;
    lv.changes.push(i, code);
  }

  // The seam (docs/game-spec.md 2.4): enemy kinds and systems registered by src/game/12..15, called only
  // for live worlds. Hooks that are absent are skipped.
  CQ.KINDS = CQ.KINDS || {};
  CQ.systems = CQ.systems || [];
  const NO_SYSTEMS = [];
  const systemsOf = (W) => (W && W.live ? CQ.systems : NO_SYSTEMS);
  // a live enemy's kind interface (moth, hover, spike); film enemies (bug, shellbug, shell) have none
  const kindOf = (W, e) => (W.live ? CQ.KINDS[e.kind] : undefined);
  const SPAWN_KIND = { m: 'moth', n: 'hover', s: 'spike' };
  // spawn-only characters that never stay in a live grid, even with no system to take them
  const SPAWN_ONLY = { t: 1 };

  let buildSerial = 0;
  // def: a level definition (a number is taken as a film index); W: the world it is built for (a live
  // world runs the systems' spawn and build hooks); key: its id in the world's table (film: the index)
  function buildLevel(def, W, key) {
    if (typeof def === 'number') {
      key = def;
      def = CQ.LEVEL_DEFS[def];
    }
    if (key === undefined) key = def.id;
    const live = !!(W && W.live);
    const sys = systemsOf(W);
    const rows = def.rows;
    const w = rows[0].length;
    const grid = new Uint8Array(w * 12);
    const lv = {
      def, idx: key, w, grid, orig: null, changes: [], uid: ++buildSerial, maxCam: w * 16 - 320, t: 0,
      ents: [], firebars: [], boss: null, pearl: null, axe: null, pole: null, flagY: 0,
    };
    if (live) lv.multi = {}; // multi-coin bricks by cell index: { t0, n }
    for (let r = 0; r < 12; r++) {
      for (let c = 0; c < w; c++) {
        let ch = rows[r][c];
        const x = c * 16, feet = rowTop(r) + 16;
        let spawned = false;
        for (const s of sys) {
          if (s.spawn && s.spawn[ch]) {
            const left = s.spawn[ch](lv, c, r, def, W);
            ch = typeof left === 'string' && left.length === 1 ? left : '.';
            spawned = true;
            break;
          }
        }
        if (spawned) {
          // the system took the cell
        } else if (ch === 'g' || ch === 'k') {
          lv.ents.push(makeEnemy(ch === 'g' ? 'bug' : 'shellbug', x, feet));
          ch = '.';
        } else if (ch === 'p') {
          lv.pearl = { x, y: feet };
          ch = '.';
        } else if (ch === 'A') {
          lv.axe = { tx: c, ty: r, gone: false };
          ch = '.';
        } else if (ch === 'f') {
          lv.firebars.push({ cx: x + 8, cy: rowTop(r) + 8, n: 6, dir: 1, step: 4, phase: 0, tx: c, ty: r });
        } else if (ch === '!') {
          lv.pole = { tx: c, topY: rowTop(r) };
        } else if (live && SPAWN_KIND[ch]) {
          // the new enemies exist only when their kind is registered (src/game/12-foes.js)
          if (CQ.KINDS[SPAWN_KIND[ch]]) {
            const e = makeEnemy(SPAWN_KIND[ch], x, feet);
            e.y0 = feet; // the spawn cell's feet line (moth and hover moth bob round it)
            lv.ents.push(e);
          }
          ch = '.';
        } else if (live && SPAWN_ONLY[ch]) {
          ch = '.';
        }
        grid[r * w + c] = C(ch);
      }
    }
    lv.orig = grid.slice();
    if (def.firebars) {
      if (live) {
        // per-firebar settings keyed by the f block's cell (docs/game-spec.md D4)
        for (const o of def.firebars) {
          const fb = lv.firebars.find((q) => q.tx === o.tx && q.ty === o.ty);
          if (fb) Object.assign(fb, o);
        }
      } else {
        // the film: per-firebar settings in map order (direction, starting angle, speed)
        def.firebars.forEach((o, i) => lv.firebars[i] && Object.assign(lv.firebars[i], o));
      }
    }
    // pipe tops for the pipe doors
    const rimRow = (tx) => {
      for (let r = 0; r < 12; r++) if (grid[r * w + tx] === C('[')) return r;
      return -1;
    };
    if (def.pipeDown) lv.pipeDownY = rowTop(rimRow(def.pipeDown.tx));
    if (def.pipeUp) lv.pipeUpY = rowTop(rimRow(def.pipeUp.tx));
    if (lv.pole) lv.flagY = lv.pole.topY + 8;
    if (def.boss) {
      const top = rowTop(8); // the bridge's top face
      lv.boss = {
        x: def.boss.tx * 16, y: top, vx: -0.5, vy: 0, face: -1, air: false, t: 0, roar: 0,
        x0: def.boss.range[0] * 16, x1: def.boss.range[1] * 16, active: false, fall: false, gone: false, lava: false,
        // fields the boss upgrade (src/game/12-foes.js) may set; these defaults are the film's boss
        hopEvery: 120, dead: false, hitT: 0, flip: false,
      };
      if (live) lv.boss.hp = def.boss.hp != null ? def.boss.hp : 5;
    }
    // the camera stops at the bridge until the boss is gone (the castle's last screen is framed)
    lv.camCap = def.camLock != null ? def.camLock : null;
    // lava columns (for the bubbles) and the level's decorations
    lv.lavaCols = [];
    for (let c = 0; c < w; c++) if (grid[10 * w + c] === C('L')) lv.lavaCols.push(c);
    for (const s of sys) if (s.build) s.build(lv, def, W);
    return lv;
  }
  CQ.buildLevel = buildLevel;

  // ------------------------------------------------------------------------------------------
  // World
  // ------------------------------------------------------------------------------------------
  // coyote, buf: the assists' counters (live, modern feel); code: Claw'd Code (big, throws carets);
  // throwT: the throw pose's frames (set and counted by src/game/14-caret.js); ride: the index of the lift
  // he stands on in lv.lifts, or -1 (src/game/13-platforms.js)
  function newPlayer(x, y, big, code) {
    return {
      x, y, vx: 0, vy: 0, big: !!big, face: 1, ground: true, jumping: false, jumped: false,
      gHold: PH.jumps[0][2], gFall: PH.jumps[0][3], airMax: PH.maxWalk,
      skid: false, pose: 'idle', anim: 0, animT: 0, star: 0, combo: 0, starCombo: 0,
      st: 'play', t: 0, hide: false, behind: false, inv: 0, growT: -1,
      coyote: 0, buf: 0, code: !!(big && code), throwT: 0, ride: -1,
    };
  }

  // opts (FILM.game.create passes live: true): start (level id, default '1-1'), feel ('modern' | 'nes'),
  // top (the saved hi-score), shellMenu (the shell draws the title menu and the pause panel), and for
  // proofs only form ('small' | 'big' | 'code') and lives. The film, the demo and the tools pass nothing.
  function newWorld(opts) {
    opts = opts || {};
    const live = !!opts.live;
    const feel = live && opts.feel === 'nes' ? 'nes' : live ? 'modern' : 'nes';
    const W = {
      f: 0, mode: 'title', mt: 0, prev: 0, btn: 0,
      score: 0, coins: 0, lives: 3, top: 0,
      time: 400, timeT: 0, timerOn: false, world: '1-1',
      song: null, levels: [], built: [], li: 0, lv: null, cam: 0, p: null,
      items: [], parts: [], pops: [], bumps: [],
      freeze: 0, seq: null, goal: null, pending: 0, ev: [], castleFlag: 0, poleScore: null, ending: null,
      stats: { bugs: 0, coins: 0 }, introPlayed: false, flashC: 0, flashN: 0, rescueT: -1,
      live,
      // the visual clock: every animation in the snapshot reads it; it holds while paused (film: === f)
      vf: 0,
      feel, assist: live && feel === 'modern', code: false,
    };
    if (live) {
      const form = opts.form === 'big' || opts.form === 'code' ? opts.form : 'small';
      const lives = Math.floor(Number(opts.lives));
      // an unknown start (a stale save) begins at World 1-1 rather than failing at the lives screen
      const G = CQ.GAME_DEFS || {};
      let startId = typeof opts.start === 'string' && opts.start ? opts.start : '1-1';
      if (!G[startId] && G['1-1']) startId = '1-1';
      Object.assign(W, {
        top: Math.max(0, Math.floor(Number(opts.top) || 0)),
        shellMenu: !!opts.shellMenu,
        startId,
        startForm: form,
        startLives: lives >= 1 ? Math.min(LIVES_MAX, lives) : LIVES_START,
        areas: [], // the current area and, inside a sub-area entered by a down pipe, its parent
        mainId: null, // the main level of the current area
        tokens: {}, // collected token bits by main level id, kept for the whole run
        mid: null, // the checkpoint passed: { id, tx, row }
        continues: 0, retries: 0, // retries: lives lost in the run
        freezeK: null, // what W.freeze holds for: null (the grow) or 'code' (the terminal)
        bgm: null, hurried: false, hurryT: 0, // the level's song id, hurry state, the jingle's frames left
        lvCoins: 0, clearTime: 0, clearNext: null,
        cont: null, clear: null, credits: null,
      });
    }
    showTitle(W);
    return W;
  }

  // a live run's starting state (a new console, or back at the title after END or the credits)
  function newRun(W) {
    W.score = 0;
    W.coins = 0;
    W.lives = W.startLives;
    W.big = W.startForm !== 'small';
    W.code = W.startForm === 'code';
    W.tokens = {};
    W.mid = null;
    W.continues = 0;
    W.retries = 0;
    W.stats = { bugs: 0, coins: 0 };
    W.hurried = false;
    W.hurryT = 0;
    W.freezeK = null;
    W.cont = null;
    W.clear = null;
    W.credits = null;
  }

  // docs/game-spec.md 3.1: START pauses only in open play
  function pausable(W) {
    const p = W.p;
    return !!(W.live && W.mode === 'play' && p && p.st === 'play' && W.freeze === 0 && !W.goal && !W.seq && !W.ending);
  }
  CQ.pausable = pausable;

  function tokenCount(W) {
    let n = 0;
    if (W.tokens) for (const k in W.tokens) for (let b = W.tokens[k] | 0; b; b &= b - 1) n++;
    return n;
  }
  CQ.tokenCount = tokenCount;

  function emit(W, type, data) {
    const e = { f: W.f, type };
    if (data) for (const k in data) e[k] = data[k];
    W.ev.push(e);
  }
  // section: which part of the overworld song ('intro' on the first start, 'A' the hook, 'B')
  function setSong(W, id, section) {
    const key = section ? id + '/' + section : id;
    if (W.song === key) return;
    W.song = key;
    emit(W, 'song', section ? { id, section } : { id });
  }
  function flash(W, color, n) {
    W.flashC = color;
    W.flashN = n;
  }
  function addScore(W, v) {
    W.score += v;
  }
  // a score pop centred on x with its top at y; pops born together stack 8 px apart
  function pop(W, idx, x, y) {
    x = Math.floor(x);
    y = Math.floor(y);
    for (let moved = true; moved; ) {
      moved = false;
      for (const s of W.pops) {
        if (s.t < 12 && Math.abs(s.x - x) < 22 && Math.abs(s.y - y) < 8) {
          y = Math.floor(s.y) - 8;
          moved = true;
        }
      }
    }
    W.pops.push({ v: idx, x, y, t: 0 });
  }
  // the score pop index for a label ('200' -> 1); -1 if there is none
  const popOf = (label) => POPS.indexOf(String(label));
  const gainLife = (W) => (W.lives = Math.min(LIVES_MAX, W.lives + 1));
  function comboPoints(W, n, x, y) {
    if (n <= COMBO.length) {
      addScore(W, COMBO[n - 1]);
      pop(W, n - 1, x, y);
    } else {
      gainLife(W);
      emit(W, 'oneup');
      pop(W, 10, x, y);
    }
  }
  function collectCoin(W) {
    W.coins++;
    W.stats.coins++;
    if (W.live) W.lvCoins++;
    addScore(W, 200);
    emit(W, 'coin');
    if (W.coins >= 100) {
      W.coins -= 100;
      gainLife(W);
      emit(W, 'oneup');
    }
  }

  // The level's song (live): its id (or the boss song once the boss wakes) in W.bgm, the fast variant
  // after the hurry jingle. The star song and the jingle hold it off until they end.
  function levelSong(W, section) {
    setSong(W, W.bgm + (W.hurried ? 'Fast' : ''), section);
  }
  function resumeSong(W, section) {
    if (W.p && W.p.star > 0) setSong(W, 'star');
    else levelSong(W, section);
  }
  function startHurry(W) {
    W.hurried = true;
    W.hurryT = HURRY_JINGLE;
    emit(W, 'hurry');
    setSong(W, 'hurry');
  }

  // the film keeps every level it builds in W.built; live play never grows it
  function track(W, lv) {
    if (!W.live && W.built.indexOf(lv) < 0) W.built.push(lv);
    return lv;
  }

  function showTitle(W) {
    W.mode = 'title';
    W.mt = 0;
    if (W.live) {
      const def = titleDef(W);
      W.lv = buildLevel(def, W, def.id);
      W.li = def.id;
      W.areas = [W.lv];
    } else {
      W.lv = track(W, buildLevel(CQ.LEVEL_DEFS[0], W, 0));
      W.li = 0;
    }
    W.cam = 0;
    const s = W.lv.def.start;
    W.p = newPlayer(s.x, s.y, false, false);
    W.items = []; W.parts = []; W.pops = []; W.bumps = [];
    W.world = '1-1';
    W.timerOn = false;
    W.big = false;
    W.score = 0; W.coins = 0; W.lives = 3;
    W.stats = { bugs: 0, coins: 0 };
    W.introPlayed = false;
    W.ending = null;
    W.seq = null;
    W.goal = null;
    W.rescueT = -1;
    if (W.live) {
      W.freeze = 0;
      newRun(W);
    }
  }

  // key: the level to start after the lives screen (film: an index into LEVEL_DEFS; live: an id)
  function enterLives(W, key) {
    W.mode = 'lives';
    W.mt = 0;
    W.pending = key;
    W.world = defOf(W, key).world;
    W.timerOn = false;
    setSong(W, 'none');
  }

  // cap for the camera (the castle's bridge lock, the level's end)
  const camCapOf = (lv) => (lv.camCap != null ? Math.min(lv.camCap, lv.maxCam) : lv.maxCam);

  function startLevel(W, key) {
    const def = defOf(W, key);
    const lv = track(W, buildLevel(def, W, key));
    if (W.live) W.areas = [lv];
    else W.levels[key] = lv;
    W.lv = lv;
    W.li = key;
    W.cam = 0;
    W.p = newPlayer(def.start.x, def.start.y, W.big, W.code);
    W.items = []; W.parts = []; W.pops = []; W.bumps = [];
    W.freeze = 0;
    W.seq = null;
    W.goal = null;
    W.poleScore = null;
    W.castleFlag = 0;
    W.time = def.time;
    W.timeT = 0;
    W.timerOn = def.time > 0;
    W.world = def.world;
    W.mode = 'play';
    W.mt = 0;
    W.rescueT = -1;
    let mid = null;
    if (W.live) {
      const p = W.p;
      W.mainId = mainOf(def);
      W.freezeK = null;
      W.hurried = false;
      W.hurryT = 0;
      W.bgm = def.song;
      W.lvCoins = 0;
      W.clear = null;
      // a respawn after the checkpoint: feet at the post, the camera on him, the enemies he had passed gone
      if (W.mid && W.mid.id === W.mainId && def.id === W.mainId && def.mid) {
        mid = W.mid;
        p.x = mid.tx * 16;
        p.y = rowTop(mid.row);
        p.ground = true;
        W.cam = Math.max(0, Math.min(camCapOf(lv), Math.floor(p.x + 8 - 128)));
        lv.ents = lv.ents.filter((e) => !(e.x < p.x + 64));
      } else if (def.start.drop) dropIn(p, def.start);
    }
    if (def.kind === 'over') {
      // the overworld song opens with its intro only on the first start
      setSong(W, def.song, W.introPlayed ? 'A' : 'intro');
      W.introPlayed = true;
    } else setSong(W, def.song);
    if (W.live) {
      emit(W, 'levelstart', { id: def.id, lives: W.lives, checkpoint: !!mid });
      for (const s of CQ.systems) if (s.enter) s.enter(W, lv);
    }
  }

  // a drop start: the head just clear of the HUD band at start.y, falling
  function dropIn(p, s) {
    p.x = s.x;
    p.y = s.y + DRAW_H(p);
    p.vx = 0;
    p.vy = 0;
    p.ground = false;
    p.jumping = false;
    p.jumped = false;
    p.gFall = PH.jumps[0][3];
  }

  // ------------------------------------------------------------------------------------------
  // Step
  // ------------------------------------------------------------------------------------------
  function step(W, btn) {
    W.ev = [];
    btn &= 255;
    const pressed = btn & ~W.prev;
    W.btn = btn;
    // pause (live): the world and every clock hold; only f, prev, btn and ev change
    if (W.mode === 'pause' || (W.mode === 'play' && pressed & START && pausable(W))) {
      if (W.mode === 'play') {
        W.mode = 'pause';
        W.p.buf = 0;
        emit(W, 'pause');
      } else if (pressed & START) {
        W.mode = 'play';
        emit(W, 'unpause');
      }
      W.prev = btn;
      W.f++;
      return W.ev;
    }
    if (W.flashN > 0) W.flashN--;
    switch (W.mode) {
      case 'title':
        if (W.f === 0 || W.mt === 0) setSong(W, 'title');
        W.mt++;
        if (pressed & START) {
          emit(W, 'start');
          setSong(W, 'none');
          W.mode = 'title2';
          W.mt = 0;
        }
        break;
      case 'title2':
        if (++W.mt >= TITLE2_FRAMES) enterLives(W, W.live ? W.startId : 0);
        break;
      case 'lives':
        if (++W.mt >= LIVES_FRAMES) startLevel(W, W.pending);
        break;
      case 'play':
        W.mt++;
        play(W, btn, pressed);
        break;
      case 'gameover':
        if (++W.mt >= GAMEOVER_FRAMES) {
          if (W.live) {
            W.mode = 'continue';
            W.mt = 0;
            W.cont = { sel: 0 };
          } else showTitle(W);
        }
        break;
      case 'continue':
        continueStep(W, pressed);
        break;
      case 'clear':
        if (++W.mt >= CLEAR_FRAMES) {
          const next = W.clearNext;
          W.clear = null;
          W.clearNext = null;
          if (next) enterLives(W, next);
          else showTitle(W);
        }
        break;
      case 'credits':
        creditsStep(W, pressed);
        break;
    }
    W.prev = btn;
    W.f++;
    W.vf++;
    return W.ev;
  }
  CQ.step = step;
  CQ.newWorld = newWorld;

  // the continue screen (live): UP, DOWN or SELECT moves the cursor, A or START confirms
  function continueStep(W, pressed) {
    W.mt++;
    const c = W.cont;
    if (pressed & (UP | DOWN | SELECT)) {
      c.sel ^= 1;
      emit(W, 'cursor');
    } else if (pressed & (A | START)) {
      W.cont = null;
      if (c.sel === 0) {
        const id = W.mainId || W.startId;
        W.lives = LIVES_START;
        W.score = 0;
        W.coins = 0;
        W.continues++;
        W.mid = null;
        W.big = false;
        W.code = false;
        emit(W, 'continue', { id });
        enterLives(W, id);
      } else {
        emit(W, 'quit');
        showTitle(W);
      }
    }
  }

  // the clear card (live), entered when the flagpole's fireworks are done
  function enterClear(W) {
    const def = W.lv.def;
    const id = mainOf(def);
    const tokens = W.tokens[id] | 0;
    const mdef = (CQ.GAME_DEFS && CQ.GAME_DEFS[id]) || def;
    W.mid = null;
    W.clear = { id, name: mdef.name || '', tokens, coins: W.lvCoins, time: W.clearTime, score: W.score };
    W.clearNext = def.next || mdef.next || null;
    W.mode = 'clear';
    W.mt = 0;
    W.timerOn = false;
    setSong(W, 'none');
    emit(W, 'clear', { id, score: W.score, time: W.clearTime, tokens });
  }

  // the credits (live): the cast parade to its own song, fireworks on the beat, then the final card.
  // START during the parade skips to the card (the song jumps to the card's chord); on the card START
  // returns to the title from CREDITS_ROLL + CREDITS_WAIT
  function enterCredits(W) {
    const n = tokenCount(W);
    W.credits = { t: 0, score: W.score, top: W.top, tokens: n, perfect: n >= TOKENS_MAX };
    W.mode = 'credits';
    W.mt = 0;
    setSong(W, 'credits');
    emit(W, 'credits');
  }
  function creditsStep(W, pressed) {
    const c = W.credits;
    c.t++;
    W.mt++;
    if (c.t < CREDITS_ROLL) {
      if (pressed & START) {
        c.t = CREDITS_ROLL;
        setSong(W, 'credits', 'card');
      } else if (CREDITS_FIREWORKS.indexOf(c.t) >= 0) emit(W, 'firework');
    } else if ((c.t >= CREDITS_ROLL + CREDITS_WAIT && pressed & START) || c.t >= CREDITS_ROLL + CREDITS_HOLD) {
      W.credits = null;
      showTitle(W);
    }
  }

  // A copy of a world that shares nothing mutable with it (the tape's planner plays futures on copies).
  // Level definitions, original grids and firebars never change and are shared.
  // A live level also copies its change log (a cloned live console can be drawn), its multi-coin
  // bricks, and whatever each system added (their cloneLevel hooks).
  const flat = (o) => (o ? Object.assign({}, o) : o);
  function cloneLevel(lv, live) {
    const c = Object.assign({}, lv);
    c.grid = lv.grid.slice();
    c.changes = live ? lv.changes.slice() : [];
    c.hist = null;
    c.histLen = -1;
    c.ents = lv.ents.map(flat);
    c.boss = flat(lv.boss);
    c.axe = flat(lv.axe);
    c.pearl = flat(lv.pearl);
    if (live) {
      if (lv.multi) {
        c.multi = {};
        for (const k in lv.multi) c.multi[k] = flat(lv.multi[k]);
      }
      for (const s of CQ.systems) if (s.cloneLevel) s.cloneLevel(lv, c);
    }
    return c;
  }
  function cloneWorld(W) {
    const c = Object.assign({}, W);
    const map = new Map();
    const lvOf = (lv) => {
      if (!lv) return lv;
      if (!map.has(lv)) map.set(lv, cloneLevel(lv, W.live));
      return map.get(lv);
    };
    c.lv = lvOf(W.lv);
    c.levels = W.levels.map(lvOf);
    c.built = [];
    c.p = flat(W.p);
    c.items = W.items.map(flat);
    c.parts = W.parts.map(flat);
    c.pops = W.pops.map(flat);
    c.bumps = W.bumps.map(flat);
    c.seq = flat(W.seq);
    c.goal = flat(W.goal);
    c.poleScore = flat(W.poleScore);
    c.ending = flat(W.ending);
    c.stats = flat(W.stats);
    c.ev = [];
    if (W.live) {
      c.areas = W.areas.map(lvOf);
      c.tokens = Object.assign({}, W.tokens);
      c.mid = flat(W.mid);
      c.cont = flat(W.cont);
      c.clear = flat(W.clear);
      c.credits = flat(W.credits);
      for (const s of CQ.systems) if (s.cloneWorld) s.cloneWorld(W, c);
    }
    return c;
  }
  CQ.cloneWorld = cloneWorld;

  function play(W, btn, pressed) {
    const lv = W.lv;
    const p = W.p;
    // the hurry jingle runs on the play clock; then the fast song, unless something else took the music
    if (W.live && W.hurryT > 0 && --W.hurryT === 0 && W.song === 'hurry') resumeSong(W, lv.def.kind === 'over' ? 'A' : undefined);
    if (W.freeze > 0) {
      if (W.freezeK === 'code') {
        // the terminal's hold (live): Claw'd flickers in the code palette, then he is Claw'd Code
        W.freeze--;
        if (W.freeze === 0) {
          W.freezeK = null;
          p.code = true;
          W.code = true;
          emit(W, 'powerup', { form: 'code' });
        }
        return;
      }
      // the power-up pause: only the player's grow flicker runs
      p.growT = GROW_FRAMES - W.freeze;
      W.freeze--;
      if (W.freeze === 0) {
        p.big = true;
        W.big = true;
        p.growT = -1;
      }
      return;
    }
    const frozen = p.st === 'axe' || p.st === 'dead'; // the bridge collapse and a death hold the world still
    if (!frozen) lv.t++;
    const sys = systemsOf(W);
    if (!frozen) for (const s of sys) if (s.pre) s.pre(W, lv, p);
    if (p.st === 'play') controlPlayer(W, lv, p, btn, pressed);
    else scripted(W, lv, p, btn);
    if (W.mode !== 'play' || W.lv !== lv) return; // a door or a death changed the scene
    if (p.st === 'play') for (const s of sys) if (s.input) s.input(W, lv, p, btn, pressed);
    if (W.live && p.st === 'play') passCheckpoint(W, lv, p);
    if (!frozen) {
      stepEnemies(W, lv, btn);
      stepItems(W, lv);
      stepFirebars(W, lv);
    }
    stepBoss(W, lv);
    if (!frozen) for (const s of sys) if (s.step) s.step(W, lv);
    stepParts(W, lv);
    // the camera only scrolls forward, holding the player at 40% of the screen
    if (p.st === 'play' || p.st === 'walkCastle' || p.st === 'poleHop' || p.st === 'walkPearl' || p.st === 'rescued') {
      // catching up after a pause (the flagpole swing) eases in at up to 3 px a frame
      const tgt = Math.floor(p.x + 8 - 128);
      const cap = lv.camCap != null ? Math.min(lv.camCap, lv.maxCam) : lv.maxCam;
      if (tgt > W.cam && W.cam < cap) W.cam = Math.min(tgt, cap, W.cam + Math.max(3, Math.ceil(Math.abs(p.vx))));
    }
    if (W.timerOn && p.st === 'play') {
      if (++W.timeT >= TIMER_FRAMES) {
        W.timeT = 0;
        if (W.time > 0) W.time--;
        if (W.live && W.time === HURRY_AT && !W.hurried) startHurry(W);
        if (W.time === 0) hurt(W, true, 'time');
      }
    }
    if (p.star > 0 && p.st === 'play') {
      p.star--;
      // the overworld picks up again at its B section (live: the level's song, fast after the hurry)
      if (p.star === 0) {
        const section = lv.def.kind === 'over' ? 'B' : undefined;
        if (W.live) {
          if (W.hurryT === 0) levelSong(W, section);
        } else setSong(W, lv.def.song, section);
      }
    }
    if (p.inv > 0) p.inv--;
    if (W.score > W.top) W.top = W.score;
  }

  // the checkpoint post (live): passed when his body's left edge reaches its column in the main level
  function passCheckpoint(W, lv, p) {
    const def = lv.def;
    if (!def.mid || mainOf(def) !== def.id || (W.mid && W.mid.id === def.id)) return;
    if (bodyL(p) >= def.mid.tx * 16) {
      W.mid = { id: def.id, tx: def.mid.tx, row: def.mid.row };
      emit(W, 'checkpoint', { id: def.id });
    }
  }

  // ------------------------------------------------------------------------------------------
  // The player under control
  // ------------------------------------------------------------------------------------------
  function controlPlayer(W, lv, p, btn, pressed) {
    const d = (btn & RIGHT ? 1 : 0) - (btn & LEFT ? 1 : 0);
    const run = (btn & B) !== 0;
    let bufSet = false;
    if (p.ground) {
      const maxV = run ? PH.maxRun : PH.maxWalk;
      if (d !== 0) {
        if (p.vx !== 0 && Math.sign(p.vx) !== d) {
          // skid: brake hard, turn round once slow enough
          const s = Math.abs(p.vx) - PH.skidDec;
          if (s <= PH.skidTurn) {
            p.vx = 0;
            p.skid = false;
          } else {
            p.vx = Math.sign(p.vx) * s;
            p.skid = true;
          }
          p.face = d;
        } else {
          p.skid = false;
          p.face = d;
          let s = Math.abs(p.vx);
          if (s < PH.minWalk) s = PH.minWalk;
          else if (s < maxV) s = Math.min(maxV, s + (run ? PH.runAcc : PH.walkAcc));
          else if (s > maxV) s = Math.max(maxV, s - PH.relDec);
          p.vx = d * s;
        }
      } else {
        p.skid = false;
        const s = Math.abs(p.vx) - PH.relDec;
        p.vx = s <= 0 ? 0 : Math.sign(p.vx) * s;
      }
      // the jump buffer (live, modern): an A press made just before landing, still held, jumps now
      if (pressed & A || (W.assist && p.buf > 0 && btn & A)) jump(W, p, run);
    } else {
      if (d !== 0) {
        // air control: keep momentum, steer within the speed the jump started with
        const acc = Math.abs(p.vx) >= PH.maxWalk ? PH.runAcc : PH.walkAcc;
        let nv = p.vx + d * acc;
        if (nv * d > p.airMax) nv = d * Math.max(p.airMax, p.vx * d);
        p.vx = nv;
      }
      if (W.assist) {
        // coyote time: a jump a few frames after walking off a ledge still counts as a ground jump;
        // any other airborne A press is buffered for the landing
        if (pressed & A) {
          if (p.coyote > 0 && !p.jumped) jump(W, p, run);
          else {
            p.buf = BUFFER_FRAMES;
            bufSet = true;
          }
        }
        if (!p.ground && p.coyote > 0) p.coyote--;
      }
    }
    if (p.buf > 0 && !bufSet) p.buf--;

    moveX(W, lv, p);
    moveY(W, lv, p, btn);
    if (p.ground) for (const s of systemsOf(W)) if (s.grounded) s.grounded(W, lv, p, btn);
    animate(p, d);
    touchTiles(W, lv, p);
    doors(W, lv, p, btn);
    if (p.y > 200) die(W, 'pit');
  }

  // a ground jump: the jump row from the current speed, the air speed cap from the run state
  function jump(W, p, run) {
    const s = Math.abs(p.vx);
    const row = PH.jumps.find((j) => s < j[0]);
    p.vy = row[1];
    p.gHold = row[2];
    p.gFall = row[3];
    p.jumping = true;
    p.jumped = true;
    p.ground = false;
    p.skid = false;
    p.airMax = run || s > PH.maxWalk ? PH.maxRun : PH.maxWalk;
    p.coyote = 0;
    p.buf = 0;
    emit(W, 'jump', { big: p.big });
  }

  function moveX(W, lv, p) {
    p.x += p.vx;
    if (p.x < W.cam) {
      p.x = W.cam;
      if (p.vx < 0) p.vx = 0;
    }
    const offs = p.big ? [2, 11, 20] : [2, 13];
    const hw = HALF_W(p);
    const R = bodyR(p), L = bodyL(p);
    if (p.vx >= 0) {
      for (const o of offs) {
        if (solidAt(lv, R, p.y - o)) {
          p.x = Math.floor(R / 16) * 16 - 8 - hw;
          if (p.vx > 0) p.vx = 0;
          return;
        }
      }
    }
    if (p.vx <= 0) {
      for (const o of offs) {
        if (solidAt(lv, L, p.y - o)) {
          p.x = Math.floor(L / 16) * 16 + 8 + hw;
          if (p.vx < 0) p.vx = 0;
          return;
        }
      }
    }
  }

  // move p by dx under moveX's wall and camera rules, leaving p.vx alone (lifts carry a rider with it)
  function nudgeX(W, lv, p, dx) {
    p.x += dx;
    if (p.x < W.cam) p.x = W.cam;
    const offs = p.big ? [2, 11, 20] : [2, 13];
    const hw = HALF_W(p);
    const R = bodyR(p), L = bodyL(p);
    if (dx >= 0) {
      for (const o of offs) {
        if (solidAt(lv, R, p.y - o)) {
          p.x = Math.floor(R / 16) * 16 - 8 - hw;
          return;
        }
      }
    }
    if (dx <= 0) {
      for (const o of offs) {
        if (solidAt(lv, L, p.y - o)) {
          p.x = Math.floor(L / 16) * 16 + 8 + hw;
          return;
        }
      }
    }
  }

  function land(p) {
    p.ground = true;
    p.vy = 0;
    p.jumping = false;
    p.jumped = false;
    p.combo = 0;
    p.coyote = 0;
  }

  function moveY(W, lv, p, btn) {
    const h = bodyH(p);
    const lx = bodyL(p) + 1, rx = bodyR(p) - 1;
    if (p.ground) {
      if (solidAt(lv, lx, p.y) || solidAt(lv, rx, p.y)) return;
      // no tile under the feet: a system (a lift) may still hold him up
      if (W.live) for (const s of CQ.systems) if (s.support && s.support(W, lv, p)) return;
      // walked off a ledge: fall with the gravity of the current speed
      p.ground = false;
      p.jumping = false;
      p.vy = 0;
      const row = PH.jumps.find((j) => Math.abs(p.vx) < j[0]);
      p.gFall = row[3];
      if (W.assist) p.coyote = COYOTE_FRAMES;
    }
    if (!(btn & A)) p.jumping = false;
    p.vy += p.jumping && p.vy < 0 ? p.gHold : p.gFall;
    if (p.vy > PH.maxFall) p.vy = PH.maxFall;
    const y0 = p.y;
    p.y += p.vy;
    if (p.vy < 0) {
      const hy = p.y - h;
      const cx = p.x + 8;
      // head-corner correction (live, modern): a graze of a block's edge slides past it
      if (W.assist && p.vy <= -1 && cornerSlip(W, lv, p, hy, lx, rx, cx)) return;
      let hx = null;
      if (headAt(lv, cx, hy)) hx = cx;
      else if (headAt(lv, lx, hy)) hx = lx;
      else if (headAt(lv, rx, hy)) hx = rx;
      if (hx !== null) {
        const ty = rowOf(hy);
        p.y = rowTop(ty) + 16 + h;
        p.vy = 0;
        p.jumping = false;
        bumpBlock(W, lv, Math.floor(hx / 16), ty);
      }
    } else {
      let landed = false;
      if (solidAt(lv, lx, p.y) || solidAt(lv, rx, p.y)) {
        const top = rowTop(rowOf(p.y));
        if (top >= y0 - 1) {
          p.y = top;
          land(p);
          landed = true;
        }
      }
      // no tile landing this frame: a system (a lift top) may catch him
      if (!landed && W.live) {
        for (const s of CQ.systems) {
          if (s.land && s.land(W, lv, p, y0)) {
            land(p);
            break;
          }
        }
      }
    }
  }

  // docs/game-spec.md 5.2 E-corner: the centre probe clear and exactly one edge probe in a block that is
  // not hidden (* or +): shift him clear by at most CORNER_PX if nothing else is then in the way
  function cornerSlip(W, lv, p, hy, lx, rx, cx) {
    if (headAt(lv, cx, hy)) return false;
    const hl = headAt(lv, lx, hy), hr = headAt(lv, rx, hy);
    if (hl === hr) return false;
    const hx = hl ? lx : rx;
    const col = Math.floor(hx / 16);
    const c = cell(lv, col, rowOf(hy));
    if (c === HID || c === PLUS) return false;
    const shift = hl ? (col + 1) * 16 - lx : -(rx - col * 16 + 1);
    if (Math.abs(shift) > CORNER_PX) return false;
    const nx = p.x + shift;
    if (nx < W.cam) return false;
    const hw = HALF_W(p);
    const L = nx + 8 - hw, R = nx + 7 + hw;
    if (headAt(lv, nx + 8, hy) || headAt(lv, L + 1, hy) || headAt(lv, R - 1, hy)) return false;
    for (const o of p.big ? [2, 11, 20] : [2, 13]) if (solidAt(lv, L, p.y - o) || solidAt(lv, R, p.y - o)) return false;
    p.x = nx;
    return true;
  }

  // d: the direction held (a player pushing against a wall keeps walking on the spot)
  function animate(p, d) {
    if (p.ground) {
      if (p.skid) p.pose = 'skid';
      else if (p.vx === 0 && !d) {
        p.pose = 'idle';
        p.animT = 0;
      } else {
        const s = Math.max(Math.abs(p.vx), d ? 0.5 : 0);
        const period = s >= 2.25 ? 3 : s >= 1.5 ? 4 : s >= 0.8 ? 6 : 8;
        if (++p.animT >= period) {
          p.animT = 0;
          p.anim = (p.anim + 1) % 3;
        }
        p.pose = 'run' + (p.anim + 1);
      }
    } else if (p.jumped) p.pose = 'jump';
  }

  // coins the body touches, lava under the feet
  function touchTiles(W, lv, p) {
    const h = bodyH(p);
    const x0 = Math.floor(bodyL(p) / 16), x1 = Math.floor(bodyR(p) / 16);
    const y0 = rowOf(p.y - h + 2), y1 = rowOf(p.y - 1);
    for (let ty = y0; ty <= y1; ty++) {
      for (let tx = x0; tx <= x1; tx++) {
        if (cell(lv, tx, ty) === COIN) {
          setCell(lv, tx, ty, DOT);
          collectCoin(W);
        }
      }
    }
    const under = cell(lv, Math.floor((p.x + 8) / 16), rowOf(p.y - 4));
    if ((under === LAVA_T || under === LAVA) && p.st === 'play') die(W, 'lava');
  }

  // pipes, the flagpole and the axe
  function doors(W, lv, p, btn) {
    const def = lv.def;
    if (def.pipeDown && p.ground && btn & DOWN && !(btn & (LEFT | RIGHT))) {
      const px = def.pipeDown.tx * 16;
      if (p.x + 8 >= px + 4 && p.x + 8 <= px + 28 && p.y === lv.pipeDownY) {
        p.st = 'pipeDown';
        p.t = 0;
        p.vx = 0;
        p.behind = true;
        p.pose = 'idle';
        p.star = 0;
        emit(W, 'pipe');
        setSong(W, 'none'); // the console silences the music as he goes in
        return;
      }
    }
    // the side pipe's mouth is rows row..row+1; he walks in standing on the row below it
    if (def.pipeSide && p.ground && btn & RIGHT && p.y === rowTop(def.pipeSide.row != null ? def.pipeSide.row + 2 : 10)) {
      const mx = def.pipeSide.tx * 16;
      if (bodyR(p) + 1 >= mx) {
        p.st = 'pipeSide';
        p.t = 0;
        p.vx = 0;
        p.face = 1;
        p.behind = true;
        emit(W, 'pipe');
        setSong(W, 'none');
        return;
      }
    }
    if (lv.pole) {
      const poleX = lv.pole.tx * 16 + 7;
      if (bodyR(p) + 1 >= poleX) grabPole(W, lv, p);
    }
    if (lv.axe && !lv.axe.gone) {
      const ax = lv.axe.tx * 16, ay = rowTop(lv.axe.ty);
      if (bodyR(p) + 1 > ax + 2 && bodyL(p) < ax + 14 && p.y > ay && p.y - bodyH(p) < ay + 16) touchAxe(W, lv, p);
    }
  }

  // ------------------------------------------------------------------------------------------
  // Blocks
  // ------------------------------------------------------------------------------------------
  function bumpBlock(W, lv, tx, ty) {
    const c = cell(lv, tx, ty);
    const p = W.p;
    const x = tx * 16, y = rowTop(ty);
    if (c === QB) {
      setCell(lv, tx, ty, USED);
      W.bumps.push({ tx, ty, t: 0, code: USED });
      W.parts.push({ k: 'coin', x: x + 4, y: y - 14, vy: -5.5, y0: y - 14, t: 0 });
      collectCoin(W);
      bumpTop(W, lv, tx, ty);
    } else if (c === MB || c === HID || (W.live && (c === LIFE_B || c === PLUS))) {
      // M: the floppy (live: the terminal when big); *: the spark; N and + (live): the 1UP floppy
      const k = c === HID ? 'spark' : c === MB ? (W.live && p.big ? 'terminal' : 'mushroom') : 'life';
      setCell(lv, tx, ty, USED);
      W.bumps.push({ tx, ty, t: 0, code: USED });
      W.items.push({ k, x, y: y + 16, vx: 0, vy: 0, st: 'sprout', t: 0, ground: true, y1: y });
      emit(W, 'sprout');
      bumpTop(W, lv, tx, ty);
    } else if (W.live && c === MULTI) {
      // the multi-coin brick: a coin a bump; the first bump opens a MULTI_WINDOW-frame window; it is spent
      // (used) on the bump that pays the 10th coin, or on the first bump after the window (that one pays)
      const i = ty * lv.w + tx;
      const m = lv.multi[i] || (lv.multi[i] = { t0: lv.t, n: 0 });
      const late = lv.t - m.t0 >= MULTI_WINDOW;
      m.n++;
      const spent = m.n >= MULTI_MAX || late;
      if (spent) setCell(lv, tx, ty, USED);
      W.bumps.push({ tx, ty, t: 0, code: spent ? USED : MULTI });
      W.parts.push({ k: 'coin', x: x + 4, y: y - 14, vy: -5.5, y0: y - 14, t: 0 });
      collectCoin(W);
      bumpTop(W, lv, tx, ty);
    } else if (c === BRICK) {
      if (p.big) {
        setCell(lv, tx, ty, DOT);
        for (let i = 0; i < 4; i++) {
          const right = i & 1, low = i >> 1;
          W.parts.push({ k: 'frag', x: x + right * 8, y: y + low * 8, vx: right ? 1 : -1, vy: low ? -4 : -6, t: 0, flip: !!right });
        }
        addScore(W, 50);
        emit(W, 'brick');
        bumpTop(W, lv, tx, ty);
      } else {
        W.bumps.push({ tx, ty, t: 0, code: BRICK });
        emit(W, 'bump');
        bumpTop(W, lv, tx, ty);
      }
    } else {
      emit(W, 'bump');
    }
  }

  // a block knocked from below knocks whatever stands on it
  function bumpTop(W, lv, tx, ty) {
    const top = rowTop(ty), x = tx * 16;
    for (const e of lv.ents) {
      if (!alive(e) || e.st === 'wait') continue;
      const K = kindOf(W, e);
      if (K && K.flier) continue; // a flier never stands on a block
      if (Math.abs(e.y - top) <= 2 && e.x + 14 > x && e.x + 2 < x + 16) knock(W, e, e.x + 8 >= x + 8 ? 1 : -1, 1);
    }
    for (const it of W.items) {
      if (it.st === 'move' && Math.abs(it.y - top) <= 2 && it.x + 14 > x && it.x + 2 < x + 16) {
        it.vy = -3.5;
        it.ground = false;
        it.vx = (it.x + 8 >= x + 8 ? 1 : -1) * Math.abs(it.vx || PH.itemSpeed);
      }
    }
    if (cell(lv, tx, ty - 1) === COIN) {
      setCell(lv, tx, ty - 1, DOT);
      W.parts.push({ k: 'coin', x: x + 4, y: top - 30, vy: -5.5, y0: top - 30, t: 0 });
      collectCoin(W);
    }
  }

  // ------------------------------------------------------------------------------------------
  // Enemies
  // ------------------------------------------------------------------------------------------
  function makeEnemy(kind, x, y) {
    return { kind, x, y, vx: -PH.enemyWalk, vy: 0, ground: true, st: 'wait', t: 0, grace: 0, chain: 0 };
  }
  const alive = (e) => e.st === 'walk' || e.st === 'shell' || e.st === 'wait';
  // the top of an enemy's body: the bug stands 14 px, the shell-bug is a low crawler (10), its shell 9
  const eTop = (e, K) => e.y - (K ? K.top : e.kind === 'shellbug' ? 10 : e.kind === 'shell' ? 9 : 14);
  // score pops start just above the drawing (every enemy drawing is 16 tall), centred on it
  const popX = (e) => e.x + 8;
  const popY = (e) => e.y - 16 - 8;

  function walker(lv, e) {
    e.x += e.vx;
    const yy = e.y - 8;
    if (e.vx > 0 && solidAt(lv, e.x + 14, yy)) {
      e.x = Math.floor((e.x + 14) / 16) * 16 - 15;
      e.vx = -e.vx;
      return 1;
    }
    if (e.vx < 0 && solidAt(lv, e.x + 1, yy)) {
      e.x = Math.floor((e.x + 1) / 16) * 16 + 15;
      e.vx = -e.vx;
      return 1;
    }
    if (e.ground && !solidAt(lv, e.x + 4, e.y) && !solidAt(lv, e.x + 11, e.y)) {
      e.ground = false;
      e.vy = 0;
    }
    if (!e.ground) {
      e.vy = Math.min(PH.maxFall, e.vy + PH.enemyGrav);
      const y0 = e.y;
      e.y += e.vy;
      if (solidAt(lv, e.x + 4, e.y) || solidAt(lv, e.x + 11, e.y)) {
        const top = rowTop(rowOf(e.y));
        if (top >= y0 - 1) {
          e.y = top;
          e.vy = 0;
          e.ground = true;
        }
      }
    }
    return 0;
  }

  function knock(W, e, dir, n) {
    if (e.kind !== 'shell') W.stats.bugs++; // a shell was counted when it was stomped
    e.st = 'dead';
    e.vy = -3;
    e.vx = dir * 0.75;
    e.t = 0;
    comboPoints(W, n, popX(e), popY(e));
    emit(W, 'kick', { combo: n });
  }

  function stepEnemies(W, lv, btn) {
    const p = W.p;
    const ents = lv.ents;
    for (const e of ents) {
      if (e.st === 'gone') continue;
      if (e.st === 'wait') {
        if (e.x <= W.cam + 320 + 8) e.st = 'walk';
        else continue;
      }
      e.t++;
      if (e.grace > 0) e.grace--;
      if (e.st === 'flat') {
        if (e.t > 30) e.st = 'gone';
        continue;
      }
      if (e.st === 'dead') {
        e.vy = Math.min(PH.maxFall, e.vy + PH.enemyGrav);
        e.x += e.vx;
        e.y += e.vy;
        if (e.y > 220) e.st = 'gone';
        continue;
      }
      const K = kindOf(W, e);
      if (K) K.move(W, lv, e);
      else walker(lv, e);
      if (e.y > 220 || e.x < W.cam - 48 || e.x > W.cam + 400) e.st = 'gone';
    }
    // enemy against enemy: walkers turn round, a moving shell knocks them out
    for (let i = 0; i < ents.length; i++) {
      const a = ents[i];
      if (a.st !== 'walk' && a.st !== 'shell') continue;
      for (let j = i + 1; j < ents.length; j++) {
        const b = ents[j];
        if (b.st !== 'walk' && b.st !== 'shell') continue;
        if (Math.abs(a.x - b.x) >= 14 || Math.abs(a.y - b.y) >= 14) continue;
        const aShell = a.st === 'shell' && a.vx !== 0, bShell = b.st === 'shell' && b.vx !== 0;
        if (aShell && !bShell) knock(W, b, Math.sign(a.vx), ++a.chain);
        else if (bShell && !aShell) knock(W, a, Math.sign(b.vx), ++b.chain);
        else if (aShell && bShell) {
          knock(W, a, Math.sign(b.vx), 1);
          knock(W, b, Math.sign(a.vx), 1);
        } else {
          // two walkers (or a walker and a resting shell) turn away from each other; fliers pass by
          const Ka = kindOf(W, a), Kb = kindOf(W, b);
          if ((Ka && Ka.flier) || (Kb && Kb.flier)) continue;
          const l = a.x < b.x ? a : b, r = l === a ? b : a;
          if (l.st === 'walk' && l.vx > 0) l.vx = -l.vx;
          if (r.st === 'walk' && r.vx < 0) r.vx = -r.vx;
        }
      }
    }
    if (p.st !== 'play') return;
    const pl = bodyL(p), pr = bodyR(p) + 1, pt = p.y - bodyH(p) + 4, pb = p.y;
    for (const e of ents) {
      if (e.st !== 'walk' && e.st !== 'shell') continue;
      const K = kindOf(W, e);
      const el = e.x + 2, er = e.x + 14, et = eTop(e, K), eb = e.y;
      if (!(pr > el && pl < er && pb > et && pt < eb)) continue;
      if (p.star > 0) {
        knock(W, e, p.x + 8 <= e.x + 8 ? 1 : -1, ++p.starCombo);
        continue;
      }
      if (K && K.spiky) {
        // spikes hurt from every side, a stomp included
        if (p.inv > 0) continue;
        hurt(W, false, 'spike');
        return;
      }
      if (p.vy > 0 && p.y - p.vy <= et + 6) {
        stomp(W, e, p, btn);
        continue;
      }
      if (e.st === 'shell' && e.vx === 0) {
        kickShell(W, e, p);
        continue;
      }
      if (e.grace > 0 || p.inv > 0) continue;
      hurt(W, false, 'enemy');
      return;
    }
  }

  function stomp(W, e, p, btn) {
    p.combo++;
    emit(W, 'stomp', { combo: p.combo });
    const K = kindOf(W, e);
    if (K) {
      if (K.onStomp) K.onStomp(W, W.lv, e, p);
    } else if (e.kind === 'bug') {
      e.st = 'flat';
      e.t = 0;
      W.stats.bugs++;
      comboPoints(W, p.combo, popX(e), popY(e));
    } else if (e.kind === 'shellbug') {
      e.kind = 'shell';
      e.st = 'shell';
      e.vx = 0;
      e.t = 0;
      e.chain = 0;
      W.stats.bugs++;
      comboPoints(W, p.combo, popX(e), popY(e));
    } else if (e.vx !== 0) {
      e.vx = 0;
      e.t = 0;
      comboPoints(W, p.combo, popX(e), popY(e));
    } else {
      kickShell(W, e, p);
    }
    p.vy = PH.stompVy;
    p.jumping = (btn & A) !== 0;
    p.gHold = PH.jumps[0][2];
    p.gFall = PH.jumps[0][3];
    p.ground = false;
    p.coyote = 0;
    p.buf = 0;
  }

  function kickShell(W, e, p) {
    const dir = p.x + 8 <= e.x + 8 ? 1 : -1;
    e.vx = dir * PH.shellSpeed;
    e.x += dir * 4;
    e.grace = 12;
    e.chain = 0;
    addScore(W, 400);
    pop(W, 2, popX(e), popY(e));
    emit(W, 'kick', { combo: 1 });
  }

  // A hit: big (or Code) Claw'd drops to small with 120 invincible frames in both feel modes (D6);
  // small Claw'd dies. cause (live): enemy, spike, fire, boss, pit, lava, time.
  function hurt(W, fatal, cause) {
    const p = W.p;
    if (!fatal && p.big) {
      p.big = false;
      W.big = false;
      p.code = false;
      W.code = false;
      p.inv = 120;
      if (W.live) emit(W, 'hurt', { cause: cause || 'enemy' });
      else emit(W, 'pipe'); // the shrink shares the pipe's falling tone
      return;
    }
    die(W, cause);
  }

  function die(W, cause) {
    const p = W.p;
    if (p.st === 'dead') return;
    p.st = 'dead';
    p.t = 0;
    p.vx = 0;
    p.vy = 0;
    p.big = false;
    W.big = false;
    p.star = 0;
    W.timerOn = false;
    if (W.live) {
      p.code = false;
      W.code = false;
      p.buf = 0;
      p.coyote = 0;
      p.throwT = 0;
      p.growT = -1;
      W.freeze = 0;
      W.freezeK = null;
      emit(W, 'die', { cause: cause || 'enemy' });
      setSong(W, 'death');
    } else setSong(W, 'none');
  }

  // ------------------------------------------------------------------------------------------
  // Items: the mushroom and the Claude spark
  // ------------------------------------------------------------------------------------------
  function stepItems(W, lv) {
    const p = W.p;
    for (const it of W.items) {
      if (it.gone) continue;
      it.t++;
      if (it.st === 'sprout') {
        it.y -= 0.5;
        if (it.y <= it.y1) {
          it.y = it.y1;
          if (W.live && (it.k === 'terminal' || lv.def.kind === 'sky')) {
            // the terminal stays on its block, and nothing walks off a sky tower (live)
            it.st = 'rest';
          } else {
            it.st = 'move';
            it.vx = PH.itemSpeed;
            if (it.k === 'spark') {
              it.vy = -3;
              it.ground = false;
            }
          }
        }
        continue;
      }
      if (it.st === 'rest') {
        // stays where it sprouted
      } else if (it.k === 'mushroom' || it.k === 'life') walker(lv, it);
      else {
        // the spark bounces in arcs
        it.x += it.vx;
        if (it.vx > 0 && solidAt(lv, it.x + 14, it.y - 8)) it.vx = -it.vx;
        else if (it.vx < 0 && solidAt(lv, it.x + 1, it.y - 8)) it.vx = -it.vx;
        it.vy = Math.min(PH.maxFall, it.vy + 0.1875);
        const y0 = it.y;
        it.y += it.vy;
        if (it.vy > 0 && (solidAt(lv, it.x + 4, it.y) || solidAt(lv, it.x + 11, it.y))) {
          const top = rowTop(rowOf(it.y));
          if (top >= y0 - 1) {
            it.y = top;
            it.vy = -4.25;
          }
        } else if (it.vy < 0 && (solidAt(lv, it.x + 4, it.y - 16) || solidAt(lv, it.x + 11, it.y - 16))) {
          it.y = rowTop(rowOf(it.y - 16)) + 32;
          it.vy = 0;
        }
      }
      if (it.y > 220 || it.x < W.cam - 32) {
        it.gone = true;
        continue;
      }
      if (p.st !== 'play') continue;
      if (bodyR(p) + 1 > it.x + 2 && bodyL(p) < it.x + 14 && p.y > it.y - 14 && p.y - bodyH(p) < it.y) {
        it.gone = true;
        if (it.k === 'life') {
          // the 1UP floppy: a life, no points
          gainLife(W);
          emit(W, 'oneup');
          pop(W, 10, p.x + 8, p.y - DRAW_H(p) - 12);
          continue;
        }
        addScore(W, 1000);
        // a terminal picked up small works as the floppy
        const grows = it.k === 'mushroom' || (it.k === 'terminal' && !p.big);
        // the pop rises from above his head (the grown head, for the floppy)
        pop(W, 5, p.x + 8, p.y - (grows ? 24 : DRAW_H(p)) - 12);
        if (grows) {
          emit(W, 'powerup');
          if (!p.big) {
            W.freeze = GROW_FRAMES;
            p.growT = 0;
          }
        } else if (it.k === 'terminal') {
          // big: the code freeze, then Claw'd Code (already Code: just the points)
          if (!p.code) {
            W.freeze = CODE_FREEZE;
            W.freezeK = 'code';
          }
        } else {
          p.star = STAR_FRAMES;
          p.starCombo = 0;
          setSong(W, 'star');
          flash(W, FLASH_WHITE, 2);
        }
      }
    }
    W.items = W.items.filter((it) => !it.gone);
  }

  // ------------------------------------------------------------------------------------------
  // Particles, score pops, bumped blocks
  // ------------------------------------------------------------------------------------------
  function stepParts(W, lv) {
    for (const q of W.parts) {
      q.t++;
      if (q.k === 'coin') {
        q.y += q.vy;
        q.vy += 0.35;
        if (q.vy > 0 && q.y >= q.y0 - 18) {
          q.gone = true;
          pop(W, 1, q.x + 4, q.y - 8);
        }
      } else if (q.k === 'frag') {
        q.x += q.vx;
        q.y += q.vy;
        q.vy += 0.3;
        if (q.y > 200) q.gone = true;
      } else if (q.k === 'fw') {
        if (q.t >= FW_LIFE) q.gone = true;
      } else if (q.k === 'splash') {
        if (q.t >= 24) q.gone = true;
      } else if (q.k === 'heart') {
        q.y -= 0.5;
        if (q.t >= q.life) q.gone = true;
      }
    }
    W.parts = W.parts.filter((q) => !q.gone);
    // score pops keep rising for their whole life
    for (const s of W.pops) {
      s.t++;
      s.y -= s.t <= 16 ? 1 : 0.5;
    }
    W.pops = W.pops.filter((s) => s.t < POP_LIFE);
    for (const b of W.bumps) b.t++;
    W.bumps = W.bumps.filter((b) => b.t < BUMP_DY.length);
  }

  // ------------------------------------------------------------------------------------------
  // The castle: firebars, the Big Bug, the axe and the bridge
  // ------------------------------------------------------------------------------------------
  // 32 angles, clockwise from pointing right; values rounded so every engine agrees
  const ANG = [];
  for (let i = 0; i < 32; i++) {
    const a = (i / 32) * Math.PI * 2;
    ANG.push([Math.round(Math.cos(a) * 1e4) / 1e4, Math.round(Math.sin(a) * 1e4) / 1e4]);
  }
  function firebarBalls(fb, t) {
    const i = (((fb.phase + fb.dir * Math.floor(t / fb.step)) % 32) + 32) % 32;
    const [c, s] = ANG[i];
    const out = [];
    for (let k = 0; k < fb.n; k++) out.push([Math.round(fb.cx + c * 8 * k) - 4, Math.round(fb.cy + s * 8 * k) - 4]);
    return out;
  }
  CQ.firebarBalls = firebarBalls;

  function stepFirebars(W, lv) {
    const p = W.p;
    if (p.st !== 'play' || !lv.firebars.length) return;
    const h = bodyH(p);
    for (const fb of lv.firebars) {
      for (const [bx, by] of firebarBalls(fb, lv.t)) {
        if (bodyR(p) > bx + 1 && bodyL(p) + 1 < bx + 7 && p.y > by + 1 && p.y - h + 3 < by + 7) {
          if (p.star === 0 && p.inv === 0) hurt(W, false, 'fire');
          return;
        }
      }
    }
  }

  function stepBoss(W, lv) {
    const b = lv.boss;
    if (!b || b.gone) return;
    const p = W.p;
    if (b.fall) {
      if (!b.lava) {
        b.vy = Math.min(3, b.vy + 0.125);
        b.y += b.vy;
        // feet through the lava's surface line: the splash, a one-frame flash, then it sinks slowly
        if (b.y >= rowTop(10) + 6) {
          b.lava = true;
          // two splashes, either side of its middle (x is a splash's centre)
          W.parts.push({ k: 'splash', x: Math.floor(b.x) + 7, y: rowTop(10) - 9, t: 0 });
          W.parts.push({ k: 'splash', x: Math.floor(b.x) + 25, y: rowTop(10) - 10, t: -3 });
          flash(W, FLASH_LAVA, 1);
        }
      } else {
        b.y += 1;
        if (b.y - 32 > rowTop(10) + 8) b.gone = true;
      }
      return;
    }
    if (p.st === 'axe') return; // frozen while the bridge goes
    if (!b.active) {
      if (b.x < W.cam + 320) {
        b.active = true;
        // live: the boss song from the frame it wakes (the star song or the hurry jingle finish first)
        if (W.live && lv.def.bossSong) {
          W.bgm = lv.def.bossSong;
          if (p.star === 0 && W.song !== 'hurry') levelSong(W);
        }
      } else return;
    }
    b.t++;
    // walk back and forth over its stretch of bridge, turning every 64 frames or at the ends
    if (!b.air) {
      if (b.t % 64 === 0) b.vx = -b.vx;
      b.x += b.vx;
      if (b.x <= b.x0) {
        b.x = b.x0;
        b.vx = Math.abs(b.vx);
      } else if (b.x >= b.x1) {
        b.x = b.x1;
        b.vx = -Math.abs(b.vx);
      }
      if (b.t % b.hopEvery === 40) {
        b.air = true;
        b.vy = -2.5;
        emit(W, 'hop');
      }
    } else {
      b.vy += 0.125;
      b.y += b.vy;
      if (b.vy > 0 && b.y >= rowTop(8)) {
        b.y = rowTop(8);
        b.vy = 0;
        b.air = false;
      }
    }
    if (b.t % 150 === 100) {
      b.roar = 30;
      emit(W, 'roar');
    }
    if (b.roar > 0) b.roar--;
    b.face = p.x + 8 < b.x + 16 ? -1 : 1;
    if (!b.dead && p.st === 'play' && p.star === 0 && p.inv === 0) {
      if (bodyR(p) > b.x + 4 && bodyL(p) + 1 < b.x + 28 && p.y > b.y - 28 && p.y - bodyH(p) < b.y) hurt(W, false, 'boss');
    }
  }

  // Claw'd presses the ENTER key (the axe's role): the music stops, the bridge goes
  function touchAxe(W, lv, p) {
    lv.axe.gone = true;
    p.st = 'axe';
    p.t = 0;
    p.vx = 0;
    if (p.vy < 0) p.vy = 0;
    p.jumping = false;
    W.timerOn = false;
    emit(W, 'axe');
    setSong(W, 'none');
    W.seq = { k: 'axe', t: 0, next: lv.def.bridge[1], i: 0 };
  }

  // ------------------------------------------------------------------------------------------
  // The flagpole
  // ------------------------------------------------------------------------------------------
  function grabPole(W, lv, p) {
    const pole = lv.pole;
    const top = p.y - DRAW_H(p);
    const rel = top - pole.topY;
    const score = rel <= 12 ? 5000 : rel <= 36 ? 2000 : rel <= 60 ? 800 : rel <= 80 ? 400 : 100;
    const idx = POPS.indexOf(String(score));
    addScore(W, score);
    // the slide: Claw'd and the flag come down together, at about 3 px a frame, in `frames` frames
    const base = rowTop(9);
    const frames = Math.max(1, Math.ceil((base - p.y) / 3));
    W.slide = { y0: p.y, f0: lv.flagY, frames };
    emit(W, 'flagpole', { height: score, frames });
    setSong(W, 'none');
    W.timerOn = false;
    if (W.live) W.clearTime = W.time; // the clear card's TIME: the clock at the grab
    // fireworks: three for a grab at the very top, otherwise the clock's last digit if it is 1, 3 or 6
    W.fireworks = score === 5000 ? 3 : [1, 3, 6].indexOf(W.time % 10) >= 0 ? W.time % 10 : 0;
    p.st = 'pole';
    p.t = 0;
    p.vx = 0;
    p.vy = 0;
    p.star = 0;
    p.x = pole.tx * 16 + 7 - 8 - HALF_W(p); // the body's right edge against the pole
    p.face = 1;
    p.pose = 'pole1';
    W.poleScore = { v: idx, x: pole.tx * 16 + 22, y: rowTop(9) + 4, yEnd: Math.max(pole.topY + 4, Math.floor(top)) };
    W.seq = { k: 'flag', t: 0 };
  }

  // ------------------------------------------------------------------------------------------
  // Scripted player states (pipes, pole, castle walk, axe, rescue, death)
  // ------------------------------------------------------------------------------------------
  function scripted(W, lv, p, btn) {
    p.t++;
    if (W.goal) goalSeq(W, lv, p);
    if (W.mode !== 'play') return;
    const h = DRAW_H(p);
    switch (p.st) {
      case 'pipeDown':
        p.y += 1;
        if (p.t >= h + 2) {
          p.hide = true;
          p.st = 'pipeGone';
          p.t = 0;
        }
        break;
      case 'pipeGone':
        if (p.t >= PIPE_DARK) enterArea(W, lv.def.pipeDown.to);
        break;
      case 'pipeSide':
        p.x += 1;
        animate(p, 1);
        if (p.t >= 20) {
          p.hide = true;
          p.st = 'pipeGone2';
          p.t = 0;
        }
        break;
      case 'pipeGone2':
        if (p.t >= PIPE_DARK) exitArea(W, lv.def.pipeSide);
        break;
      case 'pipeUp':
        p.y -= 1;
        if (p.y <= lv.pipeUpY) {
          p.y = lv.pipeUpY;
          p.st = 'play';
          p.behind = false;
          land(p);
        }
        break;
      case 'pole':
        flagSeq(W, lv, p);
        break;
      case 'poleHop':
        p.x += p.vx;
        p.vy += 0.25;
        p.y += p.vy;
        if (p.vy > 0 && p.y >= rowTop(10)) {
          p.y = rowTop(10);
          p.st = 'walkCastle';
          p.t = 0;
        }
        break;
      case 'walkCastle': {
        p.vx = 1.25;
        p.face = 1;
        p.x += p.vx;
        p.ground = true;
        animate(p, 1);
        // through the castle door: the door and the wall right of it are drawn over him (30-draw.js),
        // so he is hidden once the drawing's left edge passes the door's left edge
        if (p.x - 4 >= castleDoor(lv)) {
          p.hide = true;
          p.st = 'inCastle';
          p.t = 0;
        }
        break;
      }
      case 'inCastle':
        break;
      case 'axe':
        axeSeq(W, lv, p);
        break;
      case 'walkPearl': {
        // the console runs Claw'd to the princess under the same physics as play (down off the key's
        // platform onto the floor of her room) and skids him to a stop a step short of her
        W.rescueT++;
        const stop = lv.pearl.x - 24;
        const brake = (p.vx * p.vx) / (2 * PH.skidDec);
        const near = p.x + brake >= stop - 2;
        // a run down off the key's platform, easing to a walk for the last steps
        const run = p.x < lv.pearl.x - WALK_IN;
        const b = near ? (p.vx > 0 ? LEFT : 0) : RIGHT | (run ? B : 0);
        const d = b & RIGHT ? 1 : 0;
        if (p.ground) {
          if (d) {
            p.face = 1;
            const maxV = run ? PH.maxRun : PH.maxWalk;
            let v = Math.max(PH.minWalk, p.vx);
            v = v < maxV ? Math.min(maxV, v + (run ? PH.runAcc : PH.walkAcc)) : Math.max(maxV, v - PH.relDec);
            p.vx = v;
          } else if (b & LEFT) {
            p.vx = Math.max(0, p.vx - PH.skidDec);
            p.skid = p.vx > 0;
          } else p.vx = Math.max(0, p.vx - PH.relDec);
        }
        moveX(W, lv, p);
        moveY(W, lv, p, 0);
        animate(p, d);
        if (p.ground && near && p.vx === 0) {
          p.skid = false;
          p.pose = 'idle';
          p.st = 'rescued';
          p.t = 0;
        }
        rescueSeq(W, lv, p);
        endingSeq(W, btn);
        break;
      }
      case 'rescued':
        W.rescueT++;
        rescueSeq(W, lv, p);
        endingSeq(W, btn);
        break;
      case 'dead':
        if (p.t === 30) p.vy = -4;
        if (p.t > 30) {
          p.vy = Math.min(4, p.vy + 0.25);
          p.y += p.vy;
        }
        if (p.t >= DEAD_FRAMES) {
          W.lives--;
          if (W.live) {
            W.retries++;
            emit(W, 'lifelost', { lives: W.lives });
          }
          if (W.lives > 0) enterLives(W, W.live ? lv.def.respawn || mainOf(lv.def) : W.li === 1 ? 0 : W.li);
          else {
            W.mode = 'gameover';
            W.mt = 0;
            if (W.live) {
              emit(W, 'gameover');
              setSong(W, 'gameover');
            }
          }
        }
        break;
    }
  }

  // Down a pipe into another area (film: the coin room). Live: a fresh build of def `key`; the area he
  // left is kept as its parent (W.areas holds at most the two).
  function enterArea(W, key) {
    const parent = W.lv;
    const def = defOf(W, key);
    const lv = track(W, buildLevel(def, W, key));
    if (W.live) W.areas = [parent, lv];
    else W.levels[key] = lv;
    W.lv = lv;
    W.li = key;
    W.cam = 0;
    const s = def.start;
    const p = W.p;
    if (!W.live || s.drop) dropIn(p, s); // the head just clear of the HUD band, in the gap in the ceiling
    else {
      p.x = s.x;
      p.y = s.y;
      p.vx = 0;
      p.vy = 0;
      land(p);
    }
    p.hide = false;
    p.behind = false;
    p.st = 'play';
    p.t = 0;
    W.items = []; W.parts = []; W.pops = []; W.bumps = [];
    if (W.live) {
      W.mainId = mainOf(def);
      W.bgm = def.song;
      levelSong(W, def.kind === 'over' ? 'A' : undefined);
      for (const s2 of CQ.systems) if (s2.enter) s2.enter(W, lv);
    } else setSong(W, lv.def.song);
  }

  // Out of a side pipe (film: back to 1-1 from the coin room): rising from the target's pipeUp. Live: the
  // parent area itself when the pipe leads back to it, otherwise a fresh build (the parent is dropped).
  function exitArea(W, side) {
    const key = side.to;
    let lv;
    if (W.live) {
      const tdef = defOf(W, key);
      const parent = W.areas.length > 1 && W.areas[0].def === tdef ? W.areas[0] : null;
      lv = parent || buildLevel(tdef, W, key);
      W.areas = [lv];
      W.mainId = mainOf(lv.def);
    } else lv = W.levels[key];
    W.lv = lv;
    W.li = key;
    const p = W.p;
    if (W.live && (side.at === 'start' || !lv.def.pipeUp)) {
      // no pipe to rise from: arrive at the area's start
      W.cam = 0;
      if (lv.def.start.drop) dropIn(p, lv.def.start);
      else {
        p.x = lv.def.start.x;
        p.y = lv.def.start.y;
        p.vx = 0;
        p.vy = 0;
        land(p);
      }
      p.hide = false;
      p.behind = false;
      p.st = 'play';
      p.t = 0;
    } else {
      const px = lv.def.pipeUp.tx * 16;
      W.cam = Math.max(0, Math.min(lv.maxCam, px - 96));
      p.x = px + 8;
      p.y = lv.pipeUpY + DRAW_H(p);
      p.vx = 0;
      p.vy = 0;
      p.face = 1;
      p.hide = false;
      p.behind = true;
      p.pose = 'idle';
      p.st = 'pipeUp';
      p.t = 0;
    }
    W.items = []; W.parts = []; W.pops = []; W.bumps = [];
    emit(W, 'pipe');
    if (W.live) {
      W.bgm = lv.def.song;
      levelSong(W, lv.def.kind === 'over' ? 'A' : undefined); // back in the open air: the overworld's hook
      for (const s of CQ.systems) if (s.enter) s.enter(W, lv);
    } else setSong(W, lv.def.song, 'A');
  }

  // the world x of the castle door's left edge (the door is 14 px wide at x 33..46 of the 80 px castle)
  const castleDoor = (lv) => lv.def.castle * 16 + 33;
  CQ.castleDoor = castleDoor;

  const FLIP_FRAMES = 12; // round the pole at its foot before the hop off
  function flagSeq(W, lv, p) {
    const base = rowTop(9); // the top of the block the pole stands on
    const flagEnd = base - 16;
    const ps = W.poleScore;
    if (ps && ps.y > ps.yEnd) ps.y = Math.max(ps.yEnd, ps.y - 3);
    if (W.seq.k === 'flag') {
      // Claw'd and the flag slide together and arrive on the same frame (W.slide.frames after the grab)
      const sl = W.slide;
      const k = Math.min(sl.frames, p.t);
      p.y = sl.y0 + ((base - sl.y0) * k) / sl.frames;
      lv.flagY = sl.f0 + ((flagEnd - sl.f0) * k) / sl.frames;
      p.pose = k < sl.frames && (p.t >> 2) & 1 ? 'pole2' : 'pole1';
      if (k >= sl.frames) {
        // at the pole's foot: the course-clear fanfare starts on this frame
        p.y = base;
        lv.flagY = flagEnd;
        W.seq = { k: 'flip', t: 0 };
        p.x = lv.pole.tx * 16 + 9 - 8 + HALF_W(p); // round the pole: the body's left edge against it
        p.face = -1;
        setSong(W, 'flag');
        W.goal = { t: 0, fw: 0, end: -1, flagT: -1 };
      }
    } else if (W.seq.k === 'flip') {
      if (++W.seq.t >= FLIP_FRAMES) {
        p.st = 'poleHop';
        p.t = 0;
        p.face = 1;
        p.vx = 1;
        p.vy = -1.5;
        p.pose = 'jump';
        p.jumped = true;
        W.seq = null;
      }
    }
  }

  // From the frame Claw'd reaches the pole's foot (t 0, the fanfare's first frame): he swings round the
  // pole, hops off and walks into the castle, and the castle flag climbs its turret, all inside the
  // fanfare's 168 frames; then the clock tallies into the score, then the fireworks burst, then the
  // lives screen for World 1-4.
  const CFLAG_FRAMES = 48; // the castle flag's climb
  const FW_EVERY = 16; // frames between fireworks
  const FW_LIFE = 30; // one firework's frames
  function goalSeq(W, lv, p) {
    const g = W.goal;
    const t = ++g.t;
    const ps = W.poleScore;
    if (ps && ps.y > ps.yEnd) ps.y = Math.max(ps.yEnd, ps.y - 2);
    if (p.hide && g.flagT < 0) g.flagT = t;
    if (g.flagT >= 0) W.castleFlag = Math.min(14, Math.floor(((t - g.flagT) * 14) / CFLAG_FRAMES));
    if (t >= FANFARE && g.end < 0) {
      if (W.time > 0) {
        const n = Math.min(W.time, TALLY_STEP);
        W.time -= n;
        addScore(W, n * 50);
        emit(W, 'tally', { n: W.time });
      } else {
        g.end = t;
        W.poleScore = null;
      }
    }
    if (g.end < 0) return;
    const total = W.fireworks || 0;
    const k = t - g.end;
    if (g.fw < total && k % FW_EVERY === 0) {
      // round the castle (x from its left edge, y the burst's centre), clear of the pole and the HUD band
      const spots = [[-46, 74], [92, 66], [24, 62], [70, 92], [-20, 96], [44, 80]];
      const [dx, dy] = spots[g.fw % spots.length];
      W.parts.push({ k: 'fw', x: lv.def.castle * 16 + dx, y: dy, t: 0 });
      addScore(W, 500);
      emit(W, 'firework');
      // one sky flash, on the first burst only: three full-screen flashes inside a second would sit on
      // the broadcast photosensitivity limit (no more than three flashes in any one second)
      if (g.fw === 0) flash(W, FLASH_PALE, 1);
      g.fw++;
    }
    if (k >= (total ? (total - 1) * FW_EVERY + FW_LIFE : 0) + TALLY_HOLD) {
      W.goal = null;
      if (W.live) enterClear(W); // the clear card, then the lives screen for def.next
      else enterLives(W, 2);
    }
  }

  function axeSeq(W, lv, p) {
    const s = W.seq;
    s.t++;
    const [b0, b1] = lv.def.bridge;
    // a press made in the air comes down onto the key's platform first
    if (!p.ground) {
      moveY(W, lv, p, 0);
      p.pose = p.ground ? 'idle' : 'jump';
    }
    if (s.t === 1) {
      // the chain goes first
      for (let tx = b0; tx <= b1 + 1; tx++) if (cell(lv, tx, 7) === CHAIN) setCell(lv, tx, 7, DOT);
    }
    if (s.k === 'axe') {
      if (s.t === 12) p.face = -1; // he turns to watch the bridge go
      if (s.t >= 12 && (s.t - 12) % 4 === 0) {
        if (s.next >= b0) {
          setCell(lv, s.next, 8, DOT);
          emit(W, 'bridge', { i: s.i });
          s.i++;
          s.next--;
        } else {
          s.k = 'fall';
          s.t = 0;
          // a boss already beaten by carets (live) has no fall of its own
          if (lv.boss && !lv.boss.gone && !lv.boss.dead) {
            lv.boss.fall = true;
            lv.boss.vy = 0;
            W.stats.bugs++;
            emit(W, 'bossfall');
          }
        }
      }
    } else if (s.k === 'fall') {
      // the boss's fall has 64 frames to itself; then the rescue song and the run to Pearl. With the boss
      // already beaten (live) the rescue starts 16 frames after the last bridge tile (this state begins 4
      // frames after it)
      if (s.t >= (lv.boss && lv.boss.dead ? 12 : 64)) {
        W.seq = null;
        setSong(W, 'rescue');
        lv.camCap = null;
        p.st = 'walkPearl';
        p.t = 0;
        W.rescueT = 0;
      }
    }
  }

  // The rescue, in frames from the rescue song's first frame (two bars of 144): Claw'd runs to Pearl in
  // bar 1 while she waves him in; bar 2 is the meeting (a heart rises between them, they hop together
  // twice, he throws his claws up); the ending text starts on the next bar.
  const MEET = 144, HOP2 = 172, WAVE = 40, TEXT_AT = 288;
  const WALK_IN = 120; // px before Pearl where the run eases to a walk
  CQ.RESCUE = { MEET, TEXT_AT };
  function hop(o) {
    o.vy = -2.5;
    o.hopping = true;
  }
  function rescueSeq(W, lv, p) {
    const t = W.rescueT;
    const pl = lv.pearl;
    if (p.st === 'rescued' && (t === MEET || t === HOP2 || (t > MEET && !pl.met))) {
      if (!pl.met) {
        pl.met = true;
        W.parts.push({ k: 'heart', x: Math.floor((p.x + 8 + pl.x + 8) / 2) - 4, y: rowTop(10) - 34, t: 0, life: TEXT_AT - MEET - 20 });
      }
      p.vy = -2.5;
      p.ground = false;
      p.jumping = false;
      p.gFall = 0.25;
      p.pose = 'jump';
      p.jumped = true;
      hop(pl);
    }
    if (p.st === 'rescued' && !p.ground) {
      moveY(W, lv, p, 0);
      if (p.ground) p.pose = p.big ? 'victory' : 'idle';
    }
    if (pl.hopping) {
      pl.vy += 0.25;
      pl.hy = (pl.hy || 0) - pl.vy;
      if (pl.hy <= 0) {
        pl.hy = 0;
        pl.vy = 0;
        pl.hopping = false;
      }
    }
    pl.wave = t >= WAVE;
    if (t === TEXT_AT) W.ending = { t: 0, lines: endingLines(W) };
  }

  // The ending: Pearl's line, then a completion summary typed on at one frame a character with the
  // run's own counts, then PUSH START TO SHIP IT blinking. One `text` event per line (every = 1).
  const CHAR_FRAMES = 1, PEARL_GAP = 30, LINE_GAP = 10, PUSH_GAP = 24;
  // the film's five lines; live play's seven (docs/game-spec.md 9.4): tokens and retries join the summary
  function endingLines(W) {
    if (!W.live) return ["YOU DID IT, CLAW'D!", '✻ QUEST COMPLETE', '✓ ' + W.stats.bugs + ' BUGS SQUASHED', '✓ ' + W.stats.coins + ' COINS', '✓ ALL TESTS PASS'];
    const r = W.retries | 0;
    return [
      "YOU DID IT, CLAW'D!", '✻ QUEST COMPLETE', '✓ ' + W.stats.bugs + ' BUGS SQUASHED', '✓ ' + W.stats.coins + ' COINS',
      '✓ ' + tokenCount(W) + '/' + TOKENS_MAX + ' TOKENS', r === 0 ? '✓ NO RETRIES' : '✓ ' + r + ' RETRIES', '✓ ALL TESTS PASS',
    ];
  }
  CQ.endingLines = endingLines;
  function endingTimes(lines) {
    const starts = [];
    let t = 0;
    lines.forEach((l, i) => {
      starts.push(t);
      t += l.length * CHAR_FRAMES + (i === 0 ? PEARL_GAP : LINE_GAP);
    });
    return { starts, push: t - LINE_GAP + PUSH_GAP };
  }
  CQ.endingTimes = endingTimes;
  function endingSeq(W, btn) {
    const e = W.ending;
    if (!e) return;
    if (!e.times) e.times = endingTimes(e.lines);
    const t = e.t++;
    const i = e.times.starts.indexOf(t);
    if (i >= 0) {
      if (i === 0) {
        if (W.live) {
          // the looping ending plays under the text (the credits start their own song)
          setSong(W, 'ending-full');
          emit(W, 'complete', { score: W.score, tokens: tokenCount(W), retries: W.retries | 0 });
        } else setSong(W, 'ending');
      }
      emit(W, 'text', { i, line: e.lines[i], every: CHAR_FRAMES });
    }
    if (W.live && t > e.times.push + 60 && btn & START & ~W.prev) enterCredits(W);
  }
  function endingState(W) {
    const e = W.ending;
    if (!e || !e.times) return null;
    const t = e.t - 1;
    const chars = e.times.starts.map((s, i) => Math.max(0, Math.min(e.lines[i].length, Math.floor((t - s) / CHAR_FRAMES) + 1)));
    const push = t >= e.times.push ? ((t - e.times.push) % 48 < 32 ? 1 : 0) : -1;
    return { lines: e.lines, chars, push };
  }

  // ------------------------------------------------------------------------------------------
  // Snapshot: the compact per-frame record the draw pass paints
  // ------------------------------------------------------------------------------------------
  // spr is a flat Int16Array of [name, x, y, flags, pal] in world px. flags: 1 flip, 2 flip vertical,
  // 4 behind the tiles, 8 hidden-by-castle layer (drawn before the castle). name >= 1000 is a score
  // pop (CQ.POPS[name - 1000]). pal: 0 normal, 1.. the star cycle.
  const NAMES = [];
  const NI = new Map();
  function ni(name) {
    let i = NI.get(name);
    if (i === undefined) {
      i = NAMES.length;
      NAMES.push(name);
      NI.set(name, i);
    }
    return i;
  }
  CQ.NAMES = NAMES;
  CQ.ni = ni;

  // C (the multi-coin brick) draws as its kind's brick; the sky kind is the game's (docs/game-spec.md 9.2)
  const TILE_NAMES = {
    over: { '#': 't_ground', B: 't_brick', U: 't_used', X: 't_stair', C: 't_brick' },
    under: { '#': 't_groundU', G: 't_groundU', B: 't_brickU', W: 't_brickU', U: 't_used', X: 't_stair', C: 't_brickU' },
    castle: { '#': 't_groundC', f: 't_groundC', w: 't_brickC', U: 't_used', X: 't_groundC', '=': 't_bridge', B: 't_brickC', C: 't_brickC' },
    sky: { '#': 't_cloudTop', B: 't_brick', C: 't_brick', U: 't_used', X: 't_stair', T: 't_rackTop', R: 't_rack' },
  };
  CQ.TILE_NAMES = TILE_NAMES;
  const MODE_CODE = { title: 0, title2: 0, lives: 1, play: 2, gameover: 3, pause: 4, continue: 5, clear: 6, credits: 7 };
  CQ.MODE_CODE = MODE_CODE;

  // Sprite entries anchor at the feet so any drawing size stands right: flag 32 means x is the body
  // centre and y the feet; 64 means x is where the drawing's right edge meets (the flagpole), 128 its
  // left edge. The draw pass reads each drawing's size from FILM.SPRITE_MANIFEST.
  const ANCHOR_FEET = 32, ANCHOR_RIGHT = 64, ANCHOR_LEFT = 128;
  CQ.ANCHOR = { FEET: ANCHOR_FEET, RIGHT: ANCHOR_RIGHT, LEFT: ANCHOR_LEFT };
  // palette slots: 1-4 the Claude spark cycle (lib.SPAL.clawdStar), 5 and 6 the underground bugs
  CQ.PAL_BUG_U = 5;
  CQ.PAL_SHELLBUG_U = 6;
  // every palette slot and flag a snapshot sprite can carry (docs/game-spec.md 2.4 and 2.6)
  const PAL = Object.freeze({ STAR1: 1, BUG_U: 5, SHELLBUG_U: 6, CODE: 7, LIFE: 8, BOSS_HIT: 9, MOTH_U: 10, SPIKE_U: 11, FRAG_U: 12 });
  const FLAG = Object.freeze({ FLIP: 1, FLIPV: 2, BEHIND: 4, BUMP: 16, FEET: 32, RIGHT: 64, LEFT: 128, FLICKER: 256 });
  CQ.PAL = PAL;
  CQ.FLAG = FLAG;

  function playerSprite(W, out) {
    const p = W.p;
    if (p.hide) return;
    if (p.inv > 0 && (p.inv >> 1) & 1) return;
    const vf = W.vf;
    let name;
    if (p.growT >= 0) {
      const c = GROW_SEQ[Math.min(GROW_SEQ.length - 1, Math.floor(p.growT / 5))];
      name = c === 'S' ? 'clawdS_idle' : c === 'M' ? 'clawdM_grow' : 'clawdB_idle';
    } else if (p.st === 'dead') {
      name = 'clawdS_dead';
    } else if (W.live && p.throwT > 0 && p.big && p.st === 'play') {
      name = 'clawdB_throw'; // a caret thrown: one nub thrust forward
    } else {
      let pose = p.pose === 'victory' && !p.big ? 'idle' : p.pose;
      // idle life: standing still, Claw'd blinks for 8 frames every 3 seconds
      if (pose === 'idle' && vf % 180 < 8) pose = 'blink';
      name = (p.big ? 'clawdB_' : 'clawdS_') + pose;
    }
    let flags = p.face < 0 ? 1 : 0;
    if (p.behind) flags |= 4;
    let pal = 0;
    if (p.star > 0) {
      const rate = p.star < STAR_SLOW ? 4 : 2;
      pal = 1 + (Math.floor(vf / rate) % 4);
    } else if (W.live && W.freeze > 0 && W.freezeK === 'code') {
      pal = PAL.CODE; // the terminal's hold: flickering into the code palette
      flags |= FLAG.FLICKER;
    } else if (W.live && p.code && p.big) pal = PAL.CODE;
    let x = Math.floor(p.x) + 8;
    if (p.pose === 'pole1' || p.pose === 'pole2') {
      // on the pole the grip hand is at the drawing's edge: stand the drawing against the pole's pixels
      const pole = W.lv.pole;
      if (p.face > 0) {
        x = pole.tx * 16 + 7;
        flags |= ANCHOR_RIGHT;
      } else {
        x = pole.tx * 16 + 9;
        flags |= ANCHOR_LEFT;
      }
    } else flags |= ANCHOR_FEET;
    out.push(ni(name), x, Math.floor(p.y), flags, pal);
  }

  // a firework burst centred on (x, y): one star, then a ring, then a wide double ring (48 px across)
  const FW_RING1 = [[-10, 0], [10, 0], [0, -10], [0, 10]];
  const FW_RING2 = [[-13, -13], [13, -13], [-13, 13], [13, 13]];
  const FW_RING3 = [[-22, 0], [22, 0], [0, -22], [0, 22]];
  function fireworkSprites(q, out) {
    const x = q.x - 8, y = q.y - 8;
    const put = (n, dx, dy) => out.push(ni('firework' + n), x + dx, y + dy, 0, 0);
    if (q.t < 6) put(1, 0, 0);
    else if (q.t < 14) {
      put(2, 0, 0);
      for (const [dx, dy] of FW_RING1) put(1, dx, dy);
    } else if (q.t < 22) {
      put(3, 0, 0);
      for (const [dx, dy] of FW_RING1) put(2, dx, dy);
      for (const [dx, dy] of FW_RING2) put(1, dx, dy);
    } else {
      for (const [dx, dy] of FW_RING2) put(3, dx, dy);
      for (const [dx, dy] of FW_RING3) put(q.t & 2 ? 2 : 1, dx, dy);
    }
  }

  // docs/game-spec.md 8. s.f is the visual clock (W.vf - 1; the film's W.vf === W.f), and every animation
  // below reads it, so a paused frame stands still. Modes 1, 3, 5, 6 and 7 carry an empty spr; mode 4
  // (pause) carries the frozen play record.
  function snapshot(W) {
    const live = !!W.live;
    const areaDef = W.mode === 'lives' ? defOf(W, W.pending) : W.lv ? W.lv.def : null;
    const main = areaDef ? mainOf(areaDef) : '';
    const inPlay = W.mode === 'play' || W.mode === 'pause';
    const s = {
      m: MODE_CODE[W.mode], f: W.vf - 1, btn: W.btn, score: W.score, coins: W.coins, lives: W.lives, top: W.top,
      world: W.world, time: inPlay ? W.time : -1,
      lv: W.lv, chg: W.lv ? W.lv.changes.length : 0, cam: W.cam, lt: W.lv ? W.lv.t : 0,
      spr: null, hide: null, cflag: W.castleFlag, flagY: W.lv ? W.lv.flagY : 0, end: endingState(W),
      title: W.mode === 'title' || W.mode === 'title2' ? { started: W.mode === 'title2', mt: W.mt } : null,
      flash: W.flashN > 0 ? W.flashC : 0, door: -1,
      live, shell: live && !!W.shellMenu, pausable: pausable(W),
      lid: areaDef ? String(areaDef.id) : '', main: String(main), name: areaDef && areaDef.name ? String(areaDef.name) : '',
      tokens: live ? W.tokens[main] | 0 : 0, tokenTotal: live ? tokenCount(W) : 0,
      clear: live && W.mode === 'clear' && W.clear ? Object.assign({}, W.clear) : null,
      cont: live && W.mode === 'continue' && W.cont ? { sel: W.cont.sel } : null,
      credits: live && W.mode === 'credits' && W.credits ? Object.assign({}, W.credits) : null,
    };
    if (!inPlay && W.mode !== 'title' && W.mode !== 'title2') {
      s.spr = new Int16Array(0);
      return s;
    }
    const lv = W.lv;
    const p = W.p;
    const out = [];
    const f = W.vf;
    if (lv.def.castle && p.st === 'walkCastle') s.door = castleDoor(lv);
    // behind-the-tiles sprites first: sprouting items, the player in a pipe, the boss in the lava
    for (const it of W.items) {
      const name = it.k === 'mushroom' || it.k === 'life' ? 'mushroom' : it.k === 'terminal' ? 'terminal' : 'spark' + (1 + ((f >> 2) & 3));
      out.push(ni(name), Math.floor(it.x), Math.floor(it.y) - 16, it.st === 'sprout' ? 4 : 0, it.k === 'life' ? PAL.LIFE : 0);
    }
    // the level's decorations (torches flicker, each on its own beat)
    if (lv.def.decor) {
      lv.def.decor.forEach((d, i) => {
        const name = d.n === 'torch' ? 'torch' + (1 + (((f + i * 5) >> 3) & 1)) : d.n;
        out.push(ni(name), d.x, d.y, 0, 0);
      });
    }
    // the checkpoint post (live), in the main level only: its flag flies once passed
    if (live && lv.def.mid && mainOf(lv.def) === lv.def.id) {
      const m = lv.def.mid;
      const on = !!(W.mid && W.mid.id === lv.def.id);
      out.push(ni(on ? 'ckpt_on' : 'ckpt_off'), m.tx * 16, rowTop(m.row) - 32, 0, 0);
    }
    // lava bubbles rise and pop on every third lava column, each on its own clock. Live: an ember's column
    // boils only as its tell (src/game/13-platforms.js), so a bubble there always means a leap is coming
    for (const c of lv.lavaCols) {
      if (c % 3 !== 1) continue;
      if (live && lv.emberCols && lv.emberCols.indexOf(c) >= 0) continue;
      const k = (lv.t + c * 37) % 80;
      if (k < 24) out.push(ni(k < 14 ? 'bubble1' : 'bubble2'), c * 16 + 4, rowTop(10) - 4 - (k >> 2), 0, 0);
    }
    if (lv.pole) out.push(ni('flag'), lv.pole.tx * 16 + 7 - 16, Math.floor(lv.flagY), 0, 0);
    if (lv.axe) {
      // the ENTER key; once pressed it stays down, dark
      if (!lv.axe.gone) out.push(ni('axe' + (1 + (Math.floor(f / 10) % 3))), lv.axe.tx * 16, rowTop(lv.axe.ty), 0, 0);
      else out.push(ni('axe1'), lv.axe.tx * 16, rowTop(lv.axe.ty) + 2, 0, 0);
    }
    if (lv.pearl) {
      const pl = lv.pearl;
      const wave = pl.wave && Math.floor(f / 16) % 2 === 1;
      out.push(ni(wave ? 'pearl_wave' : 'pearl'), pl.x, pl.y - 24 - Math.round(pl.hy || 0), 0, 0);
    }
    for (const e of lv.ents) {
      if (e.st === 'wait' || e.st === 'gone') continue;
      if (e.x < W.cam - 32 || e.x > W.cam + 336) continue;
      const K = kindOf(W, e);
      if (K) {
        // a live kind draws itself: [name, drawHeight, flags, pal]
        const r = K.sprite(W, lv, e, f);
        if (!r) continue;
        out.push(ni(r[0]), Math.floor(e.x), Math.floor(e.y) - r[1], (r[2] | 0) | (e.st === 'dead' ? FLAG.FLIPV : 0), r[3] | 0);
        continue;
      }
      let name, h, flags = 0;
      if (e.st === 'flat') {
        name = 'bug_flat';
        h = 8;
      } else if (e.kind === 'bug') {
        // the enemy drawings face left (at the player); mirrored when walking right
        name = e.st === 'dead' ? 'bug_walk1' : (e.t >> 3) & 1 ? 'bug_walk2' : 'bug_walk1';
        h = 16;
        if (e.vx > 0) flags |= 1;
      } else if (e.kind === 'shellbug') {
        name = e.st === 'dead' ? 'shellbug_walk1' : (e.t >> 3) & 1 ? 'shellbug_walk2' : 'shellbug_walk1';
        h = 16;
        if (e.vx > 0) flags |= 1;
      } else {
        name = 'shell';
        h = 16;
      }
      if (e.st === 'dead') flags |= 2;
      const under = lv.def.kind === 'under';
      const epal = !under ? 0 : e.kind === 'bug' ? CQ.PAL_BUG_U : CQ.PAL_SHELLBUG_U;
      out.push(ni(name), Math.floor(e.x), Math.floor(e.y) - h, flags, epal);
    }
    const b = lv.boss;
    if (b && !b.gone && (b.active || b.x < W.cam + 336)) {
      // it looks down as the bridge goes under it, and roars as it drops into the lava (behind its surface)
      const collapsing = W.seq && W.seq.k === 'axe';
      const name = collapsing || (b.fall && b.vy < 1.5 && !b.lava) ? 'boss_look' : b.roar > 0 || b.air || b.fall ? 'boss_roar' : (b.t >> 4) & 1 ? 'boss_walk2' : 'boss_walk1';
      let flags = (b.face > 0 ? 1 : 0) | (b.fall ? 4 : 0);
      let pal = 0;
      if (b.flip) flags |= FLAG.FLIPV; // beaten: it falls upside down
      if (b.hitT > 0) {
        pal = PAL.BOSS_HIT; // a caret hit: it flickers white
        flags |= FLAG.FLICKER;
      }
      out.push(ni(name), Math.floor(b.x), Math.floor(b.y) - 32, flags, pal);
    }
    for (const sy of systemsOf(W)) if (sy.sprites) sy.sprites(W, lv, out, f);
    playerSprite(W, out);
    for (const fb of lv.firebars) {
      const k = 1 + ((f >> 2) & 3);
      for (const [bx, by] of firebarBalls(fb, lv.t)) out.push(ni('fireball' + k), bx, by, 0, 0);
    }
    const fragPal = live && lv.def.kind === 'under' ? PAL.FRAG_U : 0;
    for (const q of W.parts) {
      if (q.k === 'coin') out.push(ni('coinpop' + (1 + ((q.t >> 1) & 3))), Math.floor(q.x), Math.floor(q.y), 0, 0);
      else if (q.k === 'frag') out.push(ni((q.t >> 2) & 1 ? 'fragment2' : 'fragment1'), Math.floor(q.x), Math.floor(q.y), q.flip ? 1 : 0, fragPal);
      else if (q.k === 'fw') fireworkSprites(q, out);
      else if (q.k === 'splash') { if (q.t >= 0) out.push(ni('splash' + (1 + Math.min(2, q.t >> 3))), q.x - 8, q.y, 0, 0); }
      else if (q.k === 'heart') out.push(ni((q.t >> 3) & 1 ? 'heart2' : 'heart1'), q.x, Math.floor(q.y), 0, 0);
    }
    // score pops (x is the centre); not during the grow pause, when the world holds still
    if (W.freeze === 0) for (const sp of W.pops) out.push(1000 + sp.v, sp.x, Math.floor(sp.y), 0, 0);
    if (W.poleScore) out.push(1000 + W.poleScore.v, W.poleScore.x, Math.floor(W.poleScore.y), 0, 0);
    // bumped blocks ride above their cell for a few frames
    if (W.bumps.length) {
      s.hide = [];
      const names = TILE_NAMES[lv.def.kind] || TILE_NAMES.over;
      for (const bp of W.bumps) {
        s.hide.push(bp.ty * lv.w + bp.tx);
        const ch = String.fromCharCode(bp.code);
        out.push(ni(names[ch] || 't_used'), bp.tx * 16, rowTop(bp.ty) + BUMP_DY[bp.t], 16, 0);
      }
    }
    s.spr = Int16Array.from(out);
    return s;
  }
  CQ.snapshot = snapshot;

  // ------------------------------------------------------------------------------------------
  // The seam: the kit the 1x modules may use (docs/game-spec.md 2.4). Nothing else is theirs.
  // ------------------------------------------------------------------------------------------
  CQ.K = Object.freeze({
    Q, PH, BUTTONS, rowTop, rowOf, cell, solidAt, headAt, setCell,
    bodyL, bodyR, bodyH, drawH: DRAW_H,
    emit, setSong, addScore, pop, popOf,
    comboPoints, hurt,
    nudgeX,
  });
})();
