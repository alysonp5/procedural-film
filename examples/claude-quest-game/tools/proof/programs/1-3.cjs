// tools/proof/programs/1-3.cjs : World 1-3 THE CLOUD, start to flagpole. Owner: P3.
'use strict';
const routes = require('./routes.cjs');
module.exports = {
  name: '1-3',
  order: 3,
  what: 'World 1-3 from its start to the flagpole',
  opts: { start: '1-3' },
  exit: ['flagpole'],
  build: (k) => [k.mode('play'), ...routes.r13(k, {})],
};
