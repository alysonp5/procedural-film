// tools/proof/programs/1-4.cjs : World 1-4 THE KERNEL, start to the ENTER key and the rescue's text. Owner: P3.
'use strict';
const routes = require('./routes.cjs');
module.exports = {
  name: '1-4',
  order: 4,
  what: 'World 1-4 from its start to the ENTER key, then the rescue until the ending text starts (complete)',
  opts: { start: '1-4' },
  exit: ['axe', 'complete'],
  build: (k) => [k.mode('play'), ...routes.r14(k, {})],
};
