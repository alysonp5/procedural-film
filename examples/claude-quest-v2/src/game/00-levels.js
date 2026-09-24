// game/00-levels.js : the three maps of Claude Quest (World 1-1, the coin room, World 1-4) as ASCII.
// Owner: game. Read by game/10-engine.js (physics, entities) and game/30-draw.js (tiles, scenery).
//
// Grid: 16 px tiles, 12 rows. Row r has its top at y = 16r - 12 in the native 320x180 frame, so the
// two ground rows (r10, r11) fill y 148..180 and r3 (y 36..52) is the first row below the 32 px HUD
// band; r0-r2 stay empty. Height above the ground: r9 = h1 ... r6 = h4 (the low ? row) ... r3 = h7.
//
// Legend (every level)            | overworld          | underground        | castle
//   .  air                        | #  ground          | G  floor           | #  floor block
//   B  brick (breaks when big)    | B  brick           | W  brick / wall    | w  wall brick
//   ?  ? block: a coin            | X  hard stair      | h H  side-pipe mouth (top, bottom)
//   M  ? block: the floppy disk   | [ ]  pipe rim      | - _  side-pipe body (top, bottom)
//   *  hidden block: the spark    | { }  pipe body     | j J  side-pipe join (top, bottom)
//   o  coin                       | !  flagpole ball   | L  lava surface    | l  lava
//   g  bug (spawn)                | |  flagpole        | =  bridge          | %  chain
//   k  shell-bug (spawn)          |                    | A  the ENTER key    | f  firebar block
//   p  Princess Pearl             |                    |                    |
// Maps are written as screens (segments) that are joined left to right; every row of a segment
// has the same width (checked at load).
(function () {
  'use strict';
  const FILM = (window.FILM = window.FILM || {});
  const CQ = (FILM.__cq = FILM.__cq || {});

  function join(name, segs) {
    const rows = [];
    for (let r = 0; r < 12; r++) rows.push('');
    let col = 0;
    for (const s of segs) {
      if (s.length !== 12) throw new Error(`level ${name}: a segment at col ${col} has ${s.length} rows, not 12`);
      const w = s[0].length;
      for (let r = 0; r < 12; r++) {
        if (s[r].length !== w) throw new Error(`level ${name}: segment at col ${col}, row ${r} is ${s[r].length} wide, not ${w}`);
        rows[r] += s[r];
      }
      col += w;
    }
    return rows;
  }

  // ---------------------------------------------------------------------------------------------
  // WORLD 1-1 (192 tiles). Set pieces, left to right: a bug to stomp on the open first screen; an arc
  // of coins over a pit; the floppy gateway (two low pipes with a brick lintel between them that holds
  // the floppy block: the floppy slides off the lintel, bounces off the far pipe and comes back to him on
  // open ground); the brick canopy with a coin on every brick and, past its end, the hidden block with
  // the Claude spark; the star run through three bug packs, a brick shelf and a short pit; a quiet
  // stretch (two ? blocks, a bug) to the pipe down to the coin room; the stretch the pipe skips; the
  // shell-bug and the three bugs its shell bowls over; two floating platforms climbing to the flagpole,
  // and the castle.
  // ---------------------------------------------------------------------------------------------
  const W11 = join('1-1', [
    [ // cols 0-19: the first screen (the title shows it): open ground and a bug walking in
      '....................',
      '....................',
      '....................',
      '....................',
      '....................',
      '....................',
      '....................',
      '....................',
      '....................',
      '.................g..',
      '####################',
      '####################',
    ],
    [ // cols 20-35: an arc of five coins over the pit at cols 27-29
      '................',
      '................',
      '................',
      '................',
      '................',
      '........o.......',
      '.......o.o......',
      '......o...o.....',
      '................',
      '................',
      '#######...######',
      '#######...######',
    ],
    [ // cols 36-57: the floppy gateway: low pipes at 39-40 and 51-52, the lintel 43-47 with the floppy block (45)
      '......................',
      '......................',
      '......................',
      '......................',
      '......................',
      '......................',
      '.......BBMBB..........',
      '......................',
      '...[]..........[].....',
      '...{}..........{}.....',
      '######################',
      '######################',
    ],
    [ // cols 58-81: the brick canopy (60-71) with a coin on each brick; the hidden spark block (76)
      '........................',
      '........................',
      '........................',
      '........................',
      '........................',
      '..oooooooooooo..........',
      '..BBBBBBBBBBBB....*.....',
      '........................',
      '........................',
      '........................',
      '########################',
      '########################',
    ],
    [ // cols 82-121: the star run: bug packs at 88-92, 100-102 and 113-117, a brick shelf (96-101), a pit (108-109)
      '........................................',
      '........................................',
      '........................................',
      '........................................',
      '........................................',
      '........................................',
      '..............BBBBBB....................',
      '........................................',
      '........................................',
      '......g.g.g.......g.g..........g.g.g....',
      '##########################..############',
      '##########################..############',
    ],
    [ // cols 122-137: two ? blocks, a bug, the pipe down to the coin room (134-135)
      '................',
      '................',
      '................',
      '................',
      '................',
      '................',
      '.....??.........',
      '................',
      '............[]..',
      '........g...{}..',
      '################',
      '################',
    ],
    [ // cols 138-149: the stretch the coin room skips (a brick row, a pit), the pipe back up (148-149)
      '............',
      '............',
      '............',
      '............',
      '............',
      '............',
      '..BBB?BB....',
      '............',
      '..........[]',
      '..........{}',
      '###..#######',
      '###..#######',
    ],
    [ // cols 150-167: the shell-bug (155) and three bugs in a line (160, 162, 164)
      '..................',
      '..................',
      '..................',
      '..................',
      '..................',
      '..................',
      '..................',
      '..................',
      '..................',
      '.....k....g.g.g...',
      '##################',
      '##################',
    ],
    [ // cols 168-191: floating platforms (172-173 low, 176-177 high), the flagpole (179), the castle (185-189)
      '........................',
      '........................',
      '........................',
      '...........!............',
      '...........|............',
      '...........|............',
      '........XX.|............',
      '...........|............',
      '....XX.....|............',
      '...........X............',
      '########################',
      '########################',
    ],
  ]);

  // Scenery for 1-1, placed by hand: [drawing, tile column, top y (clouds only; hills and bushes stand on
  // the ground)]. Clouds keep clear of the title box on the first screen; no hill or bush stands behind a
  // pipe, a pit, the pole or the castle, and no dark hill sits where Claw'd stands on the title or
  // catches the floppy.
  const W11_SCENERY = [
    ['cloud1', 0.5, 40], ['cloud2', 18, 44], ['cloud1', 30, 38], ['cloud3', 52, 42], ['cloud2', 72, 40],
    ['cloud1', 90, 50], ['cloud3', 112, 38], ['cloud2', 128, 46], ['cloud1', 146, 40], ['cloud2', 160, 36],
    ['cloud1', 172, 44],
    ['hillB', 16], ['hillS', 32], ['hillB', 53], ['hillS', 84], ['hillB', 110], ['hillS', 124], ['hillS', 152],
    ['hillS', 166],
    ['bush3', 6], ['bush1', 23], ['bush2', 36], ['bush1', 55], ['bush2', 78], ['bush1', 96], ['bush2', 118],
    ['bush1', 131], ['bush2', 144], ['bush3', 157], ['bush1', 169],
  ];

  // ---------------------------------------------------------------------------------------------
  // The coin room (one screen). Claw'd drops in through the gap in the ceiling (cols 1-2), runs at the
  // hump of floor blocks (8-11), leaps it through the arc of coins over it and leaves by the sideways
  // pipe (mouth at col 15).
  // ---------------------------------------------------------------------------------------------
  const BONUS = join('bonus', [
    [
      '....................',
      '....................',
      '....................',
      'W..WWWWWWWWWWWWWW{}W',
      'W................{}W',
      'W.......oooo.....{}W',
      'W......o....o....{}W',
      'W.....o......o...{}W',
      'W.......GGGG...h-j}W',
      'W.......GGGG...H_J}W',
      'GGGGGGGGGGGGGGGGGGGG',
      'GGGGGGGGGGGGGGGGGGGG',
    ],
  ]);

  // ---------------------------------------------------------------------------------------------
  // WORLD 1-4 (88 tiles): the entry platform under a stepped ceiling; the first lava pit; the hall with
  // the first firebar (hung from col 27); the second pit; the second firebar (on the block at col 44)
  // guarding the way to the step up to the bridge; the bridge over the lava (52-63) where the Big Bug walks; the
  // chain and the ENTER key on its platform (64-66); Pearl's room (67-87), open to the dark above,
  // with banners and torches.
  // ---------------------------------------------------------------------------------------------
  const W14 = join('1-4', [
    [ // cols 0-15: the entry platform; the ceiling steps down at col 10
      '................',
      '................',
      '................',
      'wwwwwwwwwwwwwwww',
      'wwwwwwwwwwwwwwww',
      '..........wwwwww',
      '................',
      '#####...........',
      '#####...........',
      '#####...........',
      '################',
      '################',
    ],
    [ // cols 16-35: the first pit (18-20), the ceiling stepping up round the first firebar (27)
      '....................',
      '....................',
      '....................',
      'wwwwwwwwwwwwwwwwwwww',
      'wwwwwwww..........ww',
      'ww..................',
      '...........f........',
      '....................',
      '....................',
      '....................',
      '##LLL###############',
      '##lll###############',
    ],
    [ // cols 36-51: the second pit (36-37), the second firebar (on the block at 44), the step up to the bridge (48-51)
      '................',
      '................',
      '................',
      'wwwwwwwwwwwwwwww',
      'wwww............',
      'ww..............',
      '........f.......',
      '................',
      '............####',
      '............####',
      'LL##############',
      'll##############',
    ],
    [ // cols 52-87: the bridge (52-63), the chain (63), the key's platform (64-66) and key (66), Pearl's room
      '....................................',
      '....................................',
      '....................................',
      'wwwwwwwwwwwwwwww..................ww',
      '..................................ww',
      '..................................ww',
      '..................................ww',
      '...........%..A...................ww',
      '============###...................ww',
      '............###.............p.....ww',
      'LLLLLLLLLLLL########################',
      'llllllllllll########################',
    ],
  ]);

  CQ.LEVEL_DEFS = [
    {
      id: '1-1', world: '1-1', kind: 'over', rows: W11, time: 400, song: 'overworld',
      start: { x: 40, y: 148 },
      pipeDown: { tx: 134, to: 1 }, // the pipe at cols 134-135 leads to the coin room
      pipeUp: { tx: 148 }, // where the coin room lets Claw'd back out
      pole: 179, castle: 185,
      scenery: W11_SCENERY,
    },
    {
      id: 'bonus', world: '1-1', kind: 'under', rows: BONUS, time: 0, song: 'underground',
      start: { x: 20, y: 36, drop: true },
      pipeSide: { tx: 15, row: 8, to: 0 }, // the mouth (rows 8-9); leads back to 1-1's pipeUp
    },
    {
      id: '1-4', world: '1-4', kind: 'castle', rows: W14, time: 300, song: 'castle',
      start: { x: 24, y: 100 },
      bridge: [52, 63], axe: 66, boss: { tx: 59, range: [54, 61] },
      camLock: 800, // the camera holds on the bridge (cols 50-70) until the boss is gone
      // the firebars, in map order: the hall's turns clockwise, the step's the other way and faster
      firebars: [{ dir: 1, phase: 0, step: 4 }, { dir: -1, phase: 24, step: 3 }],
      // wall torches (8 x 16) and banners (16 x 32) in world px, top-left
      decor: [
        { n: 'torch', x: 196, y: 100 }, { n: 'torch', x: 548, y: 92 },
        { n: 'banner', x: 1108, y: 44 }, { n: 'banner', x: 1356, y: 44 },
        { n: 'torch', x: 1138, y: 100 }, { n: 'torch', x: 1350, y: 100 },
      ],
    },
  ];
})();
