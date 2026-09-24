// mock-events.js : a stand-in for FILM.game.events() while src/game is being built. TOOLS ONLY:
// the shipped film never loads this file (music.js reads FILM.game.events() and nothing else).
//
// It follows the timing contract of docs/v2-architecture.md section 8.2 (round 2: sections, the 168-frame
// fanfare before the tally, hop / roar / axe, 64 frames from the fall to the rescue, 288 of rescue before the
// ending, text typed a character a frame), with a played level's density of jumps, stomps, coins and bumps. Node: require() it; a browser tool page:
// load it as a script and read window.CQ_MOCK.events().
(function (root) {
  'use strict';
  function events() {
    const ev = [];
    const E = (f, type, data) => ev.push(Object.assign({ f, type }, data || {}));
    const song = (f, id, section) => E(f, 'song', section ? { id, section } : { id });

    // 0-120 power-on (the console is already playing the title); START ~200; lives screen ~90 frames
    song(0, 'title');
    E(200, 'start');
    song(200, 'none');

    // 330 World 1-1, first playable frame
    song(330, 'overworld', 'intro');
    const J = (f, big) => E(f, 'jump', { big });
    J(352, false);
    J(390, false);
    E(420, 'stomp', { combo: 1 });
    J(466, false);
    E(492, 'bump');
    E(492, 'coin');
    J(540, false);
    E(560, 'bump');
    E(562, 'sprout'); // the floppy disk rises
    E(640, 'powerup');
    J(676, true);
    E(700, 'brick');
    J(740, true);
    E(762, 'brick');
    E(790, 'coin');
    E(806, 'coin');
    J(850, true);
    J(910, true);
    E(944, 'stomp', { combo: 1 });
    E(958, 'stomp', { combo: 2 });
    J(1000, true);
    J(1060, true);
    E(1090, 'bump');
    E(1092, 'sprout'); // the Claude spark
    J(1130, true);
    song(1160, 'star');
    for (const [f, c] of [[1190, 1], [1214, 2], [1240, 3], [1270, 4], [1300, 5], [1330, 6], [1360, 7]]) {
      J(f - 12, true);
      E(f, 'kick', { combo: c });
    }
    E(1376, 'oneup');
    song(1460, 'overworld', 'B'); // after the star: the bridge section
    E(1500, 'stomp', { combo: 1 });
    E(1516, 'kick', { combo: 2 });
    J(1540, true);
    E(1580, 'pipe'); // down into the coin room
    song(1580, 'none'); // the console silences the music on the pipe-entry frame
    song(1610, 'underground');
    for (let k = 0; k < 6; k++) {
      if (k % 2 === 0) J(1622 + k * 18, true);
      E(1630 + k * 18, 'coin');
    }
    E(1760, 'pipe'); // into the sideways pipe
    song(1760, 'none');
    song(1790, 'overworld', 'A'); // after the coin room: the hook
    E(1790, 'pipe'); // out
    for (let k = 0; k < 3; k++) J(1820 + k * 24, true);
    J(1900, true); // the flagpole jump
    E(1930, 'flagpole', { height: 5000, frames: 58 });
    song(1930, 'none');
    song(1990, 'flag'); // he lands at the foot of the pole: 168 frames of fanfare
    for (let k = 0; k < 40; k++) E(2158 + k, 'tally', { n: 200 - 5 * k }); // the tally starts after it
    E(2214, 'firework');
    E(2234, 'firework');
    E(2254, 'firework');
    song(2300, 'none'); // lives screen, WORLD 1-4

    // the castle
    song(2390, 'castle');
    E(2430, 'hop');
    E(2470, 'roar');
    E(2520, 'hop');
    for (const f of [2440, 2500, 2560]) E(f, 'fireball');
    for (const f of [2420, 2480, 2540, 2590]) J(f, true);
    E(2620, 'axe'); // Claw'd presses ENTER
    song(2620, 'none');
    for (let i = 0; i < 13; i++) E(2628 + i * 4, 'bridge', { i });
    E(2684, 'bossfall');
    song(2748, 'rescue'); // 64 frames after the fall
    song(3036, 'ending'); // 288 frames of rescue
    const lines = ["YOU DID IT, CLAW'D!", 'QUEST COMPLETE', '12 BUGS SQUASHED', '31 COINS', 'ALL TESTS PASS'];
    let t = 3036;
    for (const line of lines) {
      E(t, 'text', { line, every: 1 });
      t += line.length + 24;
    }
    // power-off 256+ frames after the ending starts: the console keeps playing, the TV cuts it
    ev.sort((a, b) => a.f - b.f);
    return ev;
  }
  const api = { events };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.CQ_MOCK = api;
})(typeof window !== 'undefined' ? window : globalThis);
