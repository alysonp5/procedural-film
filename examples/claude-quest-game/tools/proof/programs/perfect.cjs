// tools/proof/programs/perfect.cjs : the perfect run, all 12 tokens in one run from 1-1 (docs/game-spec.md
// 13.2). Owner: P3. He takes the floppy in 1-1 and the terminal in 1-2, so he is Claw'd Code (big) in the
// 1-4 spike gallery, where the pocket token needs a big Claw'd to break its bricks.
'use strict';
const routes = require('./routes.cjs');

// every level of World 1 with its tokens, from the first play frame of 1-1 to the ENTER key in 1-4
function perfectRoute(k) {
  const next = (id) => k.wait(`the lives screen, then ${id}`, (W) => W.mode === 'play' && W.lv.def.id === id && W.p.st === 'play');
  return [
    k.mode('play'),
    ...routes.r11(k, { tokens: true }),
    next('1-2'),
    ...routes.r12(k, { tokens: true }),
    next('1-3'),
    ...routes.r13(k, { tokens: true }),
    next('1-4'),
    ...routes.r14(k, { tokens: true }),
  ];
}

module.exports = {
  name: 'perfect',
  order: 10,
  what: 'the perfect run: 1-1 to the rescue in 1-4 in one run, all 12 tokens',
  opts: { start: '1-1' },
  exit: ['complete'],
  cap: (CQ) => ['1-1', '1-2', '1-3', '1-4'].reduce((n, id) => n + CQ.GAME_DEFS[id].time * 24 + 600, 0),
  build: (k) => perfectRoute(k),
  check: (W, events, CQ) => {
    const done = events.find((e) => e.type === 'complete');
    return [
      [CQ.tokenCount(W) === 12, `all 12 tokens (${CQ.tokenCount(W)}: ${JSON.stringify(W.tokens)})`],
      [!!done && done.tokens === 12, `the complete event reports 12 tokens (${done && done.tokens})`],
      [(W.retries | 0) === 0, `no retries (${W.retries | 0})`],
    ];
  },
  perfectRoute,
};
