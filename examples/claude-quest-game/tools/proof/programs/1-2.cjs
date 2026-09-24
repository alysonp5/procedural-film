// tools/proof/programs/1-2.cjs : World 1-2 THE STACK, start to the flagpole in the exit yard (1-2x). Owner: P3.
'use strict';
const routes = require('./routes.cjs');
module.exports = {
  name: '1-2',
  order: 2,
  what: 'World 1-2 from its start, out by the side pipe, to the flagpole in the exit yard 1-2x',
  opts: { start: '1-2' },
  exit: ['flagpole'],
  build: (k) => [k.mode('play'), ...routes.r12(k, {})],
};
