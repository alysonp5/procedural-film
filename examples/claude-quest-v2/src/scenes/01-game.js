// Shot 01 — game (the whole film). Owner: game.
// The glue between the three systems: the game draws global frame f into the native 320x180 buffer,
// then the display presents it. Until src/game lands this draws a test card; until src/crt.js lands
// it presents with the clean nearest-neighbour upscale.
(function () {
  'use strict';

  function testCard(ctx, f) {
    const L = FILM.lib;
    const N = L.NES;
    const W = FILM.NATIVE_W, H = FILM.NATIVE_H;
    ctx.fillStyle = N[0x22];
    ctx.fillRect(0, 0, W, H);
    const bars = [0x30, 0x28, 0x2c, 0x2a, 0x24, 0x16, 0x12, 0x0f];
    for (let i = 0; i < bars.length; i++) {
      ctx.fillStyle = N[bars[i]];
      ctx.fillRect(Math.round((i * W) / bars.length), 40, Math.ceil(W / bars.length), 80);
    }
    ctx.fillStyle = N[0x17];
    ctx.fillRect(0, 148, W, 32);
    const x = ((f * 2) % (W + 32)) - 16;
    L.sprite(ctx, 'clawdS_idle', x, 132);
    L.pxtext(ctx, 'CLAUDE QUEST V2 TEST CARD', 160, 10, { color: N[0x30], align: 'center' });
    L.pxtext(ctx, 'FRAME ' + String(f).padStart(5, '0'), 160, 128, { color: N[0x30], align: 'center' });
  }

  FILM.scene({
    id: 'game',
    draw(ctx, t, info) {
      const f = info.frame; // global frame index at 60 fps
      const nb = FILM.native();
      if (FILM.game && typeof FILM.game.draw === 'function') FILM.game.draw(nb.ctx, f);
      else testCard(nb.ctx, f);
      if (FILM.crt && typeof FILM.crt.present === 'function') FILM.crt.present(nb.canvas, ctx, { frame: f, T: info.T });
      else FILM.presentNearest(nb.canvas, ctx);
    },
  });
})();
