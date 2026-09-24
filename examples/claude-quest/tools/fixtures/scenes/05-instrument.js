/* 05 instrument : fixture T 8 - 10. Instrument mode end to end: a live clip inside the brass
   porthole for a second, then the same clip through the eyepiece. The clip is declared in clips()
   so every tool decodes its frame before drawing (the determinism pass proves it). */
(function () {
  'use strict';
  const ID = 'instrument';
  const at = (t) => t % 1;
  FILM.scene({
    id: ID,
    clips: (t) => [['testclip', at(t)]],
    draw(ctx, tIn, info) {
      const I = FILM.instrument;
      const t = Math.min(Math.max(tIn, 0), info.dur);
      const kind = t < 1 ? 'porthole' : 'eyepiece';
      const r = kind === 'porthole' ? 330 : 430;
      ctx.save();
      ctx.translate(0, (info.H - 1080) / 2); // the fixture film is vertical; the instrument is square
      I.view(ctx, (c) => I.clip(c, 'testclip', at(t), { zoom: 1.1 }), { kind, r });
      ctx.restore();
    },
  });
})();
