// game/01-world1.js : World 1 of the game, THE CLAUDE QUEST (docs/game-spec.md 4). Owner: P3.
//
// CQ.GAME_DEFS is the game's level table, keyed by id; CQ.GAME_ORDER lists the four main levels in play
// order (CONTINUE and progress read it). The film's table (CQ.LEVEL_DEFS, game/00-levels.js) is never
// edited: 1-1 and its coin room reuse the film's row and scenery arrays by reference and only overlay
// the game's fields (a name, routing by id, a checkpoint, token overlays), so the recorded tape still
// plays 1-1 as the attract demo.
//
// Grid: 16 px tiles, 12 rows; row r has its top at y = 16r - 12, the ground rows 10 and 11 fill y 148..180
// and rows 0 to 2 stay empty (the HUD band). Every map below is checked by tools/levels-lint.cjs (F1 to
// F8 and the static rules of docs/game-spec.md 13.6) and played start to finish by the level bots in
// tools/proof/levels.cjs, in both feel modes.
//
// Legend additions (docs/game-spec.md 4.2), besides the film's (game/00-levels.js):
//   N  ? block holding a 1UP          +  hidden 1UP block (head bumps only)   C  multi-coin brick
//   S  spring (a solid tile)           T  server-rack cap (sky, solid)          R  server-rack body (sky, background)
//   #  (sky) cloud walkway             B  (castle) breakable castle brick
//   m  moth   n  hover moth   s  spike beetle   t  token (numbered by column from def.tokenBase)
(function () {
  'use strict';
  const FILM = (window.FILM = window.FILM || {});
  const CQ = (FILM.__cq = FILM.__cq || {});
  const FILM11 = CQ.LEVEL_DEFS[0];
  const BONUS = CQ.LEVEL_DEFS[1];

  // ---------------------------------------------------------------------------------------------
  // 1-2 THE STACK (underground, 204 tiles). Left to right: the drop-in hall (?M? at 12-14); the stack
  // columns (2, 3 and 4 high at 24, 28-29 and 31, capped with coins); the spike trench (a beetle trapped
  // between the kerbs at 42 and 47 under a row of four coins, a second one patrolling 48-55 under a ?);
  // the twin corridors (a brick deck 58-73 over a line of bugs: coins, the hidden 1UP at 67 and a token
  // on top, the multi-coin brick at 71 from below); the checkpoint (82), two ? blocks and the cellar pipe
  // (90); shell alley (a shell-bug to kick down a line of bugs, rebounding off the pipe at 128, a moth at
  // head height); the island hop (three islands over three pits, a beetle sentry on the middle one); the
  // elevator (two vertical lifts in opposite phase over the pit 152-163, a token past the second); the
  // exit hall (two ? blocks, two bugs, the sideways exit pipe at 200). Where this map differs from the
  // spec's printed one (the h4 column, the trench kerbs) and why: tools/levels-lint.cjs, CHANGES.
  // ---------------------------------------------------------------------------------------------
  const W12 = [
    /* 0*/ '............................................................................................................................................................................................................',
    /* 1*/ '............................................................................................................................................................................................................',
    /* 2*/ '............................................................................................................................................................................................................',
    /* 3*/ 'W..WWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWW{}',
    /* 4*/ 'W.............................ooo.......................................t.........................................................................................t.......................................{}',
    /* 5*/ 'W...........................oo.............oooo.............ooooo..+.ooo..................................................................................................................................{}',
    /* 6*/ 'W...........?M?.........o......W...................?..................................??...................B?B.........................................................................?..?...............{}',
    /* 7*/ 'W...........................WW.W..........................BBBBBBBBBBBBBCBB............................................m...............ooo...........................WWWWWWWWWWWW..........................{}',
    /* 8*/ 'W.......................W...WW.W........................W.................................[]............ooo.....................[]..................................WWWWWWWWWWWW........................h-j}',
    /* 9*/ 'W................g......W.g.WW.W..g..g....W..s.W.....s..W.....g.g.g.......................{}.....k............g.g.g.g...k...g.g.{}..............s...................WWWWWWWWWWWW.....g..g...............H_J}',
    /*10*/ '######################################################################################################################################...###...###...###............########################################',
    /*11*/ '######################################################################################################################################...###...###...###............########################################',
  ];

  // 1-2b STACK OVERFLOW, the cellar: 15 coins in a 5x3 block, a token over the GG step, out by the side pipe
  const W12B = [
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
  ];

  // 1-2x the exit yard: up out of a pipe into daylight, a five-step stair to a 4-wide top, the flagpole
  const W12X = [
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
  ];

  // ---------------------------------------------------------------------------------------------
  // 1-3 THE CLOUD (sky, 191 tiles, bottomless). Server-rack towers (T caps, R bodies) over a light sky:
  // first steps up two towers; the spring on a low tower (held A: up onto the cloud bank and its token);
  // the drift lift H1; the moth gap; the checkpoint rack; the falling packets; the twin elevators up to
  // the high tower; tower bowling with a shell; the moth swarm over the drift lift H2; the goal cloud.
  // ---------------------------------------------------------------------------------------------
  const W13 = [
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
  ];

  // ---------------------------------------------------------------------------------------------
  // 1-4 THE KERNEL (castle, 176 tiles). Cols 0-47 are the film's entrance cell for cell (an ember in each
  // pit in live play); the compile hall (a 10-ball floor firebar at 55, a short ceiling bar at 61); the
  // lava lake and its drift lift; the safe room (checkpoint, M?, the hidden 1UP); the spike gallery under
  // a low ceiling (bricks at 104-105 hiding a pocket, big only); the ember pillars (one tile high); the
  // bridge, the Big Bug, the ENTER key and Pearl's room. The long floor bar turns clockwise, so it rises in
  // front of him and he follows it under (tools/levels-lint.cjs, DEF_CHANGES).
  // ---------------------------------------------------------------------------------------------
  const W14G = [
    /* 0*/ '................................................................................................................................................................................',
    /* 1*/ '................................................................................................................................................................................',
    /* 2*/ '................................................................................................................................................................................',
    /* 3*/ 'wwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwww..................ww',
    /* 4*/ 'wwwwwwwwwwwwwwwwwwwwwwww..........wwwwww........wwwwwwwwwwwwwwww................................wwwwwwwwoowwwwwwwwwwwwww......................................................ww',
    /* 5*/ '..........wwwwwwww..................ww.......................f..........t.......................wwwwwwwwotwwwwwwwwwwwwww..........t...........................................ww',
    /* 6*/ '...........................f................f........................................M?....+....wwwwwwwwBBwwwwwwwwwwwwww......................................................ww',
    /* 7*/ '#####....................................................................................................................................................%..A.................ww',
    /* 8*/ '#####...................................................................................................................................####==============###.................ww',
    /* 9*/ '#####..................................................f............................................s.......s.....s..........##...##....####..............###............p....ww',
    /*10*/ '##################LLL###############LL############################LLLLLLLLLLLLLL##########################################LLL##LLL##LLL#####LLLLLLLLLLLLLL######################',
    /*11*/ '##################lll###############ll############################llllllllllllll##########################################lll##lll##lll#####llllllllllllll######################',
  ];

  const DEFS = {
    // 1-1 HELLO, WORLD: the film's map, rows and scenery by reference (not a character changes)
    '1-1': Object.assign({}, FILM11, {
      name: 'HELLO, WORLD', main: '1-1', next: '1-2',
      pipeDown: { tx: 134, to: '1-1b' },
      mid: { tx: 80, row: 10 }, // before the star run
      tokens: [[66, 3, 0], [176, 3, 1]], // over the brick canopy; over the high platform
    }),
    '1-1b': Object.assign({}, BONUS, {
      id: '1-1b', name: 'HELLO, WORLD', main: '1-1', respawn: '1-1',
      pipeSide: { tx: 15, row: 8, to: '1-1', at: 'pipeUp' },
      tokens: [[10, 4, 2]], // over the hump
    }),
    '1-2': {
      id: '1-2', name: 'THE STACK', world: '1-2', kind: 'under', rows: W12, time: 400, song: 'underground',
      start: { x: 20, y: 36, drop: true }, mid: { tx: 82, row: 10 },
      pipeDown: { tx: 90, to: '1-2b' }, pipeUp: { tx: 128 },
      pipeSide: { tx: 200, row: 8, to: '1-2x', at: 'pipeUp' },
      lifts: [
        { k: 'v', tx: 154, w: 3, y0: 100, y1: 148, speed: 0.5, phase: 0 }, // V1 (every hop across the pit is 2 tiles)
        { k: 'v', tx: 159, w: 3, y0: 84, y1: 132, speed: 0.5, phase: 48 }, // V2, opposite phase
      ],
    },
    '1-2b': {
      id: '1-2b', name: 'THE STACK', world: '1-2', kind: 'under', rows: W12B, time: 0, song: 'underground',
      main: '1-2', respawn: '1-2', start: { x: 20, y: 36, drop: true },
      pipeSide: { tx: 15, row: 8, to: '1-2', at: 'pipeUp' }, tokenBase: 2,
    },
    '1-2x': {
      id: '1-2x', name: 'THE STACK', world: '1-2', kind: 'over', rows: W12X, time: 0, song: 'overworld',
      main: '1-2', respawn: '1-2', next: '1-3', pipeUp: { tx: 2 }, pole: 20, castle: 26,
      start: { x: 72, y: 148 }, // never used by the routing (he rises from pipe 2); a direct start stands clear of it
      scenery: [['cloud2', 5, 44], ['cloud1', 27, 40], ['bush2', 22]],
    },
    '1-3': {
      id: '1-3', name: 'THE CLOUD', world: '1-3', kind: 'sky', rows: W13, time: 400, song: 'sky', next: '1-4',
      start: { x: 40, y: 148 }, mid: { tx: 82, row: 9 }, pole: 180, castle: 186,
      lifts: [
        { k: 'h', tx: 51, y: 116, w: 3, x1: 928, speed: 1, phase: 0 }, // H1, 112 px
        { k: 'fall', tx: 90, y: 132, w: 3 }, { k: 'fall', tx: 94, y: 116, w: 3 },
        { k: 'fall', tx: 98, y: 132, w: 3 }, { k: 'fall', tx: 102, y: 116, w: 3 },
        { k: 'v', tx: 112, w: 3, y0: 84, y1: 132, speed: 0.5, phase: 0 }, // V1
        { k: 'v', tx: 117, w: 3, y0: 68, y1: 116, speed: 0.5, phase: 48 }, // V2, opposite phase
        { k: 'h', tx: 149, y: 116, w: 3, x1: 2480, speed: 1, phase: 0 }, // H2, 96 px
      ],
      scenery: [['cloud3', 2, 40], ['cloud1', 16, 56], ['cloud2', 30, 44], ['cloud3', 54, 64], ['cloud1', 78, 40],
        ['cloud2', 96, 52], ['cloud3', 118, 44], ['cloud1', 138, 60], ['cloud2', 160, 40], ['cloud3', 176, 52], ['bush3', 1]],
    },
    '1-4': {
      id: '1-4', name: 'THE KERNEL', world: '1-4', kind: 'castle', rows: W14G, time: 400, song: 'castle',
      start: { x: 24, y: 100 }, mid: { tx: 82, row: 10 },
      bridge: [140, 153], axe: 156, boss: { tx: 150, range: [142, 151], hp: 5 }, bossSong: 'boss', camLock: 2208,
      firebars: [
        { tx: 27, ty: 6, dir: 1, phase: 0, step: 4 }, { tx: 44, ty: 6, dir: -1, phase: 24, step: 3 }, // the film's two
        { tx: 55, ty: 9, n: 10, dir: 1, phase: 8, step: 5 }, { tx: 61, ty: 5, dir: -1, phase: 16, step: 3 }, // the long bar turns clockwise
      ],
      lifts: [{ k: 'h', tx: 67, y: 116, w: 3, x1: 1184, speed: 1, phase: 0 }], // 112 px, 3 tiles short of the far shore
      embers: [
        // the first pit teaches the ember: a lower leap (vy -4, apex feet 121) that a running jump clears,
        // its first leap (lv.t 55) shown while he drops off the entry platform; every leap has its tell
        { tx: 19, period: 180, phase: 125, vy: -4 }, { tx: 36, period: 180, phase: 0 },
        { tx: 69, period: 150, phase: 0 }, { tx: 75, period: 150, phase: 75 },
        { tx: 123, period: 120, phase: 0 }, { tx: 128, period: 120, phase: 40 }, { tx: 133, period: 120, phase: 80 },
      ],
      decor: [
        { n: 'torch', x: 196, y: 100 }, { n: 'torch', x: 548, y: 92 }, { n: 'torch', x: 1348, y: 100 }, { n: 'torch', x: 1508, y: 100 },
        // Pearl's room: each torch sits under its banner (mirrored), so the left one stays out of the
        // ending text's column (screen x 85 and up at the ending camera, 2496)
        { n: 'banner', x: 2548, y: 44 }, { n: 'banner', x: 2764, y: 44 }, { n: 'torch', x: 2562, y: 100 }, { n: 'torch', x: 2758, y: 100 },
      ],
    },
  };

  CQ.GAME_DEFS = DEFS;
  CQ.GAME_ORDER = ['1-1', '1-2', '1-3', '1-4'];
})();
