// tools/proof/programs/1-1.cjs : World 1-1 HELLO, WORLD, start to flagpole. Owner: P3.
'use strict';
const routes = require('./routes.cjs');
module.exports = {
  name: '1-1',
  order: 1,
  what: 'World 1-1 from its start to the flagpole',
  opts: { start: '1-1' },
  exit: ['flagpole'],
  build: (k) => [k.mode('play'), ...routes.r11(k, {})],
};
